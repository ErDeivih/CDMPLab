// =============================================================
// EntrenoLab — Guards de autenticación y acceso (seguros)
//
// Los guards resuelven PRIMERO la sesión (await ensureResolved()) y ACTÚAN
// DESPUÉS, de modo que NO se muestra contenido protegido antes de saber el
// estado.
//
// REGLA DE PRODUCCIÓN: con Supabase desactivado (`status === 'disabled'`) los
// guards NUNCA dejan pasar en producción. El modo local (sin sesión) solo
// existe bajo configuración explícita de desarrollo (`FORCE_LOCAL_MODE`).
//
// AdminGuard NO confía en el correo ni en el frontend: exige que la RPC real
// `is_platform_admin()` devuelva true.
// =============================================================

import { Injectable, InjectionToken, inject } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { AccessService } from './access.service';

/**
 * Cuando es `true`, la app corre en modo local (desarrollo) y por tanto
 * `status === 'disabled'` deja pasar los guards. En producción es `false`.
 * Los tests lo sobreescriben para simular dev (true) o prod (false).
 */
export const FORCE_LOCAL_MODE = new InjectionToken<boolean>('FORCE_LOCAL_MODE', {
  providedIn: 'root',
  factory: () => !!inject(SupabaseService).isDevelopment(),
});

/** ¿La sesión está resuelta y hay un usuario autenticado? */
function hasSession(supabase: SupabaseService): boolean {
  return supabase.status() === 'authenticated';
}

/** ¿Estamos en modo local (desarrollo) y por tanto permitidos sin sesión? */
function isLocalMode(supabase: SupabaseService, forceLocal: boolean): boolean {
  return supabase.status() === 'disabled' && forceLocal;
}

/** ¿Debemos bloquear por no tener Supabase en producción? */
function isLockedOut(supabase: SupabaseService, forceLocal: boolean): boolean {
  return supabase.status() === 'disabled' && !forceLocal;
}

/**
 * Exige sesión iniciada. En producción `disabled` redirige a /auth/login
 * (nunca deja pasar); en desarrollo `disabled` deja pasar (modo local).
 */
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  private readonly forceLocal = inject(FORCE_LOCAL_MODE);
  constructor(
    private readonly supabase: SupabaseService,
    private readonly router: Router
  ) {}

  async canActivate(): Promise<boolean | UrlTree> {
    await this.supabase.ensureResolved();
    const status = this.supabase.status();
    if (status === 'authenticated') return true;
    if (isLocalMode(this.supabase, this.forceLocal)) return true;
    // Unauthenticated, o disabled en producción → login.
    return this.router.createUrlTree(['/auth/login']);
  }
}

/**
 * Exige sesión + perfil APROBADO + equipo al que entrar.
 * Redirige según el estado del perfil:
 *   · pending      → /pending-approval
 *   · rejected     → /access-rejected
 *   · suspended    → /access-suspended
 *   · approved sin equipo → /onboarding/team (SOLICITAR equipo) o /invitations (aceptar)
 *
 * Con auth desactivada en desarrollo → deja pasar (modo local).
 */
@Injectable({ providedIn: 'root' })
export class ApprovedGuard implements CanActivate {
  private readonly forceLocal = inject(FORCE_LOCAL_MODE);
  constructor(
    private readonly supabase: SupabaseService,
    private readonly access: AccessService,
    private readonly router: Router
  ) {}

  async canActivate(): Promise<boolean | UrlTree> {
    await this.supabase.ensureResolved();
    const status = this.supabase.status();
    if (status === 'authenticated' && this.access.isReady()) return true;
    if (isLocalMode(this.supabase, this.forceLocal) && !this.supabase.user()) return true;
    if (isLockedOut(this.supabase, this.forceLocal)) return this.router.createUrlTree(['/auth/login']);
    if (status !== 'authenticated') return this.router.createUrlTree(['/auth/login']);

    // Sesión autenticada pero sin perfil aprobado/equipo: dirigir por estado.
    const target = await this.access.resolve();
    if (target.state === 'ready') return true;
    return this.router.createUrlTree([target.route]);
  }
}

/**
 * Exige ser administrador de plataforma (RPC real `is_platform_admin()`).
 * NUNCA deja pasar a un usuario autenticado sin verificación. En desarrollo
 * (`disabled`) deja pasar para permitir la app local; en producción bloquea.
 */
@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  private readonly forceLocal = inject(FORCE_LOCAL_MODE);
  constructor(
    private readonly supabase: SupabaseService,
    private readonly access: AccessService,
    private readonly router: Router
  ) {}

  async canActivate(): Promise<boolean | UrlTree> {
    await this.supabase.ensureResolved();
    const status = this.supabase.status();
    if (status === 'disabled' && this.forceLocal) return true;
    if (status !== 'authenticated') return this.router.createUrlTree(['/auth/login']);
    const isAdmin = await this.access.checkIsPlatformAdmin();
    if (isAdmin) return true;
    // Autenticado pero no admin → sin acceso (nunca juzgar por correo).
    return this.router.createUrlTree(['/team']);
  }
}
