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
  | 'create-team'
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
 * "aceptar invitación" (con opción de crear equipo); si no hay invitaciones,
 * a crear el equipo.
 */
export function decideAccess(res: AccessResolution | null): AccessTarget {
  if (!res) return { state: 'unauthenticated', route: '/auth/login' };
  const { profile, ownedTeam, membership, pendingInvitations } = res;

  if (profile.status === 'pending') return { state: 'pending', route: '/pending-approval' };
  if (profile.status === 'rejected') return { state: 'rejected', route: '/access-rejected' };
  if (profile.status === 'suspended') return { state: 'suspended', route: '/access-suspended' };

  // approved
  if (ownedTeam) return { state: 'ready', teamId: ownedTeam.id, role: 'owner', route: '/team' };
  if (membership) return { state: 'ready', teamId: membership.teamId, role: membership.role, route: '/team' };
  if (pendingInvitations.length > 0) return { state: 'accept-invitation', route: '/invitations' };
  return { state: 'create-team', route: '/onboarding/team' };
}
