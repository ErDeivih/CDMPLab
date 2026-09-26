import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AccessService } from './access.service';
import { StoreService } from './store.service';
import { SupabaseService } from './supabase.service';
import type { TeamInvitationInfo } from './repositories/data-source';
import { SupabaseRepository } from './repositories/supabase-data-source';

describe('AccessService invitations', () => {
  it('al aceptar selecciona el equipo invitado aunque ya hubiera otro activo', async () => {
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: SupabaseService, useValue: {} },
        { provide: StoreService, useValue: {} },
      ],
    });
    const service = TestBed.inject(AccessService);
    const internal = service as unknown as {
      _repo: { acceptInvitation: (id: string) => Promise<string> };
      selectedTeamId: string;
    };
    internal.selectedTeamId = 'previous';
    internal._repo = { acceptInvitation: vi.fn().mockResolvedValue('invited') };
    const refresh = vi.spyOn(service, 'refreshAfterMembershipChange').mockResolvedValue(undefined);
    await service.acceptInvitation('invitation');
    expect(internal.selectedTeamId).toBe('invited');
    expect(refresh).toHaveBeenCalledOnce();
  });

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
  it('bloquea cambios con escrituras pendientes y rechaza un equipo no autorizado', async () => {
    let pending = 1;
    const store = {
      pendingWrites: () => pending,
      lastError: () => null,
      connectDataSource: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: StoreService, useValue: store },
        {
          provide: SupabaseService,
          useValue: { getClient: async () => ({}), user: () => ({ id: 'member' }) },
        },
      ],
    });
    const service = TestBed.inject(AccessService);
    await expect(service.openTeam('unknown')).rejects.toThrow('Espera');
    pending = 0;
    const lookup = vi.spyOn(SupabaseRepository.prototype, 'listTeamAccess').mockResolvedValue([]);
    try {
      await expect(service.openTeam('unknown')).rejects.toThrow('no está disponible');
      expect(store.connectDataSource).not.toHaveBeenCalled();
      expect(service.switchingTeam()).toBe(false);
    } finally {
      lookup.mockRestore();
    }
  });

  it('una respuesta tardía tras cerrar sesión no puede cargar el equipo', async () => {
    let finish!: (value: Awaited<ReturnType<SupabaseRepository['listTeamAccess']>>) => void;
    const delayed = new Promise<Awaited<ReturnType<SupabaseRepository['listTeamAccess']>>>(
      (resolve) => {
        finish = resolve;
      },
    );
    const store = {
      pendingWrites: () => 0,
      lastError: () => null,
      resetToLocal: vi.fn(),
      connectDataSource: vi.fn(async (_repo: unknown, _id: string, canApply: () => boolean) => {
        if (!canApply()) throw new Error('La sesión ha cambiado');
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        AccessService,
        { provide: StoreService, useValue: store },
        {
          provide: SupabaseService,
          useValue: { getClient: async () => ({}), user: () => ({ id: 'member' }) },
        },
      ],
    });
    const service = TestBed.inject(AccessService);
    const lookup = vi
      .spyOn(SupabaseRepository.prototype, 'listTeamAccess')
      .mockReturnValue(delayed);
    try {
      const switching = service.openTeam('t1');
      await Promise.resolve();
      await service.clear();
      finish([{ id: 't1', role: 'owner', name: 'Old', accentColor: '#123456', createdAt: 'x' }]);
      await expect(switching).rejects.toThrow('sesión ha cambiado');
      expect(service.target().state).toBe('unauthenticated');
    } finally {
      lookup.mockRestore();
    }
  });

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
    // La fuente autorizada incluye el rol de copropietario, no el único owner_user_id legado.
    const overview = vi.spyOn(SupabaseRepository.prototype, 'listTeamAccess').mockResolvedValue([
      {
        id: 'own',
        role: 'owner',
        name: 'Propio',
        accentColor: '#c8102e',
        createdAt: '2026-01-01',
      },
      {
        id: 'other',
        role: 'editor',
        name: 'Otro',
        accentColor: '#3056d3',
        createdAt: '2026-01-01',
      },
    ]);
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
