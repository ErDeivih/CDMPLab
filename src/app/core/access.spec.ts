import { describe, expect, it } from 'vitest';
import { decideAccess } from './access';
import type { AccessResolution, TeamRequestInfo } from './repositories/data-source';

function res(overrides: Partial<AccessResolution>): AccessResolution {
  return {
    profile: {
      userId: 'u1',
      displayName: 'Ana',
      emailNormalized: 'a@b.c',
      status: 'approved',
      approvedAt: null,
    },
    ownedTeam: null,
    membership: null,
    pendingInvitations: [],
    teamRequest: null,
    ...overrides,
  } as AccessResolution;
}

function solicitud(overrides: Partial<TeamRequestInfo> = {}): TeamRequestInfo {
  return {
    id: 'req1',
    userId: 'u1',
    displayName: 'Ana',
    emailNormalized: 'a@b.c',
    name: 'Primer Equipo',
    accentColor: '#3056d3',
    status: 'pending',
    note: null,
    requestedAt: '2026-09-22T10:00:00.000Z',
    decidedAt: null,
    createdTeamId: null,
    ...overrides,
  };
}

describe('decideAccess (login por estado)', () => {
  it('sin resolución → unauthenticated', () => {
    expect(decideAccess(null).route).toBe('/auth/login');
  });

  it('perfil pending → /pending-approval', () => {
    const target = decideAccess(res({ profile: { ...res({}).profile, status: 'pending' } }));
    expect(target.state).toBe('pending');
    expect(target.route).toBe('/pending-approval');
  });

  it('perfil rejected → /access-rejected', () => {
    const target = decideAccess(res({ profile: { ...res({}).profile, status: 'rejected' } }));
    expect(target.state).toBe('rejected');
    expect(target.route).toBe('/access-rejected');
  });

  it('perfil suspended → /access-suspended', () => {
    const target = decideAccess(res({ profile: { ...res({}).profile, status: 'suspended' } }));
    expect(target.state).toBe('suspended');
    expect(target.route).toBe('/access-suspended');
  });

  it('aprobado con equipo propio → ready (owner)', () => {
    const target = decideAccess(
      res({ ownedTeam: { id: 't1', name: 'A', accentColor: '#111', createdAt: 'x' } }),
    );
    expect(target.state).toBe('ready');
    expect(target.teamId).toBe('t1');
    expect(target.role).toBe('owner');
  });

  it('aprobado como editor de otro equipo → ready (editor)', () => {
    const target = decideAccess(res({ membership: { teamId: 't2', role: 'editor' } }));
    expect(target.state).toBe('ready');
    expect(target.teamId).toBe('t2');
    expect(target.role).toBe('editor');
  });

  it('aprobado sin equipo y con invitaciones → accept-invitation', () => {
    const target = decideAccess(
      res({
        pendingInvitations: [
          {
            id: 'i1',
            teamId: 't3',
            teamName: 'B',
            emailNormalized: 'a@b.c',
            invitedUserId: 'u1',
            status: 'pending',
            expiresAt: 'x',
            createdAt: 'y',
            emailStatus: 'created',
            emailAttempts: 0,
            lastEmailAt: null,
            lastEmailError: null,
          },
        ],
      }),
    );
    expect(target.state).toBe('accept-invitation');
    expect(target.route).toBe('/invitations');
  });

  it('aprobado sin equipo ni invitaciones → request-team (solicita, no crea)', () => {
    const target = decideAccess(res({}));
    // CAMBIO DE CONTRATO (22/09/2026): el estado se llamaba 'create-team' y la pantalla
    // CREABA el equipo llamando a `create_my_team`. El servidor ya no lo permite: la cuenta
    // presenta una SOLICITUD y la aprueba un administrador de plataforma, que es quien
    // provoca la creación real. La ruta no cambia (/onboarding/team), el contrato sí.
    expect(target.state).toBe('request-team');
    expect(target.route).toBe('/onboarding/team');
  });

  it('solicitud PENDIENTE → request-pending (misma pantalla, estado distinto)', () => {
    const target = decideAccess(res({ teamRequest: solicitud({ status: 'pending' }) }));
    expect(target.state).toBe('request-pending');
    expect(target.route).toBe('/onboarding/team');
  });

  it('solicitud RECHAZADA → request-team (puede volver a solicitarla)', () => {
    const target = decideAccess(
      res({
        teamRequest: solicitud({ status: 'rejected', note: 'Falta documentación', decidedAt: 'z' }),
      }),
    );
    expect(target.state).toBe('request-team');
    expect(target.route).toBe('/onboarding/team');
  });

  it('solicitud APROBADA sin equipo cargado → sigue siendo request-team (no inventa equipo)', () => {
    // Caso defensivo: si el equipo se creó pero la lectura no lo trajo, la pantalla muestra
    // el estado real de la solicitud en vez de afirmar que hay equipo.
    const target = decideAccess(
      res({ teamRequest: solicitud({ status: 'approved', createdTeamId: 't9' }) }),
    );
    expect(target.state).toBe('request-team');
    expect(target.route).toBe('/onboarding/team');
  });

  it('la invitación pendiente manda sobre la solicitud (se puede aceptar sin esperar)', () => {
    const target = decideAccess(
      res({
        teamRequest: solicitud({ status: 'pending' }),
        pendingInvitations: [
          {
            id: 'i1',
            teamId: 't3',
            teamName: 'B',
            emailNormalized: 'a@b.c',
            invitedUserId: 'u1',
            status: 'pending',
            expiresAt: 'x',
            createdAt: 'y',
            emailStatus: 'created',
            emailAttempts: 0,
            lastEmailAt: null,
            lastEmailError: null,
          },
        ],
      }),
    );
    expect(target.state).toBe('accept-invitation');
    expect(target.route).toBe('/invitations');
  });
});
