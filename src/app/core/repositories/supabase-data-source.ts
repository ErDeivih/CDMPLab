// =============================================================
// EntrenoLab — Repositorio Supabase (fuente de verdad)
//
// Implementa `DataSource` contra el cliente tipado de Supabase. Cuando existe
// una sesión real, es la única fuente de verdad; el StoreService lo usa para
// hidratar sus signals y para persistir las mutaciones.
//
// NOTA DE SEGURIDAD: toda la autorización REAL vive en RLS + RPC del servidor
// (ver docs/06-supabase-autoritativo.md). Este repositorio NUNCA decide por
// correo ni por metadata; solo invoca RPC y consultas que el servidor valida.
// Los errores se traducen a `DataError` con código legible.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../database.types';
import type {
  ExerciseFoldersRow,
  ExercisesRow,
  PlayersRow,
  ProfilesRow,
  SessionExercisesRow,
  SessionsRow,
  TeamsRow,
} from '../database.types';
import type {
  AccessResolution,
  DataSource,
  ImportCounts,
  ImportTypeCounts,
  ProfileInfo,
  ProfileStatus,
  SaveExerciseResult,
  TeamDataset,
  TeamInvitationInfo,
  TeamMemberInfo,
} from './data-source';
import { DataError } from './data-source';
import type { Exercise, ExerciseFolder, Player, Session, SessionTask, Team } from '../models';
import {
  exerciseFromRow,
  exerciseRowForInsert,
  folderFromRow,
  playerFromRow,
  sessionFromRow,
  teamFromRow,
} from './mappers';

const COLLABORATOR_LIMIT = 4;

/**
 * Filas por página en las lecturas del dataset del equipo.
 *
 * POR QUÉ: PostgREST no devuelve más de `max-rows` filas por petición (1000 por defecto en
 * Supabase) y no avisa de que ha recortado. Una lectura sin `.range()` hidrataba el store
 * INCOMPLETO —la app operaba sobre una vista parcial: `deleteFolder` calculaba el subárbol a
 * borrar sobre una lista truncada, `duplicateFolderTree` copiaba solo una parte— así que el
 * dataset se pide página a página hasta que una vuelve incompleta. El tamaño de página es el
 * `max-rows` del servidor: pedir bloques mayores no traería más filas.
 */
const PAGE_SIZE = 1000;

/**
 * Ids por consulta `.in(...)` al leer las tareas de las sesiones. La lista de ids viaja en la
 * URL: con miles de sesiones una única petición excedería el límite de longitud del servidor
 * (el error sería ruidoso, pero el equipo dejaría de cargar). Cada bloque se pagina aparte.
 */
const SESSION_ID_CHUNK = 100;

/** Trocea `items` en bloques de `size` (el último, con lo que quede). */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Códigos de app conocidos → mensaje en español. */
const ERROR_MESSAGES: Record<string, string> = {
  collaborator_limit_exceeded: `No puedes invitar a más personas: el equipo tiene el máximo de ${COLLABORATOR_LIMIT} colaboradores (activos + invitaciones pendientes).`,
  owner_cannot_be_collaborator:
    'El propietario del equipo no puede ser invitado como colaborador de su propio equipo.',
  collaborator_not_approved: 'Solo puedes invitar a personas con el perfil aprobado.',
  invalid_invitation_email: 'El correo introducido no es válido.',
  invitation_not_available: 'La invitación ya no está disponible (caducó, se rechazó o se aceptó).',
  invitation_email_mismatch: 'Debes iniciar sesión con el correo al que se envió la invitación.',
  profile_not_approved: 'Tu perfil todavía no ha sido aprobado.',
  email_not_confirmed: 'Confirma tu correo antes de aceptar la invitación.',
  profile_not_found: 'No se encontró tu perfil.',
  invalid_profile_status: 'El estado de perfil indicado no es válido.',
  forbidden: 'No tienes permiso para realizar esta operación.',
  team_not_found: 'No se encontró el equipo.',
  folder_cycle: 'No se puede mover una carpeta dentro de sí misma.',
  team_name_required: 'El nombre del equipo es obligatorio.',
  invalid_accent_color: 'El color del equipo no es válido.',
  duplicate_invitation: 'Ya existe una invitación pendiente para este correo en este equipo.',
  not_team_owner: 'Solo el propietario puede gestionar los colaboradores.',
  revision_conflict:
    'La sesión fue modificada por otra persona. Recarga para ver la versión más reciente o guarda una copia de la tuya.',
  same_team_exercise_required:
    'No se puede guardar la sesión: una tarea referencia un ejercicio que no pertenece al equipo.',
  session_belongs_to_another_team: 'No se puede guardar: la sesión pertenece a otro equipo.',
  session_not_found: 'No se encontró la sesión.',
  // Importación local → Supabase (RPC transaccional, todo o nada).
  invalid_uuid: 'La importación no se pudo completar: hay un identificador que no es válido.',
  wrong_team_reference:
    'La importación no se pudo completar: una entidad referencia a otro equipo.',
  cross_team_id_conflict:
    'La importación no se pudo completar: un identificador ya pertenece a otro equipo.',
  broken_folder_reference:
    'La importación no se pudo completar: una carpeta referencia a otra que no existe o no pertenece al equipo.',
  broken_exercise_reference:
    'La importación no se pudo completar: una tarea referencia a un ejercicio que no existe o no pertenece al equipo.',
  id_content_conflict:
    'La importación no se pudo completar: una entidad ya existe con un contenido distinto.',
  // Restricciones de PostgreSQL. Sin esto, incumplir una `check` (p. ej. una duración fuera de
  // rango) llegaba al usuario como «Error al comunicarse con el servidor.», que no dice nada.
  '23514': 'Alguno de los valores no está permitido. Revisa los rangos (duración, jugadores…).',
  '23502': 'Falta un dato obligatorio.',
  '23503': 'El dato hace referencia a algo que ya no existe.',
  '23505': 'Ya existe otro registro con esos mismos datos.',
};

