import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { SupabaseRepository } from './supabase-data-source';
import { DataError } from './data-source';
import type { CanvasDocument, Exercise, ExerciseFolder, Player, Session, SessionTask } from '../models';

describe('SupabaseRepository team hydration', () => {
  it('no mezcla la carga común del editor con las RPC exclusivas del propietario', async () => {
    const repo = new SupabaseRepository({} as never, 'editor-1', 'team-1');
    const internals = repo as unknown as Record<string, unknown>;
    internals['loadTeamRow'] = vi.fn().mockResolvedValue(null);
    internals['loadPlayers'] = vi.fn().mockResolvedValue([]);
    internals['loadFolders'] = vi.fn().mockResolvedValue([]);
    internals['loadExercises'] = vi.fn().mockResolvedValue([]);
    internals['loadSessions'] = vi.fn().mockResolvedValue([]);
    const listMembers = vi.spyOn(repo, 'listMembers');
    const listInvitations = vi.fn();
    internals['listInvitations'] = listInvitations;

    const result = await repo.loadTeam('team-1');

    expect(result.members).toEqual([]);
    expect(result.invitations).toEqual([]);
    expect(listMembers).not.toHaveBeenCalled();
    expect(listInvitations).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RpcResult {
  data: unknown;
  error: unknown;
}

function makeClient(overrides?: {
  rpc?: (name: string, args: unknown) => Promise<RpcResult>;
  from?: (table: string) => unknown;
}) {
  const rpcMock = vi.fn(async (name: string, args: unknown): Promise<RpcResult> => {
    if (overrides?.rpc) return overrides.rpc(name, args);
    return { data: null, error: null };
  });
  const fromMock = vi.fn((table: string): unknown => {
    if (overrides?.from) return overrides.from(table);
    return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
  });
  const client = { rpc: rpcMock, from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, rpcMock, fromMock };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const tasks: SessionTask[] = [{ id: 't1', exerciseId: 'ex-1', title: 'Rondos', durationMinutes: 15, material: '', sortOrder: 0 }];
  return {
    id: 's-1',
    teamId: 'team-1',
    title: 'Sesión 1',
    date: '2026-01-01',
    durationMinutes: 60,
    notes: 'notas',
    tasks,
    createdAt: 'c',
    savedAt: 'u',
    ...overrides,
  };
}

const SESSION_ROW = {
  id: 's-1',
  team_id: 'team-1',
  title: 'Sesión 1',
  date: '2026-01-01',
  duration_minutes: 60,
  notes: 'notas',
  revision: 2,
  created_at: 'c',
  updated_at: 'u',
};

// ---------------------------------------------------------------------------
// T1 — saveSession: RPC transaccional
// ---------------------------------------------------------------------------

describe('SupabaseRepository.saveSession (RPC transaccional)', () => {
  it('llama a la RPC y devuelve la sesión completa con su nueva revisión', async () => {
    const { client, rpcMock } = makeClient({
      rpc: async () => ({ data: SESSION_ROW, error: null }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');
    const session = makeSession();

    const saved = await repo.saveSession(session);

    expect(saved.id).toBe('s-1');
    expect(saved.revision).toBe(2);
    expect(saved.tasks).toEqual(session.tasks);

    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe('save_session_with_tasks');
    expect(args).toEqual({
      p_session: {
        id: 's-1',
        team_id: 'team-1',
        title: 'Sesión 1',
        date: '2026-01-01',
        duration_minutes: 60,
        notes: 'notas',
      },
      p_revision: null, // sesión nueva o sin revisión → la RPC inserta
      p_tasks: [{ id: 't1', exercise_id: 'ex-1', title: 'Rondos', duration_minutes: 15, material: '', sort_order: 0 }],
    });
  });

  it('envía la revisión esperada cuando la sesión ya existía (concurrencia optimista)', async () => {
    const { client, rpcMock } = makeClient({
      rpc: async () => ({ data: { ...SESSION_ROW, revision: 3 }, error: null }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');
    const session = makeSession({ revision: 2 });

    await repo.saveSession(session);

    const args = rpcMock.mock.calls[0][1] as { p_revision: number | null };
    expect(args.p_revision).toBe(2);
  });

  it('superficia un conflicto de revisión como DataError con código revision_conflict', async () => {
    const { client } = makeClient({
      rpc: async () => ({ data: null, error: { code: 'P0001', message: 'revision_conflict' } }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');

    await expect(repo.saveSession(makeSession())).rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('superficia el rechazo de un ejercicio de otro equipo (same_team_exercise_required)', async () => {
    const { client } = makeClient({
      rpc: async () => ({ data: null, error: { code: 'P0001', message: 'same_team_exercise_required' } }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');

    await expect(repo.saveSession(makeSession())).rejects.toMatchObject({ code: 'same_team_exercise_required' });
  });

  it('no hace NINGUNA escritura parcial: la RPC es la única llamada al servidor', async () => {
    // El `from` lanza si se intenta usar delete/insert a mano (path antiguo).
    const { client } = makeClient({
      rpc: async () => ({ data: null, error: { code: '42501', message: 'forbidden' } }),
      from: () => {
        throw new Error('saveSession no debe usar from()');
      },
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');

    await expect(repo.saveSession(makeSession())).rejects.toBeInstanceOf(DataError);
  });

  it('un editor (no propietario) puede guardar la sesión de su equipo; las RPC de owner quedan vetadas', async () => {
    const { client } = makeClient({
      rpc: async (name: string) =>
        name === 'save_session_with_tasks'
          ? { data: SESSION_ROW, error: null }
          : { data: null, error: { code: 'P0001', message: 'forbidden' } },
    });
    const repo = new SupabaseRepository(client, 'editor-1', 'team-1');

    // Editor guarda su sesión (la RPC valida is_team_member, que incluye editor).
    const saved = await repo.saveSession(makeSession());
    expect(saved.id).toBe('s-1');

    // Operación exclusiva del propietario: el servidor la rechaza y el repo la propaga.
    await expect(repo.listMembers('team-1')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

// ---------------------------------------------------------------------------
// T2 — importLocalData: mapeo de ids, orden topológico, idempotencia
// ---------------------------------------------------------------------------

const CANVAS: CanvasDocument = { version: 2, field: 'full', frames: [{ duration: 0, elements: [{ id: 'e1', t: 'cone', x: 0.5, y: 0.5 }] }] };

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    teamId: 'team-1',
    folderId: 'f-root',
    title: 'Rondos',
    description: 'desc',
    explanation: 'expl',
    category: 'Técnica',
    objectives: ['objetivo'],
    materials: ['conos'],
    durationMinutes: 15,
    minPlayers: null,
    maxPlayers: null,
    loadMode: 'fixed',
    seriesCount: null,
    repetitionsCount: null,
    workSeconds: null,
    restSeconds: null,
    isTemplate: false,
    canvas: CANVAS,
    thumbnail: null,
    savedAt: 'now',
    ...overrides,
  };
}

function makeFolder(id: string, parentId: string | null, name: string): ExerciseFolder {
  return { id, teamId: 'team-1', parentId, name };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return { id: 'j-1', teamId: 'team-1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: 'now', ...overrides };
}

function makeSessionWithTasks(overrides: Partial<Session> = {}): Session {
  return {
    id: 's-1',
    teamId: 'team-1',
    title: 'Sesión 1',
    date: '2026-01-01',
    durationMinutes: 60,
    notes: '',
    tasks: [{ id: 'task-1', exerciseId: 'ex-1', title: 'Rondos', durationMinutes: 15, material: '', sortOrder: 0 }],
    createdAt: 'now',
    savedAt: 'now',
    ...overrides,
  };
}

describe('SupabaseRepository.importLocalData', () => {
  interface ImportTask {
    id: string;
    exercise_id: string | null;
    title: string;
    duration_minutes: number | null;
    material: string;
    sort_order: number;
  }
  interface ImportItem {
    id: string;
    team_id: string;
    parent_id?: string | null;
    folder_id?: string | null;
    name?: string;
    title?: string;
    canvas_data?: unknown;
    tasks?: ImportTask[];
  }
  interface ImportPayload {
    folders: ImportItem[];
    players: ImportItem[];
    exercises: ImportItem[];
    sessions: ImportItem[];
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('construye UN payload con ids deterministas y referencias traducidas, y llama UNA vez a la RPC', async () => {
    const seen: { name: string; args: unknown }[] = [];
    const { client, rpcMock, fromMock } = makeClient({
      rpc: async (name: string, args: unknown) => {
        seen.push({ name, args });
        return {
          data: { created: { players: 1, folders: 2, exercises: 1, sessions: 1 }, skipped: { players: 0, folders: 0, exercises: 0, sessions: 0 } },
          error: null,
        };
      },
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');

    // Caso real del backup antiguo: el hijo se lista ANTES que el padre (orden
    // arbitrario) y las referencias usan los ids locales.
    const folders = [makeFolder('f-child', 'f-root', 'Hijo'), makeFolder('f-root', null, 'Raíz')];
    const exercises = [makeExercise()];
    const players = [makePlayer()];
    const sessions = [makeSessionWithTasks()];

    const counts = await repo.importLocalData('team-1', { players, folders, exercises, sessions });

    // 1) Una SOLA llamada (la transacción vive en el servidor), sin `from()`.
    expect(fromMock.mock.calls).toHaveLength(0);
    expect(rpcMock.mock.calls).toHaveLength(1);
    expect(rpcMock.mock.calls[0][0]).toBe('import_team_dataset');

    // 2) Conteos mapeados a ImportCounts (sin errores: todo-o-nada).
    expect(counts.created).toEqual({ players: 1, folders: 2, exercises: 1, sessions: 1 });
    expect(counts.skipped).toEqual({ players: 0, folders: 0, exercises: 0, sessions: 0 });
    expect(counts.errors).toEqual({ players: 0, folders: 0, exercises: 0, sessions: 0 });

    // 3) El payload trae ids deterministas (uuid) y TODAS las referencias ya
    //    traducidas a esos nuevos ids.
    const payload = (seen[0].args as { p_payload: ImportPayload }).p_payload;
    expect(payload.folders).toHaveLength(2);
    expect(payload.folders[0]['parent_id']).toBe(payload.folders[1]['id']); // hijo → nuevo id del padre
    expect(payload.folders[0]['id']).toMatch(UUID_RE);
    expect(payload.folders[0]['id']).not.toBe('f-child');
    expect(payload.folders[1]['parent_id']).toBeNull();

    expect(payload.players).toHaveLength(1);
    expect(payload.players[0]['id']).toMatch(UUID_RE);
    expect(payload.players[0]['id']).not.toBe('j-1');

    expect(payload.exercises[0]['folder_id']).toBe(payload.folders[1]['id']);
    expect(payload.exercises[0]['id']).toMatch(UUID_RE);
    expect(payload.exercises[0]['canvas_data']).toEqual(CANVAS); // canvas conservado

    const task = payload.sessions[0]['tasks']![0];
    expect(payload.sessions[0]['id']).toMatch(UUID_RE);
    expect(task['exercise_id']).toBe(payload.exercises[0]['id']);
    expect(task['id']).toMatch(UUID_RE);
    expect(task['id']).not.toBe('task-1');
  });

  it('mapea el resultado idempotente de la RPC (created=0, skipped=total)', async () => {
    const { client } = makeClient({
      rpc: async () => ({
        data: { created: { players: 0, folders: 0, exercises: 0, sessions: 0 }, skipped: { players: 1, folders: 2, exercises: 1, sessions: 1 } },
        error: null,
      }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');
    const data = {
      players: [makePlayer()],
      folders: [makeFolder('f-child', 'f-root', 'Hijo'), makeFolder('f-root', null, 'Raíz')],
      exercises: [makeExercise()],
      sessions: [makeSessionWithTasks()],
    };

    const counts = await repo.importLocalData('team-1', data);

    expect(counts.created).toEqual({ players: 0, folders: 0, exercises: 0, sessions: 0 });
    expect(counts.skipped).toEqual({ players: 1, folders: 2, exercises: 1, sessions: 1 });
    expect(counts.errors).toEqual({ players: 0, folders: 0, exercises: 0, sessions: 0 });
  });

  it('importa atómicamente un dataset cuyo ejercicio usa F7 (canvas_data conserva field f7)', async () => {
    const seen: { name: string; args: unknown }[] = [];
    const { client } = makeClient({
      rpc: async (name: string, args: unknown) => {
        seen.push({ name, args });
        return { data: { created: { players: 1, folders: 2, exercises: 1, sessions: 0 }, skipped: { players: 0, folders: 0, exercises: 0, sessions: 0 }, errors: { players: 0, folders: 0, exercises: 0, sessions: 0 } }, error: null };
      },
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');
    const F7_CANVAS: CanvasDocument = { version: 2, schemaVersion: 4, field: 'f7', frames: [{ duration: 1000, elements: [{ id: 'e1', t: 'cone', x: 0.5, y: 0.5 }] }], orientation: 'horizontal', grass: 'stripes' };
    const data = {
      players: [makePlayer()],
      folders: [makeFolder('f-root', null, 'Raíz')],
      exercises: [makeExercise({ canvas: F7_CANVAS })],
      sessions: [],
    };
    const counts = await repo.importLocalData('team-1', data);
    expect(counts.created.exercises).toBe(1);
    const payload = (seen[0].args as { p_payload: { exercises: Array<{ canvas_data: CanvasDocument }> } }).p_payload;
    expect(payload.exercises[0].canvas_data.field).toBe('f7');
  });

  it('traduce cada error de la RPC a un DataError legible (todo-o-nada)', async () => {
    const cases: Array<{ message: string; expectedCode: string }> = [
      { message: 'broken_folder_reference', expectedCode: 'broken_folder_reference' },
      { message: 'broken_exercise_reference', expectedCode: 'broken_exercise_reference' },
      { message: 'invalid_uuid', expectedCode: 'invalid_uuid' },
      { message: 'cross_team_id_conflict', expectedCode: 'cross_team_id_conflict' },
      { message: 'id_content_conflict', expectedCode: 'id_content_conflict' },
      { message: 'wrong_team_reference', expectedCode: 'wrong_team_reference' },
      { message: 'folder_cycle', expectedCode: 'folder_cycle' },
    ];
    for (const c of cases) {
      const { client } = makeClient({
        rpc: async () => ({ data: null, error: { code: 'P0001', message: c.message } }),
      });
      const repo = new SupabaseRepository(client, 'user-1', 'team-1');
      await expect(repo.importLocalData('team-1', { players: [], folders: [], exercises: [], sessions: [] })).rejects.toMatchObject({
        code: c.expectedCode,
      });
    }

    // Forbidden (42501) → code 'forbidden'.
    const { client } = makeClient({
      rpc: async () => ({ data: null, error: { code: '42501', message: 'forbidden: not a member of the team' } }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');
    await expect(repo.importLocalData('team-1', { players: [], folders: [], exercises: [], sessions: [] })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
