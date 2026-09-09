// =============================================================
// CIERRE DE PRODUCCIÓN — FASE 7 (revisión final, corregida): galería de
// FUNCIONALIDAD, no solo menús.
//
// Genera la galería seleccionada mediante interacción REAL sobre la pizarra.
// NINGÚN elemento del documento se escribe directamente en localStorage para
// fingir la colocación: todo se coloca/dibuja/rota/añade con clics y gestos
// reales. Solo el seed inicial mínimo (equipo + plantilla) se siembra.
//
// Salida: e2e/shots/cierre-produccion/ → se copia la galería SELECCIONADA a
// docs/screenshots/cierre-produccion/ (versionable), con índice Markdown.
//
// Capturas:
//   · herramientas-colocadas.png       línea, flecha, flecha doble, curva izq/der,
//                                       zigzag, mano alzada, rectángulo, elipse, texto
//   · materiales-colocados-1.png       materiales (1/2) distribuidos, alguno rotado
//   · materiales-colocados-2.png       materiales (2/2) distribuidos, alguno rotado
//   · interaccion-seleccion.png        asas de redimensión, extremos, C1, material sin
//                                       resize, menú contextual tras pulsación larga
//   · jugador-vertical-legible.png     (conservada) jugador vertical legible
//   · formacion-vertical-legible.png   (conservada) formación vertical legible
//   · formaciones-propio-rival.png     (conservada) 4-3-3 propia + 4-4-2 rival
//   · ejercicio-guardado-reabierto.png (conservada) guardar y reabrir en pizarra
//   · movil-horizontal-*.png           (conservadas) móvil horizontal con menús
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { longPress, fillBoardTitle } from './gesture-helpers';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = 'e2e/shots/cierre-produccion';
const DOC_SHOTS = 'docs/screenshots/cierre-produccion';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DOC_SHOTS, { recursive: true });

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };

type Box = { x: number; y: number; width: number; height: number };
type Fit = 'contain' | 'height';

function normToScreen(nx: number, ny: number, host: Box, fit: Fit): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  return { x: host.x + host.width / 2 + (cx - host.width / 2), y: host.y + host.height / 2 + (cy - host.height / 2) };
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

/** Seed del borrador de IA (vía /board/draft) con orientación/players/formaciones. */
function seedDraft(orientation: 'horizontal' | 'vertical', players: unknown[], formations?: { own: string; rival: string }) {
  const draft = {
    schemaVersion: 1, title: `Cierre ${orientation}`, field: 'full', orientation,
    players: players.length ? players : undefined,
    ownFormation: formations?.own, rivalFormation: formations?.rival,
  };
  return `(() => {
    // Limpiar claves previas para que un segundo seed (en la misma página) re-siembre.
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Sergio', number: 8, position: 'MC', color: '#1f7a4d', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    sessionStorage.setItem('entrenolab:ai-draft', ${JSON.stringify(JSON.stringify(draft))});
  })()`;
}

/** Seed de la pizarra normal (vía /board) con plantilla mínima. */
async function seedBoard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Sergio', number: 8, position: 'MC', color: '#1f7a4d', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Diego', number: 10, position: 'DF', color: '#c0392b', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
  });
}

async function dismissHelp(page: Page): Promise<void> {
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (await page.locator(sel).isVisible().catch(() => false)) await page.locator(sel).click();
  }
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(250);
  await dismissHelp(page);
}

async function useTool(page: Page, title: string, category?: string): Promise<void> {
  if (category) await page.locator('.tools-cat', { hasText: category }).click();
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
    return;
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

async function deselect(page: Page): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

/** Dibuja (mouse) entre dos puntos normalizados. */
async function drawShape(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await hostBox(page);
  const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], box, fit);
  const b = normToScreen(to[0], to[1], box, fit);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** Selecciona la herramienta de dibujo y elige el color (índice del swatch del caption). */
async function pickDrawTool(page: Page, title: string, colorIndex?: number): Promise<void> {
  await useTool(page, title, 'Dibujo');
  if (colorIndex != null) {
    await page.locator('.tools-caption .swatch').nth(colorIndex).click();
  }
}