function messageFor(code: string, fallback: string): string {
  return ERROR_MESSAGES[code] ?? fallback;
}

/** Traduce un error de Postgrest a DataError con mensaje en español. */
function errorToDataError(err: unknown, fallbackCode = 'unknown', fallbackMsg?: string): DataError {
  if (err instanceof DataError) return err;
  const raw = err as { code?: string; message?: string };
  let code = raw?.code ?? fallbackCode;
  // PostgREST mete el "code" de la RAISE en `message` a veces (p. ej. P0001).
  if (code === '42501') code = 'forbidden';
  if (!code || code === 'P0001') {
    const m = raw?.message ?? '';
    for (const key of Object.keys(ERROR_MESSAGES)) {
      if (m.includes(key)) {
        code = key;
        break;
      }
    }
  }
  const fallback = fallbackMsg ?? 'Error al comunicarse con el servidor.';
  return new DataError(code, messageFor(code, fallback));
}

interface PendingInvitationRow {
  id: string;
  team_id: string;
  team_name: string;
  email_normalized: string;
  status: string;
  expires_at: string;
  created_at: string;
}

interface MemberListRow {
  user_id: string;
  display_name: string;
  email_normalized: string;
  role: string;
  status: string;
  accepted_at: string | null;
  invited_by: string | null;
}

interface AdminProfileRow {
  user_id: string;
  display_name: string;
  email_normalized: string;
  status: string;
  approved_at: string | null;
}

export class SupabaseRepository implements DataSource {
  readonly dataSourceMode = 'supabase' as const;
  private _userId: string | null;
  private _teamId: string | null;

  constructor(
    private readonly client: SupabaseClient<Database>,
    userId: string | null,
    teamId: string | null,
  ) {
    this._userId = userId;
    this._teamId = teamId;
  }

  get userId(): string | null {
    return this._userId;
  }

  get teamId(): string | null {
    return this._teamId;
  }

  /** Cambia el equipo de contexto (tras crear equipo o al entrar en el correcto). */
  setTeam(teamId: string | null): void {
    this._teamId = teamId;
  }

  // ---------------- Acceso (login por estado) ----------------

  async resolveAccess(): Promise<AccessResolution> {
    const uid = this.userId;
    if (!uid) throw new DataError('forbidden', 'No hay sesión.');

    const { data: profileRow, error: profileErr } = await this.client
      .from('profiles')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();
    if (profileErr) throw errorToDataError(profileErr, 'profile_read');
    const profile: ProfileInfo = {
      userId: String(profileRow?.user_id ?? ''),
      displayName: String(profileRow?.display_name ?? ''),
      emailNormalized: String(profileRow?.email_normalized ?? ''),
      status: (profileRow?.status as ProfileStatus) ?? 'pending',
      approvedAt: profileRow?.approved_at ?? null,
    };

    // Equipo propio (máx. 1).
    const { data: ownedRow, error: ownedErr } = await this.client
      .from('teams')
      .select('*')
      .eq('owner_user_id', uid)
      .maybeSingle();
    if (ownedErr) throw errorToDataError(ownedErr, 'team_read');
    const ownedTeam = ownedRow ? teamFromRow(ownedRow) : null;

    // Miembro activo (owner/editor) de otro equipo.
    // NO se pagina a propósito: la pertenencia de UN usuario a equipos es una lista corta por
    // diseño (un equipo propio como máximo + colaboraciones), no un dataset que crezca como el
    // del equipo. Además `team_members` no tiene un `id` con el que desempatar el orden.
    const { data: memberRows, error: memberErr } = await this.client
      .from('team_members')
      .select('*')
      .eq('user_id', uid)
      .eq('status', 'active');
    if (memberErr) throw errorToDataError(memberErr, 'team_member_read');
    const membershipRow = (memberRows ?? []).find((m) => m.team_id !== ownedTeam?.id);
    const membership = membershipRow
      ? { teamId: membershipRow.team_id, role: membershipRow.role as 'owner' | 'editor' }
      : null;

    const pendingInvitations = await this.myPendingInvitations();

    return { profile, ownedTeam, membership, pendingInvitations };
  }

  // ---------------- Lectura de un equipo ----------------

