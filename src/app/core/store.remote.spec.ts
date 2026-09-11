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

  it('«Guardar mi copia» reenvía MI versión con la revisión del servidor', async () => {
    const latest = EX('e1', { title: 'Versión servidor', revision: 2 });
    const saveExercise = vi
      .fn<(ex: Exercise, expectedRevision?: number) => Promise<SaveExerciseResult>>()
      .mockResolvedValueOnce({ conflict: true, revision: 2, exercise: latest })
      .mockResolvedValue({ conflict: false, revision: 3, exercise: EX('e1', { title: 'Mi edición', revision: 3 }) });
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: null, players: [], folders: [], exercises: [EX('e1')], sessions: [], members: [], invitations: [],
      }),
      saveExercise,
    });
    await store.connectDataSource(fake, 'team-1');

    store.saveExercise({ ...EX('e1'), title: 'Mi edición' });
    await vi.waitFor(() => expect(store.lastConflict()).not.toBeNull());

    store.keepMyCopy();
    await vi.waitFor(() => expect(store.lastConflict()).toBeNull());
    await vi.waitFor(() => expect(store.getExercisesForTeam('team-1')[0].title).toBe('Mi edición'));
    // El segundo intento viaja con la revisión del SERVIDOR (2), no con la mía (1): si no,
    // volvería a chocar y el usuario no podría guardar nunca.
    expect(saveExercise).toHaveBeenCalledTimes(2);
    expect(saveExercise.mock.calls[1][1]).toBe(2);
  });

  it('«Descartar mi copia» cierra el aviso y deja la versión del servidor', async () => {
    const latest = EX('e1', { title: 'Versión servidor', revision: 2 });
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: null, players: [], folders: [], exercises: [EX('e1')], sessions: [], members: [], invitations: [],
      }),
      saveExercise: vi.fn<() => Promise<SaveExerciseResult>>().mockResolvedValue({ conflict: true, revision: 2, exercise: latest }),
    });
    await store.connectDataSource(fake, 'team-1');

    store.saveExercise({ ...EX('e1'), title: 'Mi edición' });
    await vi.waitFor(() => expect(store.lastConflict()).not.toBeNull());
    store.discardMyCopy();
    expect(store.lastConflict()).toBeNull();
    expect(store.getExercisesForTeam('team-1')[0].title).toBe('Versión servidor');
  });

  it('reintenta la escritura fallida y la deja guardada', async () => {
    const saved = EX('e1', { title: 'Guardado a la segunda' });
    const saveExercise = vi
      .fn<(ex: Exercise, expectedRevision?: number) => Promise<SaveExerciseResult>>()
      .mockRejectedValueOnce(new Error('red caída'))
      .mockResolvedValue({ conflict: false, revision: 1, exercise: saved });
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: null, players: [], folders: [], exercises: [], sessions: [], members: [], invitations: [],
      }),
      saveExercise,
    });
    await store.connectDataSource(fake, 'team-1');

    store.saveExercise(EX('e1', { title: 'Guardado a la segunda' }));
    await vi.waitFor(() => expect(store.lastError()).not.toBeNull());
    // El cambio se revirtió, pero AHORA se puede reintentar (antes solo se podía descartar).
    expect(store.canRetry(), 'hay una escritura que reintentar').toBe(true);
    expect(store.getExercisesForTeam('team-1')).toHaveLength(0);

    store.retryFailedWrite();
    await vi.waitFor(() => expect(store.lastError()).toBeNull());
    await vi.waitFor(() => expect(store.getExercisesForTeam('team-1')).toHaveLength(1));
    expect(store.getExercisesForTeam('team-1')[0].title, 'la escritura reintentada se guardó').toBe('Guardado a la segunda');
    expect(store.canRetry(), 'ya no queda nada que reintentar').toBe(false);
    expect(store.pendingWrites(), 'no quedan escrituras en curso').toBe(0);
    expect(saveExercise).toHaveBeenCalledTimes(2);
  });

  it('si el reintento vuelve a fallar, el aviso sigue y se puede volver a intentar', async () => {
    const saveExercise = vi
      .fn<(ex: Exercise, expectedRevision?: number) => Promise<SaveExerciseResult>>()
      .mockRejectedValue(new Error('el servidor sigue caído'));
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: null, players: [], folders: [], exercises: [], sessions: [], members: [], invitations: [],
      }),
      saveExercise,
    });
    await store.connectDataSource(fake, 'team-1');

    store.saveExercise(EX('e1'));
    await vi.waitFor(() => expect(store.canRetry()).toBe(true));
    store.retryFailedWrite();
    await vi.waitFor(() => expect(store.pendingWrites()).toBe(0));
    expect(store.lastError(), 'el aviso sigue tras un reintento fallido').not.toBeNull();
    expect(store.canRetry(), 'y se puede volver a intentar').toBe(true);
    expect(store.getExercisesForTeam('team-1'), 'nada a medias').toHaveLength(0);

    // Descartar («Entendido») quita el aviso Y el reintento.
    store.clearLastError();
    expect(store.canRetry()).toBe(false);
    expect(store.lastError()).toBeNull();
  });

  it('una operación nueva invalida el reintento pendiente (el estado ya cambió)', async () => {
    const saveExercise = vi
      .fn<(ex: Exercise, expectedRevision?: number) => Promise<SaveExerciseResult>>()
      .mockRejectedValueOnce(new Error('falla la primera'))
      .mockResolvedValue({ conflict: false, revision: 1, exercise: EX('e2') });
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: null, players: [], folders: [], exercises: [], sessions: [], members: [], invitations: [],
      }),
      saveExercise,
    });
    await store.connectDataSource(fake, 'team-1');

    store.saveExercise(EX('e1'));
    await vi.waitFor(() => expect(store.canRetry()).toBe(true));
    // El usuario hace OTRA cosa (que sí funciona): reintentar la primera pisaría esto.
    store.saveExercise(EX('e2'));
    await vi.waitFor(() => expect(store.getExercisesForTeam('team-1')).toHaveLength(1));
    expect(store.canRetry(), 'la operación nueva descarta el reintento viejo').toBe(false);
  });

  /** Promesa diferida: permite decidir CUÁNDO resuelve o falla cada operación. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('una respuesta TARDÍA no reabre el reintento: A falla mientras B sigue en vuelo', async () => {
    const a = deferred<SaveExerciseResult>();
    const b = deferred<SaveExerciseResult>();
    const saveExercise = vi
      .fn<(ex: Exercise, expectedRevision?: number) => Promise<SaveExerciseResult>>()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: null, players: [], folders: [], exercises: [], sessions: [], members: [], invitations: [],
      }),
      saveExercise,
    });
    await store.connectDataSource(fake, 'team-1');

    store.saveExercise(EX('e1')); // operación A
    store.saveExercise(EX('e2')); // operación B, más reciente
    expect(store.pendingWrites()).toBe(2);

    a.reject(new Error('A falla mientras B está en vuelo'));
    await vi.waitFor(() => expect(store.pendingWrites()).toBe(1));
    expect(store.lastError(), 'el error de A se avisa').not.toBeNull();
    // A es MÁS ANTIGUA que B: reintentarla pisaría lo que B pueda dejar.
    expect(store.canRetry(), 'no se ofrece reintentar una operación superada').toBe(false);

    b.resolve({ conflict: false, revision: 1, exercise: EX('e2') });
    await vi.waitFor(() => expect(store.pendingWrites()).toBe(0));
    expect(store.getExercisesForTeam('team-1').map((e) => e.id), 'queda lo de B').toEqual(['e2']);
    expect(store.canRetry()).toBe(false);
  });

  it('una respuesta TARDÍA no reabre el reintento: A falla DESPUÉS de que B termine', async () => {
    const a = deferred<SaveExerciseResult>();
    const b = deferred<SaveExerciseResult>();
    const saveExercise = vi
      .fn<(ex: Exercise, expectedRevision?: number) => Promise<SaveExerciseResult>>()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: null, players: [], folders: [], exercises: [], sessions: [], members: [], invitations: [],
      }),
      saveExercise,
    });
    await store.connectDataSource(fake, 'team-1');

    store.saveExercise(EX('e1')); // A
    store.saveExercise(EX('e2')); // B

    b.resolve({ conflict: false, revision: 1, exercise: EX('e2') });
    await vi.waitFor(() => expect(store.pendingWrites()).toBe(1));
    // A sigue EN VUELO: su cambio optimista todavía está en la lista (es lo correcto).
    expect(store.getExercisesForTeam('team-1').map((e) => e.id)).toContain('e2');

    a.reject(new Error('A falla tarde'));
    await vi.waitFor(() => expect(store.pendingWrites()).toBe(0));
    expect(store.canRetry(), 'la respuesta tardía de A no reabre el reintento').toBe(false);
    expect(store.getExercisesForTeam('team-1').map((e) => e.id), 'A se revierte y no se pisa lo de B').toEqual(['e2']);
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
