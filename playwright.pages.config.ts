import { defineConfig } from '@playwright/test';

// =============================================================
// CDMPLab — Config E2E de la build de GitHub Pages (prefijo /CDMPLab/)
//
// Sirve `dist/entrenolab/browser` (la build de `scripts/build-pages.mjs`,
// con baseHref /CDMPLab/) mediante `scripts/serve-pages.mjs`, que maneja el
// prefijo y hace fallback SPA a index.html. Así se reproduce el comportamiento
// real de GitHub Pages: recarga/URL directa de /auth/login y /board, assets
// bajo /CDMPLab/, guard de ruta privada sin sesión, etc.
//
// NO usa `ng serve`: es una build REAL servida estáticamente.
//
// Lanzamiento:   npm run test:e2e:pages
//   (hace: build-pages (genera environment.pages.ts + ng build --configuration pages)
//          y luego `playwright test --config=playwright.pages.config.ts`)
// =============================================================

export default defineConfig({
  testDir: './e2e',
  testMatch: /cdmplab-pages\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4500',
    headless: true,
    viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-pages.mjs',
    url: 'http://127.0.0.1:4500',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { HOST: '127.0.0.1', PORT: '4500' },
  },
});
