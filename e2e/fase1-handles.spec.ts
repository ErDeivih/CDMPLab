// =============================================================
// Fase 1 — MANIJAS de selección de TEXTO que nunca tapen el contenido.
//
// DECISIÓN DEL DUEÑO (Fase 6): la manija de rotación continua (`.rot-handle`)
// con su línea de conexión (`.rot-line`) fue RETIRADA; la rotación es ahora
// EXACTAMENTE ±90° desde la barra de contexto. Esto reescribe los tests de
// manijas de rotación para verificar lo NUEVO: que la selección de un texto
// solo dibuja el cuadro punteado + las 4 asas de redimensionado FUERA de los
// glifos, que NO existe manija/línea de rotación, y que la rotación se hace
// con la barra de contexto (±90°) sin tapar el texto.
//
// Los helpers (seed, dismissHelp, openProps, useTool, normToScreen,
// placeText) se reutilizan/copian de final-board-gallery y
// fase5-captures.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { longPress } from './gesture-helpers';

const SHOTS = 'e2e/shots/fase1';
fs.mkdirSync(SHOTS, { recursive: true });
const SHOTS_E3 = 'e2e/shots/e3-text-circle';
fs.mkdirSync(SHOTS_E3, { recursive: true });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

/** Forward norm→pantalla (inversa de screenToNorm), horizontal. */
function normToScreen(nx: number, ny: number, box: Box, fit: 'contain' | 'height' = 'contain'): [number, number] {
  const s = fit === 'height' ? box.height / RECT.h : Math.min(box.width / VBW, box.height / VBH);
  const offX = (box.width - VBW * s) / 2;
  const offY = (box.height - VBH * s) / 2;
  const cx = offX + (nx * RECT.w + RECT.x) * s;
  const cy = offY + (ny * RECT.h + RECT.y) * s;
  return [box.x + cx, box.y + cy];
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

/** Escritorio: fuerza "Campo completo" para que el helper norm→pantalla (contain) coincida. */
async function openBoardDesktop(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await dismissHelp(page);
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}

/** Móvil: conserva el modo por defecto "Llenar pantalla". */
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
  if (category) await page.locator('.tools-cat', { hasText: category }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

/** Coloca un texto y lo deja SELECCIONADO (para que se vean manijas + línea). */
async function placeTextSelected(page: Page, fit: 'contain' | 'height' = 'contain', nx = 0.5, ny = 0.45, value = 'Texto'): Promise<void> {
  await useTool(page, 'Texto', 'Dibujo');
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box, fit);
  await page.mouse.click(x, y, { button: 'right' });
  // En móvil la creación NO auto-abre Propiedades (regresión cubierta por `e1-mobile-props`);
  // el editor del texto vive en el inspector, así que se abre explícitamente si hace falta.
  if (!(await page.locator('.studio-panel .inspector textarea').isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Propiedades"]').click();
  }
  const ta = page.locator('.studio-panel .inspector textarea');
  await ta.fill(value);
  await ta.dispatchEvent('change');
  await ta.evaluate((el) => (el as HTMLElement).blur());
  await page.waitForTimeout(150);
}

/** Lee de la UI la selección de un texto: bbox del `<text>` (`g.board-text text`),
 *  el cuadro de edición visible (`.text-edit-rect`), las asas de redimensionado y los
 *  círculos de contorno, TODO en el espacio del viewBox SVG. DECISIÓN DEL DUEÑO (Fase 6):
 *  la manija de rotación continua (`.rot-handle`) y su línea (`.rot-line`) fueron
 *  retiradas, así que NO se leen aquí (se cuenta su ausencia con `rotHandles`). */
async function readHandleGeom(page: Page): Promise<{
  rect: { x: number; y: number; w: number; h: number };
  box: { x: number; y: number; w: number; h: number };
  resize: Array<{ x: number; y: number }>;
  outline: Array<{ cx: number; cy: number; r: number }>;
  rotHandles: number;
} | null> {
  return page.evaluate(() => {
    const svg = document.querySelector('svg.entrenolab-board');
    const text = svg?.querySelector('g.board-text text');
    const editRect = svg?.querySelector('.text-edit-rect');
    if (!svg || !text || !editRect) return null;
    const num = (el: Element | null, attr: string) => Number((el?.getAttribute(attr) ?? '0'));
    const b = (text as SVGGraphicsElement).getBBox();
    // Asas de redimensionado: rects blancos con borde de selección (#2563eb).
    // Su centro (x+1, y+1) es la esquina del cuadro; se devuelve el centro.
    const resize = Array.from(svg.querySelectorAll('rect[fill="#ffffff"][stroke="#2563eb"]')).map((el) => ({
      x: num(el, 'x') + 1,
      y: num(el, 'y') + 1,
    }));
    // Círculos de contorno de selección (fill none + stroke #2563eb). El defecto
    // era un círculo así sobre el origen del texto; tras el fix no debe haber ninguno.
    const outline = Array.from(svg.querySelectorAll('circle[fill="none"][stroke="#2563eb"]')).map((el) => ({
      cx: num(el, 'cx'),
      cy: num(el, 'cy'),
      r: num(el, 'r'),
    }));
    return {
      rect: { x: b.x, y: b.y, w: b.width, h: b.height },
      box: { x: num(editRect, 'x'), y: num(editRect, 'y'), w: num(editRect, 'width'), h: num(editRect, 'height') },
      resize,
      outline,
      rotHandles: svg.querySelectorAll('.rot-handle').length,
    };
  });
}

/** ¿El segmento (x1,y1)-(x2,y2) intersecta el rectángulo? */
function segIntersectsRect(x1: number, y1: number, x2: number, y2: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const left = rx;
  const right = rx + rw;
  const top = ry;
  const bottom = ry + rh;
  const inside = (x: number, y: number) => x >= left && x <= right && y >= top && y <= bottom;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const onSeg = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
  const edges: Array<[number, number, number, number]> = [
    [left, top, right, top],
    [right, top, right, bottom],
    [right, bottom, left, bottom],
    [left, bottom, left, top],
  ];
  for (const [ax, ay, bx, by] of edges) {
    const o1 = orient(x1, y1, x2, y2, ax, ay);
    const o2 = orient(x1, y1, x2, y2, bx, by);
    const o3 = orient(ax, ay, bx, by, x1, y1);
    const o4 = orient(ax, ay, bx, by, x2, y2);
    if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    if (o1 === 0 && onSeg(x1, y1, x2, y2, ax, ay)) return true;
    if (o2 === 0 && onSeg(x1, y1, x2, y2, bx, by)) return true;
    if (o3 === 0 && onSeg(ax, ay, bx, by, x1, y1)) return true;
    if (o4 === 0 && onSeg(ax, ay, bx, by, x2, y2)) return true;
  }
  return false;
}

function intersectRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** ¿El segmento ENTRA en el INTERIOR del rectángulo visible (permite tocar el borde)? */
function segEntersRect(x1: number, y1: number, x2: number, y2: number, r: { x: number; y: number; w: number; h: number }): boolean {
  const e = 0.02;
  return segIntersectsRect(x1, y1, x2, y2, r.x + e, r.y + e, Math.max(0, r.w - 2 * e), Math.max(0, r.h - 2 * e));
}

type SelGeom = NonNullable<Awaited<ReturnType<typeof readHandleGeom>>>;

/**
 * Verifica que la selección de un TEXTO NO pinta NADA sobre los glifos. Lo único
 * que debe verse es: el cuadro punteado (`.text-edit-rect`) y las 4 asas de
 * redimensionado — todo FUERA del bbox visible de los glifos. DECISIÓN DEL DUEÑO
 * (Fase 6): la manija de rotación y su línea fueron retiradas, así que NO debe
 * haber ninguna (`rotHandles` debe ser 0). Rechaza cualquier círculo de contorno.
 */
function assertTextSelectionClean(g: SelGeom): void {
  const { box, resize, outline, rotHandles } = g;

  // El cuadro punteado existe (box procede de .text-edit-rect).
  expect(box.w, 'el cuadro punteado (.text-edit-rect) está presente').toBeGreaterThan(0);

  // Exactamente 4 asas de redimensionado, en las ESQUINAS del cuadro (nunca sobre el
  // centro del texto: el glifo vive en el centro, las asas en las esquinas).
  expect(resize, 'hay exactamente 4 asas de redimensionado').toHaveLength(4);
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(resize[i].x - corners[i][0], resize[i].y - corners[i][1]);
    expect(d, `la asa de redimensionado ${i} está en la esquina del cuadro, no sobre los glifos`).toBeLessThan(2);
    // Y NO está en el centro del cuadro (donde se dibujan los glifos).
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    expect(Math.hypot(resize[i].x - cx, resize[i].y - cy), `la asa ${i} no está en el centro del texto`).toBeGreaterThan(Math.min(box.w, box.h) * 0.2);
  }

  // DECISIÓN DEL DUEÑO: la manija de rotación continua fue retirada → no debe existir.
  expect(rotHandles, 'sin manija de rotación continua').toBe(0);

  // NO hay ningún círculo de contorno de selección (el defecto era un <circle>
  // relleno none + stroke #2563eb sobre el origen del texto).
  expect(outline, 'no hay ningún círculo de selección sobre el texto').toHaveLength(0);
}

// Texto MAYÚSCULAS (sin acentos ni ascendentes largos) para que el bbox de glifos
// quede DENTRO del cuadro (por debajo de su borde superior) y la prueba geométrica
// sea determinista.
const CAPS = 'RONDO 4V2\nPASE AL APOYO';

test.describe('Fase 1 — selección de texto: geometría (sin manija de rotación)', () => {
  for (const placement of [
    { name: 'texto en el centro', nx: 0.4, ny: 0.45 },
    { name: 'texto pegado al borde superior', nx: 0.2, ny: 0.02 },
  ]) {
    test(`la selección del texto NO pinta nada sobre los glifos (${placement.name})`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoardDesktop(page);
      await placeTextSelected(page, 'contain', placement.nx, placement.ny, CAPS);
      const g = await readHandleGeom(page);
      expect(g, 'deben existir el <text> y el cuadro punteado').toBeTruthy();
      // La selección NO pinta NADA sobre los glifos (cuadro + 4 asas fuera de los
      // glifos, sin manija/línea de rotación y CERO círculos de contorno).
      assertTextSelectionClean(g!);
    });
  }

  test('selección de texto limpia sobre los glifos (móvil, Llenar pantalla)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoardMobile(page);
    await placeTextSelected(page, 'height', 0.5, 0.42, CAPS);
    const g = await readHandleGeom(page);
    expect(g, 'deben existir el <text> y el cuadro punteado').toBeTruthy();
    // La selección NO pinta NADA sobre los glifos (cuadro + 4 asas fuera de los
    // glifos, sin manija/línea de rotación y CERO círculos de contorno).
    assertTextSelectionClean(g!);
  });

  test('texto ROTADO: la selección NO pinta ningún círculo sobre los glifos', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.5, 0.45, CAPS);
    // Girar EXACTAMENTE +90° desde el MENÚ CONTEXTUAL (Fase 3: se abre con pulsación larga).
    const hbox = await hostBox(page);
    await longPress(page, ...normToScreen(0.55, 0.5, hbox, 'contain'));
    const ctxRot = page.locator('.context-bar [aria-label="Girar 90° a la derecha"]');
    await expect(ctxRot).toBeVisible();
    await ctxRot.click();
    await page.waitForTimeout(120);

    const g = await readHandleGeom(page);
    expect(g, 'deben existir el <text> y el cuadro punteado').toBeTruthy();
    // Comprobación independiente de la rotación: la selección del texto rotado NO
    // pinta ningún círculo de contorno sobre los glifos, y la manija continua yace retirada.
    expect(g!.outline, 'no hay ningún círculo de selección sobre un texto rotado').toHaveLength(0);
    expect(g!.rotHandles, 'sin manija de rotación continua').toBe(0);
    expect(g!.box.w, 'el cuadro punteado sigue presente').toBeGreaterThan(0);

    // La rotación se aplicó realmente: el <text> queda envuelto en rotate(...).
    const rotated = await page.evaluate(() => {
      let el: Element | null = document.querySelector('g.board-text text');
      while (el) {
        const tf = el.getAttribute('transform');
        if (tf && tf.includes('rotate(')) {
          const m = tf.match(/rotate\((-?\d+(?:\.\d+)?)/);
          if (m) return Math.abs(parseFloat(m[1]));
        }
        el = el.parentElement;
      }
      return 0;
    });
    expect(rotated, 'el texto se ha rotado').toBeGreaterThan(1);
  });
});

