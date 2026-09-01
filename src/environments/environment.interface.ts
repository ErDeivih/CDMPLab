// =============================================================
// EntrenoLab — Configuración de entorno (BASE COMPARTIDA)
// =============================================================

export interface Environment {
  production: boolean;
  /** URL del proyecto Supabase. */
  supabaseUrl: string;
  /** Clave publicable (publishable/anon) de Supabase. NUNCA un secreto. */
  supabasePublishableKey: string;
}