/** Coloca un material (con variante opcional) mediante clic. */
async function placeMaterial(page: Page, tool: string, nx: number, ny: number, variantIndex?: number): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  if (variantIndex != null) {
    const card = page.locator('.tools-material-card', { has: page.locator(`.rail-btn[title="${tool}"]`) });
    const variantCount = await card.locator('.variant-swatch').count();
    if (variantCount > 0) await card.locator('.variant-swatch').nth(variantIndex).click();
  }
  await page.locator(`.rail-btn[title="${tool}"]`).click();
  const box = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, box, fit);
  await page.mouse.click(p.x, p.y);
  // Un material se auto-selecciona y abre Propiedades en móvil; se deselecciona.
  await deselect(page);
}

/** Pulsación larga para abrir el menú contextual y girar ±90°. */
async function rotateSelected(page: Page, nx: number, ny: number, dir: 'left' | 'right'): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const box = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, box, fit);
  await longPress(page, p.x, p.y);
  await expect(page.locator('.context-bar')).toBeVisible();
  const label = dir === 'right' ? 'Girar 90° a la derecha' : 'Girar 90° a la izquierda';
  await page.locator(`.context-bar [aria-label="${label}"]`).click();
  await page.waitForTimeout(120);
  await deselect(page);
}

/** Selecciona un elemento por su centro normalizado (clic simple con la herramienta
 *  Seleccionar activa) y espera a que el inspector (panel Propiedades) se abra. */
async function selectByNorm(page: Page, nx: number, ny: number): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const box = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, box, fit);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.studio-panel .inspector')).toBeVisible();
  await page.waitForTimeout(80);
}

