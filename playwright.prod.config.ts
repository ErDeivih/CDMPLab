import { defineConfig } from '@playwright/test';

// =============================================================
// EntrenoLab — Config E2E de PRODUCCIÓN (honesta)
//
// A diferencia de `playwright.config.ts` (que sirve el DEV server con
// Supabase vacío), esta config:
//   1. Ejecuta `npm run build` implícitamente? NO — la build se debe haber
//      hecho con `ng build` (config `production`, ver angular.json
//      defaultConfiguration). Puedes lanzarla con el script npm
//      `test:e2e:prod`:  ng build && playwright test --config=playwright.prod.config.ts
//   2. Sirve `dist/entrenolab/browser` mediante `scripts/serve-prod.mjs`,
//      un servidor estático con fallback SPA a `index.html` (NO usa `ng serve`).
//   3. Solo ejecuta el spec honesto de producción (`e2e/prod-auth.spec.ts`).
//
// baseURL = el servidor ESTÁTICO de la build real (http://127.0.0.1:4300).
// =============================================================

export default defineConfig({
  testDir: './e2e',
  // `prod-auth`: la prueba honesta de la build real. `prod-campos`: comprueba que el ARTEFACTO
  // contiene la corrección del cambio de campo y del fútbol sala azul (el bundle publicado no puede
  // ser una versión antigua). Abrir `/board` en producción exigiría una sesión real de Supabase, que
  // el encargo prohíbe tocar, así que la comprobación interactiva del cambio de campo se hace contra
  // el servidor de desarrollo y contra la build de desarrollo servida estática.
  testMatch: /prod-(auth|campos)\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4300',
    headless: true,
    // El viewport por defecto no importa: cada test fija escritorio y móvil.
    viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-prod.mjs',
    url: 'http://127.0.0.1:4300',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
