// =============================================================
// Supabase-real E2E — helpers PUROS de preparación y evaluación.
//
// Módulo sin dependencias de Angular ni de Playwright para poder probarse
// con los tests unitarios (vitest). Contiene SOLO lógica pura:
//   · evaluación de variables de entorno (leídas en el proceso);
//   · generación de un PREFIJO ÚNICO por ejecución;
//   · determinación de variables obligatorias/ausentes;
//   · construcción del motivo de "omisión completa" de la suite;
//   · parsing de listas de correos (para cuentas colaboradoras) sin
//     incrustar ningún valor real.
//
// No contiene correos, contraseñas, UUID ni tokens: esos valores solo viven
// en el entorno del proceso de ejecución y nunca se escriben en el repo.
// =============================================================

export interface SupabaseE2EEnv {
  /** Cuenta administradora de plataforma (perfil aprobado + private.platform_admins). */
  adminEmail: string | null;
  adminPassword: string | null;
  /** Cuenta propietaria de un equipo de prueba (perfil aprobado, sin equipo antes). */
  ownerEmail: string | null;
  ownerPassword: string | null;
  /** Cuenta colaboradora SIN equipo propio (perfil aprobado). */
  collaboratorEmail: string | null;
  collaboratorPassword: string | null;
  /** Correos (separados por coma) de las cuentas que se invitan para probar el límite de 4. */
  limitEmails: string[];
  limitPassword: string | null;
  /** Cuenta con perfil pendiente (opcional). */
  pendingEmail: string | null;
  pendingPassword: string | null;
  /** Cuenta con perfil rechazado (opcional). */
  rejectedEmail: string | null;
  rejectedPassword: string | null;
}

/** Correo en blanco → null (elimina espacios y considera vacío). */
export function cleanValue(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/** Divide una lista separada por comas, eliminando vacíos y espacios. */
export function parseCsvList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Variables de entorno OBLIGATORIAS para la suite (sin ellas se omite). */
export const REQUIRED_SUPABASE_E2E_VARS: readonly string[] = [
  'SUPABASE_E2E_ADMIN_EMAIL',
  'SUPABASE_E2E_ADMIN_PASSWORD',
  'SUPABASE_E2E_OWNER_EMAIL',
  'SUPABASE_E2E_OWNER_PASSWORD',
  'SUPABASE_E2E_COLLAB_EMAIL',
  'SUPABASE_E2E_COLLAB_PASSWORD',
  'SUPABASE_E2E_LIMIT_EMAILS',
  'SUPABASE_E2E_LIMIT_PASSWORD',
] as const;

/** Lee y normaliza TODAS las variables del entorno (puro sobre un objeto env). */
export function readEnv(env: Record<string, string | undefined>): SupabaseE2EEnv {
  return {
    adminEmail: cleanValue(env['SUPABASE_E2E_ADMIN_EMAIL']),
    adminPassword: cleanValue(env['SUPABASE_E2E_ADMIN_PASSWORD']),
    ownerEmail: cleanValue(env['SUPABASE_E2E_OWNER_EMAIL']),
    ownerPassword: cleanValue(env['SUPABASE_E2E_OWNER_PASSWORD']),
    collaboratorEmail: cleanValue(env['SUPABASE_E2E_COLLAB_EMAIL']),
    collaboratorPassword: cleanValue(env['SUPABASE_E2E_COLLAB_PASSWORD']),
    limitEmails: parseCsvList(env['SUPABASE_E2E_LIMIT_EMAILS']),
    limitPassword: cleanValue(env['SUPABASE_E2E_LIMIT_PASSWORD']),
    pendingEmail: cleanValue(env['SUPABASE_E2E_PENDING_EMAIL']),
    pendingPassword: cleanValue(env['SUPABASE_E2E_PENDING_PASSWORD']),
    rejectedEmail: cleanValue(env['SUPABASE_E2E_REJECTED_EMAIL']),
    rejectedPassword: cleanValue(env['SUPABASE_E2E_REJECTED_PASSWORD']),
  };
}

/** Nombres de variables obligatorias que están vacías en `env`. */
export function missingRequiredVars(env: Record<string, string | undefined>): string[] {
  return REQUIRED_SUPABASE_E2E_VARS.filter((n) => cleanValue(env[n]) === null);
}

/** Genera un PREFIJO ÚNICO por ejecución (identifica lo creado para limpieza).
 *  Forma estable: `e2e-<tiempo_base36>-<aleatorio_base36(4+)>`. */
export function buildPrefix(now: number = Date.now(), random: () => number = Math.random): string {
  const time = now.toString(36);
  // `random()` en [0,1): su base36 puede ser corta; aseguramos >= 4 caracteres.
  const rand = random().toString(36).slice(2, 8).padEnd(4, '0');
  return `e2e-${time}-${rand}`;
}

/** Motivo (para no dar un falso pase) cuando faltan variables. */
export function skipReason(missing: string[]): string {
  return `Variables de entorno ausentes; se OMITE la suite Supabase-real: ${missing.join(', ')}`;
}

/** Verifica que la lista de correos para el límite tenga exactamente `n` entradas. */
export function limitEmailsValid(env: SupabaseE2EEnv, needed: number): { ok: boolean; message?: string } {
  if (env.limitEmails.length !== needed) {
    return {
      ok: false,
      message: `Se requieren exactamente ${needed} correos en SUPABASE_E2E_LIMIT_EMAILS para probar el límite (obtenidos: ${env.limitEmails.length}).`,
    };
  }
  return { ok: true };
}
