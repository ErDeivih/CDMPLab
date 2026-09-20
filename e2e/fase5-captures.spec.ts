// =============================================================
// Fase 5 — CAPTURAS obligatorias + REVISIÓN VISUAL.
//
// Genera en e2e/shots/fase5/ el juego de capturas que el dueño pide
// para PROBAR visualmente la usabilidad. Cada escena se construye con
// la UI real (paneles, herramientas, asas, variantes); solo el equipo
// y la plantilla se siembran por addInitScript. Tras generar, cada
// PNG se lee y se dictamina CORRECTO / DEFECTO; si hay defecto se
// corrige la causa y se regenera (nunca se deja una captura mala).
//
// Geometría espejo del render (render.ts): el rect canónico 105×68 en
// el viewBox 100×80. Los helpers norm→pantalla y el mapeo de hit-test
// comparten las mismas constantes.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';
import { longPress, fillBoardTitle, toggleFillScreen } from './gesture-helpers';

const SHOTS = 'e2e/shots/fase5';
fs.mkdirSync(SHOTS, { recursive: true });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
const VBW = 100;
const VBH = 80;

/**
 * Forward norm→pantalla (inversa de screenToNorm) para el campo en horizontal.
 * `fit` = 'height' (LLENAR pantalla, móvil) | 'contain' (Campo completo, letterbox).
 */
function normToScreen(
  nx: number,
  ny: number,
  box: Box,
  fit: 'contain' | 'height' = 'contain',
  panX = 0,
  panY = 0,
  zoom = 1
): [number, number] {
  const s = fit === 'height' ? box.height / RECT.h : Math.min(box.width / VBW, box.height / VBH);
  const offX = (box.width - VBW * s) / 2;
  const offY = (box.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  const ox = box.width / 2;
  const oy = box.height / 2;
  return [box.x + ox + panX + zoom * (cx - ox), box.y + oy + panY + zoom * (cy - oy)];
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([{ id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' }]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function dismissHelp(page: Page): Promise<void> {
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

async function openBoardDesktop(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await dismissHelp(page);
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await toggleFillScreen(page);
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}

/** Móvil: mantiene el modo por defecto "Llenar pantalla". */
async function openBoardMobile(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await dismissHelp(page);
}

async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

async function useTool(page: Page, title: string, category?: string): Promise<void> {
  await abrirHerramientas(page);
  if (category) await page.locator('.tools-cat', { hasText: category }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

async function save(page: Page): Promise<void> {
  await fillBoardTitle(page, 'Fase 5');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

async function reopen(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
}

interface CanvasElement {
  t: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  v?: string;
  size?: number;
  rot?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  c1x?: number;
  c1y?: number;
  [k: string]: unknown;
}

function canvasDoc(page: Page): Promise<{ field: string; frames: Array<{ elements: CanvasElement[] }> }> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas;
  });
}

async function elementCount(page: Page): Promise<number> {
  return Number(await page.locator('.field-count').innerText());
}

function elCenter(el: CanvasElement): [number, number] {
  const t = el.t;
  if (t === 'rect' || t === 'zone' || t === 'ellipse' || t === 'text') {
    return [(el.x ?? 0) + (el.w ?? 0) / 2, (el.y ?? 0) + (el.h ?? 0) / 2];
  }
  if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    return [((el.x1 ?? 0) + (el.x2 ?? 0)) / 2, ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2];
  }
  if (t === 'curve') {
    return [((el.x1 ?? 0) + (el.c1x ?? (el.x2 ?? 0)) + (el.x2 ?? 0)) / 3, ((el.y1 ?? 0) + (el.c1y ?? (el.y2 ?? 0)) + (el.y2 ?? 0)) / 3];
  }
  return [el.x ?? 0, el.y ?? 0];
}

function visualBBox(el: CanvasElement): { x: number; y: number; w: number; h: number } {
  const t = el.t;
  if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  if (t === 'curve') {
    const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
    const cx = el.c1x ?? (x1 + x2) / 2, cy = el.c1y ?? (y1 + y2) / 2;
    return {
      x: Math.min(x1, x2, cx), y: Math.min(y1, y2, cy),
      w: Math.max(x1, x2, cx) - Math.min(x1, x2, cx), h: Math.max(y1, y2, cy) - Math.min(y1, y2, cy),
    };
  }
  return { x: el.x ?? 0, y: el.y ?? 0, w: el.w ?? 0, h: el.h ?? 0 };
}

function rotHandle(el: CanvasElement): { x: number; y: number } {
  const bb = visualBBox(el);
  if (bb.w < 0.001 && bb.h < 0.001) return { x: bb.x, y: bb.y - 0.12 };
  return { x: bb.x + bb.w / 2, y: bb.y - 0.12 };
}

async function deselect(page: Page): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function placePlayer(page: Page, title: string, nx: number, ny: number, fit: 'contain' | 'height' = 'contain', tray = false): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  const isPlayerTool = title === 'Jugador propio' || title === 'Jugador rival';
  if (tray) {
    await page.locator(`.tray-player[title="${title}"]`).click(); // ya es 'Jugador <Color>'
  } else if (isPlayerTool) {
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
  } else {
    await page.locator(`.rail-btn[title="${title}"]`).click();
  }
  // FASE B: cerrar el panel Jugadores con la X (no desarma) antes de tocar el campo,
  // porque ya no se cierra al elegir y taparía el punto en móvil/columnas a la izquierda.
  await page.locator('.side-panel-left .panel-close').click();
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box, fit);
  await page.mouse.click(x, y, { button: 'right' });
}

async function placeTrayPlayer(page: Page, title: string, nx: number, ny: number, fit: 'contain' | 'height' = 'contain'): Promise<void> {
  await placePlayer(page, title, nx, ny, fit, true);
}

async function placeMaterial(page: Page, tool: string, nx: number, ny: number, fit: 'contain' | 'height' = 'contain', variantIndex?: number): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  const card = page.locator('.tools-material-card', { has: page.locator(`.rail-btn[title="${tool}"]`) });
  const variantCount = await card.locator('.variant-swatch').count();
  if (variantIndex != null && variantCount > 0) {
    await card.locator('.variant-swatch').nth(variantIndex).click();
  }
  await page.locator(`.rail-btn[title="${tool}"]`).click();
  // FASE B: cerrar el panel Material con la X (no desarma) antes de tocar el campo.
  await page.locator('.side-panel-left.tools-panel-side .panel-close').click();
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box, fit);
  await page.mouse.click(x, y);
  await deselect(page);
}

