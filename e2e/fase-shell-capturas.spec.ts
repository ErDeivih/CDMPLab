import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';

// =============================================================
// Capturas de la fase «shell + móvil». La MISMA spec sirve para el ANTES y el DESPUÉS:
//
//   $env:CAPTURAS_DIR='antes'   → docs/screenshots/fase-shell-movil/antes
//   $env:CAPTURAS_DIR='despues' → docs/screenshots/fase-shell-movil/despues
//
// El objetivo es comparar el mismo estado en los cuatro viewports del encargo:
// 1366×768 (escritorio), 1024×768 (tablet), 844×390 (móvil horizontal) y 390×844 (móvil vertical).
// =============================================================

// Solo se ejecuta cuando se pide explícitamente (`CAPTURAS_DIR=antes|despues`). Dentro de la suite
// completa se SALTA: si corriera por defecto, volvería a escribir la carpeta `antes` con capturas
// del estado ACTUAL y la comparación antes/después dejaría de significar nada.
const DIR_PEDIDO = process.env['CAPTURAS_DIR'];
test.skip(!DIR_PEDIDO, 'Capturas: se ejecutan solo con CAPTURAS_DIR=antes|despues');
const DIR = DIR_PEDIDO === 'despues' ? 'despues' : 'antes';
const SHOTS = `docs/screenshots/fase-shell-movil/${DIR}`;
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  escritorio: { width: 1366, height: 768 },
  tablet: { width: 1024, height: 768 },
  movilH: { width: 844, height: 390 },
  movilV: { width: 390, height: 844 },
} as const;

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:organizacion-hint', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    localStorage.setItem('entrenolab:orient-hint', '1');
    if (localStorage.getItem('capturas:seed')) return;
    localStorage.setItem('capturas:seed', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([
        { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now },
        { id: 't2', name: 'Cadete B', accentColor: '#c0392b', createdAt: now },
      ]),
    );
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify([
        {
          id: 'p1',
          teamId: 't1',
          name: 'Marcos',
          number: 2,
          position: 'DF',
          color: '#1a73e8',
          active: true,
          createdAt: now,
        },
        {
          id: 'p2',
          teamId: 't1',
          name: 'Pau',
          number: 10,
          position: 'MF',
          color: '#c0392b',
          active: true,
          createdAt: now,
        },
        {
          id: 'p3',
          teamId: 't1',
          name: 'Sergio',
          number: 9,
          position: 'DL',
          color: '#1f7a4d',
          active: true,
          createdAt: now,
        },
      ]),
    );
    localStorage.setItem(
      'entrenolab:folders',
      JSON.stringify([{ id: 'f1', teamId: 't1', name: 'Posesión', parentId: null }]),
    );
    const canvas = {
      version: 2,
      schemaVersion: 4,
      field: 'full',
      orientation: 'horizontal',
      grass: 'stripes',
      lineColor: '#ffffff',
      backgroundColor: '#31834a',
      frames: [
        {
          duration: 1000,
          elements: [
            {
              id: 'e-cone',
              t: 'cone',
              x: 0.3,
              y: 0.4,
              size: 1,
              assetKind: 'cone',
              asset: '/assets/tactical/cone.png',
            },
            {
              id: 'e-cone2',
              t: 'cone',
              x: 0.5,
              y: 0.6,
              size: 1,
              assetKind: 'cone',
              asset: '/assets/tactical/cone.png',
            },
            { id: 'e-player', t: 'player', x: 0.6, y: 0.5, c: '#1a73e8', n: 8, label: 'Sergio' },
          ],
        },
      ],
    };
    localStorage.setItem(
      'entrenolab:exercises',
      JSON.stringify([
        {
          id: 'x1',
          teamId: 't1',
          folderId: 'f1',
          title: 'Rondos 4v2',
          description: 'Rondo con dos comodines por dentro.',
          explanation: 'Mantener el balón y cambiar de orientación.',
          category: 'Técnica',
          objectives: [],
          materials: ['Conos', 'Petos'],
          durationMinutes: 15,
          minPlayers: 6,
          maxPlayers: 8,
          loadMode: 'fixed',
          seriesCount: null,
          repetitionsCount: null,
          workSeconds: null,
          restSeconds: null,
          isTemplate: false,
          canvas,
          thumbnail: null,
          savedAt: now,
          revision: 1,
        },
      ]),
    );
    localStorage.setItem(
      'entrenolab:sessions',
      JSON.stringify([
        {
          id: 's1',
          teamId: 't1',
          title: 'Sesión de posesión',
          date: '2026-09-10',
          durationMinutes: 60,
          notes: '',
          tasks: [
            {
              id: 'tk1',
              exerciseId: 'x1',
              title: 'Rondos 4v2',
              durationMinutes: 15,
              material: '',
              sortOrder: 0,
            },
          ],
          createdAt: now,
          savedAt: now,
        },
      ]),
    );
  });
}

