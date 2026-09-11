// =============================================================
// EntrenoLab — Abstracción de fuente de datos (data-source)
//
// Define el CONTRATO que el StoreService (facade reactivo) usa para leer y
// mutar. Hay (al menos) dos implementaciones:
//   · SupabaseRepository  → fuente de verdad cuando hay sesión real.
//   · LocalDataSource     → modo local (solo dev/test) sobre localStorage.
//
// El StoreService NO conoce Supabase. Conoce esta interfaz. Eso permite que
// los tests inyecten un data-source fake y verifiquen hidratación, rollback
// optimista y conflictos de revisión sin tocar el backend.
//
// Reglas de contrato:
//   · TODA lectura/mutación del equipo vuelve a estar aislada por `teamId`.
//   · Las mutaciones devuelven `Promise` y el data-source lanza un
//     `DataError` con `code` legible (para mensajes en español) cuando algo
//     falla; el StoreService aplica el rollback optimista.
//   · `dataSourceMode` dice qué fuente está en uso en cada momento.
// =============================================================

import type { Exercise, ExerciseFolder, Player, Session, SessionTask, Team } from '../models';

export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type MemberRole = 'owner' | 'editor';
export type MemberState = 'pending_approval' | 'active' | 'revoked';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** Perfil mínimo del usuario (propietario/administrativo). */
export interface ProfileInfo {
  userId: string;
  displayName: string;
  emailNormalized: string;
  status: ProfileStatus;
  approvedAt: string | null;
}

/** Fila de miembro con datos del perfil (para la pantalla de colaboradores). */
export interface TeamMemberInfo {
  userId: string;
  displayName: string;
  emailNormalized: string;
  role: MemberRole;
  status: MemberState;
  acceptedAt: string | null;
  invitedBy: string | null;
}

/** Invitación pendiente/aceptada vista por el propietario o el invitado. */
export interface TeamInvitationInfo {
  id: string;
  teamId: string;
  teamName: string;
  emailNormalized: string;
  invitedUserId: string | null;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

/** Dataset completo de UN equipo (lo que hidrata los signals del StoreService). */
export interface TeamDataset {
  team: Team | null;
  players: Player[];
  folders: ExerciseFolder[];
  exercises: Exercise[];
  sessions: Session[];
  members: TeamMemberInfo[];
  invitations: TeamInvitationInfo[];
}

/** Resultado de resolver el estado de acceso del usuario (login por estado). */
export interface AccessResolution {
  profile: ProfileInfo;
  ownedTeam: Team | null;
  /** Equipo del que es miembro ACTIVO (owner/editor), distinto del propio. */
  membership: { teamId: string; role: MemberRole } | null;
  pendingInvitations: TeamInvitationInfo[];
}

/** Error de la capa de datos con código de app y mensaje legible. */
export class DataError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}

/** Cómo mapea un error de Postgrest/repo a un DataError (facilita traducir). */
export function toDataError(err: unknown, fallbackCode = 'unknown'): DataError {
  if (err instanceof DataError) return err;
  const raw = err as { code?: string; message?: string } | { code?: string };
  const code = raw?.code ?? fallbackCode;
  const message = (err as Error)?.message?.trim() ? (err as Error).message : 'Error al comunicarse con el servidor.';
  return new DataError(code, message);
}

/** Resultado de una mutación de ejercicio con concurrencia optimista. */
export interface SaveExerciseResult {
  exercise: Exercise;
  /** true si la revisión leída no coincide con la del servidor (conflicto). */
  conflict?: boolean;
  /** Revisión final en el servidor (útil para "guardar como copia"). */
  revision: number;
}

/** Resultado de una mutación (booleano de éxito + error opcional). */
export interface MutationResult {
  ok: boolean;
  error?: DataError;
}

/** Conteos por tipo de entidad de una importación local→Supabase. */
export interface ImportTypeCounts {
  players: number;
  folders: number;
  exercises: number;
  sessions: number;
}

