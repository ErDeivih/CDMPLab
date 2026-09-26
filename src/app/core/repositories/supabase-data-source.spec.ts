import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { SupabaseRepository } from './supabase-data-source';
import { DataError } from './data-source';
import type {
  CanvasDocument,
  Exercise,
  ExerciseFolder,
  Player,
  Session,
  SessionTask,
} from '../models';

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
  const tasks: SessionTask[] = [
    {
      id: 't1',
      exerciseId: 'ex-1',
      title: 'Rondos',
      durationMinutes: 15,
      material: '',
      sortOrder: 0,
    },
  ];
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
      p_tasks: [
        {
          id: 't1',
          exercise_id: 'ex-1',
          title: 'Rondos',
          duration_minutes: 15,
          material: '',
          sort_order: 0,
        },
      ],
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

    await expect(repo.saveSession(makeSession())).rejects.toMatchObject({
      code: 'revision_conflict',
    });
  });

  it('superficia el rechazo de un ejercicio de otro equipo (same_team_exercise_required)', async () => {
    const { client } = makeClient({
      rpc: async () => ({
        data: null,
        error: { code: 'P0001', message: 'same_team_exercise_required' },
      }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');

    await expect(repo.saveSession(makeSession())).rejects.toMatchObject({
      code: 'same_team_exercise_required',
    });
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

const CANVAS: CanvasDocument = {
  version: 2,
  field: 'full',
  frames: [{ duration: 0, elements: [{ id: 'e1', t: 'cone', x: 0.5, y: 0.5 }] }],
};

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
  return {
    id: 'j-1',
    teamId: 'team-1',
    name: 'Marcos',
    number: 2,
    position: 'DF',
    color: '#1a73e8',
    active: true,
    createdAt: 'now',
    ...overrides,
  };
}

function makeSessionWithTasks(overrides: Partial<Session> = {}): Session {
  return {
    id: 's-1',
    teamId: 'team-1',
    title: 'Sesión 1',
    date: '2026-01-01',
    durationMinutes: 60,
    notes: '',
    tasks: [
      {
        id: 'task-1',
        exerciseId: 'ex-1',
        title: 'Rondos',
        durationMinutes: 15,
        material: '',
        sortOrder: 0,
      },
    ],
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
          data: {
            created: { players: 1, folders: 2, exercises: 1, sessions: 1 },
            skipped: { players: 0, folders: 0, exercises: 0, sessions: 0 },
          },
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
        data: {
          created: { players: 0, folders: 0, exercises: 0, sessions: 0 },
          skipped: { players: 1, folders: 2, exercises: 1, sessions: 1 },
        },
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
        return {
          data: {
            created: { players: 1, folders: 2, exercises: 1, sessions: 0 },
            skipped: { players: 0, folders: 0, exercises: 0, sessions: 0 },
            errors: { players: 0, folders: 0, exercises: 0, sessions: 0 },
          },
          error: null,
        };
      },
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');
    const F7_CANVAS: CanvasDocument = {
      version: 2,
      schemaVersion: 4,
      field: 'f7',
      frames: [{ duration: 1000, elements: [{ id: 'e1', t: 'cone', x: 0.5, y: 0.5 }] }],
      orientation: 'horizontal',
      grass: 'stripes',
    };
    const data = {
      players: [makePlayer()],
      folders: [makeFolder('f-root', null, 'Raíz')],
      exercises: [makeExercise({ canvas: F7_CANVAS })],
      sessions: [],
    };
    const counts = await repo.importLocalData('team-1', data);
    expect(counts.created.exercises).toBe(1);
    const payload = (
      seen[0].args as { p_payload: { exercises: Array<{ canvas_data: CanvasDocument }> } }
    ).p_payload;
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
      await expect(
        repo.importLocalData('team-1', { players: [], folders: [], exercises: [], sessions: [] }),
      ).rejects.toMatchObject({
        code: c.expectedCode,
      });
    }

    // Forbidden (42501) → code 'forbidden'.
    const { client } = makeClient({
      rpc: async () => ({
        data: null,
        error: { code: '42501', message: 'forbidden: not a member of the team' },
      }),
    });
    const repo = new SupabaseRepository(client, 'user-1', 'team-1');
    await expect(
      repo.importLocalData('team-1', { players: [], folders: [], exercises: [], sessions: [] }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

// ---------------------------------------------------------------------------
// T3 — Paginación del dataset del equipo (PostgREST `max-rows` = 1000)
//
// Por qué existe esta prueba: PostgREST no devuelve más de `max-rows` filas por petición y
// NO avisa de que ha recortado. Una lectura sin `.range()` hidrataba el store INCOMPLETO y la
// app operaba sobre una vista parcial (el borrado recursivo de carpetas calculaba el subárbol
// sobre la lista truncada). El doble de pruebas de abajo replica exactamente ese recorte, de
// modo que estos tests fallan si el repositorio vuelve a leer el dataset de una sola petición.
// ---------------------------------------------------------------------------

const PAGINATED_TEAM_ID = 'team-1';

/** Filas por respuesta del "servidor": el `max-rows` por defecto de PostgREST. */
const SERVER_MAX_ROWS = 1000;

/** Cada tabla del dataset de pruebas supera una página, y varias superan dos. */
const DATASET = {
  players: 2500,
  folders: 1200,
  exercises: 1500,
  sessions: 1100,
  tasksPerSession: 11,
};

/** Mismo instante para todas las filas: es el caso real de una importación en bloque, y el
 *  que obliga a que el orden lleve desempate (si no, las páginas pueden solaparse). */
const SEED_TIME = '2026-01-01T00:00:00.000Z';

type FakeRow = Record<string, unknown>;

interface FakeRange {
  from: number;
  to: number;
}

interface FakeOrder {
  column: string;
  ascending: boolean;
}

interface FakeCall {
  table: string;
  mode: 'select' | 'delete';
  /** `null` si la consulta no pidió `.range()` (el servidor devuelve su primera página). */
  range: FakeRange | null;
  orders: FakeOrder[];
  rows: number;
}

interface FakeResponse {
  data: unknown;
  error: { code: string; message: string } | null;
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

/** Compara como Postgres en lo que aquí importa: números como números, el resto como texto
 *  (ISO timestamps y uuids se ordenan igual). */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function dataRows(response: FakeResponse): FakeRow[] {
  return (response.data ?? []) as FakeRow[];
}

function idsOf(rows: readonly FakeRow[]): string[] {
  return rows.map((r) => String(r['id'])).sort();
}

/** Doble del servidor PostgREST: filtros, orden, y `max-rows` aplicado SIEMPRE (también
 *  cuando el rango pedido es mayor, como hace el servidor real).
 *  `ignoresRange` emula al servidor que se come el offset y devuelve siempre la primera
 *  página (un proxy que descarte el `Range`): sirve para probar la red de seguridad del
 *  repositorio frente a un bucle infinito. */
class FakePostgrestServer {
  private readonly tables = new Map<string, FakeRow[]>();
  /** Cada petición que el repositorio envía al "servidor", en orden. */
  readonly calls: FakeCall[] = [];

  constructor(
    private readonly maxRows: number = SERVER_MAX_ROWS,
    private readonly ignoresRange = false,
  ) {}

  seed(table: string, rows: FakeRow[]): void {
    this.tables.set(table, [...rows]);
  }

  rowsOf(table: string): FakeRow[] {
    return this.tables.get(table) ?? [];
  }

  query(table: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this, table);
  }

  respond(
    table: string,
    rows: FakeRow[],
    range: FakeRange | null,
    orders: FakeOrder[],
  ): FakeResponse {
    const from = range && !this.ignoresRange ? range.from : 0;
    const to = Math.min(range ? range.to : Number.MAX_SAFE_INTEGER, from + this.maxRows - 1);
    const page = rows.slice(from, to + 1);
    this.calls.push({ table, mode: 'select', range, orders, rows: page.length });
    return { data: page, error: null };
  }

  removeRows(table: string, rows: FakeRow[]): FakeResponse {
    const doomed = new Set(rows);
    this.tables.set(
      table,
      this.rowsOf(table).filter((r) => !doomed.has(r)),
    );
    this.calls.push({ table, mode: 'delete', range: null, orders: [], rows: rows.length });
    return { data: null, error: null };
  }
}

class FakeQueryBuilder implements PromiseLike<FakeResponse> {
  private readonly filters: Array<(row: FakeRow) => boolean> = [];
  private readonly orders: FakeOrder[] = [];
  private rangeWindow: FakeRange | null = null;
  private singleMode: 'maybe' | 'only' | null = null;
  private deleting = false;

  constructor(
    private readonly server: FakePostgrestServer,
    private readonly table: string,
  ) {}

  select(_columns?: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column]) === String(value));
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    const wanted = new Set(values.map((v) => String(v)));
    this.filters.push((row) => wanted.has(String(row[column])));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  range(from: number, to: number): this {
    this.rangeWindow = { from, to };
    return this;
  }

  delete(): this {
    this.deleting = true;
    return this;
  }

  maybeSingle(): this {
    this.singleMode = 'maybe';
    return this;
  }

  single(): this {
    this.singleMode = 'only';
    return this;
  }

  then<TResult1 = FakeResponse, TResult2 = never>(
    onfulfilled?: ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    let rows = this.server.rowsOf(this.table).filter((row) => this.filters.every((f) => f(row)));
    const orders = this.orders;
    rows = [...rows].sort((a, b) => {
      for (const order of orders) {
        const cmp = compareValues(a[order.column], b[order.column]);
        if (cmp !== 0) return order.ascending ? cmp : -cmp;
      }
      return 0;
    });
    const response = this.singleMode
      ? { data: rows[0] ?? null, error: null }
      : this.responseFor(rows, orders);
    return Promise.resolve(response).then(onfulfilled, onrejected);
  }

  private responseFor(rows: FakeRow[], orders: FakeOrder[]): FakeResponse {
    return this.deleting
      ? this.server.removeRows(this.table, rows)
      : this.server.respond(this.table, rows, this.rangeWindow, orders);
  }
}

function playerRows(count: number): FakeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p-${pad(i)}`,
    team_id: PAGINATED_TEAM_ID,
    name: `Jugador ${i}`,
    number: i,
    position: 'DF',
    color: '#1a73e8',
    active: true,
    created_at: SEED_TIME,
  }));
}

function folderRows(count: number): FakeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f-${pad(i)}`,
    team_id: PAGINATED_TEAM_ID,
    parent_id: null,
    name: `Carpeta ${i}`,
    created_at: SEED_TIME,
  }));
}

