import { test, expect, type Page } from '@playwright/test';

// =============================================================
// EntrenoLab — E2E honesto de PRODUCCIÓN (build real con Supabase)
//
// Se ejecuta únicamente con `playwright.prod.config.ts`, que sirve
// `dist/entrenolab/browser` (la salida de `ng build`, configuración
// `production`) mediante `scripts/serve-prod.mjs` con fallback SPA.
// NO usa `ng serve` (eso es el dev server con Supabase vacío).
//
// Objetivo: demostrar, con la build REAL, que:
//   1. La build servida es la de PRODUCCIÓN (marcador `data-entrenolab-mode`)
//      y no la de desarrollo/local (Supabase presente, modo local desactivado).
//   2. Las pantallas públicas de auth renderizan.
//   3. Una ruta privada (/team, /board) REDIRIGE a /auth/login sin sesión:
//      los guards NO se saltan en producción.
//   4. Sin pageerror, sin console.error (salvo benigno), sin requestfailed
//      (salvo benigno) y sin desbordamiento horizontal.
//
// NO crea cuentas, NO inicia sesión, NO envía correos, NO envía emails:
// solo navegación y lectura. Cualquier petición al backend Supabase que se
// intente no es parte de lo que la prueba verifica (por eso se tolera).
// =============================================================

const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };

// Peticiones al proyecto Supabase real: se INTENTAN en la build de producción
// (el cliente real resuelve la sesión al arrancar). No verificamos conectividad:
// si fallan (sin red / CORS), no deben tumbar la prueba.
const SUPABASE_HOST = 'vgwfjkhvzprsoixpzruq.supabase.co';
// CDN de fuentes externo de Google Fonts (index.html). Si la red no está
// disponible en la máquina de CI, la petición falla — no es un fallo de la app.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// console.error benignos en producción: el servicio de Supabase los registra
// cuando no puede resolver la sesión/el acceso sin backend. Es el comportamiento
// esperado y NO indica una build rota.
const BENIGN_CONSOLE = ['[SupabaseService]', '[AccessService]'];

/** Registra pageerror, console.error, requestfailed y respuestas >= 400. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (BENIGN_CONSOLE.some((b) => text.includes(b))) return;
    problems.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if ([SUPABASE_HOST, ...FONT_HOSTS].some((h) => url.includes(h))) return;
    problems.push(`requestfailed: ${url} (${req.failure()?.errorText ?? 'sin error'})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const url = res.url();
      if ([SUPABASE_HOST, ...FONT_HOSTS].some((h) => url.includes(h))) return;
      problems.push(`${res.status()} ${url}`);
    }
  });
  return problems;
}

/** Sin desbordamiento horizontal en los contenedores principales. */
async function expectNoHorizontalOverflow(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null;
      return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null;
    }, sel);
    expect(r, `no existe ${sel}`).not.toBeNull();
    expect(r!.scroll, `scroll horizontal en ${sel}`).toBeLessThanOrEqual(r!.client + 1);
  }
}

/** La build servida debe ser la de PRODUCCIÓN (marcador en <html>). */
async function expectProductionMode(page: Page): Promise<void> {
  const mode = await page.evaluate(() => document.documentElement.dataset['entrenolabMode'] ?? null);
  expect(mode, 'la build servida NO es la de producción (esperado "production")').toBe('production');
}

for (const [label, viewport] of [
  ['escritorio 1366×900', DESKTOP],
  ['móvil 390×844', MOBILE],
] as Array<[string, { width: number; height: number }]>) {
  test.describe(`Producción — auth pública, guard real y sin errores (${label})`, () => {
    test('/auth/login renderiza el formulario y la build es de PRODUCCIÓN', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      await page.goto('/auth/login');
      await page.waitForURL('**/auth/login');

      await expect(page.locator('#login-email')).toBeVisible();
      await expect(page.locator('#login-password')).toBeVisible();
      await expect(page.locator('button[type=submit]')).toBeVisible();

      // Es la build de producción (no la de dev/local).
      await expectProductionMode(page);

      await expectNoHorizontalOverflow(page, ['.shell', '.main', '.content', '.auth']);
      await page.waitForTimeout(400);
      expect(problems, `problemas en /auth/login`).toEqual([]);
    });

    test('las rutas públicas de auth renderizan en producción', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      await page.goto('/auth/register');
      await page.waitForURL('**/auth/register');
      await expect(page.locator('#reg-email')).toBeVisible();
      await expect(page.locator('#reg-password')).toBeVisible();
      await expectProductionMode(page);

      await page.goto('/auth/forgot-password');
      await page.waitForURL('**/auth/forgot-password');
      await expect(page.locator('#forgot-email')).toBeVisible();
      await expect(page.locator('button[type=submit]')).toBeVisible();
      await expectProductionMode(page);

      await page.goto('/auth/update-password');
      await page.waitForURL('**/auth/update-password');
      // En producción sin sesión el componente muestra el aviso de "enlace no
      // válido" (noSession = status === 'unauthenticated'): la pantalla RENDERIZA.
      await expect(page.locator('.auth-title')).toBeVisible();
      await expect(page.locator('.auth-title')).toContainText('Nueva contraseña');
      await expect(page.locator('.auth-msg.err')).toBeVisible();
      await expectProductionMode(page);

      await expectNoHorizontalOverflow(page, ['.shell', '.main', '.content', '.auth']);
      await page.waitForTimeout(400);
      expect(problems, `problemas en rutas públicas de auth`).toEqual([]);
    });

    test('/team REDIRIGE a /auth/login sin sesión (guard real de producción)', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      await page.goto('/team');
      await page.waitForURL('**/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();

      await expectProductionMode(page);

      await expectNoHorizontalOverflow(page, ['.shell', '.main', '.content', '.auth']);
      await page.waitForTimeout(400);
      expect(problems, `problemas al redirigir /team`).toEqual([]);
    });

    test('/board REDIRIGE a /auth/login sin sesión (guard real de producción)', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      await page.goto('/board');
      await page.waitForURL('**/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();

      await expectProductionMode(page);

      await expectNoHorizontalOverflow(page, ['.shell', '.main', '.content', '.auth']);
      await page.waitForTimeout(400);
      expect(problems, `problemas al redirigir /board`).toEqual([]);
    });
  });
}