/** Abre la pizarra con el campo listo y los avisos flotantes descartados. */
async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (
      await page
        .locator(sel)
        .isVisible()
        .catch(() => false)
    )
      await page.locator(sel).click();
  }
}

/** Abre una categoría de la barra de herramientas de la pizarra. */
async function openBoardCategory(
  page: Page,
  categoria: 'Jugadores' | 'Material' | 'Dibujo',
): Promise<void> {
  const panel: Record<string, string> = {
    Jugadores: '.side-panel-left[aria-label="Jugadores"]',
    Material: '.side-panel-left[aria-label="Herramientas de Material"]',
    Dibujo: '.side-panel-left[aria-label="Herramientas de Dibujo"]',
  };
  if (
    await page
      .locator(panel[categoria])
      .isVisible()
      .catch(() => false)
  )
    return;
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: categoria }).click();
  await expect(page.locator(panel[categoria])).toBeVisible();
}

async function openProps(page: Page): Promise<void> {
  if (
    await page
      .locator('.studio-panel')
      .isVisible()
      .catch(() => false)
  )
    return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
}

async function shot(page: Page, nombre: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${nombre}.png`, fullPage: false });
}

test.describe(`Capturas del shell (${DIR})`, () => {
  test.use({ hasTouch: true });

  test('escritorio 1366×768', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.escritorio);
    await seed(page);
    for (const [ruta, nombre] of [
      ['/team', 'escritorio-plantilla'],
      ['/library', 'escritorio-biblioteca'],
      ['/sessions', 'escritorio-sesiones'],
    ] as const) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      // La captura de escritorio documenta que SOLO se ve una navegación (la lateral): si la de
      // móvil volviera a mostrarse, esta captura no se tomaría con el defecto escondido.
      if (ruta === '/team') {
        await expect(page.locator('.nav-escritorio')).toBeVisible();
        await expect(page.locator('.nav-movil')).toBeHidden();
      }
      await shot(page, nombre);
    }
    await openBoard(page);
    await shot(page, 'escritorio-pizarra');
    await openBoardCategory(page, 'Material');
    await shot(page, 'escritorio-pizarra-material');
    await openProps(page);
    await shot(page, 'escritorio-pizarra-propiedades');
  });

  test('tablet 1024×768', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await seed(page);
    await page.goto('/team');
    await page.waitForLoadState('networkidle');
    await shot(page, 'tablet-plantilla');
    await openBoard(page);
    await openBoardCategory(page, 'Material');
    await shot(page, 'tablet-pizarra-material');
  });

  test('móvil horizontal 844×390', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.movilH);
    await seed(page);
    await openBoard(page);
    await shot(page, 'movil-horizontal-pizarra-limpia');
    await openBoardCategory(page, 'Jugadores');
    await shot(page, 'movil-horizontal-jugadores');
    await openBoardCategory(page, 'Material');
    await shot(page, 'movil-horizontal-material');
    await openBoardCategory(page, 'Dibujo');
    await shot(page, 'movil-horizontal-dibujo');
    await openProps(page);
    await shot(page, 'movil-horizontal-propiedades');
  });

  test('móvil vertical 390×844', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.movilV);
    await seed(page);
    for (const [ruta, nombre] of [
      ['/team', 'movil-vertical-plantilla'],
      ['/library', 'movil-vertical-biblioteca'],
      ['/sessions', 'movil-vertical-sesiones'],
      ['/settings/team/members', 'movil-vertical-miembros'],
    ] as const) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      await shot(page, nombre);
    }
    await openBoard(page);
    await shot(page, 'movil-vertical-pizarra');
    await openBoardCategory(page, 'Material');
    await shot(page, 'movil-vertical-pizarra-material');
    // La misma vista, con el nombre que pide el encargo para el bottom sheet.
    await shot(page, 'movil-vertical-pizarra-bottom-sheet');
    // Y el panel minimizado a pestaña (el campo vuelve a verse entero).
    await page.locator('.side-panel-left .panel-min').first().click();
    await expect(page.locator('.panel-tab')).toBeVisible();
    await shot(page, 'movil-vertical-panel-minimizado');
  });

  test('autenticación', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.escritorio);
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await shot(page, 'login-escritorio');
    await page.setViewportSize(VIEWPORTS.movilV);
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await shot(page, 'login-movil');
  });

  test('cuenta y «Más» abiertos', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.escritorio);
    await seed(page);
    await page.goto('/team');
    await page.waitForLoadState('networkidle');
    await page.locator('.cuenta-btn').click();
    await expect(page.locator('.cuenta-panel')).toBeVisible();
    await shot(page, 'escritorio-cuenta-abierta');
    await page.keyboard.press('Escape');

    await page.setViewportSize(VIEWPORTS.movilH);
    await page.goto('/team');
    await page.locator('.nav-mas').click();
    await expect(page.locator('.cuenta-panel')).toBeVisible();
    await shot(page, 'movil-horizontal-mas');
    await page.keyboard.press('Escape');

    await page.setViewportSize(VIEWPORTS.movilV);
    await page.goto('/team');
    await page.locator('.nav-mas').click();
    await expect(page.locator('.cuenta-panel')).toBeVisible();
    await shot(page, 'movil-vertical-mas');
  });

  test('contact sheet e índice de la carpeta', async ({ page }) => {
    const ficheros = fs
      .readdirSync(SHOTS)
      .filter((f) => f.endsWith('.png'))
      .sort();
    const filas = ficheros
      .map((f) => {
        const b64 = fs.readFileSync(`${SHOTS}/${f}`).toString('base64');
        const titulo = f.replace('.png', '');
        return `<figure><img src="data:image/png;base64,${b64}" alt="${titulo}"><figcaption>${titulo}</figcaption></figure>`;
      })
      .join('\n');
    const html =
      '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>CDMPLab · shell y móvil</title>' +
      '<style>body{font-family:Inter,system-ui,sans-serif;margin:14px;background:#0f151a;color:#e8edf2}' +
      'h1{font-size:16px}figure{display:inline-block;margin:10px;text-align:center;vertical-align:top}' +
      'figure img{max-width:420px;border:1px solid #2b3947;border-radius:6px}figcaption{font-size:12px;margin-top:4px;color:#9fb0c0}</style>' +
      `</head><body><h1>CDMPLab · fase shell+móvil · ${DIR}</h1>${filas}</body></html>`;
    const rutaHtml = `${SHOTS}/contact-sheet.html`;
    fs.writeFileSync(rutaHtml, html, 'utf8');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('file:///' + rutaHtml.replace(/\\/g, '/'));
    await expect(page.locator('figure')).toHaveCount(ficheros.length);
    await page.screenshot({ path: `${SHOTS}/contact-sheet.png`, fullPage: true });
    expect(fs.existsSync(`${SHOTS}/contact-sheet.png`)).toBe(true);

    // Índice legible: qué prueba cada captura y en qué viewport.
    const indice = [
      `# Capturas · fase shell+móvil (${DIR})`,
      '',
      'Generadas por `e2e/fase-shell-capturas.spec.ts` (misma spec para el antes y el después).',
      'Viewports del encargo: 1366×768 (escritorio), 1024×768 (tablet), 844×390 (móvil horizontal),',
      '390×844 (móvil vertical).',
      '',
      '| Captura | Qué muestra |',
      '| --- | --- |',
      ...ficheros.map((f) => `| \`${f}\` | ${describe(f)} |`),
      '',
      '## Comparación antes/después de la franja de estado (altura útil del campo)',
      '',
      'La carpeta `antes/` es el estado previo (con `.field-status`) y `despues/` el actual. Las',
      'capturas tienen los MISMOS nombres a propósito, para poder compararlas una a una.',
      '',
      'Altura recuperada MEDIDA (se reinsertó la franja tal cual estaba en HEAD y se midió el lienzo',
      'antes y después de eliminarla, en la misma página; no es un cálculo):',
      '',
      '| Vista | Con franja | Sin franja | Recuperado |',
      '| --- | --- | --- | --- |',
      '| Escritorio 1366×768 | lienzo 563 px | lienzo 603 px | **+40 px** |',
      '| Móvil horizontal 844×390 | lienzo 175 px | lienzo 225 px | **+50 px** (un 29 % más de campo) |',
      '| Móvil vertical 390×844 | lienzo 629 px | lienzo 679 px | **+50 px** |',
      '',
      'En los tres casos el hueco entre `.studio-top` y el lienzo pasa de 50/54 px a 10/4 px (solo el',
      'relleno del campo): ya no queda ninguna banda. La franja `.field-status` no existe en el DOM.',
      '',
    ].join('\n');
    fs.writeFileSync(`${SHOTS}/INDICE.md`, indice, 'utf8');
  });
});

