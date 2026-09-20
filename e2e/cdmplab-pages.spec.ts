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
const APP_ASSET_PATTERNS = [
  /\.js($|\?)/,
  /\.css($|\?)/,
  /\.woff2?($|\?)/,
  /favicon/,
  // FASE 8A: el recurso de marca es el PNG con el exterior transparente (antes el JPG cuadrado).
  /cdm-pizarrales-escudo\.png/,
  /\.svg($|\?)/,
];

/** la build servida debe ser la de producción (marcador en <html>). */
async function expectProductionMode(page: Page): Promise<void> {
  const mode = await page.evaluate(
    () => document.documentElement.dataset['entrenolabMode'] ?? null,
  );
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
  const bad = await page.evaluate(
    ({ patterns }) => {
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
    },
    { patterns: APP_ASSET_PATTERNS.map((p) => p.source) },
  );
  expect(bad, `assets de la app con 404/fallo: ${bad.join(', ')}`).toEqual([]);

  const visibleAssets = await page.evaluate(async () => {
    const images = [...document.querySelectorAll<HTMLImageElement>('img[src*="cdm-pizarrales"]')];
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
      ),
    );
    await document.fonts.ready;
    return {
      imageUrls: images.map((img) => img.currentSrc || img.src),
      brokenImages: images
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src),
      interLoaded: document.fonts.check('16px Inter'),
      symbolsLoaded: document.fonts.check('24px "Material Symbols Outlined"'),
      // Iconos REALMENTE pintados: un `.msi` dentro de un subárbol oculto (0×0, sin `offsetParent`)
      // no usa la fuente y el navegador no la descarga.
      iconosVisibles: [...document.querySelectorAll<HTMLElement>('.msi')].filter(
        (el) => el.getBoundingClientRect().width > 0 && el.offsetParent !== null,
      ).length,
    };
  });
  expect(visibleAssets.imageUrls.length, 'no se encontró el escudo').toBeGreaterThan(0);
  expect(
    visibleAssets.imageUrls.every((url) => url.includes('/CDMPLab/assets/')),
    'el escudo escapó del base href',
  ).toBe(true);
  expect(visibleAssets.brokenImages, 'hay escudos rotos').toEqual([]);
  expect(visibleAssets.interLoaded, 'Inter no cargó').toBe(true);
  // CONTRATO CORREGIDO (medido en el artefacto de Pages): esta comprobación exigía la fuente de
  // iconos SIEMPRE, y a 390×844 fallaba con «Material Symbols no cargó». La medición real dice que
  // NO es un fallo de la app: en móvil el shell oculta el bloque de autenticación
  // (`.sidebar:has(.sidebar-auth) { display: none }`), los dos `.msi` de la pantalla quedan en 0×0
  // y sin `offsetParent`, y el navegador —correctamente— no descarga una fuente que nadie usa
  // (pedidos de red medidos: solo Inter; `Material Symbols Outlined: unloaded`). Lo que sí debe
  // cumplirse siempre: si hay algún icono PINTADO, la fuente tiene que estar cargada; y si no hay
  // ninguno, la comprobación no aplica.
  if (visibleAssets.iconosVisibles > 0) {
    expect(
      visibleAssets.symbolsLoaded,
      `hay ${visibleAssets.iconosVisibles} iconos pintados pero la fuente de iconos no cargó`,
    ).toBe(true);
  } else {
    expect(
      visibleAssets.symbolsLoaded,
      'sin iconos pintados el navegador no descarga la fuente (no es un fallo)',
    ).toBe(false);
  }
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

    test('/auth/login cargado DIRECTO funciona mediante el 404.html del artefacto', async ({
      page,
    }) => {
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

    test('FASE 1 en Pages: los PNG tácticos se resuelven bajo /CDMPLab/ y una miniatura autocontenida se dibuja', async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(`${BASE}/auth/login`);
      await page.waitForURL('**' + BASE + '/auth/login');

      // 1) El camino REAL que usa `inlineSvgAssets`: un href relativo resuelto contra
      //    `document.baseURI` (que en Pages lleva el prefijo /CDMPLab/). Si esto falla, ningún
      //    asset se puede incrustar y las miniaturas perderían el material.
      const asset = await page.evaluate(async () => {
        const url = new URL('assets/tactical/cone-red.png', document.baseURI).toString();
        const res = await fetch(url);
        const buf = new Uint8Array(await res.arrayBuffer());
        return {
          url,
          base: document.baseURI,
          ok: res.ok,
          tipo: res.headers.get('content-type') ?? '',
          esPng: buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
          bytes: buf.length,
        };
      });
      expect(asset.base, 'el base href del despliegue es /CDMPLab/').toContain('/CDMPLab/');
      expect(asset.url, 'el asset se resuelve DENTRO del subdirectorio').toContain(
        '/CDMPLab/assets/tactical/cone-red.png',
      );
      expect(asset.ok, `el PNG táctico responde OK (${asset.url})`).toBe(true);
      expect(asset.esPng, 'y es un PNG de verdad (magic bytes)').toBe(true);
      expect(asset.bytes, 'con contenido real').toBeGreaterThan(200);

      // 2) La técnica de la miniatura (un SVG autocontenido con el PNG en base64, cargado como
      //    `<img>`) funciona bajo el prefijo: se reproduce aquí con el MISMO método que usa
      //    `exportPng` (data URL + canvas) y se comprueba que la imagen se dibuja de verdad.
      const miniatura = await page.evaluate(async (url: string) => {
        const res = await fetch(url);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.readAsDataURL(blob);
        });
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="384" viewBox="0 0 100 80"><rect width="100" height="80" fill="#31834a"/><image href="${base64}" x="40" y="30" width="20" height="20"/></svg>`;
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode().catch(() => undefined);
        const c = document.createElement('canvas');
        c.width = 480;
        c.height = 384;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#31834a';
        ctx.fillRect(0, 0, 480, 384);
        if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, 0, 0, 480, 384);
        const d = ctx.getImageData(0, 0, 480, 384).data;
        let rojos = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 150 && d[i + 1] < 120 && d[i + 2] < 120) rojos++;
        }
        return { completo: img.complete, ancho: img.naturalWidth, rojos };
      }, asset.url);
      expect(miniatura.completo, 'el SVG autocontenido se carga en Pages').toBe(true);
      expect(miniatura.ancho, 'con tamaño real').toBeGreaterThan(0);
      expect(
        miniatura.rojos,
        'el PNG táctico se dibuja dentro de la miniatura (no queda solo el césped)',
      ).toBeGreaterThan(40);
    });
  });
}