  async loadTeam(teamId: string): Promise<TeamDataset> {
    // Miembros e invitaciones son recursos de gestión exclusivos del owner.
    // Incluirlos aquí impedía a un editor hidratar los datos comunes del equipo
    // justo después de aceptar una invitación.
    const [team, players, folders, exercises, sessions] = await Promise.all([
      this.loadTeamRow(teamId),
      this.loadPlayers(teamId),
      this.loadFolders(teamId),
      this.loadExercises(teamId),
      this.loadSessions(teamId),
    ]);
    return { team, players, folders, exercises, sessions, members: [], invitations: [] };
  }

  private async loadTeamRow(teamId: string): Promise<Team | null> {
    const { data, error } = await this.client
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw errorToDataError(error, 'team_read');
    return data ? teamFromRow(data) : null;
  }

  /**
   * Trae TODAS las filas de una consulta, página a página, con `.range(from, to)`.
   *
   * Devuelve la MISMA forma que devolvían las lecturas anteriores (el array de filas de la
   * tabla): el llamante sigue mapeando fila a fila y no cambia ningún contrato.
   *
   * `page(from, to)` debe aplicar el rango a una consulta con un `order` DETERMINISTA
   * (criterio + desempate): sin un orden total, la frontera entre páginas no es estable y dos
   * peticiones consecutivas pueden repetir o saltarse filas empatadas. Una página incompleta
   * significa que ya no queda nada más (una página llena puede ser la última, así que se pide
   * la siguiente y esa vuelve vacía: una petición de más a cambio de no adivinar el total).
   */
  private async loadAllPages<T>(
    code: string,
    page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const rows: T[] = [];
    let from = 0;
    let firstRow: string | null = null;
    let pending = true;
    while (pending) {
      const { data, error } = await page(from, from + PAGE_SIZE - 1);
      if (error) throw errorToDataError(error, code);
      const pageRows = data ?? [];
      // Red de seguridad: si el servidor devolviera SIEMPRE la misma página (un proxy que se
      // coma el `Range`, por ejemplo) el bucle no terminaría nunca y la app se colgaría
      // llenando memoria. Se detecta en la primera página que no avanza y se falla claro.
      const firstOfPage = pageRows.length === PAGE_SIZE ? JSON.stringify(pageRows[0]) : null;
      if (firstOfPage !== null && firstOfPage === firstRow) {
        throw new DataError(
          'pagination_stuck',
          'No se pudo leer el equipo completo: el servidor devuelve siempre la misma página.',
        );
      }
      firstRow = firstOfPage;
      rows.push(...pageRows);
      from += PAGE_SIZE;
      // Una página incompleta es la última: ya no queda nada más que traer.
      pending = pageRows.length === PAGE_SIZE;
    }
    return rows;
  }

  private async loadPlayers(teamId: string): Promise<Player[]> {
    const rows = await this.loadAllPages<PlayersRow>('player_read', (from, to) =>
      this.client
        .from('players')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => playerFromRow(r));
  }

  private async loadFolders(teamId: string): Promise<ExerciseFolder[]> {
    const rows = await this.loadAllPages<ExerciseFoldersRow>('folder_read', (from, to) =>
      this.client
        .from('exercise_folders')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => folderFromRow(r));
  }

  private async loadExercises(teamId: string): Promise<Exercise[]> {
    // Orden por una clave INMUTABLE (`id`). Antes era `updated_at desc` + `id`: como `updated_at`
    // CAMBIA con cada edición, una fila editada por otra persona entre dos páginas se movía al
    // principio y el desplazamiento por `.range()` podía duplicarla o saltársela (el comentario de
    // `loadAllPages` pide justo un orden determinista). El orden de presentación no depende de esto:
    // la interfaz ordena por su cuenta (Recientes/A–Z/Duración en la biblioteca; fecha en sesiones).
    const rows = await this.loadAllPages<ExercisesRow>('exercise_read', (from, to) =>
      this.client
        .from('exercises')
        .select('*')
        .eq('team_id', teamId)
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => exerciseFromRow(r));
  }

  private async loadSessions(teamId: string): Promise<Session[]> {
    // Mismo motivo que en `loadExercises`: `updated_at` es mutable y no sirve para paginar.
    const sessionRows = await this.loadAllPages<SessionsRow>('session_read', (from, to) =>
      this.client
        .from('sessions')
        .select('*')
        .eq('team_id', teamId)
        .order('id', { ascending: true })
        .range(from, to),
    );

    const ids = sessionRows.map((s) => s.id);
    const tasksBySession = new Map<string, SessionTask[]>();
    if (ids.length > 0) {
      const exercises = (await this.loadExercises(teamId)).reduce<Map<string, Exercise>>(
        (m, e) => m.set(e.id, e),
        new Map(),
      );
      // Cada sesión cae en UN solo bloque, así que sus tareas llegan siempre juntas y
      // ordenadas: `sort_order` es único dentro de la sesión y `id` solo desempata.
      for (const idChunk of chunked(ids, SESSION_ID_CHUNK)) {
        const taskRows = await this.loadAllPages<SessionExercisesRow>(
          'session_task_read',
          (from, to) =>
            this.client
              .from('session_exercises')
              .select('*')
              .in('session_id', idChunk)
              .order('sort_order', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to),
        );
        for (const r of taskRows) {
          const task: SessionTask = {
            id: r.id,
            exerciseId: r.exercise_id,
            title: r.title,
            durationMinutes: r.duration_minutes,
            material: r.material,
            sortOrder: r.sort_order,
            snapshot:
              r.exercise_id && exercises.has(r.exercise_id)
                ? exercises.get(r.exercise_id)!
                : undefined,
          };
          const list = tasksBySession.get(r.session_id) ?? [];
          list.push(task);
          tasksBySession.set(r.session_id, list);
        }
      }
    }
    return sessionRows.map((s) => sessionFromRow(s, tasksBySession.get(s.id) ?? []));
  }

