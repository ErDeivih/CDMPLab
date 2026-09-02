import { test, expect, type Page } from '@playwright/test';

// =============================================================
// CDMPLab — E2E del artefacto de GitHub Pages (prefijo /CDMPLab/)
//
// Se ejecuta SOLO con `playwright.pages.config.ts`, que sirve la build real
// generada con baseHref /CDMPLab/ (scripts/build-pages.mjs + configure `pages`)
// mediante scripts/serve-pages.mjs. Ese servidor NO inventa un fallback: usa el
// `404.html` del propio artefacto (copia de index.html), exactamente como lo
// hace GitHub Pages. Si el artefacto no tuviera 404.html, estas rutas fallarían.
//
// Objetivo: demostrar que el ARTEFACTO publicado funciona por sí solo:
//   1. /CDMPLab/ carga y redirige al login.
//   2. /CDMPLab/auth/login cargado DIRECTO funciona (vía 404.html real).
//   3. Recargar esa URL funciona.
//   4. /CDMPLab/board sin sesión termina en /auth/login (guard).
//   5. JS, CSS, fuentes, favicon y escudo NO dan 404 (ni requestfailed).
//   6. Desktop y móvil.
// =============================================================

const BASE = '/CDMPLab';
const SUPABASE_HOST = 'supabase.co';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const BENIGN_CONSOLE = ['[SupabaseService]', '[AccessService]'];

// Assets de la app que NUNCA deben dar 404 ni requestfailed.
const APP_ASSET_PATTERNS = [/\.js($|\?)/, /\.css($|\?)/, /\.woff2?($|\?)/, /favicon/, /cdm-pizarrales-512\.png/, /\.svg($|\?)/];

/** la build servida debe ser la de producción (marcador en <html>). */
async function expectProductionMode(page: Page): Promise<void> {
  const mode = await page.evaluate(() => document.documentElement.dataset['entrenolabMode'] ?? null);
  expect(mode, 'la build servida NO es de producción').toBe('production');
}

/** Registrar problemas reales de la app (excluye hosts externos benignos). */
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

/** Comprueba que los assets de la app (JS/CSS/fuentes/favicon/escudo) no dan 404. */
async function expectAppAssetsOk(page: Page): Promise<void> {
  const bad = await page.evaluate(({ patterns }) => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const badList: string[] = [];
    for (const e of entries) {
      const u = e.name;
      // Solo assets locales de la app (bajo el base href).
      if (!u.includes('/CDMPLab/')) continue;
      const matches = patterns.some((p) => new RegExp(p).test(u));
      if (!matches) continue;
      // responseStatus no está en todos los runtimes; si está, 0/>=400 es fallo.
      const status = (e as unknown as { responseStatus?: number }).responseStatus;
      if (status === 0 || (status != null && status >= 400)) badList.push(`${u} -> ${status}`);
    }
    return badList;
  }, { patterns: APP_ASSET_PATTERNS.map((p) => p.source) });
  expect(bad, `assets de la app con 404/fallo: ${bad.join(', ')}`).toEqual([]);
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

for (const [label, viewport] of [
  ['escritorio 1366×900', { width: 1366, height: 900 }],
  ['móvil 390×844', { width: 390, height: 844 }],
] as Array<[string, { width: number; height: number }]>) {
  test.describe(`GitHub Pages /CDMPLab/ (${label})`, () => {
    test('carga inicial de /CDMPLab/, assets sin 404 y modo producción', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      await page.goto(`${BASE}/`);
      // La ruta raíz redirige ('' → 'team' → guard ApprovedGuard → /auth/login).
      await page.waitForURL('**' + BASE + '/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();
      await expectProductionMode(page);
      await expectAppAssetsOk(page);

      await expectNoHorizontalOverflow(page, ['.shell', '.main', '.content', '.auth']);
      await page.waitForTimeout(400);
      expect(problems, `problemas al cargar ${BASE}/`).toEqual([]);
    });

    test('/auth/login cargado DIRECTO funciona mediante el 404.html del artefacto', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      // URL directa: el servidor NO tiene el fichero auth/login, así que sirve el
      // 404.html del artefacto (como GitHub Pages). La app debe arrancar y mostrar login.
      await page.goto(`${BASE}/auth/login`);
      await page.waitForURL('**' + BASE + '/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();
      await expectProductionMode(page);
      await expectAppAssetsOk(page);

      await page.waitForTimeout(400);
      expect(problems, `problemas al abrir /auth/login directo`).toEqual([]);
    });

    test('REFESCO de una ruta pública (/auth/login) no da 404', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      await page.goto(`${BASE}/auth/login`);
      await page.waitForURL('**' + BASE + '/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();

      // Recarga en la misma ruta pública (usa de nuevo el 404.html del artefacto).
      await page.reload();
      await page.waitForURL('**' + BASE + '/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();
      await expectProductionMode(page);
      await expectAppAssetsOk(page);

      await page.waitForTimeout(400);
      expect(problems, `problemas al recargar /auth/login`).toEqual([]);
    });

    test('GUARD: /board sin sesión redirige a /auth/login', async ({ page }) => {
      await page.setViewportSize(viewport);
      const problems = collectProblems(page);

      await page.goto(`${BASE}/board`);
      await page.waitForURL('**' + BASE + '/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();
      await expectProductionMode(page);
      await expectAppAssetsOk(page);

      await page.waitForTimeout(400);
      expect(problems, `problemas al redirigir /board`).toEqual([]);
    });

    test('assets de la app (JS/CSS/fuentes/favicon/escudo) nunca dan 404', async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`${BASE}/auth/login`);
      await page.waitForURL('**' + BASE + '/auth/login');
      await expect(page.locator('#login-email')).toBeVisible();
      await expectAppAssetsOk(page);
    });
  });
}