function exerciseRows(count: number): FakeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ex-${pad(i)}`,
    team_id: PAGINATED_TEAM_ID,
    folder_id: null,
    title: `Ejercicio ${i}`,
    description: '',
    explanation: '',
    category: 'Técnica',
    objectives: [],
    materials: [],
    duration_minutes: 15,
    min_players: null,
    max_players: null,
    load_mode: 'fixed',
    series_count: null,
    repetitions_count: null,
    work_seconds: null,
    rest_seconds: null,
    is_template: false,
    canvas_data: null,
    thumbnail: null,
    revision: 1,
    created_at: SEED_TIME,
    updated_at: SEED_TIME,
  }));
}

/** Dataset del equipo con TODAS las tablas por encima de la página del servidor. */
function seededServer(): FakePostgrestServer {
  const server = new FakePostgrestServer();
  server.seed('teams', [
    {
      id: PAGINATED_TEAM_ID,
      owner_user_id: 'user-1',
      name: 'Primer Equipo',
      accent_color: '#3056d3',
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    },
  ]);
  server.seed('players', playerRows(DATASET.players));
  server.seed('exercise_folders', folderRows(DATASET.folders));
  server.seed('exercises', exerciseRows(DATASET.exercises));
  server.seed(
    'sessions',
    Array.from({ length: DATASET.sessions }, (_, i) => ({
      id: `s-${pad(i)}`,
      team_id: PAGINATED_TEAM_ID,
      title: `Sesión ${i}`,
      date: '2026-01-01',
      duration_minutes: 60,
      notes: '',
      revision: 1,
      created_at: SEED_TIME,
      updated_at: SEED_TIME,
    })),
  );
  const tasks: FakeRow[] = [];
  for (let s = 0; s < DATASET.sessions; s++) {
    for (let t = 0; t < DATASET.tasksPerSession; t++) {
      tasks.push({
        id: `t-${pad(s)}-${pad(t)}`,
        team_id: PAGINATED_TEAM_ID,
        session_id: `s-${pad(s)}`,
        exercise_id: t === 0 ? 'ex-0000' : null,
        title: `Tarea ${t}`,
        duration_minutes: 5,
        material: '',
        sort_order: t,
      });
    }
  }
  server.seed('session_exercises', tasks);
  return server;
}

function makePagedRepo(server: FakePostgrestServer): SupabaseRepository {
  const client = {
    from: (table: string) => server.query(table),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as SupabaseClient<Database>;
  return new SupabaseRepository(client, 'user-1', PAGINATED_TEAM_ID);
}

function selectCalls(server: FakePostgrestServer, table: string): FakeCall[] {
  return server.calls.filter((c) => c.table === table && c.mode === 'select');
}

function selectRanges(server: FakePostgrestServer, table: string): FakeRange[] {
  return selectCalls(server, table)
    .filter((c): c is FakeCall & { range: FakeRange } => c.range !== null)
    .map((c) => c.range);
}

describe('SupabaseRepository · paginación del dataset del equipo', () => {
  it('el doble replica el recorte del servidor: sin `.range()` solo llegan 1000 filas (control del experimento)', async () => {
    const server = seededServer();

    const truncated = dataRows(
      await server
        .query('players')
        .select('*')
        .eq('team_id', PAGINATED_TEAM_ID)
        .order('created_at', { ascending: true }),
    );
    expect(truncated).toHaveLength(SERVER_MAX_ROWS);

    // `max-rows` manda incluso sobre un rango mayor: por eso la página es de 1000 y no de más.
    const wide = dataRows(
      await server
        .query('players')
        .select('*')
        .eq('team_id', PAGINATED_TEAM_ID)
        .order('created_at', { ascending: true })
        .range(0, 4999),
    );
    expect(wide).toHaveLength(SERVER_MAX_ROWS);

    // El "servidor" sí tiene las 2500 filas: lo que recorta es la respuesta.
    expect(server.rowsOf('players')).toHaveLength(DATASET.players);
  });

  it('loadTeam recoge TODAS las filas del equipo aunque superen la página del servidor', async () => {
    const server = seededServer();
    const repo = makePagedRepo(server);

    const dataset = await repo.loadTeam(PAGINATED_TEAM_ID);

    // Ni una fila perdida ni duplicada: los ids devueltos son EXACTAMENTE los del servidor.
    expect(dataset.players.map((p) => p.id).sort()).toEqual(idsOf(server.rowsOf('players')));
    expect(dataset.folders.map((f) => f.id).sort()).toEqual(
      idsOf(server.rowsOf('exercise_folders')),
    );
    expect(dataset.exercises.map((e) => e.id).sort()).toEqual(idsOf(server.rowsOf('exercises')));
    expect(dataset.sessions.map((s) => s.id).sort()).toEqual(idsOf(server.rowsOf('sessions')));
    expect(dataset.players).toHaveLength(DATASET.players);

    // Las tareas también llegan todas, cada una con su sesión y en su orden.
    const allTasks = dataset.sessions.flatMap((s) => s.tasks);
    expect(allTasks).toHaveLength(DATASET.sessions * DATASET.tasksPerSession);
    const first = dataset.sessions.find((s) => s.id === 's-0000');
    expect(first?.tasks.map((t) => t.sortOrder)).toEqual(
      Array.from({ length: DATASET.tasksPerSession }, (_, i) => i),
    );
    expect(first?.tasks[0].snapshot?.id).toBe('ex-0000'); // el snapshot resolvió contra `exercises`
    expect(server.rowsOf('session_exercises')).toHaveLength(
      DATASET.sessions * DATASET.tasksPerSession,
    );
  });

  it('recorre páginas consecutivas de 1000 con un orden que desempata (fronteras estables)', async () => {
    const server = seededServer();
    await makePagedRepo(server).loadTeam(PAGINATED_TEAM_ID);

    // Cada tabla se pidió entera. CONTRATO ACTUALIZADO (fase de paginación robusta): ahora la
    // ÚNICA condición de fin es una página VACÍA —una página corta puede ser el límite del
    // servidor con más filas detrás—, así que cada lectura hace UNA petición más para confirmar
    // que no queda nada. Es el precio de no truncar en silencio cuando `max_rows` < 1000.
    expect(selectRanges(server, 'players')).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
      { from: 2500, to: 3499 }, // página vacía: fin confirmado
    ]);
    expect(selectRanges(server, 'exercise_folders')).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 1200, to: 2199 }, // vacía
    ]);
    expect(selectRanges(server, 'exercises').slice(0, 2)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
    expect(selectRanges(server, 'sessions')).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 1100, to: 2099 }, // vacía
    ]);

    // Ninguna petición pidió más de una página, y todas pidieron un rango explícito.
    for (const call of server.calls.filter((c) => c.mode === 'select')) {
      expect(call.range).not.toBeNull();
      expect(call.rows).toBeLessThanOrEqual(SERVER_MAX_ROWS);
    }

    // Las tareas van en bloques de sesiones (la lista de ids viaja en la URL) y cada bloque
    // también se pagina: con 100 sesiones × 11 tareas, un bloque necesita dos páginas.
    const taskRanges = selectRanges(server, 'session_exercises');
    expect(taskRanges[0]).toEqual({ from: 0, to: 999 });
    expect(taskRanges[1]).toEqual({ from: 1000, to: 1999 });
    expect(taskRanges.filter((r) => r.from === 0).length).toBeGreaterThan(1); // varios bloques de sesiones
    expect(taskRanges.every((r) => r.to - r.from === SERVER_MAX_ROWS - 1)).toBe(true);

    // Y el orden que hace estables las fronteras entre páginas.
    // OJO (era el fallo, no la prueba la que estaba mal en su intención pero sí en su expectativa):
    // este test exigía `updated_at` para ejercicios y sesiones, y `updated_at` CAMBIA con cada
    // edición, así que una fila editada entre dos páginas se movía de sitio y el `.range()` podía
    // duplicarla o saltársela. Lo que hace estables las fronteras es una clave INMUTABLE, `id`.
    const expectedOrders: Record<string, string[]> = {
      players: ['created_at', 'id'],
      exercise_folders: ['created_at', 'id'],
      exercises: ['id'],
      sessions: ['id'],
      session_exercises: ['sort_order', 'id'],
    };
    for (const [table, columns] of Object.entries(expectedOrders)) {
      expect(selectCalls(server, table).length).toBeGreaterThan(0);
      expect(selectCalls(server, table)[0].orders.map((o) => o.column)).toEqual(columns);
    }
  });

  // -------------------------------------------------------------------------
  // FASE 5 — límites de servidor distintos de 1000 (defecto real: con `max_rows = 500` la
  // lectura pedía 1000, avanzaba 1000 y terminaba al ver una página «corta», así que TRUNCABA
  // la mitad de los datos en silencio).
  // -------------------------------------------------------------------------
  describe('paginación robusta con cualquier max_rows', () => {
    for (const maxRows of [500, 1000]) {
      for (const total of [0, 1, 499, 500, 501, 999, 1000, 1001]) {
        it(`max_rows=${maxRows} y ${total} jugadores: los lee TODOS, sin truncar ni duplicar`, async () => {
          const server = new FakePostgrestServer(maxRows);
          server.seed('players', playerRows(total));
          const repo = makePagedRepo(server);

          const dataset = await repo.loadTeam(PAGINATED_TEAM_ID);

          expect(dataset.players).toHaveLength(total);
          expect(dataset.players.map((p) => p.id).sort()).toEqual(idsOf(server.rowsOf('players')));
        });
      }
    }

    it('varias páginas con max_rows=500: 2500 filas llegan completas', async () => {
      const server = new FakePostgrestServer(500);
      server.seed('players', playerRows(2500));
      const dataset = await makePagedRepo(server).loadTeam(PAGINATED_TEAM_ID);

      expect(dataset.players).toHaveLength(2500);
      expect(dataset.players.map((p) => p.id).sort()).toEqual(idsOf(server.rowsOf('players')));
      // Avanza por lo RECIBIDO (500), no por lo pedido (1000).
      expect(selectRanges(server, 'players').slice(0, 3)).toEqual([
        { from: 0, to: 999 },
        { from: 500, to: 1499 },
        { from: 1000, to: 1999 },
      ]);
    });

    it('servidor que IGNORA el rango con max_rows=500: falla claro, no gira sin fin', async () => {
      const server = new FakePostgrestServer(500, true);
      server.seed('players', playerRows(2500));
      const repo = makePagedRepo(server);

      await expect(repo.loadTeam(PAGINATED_TEAM_ID)).rejects.toMatchObject({
        code: 'pagination_stuck',
      });
      expect(selectCalls(server, 'players')).toHaveLength(2); // detectado en la segunda página
    });

    it('error en una página INTERMEDIA: se propaga y no se devuelve un dataset a medias', async () => {
      class ServerQueFalla extends FakePostgrestServer {
        override respond(
          table: string,
          rows: FakeRow[],
          range: FakeRange | null,
          orders: FakeOrder[],
        ): FakeResponse {
          if (table === 'players' && range?.from === 500) {
            return { data: null, error: { code: '57014', message: 'statement timeout' } };
          }
          return super.respond(table, rows, range, orders);
        }
      }
      const server = new ServerQueFalla(500);
      server.seed('players', playerRows(1200));
      const repo = makePagedRepo(server);

      await expect(repo.loadTeam(PAGINATED_TEAM_ID)).rejects.toMatchObject({ code: '57014' });
    });
  });

  it('una edición a mitad de lectura no duplica ni pierde ejercicios (orden por clave INMUTABLE)', async () => {
    // Con el orden antiguo (`updated_at desc`) esta prueba falla: al editar entre la primera y la
    // segunda página una fila YA LEÍDA, esa fila se movía al principio, el `.range()` la volvía a
    // traer (duplicada) y otra se quedaba fuera. `updated_at` cambia con cada edición; `id` no.
    class ServerQueEdita extends FakePostgrestServer {
      override respond(
        table: string,
        rows: FakeRow[],
        range: FakeRange | null,
        orders: FakeOrder[],
      ): FakeResponse {
        if (table === 'exercises' && range?.from === 0) {
          // Al servir la PRIMERA página, otra persona edita el primer ejercicio ya leído.
          const fila = this.rowsOf('exercises').find((r) => r['id'] === 'ex-0000');
          if (fila) fila['updated_at'] = '2999-01-01T00:00:00.000Z';
        }
        return super.respond(table, rows, range, orders);
      }
    }
    const server = new ServerQueEdita(SERVER_MAX_ROWS);
    server.seed('exercises', exerciseRows(DATASET.exercises));
    const repo = makePagedRepo(server);

    const dataset = await repo.loadTeam(PAGINATED_TEAM_ID);
    const ids = dataset.exercises.map((e) => e.id);
    expect(ids.length, 'están TODOS los ejercicios').toBe(DATASET.exercises);
    expect(new Set(ids).size, 'y ninguno repetido').toBe(DATASET.exercises);
  });

  it('deleteFolder delega el subárbol completo en una sola RPC atómica', async () => {
    // Contrato anterior incorrecto tras instalar la función remota: borrar fila por fila
    // podía dejar media carpeta eliminada al fallar la red y requería paginar el árbol.
    const { client, rpcMock, fromMock } = makeClient();
    const repo = new SupabaseRepository(client, 'user-1', PAGINATED_TEAM_ID);

    await repo.deleteFolder('f-root');

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith('delete_folder_tree', {
      p_folder_id: 'f-root',
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('duplicateFolderTree delega la copia íntegra en una sola RPC atómica', async () => {
    const { client, rpcMock, fromMock } = makeClient();
    const repo = new SupabaseRepository(client, 'user-1', PAGINATED_TEAM_ID);

    await repo.duplicateFolderTree('f-root');

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith('duplicate_folder_tree', {
      p_folder_id: 'f-root',
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('no convierte en éxito un fallo de la RPC de carpetas', async () => {
    const { client } = makeClient({
      rpc: async () => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }),
    });
    const repo = new SupabaseRepository(client, 'user-1', PAGINATED_TEAM_ID);

    await expect(repo.deleteFolder('f-root')).rejects.toBeInstanceOf(DataError);
    await expect(repo.duplicateFolderTree('f-root')).rejects.toBeInstanceOf(DataError);
  });

  it('si el servidor ignorase el rango, la lectura falla con un error legible en vez de colgarse', async () => {
    // Un servidor que devuelve siempre la primera página no avanza nunca: el repositorio
    // tiene que cortar, no quedarse en un bucle infinito llenando memoria.
    const server = new FakePostgrestServer(SERVER_MAX_ROWS, true);
    server.seed('players', playerRows(DATASET.players));
    const repo = makePagedRepo(server);

    await expect(repo.loadTeam(PAGINATED_TEAM_ID)).rejects.toMatchObject({
      code: 'pagination_stuck',
    });
    expect(selectCalls(server, 'players')).toHaveLength(2); // detectado en la segunda página
  });
});

describe('SupabaseRepository.updatePlayer — un parche PARCIAL no borra lo que no menciona', () => {
  const ROW = {
    id: 'p-1',
    team_id: 'team-1',
    name: 'Marcos',
    number: 2,
    position: 'DF',
    color: '#1a73e8',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  };

  /** Cliente mínimo que captura el payload de cada `update()` y devuelve la fila del jugador. */
  function repoQueCaptura(): {
    repo: SupabaseRepository;
    payloads: Array<Record<string, unknown>>;
  } {
    const payloads: Array<Record<string, unknown>> = [];
    const builder = {
      update: (payload: Record<string, unknown>) => {
        payloads.push(payload);
        return {
          eq: () => ({ select: () => ({ single: async () => ({ data: ROW, error: null }) }) }),
        };
      },
    };
    const { client } = makeClient({ from: () => builder });
    return { repo: new SupabaseRepository(client, 'u-1', 'team-1'), payloads };
  }

  it('el color rápido de la pizarra y la desactivación NO tocan el dorsal', async () => {
    // Antes se construía la fila entera con `number: patch.number ?? null`: el color rápido
    // (`{ color }`) y desactivar un jugador (`{ active: false }`) BORRABAN el dorsal en la base
    // de datos y, al aplicar la fila devuelta, también en la interfaz.
    const { repo, payloads } = repoQueCaptura();
    await repo.updatePlayer('p-1', { color: '#c0392b' });
    expect(payloads[0], 'solo viaja la clave del parche').toEqual({ color: '#c0392b' });
    await repo.updatePlayer('p-1', { active: false });
    expect(payloads[1]).toEqual({ active: false });
  });

  it('un parche COMPLETO sigue enviando todo, y el dorsal se puede borrar a propósito', async () => {
    const { repo, payloads } = repoQueCaptura();
    await repo.updatePlayer('p-1', {
      name: 'Marcos G.',
      number: 5,
      position: 'MF',
      color: '#111111',
    });
    expect(payloads[0]).toEqual({ name: 'Marcos G.', number: 5, position: 'MF', color: '#111111' });
    // Clave PRESENTE con valor `undefined` = borrar el dorsal (no es lo mismo que omitirla).
    await repo.updatePlayer('p-1', { number: undefined });
    expect(payloads[1]).toEqual({ number: null });
  });

  it('una restricción de la base (23514) se explica en español, no como fallo de red', async () => {
    // Antes, incumplir una `check` (una duración fuera de rango, por ejemplo) llegaba al usuario
    // como «Error al comunicarse con el servidor.»: ni decía qué pasaba ni qué revisar.
    const builder = {
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23514',
                message: 'new row for relation "players" violates check constraint',
              },
            }),
          }),
        }),
      }),
    };
    const { client } = makeClient({ from: () => builder });
    const repo = new SupabaseRepository(client, 'u-1', 'team-1');
    await expect(repo.updatePlayer('p-1', { number: 5 })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('rangos'),
    });
  });

  it('la invitación pendiente duplicada se explica como tal, no como «ya existe otro registro»', async () => {
    // CASO REAL (23/09/2026): al volver a invitar a quien ya tuvo una invitación CADUCADA, el
    // índice parcial `team_invitations_pending_unique` la sigue considerando «pendiente» y el
    // INSERT falla… pero como NO ocupa plaza, el límite de colaboradores no avisa de nada. El
    // mensaje crudo de PostgreSQL («duplicate key value violates unique constraint
    // "team_invitations_pending_unique"») llegaba al usuario como «Ya existe otro registro con
    // esos mismos datos.», que no dice QUÉ hacer. Ahora se traduce al motivo real.
    const { client } = makeClient({
      rpc: async () => ({
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "team_invitations_pending_unique"',
        },
      }),
    });
    const repo = new SupabaseRepository(client, 'u-1', 'team-1');
    await expect(repo.inviteMember('team-1', 'alguien@example.com')).rejects.toMatchObject({
      code: 'duplicate_invitation',
      message: expect.stringContaining('Cancela esa invitación'),
    });
  });

  it('createFolder manda el id del CLIENTE: la fila del servidor es la que ya se pintó', async () => {
    // FALLO REAL (23/09/2026, reportado por dos colaboradores distintos): al crear una carpeta, el
    // store generaba un id y la base generaba OTRO, así que el usuario veía la carpeta pero
    // cualquier acción posterior usaba un id inexistente: crear una subcarpeta dentro chocaba con
    // la clave foránea `(team_id, parent_id)` (23503) y renombrar/borrar afectaba a 0 filas.
    const payloads: Array<Record<string, unknown>> = [];
    const builder = {
      insert: (payload: Record<string, unknown>) => {
        payloads.push(payload);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: payload['id'],
                team_id: payload['team_id'],
                parent_id: payload['parent_id'],
                name: payload['name'],
                created_at: '2026-01-01T00:00:00.000Z',
              },
              error: null,
            }),
          }),
        };
      },
    };
    const { client } = makeClient({ from: () => builder });
    const repo = new SupabaseRepository(client, 'u-1', 'team-1');

    const creada = await repo.createFolder('team-1', 'Rondos', null, 'f-9');

    expect(payloads[0]['id'], 'el INSERT lleva el id del cliente').toBe('f-9');
    expect(creada.id, 'y el servidor devuelve ese mismo id').toBe('f-9');
    expect(payloads[0]['team_id']).toBe('team-1');
    expect(payloads[0]['parent_id']).toBeNull();
  });
});
