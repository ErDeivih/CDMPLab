// =============================================================
// EntrenoLab — GESTIÓN de cuentas y de pertenencia: reglas PURAS
//
// Aquí vive lo que la interfaz necesita para (a) no ofrecer una acción que el servidor va a
// rechazar, (b) explicar QUÉ se pierde antes de una acción destructiva y (c) decidir cuándo una
// confirmación reforzada (escribir el correo) está completa.
//
// La autorización REAL está en el servidor (RPC `leave_team`, `transfer_team_ownership`,
// `admin_delete_account` y sus guardas). Esto es solo la capa que evita mentir al usuario.
// =============================================================

import type { MemberRole } from './repositories/data-source';

/** Motivos por los que una cuenta NO se puede borrar (los devuelve el servidor). */
export type DeletionBlocker = 'self' | 'platform_admin' | 'owns_team';

/** Vista previa del borrado, tal como la devuelve `admin_deletion_preview`. */
export interface AccountDeletionPreview {
  found: boolean;
  userId: string;
  displayName: string;
  emailNormalized: string;
  status: string;
  isPlatformAdmin: boolean;
  isSelf: boolean;
  ownsTeam: boolean;
  ownedTeamName: string | null;
  ownedTeamData: { players: number; folders: number; exercises: number; sessions: number };
  activeMemberships: number;
  pendingInvitations: number;
  blockers: DeletionBlocker[];
  deletable: boolean;
}

/** Vista previa de una cuenta que ya no existe. */
export function missingDeletionPreview(userId: string): AccountDeletionPreview {
  return {
    found: false,
    userId,
    displayName: '',
    emailNormalized: '',
    status: '',
    isPlatformAdmin: false,
    isSelf: false,
    ownsTeam: false,
    ownedTeamName: null,
    ownedTeamData: { players: 0, folders: 0, exercises: 0, sessions: 0 },
    activeMemberships: 0,
    pendingInvitations: 0,
    blockers: [],
    deletable: false,
  };
}

/** Texto en español de cada bloqueo. Se usa en la pantalla, no se inventa nada. */
export function deletionBlockerMessage(blocker: DeletionBlocker): string {
  switch (blocker) {
    case 'self':
      return 'Es tu propia cuenta: nadie puede borrarse a sí mismo.';
    case 'platform_admin':
      return 'Es una cuenta de administrador de la plataforma: quítale primero ese permiso desde la base de datos.';
    case 'owns_team':
      return 'Es propietaria de un equipo. Traspasa antes la propiedad a otra persona (o vacía el equipo) para no borrar sus datos por accidente.';
    default:
      return 'No se puede borrar esta cuenta.';
  }
}

/** ¿Se puede borrar esta cuenta? (El servidor lo vuelve a comprobar de todos modos.) */
export function canDeleteAccount(preview: AccountDeletionPreview | null): boolean {
  if (!preview || !preview.found) return false;
  return preview.deletable && preview.blockers.length === 0;
}

/**
 * Confirmación REFORZADA: además del diálogo, el administrador escribe el correo de la cuenta.
 * La comparación ignora mayúsculas y espacios alrededor (el correo guardado está normalizado).
 */
export function deletionConfirmationMatches(typed: string, emailNormalized: string): boolean {
  const a = (typed ?? '').trim().toLowerCase();
  const b = (emailNormalized ?? '').trim().toLowerCase();
  return a !== '' && a === b;
}

/** Qué se va a borrar, contado. Nunca promete «recuperable»: no hay vuelta atrás. */
export function deletionSummary(preview: AccountDeletionPreview): string {
  if (!preview.found) return 'Esa cuenta ya no existe.';
  const partes: string[] = [];
  if (preview.activeMemberships > 0) {
    partes.push(
      preview.activeMemberships === 1
        ? 'dejará de ser miembro de 1 equipo'
        : `dejará de ser miembro de ${preview.activeMemberships} equipos`,
    );
  }
  if (preview.pendingInvitations > 0) {
    partes.push(`se cancelarán ${preview.pendingInvitations} invitación(es) pendiente(s) suya(s)`);
  }
  if (preview.ownsTeam) {
    const d = preview.ownedTeamData;
    partes.push(
      `es propietaria del equipo «${preview.ownedTeamName ?? ''}» (${d.players} jugadores, ${d.exercises} ejercicios, ${d.folders} carpetas, ${d.sessions} sesiones), así que NO se puede borrar todavía`,
    );
  }
  if (partes.length === 0) return 'Se borrará la cuenta y su perfil. No se puede deshacer.';
  return `Se borrará la cuenta y su perfil: ${partes.join('; ')}. No se puede deshacer.`;
}

// -------------------------------------------------------------
// Salir de un equipo
// -------------------------------------------------------------

/** ¿Puede este usuario salir por su cuenta? El propietario no: dejaría el equipo sin dueño. */
export function canLeaveTeam(role: MemberRole | undefined | null): boolean {
  return role === 'editor';
}

/** Motivo por el que no puede salir (o null si sí puede). */
export function leaveTeamBlockedReason(role: MemberRole | undefined | null): string | null {
  if (canLeaveTeam(role)) return null;
  if (role === 'owner') {
    return 'Eres el propietario: para dejar el equipo, traspasa antes la propiedad a otra persona.';
  }
  return 'No consta que seas miembro activo de este equipo.';
}

/** Qué pierde quien sale. Se muestra en la confirmación, antes de aceptar. */
export function leaveTeamConsequences(): string {
  return [
    'Perderás el acceso a los jugadores, ejercicios, pizarras y sesiones de este equipo.',
    'Tus invitaciones pendientes de este equipo se cancelarán.',
    'El propietario tendrá que volver a invitarte si quieres entrar de nuevo.',
  ].join(' ');
}

// -------------------------------------------------------------
// Traspasar la propiedad
// -------------------------------------------------------------

export interface TransferTarget {
  userId: string;
  displayName: string;
  emailNormalized: string;
  role: MemberRole;
  status: string;
}

/** ¿Puede el propietario actual traspasar el equipo a este miembro? */
export function canTransferOwnership(
  myRole: MemberRole | undefined | null,
  target: TransferTarget | null,
  myUserId: string | null,
): boolean {
  if (myRole !== 'owner' || !target) return false;
  if (target.userId === myUserId) return false; // ya soy el propietario
  // Solo a un editor ACTIVO: no se traspasa a una invitación pendiente ni a alguien revocado.
  return target.role === 'editor' && target.status === 'active';
}

/** Motivo por el que no se puede traspasar a este miembro (o null si sí se puede). */
export function transferBlockedReason(
  myRole: MemberRole | undefined | null,
  target: TransferTarget | null,
  myUserId: string | null,
): string | null {
  if (myRole !== 'owner') return 'Solo el propietario actual puede traspasar el equipo.';
  if (!target) return 'Elige a quién traspasarlo.';
  if (target.userId === myUserId) return 'Ya eres el propietario de este equipo.';
  if (target.status !== 'active') {
    return 'Solo se puede traspasar a un colaborador activo (esa persona todavía no ha aceptado).';
  }
  if (target.role !== 'editor') return 'Solo se puede traspasar a un colaborador.';
  return null;
}

/** Qué cambia al traspasar. Se muestra en la confirmación. */
export function transferConsequences(targetName: string): string {
  return [
    `${targetName} pasará a ser propietario del equipo y podrá gestionar miembros e invitaciones.`,
    'Tú pasarás a ser colaborador (editor): seguirás viendo y editando los datos, pero no podrás gestionar miembros.',
    'Solo podrás recuperar la propiedad si el nuevo propietario te la devuelve.',
  ].join(' ');
}
