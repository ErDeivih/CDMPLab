import { describe, expect, it } from 'vitest';
import { decideAccess } from './access';
import type { AccessResolution } from './repositories/data-source';

function res(overrides: Partial<AccessResolution>): AccessResolution {
  return {
    profile: { userId: 'u1', displayName: 'Ana', emailNormalized: 'a@b.c', status: 'approved', approvedAt: null },
    ownedTeam: null,
    membership: null,
    pendingInvitations: [],
    ...overrides,
  } as AccessResolution;
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
    const target = decideAccess(res({ ownedTeam: { id: 't1', name: 'A', accentColor: '#111', createdAt: 'x' } }));
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
      res({ pendingInvitations: [{ id: 'i1', teamId: 't3', teamName: 'B', emailNormalized: 'a@b.c', invitedUserId: 'u1', status: 'pending', expiresAt: 'x', createdAt: 'y' }] })
    );
    expect(target.state).toBe('accept-invitation');
    expect(target.route).toBe('/invitations');
  });

  it('aprobado sin equipo ni invitaciones → create-team', () => {
    const target = decideAccess(res({}));
    expect(target.state).toBe('create-team');
    expect(target.route).toBe('/onboarding/team');
  });
});
