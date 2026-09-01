// =============================================================
// EntrenoLab — Configuración de DESARROLLO / E2E / LOCAL
//
// Por defecto deja Supabase vacío para que la app funcione en modo local
// (localStorage) sin exigir sesión, ÚTIL para desarrollo y pruebas E2E
// controladas (seed local). Esta configuración NUNCA debe usarse en producción.
// =============================================================

import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  supabaseUrl: '',
  supabasePublishableKey: '',
};
