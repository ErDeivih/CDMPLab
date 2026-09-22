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
import type { AccountDeletionPreview, TeamDeletionPreview } from '../team-management';

export type { AccountDeletionPreview, TeamDeletionPreview };

export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type MemberRole = 'owner' | 'editor';
export type MemberState = 'pending_approval' | 'active' | 'revoked';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
/** Estado del CORREO de la invitación (distinto del estado de la invitación). */
export type InvitationEmailStatus = 'created' | 'send_pending' | 'provider_accepted' | 'send_error';
/** Estado de una SOLICITUD de equipo (creación de equipos aprobada por el administrador). */
export type TeamRequestStatus = 'pending' | 'approved' | 'rejected';

/** Solicitud de creación de equipo, tal como la ve el solicitante o un administrador. */
export interface TeamRequestInfo {
  id: string;
  userId: string;
  /** Nombre de quien solicita (lo rellena el servidor; '' si no se pudo leer). */
  displayName: string;
  emailNormalized: string;
  /** Nombre pedido para el equipo. */
  name: string;
  accentColor: string;
  status: TeamRequestStatus;
  /** Motivo del rechazo, si lo hubo. */
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
  /** Equipo creado al aprobar (null mientras esté pendiente o rechazada). */
  createdTeamId: string | null;
}

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
  /**
   * Estado del ENVÍO por correo. NO es lo mismo que `status`: `provider_accepted`
   * significa que el proveedor ACEPTÓ el envío (no que se haya entregado), y
   * `status === 'accepted'` significa que la persona aceptó la invitación.
   */
  emailStatus: InvitationEmailStatus;
  emailAttempts: number;
  lastEmailAt: string | null;
  lastEmailError: string | null;
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
  /**
   * Solicitud de equipo del usuario (null si no ha solicitado nada nunca). Un perfil
   * aprobado SIN equipo no crea el equipo: lo SOLICITA y lo aprueba un administrador,
   * así que la pantalla necesita conocer el estado (pendiente / rechazada).
   */
  teamRequest: TeamRequestInfo | null;
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
  const message = (err as Error)?.message?.trim()
    ? (err as Error).message
    : 'Error al comunicarse con el servidor.';
  return new DataError(code, message);
}

/** Resultado de una mutación de ejercicio con concurrencia optimista. */
export interface SaveExerciseResult {
  exercise: Exercise;
  /** true si la revisión leída no coincide con la del servidor (conflicto). */
  conflict?: boolean;
  /** Revisión final en el servidor (útil para "guardar como copia"). */
  revision: number;
  /** true si el ejercicio se VOLVIÓ A CREAR porque su fila ya no existía (lo borró otra persona) y
   *  quien llama lo pidió expresamente con `recreateIfMissing` («Guardar mi copia»). */
  recreated?: boolean;
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
  // CAMBIO DE CONTRATO (22/09/2026): aquí vivía `createTeam(name, accentColor)`, que
  // llamaba a la RPC `create_my_team`. Esa RPC permitía a cualquier perfil aprobado
  // crear su equipo saltándose al administrador, así que el servidor ya NO lo permite y
  // la aplicación dejó de tener esa acción: el equipo se crea al aprobarse una SOLICITUD
  // (`requestTeamCreation` + `decideTeamRequest`, solo para administradores).
  renameTeam(teamId: string, name: string, accentColor: string): Promise<Team>;

  // ---- Solicitudes de equipo (creación aprobada por el administrador) ----
  /** Solicitud propia (o null). El servidor solo devuelve la del usuario autenticado. */
  myTeamRequest(): Promise<TeamRequestInfo | null>;
  /**
   * Presenta (o ACTUALIZA) la solicitud de equipo del usuario. Idempotente en el
   * servidor: no puede haber dos solicitudes pendientes del mismo usuario.
   */
  requestTeamCreation(name: string, accentColor: string): Promise<TeamRequestInfo>;
  /** Cola de solicitudes. El servidor exige ser administrador de plataforma. */
  listTeamRequests(search: string): Promise<TeamRequestInfo[]>;
  /**
   * Aprueba o rechaza una solicitud. Al aprobar, el SERVIDOR crea el equipo en la misma
   * transacción y devuelve su id (null si se rechazó). Idempotente.
   */
  decideTeamRequest(
    requestId: string,
    approve: boolean,
    note: string | null,
  ): Promise<string | null>;

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
  /**
   * Guarda un ejercicio con concurrencia optimista.
   *
   * `recreateIfMissing` solo lo usa «Guardar mi copia»: si la fila ya no existe (la borró otra
   * persona), el UPDATE afecta 0 filas y el conflicto se repetiría para siempre —el trabajo del
   * usuario no se podría guardar nunca—. Con la bandera se vuelve a crear con SU versión.
   */
  saveExercise(
    ex: Exercise,
    expectedRevision?: number,
    opts?: { recreateIfMissing?: boolean },
  ): Promise<SaveExerciseResult>;
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

  // ---- Pertenencia al equipo (decide el propio miembro) ----
  /**
   * El propio MIEMBRO ACTIVO sale del equipo. El propietario no puede: dejaría el equipo sin
   * dueño y sin nadie que lo gestione (para eso está `transferTeamOwnership`).
   */
  leaveTeam(teamId: string): Promise<void>;
  /**
   * El PROPIETARIO traspasa el equipo a un colaborador activo. Los dos roles y el
   * `owner_user_id` cambian en la misma transacción del servidor.
   */
  transferTeamOwnership(teamId: string, newOwnerUserId: string): Promise<void>;
  /** Qué se borraría con este equipo (y qué nombre hay que escribir). Propietario o administrador. */
  teamDeletionPreview(teamId: string): Promise<TeamDeletionPreview>;
  /**
   * BORRA el equipo y todos sus datos. Exige el nombre EXACTO en `confirmName`: la confirmación
   * reforzada la impone el servidor, no la pantalla.
   */
  deleteTeam(teamId: string, confirmName: string, reason: string | null): Promise<void>;

  // ---- Administración (plataforma) ----
  isPlatformAdmin(): Promise<boolean>;
  listProfiles(search: string): Promise<ProfileInfo[]>;
  setProfileStatus(userId: string, status: ProfileStatus): Promise<void>;
  /** Qué pasaría si se borrara esta cuenta y qué lo impide. Solo administradores. */
  accountDeletionPreview(userId: string): Promise<AccountDeletionPreview>;
  /**
   * BORRA una cuenta de verdad (perfil + usuario de Auth). Solo administradores, y con guardas
   * en el servidor: no a sí mismo, no a otro administrador, no a quien posee un equipo.
   */
  deleteAccount(userId: string, reason: string | null): Promise<void>;

  // ---- Importación local→Supabase (idempotente) ----
  importLocalData(
    teamId: string,
    data: {
      players: Player[];
      folders: ExerciseFolder[];
      exercises: Exercise[];
      sessions: Session[];
    },
  ): Promise<ImportCounts>;
}
