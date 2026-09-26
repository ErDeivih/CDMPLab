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
      return 'Es tu propia cuenta: utiliza la opción de eliminar tu cuenta, no la de borrar otra persona.';
    case 'platform_admin':
      return 'Los administradores no pueden eliminarse entre sí. Cada administrador gestiona la baja de su propia cuenta.';
    case 'owns_team':
      return 'Es la última propietaria aprobada de algún equipo. Nombra otro propietario antes de borrar la cuenta; los datos del equipo se conservarán.';
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
    partes.push(
      `es la última propietaria aprobada en «${preview.ownedTeamName ?? ''}», así que NO se puede borrar todavía`,
    );
  }
  if (partes.length === 0) return 'Se borrará la cuenta y su perfil. No se puede deshacer.';
  return `Se borrará la cuenta y su perfil: ${partes.join('; ')}. No se puede deshacer.`;
}

// -------------------------------------------------------------
// Salir de un equipo
// -------------------------------------------------------------

/** ¿Puede este usuario salir por su cuenta? El propietario no: dejaría el equipo sin dueño. */
export function canLeaveTeam(role: MemberRole | undefined | null, owners = 1): boolean {
  return role === 'editor' || (role === 'owner' && owners > 1);
}

/** Motivo por el que no puede salir (o null si sí puede). */
export function leaveTeamBlockedReason(
  role: MemberRole | undefined | null,
  owners = 1,
): string | null {
  if (canLeaveTeam(role, owners)) return null;
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

// -------------------------------------------------------------
// Baja del PROPIO administrador (permiso de plataforma)
// -------------------------------------------------------------

/**
 * Qué implica darse de baja como administrador. El servidor comprueba, en este orden: ser
 * administrador, que quede OTRO administrador, que el correo escrito sea el exacto y no ser
 * propietario de ningún equipo. Se cuenta ANTES para que nadie escriba su correo y descubra
 * después que la baja no era posible (o al revés: que era irreversible).
 */
export function adminSelfDeletionConsequences(): string {
  return [
    'Tu cuenta y tu perfil se eliminan definitivamente: no se puede deshacer.',
    'La plataforma tiene que seguir teniendo otra persona administradora: si eres la única, el servidor rechazará la baja.',
    'Antes tienes que traspasar o eliminar los equipos de los que seas propietario; los equipos que solo administras siguen existiendo con sus datos.',
    'La baja queda registrada en el listado de bajas (quién y cuándo) sin datos personales de más.',
  ].join(' ');
}

// -------------------------------------------------------------
// Eliminar un equipo
// -------------------------------------------------------------

/** Vista previa del borrado de un equipo, tal como la devuelve `team_deletion_preview`. */
export interface TeamDeletionPreview {
  found: boolean;
  teamId: string;
  name: string;
  accentColor: string;
  ownerUserId: string;
  ownerEmail: string;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  /** El servidor autoriza a borrarlo (propietario o administrador de plataforma). */
  canDelete: boolean;
  /** Nombre EXACTO que hay que escribir: lo impone el servidor, no la pantalla. */
  confirmNameRequired: string;
  data: {
    players: number;
    folders: number;
    exercises: number;
    sessions: number;
    members: number;
    pendingInvitations: number;
  };
}

/** Vista previa de un equipo que ya no existe. */
export function missingTeamDeletionPreview(teamId: string): TeamDeletionPreview {
  return {
    found: false,
    teamId,
    name: '',
    accentColor: '',
    ownerUserId: '',
    ownerEmail: '',
    isOwner: false,
    isPlatformAdmin: false,
    canDelete: false,
    confirmNameRequired: '',
    data: { players: 0, folders: 0, exercises: 0, sessions: 0, members: 0, pendingInvitations: 0 },
  };
}

/** ¿Se puede borrar este equipo? (El servidor lo vuelve a comprobar de todos modos.) */
export function canDeleteTeam(preview: TeamDeletionPreview | null): boolean {
  return !!preview && preview.found && preview.canDelete;
}

/**
 * Confirmación REFORZADA, igual que en las bajas de cuenta: hay que escribir el nombre EXACTO
 * del equipo. Se ignoran mayúsculas y espacios de los extremos; el nombre NO se normaliza en la
 * base, así que la comparación es contra el nombre real (sin acentos ni mayúsculas forzadas).
 */
export function teamDeletionConfirmMatches(typed: string, teamName: string): boolean {
  const a = (typed ?? '').trim().toLowerCase();
  const b = (teamName ?? '').trim().toLowerCase();
  return a !== '' && a === b;
}

/** Qué se va a borrar, contado. Nunca promete recuperación. */
export function teamDeletionSummary(preview: TeamDeletionPreview): string {
  if (!preview.found) return 'Ese equipo ya no existe.';
  const d = preview.data;
  const partes = [
    `${d.players} jugador(es)`,
    `${d.exercises} ejercicio(s)`,
    `${d.folders} carpeta(s)`,
    `${d.sessions} sesión(es)`,
    `${d.members} cuenta(s) en el equipo`,
  ];
  if (d.pendingInvitations > 0) partes.push(`${d.pendingInvitations} invitación(es) pendiente(s)`);
  return `Se borrará el equipo «${preview.name}» y TODO lo suyo: ${partes.join(', ')}. No se puede deshacer.`;
}

/** Consecuencias para las personas y para quien borra el equipo. */
export function teamDeletionConsequences(): string {
  return [
    'Los colaboradores perderán el acceso a este equipo (su cuenta seguirá existiendo).',
    'Tú dejarás de tener equipo: podrás solicitar otro o pedir al administrador que borre tu cuenta.',
  ].join(' ');
}
