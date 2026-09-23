import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseService } from './supabase.service';
import { AuthGuard, ApprovedGuard, AdminGuard, FORCE_LOCAL_MODE } from './auth.guard';
import { AccessService } from './access.service';
import type { AccessTarget } from './access';

function mockSupabase(status: 'authenticated' | 'unauthenticated' | 'disabled'): SupabaseService {
  return {
    ensureResolved: vi.fn().mockResolvedValue(undefined),
    status: () => status,
    user: () => (status === 'authenticated' ? { id: 'u1', email: 'a@b.c' } : null),
    isDevelopment: () => false,
    fetchProfile: vi.fn().mockResolvedValue(null),
  } as unknown as SupabaseService;
}

function mockAccess(overrides?: Partial<AccessTarget>): AccessService {
  const target: AccessTarget = {
    state: 'ready',
    teamId: 't1',
    role: 'owner',
    route: '/team',
    ...overrides,
  };
  return {
    target: () => target,
    isReady: () => target.state === 'ready',
    resolve: vi.fn().mockResolvedValue(target),
    checkIsPlatformAdmin: vi.fn().mockResolvedValue(false),
  } as unknown as AccessService;
}

function setup(
  supabase: SupabaseService,
  access: AccessService,
  localMode = false,
): { router: Router; supabase: SupabaseService; access: AccessService } {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SupabaseService, useValue: supabase },
      { provide: AccessService, useValue: access },
      { provide: FORCE_LOCAL_MODE, useValue: localMode },
    ],
  });
  return {
    router: TestBed.inject(Router),
    supabase: TestBed.inject(SupabaseService),
    access: TestBed.inject(AccessService),
  };
}

describe('AuthGuard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('permite entrar cuando hay sesión', async () => {
    setup(mockSupabase('authenticated'), mockAccess());
    const guard = TestBed.inject(AuthGuard);
    expect(await guard.canActivate()).toBe(true);
  });

  it('permite entrar con auth desactivada EN DESARROLLO (modo local)', async () => {
    const { supabase, access } = setup(mockSupabase('disabled'), mockAccess(), true);
    // El modo local no debe depender de sesión.
    expect(await TestBed.inject(AuthGuard).canActivate()).toBe(true);
    expect(supabase).toBeTruthy();
    expect(access).toBeTruthy();
  });

  it('NO deja pasar con auth desactivada EN PRODUCCIÓN (nunca acceso sin Supabase)', async () => {
    setup(mockSupabase('disabled'), mockAccess(), false);
    const guard = TestBed.inject(AuthGuard);
    const res = await guard.canActivate();
    expect(res).toBeInstanceOf(UrlTree);
    expect((res as UrlTree).toString()).toBe('/auth/login');
  });

  it('redirige a /auth/login cuando no hay sesión', async () => {
    const router = setup(mockSupabase('unauthenticated'), mockAccess()).router;
    const guard = TestBed.inject(AuthGuard);
    const res = await guard.canActivate();
    expect(res).toBeInstanceOf(UrlTree);
    expect((res as UrlTree).toString()).toBe('/auth/login');
    expect(router).toBeTruthy();
  });

  // CONTRATO NUEVO (23/09/2026): el login conserva A DÓNDE iba el usuario. El enlace del correo de
  // invitación es `/invitations?invitation=<uuid>`; sin esto, quien no tenía sesión perdía el
  // destino al pasar por el login y su invitación quedaba invisible.
  it('conserva el destino en `?returnUrl=` al mandar al login', async () => {
    setup(mockSupabase('unauthenticated'), mockAccess());
    const guard = TestBed.inject(AuthGuard);
    const res = await guard.canActivate(undefined, {
      url: '/invitations?invitation=abc',
    } as unknown as RouterStateSnapshot);
    expect((res as UrlTree).toString()).toBe(
      '/auth/login?returnUrl=%2Finvitations%3Finvitation%3Dabc',
    );
  });

  it('NO deja que el login sea un redirector abierto (nada de URL absolutas ni //host)', async () => {
    setup(mockSupabase('unauthenticated'), mockAccess());
    const guard = TestBed.inject(AuthGuard);
    for (const url of ['https://mal.example/x', '//mal.example/x', '/auth/register']) {
      const res = await guard.canActivate(undefined, { url } as unknown as RouterStateSnapshot);
      expect((res as UrlTree).toString(), url).toBe('/auth/login');
    }
  });
});

