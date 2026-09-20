// =============================================================
// Fase 4 — REVISIÓN VISUAL FINAL de las capturas regeneradas.
// Genera en e2e/shots/fase4-final/ el juego de capturas que el dueño
// pide para PROBAR visualmente las tres correcciones (FASE 1 manijas,
// FASE 2 inspector con unidades, FASE 3 discoveribilidad móvil).
//
// Cada escena se construye con la UI real (paneles, herramientas,
// asas, variantes); solo el equipo y la plantilla se siembran por
// addInitScript. Tras generar, cada PNG se revisa con read_image
// (fuera de la suite) y se dictamina CORRECTO / DEFECTO.
//
// Geometría espejo del render (render.ts): el rect canónico 105×68 en
// el viewBox 100×80. Los helpers norm→pantalla y el mapeo de hit-test
// comparten las mismas constantes.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';
import { longPress, toggleFillScreen } from './gesture-helpers';

const SHOTS = 'e2e/shots/fase4-final';
fs.mkdirSync(SHOTS, { recursive: true });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en viewBox 100×80.
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
    // NO guardar la semilla con `seeded` para que cada test (contexto nuevo)
    // arranque con localStorage vacío y la pista de "Llenar pantalla" (única)
    // aparezca en la primera visita deseada.
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:orient-hint', '1'); // Fase 2: probar la pista sin el aviso de orientación
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
    await toggleFillScreen(page);
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
  await abrirHerramientas(page);
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

/** Coloca un texto y lo deja LIMPIO (sin manijas ni marco de edición). */
async function placeTextClean(page: Page, nx: number, ny: number, value: string): Promise<void> {
  await placeTextSelected(page, 'contain', nx, ny, value);
  // Ajustar al contenido para que ningún cuadro deje una línea recortada.
  const fitBtn = page.locator('.studio-panel .inspector-actions button', { hasText: 'Ajustar al contenido' });
  if (await fitBtn.isVisible().catch(() => false)) await fitBtn.click();
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await expect(page.locator('.studio-panel')).toHaveCount(0);
}

async function deselect(page: Page): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

/** Coloca un Portero (móvil) cerrando el panel, para que no se abra el inspector.
 *  Se coloca QUEDAMENTE por encima del centro: así en la captura el objeto queda
 *  claramente visible sin que la pista centrada lo tape. */
async function placeComodin(page: Page, host: Box, nx = 0.5, ny = 0.3): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador NO cierra el panel Jugadores.
  await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  // FASE B: cerrar el panel con la X (no desarma la colocación) para que el tap en el
  // campo, en móvil retrato, no quede interceptado por el panel persistente.
  await page.locator('.side-panel-left .panel-close').click();
  const c = normToScreen(nx, ny, host, 'height');
  await page.mouse.click(c[0], c[1]);
  await expect(page.locator('.field-count')).toHaveText('1');
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
    const resize = Array.from(svg.querySelectorAll('rect[fill="#ffffff"][stroke="#2563eb"]')).map((el) => ({
      x: num(el, 'x') + 1,
      y: num(el, 'y') + 1,
    }));
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

/** Verifica que las 4 asas de redimensionado de un texto están en las ESQUINAS del
 *  cuadro (no sobre el centro donde se dibujan los glifos). DECISIÓN DEL DUEÑO: se
 *  sustituye la antigua comprobación "fuera del bbox de glifos" (fragil: el leading
 *  de la fuente recortado al cuadro hacía coincidir las esquinas con el bbox) por
 *  una comprobación más robusta: asas en las esquinas, nunca sobre el centro. */
function assertResizeCorners(box: { x: number; y: number; w: number; h: number }, resize: Array<{ x: number; y: number }>): void {
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(resize[i].x - corners[i][0], resize[i].y - corners[i][1]);
    expect(d, `la asa de redimensionado ${i} está en la esquina del cuadro, no sobre los glifos`).toBeLessThan(2);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    expect(Math.hypot(resize[i].x - cx, resize[i].y - cy), `la asa ${i} no está sobre el centro del texto`).toBeGreaterThan(Math.min(box.w, box.h) * 0.2);
  }
}

/** ¿El segmento ENTRA en el INTERIOR del rectángulo visible (permite tocar el borde)? */
function segEntersRect(x1: number, y1: number, x2: number, y2: number, r: { x: number; y: number; w: number; h: number }): boolean {
  const e = 0.02;
  return segIntersectsRect(x1, y1, x2, y2, r.x + e, r.y + e, Math.max(0, r.w - 2 * e), Math.max(0, r.h - 2 * e));
}