/**
 * Resultado exacto de una importación local→Supabase.
 * · `created`: entidades creadas nuevas (con id determinista).
 * · `skipped`: entidades ya existentes (import previo) que no se duplicaron.
 * · `errors`: entidades que NO se pudieron crear (referencia rota, fallo). Ninguna
 *   se omite en silencio: cada fallo queda contabilizado aquí.
 */
export interface ImportCounts {
  created: ImportTypeCounts;
  skipped: ImportTypeCounts;
  errors: ImportTypeCounts;
}

/**
 * El contrato de fuente de datos. `teamId` deja claro que NADA se lee/escribe
 * globalmente: siempre hay un equipo de contexto.
 */
export interface DataSource {
  /** Modo actual: 'supabase' (real) o 'local' (solo dev/test). */
  readonly dataSourceMode: 'supabase' | 'local';
  /** id del usuario de contexto (para aislar claves/permisos). */
  readonly userId: string | null;
  /** id del equipo de contexto (ninguna operación lo salta). */
  readonly teamId: string | null;

  // ---- Resolución de acceso ----
  resolveAccess(): Promise<AccessResolution>;

  // ---- Lectura (hidratación de UN equipo) ----
  loadTeam(teamId: string): Promise<TeamDataset>;

  // ---- Teams ----
  createTeam(name: string, accentColor: string): Promise<Team>;
  renameTeam(teamId: string, name: string, accentColor: string): Promise<Team>;

  // ---- Jugadores ----
  addPlayer(input: Omit<Player, 'id' | 'teamId' | 'active' | 'createdAt'>): Promise<Player>;
  updatePlayer(id: string, patch: Partial<Player>): Promise<Player>;
  removePlayer(id: string): Promise<void>;

  // ---- Carpetas ----
  createFolder(teamId: string, name: string, parentId: string | null): Promise<ExerciseFolder>;
  renameFolder(id: string, name: string): Promise<ExerciseFolder>;
  deleteFolder(id: string): Promise<void>;
  duplicateFolderTree(id: string): Promise<void>;
  moveExerciseToFolder(exerciseId: string, folderId: string | null): Promise<void>;
  moveExercisesToFolder(ids: string[], folderId: string | null): Promise<void>;

  // ---- Ejercicios ----
  saveExercise(ex: Exercise, expectedRevision?: number): Promise<SaveExerciseResult>;
  deleteExercise(id: string): Promise<void>;
  duplicateExercise(id: string): Promise<Exercise>;

  // ---- Sesiones ----
  saveSession(session: Session): Promise<Session>;
  deleteSession(id: string): Promise<void>;

  // ---- Colaboradores / invitaciones ----
  listMembers(teamId: string): Promise<TeamMemberInfo[]>;
  listTeamInvitations(teamId: string): Promise<TeamInvitationInfo[]>;
  inviteMember(teamId: string, email: string): Promise<TeamInvitationInfo>;
  cancelInvitation(invitationId: string): Promise<void>;
  /** El INVITADO rechaza su propia invitación (no es el propietario del equipo). */
  declineInvitation(invitationId: string): Promise<void>;
  revokeMember(teamId: string, userId: string): Promise<void>;
  myPendingInvitations(): Promise<TeamInvitationInfo[]>;
  acceptInvitation(invitationId: string): Promise<string>;

  // ---- Administración (plataforma) ----
  isPlatformAdmin(): Promise<boolean>;
  listProfiles(search: string): Promise<ProfileInfo[]>;
  setProfileStatus(userId: string, status: ProfileStatus): Promise<void>;

  // ---- Importación local→Supabase (idempotente) ----
  importLocalData(teamId: string, data: {
    players: Player[];
    folders: ExerciseFolder[];
    exercises: Exercise[];
    sessions: Session[];
  }): Promise<ImportCounts>;
}