test.describe('Fase 1 — capturas de la manija de rotación del texto (revisión visual)', () => {
  test('texto corto seleccionado en el centro', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.42, 0.5, 'Rondo 4v2');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-corto-centro.png` });
  });

  test('texto multilínea seleccionado pegado al borde superior (manija abajo)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.22, 0.02, 'Rondos 4v2\nConservación\nPase en superioridad numérica');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-multilinea-superior.png` });
  });

  test('texto multilínea seleccionado en la esquina superior-izquierda', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.03, 0.06, 'Rondos 4v2\nConservación\nPase al apoyo');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-multilinea-esquina.png` });
  });

  test('texto multilínea seleccionado en el centro', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.45, 0.5, 'Rondos 4v2\nConservación\nPase al apoyo');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-multilinea-centro.png` });
  });

  test('móvil (Llenar pantalla): texto largo seleccionado con la manija fuera del cuadro', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoardMobile(page);
    await placeTextSelected(page, 'height', 0.5, 0.42, 'Rondos 4v2 en superioridad\nConservación y pase al apoyo');
    // En móvil el panel de Propiedades tapa el campo al seleccionar; se oculta
    // solo visualmente (la selección vive en el modelo y no se pierde) para
    // poder ver la manija sobre el campo.
    await page.evaluate(() => {
      document.querySelectorAll('.studio-panel, .side-panel-backdrop, .top-pop, .top-panel-backdrop').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    });
    await page.waitForTimeout(80);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/movil-lleno-texto.png` });
  });
});

test.describe('Fase 3 — el círculo azul sobre el texto ya NO se dibuja (revisión visual)', () => {
  const hidePanels = (page: Page): Promise<void> =>
    page.evaluate(() => {
      document.querySelectorAll('.studio-panel, .side-panel-backdrop, .top-pop, .top-panel-backdrop').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    });

  test('texto corto seleccionado en el centro', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.42, 0.5, 'Rondo 4v2');
    await hidePanels(page);
    await page.waitForTimeout(80);
    await page.locator('.board-host').screenshot({ path: `${SHOTS_E3}/texto-corto-centro.png` });
  });

  test('texto multilínea seleccionado en el centro', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.45, 0.5, 'Rondos 4v2\nConservación\nPase al apoyo');
    await hidePanels(page);
    await page.waitForTimeout(80);
    await page.locator('.board-host').screenshot({ path: `${SHOTS_E3}/texto-multilinea-centro.png` });
  });

  test('texto multilínea pegado al borde superior (manija abajo)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.22, 0.02, 'Rondos 4v2\nConservación\nPase en superioridad numérica');
    await hidePanels(page);
    await page.waitForTimeout(80);
    await page.locator('.board-host').screenshot({ path: `${SHOTS_E3}/texto-borde-superior.png` });
  });

  test('texto rotado. seleccionado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.5, 0.45, 'Rondos 4v2\nConservación\nPase al apoyo');
    await hidePanels(page);
    await page.waitForTimeout(100);
    // Fase 3: el menú contextual se abre con pulsación larga.
    const hbox2 = await hostBox(page);
    await longPress(page, ...normToScreen(0.55, 0.5, hbox2, 'contain'));
    const ctxRot = page.locator('.context-bar [aria-label="Girar 90° a la derecha"]');
    await expect(ctxRot).toBeVisible();
    await ctxRot.click();
    await page.waitForTimeout(200);
    await page.locator('.board-host').screenshot({ path: `${SHOTS_E3}/texto-rotado.png` });
  });

  test('móvil (Llenar pantalla): texto largo seleccionado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoardMobile(page);
    await placeTextSelected(page, 'height', 0.5, 0.42, 'Rondos 4v2 en superioridad\nConservación y pase al apoyo');
    await hidePanels(page);
    await page.waitForTimeout(100);
    await page.locator('.board-host').screenshot({ path: `${SHOTS_E3}/movil-texto.png` });
  });
});