async function dragDraw(page: Page, from: [number, number], to: [number, number], fit: 'contain' | 'height' = 'contain'): Promise<void> {
  const box = await hostBox(page);
  const [x1, y1] = normToScreen(from[0], from[1], box, fit);
  const [x2, y2] = normToScreen(to[0], to[1], box, fit);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

async function drawShape(page: Page, tool: string, from: [number, number], to: [number, number], colorIndex?: number, fill?: boolean, fit: 'contain' | 'height' = 'contain'): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator(`.rail-btn[title="${tool}"]`).click();
  if (colorIndex != null) await page.locator('.tools-caption .swatch').nth(colorIndex).click();
  if (fill != null) await page.locator('.tools-caption .chip', { hasText: fill ? 'Relleno' : 'Perímetro' }).click();
  // FASE B: cerrar el panel Dibujo con la X (no desarma) antes de arrastrar sobre el campo.
  await page.locator('.side-panel-left.tools-panel-side .panel-close').click();
  await dragDraw(page, from, to, fit);
}

async function placeText(page: Page, nx: number, ny: number, value: string, fit: 'contain' | 'height' = 'contain', select = false): Promise<void> {
  await useTool(page, 'Texto', 'Dibujo');
  // FASE B: cerrar el panel Dibujo con la X (no desarma) antes de tocar el campo.
  await page.locator('.side-panel-left.tools-panel-side .panel-close').click();
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box, fit);
  await page.mouse.click(x, y);
  const ta = page.locator('.studio-panel .inspector textarea');
  await ta.fill(value);
  await ta.dispatchEvent('change');
  await ta.evaluate((el) => (el as HTMLElement).blur());
  await page.waitForTimeout(120);
  if (!select) await deselect(page);
}

async function selectAt(page: Page, nx: number, ny: number, fit: 'contain' | 'height' = 'contain'): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box, fit);
  // Fase 3: selección del elemento (clic) → se abre el inspector de Propiedades.
  await page.mouse.click(x, y);
  await expect(page.locator('.inspector')).toBeVisible();
}

