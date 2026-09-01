import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreService } from './store.service';
import type {
  AccessResolution,
  DataSource,
  ImportCounts,
  ProfileInfo,
  ProfileStatus,
  SaveExerciseResult,
  TeamDataset,
  TeamInvitationInfo,
  TeamMemberInfo,
} from './repositories/data-source';
import type { Exercise, ExerciseFolder, Player, Session, Team } from './models';

/** Data source fake para verificar hidratación, rollback, conflicto y claves. */
function makeFake(overrides?: Partial<DataSource>): DataSource {
  const base = {
    dataSourceMode: 'supabase' as const,
    userId: 'user-1',
    teamId: 'team-1',
    resolveAccess: vi.fn<() => Promise<AccessResolution>>().mockResolvedValue({} as AccessResolution),
    loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
      team: null, players: [], folders: [], exercises: [], sessions: [], members: [], invitations: [],
    }),
    createTeam: vi.fn<() => Promise<Team>>(),
    renameTeam: vi.fn<() => Promise<Team>>(),
    addPlayer: vi.fn<() => Promise<Player>>(),
    updatePlayer: vi.fn<() => Promise<Player>>(),
    removePlayer: vi.fn<() => Promise<void>>(),
    createFolder: vi.fn<() => Promise<ExerciseFolder>>(),
    renameFolder: vi.fn<() => Promise<ExerciseFolder>>(),
    deleteFolder: vi.fn<() => Promise<void>>(),
    duplicateFolderTree: vi.fn<() => Promise<void>>(),
    moveExerciseToFolder: vi.fn<() => Promise<void>>(),
    moveExercisesToFolder: vi.fn<() => Promise<void>>(),
    saveExercise: vi.fn<() => Promise<SaveExerciseResult>>(),
    deleteExercise: vi.fn<() => Promise<void>>(),
    duplicateExercise: vi.fn<() => Promise<Exercise>>(),
    saveSession: vi.fn<() => Promise<Session>>(),
    deleteSession: vi.fn<() => Promise<void>>(),
    listMembers: vi.fn<() => Promise<TeamMemberInfo[]>>(),
    listTeamInvitations: vi.fn<() => Promise<TeamInvitationInfo[]>>(),
    inviteMember: vi.fn<() => Promise<TeamInvitationInfo>>(),
    cancelInvitation: vi.fn<() => Promise<void>>(),
    revokeMember: vi.fn<() => Promise<void>>(),
    myPendingInvitations: vi.fn<() => Promise<TeamInvitationInfo[]>>(),
    acceptInvitation: vi.fn<() => Promise<string>>(),
    isPlatformAdmin: vi.fn<() => Promise<boolean>>(),
    listProfiles: vi.fn<() => Promise<ProfileInfo[]>>(),
    setProfileStatus: vi.fn<() => Promise<void>>(),
    importLocalData: vi.fn<() => Promise<ImportCounts>>(),
  };
  return { ...base, ...overrides } as DataSource;
}

const EX = (id: string, partial: Partial<Exercise> = {}): Exercise => ({
  id, teamId: 'team-1', folderId: null, title: 'Rondos', description: '', explanation: '',
  category: 'Técnica', objectives: [], materials: [], durationMinutes: 15, minPlayers: null, maxPlayers: null,
  loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null,
  isTemplate: false, canvas: null, thumbnail: null, savedAt: new Date().toISOString(), revision: 1, ...partial,
});

describe('StoreService en modo remoto', () => {
  let store: StoreService;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('entrenolab:seeded', '1');
    store = new StoreService();
    store.clearLastError();
  });
  afterEach(() => {
    store.resetToLocal();
  });

  it('hidrata los signals desde el data source', async () => {
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: { id: 'team-1', name: 'A', accentColor: '#111', createdAt: 'x' },
        players: [{ id: 'p1', teamId: 'team-1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: 'x' }],
        folders: [],
        exercises: [EX('e1')],
        sessions: [],
        members: [],
        invitations: [],
      }),
    });
    await store.connectDataSource(fake, 'team-1');
    expect(store.teams()).toHaveLength(1);
    expect(store.activeTeam()?.name).toBe('A');
    expect(store.activeTeamPlayers()).toHaveLength(1);
    expect(store.getExercisesForTeam('team-1')).toHaveLength(1);
  });

  it('al detectar conflicto de revisión NO sobrescribe y marca lastConflict', async () => {
    const latest = EX('e1', { title: 'Versión servidor', revision: 2 });
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({ team: null, players: [], folders: [], exercises: [EX('e1')], sessions: [], members: [], invitations: [] }),
      saveExercise: vi.fn<() => Promise<SaveExerciseResult>>().mockResolvedValue({ conflict: true, revision: 2, exercise: latest }),
    });
    await store.connectDataSource(fake, 'team-1');
    store.saveExercise({ ...EX('e1'), title: 'Mi edición' });
    await vi.waitFor(() => expect(store.lastConflict()).not.toBeNull());
    expect(store.lastConflict()?.exerciseId).toBe('e1');
    // El servidor manda: el cliente refleja la última versión, no la sobreescribe.
    expect(store.getExercisesForTeam('team-1')[0].title).toBe('Versión servidor');
    expect(store.getExercisesForTeam('team-1')[0].revision).toBe(2);
  });

  it('hace ROLLBACK visible en la señal cuando el servidor falla', async () => {
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({ team: null, players: [], folders: [], exercises: [], sessions: [], members: [], invitations: [] }),
      saveExercise: vi.fn<() => Promise<SaveExerciseResult>>().mockRejectedValue(new Error('boom')),
    });
    await store.connectDataSource(fake, 'team-1');
    store.saveExercise(EX('new-1'));
    await vi.waitFor(() => expect(store.lastError()).not.toBeNull());
    expect(store.getExercisesForTeam('team-1')).toHaveLength(0); // se revirtió
    expect(store.pendingWrites()).toBe(0);
  });

  it('aísla las claves de localStorage por usuario y equipo', async () => {
    const fakeA = makeFake({ userId: 'user-a', teamId: 'team-a' });
    const fakeB = makeFake({ userId: 'user-b', teamId: 'team-b' });
    await store.connectDataSource(fakeA, 'team-a');
    store.saveDraft('team-a', null, { title: 'Borrador A' });
    const keyA = `entrenolab:user-a:team-a:draft:team-a:new`;
    expect(localStorage.getItem(keyA)).toBeTruthy();
    expect(localStorage.getItem(`entrenolab:user-b:team-b:draft:team-a:new`)).toBeNull(); // otra cuenta no comparte

    // Al cambiar de cuenta, las claves son distintas.
    await store.connectDataSource(fakeB, 'team-b');
    store.saveDraft('team-b', null, { title: 'Borrador B' });
    expect(localStorage.getItem(`entrenolab:user-b:team-b:draft:team-b:new`)).toBeTruthy();
  });
});
