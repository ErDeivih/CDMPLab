import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AccessService } from './access.service';
import { StoreService } from './store.service';
import { SupabaseService } from './supabase.service';
import type { TeamInvitationInfo } from './repositories/data-source';
import { SupabaseRepository } from './repositories/supabase-data-source';

describe('AccessService invitations', () => {
  it('permite consultar invitaciones antes de pertenecer a un equipo', async () => {
    const invitation: TeamInvitationInfo = {
      id: 'inv-1',
      teamId: 'team-1',
      teamName: 'Primer equipo',
      emailNormalized: 'invitado@example.com',
      invitedUserId: 'user-1',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      // Columnas del estado del CORREO (migración 20260922000000): una invitación nace
      // sin intento de envío, así que el estado es 'created'.
      emailStatus: 'created',
      emailAttempts: 0,
      lastEmailAt: null,
      lastEmailError: null,
    };
    const repo = {
      teamId: null,
      myPendingInvitations: vi.fn().mockResolvedValue([invitation]),
    };

    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: {} },
        { provide: StoreService, useValue: {} },
      ],
    });
    const service = TestBed.inject(AccessService);
    (service as unknown as { _repo: typeof repo })._repo = repo;

    await expect(service.listInvitations()).resolves.toEqual([invitation]);
    expect(repo.myPendingInvitations).toHaveBeenCalledOnce();
  });

  it('borra un permiso de admin en memoria si falla la recomprobación al servidor', async () => {
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: {} },
        { provide: StoreService, useValue: {} },
      ],
    });
    const service = TestBed.inject(AccessService);
    const repo = { teamId: null, isPlatformAdmin: vi.fn().mockRejectedValue(new Error('offline')) };
    const state = service as unknown as {
      _repo: typeof repo;
      _platformAdmin: { set(value: boolean): void };
    };
    state._repo = repo;
    state._platformAdmin.set(true);

    await expect(service.checkIsPlatformAdmin()).resolves.toBe(false);
    expect(service.platformAdmin()).toBe(false);
  });
});

describe('AccessService — navegación del administrador entre equipos', () => {
  it('conserva el rol propietario al abrir su propio equipo y editor en otro', async () => {
    const store = {
      pendingWrites: () => 0,
      lastError: () => null,
      connectDataSource: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        {
          provide: SupabaseService,
          useValue: { getClient: vi.fn().mockResolvedValue({}), user: () => ({ id: 'admin' }) },
        },
        { provide: StoreService, useValue: store },
      ],
    });
    const service = TestBed.inject(AccessService);
    vi.spyOn(service, 'checkIsPlatformAdmin').mockResolvedValue(true);
    const state = service as unknown as { _resolution: { set(value: unknown): void } };
    state._resolution.set({
      profile: {
        userId: 'admin',
        displayName: 'Admin',
        emailNormalized: 'admin@example.com',
        status: 'approved',
        approvedAt: null,
      },
      ownedTeam: null,
      membership: null,
      pendingInvitations: [],
      teamRequest: null,
    });
    const overview = vi.spyOn(SupabaseRepository.prototype, 'adminTeamOverview').mockResolvedValue([
      {
        teamId: 'own',
        ownerUserId: 'admin',
        name: 'Propio',
        accentColor: '#c8102e',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        teamId: 'other',
        ownerUserId: 'someone',
        name: 'Otro',
        accentColor: '#3056d3',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ] as Awaited<ReturnType<SupabaseRepository['adminTeamOverview']>>);
    try {
      await service.openAdminTeam('own');
      expect(service.target()).toMatchObject({ state: 'ready', teamId: 'own', role: 'owner' });
      await service.openAdminTeam('other');
      expect(service.target()).toMatchObject({ state: 'ready', teamId: 'other', role: 'editor' });
      await service.openAdminTeam('own');
      expect(service.target()).toMatchObject({ state: 'ready', teamId: 'own', role: 'owner' });
    } finally {
      overview.mockRestore();
    }
  });
});