async function dragHandle(page: Page, from: [number, number], to: [number, number], fit: 'contain' | 'height' = 'contain'): Promise<void> {
  const box = await hostBox(page);
  const [fx, fy] = normToScreen(from[0], from[1], box, fit);
  const [tx, ty] = normToScreen(to[0], to[1], box, fit);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

async function dragRotHandle(page: Page, el: CanvasElement, fit: 'contain' | 'height' = 'contain'): Promise<void> {
  const [ccx, ccy] = elCenter(el);
  const h = rotHandle(el);
  const tx = Math.min(0.92, Math.max(0.08, ccx + 0.2));
  await dragHandle(page, [h.x, h.y], [tx, ccy], fit);
}

async function dragMove(page: Page, nx: number, ny: number, delta: [number, number], fit: 'contain' | 'height' = 'contain'): Promise<void> {
  const box = await hostBox(page);
  const [x1, y1] = normToScreen(nx, ny, box, fit);
  const [x2, y2] = normToScreen(nx + delta[0], ny + delta[1], box, fit);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
}

async function setInspNum(page: Page, label: string, value: string): Promise<void> {
  const input = page.locator('.studio-panel .inspector .field', { hasText: label }).locator('input');
  await input.fill(value);
  await input.press('Tab');
}

async function exportPngBuf(page: Page): Promise<Buffer> {
  const dlPromise = page.waitForEvent('download');
  await page.locator('[aria-label="Exportar"]').click();
  await expect(page.locator('.top-pop-export')).toBeVisible();
  await page.locator('.rail-btn[title="Descargar PNG"]').click();
  const dl = await dlPromise;
  const p = await dl.path();
  const buf = fs.readFileSync(p!);
  expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47');
  expect(buf.readUInt32BE(16)).toBe(1600);
  expect(buf.readUInt32BE(20)).toBe(1280);
  return buf;
}

// -------------------------------------------------------------
// Geom F7: comprobación de que las líneas interiores azules del F7
// aterrizan EXACTAMENTE en los laterales del área grande del F11.
// FASE 4/8b: el campo base F7 usa el medio campo F11 APISAADO (68 m en X,
// 52,5 m en Y) → rect canónico {x:4, y:4, w:59.58, h:46} (no 46 de ancho).
// -------------------------------------------------------------
const F7_RECT = { x: 4, y: 4, w: (92 * 68) / 105, h: 46 };
function f7OffsideX(): [number, number] {
  const p = { offside: [(68 - 40.32) / (2 * 68), 1 - (68 - 40.32) / (2 * 68)] as const };
  return [F7_RECT.x + p.offside[0] * F7_RECT.w, F7_RECT.x + p.offside[1] * F7_RECT.w];
}
function f11AreaSideX(): [number, number] {
  const boxHW = (40.32 / 68) / 2;
  return [F7_RECT.x + (0.5 - boxHW) * F7_RECT.w, F7_RECT.x + (0.5 + boxHW) * F7_RECT.w];
}

test.setTimeout(120_000);

test.describe('Fase 5 — capturas obligatorias (geom F7, líneas finas, texto, PNG sin marco, móvil, escala)', () => {
  // =====================================================================
  // 1. Campo base F7 — geometría perpendicular F7 sobre medio campo F11.
  // =====================================================================
  test('f7-horizontal, f7-vertical y f7-movil — F7 perpendicular sobre medio campo F11', async ({ page }) => {
    // Horizontal.
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await openProps(page);
    await expect(page.locator('.studio-panel [aria-label="Campo base"]')).toBeVisible();
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(250);
    // Geometría: las líneas interiores azules del F7 coinciden con los laterales
    // del área grande del F11 (mismo x en unidades de viewBox canónicas).
    const f7x = f7OffsideX();
    const f11x = f11AreaSideX();
    expect(Math.abs(f7x[0] - f11x[0])).toBeLessThan(0.001);
    expect(Math.abs(f7x[1] - f11x[1])).toBeLessThan(0.001);
    // Y sobre el SVG REAL renderizado: los <line> azules del F7 (offside)
    // comparten x con los laterales blancos del área grande del F11.
    const svg = await page.locator('.board-canvas svg').first().innerHTML();
    const blueXs: number[] = [];
    const reLine = /<line\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = reLine.exec(svg))) {
      const tag = m[0];
      if (tag.includes('stroke="#38bdf8"') && tag.includes('x1="') && tag.includes('x2="')) {
        const x1 = parseFloat(tag.match(/x1="([-\d.]+)"/)![1]);
        const x2 = parseFloat(tag.match(/x2="([-\d.]+)"/)![1]);
        if (Math.abs(x1 - x2) < 0.001) blueXs.push(x1); // línea vertical → offside
      }
    }
    expect(blueXs.length, 'líneas interiores (offside) azules del F7 en el SVG').toBe(2);
    // Las dos líneas azules caen en los laterales del área F11 (±0.05 tolerancia de píxel SVG).
    for (const bx of blueXs) {
      const hit = f11x.some((fx) => Math.abs(bx - fx) < 0.05);
      expect(hit, `línea offside azul en x=${bx} aterriza en el lateral blanco del área F11`).toBe(true);
    }
    await page.screenshot({ path: `${SHOTS}/f7-horizontal.png` });

    // Vertical.
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/f7-vertical.png` });

    // Móvil — el F7 completo y su geometría se ven mejor en "Campo completo"
    // (el modo "Llenar pantalla" recorta el ancho del campo y ocultaría parte
    // de la composición). Se documenta en el informe.
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoardMobile(page);
    await openProps(page);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(250);
    await page.locator('.studio-panel [aria-label="Cerrar panel"]').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    // Forzar campo completo para que el F7 se vea entero.
    await toggleFillScreen(page);
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/f7-movil.png` });
  });

  // =====================================================================
  // 2. Campo full y medio con líneas finas (0.3).
  // =====================================================================
  test('campo-full-grosor0.3 y campo-half-grosor0.3', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await openProps(page);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('full');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/campo-full-grosor0.3.png` });
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('half');
    await page.waitForTimeout(200);
    // Cerrar el panel para que la captura sea solo el campo.
    await page.locator('.studio-panel [aria-label="Cerrar panel"]').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${SHOTS}/campo-half-grosor0.3.png` });
  });

  // =====================================================================
  // 3. Texto: corto / largo / multilínea, seleccionado y limpio.
  // =====================================================================
  test('texto-corto-selected y texto-corto-limpio', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeText(page, 0.5, 0.4, 'Pase', 'contain', true);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/texto-corto-selected.png` });
    await deselect(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/texto-corto-limpio.png` });
  });

  test('texto-largo-selected y texto-largo-limpio', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeText(page, 0.22, 0.35, 'Conservación en superioridad numérica con apoyo del mediocentro', 'contain', true);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/texto-largo-selected.png` });
    await deselect(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/texto-largo-limpio.png` });
  });

  test('texto-multilinea-selected y texto-multilinea-limpio', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeText(page, 0.3, 0.3, 'Rondos 4v2\nConservación\nPase en superioridad numérica', 'contain', true);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/texto-multilinea-selected.png` });
    await deselect(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/texto-multilinea-limpio.png` });
  });

  // =====================================================================
  // 4. Texto idéntico tras guardar + reabrir.
  // =====================================================================
  test('texto-tras-guardar-reabrir — el texto es idéntico tras guardar y reabrir', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeText(page, 0.4, 0.45, 'Rondo de pases en superioridad\n6 contra 2', 'contain');
    await expect(page.locator('.field-count')).toHaveText('1');
    await save(page);
    const a = await canvasDoc(page);
    const textA = a.frames[0].elements[0];
    expect(typeof textA.v).toBe('string');
    expect(textA.v).toContain('superioridad');
    await reopen(page);
    await expect(page.locator('.field-count')).toHaveText('1');
    await deselect(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/texto-tras-guardar-reabrir.png` });
    const b = await canvasDoc(page);
    expect(b.frames[0].elements[0].v).toBe(textA.v);
  });

  // =====================================================================
  // 5. PNG exportado SIN marco de edición (sin rect punteado).
  // =====================================================================
  test('png-sin-marco-edicion — el PNG exportado no lleva rectángulo punteado de edición', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeMaterial(page, 'Balón', 0.3, 0.4);
    await drawShape(page, 'Rectángulo', [0.5, 0.2], [0.7, 0.35], 0, false);
    await expect(page.locator('.field-count')).toHaveText('2');
    // Limpiar la selección para que nada esté activo.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const buf = await exportPngBuf(page);
    const p = `${SHOTS}/png-sin-marco-edicion.png`;
    fs.writeFileSync(p, buf);
    // El SVG de exportación (sin selectedId) no dibuja el rect punteado de edición.
    const svgHasEditRect = await page.evaluate(() => {
      const svg = document.querySelector('.entrenolab-board')!;
      return svg.querySelector('.text-edit-rect, .text-edit') !== null;
    });
    expect(svgHasEditRect, 'el render de la pizarra no debe conservar un rect de edición').toBe(false);
  });

  // =====================================================================
  // 6. Móvil — campo cerrado (llenar pantalla).
  // =====================================================================
  for (const [w, h] of [[360, 800], [390, 844], [430, 932]] as Array<[number, number]>) {
    test(`movil-cerrado-${w} — el campo llena el espacio usable`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoardMobile(page);
      await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
      // Un Portero para que la pizarra no esté vacía, sin abrir inspector.
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.locator('.tray-player[title="Jugador Azul"]').click();
      // FASE B (paneles persistentes): elegir un jugador NO cierra el panel Jugadores.
      await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
      // FASE B: cerrar el panel con la X (no desarma) para que el tap en el campo
      // (móvil retrato, centro bajo el panel) no quede interceptado.
      await page.locator('.side-panel-left .panel-close').click();
      const host = await hostBox(page);
      const [x, y] = normToScreen(0.5, 0.5, host, 'height');
      await page.mouse.click(x, y, { button: 'right' });
      await expect(page.locator('.field-count')).toHaveText('1');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/movil-cerrado-${w}.png` });
    });
  }

  // =====================================================================
  // 7. Móvil — cada menú abierto con el campo (y un objeto) visible.
  // =====================================================================
  for (const [w, h] of [[390, 844]] as Array<[number, number]>) {
    test(`movil-menu-jugadores ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoardMobile(page);
      await placePlayer(page, 'Jugador propio', 0.35, 0.4, 'height');
      await placeMaterial(page, 'Balón', 0.55, 0.55, 'height');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/movil-menu-jugadores.png` });
    });

    test(`movil-menu-material ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoardMobile(page);
      await placePlayer(page, 'Jugador propio', 0.35, 0.4, 'height');
      await placeMaterial(page, 'Balón', 0.55, 0.55, 'height');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/movil-menu-material.png` });
    });

    test(`movil-menu-dibujo ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoardMobile(page);
      // En "Llenar pantalla" el campo desborda el ancho del host: solo es visible
      // la banda central (~norm x 0.25–0.75). El rectángulo se dibuja DENTRO de
      // esa banda para que realmente quede en el campo visible.
      await drawShape(page, 'Rectángulo', [0.3, 0.2], [0.55, 0.36], 0, false, 'height');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/movil-menu-dibujo.png` });
    });

    test(`movil-menu-propiedades ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoardMobile(page);
      await placePlayer(page, 'Jugador propio', 0.4, 0.45, 'height');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await openProps(page);
      await page.screenshot({ path: `${SHOTS}/movil-menu-propiedades.png` });
    });
  }

  // =====================================================================
  // 8. Hoja de contactos — materiales a tamaño normalizado.
  // =====================================================================
  test('materiales-escala-normalizada — todos los materiales a su tamaño base normalizado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    const xs = [0.12, 0.31, 0.5, 0.69, 0.88];
    const ys = [0.13, 0.36, 0.59, 0.82];
    const recipe: Array<[string, number]> = [
      ['Balón', 0], ['Fitball', 0], ['Cono', 0], ['BOSU', 0], ['Banderín', 0],
      ['Chino', 0], ['Pica', 0], ['Pértiga / poste', 0], ['Maniquí individual', 0], ['Barrera de maniquíes', 0],
      ['Miniportería', 0], ['Portería grande', 0], ['Valla', 0], ['Aro', 0], ['Escalera', 0],
      ['Minitrampolín', 0], ['Peto', 0], ['Chaleco lastrado', 0], ['Mancuerna / pesa', 0],
    ];
    for (let i = 0; i < recipe.length; i++) {
      const [tool] = recipe[i];
      await placeMaterial(page, tool, xs[i % 5], ys[Math.floor(i / 5)], 'contain');
    }
    await expect(page.locator('.field-count')).toHaveText('19');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/materiales-escala-normalizada.png` });
  });

  // =====================================================================
  // 9. Ejercicio completo — jugadores + materiales + formas + texto multilínea.
  // =====================================================================
  test('ejercicio-completo — jugadores, materiales, línea, flecha, curva, zigzag, zona, círculo, rectángulo, texto multilínea', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    // Jugadores.
    await placePlayer(page, 'Jugador propio', 0.16, 0.2);
    await placePlayer(page, 'Jugador propio', 0.26, 0.16);
    await placeTrayPlayer(page, 'Jugador Rojo', 0.12, 0.6);
    await placeTrayPlayer(page, 'Jugador Rojo', 0.5, 0.82);
    // Materiales.
    await placeMaterial(page, 'Balón', 0.26, 0.42);
    await placeMaterial(page, 'Cono', 0.2, 0.5, 'contain', 1);
    // Formas.
    await drawShape(page, 'Línea', [0.12, 0.34], [0.34, 0.4], 0);
    await drawShape(page, 'Flecha (movimiento)', [0.36, 0.2], [0.56, 0.3], 1);
    await drawShape(page, 'Curva derecha', [0.6, 0.14], [0.82, 0.3], 2);
    await drawShape(page, 'Conducción (zigzag)', [0.56, 0.42], [0.78, 0.54], 1);
    // Fase 8: la herramienta "Zona" se retiró (no se crea desde la UI).
    await drawShape(page, 'Círculo / elipse', [0.12, 0.66], [0.26, 0.76], 3, true);
    await drawShape(page, 'Rectángulo', [0.34, 0.6], [0.48, 0.72], 0, false);
    // Texto multilínea.
    await placeText(page, 0.62, 0.3, 'Rondo 6v2\nConservación\nPase al apoyo', 'contain');

    await expect(page.locator('.field-count')).toHaveText('13');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/ejercicio-completo.png` });
  });

  // =====================================================================
  // 10. Antes / después — el "después" de mover + rotar + redimensionar.
  // (El "antes" se captura en fase4; aquí el objeto claramente transformado.)
  // =====================================================================
  test('antes-despues-objeto — objeto movido, rotado (±90° barra) y redimensionado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    // Rectángulo coloreado (contorno) para que se vea la transformación.
    await drawShape(page, 'Rectángulo', [0.6, 0.16], [0.8, 0.3], 2, false);
    await drawShape(page, 'Círculo / elipse', [0.62, 0.55], [0.78, 0.68], 1, false);
    await expect(page.locator('.field-count')).toHaveText('2');

    await save(page);
    const els0 = (await canvasDoc(page)).frames[0].elements;
    const rect = els0.find((e) => e.t === 'rect')!;
    await reopen(page);
    await page.waitForTimeout(200);

    // Mover el rectángulo (arrastre real desde el centro).
    const [ccx, ccy] = elCenter(rect);
    await selectAt(page, ccx, ccy);
    await dragMove(page, ccx, ccy, [-0.16, 0.14]);
    // Fase 3: el arrastre cierra el menú contextual; se REABRE con pulsación larga sobre el
    // rectángulo ya movido para usar la rotación ±90° (Fase 6: barra de contexto).
    const boxA = await hostBox(page);
    const [arx, ary] = normToScreen(ccx - 0.16, ccy + 0.14, boxA, 'contain');
    await longPress(page, arx, ary);
    const ctxRot = page.locator('.context-bar [aria-label="Girar 90° a la derecha"]');
    await expect(ctxRot).toBeVisible();
    await ctxRot.click();
    await setInspNum(page, 'Ancho', '28');
    await setInspNum(page, 'Alto', '20');
    await deselect(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/antes-despues-objeto.png` });

    // El modelo persiste la transformación (rot un paso EXACTO de ±90°).
    await save(page);
    const after = (await canvasDoc(page)).frames[0].elements.find((e) => e.t === 'rect')!;
    expect(after.rot).toBeCloseTo(90, 0);
    expect(Math.abs((after.x ?? 0) - (rect.x ?? 0))).toBeGreaterThan(0.05);
    expect(after.w ?? 0).toBeGreaterThan((rect.w ?? 0) + 0.02);
  });
});
