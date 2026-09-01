// =============================================================
// EntrenoLab — Configuración de PRODUCCIÓN (entrada por defecto)
//
// El build por defecto es `production` (ver angular.json
// defaultConfiguration). La configuración de DESARROLLO/E2E se inyecta
// mediante fileReplacements (environment.development.ts).
//
// Proyecto Supabase real: vgwfjkhvzprsoixpzruq (eu-west-1).
//   · supabaseUrl            → https://vgwfjkhvzprsoixpzruq.supabase.co
//   · supabasePublishableKey → clave PUBLISHABLE del proyecto (la proporciona
//                              David). NUNCA la Secret Key.
//
// ⚠️ PRODUCCIÓN: la autenticación es obligatoria. Nunca dejar pasar los guards
//    con Supabase desactivado.
// =============================================================

import { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  supabaseUrl: 'https://vgwfjkhvzprsoixpzruq.supabase.co',
  supabasePublishableKey: 'sb_publishable_hKJI4t8yO7dqXCr68vlAFw_bzmdCbOU',
};