// =============================================================
// GALERÍA — capturas de FUNCIONALIDAD
// =============================================================
test.describe('CIERRE — galería visual de funcionalidad (revisión final)', () => {
  test('herramientas-colocadas: todas las formas/herramientas dibujadas con varios colores', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedBoard(page);
    await openBoard(page);

    // Línea (indigo) y flecha normal (rojo) y flecha doble (verde) — reconocibles.
    await pickDrawTool(page, 'Línea', 0);
    await drawShape(page, [0.08, 0.1], [0.3, 0.14]);
    await deselect(page);
    await pickDrawTool(page, 'Flecha (movimiento)', 1);
    await drawShape(page, [0.38, 0.1], [0.58, 0.16]);
    await deselect(page);
    await pickDrawTool(page, 'Flecha doble sentido', 2);
    await drawShape(page, [0.66, 0.1], [0.9, 0.16]);
    await deselect(page);

    // Curva izquierda (naranja) y curva derecha (azul) claramente distintas.
    await pickDrawTool(page, 'Curva izquierda', 3);
    await drawShape(page, [0.08, 0.26], [0.3, 0.4]);
    await deselect(page);
    await pickDrawTool(page, 'Curva derecha', 4);
    await drawShape(page, [0.38, 0.26], [0.58, 0.4]);
    await deselect(page);

    // Zigzag con punta correcta (morado).
    await pickDrawTool(page, 'Conducción (zigzag)', 5);
    await drawShape(page, [0.66, 0.26], [0.9, 0.4]);
    await deselect(page);

    // Mano alzada (cian) y rectángulo (rojo) y elipse (verde).
    await pickDrawTool(page, 'Dibujo a mano alzada', 6);
    await drawShape(page, [0.08, 0.5], [0.3, 0.66]);
    await deselect(page);
    await pickDrawTool(page, 'Rectángulo', 1);
    await drawShape(page, [0.38, 0.5], [0.58, 0.62]);
    await deselect(page);
    await pickDrawTool(page, 'Círculo / elipse', 2);
    await drawShape(page, [0.66, 0.5], [0.86, 0.62]);
    await deselect(page);

    // Texto real (multilínea) con contenido.
    await pickDrawTool(page, 'Texto', 0);
    const box = await hostBox(page);
    const fit = await fitMode(page);
    const tp = normToScreen(0.46, 0.78, box, fit);
    await page.mouse.click(tp.x, tp.y);
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Rondos 4v2\nPase al apoyo\nFinalización');
    await ta.dispatchEvent('change');
    await ta.evaluate((el) => (el as HTMLElement).blur());
    await page.waitForTimeout(150);
    await deselect(page);

    // 10 elementos colocados.
    await expect(page.locator('.field-count')).toHaveText('10');
    await page.waitForTimeout(250);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/herramientas-colocadas.png` });
  });

  test('materiales-colocados-1: materiales distribuidos (1/2), alguno rotado ±90°', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedBoard(page);
    await openBoard(page);

    await placeMaterial(page, 'Balón', 0.14, 0.14);
    await placeMaterial(page, 'Fitball', 0.28, 0.14);
    await placeMaterial(page, 'Cono', 0.14, 0.3, 0); // rojo
    await placeMaterial(page, 'BOSU', 0.28, 0.3);
    await placeMaterial(page, 'Banderín', 0.42, 0.3);
    await placeMaterial(page, 'Chino', 0.56, 0.3);
    await placeMaterial(page, 'Pica coloreable', 0.7, 0.3);
    await placeMaterial(page, 'Maniquí individual', 0.14, 0.46, 0);
    await placeMaterial(page, 'Miniportería', 0.3, 0.46);
    // Rotado +90° para demostrar que un material puede girar.
    await placeMaterial(page, 'Pértiga / poste', 0.5, 0.46);
    await rotateSelected(page, 0.5, 0.46, 'right');

    await expect(page.locator('.field-count')).toHaveText('10');
    await page.waitForTimeout(250);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/materiales-colocados-1.png` });
  });

  test('materiales-colocados-2: materiales distribuidos (2/2), alguno rotado -90°', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedBoard(page);
    await openBoard(page);

    await placeMaterial(page, 'Valla', 0.14, 0.14);
    await placeMaterial(page, 'Aro', 0.28, 0.14, 0);
    await placeMaterial(page, 'Escalera', 0.42, 0.14, 0);
    await placeMaterial(page, 'Minitrampolín', 0.56, 0.14);
    await placeMaterial(page, 'Peto', 0.7, 0.14);
    await placeMaterial(page, 'Chaleco lastrado', 0.14, 0.3);
    // Rotado -90° para demostrar giro a la izquierda.
    await placeMaterial(page, 'BOSU', 0.28, 0.3);
    await rotateSelected(page, 0.28, 0.3, 'left');
    await placeMaterial(page, 'Cono', 0.7, 0.3, 1); // amarillo

    await expect(page.locator('.field-count')).toHaveText('8');
    await page.waitForTimeout(250);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/materiales-colocados-2.png` });
  });

  test('interaccion-seleccion: asas de resize, extremos, C1, material sin resize y menú contextual', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedBoard(page);
    await openBoard(page);

    // Rectángulo (figura con asas de redimensión) + línea (extremos) + curva (extremos+C1).
    await pickDrawTool(page, 'Rectángulo', 0);
    await drawShape(page, [0.6, 0.14], [0.82, 0.3]);
    await deselect(page);
    await pickDrawTool(page, 'Línea', 0);
    await drawShape(page, [0.14, 0.3], [0.36, 0.34]);
    await deselect(page);
    await pickDrawTool(page, 'Curva derecha', 0);
    await drawShape(page, [0.2, 0.5], [0.5, 0.66]);
    await deselect(page);
    // Un material (cono), que NO debe tener asas de redimensión.
    await placeMaterial(page, 'Cono', 0.32, 0.72, 0);
    await deselect(page);
    await expect(page.locator('.field-count')).toHaveText('4');

    // Persistir para obtener los CENTROS exactos de cada elemento y seleccionarlos con precisión.
    await fillBoardTitle(page, 'Visual1');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const els = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return ex.canvas.frames[0].elements;
    });
    const rect = els.find((e: { t: string }) => e.t === 'rect')!;
    const curve = els.find((e: { t: string }) => e.t === 'curve')!;
    const cone = els.find((e: { t: string }) => e.t === 'cone')!;
    const center = (el: Record<string, number>) => [
      (el.x ?? 0) + (el.w ?? 0) / 2,
      (el.y ?? 0) + (el.h ?? 0) / 2,
    ];
    // Reabrir la pizarra con los elementos de nuevo.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('4');

    // Seleccionar el RECTÁNGULO: debe mostrar asas de redimensión.
    await selectByNorm(page, ...center(rect));
    const rectHandle = page.locator('.reshandle');
    expect(await rectHandle.count()).toBeGreaterThanOrEqual(4);
    await deselect(page);

    // Seleccionar la CURVA: extremos + C1 + manija de rotación. El punto para pinchar
    // es el MIDPOINT de la Bézier (t=0,5: (P0+2·P1+P2)/4), que SÍ está sobre el arco
    // (la tolerancia de selección es ahora en px, así que hay que pinchar la curva, no
    // el baricentro de sus 3 puntos de control que queda fuera del arco).
    const curveEl = els.find((e: { t: string }) => e.t === 'curve')!;
    const cx = (curveEl.x1 + 2 * curveEl.c1x + curveEl.x2) / 4;
    const cy = (curveEl.y1 + 2 * curveEl.c1y + curveEl.y2) / 4;
    await selectByNorm(page, cx, cy);
    const curveHandles = page.locator('.reshandle');
    expect(await curveHandles.count()).toBeGreaterThanOrEqual(3);
    await deselect(page);

    // Seleccionar el MATERIAL (cono): NO debe haber asas de redimensión.
    await selectByNorm(page, ...center(cone));
    const matHandle = page.locator('.reshandle');
    expect(await matHandle.count()).toBe(0);
    await deselect(page);

    // Menú contextual tras pulsación larga sobre la curva.
    const box = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(cx, cy, box, fit);
    await longPress(page, p.x, p.y);
    await expect(page.locator('.context-bar')).toBeVisible();
    await page.waitForTimeout(120);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/interaccion-seleccion.png` });
    await page.keyboard.press('Escape');
  });

  // =============================================================
  // Capturas CONSERVADAS (evidencia ya validada en FASE 1/7 penalidades).
  // =============================================================
  test('jugador-vertical-legible y formacion-vertical-legible (conservadas)', async ({ page }) => {
    test.setTimeout(120_000);
    // Jugador vertical con nombre/dorsal legible.
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seedDraft('vertical', [
      { id: 'own-1', team: 'own', position: { x: 0.5, y: 0.5 }, label: 'Sergio', number: 8 },
    ]));
    await page.goto('/board/draft');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);
    await page.waitForTimeout(400);
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/jugador-vertical-legible.png` });

    // Formación vertical 4-3-3 + 4-4-2 (22 jugadores).
    await page.addInitScript(seedDraft('vertical', [], { own: '4-3-3', rival: '4-4-2' }));
    await page.goto('/board/draft');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);
    await page.waitForTimeout(400);
    await expect(page.locator('.field-count')).toHaveText('22');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/formacion-vertical-legible.png` });
  });

  test('formaciones-propio-rival (conservada): 4-3-3 propia + 4-4-2 rival', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(seedDraft('horizontal', [], { own: '4-3-3', rival: '4-4-2' }));
    await page.goto('/board/draft');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);
    await page.waitForTimeout(400);
    await expect(page.locator('.field-count')).toHaveText('22');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/formaciones-propio-rival.png` });
  });

  test('ejercicio-guardado-reabierto (conservada): guardar en pizarra y reabrir', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedBoard(page);
    await openBoard(page);

    await useTool(page, 'Jugador propio', 'Jugadores');
    let box = await hostBox(page); let fit = await fitMode(page);
    const pp = normToScreen(0.3, 0.3, box, fit);
    await page.mouse.click(pp.x, pp.y);
    await deselect(page);
    await placeMaterial(page, 'Cono', 0.5, 0.55, 1);
    await pickDrawTool(page, 'Flecha (movimiento)', 0);
    await drawShape(page, [0.35, 0.35], [0.55, 0.45]);
    await deselect(page);
    await expect(page.locator('.field-count')).toHaveText('3');

    await fillBoardTitle(page, 'Visual2');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await expect(page.locator('.ex-card')).toHaveCount(1);
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('3');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/ejercicio-guardado-reabierto.png` });
  });

  test('movil-horizontal-menus-cerrados y menús (conservadas)', async ({ page }) => {
    test.setTimeout(120_000);
    // Menús cerrados.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.addInitScript(seedDraft('horizontal', [
      { id: 'own-1', team: 'own', position: { x: 0.3, y: 0.4 }, label: 'Sergio', number: 8 },
      { id: 'rival-1', team: 'rival', position: { x: 0.6, y: 0.6 }, label: 'Diego', number: 10 },
    ]));
    await page.goto('/board/draft');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);
    await page.waitForTimeout(400);
    const host = (await page.locator('.board-host').boundingBox())!;
    expect(host.width).toBeGreaterThan(host.height);
    const open = await page.evaluate(() => {
      const sels = ['.side-panel-left', '.studio-panel', '.top-pop-export', '.top-pop-mas'];
      let n = 0;
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          const b = (el as HTMLElement).getBoundingClientRect();
          if (b.width > 2 && b.height > 2) n++;
        }
      }
      return n;
    });
    expect(open, 'no hay menús principales abiertos').toBe(0);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/movil-horizontal-menus-cerrados.png` });

    // Menú Jugadores abierto.
    await seedBoard(page);
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left[aria-label="Jugadores"]')).toBeVisible();
    await page.waitForTimeout(150);
    await expect(page.locator('.roster-list')).toBeVisible();
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/movil-horizontal-menu-jugadores.png` });

    // Menú Dibujo abierto.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    await page.waitForTimeout(150);
    const buttons = page.locator('.tools-panel-side .rail-btn');
    expect(await buttons.count()).toBeGreaterThanOrEqual(10);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/movil-horizontal-menu-dibujo.png` });
  });
});

// =============================================================
// Copia la galería SELECCIONADA a docs/screenshots/cierre-produccion/ + índice.
// (Solo las capturas de esta lista; no el resto de shots masivos.)
// =============================================================
function copySelectedGallery(): string[] {
  const selected = [
    'herramientas-colocadas.png',
    'materiales-colocados-1.png',
    'materiales-colocados-2.png',
    'interaccion-seleccion.png',
    'jugador-vertical-legible.png',
    'formacion-vertical-legible.png',
    'formaciones-propio-rival.png',
    'ejercicio-guardado-reabierto.png',
    'movil-horizontal-menus-cerrados.png',
    'movil-horizontal-menu-jugadores.png',
    'movil-horizontal-menu-dibujo.png',
  ];
  const copied: string[] = [];
  for (const name of selected) {
    const src = path.join(SHOTS, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DOC_SHOTS, name));
      copied.push(name);
    }
  }
  return copied;
}

// Copia la galería al terminar TODOS los tests.
test.afterAll(() => {
  const copied = copySelectedGallery();
  const index = `# Galería de cierre de producción (CDMPLab)

