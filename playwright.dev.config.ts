import { defineConfig } from '@playwright/test';

// =============================================================
// CDMPLab — Config E2E sobre la BUILD COMPILADA de desarrollo.
//
// A diferencia de `playwright.config.ts` (que usa `ng serve` — dev server de
// Angular con HMR, que se degrada/rastrea bajo runs largos), esta config:
//   1. Sirve `dist/entrenolab/browser` (la build de `ng build --configuration
//      development`, que SI tiene modo local: Supabase vacío, sin sesión) con
//      `scripts/serve-prod.mjs` (servidor estático + fallback SPA). Sin HMR.
//   2. Ejecuta TODA la suite E2E de la pizarra contra esa build estable.
//
// La build de desarrollo usa `environment.development.ts` (production:false,
// supabaseUrl vacío): los guards dejan pasar en modo local y los seeds de
// localStorage funcionan, igual que con `ng serve`. Solo cambia el servidor.
//
// baseURL = servidor estático de la build de desarrollo (http://127.0.0.1:4301).
// =============================================================

export default defineConfig({
  testDir: './e2e',
  // Mismo contenido que la suite local, excluyendo prod-auth/supabase-real/pages
  // (esas tienen configs dedicadas).
  testIgnore: ['**/prod-auth.spec.ts', '**/supabase-real.spec.ts', '**/cdmplab-pages.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4301',
    headless: true,
    viewport: { width: 1360, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // La build development debe existir: se construye con el script
    // `test:e2e:dev` (ng build --configuration development && playwright test ...).
    command: 'node scripts/serve-prod.mjs',
    url: 'http://127.0.0.1:4301',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { HOST: '127.0.0.1', PORT: '4301' },
  },
});
