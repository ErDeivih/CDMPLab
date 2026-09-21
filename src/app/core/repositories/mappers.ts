// =============================================================
// EntrenoLab — Mapeadores fila DB ↔ modelo de dominio
//
// Traducen las filas snake_case de Supabase a los modelos camelCase que
// consumen las pantallas (models.ts) y viceversa. NINGUNA mutación ni lectura
// de datos debe mapear columnas a mano fuera de este módulo.
// =============================================================

import type {
  ExercisesRow,
  ExerciseFoldersRow,
  PlayersRow,
  SessionsRow,
  TeamInvitationsRow,
  TeamsRow,
} from '../database.types';
import type { ProfileStatus, TeamInvitationInfo } from './data-source';
import type {
  CanvasDocument,
  Exercise,
  ExerciseFolder,
  Player,
  Session,
  SessionTask,
  Team,
} from '../models';

// ---------- Team ----------

export function teamFromRow(row: TeamsRow): Team {
  return {
    id: row.id,
    name: row.name,
    accentColor: row.accent_color,
    createdAt: row.created_at,
  };
}

// ---------- TeamInvitation ----------

/**
 * Fila de `team_invitations` → `TeamInvitationInfo`.
 *
 * Las columnas del CORREO (`email_*`) pueden faltar en una base donde la migración
 * 20260922000000 todavía no se ha aplicado: en ese caso se devuelve `created`, que es
 * exactamente lo que significa (invitación creada, sin intento de envío registrado).
 * Inventar otro estado sería mentir sobre el envío.
 */
export function invitationFromRow(row: TeamInvitationsRow, teamName: string): TeamInvitationInfo {
  const raw = row as TeamInvitationsRow & {
    email_status?: string | null;
    email_attempts?: number | null;
    last_email_at?: string | null;
    last_email_error?: string | null;
  };
  const estados = ['created', 'send_pending', 'provider_accepted', 'send_error'];
  const status =
    raw.email_status && estados.includes(raw.email_status) ? raw.email_status : 'created';
  return {
    id: row.id,
    teamId: row.team_id,
    teamName,
    emailNormalized: row.email_normalized,
    invitedUserId: row.invited_user_id,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    emailStatus: status as TeamInvitationInfo['emailStatus'],
    emailAttempts: raw.email_attempts ?? 0,
    lastEmailAt: raw.last_email_at ?? null,
    lastEmailError: raw.last_email_error ?? null,
  };
}

// ---------- Player ----------

export function playerFromRow(row: PlayersRow): Player {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    number: row.number,
    position: row.position as Player['position'],
    color: row.color,
    active: row.active,
    createdAt: row.created_at,
  };
}

// ---------- ExerciseFolder ----------

export function folderFromRow(row: ExerciseFoldersRow): ExerciseFolder {
  return {
    id: row.id,
    teamId: row.team_id,
    parentId: row.parent_id,
    name: row.name,
  };
}

// ---------- Exercise ----------

/** Los datos de canvas vienen como JSON (canvas_data). En v1 era array plano;
 *  en v2 es objeto con `frames`. Lo pasamos tal cual; `normalizeCanvas` se
 *  encarga de hacerlo retrocompatible al abrir. */
export function exerciseFromRow(row: ExercisesRow): Exercise {
  return {
    id: row.id,
    teamId: row.team_id,
    folderId: row.folder_id,
    title: row.title,
    description: row.description,
    explanation: row.explanation,
    category: row.category as Exercise['category'],
    objectives: row.objectives ?? [],
    materials: row.materials ?? [],
    durationMinutes: row.duration_minutes,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    loadMode: row.load_mode ?? 'fixed',
    seriesCount: row.series_count,
    repetitionsCount: row.repetitions_count,
    workSeconds: row.work_seconds,
    restSeconds: row.rest_seconds,
    isTemplate: row.is_template ?? false,
    canvas: (row.canvas_data as CanvasDocument | null) ?? null,
    thumbnail: row.thumbnail,
    savedAt: row.updated_at,
    revision: row.revision,
  };
}

export function exerciseRowForInsert(
  ex: Exercise,
): Omit<ExercisesRow, 'created_at' | 'updated_at' | 'revision'> {
  return {
    id: ex.id,
    team_id: ex.teamId,
    folder_id: ex.folderId,
    title: ex.title,
    description: ex.description,
    explanation: ex.explanation,
    category: ex.category,
    objectives: ex.objectives ?? [],
    materials: ex.materials ?? [],
    duration_minutes: ex.durationMinutes,
    min_players: ex.minPlayers,
    max_players: ex.maxPlayers,
    load_mode: ex.loadMode,
    series_count: ex.seriesCount,
    repetitions_count: ex.repetitionsCount,
    work_seconds: ex.workSeconds,
    rest_seconds: ex.restSeconds,
    is_template: ex.isTemplate,
    canvas_data: (ex.canvas as unknown as import('../database.types').Json) ?? null,
    thumbnail: ex.thumbnail,
  };
}

// ---------- Session ----------

export function sessionFromRow(row: SessionsRow, tasks: SessionTask[]): Session {
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    date: row.date ?? '',
    durationMinutes: row.duration_minutes,
    notes: row.notes,
    tasks,
    createdAt: row.created_at,
    savedAt: row.updated_at,
    revision: row.revision,
  };
}

// ---------- Profile (admin / propietario) ----------

export function profileStatusFromRow(row: { status: string }): ProfileStatus {
  switch (row.status) {
    case 'approved':
    case 'rejected':
    case 'suspended':
      return row.status;
    default:
      return 'pending';
  }
}