/** Arrastra (arrastre de campo vacío = PANEAR la vista) hasta saturar el extremo que
 *  revela la portería `goal`. Un gesto hacia la DERECHA (+panX) revela la IZQUIERDA;
 *  hacia la IZQUIERDA (−panX) revela la DERECHA.
 *
 *  El campo en "Llenar pantalla" rellena la ALTURA del host (escala derivada del rect de
 *  contenido, no del viewBox), así que su ANCHO —y con él el RANGO de paneo `[min,max]` =
 *  ±(canvasWidth·zoom − hostWidth)/2— es MAYOR que antes: un único arrastre de borde a
 *  borde del host (≲ hostWidth−80 px) ya no basta para llegar a la portería. Por eso se
 *  repite el arrastre: cada arrastre vacío acumula panX (panX se suma desde su valor
 *  actual y queda clampeado al rango del contenido) hasta que el indicador del extremo
 *  buscado desaparece. No se debilita ninguna aserción: al terminar, el indicador del
 *  lado revelado debe estar oculto y el contrario visible (lo verifican los tests). */
async function panToGoal(page: Page, host: Box, goal: 'left' | 'right'): Promise<void> {
  // Fase 5: panear requiere la herramienta "Desplazar campo" (Mano); Seleccionar ya NO panea.
  await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
  const y = host.y + host.height / 2;
  const startX = goal === 'left' ? host.x + 40 : host.x + host.width - 40;
  const endX = goal === 'left' ? host.x + host.width - 40 : host.x + 40;
  const targetSel = goal === 'left' ? '.edge-pan-left' : '.edge-pan-right';
  // Ancho máximo de las iteraciones: cada arrastre aporta ~hostWidth−80 px de paneo y el
  // campo desborda menos de 3× el ancho del host en los móviles objetivo, así que 20
  // bastan con margen; el clamp evita pasarse y el bucle comprueba el indicador real.
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 8 });
    await page.mouse.up();
    // La señal panX → DOM (la @if retira el indicador) se aplica en el cambio de
    // detección: esperar a que el indicador objetivo desaparezca antes de reintentar.
    const done = await page
      .waitForFunction((sel) => !document.querySelector(sel), targetSel, { timeout: 400 })
      .then(() => true)
      .catch(() => false);
    if (done) return;
  }
}

test.setTimeout(120_000);

