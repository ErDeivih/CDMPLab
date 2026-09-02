// =============================================================
// EntrenoLab — Servicio de autenticación con Supabase Auth
//
// Envuelve @supabase/supabase-js de forma segura:
//   · El cliente se crea de manera LAZY (dinámica) solo cuando hay
//     SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY. Si están vacíos, el servicio
//     queda en estado `disabled` y la app se comporta como antes (local).
//   · Ningún secreto en el código: solo la clave PUBLISHABLE.
//   · Métodos de correo/contraseña: signUp, signIn, signOut, resetPassword,
//     updatePassword, resendConfirmation, getSession/onAuthStateChange.
//   · Expone un signal `session` + un estado `status` (resolving /
//     unauthenticated / authenticated / disabled) para que el shell y los
//     guards no muestren contenido protegido antes de resolver la sesión.
// =============================================================

import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * Cliente de Supabase (o null si la auth no está configurada).
 * Se proporciona con `providedIn: 'root'` para que cualquier test pueda
 * sobreescribirlo (mock) sin tocar el backend.
 *
 * El `createClient` se importa dinámicamente para no meter @supabase/supabase-js
 * en el bundle inicial mientras la app no use autenticación.
 */
export const SUPABASE_CLIENT = new InjectionToken<Promise<SupabaseClient | null>>('SUPABASE_CLIENT', {
  providedIn: 'root',
  factory: async () => {
    const url = environment.supabaseUrl;
    const key = environment.supabasePublishableKey;
    if (!url || !key) return null;
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, key);
  },
});

/** Estado de resolución de la sesión. */
export type AuthStatus = 'resolving' | 'unauthenticated' | 'authenticated' | 'disabled';

/** Perfil público mínimo del usuario (tabla `profiles`). */
export interface ProfileInfo {
  userId: string;
  displayName: string;
  /** Estado de aprobación del perfil. */
  status: string;
  emailNormalized: string;
}

/**
 * Resultado normalizado de una operación de auth. `message` es SIEMPRE un texto
 * genérico, pensado para el usuario, que no revela si un correo está registrado
 * (evita el "user enumeration" por la UI).
 */
export interface AuthResult {
  ok: boolean;
  message?: string;
  /** true cuando la app espera que el usuario confirme el correo. */
  needsVerification?: boolean;
  /** Correo asociado (para reenviar la confirmación en verify-email). */
  email?: string;
}

/**
 * Construye redirects de Auth respetando el `<base href>` de la aplicación.
 * En producción devuelve URLs bajo `/CDMPLab/`; en desarrollo conserva la raíz
 * local. Nunca se fija un localhost dentro de la build publicada.
 */