  // ---------------- Teams ----------------

  async createTeam(name: string, accentColor: string): Promise<Team> {
    const uid = this.userId;
    if (!uid) throw new DataError('forbidden', 'No hay sesión.');
    const { data, error } = await this.client.rpc('create_my_team', {
      p_name: name,
      p_accent_color: accentColor,
    });
    if (error) throw errorToDataError(error, 'team_create');
    const teamId = data as string;
    return this.loadTeamRow(teamId).then(
      (t) => t ?? { id: teamId, name, accentColor, createdAt: new Date().toISOString() },
    );
  }

  async renameTeam(teamId: string, name: string, accentColor: string): Promise<Team> {
    const { data, error } = await this.client
      .from('teams')
      .update({ name, accent_color: accentColor })
      .eq('id', teamId)
      .select()
      .maybeSingle();
    if (error) throw errorToDataError(error, 'team_update');
    if (!data) throw new DataError('team_not_found', 'No se encontró el equipo.');
    return teamFromRow(data);
  }

  // ---------------- Jugadores ----------------

  async addPlayer(input: Omit<Player, 'id' | 'teamId' | 'active' | 'createdAt'>): Promise<Player> {
    const teamId = this.teamId;
    if (!teamId) throw new DataError('forbidden', 'No hay equipo de contexto.');
    const { data, error } = await this.client
      .from('players')
      .insert({
        team_id: teamId,
        name: input.name,
        number: input.number,
        position: input.position,
        color: input.color,
        active: true,
      })
      .select()
      .single();
    if (error) throw errorToDataError(error, 'player_create');
    return playerFromRow(data);
  }

  async updatePlayer(id: string, patch: Partial<Player>): Promise<Player> {
    // Solo se envían las claves PRESENTES en el parche. Antes se construía la fila entera con
    // `number: patch.number ?? null`, así que cualquier parche PARCIAL borraba el dorsal en la
    // base de datos (y, al aplicar la fila devuelta, también en la interfaz): pasaba con el color
    // rápido de la pizarra —`{ color }`— y al DESACTIVAR un jugador —`{ active: false }`—. Un
    // parche parcial de verdad es el que omite claves, y PostgREST omite las `undefined`.
    const row: Database['public']['Tables']['players']['Update'] = {};
    if ('name' in patch) row.name = patch.name;
    if ('number' in patch) row.number = patch.number ?? null;
    if ('position' in patch) row.position = patch.position;
    if ('color' in patch) row.color = patch.color;
    if ('active' in patch) row.active = patch.active;
    const { data, error } = await this.client
      .from('players')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw errorToDataError(error, 'player_update');
    return playerFromRow(data);
  }

  async removePlayer(id: string): Promise<void> {
    const { error } = await this.client.from('players').update({ active: false }).eq('id', id);
    if (error) throw errorToDataError(error, 'player_remove');
  }

  // ---------------- Carpetas ----------------

  async createFolder(
    teamId: string,
    name: string,
    parentId: string | null,
  ): Promise<ExerciseFolder> {
    const { data, error } = await this.client
      .from('exercise_folders')
      .insert({ team_id: teamId, parent_id: parentId, name })
      .select()
      .single();
    if (error) throw errorToDataError(error, 'folder_create');
    return folderFromRow(data);
  }

  async renameFolder(id: string, name: string): Promise<ExerciseFolder> {
    const { data, error } = await this.client
      .from('exercise_folders')
      .update({ name })
      .eq('id', id)
      .select()
      .single();
    if (error) throw errorToDataError(error, 'folder_rename');
    return folderFromRow(data);
  }

  async deleteFolder(id: string): Promise<void> {
    const teamId = this.teamId;
    if (!teamId) throw new DataError('forbidden', 'No hay equipo de contexto.');
    // Recupera el subárbol (hijos anidados) para borrarlo de forma recursiva.
    const folders = await this.loadFolders(teamId);
    const toDelete = this.subtreeIds(id, folders);
    const order = [...toDelete].sort((a, b) => this.depth(b, folders) - this.depth(a, folders));
    for (const fid of order) {
      const { error } = await this.client.from('exercise_folders').delete().eq('id', fid);
      if (error) throw errorToDataError(error, 'folder_delete');
    }
  }