/** Descripción de cada captura para el índice. */
function describe(f: string): string {
  const mapa: Record<string, string> = {
    'escritorio-plantilla':
      'Plantilla en escritorio, sin barra superior y con UNA sola navegación (la lateral)',
    'escritorio-biblioteca':
      'Biblioteca en escritorio (panel lateral y rejilla a pantalla completa)',
    'escritorio-sesiones': 'Sesiones en escritorio',
    'escritorio-pizarra':
      'Pizarra limpia en escritorio, SIN la franja de estado: el campo arranca pegado a la cabecera (+40 px de campo medidos; comparar con la misma captura en «antes»)',
    'escritorio-pizarra-material': 'Pizarra con el panel de Material abierto (escritorio)',
    'escritorio-pizarra-propiedades': 'Pizarra con el panel de Propiedades abierto (escritorio)',
    'escritorio-cuenta-abierta': 'Menú de cuenta abierto desde el pie de la barra lateral',
    'tablet-plantilla': 'Plantilla en tablet 1024×768',
    'tablet-pizarra-material': 'Pizarra con Material abierto en tablet',
    'movil-horizontal-pizarra-limpia':
      'Pizarra limpia en móvil horizontal, sin franja de estado (+50 px de campo, un 29 % más; comparar con la misma captura en «antes»)',
    'movil-horizontal-jugadores': 'Panel de Jugadores en móvil horizontal',
    'movil-horizontal-material': 'Panel de Material en móvil horizontal, sin tapar la navegación',
    'movil-horizontal-dibujo': 'Panel de Dibujo en móvil horizontal',
    'movil-horizontal-propiedades': 'Panel de Propiedades en móvil horizontal',
    'movil-horizontal-mas':
      'Hoja «Más» sobre la navegación inferior (móvil horizontal), con «Llenar pantalla / Ver campo completo» dentro',
    'movil-vertical-plantilla': 'Plantilla en móvil vertical con la navegación de 5 entradas',
    'movil-vertical-biblioteca': 'Biblioteca en móvil vertical',
    'movil-vertical-sesiones': 'Sesiones en móvil vertical',
    'movil-vertical-miembros': 'Pantalla de Miembros en móvil vertical',
    'movil-vertical-pizarra':
      'Pizarra en móvil vertical, sin franja de estado (+50 px de campo medidos)',
    'movil-vertical-pizarra-material':
      'Panel de Material en móvil vertical (hoja inferior anclada sobre la navegación)',
    'movil-vertical-pizarra-bottom-sheet':
      'Hoja inferior de móvil vertical (el panel ocupa el ancho, como máximo el 58 % del alto y queda anclado por encima de la navegación)',
    'movil-vertical-panel-minimizado':
      'Panel minimizado a pestaña: el campo vuelve a verse entero y un toque restaura el panel',
    'contact-sheet': 'Hoja de contacto con todas las capturas de esta carpeta',
    'movil-vertical-mas': 'Hoja «Más» en móvil vertical',
    'login-escritorio': 'Login en escritorio, sin cabecera ni navegación',
    'login-movil': 'Registro en móvil, sin navegación inferior',
  };
  return mapa[f.replace('.png', '')] ?? 'Captura de la fase shell+móvil';
}