export function buildAuthRedirectUrl(path = '', baseUri = document.baseURI): string {
  const relativePath = path.replace(/^\/+/, '');
  return new URL(relativePath, baseUri).toString();
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly clientPromise = inject(SUPABASE_CLIENT);
  private client: SupabaseClient | null = null;

  private readonly _session = signal<Session | null>(null);
  private readonly _status = signal<AuthStatus>('resolving');
  private readonly _profile = signal<ProfileInfo | null>(null);

  private initPromise: Promise<void> | null = null;
  private static readonly RESEND_COOLDOWN_MS = 45_000;
  private lastResend = 0;
  private authSub: { unsubscribe: () => void } | null = null;

  /** Sesión actual (null si no hay). */
  readonly session = this._session.asReadonly();
  /** Usuario de la sesión actual. */
  readonly user = computed(() => this.session()?.user ?? null);
  /** Estado de resolución de la sesión. */
  readonly status = this._status.asReadonly();
  /** Perfil del usuario (tabla profiles), si se pudo leer. */
  readonly profile = this._profile.asReadonly();

  /** true solo cuando el build es de desarrollo (modo local permitido). */
  isDevelopment(): boolean {
    return !environment.production;
  }

  /**
   * Devuelve el cliente tipado listo para usar (o null si la auth está
   * desactivada). Los repositorios lo usan para leer/escribir datos.
   */
  async getClient(): Promise<SupabaseClient | null> {
    return this.requireClient();
  }

  /**
   * Resuelve la sesión una sola vez (idempotente). Los guards y el app
   * initializer llaman a esto; devuelve la MISMA promesa mientras se resuelve,
   * de modo que no se renderiza contenido protegido antes de tiempo.
   */
  ensureResolved(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.resolveSession();
    return this.initPromise;
  }

  /** Resuelve la sesión una vez (idempotente). */
  private async resolveSession(): Promise<void> {
    try {
      const client = await this.clientPromise;
      if (!client) {
        this._status.set('disabled');
        return;
      }
      this.client = client;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      this._session.set(data.session);
      this._status.set(data.session ? 'authenticated' : 'unauthenticated');
      this.listenToAuthChanges();
    } catch (err) {
      // Sin credenciales o backend inalcanzable: no rompemos la app.
      console.error('[SupabaseService] no se pudo resolver la sesión', err);
      this._session.set(null);
      this._status.set('unauthenticated');
    }
  }

  /** Se mantiene al día con los cambios de sesión (login/logout/refresh). */
  private listenToAuthChanges(): void {
    if (!this.client || this.authSub) return;
    const { data } = this.client.auth.onAuthStateChange((_evt: AuthChangeEvent, newSession: Session | null) => {
      this._session.set(newSession);
      this._status.set(newSession ? 'authenticated' : 'unauthenticated');
    });
    this.authSub = data.subscription;
  }

  /** Devuelve el cliente listo para usar, o null si la auth está desactivada. */
  private async requireClient(): Promise<SupabaseClient | null> {
    if (!this.client) this.client = await this.clientPromise;
    return this.client;
  }

  // -------------------- Auth (correo/contraseña) --------------------

  /** Registro con correo y contraseña (requiere confirmación por correo). */
  async signUp(email: string, password: string): Promise<AuthResult> {
    const client = await this.requireClient();
    if (!client) return { ok: false, message: 'El inicio de sesión no está configurado.' };
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: buildAuthRedirectUrl() },
      });
      if (error) throw error;
      this._session.set(data.session);
      this._status.set(data.session ? 'authenticated' : 'unauthenticated');
      if (data.session) return { ok: true, message: 'Cuenta creada.', email };
      return { ok: true, needsVerification: true, email, message: 'Revisa tu correo para confirmar el registro.' };
    } catch (err) {
      console.error('[SupabaseService] signUp', err);
      return { ok: false, message: 'No se pudo crear la cuenta. Inténtalo de nuevo.' };
    }
  }

  /** Inicio de sesión con correo y contraseña. */
  async signIn(email: string, password: string): Promise<AuthResult> {
    const client = await this.requireClient();
    if (!client) return { ok: false, message: 'El inicio de sesión no está configurado.' };
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      this._session.set(data.session);
      this._status.set(data.session ? 'authenticated' : 'unauthenticated');
      return { ok: true, message: 'Sesión iniciada.' };
    } catch {
      // Mensaje genérico: no revela si el correo existe.
      return { ok: false, message: 'Correo o contraseña incorrectos.' };
    }
  }

  /** Cierra la sesión actual. */
  async signOut(): Promise<AuthResult> {
    const client = await this.requireClient();
    if (!client) return { ok: true, message: 'No hay sesión activa.' };
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      this._session.set(null);
      this._status.set('unauthenticated');
      return { ok: true, message: 'Sesión cerrada.' };
    } catch (err) {
      console.error('[SupabaseService] signOut', err);
      return { ok: false, message: 'No se pudo cerrar la sesión.' };
    }
  }

  /**
   * Solicitud de restablecimiento de contraseña (forgot password).
   * Devuelve SIEMPRE un mensaje genérico que no revela si el correo existe.
   */
  async resetPassword(email: string): Promise<AuthResult> {
    const client = await this.requireClient();
    if (!client) return { ok: false, message: 'El restablecimiento no está configurado.' };
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: buildAuthRedirectUrl('auth/update-password'),
      });
      if (error) throw error;
    } catch (err) {
      console.error('[SupabaseService] resetPassword', err);
    }
    return { ok: true, message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' };
  }

  /** Actualiza la contraseña del usuario con sesión (flujo de recovery). */
  async updatePassword(newPassword: string): Promise<AuthResult> {
    const client = await this.requireClient();
    if (!client) return { ok: false, message: 'El cambio de contraseña no está configurado.' };
    try {
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return { ok: true, message: 'Contraseña actualizada.' };
    } catch (err) {
      console.error('[SupabaseService] updatePassword', err);
      return { ok: false, message: 'No se pudo actualizar la contraseña. Inténtalo de nuevo.' };
    }
  }

  /**
   * Reenvía el correo de confirmación con un pequeño cooldown para evitar
   * abusos de spam.
   */
  async resendConfirmation(email: string): Promise<AuthResult> {
    if (Date.now() - this.lastResend < SupabaseService.RESEND_COOLDOWN_MS) {
      return { ok: false, message: 'Espera unos segundos antes de reenviar el correo.' };
    }
    const client = await this.requireClient();
    if (!client) return { ok: false, message: 'El reenvío no está configurado.' };
    this.lastResend = Date.now();
    try {
      const { error } = await client.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: buildAuthRedirectUrl() },
      });
      if (error) throw error;
      return { ok: true, message: 'Correo de confirmación reenviado.' };
    } catch (err) {
      console.error('[SupabaseService] resendConfirmation', err);
      return { ok: false, message: 'No se pudo reenviar el correo. Inténtalo de nuevo.' };
    }
  }

  // -------------------- Perfil / aprobación --------------------

  /**
   * Lee el perfil (tabla `profiles`) del usuario actual. Si el backend no es
   * alcanzable, la fila no existe o el client no está configurado, devuelve null
   * (los guards lo interpretan como "sin verificar" y dirigen a /pending-approval).
   */
  async fetchProfile(): Promise<ProfileInfo | null> {
    const client = await this.requireClient();
    if (!client) return null;
    const uid = this.user()?.id;
    if (!uid) return null;
    try {
      const { data, error } = await client.from('profiles').select('*').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const info: ProfileInfo = {
        userId: String(data.user_id ?? ''),
        displayName: String(data.display_name ?? ''),
        status: String(data.status ?? 'pending'),
        emailNormalized: String(data.email_normalized ?? ''),
      };
      this._profile.set(info);
      return info;
    } catch (err) {
      console.error('[SupabaseService] fetchProfile', err);
      return null;
    }
  }
}
