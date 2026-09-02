import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // `prod-auth.spec.ts` es la prueba de PRODUCCIÓN y solo se ejecuta con
  // `playwright.prod.config.ts` (sirve la build real). Aquí (dev server) se
  // excluye para que la suite local no lo confunda con un smoke de dev.
  // `supabase-real.spec.ts` es OPT-IN (requiere credenciales reales) y se
  // ejecuta SOLO con `playwright.supabase-real.config.ts`.
  // `cdmplab-pages.spec.ts` se ejecuta SOLO con `playwright.pages.config.ts`.
  testIgnore: ['**/prod-auth.spec.ts', '**/supabase-real.spec.ts', '**/cdmplab-pages.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4200',
    headless: true,
    viewport: { width: 1360, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run start -- --host 127.0.0.1 --port 4200',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
