import { defineConfig } from '@playwright/test';

// =============================================================
// CDMPLab — Config E2E OPT-IN contra el backend Supabase REAL
//
// DIFERENCIA con `playwright.config.ts` (local) y con
// `playwright.prod.config.ts` (smoke de producción SIN credenciales):
//   · Este suite SÍ habla con Supabase real (login, aprobación, equipos,
//     jugadores, carpetas, ejercicios, invitaciones) usando credenciales de
//     CUENTA DE PRUEBA proporcionadas por el operador mediante variables de
//     entorno. NO interpola ni simula Supabase.
//   · Si faltan las variables, la suite se OMITE en bloque con un mensaje
//     explícito (NUNCA finge un pase).
//   · NO forma parte de `npm run test:e2e` ni de `test:e2e:prod`, y NO está en
//     CI: requiere secretos y dos cuentas preparadas a mano.
//
// Se sirve la build REAL de producción (`dist/entrenolab/browser`, la salida de
// `ng build`) para conectarse contra el proyecto real. La suite añade un
// PREFIJO ÚNICO por ejecución a los datos que crea, para poder limpiarlos sin
// tocar datos de otros usuarios.
//
// Lanzamiento:
//   1. Build:      npm run build
//   2. Configurar variables (ver README / docs):
//        SUPABASE_E2E_HOST_EMAIL / SUPABASE_E2E_HOST_PASSWORD
//        SUPABASE_E2E_OWNER_EMAIL / SUPABASE_E2E_OWNER_PASSWORD
//        (opcionales) SUPABASE_E2E_PENDING_EMAIL / _PASSWORD
//                    SUPABASE_E2E_REJECTED_EMAIL / _PASSWORD
//   3. Ejecutar:   npm run test:e2e:supabase-real
//
// baseURL = servidor estático de la build real (http://127.0.0.1:4400).
// =============================================================

export default defineConfig({
  testDir: './e2e',
  testMatch: /supabase-real\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // Same-worker serializa los tests para no chocar al crear/limpiar datos.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4400',
    headless: true,
    viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-prod.mjs',
    url: 'http://127.0.0.1:4400',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { HOST: '127.0.0.1', PORT: '4400' },
  },
});