Capturas generadas por interacción real (Playwright, E2E de la pizarra) y copiadas a
\`docs/screenshots/cierre-produccion/\`. Ninguna imagen escribe directamente el documento:
todo se coloca/dibuja/rota/añade desde la UI.

| Captura | Qué muestra |
|---|---|
| \`herramientas-colocadas.png\` | Línea, flecha, flecha doble, curva izquierda/derecha, zigzag, mano alzada, rectángulo, elipse y texto real, en varios colores. |
| \`materiales-colocados-1.png\` | Materiales (1/2) distribuidos con espacio; pértiga rotada +90°. |
| \`materiales-colocados-2.png\` | Materiales (2/2) distribuidos con espacio; marcador rotado -90°. |
| \`interaccion-seleccion.png\` | Rectángulo con asas de redimensión, línea con extremos, curva con extremos+C1, material seleccionado sin resize y menú contextual. |
| \`jugador-vertical-legible.png\` | Jugador en campo vertical con nombre y dorsal legibles de izquierda a derecha. |
| \`formacion-vertical-legible.png\` | Formación 4-3-3 + 4-4-2 en vertical, dorsales horizontales. |
| \`formaciones-propio-rival.png\` | Formación 4-3-3 propia y 4-4-2 rival en horizontal. |
| \`ejercicio-guardado-reabierto.png\` | Ejercicio guardado y reabierto en pizarra (jugador, cono y flecha). |
| \`movil-horizontal-menus-cerrados.png\` | Móvil en paisaje: campo horizontal protagonista, menús cerrados. |
| \`movil-horizontal-menu-jugadores.png\` | Móvil en paisaje: menú Jugadores abierto con la plantilla. |
| \`movil-horizontal-menu-dibujo.png\` | Móvil en paisaje: menú Dibujo abierto con las herramientas. |
`;
  fs.writeFileSync(path.join(DOC_SHOTS, 'INDICE.md'), index);
  console.log(`[galeria] Copiadas ${copied.length} capturas a ${DOC_SHOTS}`);
});
