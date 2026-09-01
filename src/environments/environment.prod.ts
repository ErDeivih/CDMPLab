// =============================================================
// EntrenoLab — Configuración de PRODUCCIÓN
//
// Proyecto Supabase real: vgwfjkhvzprsoixpzruq (region eu-west-1).
//   · supabaseUrl            → https://vgwfjkhvzprsoixpzruq.supabase.co
//   · supabasePublishableKey → clave PUBLISHABLE del proyecto (la proporciona
//                              David). NUNCA la Secret Key.
//
// ⚠️ Esta build de PRODUCCIÓN nunca debe dejar pasar los guards con Supabase
//    desactivado: la autenticación es obligatoria.
// =============================================================

import { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  supabaseUrl: 'https://vgwfjkhvzprsoixpzruq.supabase.co',
  supabasePublishableKey: 'sb_publishable_hKJI4t8yO7dqXCr68vlAFw_bzmdCbOU',
};