describe('ApprovedGuard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('permite entrar con auth desactivada en desarrollo', async () => {
    setup(mockSupabase('disabled'), mockAccess(), true);
    const guard = TestBed.inject(ApprovedGuard);
    expect(await guard.canActivate()).toBe(true);
  });

  it('permite entrar cuando el perfil está aprobado y hay equipo', async () => {
    setup(
      mockSupabase('authenticated'),
      mockAccess({ state: 'ready', teamId: 't1', role: 'owner' }),
    );
    const guard = TestBed.inject(ApprovedGuard);
    expect(await guard.canActivate()).toBe(true);
  });

  it('redirige a /pending-approval cuando el perfil está pendiente', async () => {
    setup(
      mockSupabase('authenticated'),
      mockAccess({ state: 'pending', route: '/pending-approval' }),
    );
    const guard = TestBed.inject(ApprovedGuard);
    const res = await guard.canActivate();
    expect((res as UrlTree).toString()).toBe('/pending-approval');
  });

  it('redirige a /onboarding/team cuando está aprobado sin equipo (a SOLICITARLO)', async () => {
    // CAMBIO DE CONTRATO (22/09/2026): el estado se llamaba 'create-team'. La ruta es la
    // misma, pero la pantalla ya no crea el equipo: presenta una solicitud que aprueba un
    // administrador de plataforma.
    setup(
      mockSupabase('authenticated'),
      mockAccess({ state: 'request-team', route: '/onboarding/team' }),
    );
    const guard = TestBed.inject(ApprovedGuard);
    const res = await guard.canActivate();
    expect((res as UrlTree).toString()).toBe('/onboarding/team');
  });

  it('redirige a /onboarding/team cuando la solicitud está PENDIENTE de aprobación', async () => {
    setup(
      mockSupabase('authenticated'),
      mockAccess({ state: 'request-pending', route: '/onboarding/team' }),
    );
    const guard = TestBed.inject(ApprovedGuard);
    const res = await guard.canActivate();
    expect((res as UrlTree).toString()).toBe('/onboarding/team');
  });

  it('redirige a /access-rejected cuando está rechazado', async () => {
    setup(
      mockSupabase('authenticated'),
      mockAccess({ state: 'rejected', route: '/access-rejected' }),
    );
    const guard = TestBed.inject(ApprovedGuard);
    const res = await guard.canActivate();
    expect((res as UrlTree).toString()).toBe('/access-rejected');
  });

  it('redirige a /auth/login si no hay sesión', async () => {
    setup(mockSupabase('unauthenticated'), mockAccess());
    const guard = TestBed.inject(ApprovedGuard);
    const res = await guard.canActivate();
    expect((res as UrlTree).toString()).toBe('/auth/login');
  });
});

describe('AdminGuard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('permite entrar con auth desactivada en desarrollo', async () => {
    setup(mockSupabase('disabled'), mockAccess(), true);
    const guard = TestBed.inject(AdminGuard);
    expect(await guard.canActivate()).toBe(true);
  });

  it('permite entrar solo si is_platform_admin() es true', async () => {
    const access = mockAccess();
    (access.checkIsPlatformAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    setup(mockSupabase('authenticated'), access);
    const guard = TestBed.inject(AdminGuard);
    expect(await guard.canActivate()).toBe(true);
    expect(access.checkIsPlatformAdmin).toHaveBeenCalled();
  });

  it('NO deja entrar a un usuario autenticado que no es admin (nunca por correo)', async () => {
    setup(mockSupabase('authenticated'), mockAccess());
    const guard = TestBed.inject(AdminGuard);
    const res = await guard.canActivate();
    expect((res as UrlTree).toString()).toBe('/team');
  });

  it('redirige a /auth/login si no hay sesión', async () => {
    setup(mockSupabase('unauthenticated'), mockAccess());
    const guard = TestBed.inject(AdminGuard);
    const res = await guard.canActivate();
    expect((res as UrlTree).toString()).toBe('/auth/login');
  });
});