test.describe('Fase 4 — revisión visual final (capturas)', () => {
  // =====================================================================
  // 1. Texto multilínea seleccionado en el CENTRO: cuadro punteado + 4 asas
  //    de redimensionado, SIN manija de rotación continua, sin glifo tapado.
  //    (DECISIÓN DEL DUEÑO Fase 6: la manija de rotación fue retirada.)
  // =====================================================================
  test('texto-seleccionado-centro', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.45, 0.5, 'Rondos 4v2\nConservación\nPase al apoyo');
    const g = await readHandleGeom(page);
    expect(g, 'deben existir el <text> y el cuadro punteado').toBeTruthy();
    const { box, resize, outline, rotHandles } = g!;
    // El cuadro punteado existe y las 4 asas están en las ESQUINAS del cuadro (no sobre los glifos).
    expect(box.w, 'el cuadro punteado (.text-edit-rect) está presente').toBeGreaterThan(0);
    expect(resize, 'hay exactamente 4 asas de redimensionado').toHaveLength(4);
    assertResizeCorners(box, resize);
    // La antigua manija/línea de rotación continua NO existen (decisión del dueño).
    expect(rotHandles, 'sin manija de rotación continua').toBe(0);
    // Y no hay círculos de contorno de selección sobre el texto.
    expect(outline, 'no hay ningún círculo de selección sobre el texto').toHaveLength(0);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-seleccionado-centro.png` });
  });

  // =====================================================================
  // 2. Texto junto al borde superior del campo: cuadro punteado + 4 asas,
  //    sin manija de rotación continua, glifos limpios.
  // =====================================================================
  test('texto-seleccionado-superior', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.22, 0.02, 'Rondos 4v2\nConservación\nPase en superioridad numérica');
    const g = await readHandleGeom(page);
    expect(g, 'deben existir el <text> y el cuadro punteado').toBeTruthy();
    const { box, resize, outline, rotHandles } = g!;
    expect(box.w, 'el cuadro punteado (.text-edit-rect) está presente').toBeGreaterThan(0);
    expect(resize, 'hay exactamente 4 asas de redimensionado').toHaveLength(4);
    assertResizeCorners(box, resize);
    expect(rotHandles, 'sin manija de rotación continua').toBe(0);
    expect(outline, 'no hay ningún círculo de selección sobre el texto').toHaveLength(0);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-seleccionado-superior.png` });
  });

  // =====================================================================
  // 3. Inspector con UNIDADES humanas: Ancho (%) y Alto (%) con UNA sola
  //    decimal, Tamaño (u.) y la acción "Ajustar al contenido". DECISIÓN DEL
  //    DUEÑO (Fase 6): el control numérico "Rotación (°)" fue retirado.
  //    NUNCA decimales largos (p. ej. 0,17287404092071612).
  // =====================================================================
  test('inspector-unidades', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextSelected(page, 'contain', 0.42, 0.4, 'Rondos 4v2\nConservación\nPase al apoyo');
    // Ajustar al contenido → el cuadro queda EXACTAMENTE al texto (w/h con decimal).
    const fitBtn = page.locator('.studio-panel .inspector-actions button', { hasText: 'Ajustar al contenido' });
    await expect(fitBtn).toBeVisible();
    await fitBtn.click();
    await page.waitForTimeout(150);

    // Los campos del inspector usan ARIA-labels y NO muestran decimales largos.
    const wIn = page.locator('.studio-panel input[aria-label="Ancho en porcentaje"]');
    const hIn = page.locator('.studio-panel input[aria-label="Alto en porcentaje"]');
    await expect(wIn).toBeVisible();
    await expect(hIn).toBeVisible();
    // Tamaño (u.), contexto de rotación (±90° en el menú — Fase 3: clic derecho) y la acción.
    await expect(page.locator('.studio-panel .inspector .field', { hasText: 'Tamaño (u.)' })).toBeVisible();
    await expect(page.locator('.studio-panel .inspector .field', { hasText: 'Rotación (°)' })).toHaveCount(0);
    const editBox = await page.locator('.text-edit-rect').boundingBox();
    await longPress(page, editBox.x + editBox.width / 2, editBox.y + editBox.height / 2);
    await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toBeVisible();
    await expect(fitBtn).toBeVisible();

    const wVal = ((await wIn.inputValue()) ?? '').trim();
    const hVal = ((await hIn.inputValue()) ?? '').trim();
    console.log(`[fase4 inspector-unidades] Ancho="${wVal}" Alto="${hVal}"`);
    // Solo UNA decimal como máximo (admite coma o punto), nunca más de una.
    const oneDecimal = (v: string) => /^\d+(?:[.,]\d{1,2})?$/.test(v);
    expect(oneDecimal(wVal), `Ancho "${wVal}" tiene como mucho UNA decimal`).toBe(true);
    expect(oneDecimal(hVal), `Alto "${hVal}" tiene como mucho UNA decimal`).toBe(true);
    // Y al menos una de las dos presenta un decimal (demuestra el redondeo).
    expect(/[.,]\d/.test(wVal) || /[.,]\d/.test(hVal), 'al menos un porcentaje muestra un decimal').toBe(true);
    // Nada de decimales largos (más de 3 cifras tras la coma/punto).
    expect(wVal, 'sin decimales largos en Ancho').not.toMatch(/[,.]\d{4,}/);
    expect(hVal, 'sin decimales largos en Alto').not.toMatch(/[,.]\d{4,}/);

    await page.screenshot({ path: `${SHOTS}/inspector-unidades.png` });
  });

  // =====================================================================
  // 4. Móvil "Llenar pantalla": ambos indicadores de contenido oculto + pista.
  // =====================================================================
  test('movil-llenar-pantalla-indicadores', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoardMobile(page);
    await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
    const host = await hostBox(page);
    await placeComodin(page, host);
    // Ambos indicadores visibles y la pista única visible.
    await expect(page.locator('.edge-pan-left')).toBeVisible();
    await expect(page.locator('.edge-pan-right')).toBeVisible();
    await expect(page.locator('.fill-hint')).toBeVisible();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOTS}/movil-llenar-pantalla-indicadores.png` });
  });

  // =====================================================================
  // 5. Móvil "Llenar pantalla" tras panear a una portería: el indicador
  //    correspondiente desaparece y la portería queda visible.
  // =====================================================================
  test('movil-llenar-pantalla-pan', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoardMobile(page);
    await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
    const host = await hostBox(page);
    await placeComodin(page, host);
    await expect(page.locator('.edge-pan-left')).toBeVisible();
    await expect(page.locator('.edge-pan-right')).toBeVisible();
    // Panear hacia la DERECHA → se revela la portería IZQUIERDA → el indicador
    // IZQUIERDO desaparece.
    await panToGoal(page, host, 'left');
    await expect(page.locator('.edge-pan-left')).toBeHidden();
    await expect(page.locator('.edge-pan-right')).toBeVisible();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOTS}/movil-llenar-pantalla-pan.png` });
  });

  // =====================================================================
  // 6. Móvil "Campo completo": sin indicadores de contenido oculto.
  // =====================================================================
  test('movil-campo-completo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoardMobile(page);
    await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
    const host = await hostBox(page);
    await placeComodin(page, host);
    // Desarmar la colocación continua para que la pista (.placement-hint) no intercepte
    // el clic sobre el conmutador de campo.
    await page.keyboard.press('Escape');
    // Cambiar a Campo completo: caben todo → sin pan → sin indicadores.
    await toggleFillScreen(page);
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
    await expect(page.locator('.edge-pan-left')).toBeHidden();
    await expect(page.locator('.edge-pan-right')).toBeHidden();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/movil-campo-completo.png` });
  });

  // =====================================================================
  // 7. Texto corto limpio (sin marco de edición, texto completo).
  // =====================================================================
  test('texto-corto', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextClean(page, 0.5, 0.4, 'Pase');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-corto.png` });
  });

  // =====================================================================
  // 8. Texto multilínea limpio (sin marco de edición, texto completo).
  // =====================================================================
  test('texto-multilinea', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoardDesktop(page);
    await placeTextClean(page, 0.35, 0.3, 'Rondos 4v2\nConservación\nPase en superioridad numérica');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-multilinea.png` });
  });
});