  async duplicateFolderTree(id: string): Promise<void> {
    const teamId = this.teamId;
    if (!teamId) throw new DataError('forbidden', 'No hay equipo de contexto.');
    const folders = await this.loadFolders(teamId);
    const root = folders.find((f) => f.id === id);
    if (!root) return;
    const exercises = await this.loadExercises(teamId);

    const map = new Map<string, string>();
    const createRec = async (
      oldId: string,
      newParentId: string | null,
      rootName: string,
    ): Promise<void> => {
      const old = folders.find((f) => f.id === oldId);
      if (!old) return;
      const name = oldId === id ? `${rootName} (copia)` : old.name;
      const created = await this.createFolder(teamId, name, newParentId);
      map.set(oldId, created.id);
      for (const ex of exercises.filter((e) => e.folderId === oldId)) {
        await this.saveExercise({
          ...ex,
          id: this.newId(),
          folderId: created.id,
          title: `${ex.title} (copia)`,
          savedAt: new Date().toISOString(),
        });
      }
      for (const child of folders.filter((f) => f.parentId === oldId)) {
        await createRec(child.id, created.id, rootName);
      }
    };
    await createRec(id, null, root.name);
  }

  async moveExerciseToFolder(exerciseId: string, folderId: string | null): Promise<void> {
    const { error } = await this.client
      .from('exercises')
      .update({ folder_id: folderId })
      .eq('id', exerciseId);
    if (error) throw errorToDataError(error, 'exercise_move');
  }

