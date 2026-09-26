import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreService } from './store.service';
import type {
  AccessResolution,
  AdminTeamOverview,
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

/** Equipo real que devuelven los datasets de prueba (el `connectDataSource` lo exige). */
const EQUIPO_DE_PRUEBA: Team = {
  id: 'team-1',
  name: 'Primer Equipo',
  accentColor: '#3056d3',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Dataset de equipo con EQUIPO REAL por defecto.
 *
 * CAMBIO DE CONTRATO (22/09/2026): `StoreService.connectDataSource` RECHAZA un dataset sin equipo
 * («El equipo ya no existe o no tienes acceso.») porque hidratar una pizarra vacía con un equipo que
 * ya no existe es peor que avisar. Antes los fakes de este fichero devolvían `team: null` «de
 * relleno» —solo querían fijar ejercicios o carpetas— y las pruebas pasaban mientras ese caso real
 * quedaba sin cubrir; ahora el valor por defecto es un equipo y quien quiera el caso «sin equipo» lo
 * pide EXPLÍCITAMENTE con `teamDataset({ team: null })`.
 */
function teamDataset(overrides: Partial<TeamDataset> = {}): TeamDataset {
  return {
    team: { ...EQUIPO_DE_PRUEBA },
    players: [],
    folders: [],
    exercises: [],
    sessions: [],
    members: [],
    invitations: [],
    ...overrides,
  };
}

/** Data source fake para verificar hidratación, rollback, conflicto y claves. */
function makeFake(overrides?: Partial<DataSource>): DataSource {
  const base = {
    dataSourceMode: 'supabase' as const,
    userId: 'user-1',
    teamId: 'team-1',
    resolveAccess: vi
      .fn<() => Promise<AccessResolution>>()
      .mockResolvedValue({} as AccessResolution),
    loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset()),
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
    adminTeamOverview: vi.fn<() => Promise<AdminTeamOverview[]>>(),
    importLocalData: vi.fn<() => Promise<ImportCounts>>(),
  };
  return { ...base, ...overrides } as DataSource;
}

const EX = (id: string, partial: Partial<Exercise> = {}): Exercise => ({
  id,
  teamId: 'team-1',
  folderId: null,
  title: 'Rondos',
  description: '',
  explanation: '',
  category: 'Técnica',
  objectives: [],
  materials: [],
  durationMinutes: 15,
  minPlayers: null,
  maxPlayers: null,
  loadMode: 'fixed',
  seriesCount: null,
  repetitionsCount: null,
  workSeconds: null,
  restSeconds: null,
  isTemplate: false,
  canvas: null,
  thumbnail: null,
  savedAt: new Date().toISOString(),
  revision: 1,
  ...partial,
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

  it('con red lenta espera al padre, después a la subcarpeta y finalmente guarda el ejercicio', async () => {
    let releaseParent!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    const created = new Set<string>();
    const fake = makeFake({
      createFolder: vi.fn(async (teamId, name, parentId, id) => {
        if (!parentId) await gate;
        else expect(created.has(parentId)).toBe(true);
        created.add(id);
        return { id, teamId, name, parentId };
      }),
      saveExercise: vi.fn(async (exercise) => {
        expect(created.has(exercise.folderId!)).toBe(true);
        return { exercise, conflict: false, revision: 1 };
      }),
    });
    await store.connectDataSource(fake, 'team-1');
    store.createFolder('team-1', 'Padre');
    const parent = store.folders()[0];
    store.createFolder('team-1', 'Hija', parent.id);
    const child = store.folders().find((folder) => folder.parentId === parent.id)!;
    const saving = store.saveExercise(EX('exercise-1', { folderId: child.id }));
    expect(fake.createFolder).toHaveBeenCalledTimes(1);
    expect(fake.saveExercise).not.toHaveBeenCalled();
    releaseParent();
    expect(await saving).toBe(true);
    expect(fake.createFolder).toHaveBeenCalledTimes(2);
    expect(store.pendingWrites()).toBe(0);
  });

  it('si falla el padre no envía la subcarpeta ni el ejercicio y revierte sus optimistas', async () => {
    let rejectParent!: (error: Error) => void;
    const gate = new Promise<ExerciseFolder>((_, reject) => {
      rejectParent = reject;
    });
    const fake = makeFake({ createFolder: vi.fn(() => gate) });
    await store.connectDataSource(fake, 'team-1');
    store.createFolder('team-1', 'Padre');
    const parent = store.folders()[0];
    store.createFolder('team-1', 'Hija', parent.id);
    const child = store.folders().find((folder) => folder.parentId === parent.id)!;
    const saving = store.saveExercise(EX('exercise-1', { folderId: child.id }));
    rejectParent(new Error('Sin conexión'));
    expect(await saving).toBe(false);
    expect(fake.createFolder).toHaveBeenCalledTimes(1);
    expect(fake.saveExercise).not.toHaveBeenCalled();
    expect(store.folders()).toHaveLength(0);
    expect(store.exercises()).toHaveLength(0);
    expect(store.lastError()).toContain('carpeta');
  });

  it('refresca cambios de compañeros sin reconectar el contexto', async () => {
    const fake = makeFake();
    await store.connectDataSource(fake, 'team-1');
    vi.mocked(fake.loadTeam).mockResolvedValue(teamDataset({ exercises: [EX('nuevo')] }));
    expect(await store.refreshRemoteData()).toBe(true);
    expect(store.exercises()[0].id).toBe('nuevo');
  });

  it('descarta una lectura vieja si durante el refresco se guarda un ejercicio', async () => {
    const fake = makeFake({
      saveExercise: vi.fn(async (exercise) => ({ exercise, conflict: false, revision: 1 })),
    });
    await store.connectDataSource(fake, 'team-1');
    let resolve!: (dataset: TeamDataset) => void;
    vi.mocked(fake.loadTeam).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const refreshing = store.refreshRemoteData();
    await store.saveExercise(EX('mi-cambio'));
    resolve(teamDataset());
    expect(await refreshing).toBe(false);
    expect(store.exercises()[0].id).toBe('mi-cambio');
  });

  it('no aplica un refresco después de cerrar sesión o empezar una edición', async () => {
    const fake = makeFake();
    await store.connectDataSource(fake, 'team-1');
    let resolve!: (dataset: TeamDataset) => void;
    vi.mocked(fake.loadTeam).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let canApply = true;
    const refreshing = store.refreshRemoteData(() => canApply);
    canApply = false;
    resolve(teamDataset({ exercises: [EX('no-aplicar')] }));
    expect(await refreshing).toBe(false);
    expect(store.exercises()).toHaveLength(0);
    const afterLogout = store.refreshRemoteData();
    store.resetToLocal();
    expect(await afterLogout).toBe(false);
  });

  it('si el equipo ya no existe (o no hay acceso) NO conecta y avisa: no hidrata una pizarra vacía', async () => {
    // Contrato NUEVO (22/09/2026): `loadTeam` devolviendo `team: null` significa que el equipo se
    // borró o que el usuario perdió el acceso. Antes se hidrataba igualmente (pizarra vacía como si
    // el equipo existiera) y el usuario no sabía por qué había perdido todo.
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset({ team: null })),
    });
    await expect(store.connectDataSource(fake, 'team-1')).rejects.toThrow(
      /ya no existe o no tienes acceso/,
    );
  });

  it('hidrata los signals desde el data source', async () => {
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue({
        team: { id: 'team-1', name: 'A', accentColor: '#111', createdAt: 'x' },
        players: [
          {
            id: 'p1',
            teamId: 'team-1',
            name: 'Marcos',
            number: 2,
            position: 'DF',
            color: '#1a73e8',
            active: true,
            createdAt: 'x',
          },
        ],
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
      loadTeam: vi
        .fn<() => Promise<TeamDataset>>()
        .mockResolvedValue(teamDataset({ exercises: [EX('e1')] })),
      saveExercise: vi
        .fn<() => Promise<SaveExerciseResult>>()
        .mockResolvedValue({ conflict: true, revision: 2, exercise: latest }),
    });
    await store.connectDataSource(fake, 'team-1');
    store.saveExercise({ ...EX('e1'), title: 'Mi edición' });
    await vi.waitFor(() => expect(store.lastConflict()).not.toBeNull());
    expect(store.lastConflict()?.exerciseId).toBe('e1');
    // El servidor manda: el cliente refleja la última versión, no la sobreescribe.
    expect(store.getExercisesForTeam('team-1')[0].title).toBe('Versión servidor');
    expect(store.getExercisesForTeam('team-1')[0].revision).toBe(2);
  });

  it('el guardado remoto confirma el éxito solo después de que responda el servidor', async () => {
    let confirmar!: (result: SaveExerciseResult) => void;
    const pendiente = new Promise<SaveExerciseResult>((resolve) => {
      confirmar = resolve;
    });
    const fake = makeFake({ saveExercise: vi.fn().mockReturnValue(pendiente) });
    await store.connectDataSource(fake, 'team-1');
    const resultado = store.saveExercise(EX('nuevo'));
    expect(store.pendingWrites()).toBe(1);
    confirmar({ exercise: EX('nuevo', { revision: 1 }), revision: 1 });
    expect(await resultado).toBe(true);
    expect(store.pendingWrites()).toBe(0);
  });

  it('un fallo remoto no puede presentarse como ejercicio guardado', async () => {
    const fake = makeFake({ saveExercise: vi.fn().mockRejectedValue(new Error('sin conexión')) });
    await store.connectDataSource(fake, 'team-1');
    expect(await store.saveExercise(EX('nuevo'))).toBe(false);
    expect(store.getExercisesForTeam('team-1')).toHaveLength(0);
  });

  it('«Guardar mi copia» reenvía MI versión con la revisión del servidor', async () => {
    const latest = EX('e1', { title: 'Versión servidor', revision: 2 });
    const saveExercise = vi
      .fn<(ex: Exercise, expectedRevision?: number) => Promise<SaveExerciseResult>>()
      .mockResolvedValueOnce({ conflict: true, revision: 2, exercise: latest })
      .mockResolvedValue({
        conflict: false,
        revision: 3,
        exercise: EX('e1', { title: 'Mi edición', revision: 3 }),
      });
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi
        .fn<() => Promise<TeamDataset>>()
        .mockResolvedValue(teamDataset({ exercises: [EX('e1')] })),
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
      loadTeam: vi
        .fn<() => Promise<TeamDataset>>()
        .mockResolvedValue(teamDataset({ exercises: [EX('e1')] })),
      saveExercise: vi
        .fn<() => Promise<SaveExerciseResult>>()
        .mockResolvedValue({ conflict: true, revision: 2, exercise: latest }),
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
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset()),
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
    expect(store.getExercisesForTeam('team-1')[0].title, 'la escritura reintentada se guardó').toBe(
      'Guardado a la segunda',
    );
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
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset()),
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
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset()),
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
  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  } {
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
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset()),
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
    expect(
      store.getExercisesForTeam('team-1').map((e) => e.id),
      'queda lo de B',
    ).toEqual(['e2']);
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
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset()),
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
    expect(
      store.getExercisesForTeam('team-1').map((e) => e.id),
      'A se revierte y no se pisa lo de B',
    ).toEqual(['e2']);
  });

  it('hace ROLLBACK visible en la señal cuando el servidor falla', async () => {
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(teamDataset()),
      saveExercise: vi.fn<() => Promise<SaveExerciseResult>>().mockRejectedValue(new Error('boom')),
    });
    await store.connectDataSource(fake, 'team-1');
    store.saveExercise(EX('new-1'));
    await vi.waitFor(() => expect(store.lastError()).not.toBeNull());
    expect(store.getExercisesForTeam('team-1')).toHaveLength(0); // se revirtió
    expect(store.pendingWrites()).toBe(0);
  });

  it('un borrado que falla TARDE no revierte la escritura que ya tuvo éxito (rollback incremental)', async () => {
    // Antes el rollback hacía `_exercises.set(fotoCompleta)`: si el borrado fallaba después de que
    // otra escritura ya hubiera tenido éxito, la foto revertía TAMBIÉN esa escritura nueva —el
    // usuario veía desaparecer su cambio hasta recargar—. Ahora solo se reinserta lo quitado.
    let rechazar: (e: Error) => void = () => {};
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(
        teamDataset({
          exercises: [EX('e1', { title: 'Primero' }), EX('e2', { title: 'Segundo' })],
        }),
      ),
      deleteExercise: vi.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rechazar = reject;
          }),
      ),
      // El duplicado se persiste con `saveExercise`.
      saveExercise: vi
        .fn<(ex: Exercise) => Promise<SaveExerciseResult>>()
        .mockImplementation(async (ex) => ({ conflict: false, revision: 1, exercise: ex })),
    });
    await store.connectDataSource(fake, 'team-1');

    store.deleteExercise('e1'); // queda pendiente: fallará más tarde
    store.duplicateExercise('e2'); // y esta SÍ tiene éxito
    await vi.waitFor(() =>
      expect(store.getExercisesForTeam('team-1').some((e) => e.title === 'Segundo (copia)')).toBe(
        true,
      ),
    );

    rechazar(new Error('500'));
    await vi.waitFor(() =>
      expect(store.getExercisesForTeam('team-1').some((e) => e.id === 'e1')).toBe(true),
    );
    // Vuelve el borrado… y la copia que ya se había guardado sigue ahí.
    expect(
      store
        .getExercisesForTeam('team-1')
        .map((e) => e.title)
        .sort(),
    ).toEqual(['Primero', 'Segundo', 'Segundo (copia)']);
  });

  it('un borrado de carpeta que falla tarde no revierte cambios posteriores ni pierde vínculos', async () => {
    let rechazar: (e: Error) => void = () => {};
    const carpeta: ExerciseFolder = { id: 'f1', teamId: 'team-1', name: 'Carpeta', parentId: null };
    const fake = makeFake({
      teamId: 'team-1',
      loadTeam: vi.fn<() => Promise<TeamDataset>>().mockResolvedValue(
        teamDataset({
          folders: [carpeta],
          exercises: [EX('e1', { folderId: 'f1', title: 'Primero' })],
        }),
      ),
      deleteFolder: vi.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rechazar = reject;
          }),
      ),
      saveExercise: vi
        .fn<(ex: Exercise) => Promise<SaveExerciseResult>>()
        .mockImplementation(async (ex) => ({ conflict: false, revision: 1, exercise: ex })),
    });
    await store.connectDataSource(fake, 'team-1');

    store.deleteFolder('f1');
    store.duplicateExercise('e1');
    await vi.waitFor(() =>
      expect(store.getExercisesForTeam('team-1').some((e) => e.title === 'Primero (copia)')).toBe(
        true,
      ),
    );

    rechazar(new Error('500'));
    await vi.waitFor(() =>
      expect(store.getFoldersForTeam('team-1').some((f) => f.id === 'f1')).toBe(true),
    );
    const lista = store.getExercisesForTeam('team-1');
    expect(lista.map((e) => e.title).sort()).toEqual(['Primero', 'Primero (copia)']);
    // El vínculo que esta operación había quitado se restaura…
    expect(lista.find((e) => e.title === 'Primero')?.folderId).toBe('f1');
    // …y no se toca el de la copia, que ya había quedado guardada sin carpeta.
    expect(lista.find((e) => e.title === 'Primero (copia)')?.folderId).toBeNull();
  });

  it('la carpeta creada usa el MISMO id en el store y en el servidor (lo que cuelgue de ella no se rompe)', async () => {
    // FALLO REAL (23/09/2026): el store generaba un id y la base generaba otro, así que crear una
    // SUBCARPETA dentro de una carpeta recién creada apuntaba a un `parent_id` inexistente y el
    // servidor lo rechazaba (clave foránea). Aquí se fija el contrato: el id del cliente viaja al
    // repositorio y es el que identifica la carpeta en los dos sitios.
    const llamadas: Array<{ teamId: string; name: string; parentId: string | null; id: string }> =
      [];
    const fake = makeFake({
      teamId: 'team-1',
      createFolder: vi.fn(
        async (teamId: string, name: string, parentId: string | null, id: string) => {
          llamadas.push({ teamId, name, parentId, id });
          return { id, teamId, name, parentId };
        },
      ),
    });
    await store.connectDataSource(fake, 'team-1');

    store.createFolder('team-1', 'Rondos');
    await vi.waitFor(() => expect(llamadas).toHaveLength(1));
    const enStore = store.getFoldersForTeam('team-1').find((f) => f.name === 'Rondos')!;
    expect(enStore.id, 'el store y el servidor comparten id').toBe(llamadas[0].id);

    // La subcarpeta cuelga del MISMO id que existe en el servidor.
    store.createFolder('team-1', 'Rondos 4x2', enStore.id);
    await vi.waitFor(() => expect(llamadas).toHaveLength(2));
    expect(llamadas[1].parentId, 'el padre es el id real, no uno inventado').toBe(enStore.id);
    expect(llamadas[1].parentId).toBe(llamadas[0].id);
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
