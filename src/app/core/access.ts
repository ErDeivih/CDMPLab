// =============================================================
// EntrenoLab — Lógica pura de "login por estado" / acceso
//
// Decide, a partir del perfil + pertenencia a equipo + invitaciones, a qué
// pantalla debe ir el usuario tras iniciar sesión. Es una función PURA (sin
// efectos) para que sea fácilmente comprobable en unit tests.
// =============================================================

import type { AccessResolution, MemberRole } from './repositories/data-source';

export type AccessState =
  | 'resolving'
  | 'unauthenticated'
  | 'disabled'
  | 'pending'
  | 'rejected'
  | 'suspended'
  /**
   * Aprobado sin equipo y sin solicitud pendiente. CAMBIO DE CONTRATO (22/09/2026): antes
   * este estado se llamaba `create-team` y la pantalla CREABA el equipo; ahora la cuenta
   * presenta una SOLICITUD y es un administrador de plataforma quien la aprueba.
   * Este estado también cubre la solicitud RECHAZADA (se puede volver a solicitar).
   */
  | 'request-team'
  /** Aprobado sin equipo con una solicitud PENDIENTE de aprobación. */
  | 'request-pending'
  | 'accept-invitation'
  | 'ready';

export interface AccessTarget {
  state: AccessState;
  /** Equipo a entrar (solo en `ready`). */
  teamId?: string;
  /** Rol en el equipo a entrar (solo en `ready`). */
  role?: MemberRole;
  /** Ruta a la que redirigir. */
  route: string;
}

/**
 * Decide la ruta de destino según el estado del perfil y su pertenencia.
 * El caso `approved + sin equipo + con invitaciones pendientes` dirige a
 * "aceptar invitación"; si no hay invitaciones, a SOLICITAR el equipo (o a ver el
 * estado de la solicitud ya presentada). La cuenta aprobada NO crea el equipo: solo
 * un administrador de plataforma puede aprobar la solicitud (lo hace el servidor).
 */
export function decideAccess(res: AccessResolution | null): AccessTarget {
  if (!res) return { state: 'unauthenticated', route: '/auth/login' };
  const { profile, ownedTeam, membership, pendingInvitations, teamRequest } = res;

  if (profile.status === 'pending') return { state: 'pending', route: '/pending-approval' };
  if (profile.status === 'rejected') return { state: 'rejected', route: '/access-rejected' };
  if (profile.status === 'suspended') return { state: 'suspended', route: '/access-suspended' };

  // approved
  if (ownedTeam) return { state: 'ready', teamId: ownedTeam.id, role: 'owner', route: '/team' };
  if (membership)
    return { state: 'ready', teamId: membership.teamId, role: membership.role, route: '/team' };
  // Una invitación pendiente se puede aceptar sin esperar a nadie: tiene prioridad.
  if (pendingInvitations.length > 0) return { state: 'accept-invitation', route: '/invitations' };
  // Sin equipo y sin invitaciones: solicitud de equipo. Misma pantalla en los dos casos
  // (formulario o estado), pero estados distintos para que las pruebas y la interfaz no
  // confundan «puede solicitar» con «ya ha solicitado y espera».
  if (teamRequest?.status === 'pending')
    return { state: 'request-pending', route: '/onboarding/team' };
  return { state: 'request-team', route: '/onboarding/team' };
}