  async moveExercisesToFolder(ids: string[], folderId: string | null): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.client
      .from('exercises')
      .update({ folder_id: folderId })
      .in('id', ids);
    if (error) throw errorToDataError(error, 'exercise_move');
  }

  // ---------------- Ejercicios ----------------

  async saveExercise(
    ex: Exercise,
    expectedRevision?: number,
    opts?: { recreateIfMissing?: boolean },
  ): Promise<SaveExerciseResult> {
    const row = exerciseRowForInsert(ex);
    let saved: Exercise;
    if (expectedRevision != null) {
      // Actualiza SOLO las columnas editables (ExercisesUpdate). No se toca
      // `revision` (lo incrementa el trigger `bump_revision`) ni id/team_id.
      const { data, error } = await this.client
        .from('exercises')
        .update({
          folder_id: row.folder_id,
          title: row.title,
          description: row.description,
          explanation: row.explanation,
          category: row.category,
          objectives: row.objectives,
          materials: row.materials,
          duration_minutes: row.duration_minutes,
          min_players: row.min_players,
          max_players: row.max_players,
          load_mode: row.load_mode,
          series_count: row.series_count,
          repetitions_count: row.repetitions_count,
          work_seconds: row.work_seconds,
          rest_seconds: row.rest_seconds,
          is_template: row.is_template,
          canvas_data: row.canvas_data,
          thumbnail: row.thumbnail,
        })
        .eq('id', ex.id)
        .eq('revision', expectedRevision)
        .select();
      if (error) throw errorToDataError(error, 'exercise_save');
      if (!data || data.length === 0) {
        // La revisión no coincidió → otro usuario lo modificó. Se LEE la fila para distinguir ese
        // caso del de una fila que ya NO existe (la borró otra persona).
        const { data: latest } = await this.client
          .from('exercises')
          .select('*')
          .eq('id', ex.id)
          .maybeSingle();
        if (!latest && opts?.recreateIfMissing) {
          // «Guardar mi copia» sobre un ejercicio BORRADO: se vuelve a crear con la versión del
          // usuario. Sin esto el UPDATE volvía a afectar 0 filas y el conflicto se repetía para
          // siempre: el trabajo del usuario no se podía guardar NUNCA. Se conserva el id para no
          // romper las tareas de sesión que lo referencian (el servidor las desvinculó al borrarlo).
          const { data: creada, error: errInsert } = await this.client
            .from('exercises')
            .insert(row)
            .select()
            .single();
          if (errInsert) throw errorToDataError(errInsert, 'exercise_save');
          return { exercise: exerciseFromRow(creada), revision: creada.revision, recreated: true };
        }
        return {
          conflict: true,
          revision: latest?.revision ?? 1,
          exercise: latest ? exerciseFromRow(latest) : ex,
        };
      }
      saved = exerciseFromRow(data[0]);
      return { exercise: saved, revision: data[0].revision };
    } else {
      const { data, error } = await this.client.from('exercises').insert(row).select().single();
      if (error) throw errorToDataError(error, 'exercise_save');
      saved = exerciseFromRow(data);
      return { exercise: saved, revision: data.revision };
    }
  }

  async deleteExercise(id: string): Promise<void> {
    const { error } = await this.client.from('exercises').delete().eq('id', id);
    if (error) throw errorToDataError(error, 'exercise_delete');
  }

  async duplicateExercise(id: string): Promise<Exercise> {
    const { data, error } = await this.client
      .from('exercises')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw errorToDataError(error, 'exercise_read');
    if (!data) throw new DataError('not_found', 'No se encontró el ejercicio.');
    const src = exerciseFromRow(data);
    return this.saveExercise({
      ...src,
      id: this.newId(),
      title: `${src.title} (copia)`,
      savedAt: new Date().toISOString(),
    }).then((r) => r.exercise);
  }

  // ---------------- Sesiones ----------------

  async saveSession(session: Session): Promise<Session> {
    // Guardado ATÓMICO vía RPC transaccional (ver migración 20260829000000):
    // la sesión se bloquea (FOR UPDATE), se valida pertenencia + raíz de equipo
    // + revisión optimista, y luego se reemplazan las tareas. Un error en
    // cualquier punto revierte TODO el lote (nunca se deja la sesión sin tareas).
    const row = {
      id: session.id,
      team_id: session.teamId,
      title: session.title,
      date: session.date || null,
      duration_minutes: session.durationMinutes,
      notes: session.notes,
    };
    const tasks = session.tasks.map((t, i) => ({
      id: t.id,
      exercise_id: t.exerciseId,
      title: t.title,
      duration_minutes: t.durationMinutes,
      material: t.material,
      sort_order: i,
    }));
    const { data, error } = await this.client.rpc('save_session_with_tasks', {
      p_session: row,
      p_revision: session.revision ?? null,
      p_tasks: tasks,
    });
    if (error) throw errorToDataError(error, 'session_save');
    if (!data) throw new DataError('session_save', 'No se pudo guardar la sesión.');
    // `data` es el jsonb (fila `sessions` con su nueva revisión) devuelto por la RPC.
    return sessionFromRow(data as unknown as SessionsRow, session.tasks);
  }

  async deleteSession(id: string): Promise<void> {
    // Los session_exercises se borran en cascada (FK on delete cascade).
    const { error } = await this.client.from('sessions').delete().eq('id', id);
    if (error) throw errorToDataError(error, 'session_delete');
  }

  // ---------------- Colaboradores / invitaciones ----------------
  //
  // Las listas de miembros, invitaciones propias y perfiles NO se paginan aquí: vienen de RPC
  // del servidor (`list_team_members`, `my_team_invitations`, `admin_list_profiles`) que
  // devuelven el conjunto completo de una vez. Paginarlas exigiría cambiar la firma de la RPC
  // en el backend, que en este cambio no se toca (ver docs/06-supabase-autoritativo.md).
  // Las que sí leen tablas directamente están acotadas por el límite de colaboradores
  // (`collaborator_limit_exceeded`: 4 activos + pendientes) y quedan marcadas abajo.

  async listMembers(teamId: string): Promise<TeamMemberInfo[]> {
    const { data, error } = await this.client.rpc('list_team_members', { p_team_id: teamId });
    if (error) throw errorToDataError(error, 'member_list');
    const rows = (data ?? []) as MemberListRow[];
    return rows
      .filter((r) => r.status === 'active')
      .map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        emailNormalized: r.email_normalized,
        role: r.role as 'owner' | 'editor',
        status: r.status as 'active',
        acceptedAt: r.accepted_at,
        invitedBy: r.invited_by,
      }));
  }

  private async listInvitations(teamId: string): Promise<TeamInvitationInfo[]> {
    // NO se pagina: las invitaciones PENDIENTES de un equipo están acotadas por
    // `collaborator_limit_exceeded` (4 colaboradores entre activos y pendientes), muy por
    // debajo de la página del servidor.
    const { data, error } = await this.client
      .from('team_invitations')
      .select('*')
      .eq('team_id', teamId)
      .eq('status', 'pending');
    if (error) throw errorToDataError(error, 'invitation_list');
    const team = await this.loadTeamRow(teamId);
    return (data ?? []).map((r) => ({
      id: r.id,
      teamId: r.team_id,
      teamName: team?.name ?? '',
      emailNormalized: r.email_normalized,
      invitedUserId: r.invited_user_id,
      status: r.status as 'pending',
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  }

  async listTeamInvitations(teamId: string): Promise<TeamInvitationInfo[]> {
    return this.listInvitations(teamId);
  }

  async inviteMember(teamId: string, email: string): Promise<TeamInvitationInfo> {
    const { data, error } = await this.client.rpc('invite_team_member', {
      p_team_id: teamId,
      p_email: email,
    });
    if (error) throw errorToDataError(error, 'invitation_create');
    const invitationId = data as string;
    if (!invitationId) throw new DataError('invitation_create', 'No se pudo crear la invitación.');
    const { data: row, error: rowErr } = await this.client
      .from('team_invitations')
      .select('*')
      .eq('id', invitationId)
      .single();
    if (rowErr || !row) throw errorToDataError(rowErr, 'invitation_create');
    const team = await this.loadTeamRow(teamId);
    return {
      id: row.id,
      teamId: row.team_id,
      teamName: team?.name ?? '',
      emailNormalized: row.email_normalized,
      invitedUserId: row.invited_user_id,
      status: row.status as 'pending',
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  async cancelInvitation(invitationId: string): Promise<void> {
    const { error } = await this.client.rpc('cancel_team_invitation', {
      p_invitation_id: invitationId,
    });
    if (error) throw errorToDataError(error, 'invitation_cancel');
  }

  /**
   * Rechaza una invitación PROPIA (el invitado). NO usa `cancel_team_invitation`,
   * que exige ser propietario del equipo: al invitado le devolvía siempre
   * 'forbidden: not team owner' y "Rechazar" no hacía nada.
   */
  async declineInvitation(invitationId: string): Promise<void> {
    const { error } = await this.client.rpc('decline_team_invitation', {
      p_invitation_id: invitationId,
    });
    if (error) throw errorToDataError(error, 'invitation_decline');
  }

  async revokeMember(teamId: string, userId: string): Promise<void> {
    const { error } = await this.client.rpc('revoke_team_member', {
      p_team_id: teamId,
      p_user_id: userId,
    });
    if (error) throw errorToDataError(error, 'member_revoke');
  }

  async myPendingInvitations(): Promise<TeamInvitationInfo[]> {
    const uid = this.userId;
    if (!uid) return [];
    const { data, error } = await this.client.rpc('my_team_invitations');
    if (error) throw errorToDataError(error, 'invitation_list');
    const rows = (data ?? []) as PendingInvitationRow[];
    return rows.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      teamName: r.team_name,
      emailNormalized: r.email_normalized,
      invitedUserId: uid,
      status: r.status as 'pending',
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  }

  async acceptInvitation(invitationId: string): Promise<string> {
    const { data, error } = await this.client.rpc('accept_team_invitation', {
      p_invitation_id: invitationId,
    });
    if (error) throw errorToDataError(error, 'invitation_accept');
    return data as string;
  }

  // ---------------- Administración ----------------

  async isPlatformAdmin(): Promise<boolean> {
    const uid = this.userId;
    if (!uid) return false;
    const { data, error } = await this.client.rpc('is_platform_admin');
    if (error) throw errorToDataError(error, 'admin_check');
    return data === true;
  }

  async listProfiles(search: string): Promise<ProfileInfo[]> {
    const { data, error } = await this.client.rpc('admin_list_profiles', { p_search: search });
    if (error) throw errorToDataError(error, 'profile_list');
    const rows = (data ?? []) as AdminProfileRow[];
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      emailNormalized: r.email_normalized,
      status: (r.status as ProfileStatus) ?? 'pending',
      approvedAt: r.approved_at,
    }));
  }

  async setProfileStatus(userId: string, status: ProfileStatus): Promise<void> {
    const { error } = await this.client.rpc('admin_set_profile_status', {
      p_user_id: userId,
      p_status: status,
    });
    if (error) throw errorToDataError(error, 'profile_status');
  }

  // ---------------- Importación local→Supabase ----------------

  async importLocalData(
    teamId: string,
    data: {
      players: Player[];
      folders: ExerciseFolder[];
      exercises: Exercise[];
      sessions: Session[];
    },
  ): Promise<ImportCounts> {
    // 1. Mapa explícito oldId → newId POR TIPO, ANTES de enviar. El nuevo id es
    //    determinista (función de `${teamId}:<tipo>:${oldId}`), de modo que
    //    reimportar el mismo conjunto produce los MISMOS ids y es idempotente.
    const folderIds = new Map<string, string>();
    for (const f of data.folders)
      folderIds.set(f.id, await this.deterministicId(`${teamId}:folder:${f.id}`));
    const playerIds = new Map<string, string>();
    for (const p of data.players)
      playerIds.set(p.id, await this.deterministicId(`${teamId}:player:${p.id}`));
    const exerciseIds = new Map<string, string>();
    for (const e of data.exercises)
      exerciseIds.set(e.id, await this.deterministicId(`${teamId}:exercise:${e.id}`));
    const sessionIds = new Map<string, string>();
    for (const s of data.sessions)
      sessionIds.set(s.id, await this.deterministicId(`${teamId}:session:${s.id}`));
    const taskIds = new Map<string, string>();
    for (const s of data.sessions) {
      for (const t of s.tasks) {
        taskIds.set(
          `${s.id}:${t.id}`,
          await this.deterministicId(`${teamId}:session-task:${s.id}:${t.id}`),
        );
      }
    }

    // 2. UN único payload con los ids deterministas y TODAS las referencias ya
    //    traducidas (parent_id, folder_id, exercise_id y los ids de tareas). La
    //    RPC valida el grafo completo y hace la escritura de forma atómica.
    const payload: Json = {
      folders: data.folders.map((f) => ({
        id: folderIds.get(f.id) as string,
        team_id: teamId,
        parent_id: f.parentId ? (folderIds.get(f.parentId) ?? null) : null,
        name: f.name,
      })),
      players: data.players.map((p) => ({
        id: playerIds.get(p.id) as string,
        team_id: teamId,
        name: p.name,
        number: p.number,
        position: p.position,
        color: p.color,
        active: p.active,
      })),
      exercises: data.exercises.map((ex) => ({
        id: exerciseIds.get(ex.id) as string,
        team_id: teamId,
        folder_id: ex.folderId ? (folderIds.get(ex.folderId) ?? null) : null,
        title: ex.title,
        description: ex.description,
        explanation: ex.explanation,
        category: ex.category,
        objectives: ex.objectives,
        materials: ex.materials,
        duration_minutes: ex.durationMinutes,
        min_players: ex.minPlayers,
        max_players: ex.maxPlayers,
        load_mode: ex.loadMode,
        series_count: ex.seriesCount,
        repetitions_count: ex.repetitionsCount,
        work_seconds: ex.workSeconds,
        rest_seconds: ex.restSeconds,
        is_template: ex.isTemplate,
        // El canvas pizarra se conserva íntegro (la RPC no lo altera).
        canvas_data: (ex.canvas as unknown as Json) ?? null,
        thumbnail: ex.thumbnail,
      })),
      sessions: data.sessions.map((s) => ({
        id: sessionIds.get(s.id) as string,
        team_id: teamId,
        title: s.title,
        date: s.date || null,
        duration_minutes: s.durationMinutes,
        notes: s.notes,
        tasks: s.tasks.map((t, i) => ({
          id: taskIds.get(`${s.id}:${t.id}`) as string,
          exercise_id: t.exerciseId ? (exerciseIds.get(t.exerciseId) ?? null) : null,
          title: t.title,
          duration_minutes: t.durationMinutes,
          material: t.material,
          sort_order: i,
        })),
      })),
    };

    // 3. UNA sola llamada RPC transaccional: si algo falla (referencia rota,
    //    ciclo, id de otro equipo, contenido incompatible) el servidor revierte
    //    TODO y propaga el error. No hay escrituras parciales ni try/catch por
    //    entidad.
    const { data: result, error } = await this.client.rpc('import_team_dataset', {
      p_team_id: teamId,
      p_payload: payload,
    });
    if (error) throw errorToDataError(error, 'import_error');
    if (!result) throw new DataError('import_error', 'No se pudo importar.');

    // 4. Mapea created/skipped (jsonb) a ImportCounts. `errors` queda a 0 porque
    //    la RPC es todo-o-nada: si algo falla lanza y no devuelve conteos.
    const r = result as unknown as { created: ImportTypeCounts; skipped: ImportTypeCounts };
    return {
      created: {
        players: r.created.players ?? 0,
        folders: r.created.folders ?? 0,
        exercises: r.created.exercises ?? 0,
        sessions: r.created.sessions ?? 0,
      },
      skipped: {
        players: r.skipped.players ?? 0,
        folders: r.skipped.folders ?? 0,
        exercises: r.skipped.exercises ?? 0,
        sessions: r.skipped.sessions ?? 0,
      },
      errors: { players: 0, folders: 0, exercises: 0, sessions: 0 },
    };
  }

  // ---------------- Utilidades ----------------

  private subtreeIds(id: string, folders: readonly ExerciseFolder[]): Set<string> {
    const result = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      result.add(cur);
      folders.filter((f) => f.parentId === cur).forEach((f) => stack.push(f.id));
    }
    return result;
  }

  private depth(id: string, folders: readonly ExerciseFolder[]): number {
    let d = 0;
    let cur = folders.find((f) => f.id === id);
    while (cur) {
      d++;
      cur = folders.find((f) => f.id === cur!.parentId);
    }
    return d;
  }

  /** Genera un UUID v4 (los ids de colaboradores/ejercicios deben ser uuid en Postgres). */
  private newId(): string {
    const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (g?.randomUUID) return g.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Id DETERMINISTA para importar: función de `${seed}`. Mismo equipo + mismo id
   * local ⇒ MISMO id en el servidor, lo que hace reimportar idempotente (no
   * duplica). Usa los primeros 128 bits de SHA-1 con versión/variante UUID
   * cuando WebCrypto está disponible y un fallback determinista en su ausencia.
   */
  private async deterministicId(seed: string): Promise<string> {
    const g = globalThis as {
      crypto?: { subtle?: { digest?: (alg: string, data: Uint8Array) => Promise<ArrayBuffer> } };
    };
    if (g?.crypto?.subtle?.digest) {
      try {
        const digest = await g.crypto.subtle.digest('SHA-1', new TextEncoder().encode(seed));
        // SHA-1 devuelve 20 bytes, pero UUID solo admite 16. Usar los 20
        // producía cadenas de 44 caracteres que PostgreSQL rechazaba como uuid.
        const b = new Uint8Array(digest).slice(0, 16);
        b[6] = (b[6] & 0x0f) | 0x50; // versión 5
        b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
        const hex = Array.from(b)
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      } catch {
        /* cae al fallback */
      }
    }
    return this.fallbackDeterministicId(seed);
  }

  /** Fallback síncrono de `deterministicId` (FNV-1a de 128 bits en dos pasadas). */
  private fallbackDeterministicId(seed: string): string {
    const hashPart = (offset: number, msg: string): string[] => {
      let h1 = offset >>> 0;
      let h2 = (offset + 0x9e3779b9) >>> 0;
      for (let i = 0; i < msg.length; i++) {
        const c = msg.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
      }
      return [
        (h1 >>> 8) & 0xff,
        h1 & 0xff,
        (h1 >>> 24) & 0xff,
        (h1 >>> 16) & 0xff,
        (h2 >>> 8) & 0xff,
        h2 & 0xff,
        (h2 >>> 24) & 0xff,
        (h2 >>> 16) & 0xff,
      ].map((v) => v.toString(16).padStart(2, '0'));
    };
    const a = hashPart(0x811c9dc5, seed);
    const b = hashPart(0x84222325, `${seed}:2`);
    let hex = [...a, ...b].join('');
    hex = `${hex.slice(0, 12)}5${hex.slice(13, 16)}8${hex.slice(17)}`;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
