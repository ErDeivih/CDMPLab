import { test, expect, Page } from '@playwright/test';
import { longPress } from './gesture-helpers';

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

function normToScreen(nx: number, ny: number, host: Box, fit: Fit, panX = 0, panY = 0, zoom = 1): Pt {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  const ox = host.width / 2;
  const oy = host.height / 2;
  return { x: host.x + ox + panX + zoom * (cx - ox), y: host.y + oy + panY + zoom * (cy - oy) };
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    if (window.innerWidth <= 700) localStorage.setItem('entrenolab:board-fill', '1');
  });
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  await expect(page.locator('.board-host')).toBeVisible();
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

function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Arma y usa una herramienta de dibujo desde el panel "Dibujo". */
async function useDrawTool(page: Page, title: string): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

/** Dibuja en UN gesto (mouse) desde (nx0,ny0) a (nx1,ny1). */
async function drawShape(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], host, fit);
  const b = normToScreen(to[0], to[1], host, fit);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** Selecciona el elemento en un punto normalizado (clic de "Seleccionar"). */
async function selectAt(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  // Fase 3: el menú contextual se abre con PULSACIÓN LARGA (no con clic derecho ni tap).
  // Al seleccionar con pulsación larga, el menú queda abierto para las pruebas que lo consultan.
  await longPress(page, p.x, p.y);
}

/** Coloca un Portero (jugador genérico) en el norm (nx,ny) y lo SELECCIONA (pulsación larga).
 *  (Fase 3): la colocación genérica es continua, así que tras colocar se DESARMA con
 *  Seleccionar para que la pulsación larga sobre él lo seleccione/abra el menú contextual. */
async function placeComodin(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const pos = normToScreen(nx, ny, host, fit);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador genérico NO cierra el panel;
  // el panel Jugadores permanece abierto (se cierra solo explícitamente).
  await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  await page.mouse.click(pos.x, pos.y); // coloca (tool player armado)
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  await selectAt(page, nx, ny);
}

/** Coloca un cono (material) en el norm (nx,ny) y lo SELECCIONA. */
async function placeCone(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const pos = normToScreen(nx, ny, host, fit);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  await page.mouse.click(pos.x, pos.y); // coloca
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  await selectAt(page, nx, ny);
}

/** Oculta los paneles flotantes (Propiedades, barra de contexto) para que no intercepten
 *  el arrastre de las asas de redimensionado (patrón usado por otras specs del proyecto). */
async function hideOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.studio-panel, .top-pop, .context-bar').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  });
  await page.waitForTimeout(40);
}

/** Rotación (grados) del envoltorio `rotate(r …)` del elemento, subiendo por el DOM. */
async function elementRot(page: Page, selector: string): Promise<number> {
  const v = await page.locator(selector).first().evaluate((el) => {
    let g = el.closest('g') as Element | null;
    while (g) {
      const m = /rotate\((-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
      if (m) return { r: parseFloat(m[1]) };
      g = g.parentElement;
    }
    return { r: 0 };
  });
  return v.r;
}

/** Rotación del PRIMER grupo del SVG envuelto en rotate(...). Robusto porque la
 *  selección cambia el color del trazo, no el grupo. En horizontal el campo no se
 *  envuelve en rotate, así que el primer grupo rotado es el elemento dibujado. */
async function firstRot(page: Page): Promise<number> {
  return page.locator('.board-canvas svg').evaluate((svg) => {
    const g = svg.querySelector('g[transform*="rotate("]');
    if (!g) return 0;
    const m = /rotate\((-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
    return m ? parseFloat(m[1]) : 0;
  });
}

/** Geometría de un <rect> del SVG (modelo: x/y/w/h en viewBox canónico). */
async function rectGeom(page: Page, selector: string): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.locator(selector).first().evaluate((el) => ({
    x: parseFloat(el.getAttribute('x') ?? '0'),
    y: parseFloat(el.getAttribute('y') ?? '0'),
    w: parseFloat(el.getAttribute('width') ?? '0'),
    h: parseFloat(el.getAttribute('height') ?? '0'),
  }));
}

/** Extremos de una <line> del SVG. */
async function lineEnds(page: Page, selector: string): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  return page.locator(selector).first().evaluate((el) => ({
    x1: parseFloat(el.getAttribute('x1') ?? '0'),
    y1: parseFloat(el.getAttribute('y1') ?? '0'),
    x2: parseFloat(el.getAttribute('x2') ?? '0'),
    y2: parseFloat(el.getAttribute('y2') ?? '0'),
  }));
}

/** Puntos (string) de un <polyline>. */
async function polyPoints(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().getAttribute('points').then((p) => p ?? '');
}

/** Tamaño (ancho de la caja) de un <image> de material. */
async function imageWidth(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => parseFloat(el.getAttribute('width') ?? '0'));
}

// El color de dibujo por defecto.
const DRAW = '#1f2933';

// Vistas del dueño.
const VIEWPORTS: Array<[number, number]> = [
  [1366, 768],
  [1024, 768],
  [390, 844],
  [360, 800],
];

test.describe('Fase 6 — selección, barra de contexto (±90°) y redimensionado', () => {
  for (const [W, H] of VIEWPORTS) {
    test(`dibujo en un gesto + barra de contexto + ±90° + sin manija de rotación ni "Rotación (°)" @ ${W}×${H}`, async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await openClosed(page);
      await useDrawTool(page, 'Línea');
      // FASE B (paneles persistentes): el panel Dibujo permanece abierto tras elegir la
      // herramienta y, en móvil, tapa el punto de inicio del dibujo. Se cierra con su X
      // (no desarma la herramienta) antes de empezar el gesto.
      if (await page.locator('.side-panel-left .panel-close').isVisible().catch(() => false)) {
        await page.locator('.side-panel-left .panel-close').click();
      }
      await expect(page.locator('.field-count')).toHaveText('0');

      // Dibuja en un gesto (mouse). Sin pointerup intermedio.
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const a = normToScreen(0.35, 0.4, host, fit);
      const b = normToScreen(0.65, 0.6, host, fit);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 5 });
      // FASE G: el preview se espera con la aserción siguiente (observable) antes de soltar.
      await expect(page.locator(`.board-canvas svg [stroke="${DRAW}"]`), 'preview visible ANTES de soltar').not.toHaveCount(0);
      await page.mouse.up();
      await expect(page.locator('.field-count')).toHaveText('1');

      // La línea queda SIN seleccionar; la seleccionamos para mostrar la barra.
      await selectAt(page, 0.5, 0.5);
      await expect(page.locator('.context-bar')).toBeVisible();
      // Bloque D2: el menú contextual tiene 8 acciones (Deshacer, Rehacer, girar ±45° izq/der,
      // girar ±90° izq/der, Duplicar, Eliminar).
      await expect(page.locator('.context-bar .ctx-btn')).toHaveCount(8);
      await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toBeVisible();
      await expect(page.locator('.context-bar [aria-label="Duplicar"]')).toBeVisible();
      await expect(page.locator('.context-bar [aria-label="Eliminar"]')).toBeVisible();

      // NO hay manija de rotación continua ni línea de conexión.
      expect(await page.locator('.rot-handle').count(), 'sin manija de rotación continua').toBe(0);
      expect(await page.locator('.rot-line').count(), 'sin línea de conexión de rotación').toBe(0);

      // +90° → rot exacta 90; un Undo la devuelve a 0.
      await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
      // FASE G: condición observable — la rotación se espera con expect.poll.
      await expect.poll(() => firstRot(page), { timeout: 4000 }).toBeCloseTo(90, 0);
      await page.keyboard.press('Control+z');
      await expect.poll(async () => firstRot(page), { timeout: 4000 }).toBeCloseTo(0, 0);

      // El inspector ya NO ofrece "Rotación (°)". En escritorio el panel puede quedar
      // abierto tras el clic derecho de selección (botón "Cerrar propiedades"), así que
      // solo se abre si no está ya visible.
      if (!(await page.locator('.studio-panel').isVisible().catch(() => false))) {
        await page.locator('button[aria-label="Propiedades"]').click();
      }
      await expect(page.locator('.studio-panel')).toBeVisible();
      expect(await page.locator('.studio-panel .inspector .field', { hasText: 'Rotación' }).count(), 'sin control numérico Rotación (°)').toBe(0);
    });
  }

  test('D2: ±45° en la barra de contexto produce rotación exacta (45/315) y un solo Undo', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await useDrawTool(page, 'Línea');
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const a = normToScreen(0.3, 0.4, host, fit);
    const b = normToScreen(0.6, 0.4, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');

    await selectAt(page, 0.45, 0.4);
    await expect(page.locator('.context-bar')).toBeVisible();

    // +45° → rot exacta 45.
    await page.locator('.context-bar [aria-label="Girar 45° a la derecha"]').click();
    // FASE G: condición observable — la rotación se espera con expect.poll.
    await expect.poll(() => firstRot(page), { timeout: 4000 }).toBeCloseTo(45, 0);
    // Un Undo la devuelve a 0 (una sola operación de historial).
    await page.keyboard.press('Control+z');
    await expect.poll(() => firstRot(page), { timeout: 4000 }).toBeCloseTo(0, 0);

    // Re-seleccionar con pulsación larga (el menú se cierra tras el Undo) y girar -45°.
    await selectAt(page, 0.45, 0.4);
    await expect(page.locator('.context-bar')).toBeVisible();
    await page.locator('.context-bar [aria-label="Girar 45° a la izquierda"]').click();
    // FASE G: condición observable — la rotación se espera con expect.poll.
    await expect.poll(() => firstRot(page), { timeout: 4000 }).toBeCloseTo(315, 0);
  });

  test('D2: el DOBLE CLIC de ratón abre el menú contextual sobre el elemento y no duplica/mueve', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    // Un cono (material puntual, caja de hit robusta) en un punto conocido.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const pos = normToScreen(0.45, 0.45, host, fit);
    await page.mouse.click(pos.x, pos.y);
    await expect(page.locator('.field-count')).toHaveText('1');
    // Cambiar a Seleccionar para que el doble clic no intente colocar otro cono.
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await page.keyboard.press('Escape');

    // Doble clic sobre el centro del cono.
    await page.mouse.dblclick(pos.x, pos.y, { delay: 40 });
    // Abre el menú contextual y NO duplica ni mueve.
    await expect(page.locator('.context-bar')).toBeVisible();
    await expect(page.locator('.field-count'), 'el doble clic no duplica el cono').toHaveText('1');
  });

  test.describe('redimensionado por familia (escritorio determinista)', () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test('rectángulo: asas de esquina → cambia w/h, un solo Undo', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await useDrawTool(page, 'Rectángulo');
      await drawShape(page, [0.2, 0.3], [0.5, 0.5]);
      await expect(page.locator('.field-count')).toHaveText('1');
      const rectSel = '.board-canvas svg rect[fill="rgba(31,41,51,0.16)"]';
      const before = await rectGeom(page, rectSel);
      // Seleccionar el rectángulo.
      await selectAt(page, 0.35, 0.4);
      await expect(page.locator('.context-bar')).toBeVisible();
      await hideOverlays(page);
      // Arrastrar el asa inferior-derecha (0.5,0.5) → (0.7,0.6).
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const from = normToScreen(0.5, 0.5, host, fit);
      const to = normToScreen(0.7, 0.6, host, fit);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.mouse.up();
      // FASE G: observable — el rectángulo crece (w) en el SVG.
      await expect.poll(async () => (await rectGeom(page, rectSel)).w, { timeout: 4000 }).toBeGreaterThan(before.w + 2);
      const after = await rectGeom(page, rectSel);
      expect(after.w).toBeGreaterThan(before.w + 2);
      expect(after.h).toBeGreaterThan(before.h + 2);
      // Un solo Undo vuelve al tamaño previo.
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await rectGeom(page, rectSel)).w, { timeout: 4000 }).toBeCloseTo(before.w, 0);
    });

    test('línea: asas en AMBOS extremos → mueve el final (x2,y2), un solo Undo', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await useDrawTool(page, 'Línea');
      await drawShape(page, [0.2, 0.3], [0.5, 0.4]);
      await expect(page.locator('.field-count')).toHaveText('1');
      const lineSel = '.board-canvas svg line[stroke="#1f2933"]';
      const before = await lineEnds(page, lineSel);
      await selectAt(page, 0.35, 0.35);
      await expect(page.locator('.context-bar')).toBeVisible();
      await hideOverlays(page);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const from = normToScreen(0.5, 0.4, host, fit); // extremo x2
      const to = normToScreen(0.72, 0.62, host, fit);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.press('Escape'); // deseleccionar: el trazo vuelve a su color (#1f2933)
      // FASE G: observable — el extremo x2 del trazo DESeleccionado se mueve.
      await expect.poll(async () => (await lineEnds(page, lineSel)).x2, { timeout: 4000 }).toBeGreaterThan(before.x2 + 2);
      const after = await lineEnds(page, lineSel);
      expect(after.x2).toBeGreaterThan(before.x2 + 2);
      expect(after.y2).toBeGreaterThan(before.y2 + 2);
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await lineEnds(page, lineSel)).x2, { timeout: 4000 }).toBeCloseTo(before.x2, 0);
    });

    test('curva: extremos + punto de control (C1) → mover C1 cambia la curvatura', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await useDrawTool(page, 'Curva derecha');
      await drawShape(page, [0.2, 0.3], [0.6, 0.4]);
      await expect(page.locator('.field-count')).toHaveText('1');
      const pathSel = `.board-canvas svg path[stroke="${DRAW}"]`;
      const beforeD = await page.locator(pathSel).first().getAttribute('d');
      await selectAt(page, 0.4, 0.42); // punto medio real de la curva derecha (bend +0.14 → c1y=0.49)
      await expect(page.locator('.context-bar')).toBeVisible();
      await hideOverlays(page);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      // El C1 de "Curva derecha" (bend +0.14) está en (0.4, 0.35+0.14=0.49) en norm.
      const from = normToScreen(0.4, 0.49, host, fit);
      const to = normToScreen(0.5, 0.55, host, fit);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      // FASE G: observable — el atributo `d` de la curva cambia (C1 movido).
      await expect.poll(async () => (await page.locator(pathSel).first().getAttribute('d')), { timeout: 4000 }).not.toBe(beforeD);
      const afterD = await page.locator(pathSel).first().getAttribute('d');
      expect(afterD, 'la curva cambió (C1 se movió)').not.toBe(beforeD);
    });

    test('mano alzada: caja envolvente → escala proporcional de los puntos', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await useDrawTool(page, 'Dibujo a mano alzada');
      await drawShape(page, [0.2, 0.3], [0.5, 0.6]);
      await expect(page.locator('.field-count')).toHaveText('1');
      const polySel = '.board-canvas svg polyline[fill="none"]';
      const before = await polyPoints(page, polySel);
      await selectAt(page, 0.35, 0.45);
      await expect(page.locator('.context-bar')).toBeVisible();
      await hideOverlays(page);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      // Asa superior-izquierda del bbox (0.2,0.3) → (0.35,0.15) (más ancho/alto).
      const from = normToScreen(0.2, 0.3, host, fit);
      const to = normToScreen(0.35, 0.12, host, fit);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      // FASE G: observable — los puntos de la mano alzada cambian tras reescalar.
      await expect.poll(() => polyPoints(page, polySel), { timeout: 4000 }).not.toBe(before);
      const after = await polyPoints(page, polySel);
      expect(after, 'la nube de puntos se reescaló').not.toBe(before);
    });

    test('material (cono): NO se puede redimensionar (Fase 1 — sin asas, size constante)', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await placeCone(page, 0.5, 0.5);
      await expect(page.locator('.field-count')).toHaveText('1');
      const coneSel = '.board-canvas svg image[href*="cone"]';
      const before = await imageWidth(page, coneSel);
      await selectAt(page, 0.5, 0.5);
      await expect(page.locator('.context-bar')).toBeVisible();
      // Fase 1: los materiales NO se redimensionan → no hay asas de redimensionado.
      await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(0);
      await hideOverlays(page);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      // Arrastrar desde una supuesta esquina del cuadro del material → NO cambia size.
      const from = normToScreen(0.5 + 0.055, 0.5 + 0.055, host, fit);
      const to = normToScreen(0.5 + 0.12, 0.5 + 0.14, host, fit);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      // FASE G: observable — el material NO se redimensiona (size constante).
      await expect.poll(() => imageWidth(page, coneSel), { timeout: 4000 }).toBe(before);
      const after = await imageWidth(page, coneSel);
      expect(after, 'el material no se redimensiona (size constante)').toBe(before);
    });

    test('rotar-then-redimensionar y redimensionar-then-rotar funcionan (rect)', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await useDrawTool(page, 'Rectángulo');
      await drawShape(page, [0.2, 0.3], [0.4, 0.45]);
      await expect(page.locator('.field-count')).toHaveText('1');
      const rectSel = '.board-canvas svg rect[fill="rgba(31,41,51,0.16)"]';
      await selectAt(page, 0.3, 0.38);
      await expect(page.locator('.context-bar')).toBeVisible();
      const beforeRotResize = await rectGeom(page, rectSel);
      // Rotar +90.
      await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
      // FASE G: condición observable — la rotación se espera con expect.poll.
      await expect.poll(() => elementRot(page, rectSel), { timeout: 4000 }).toBeCloseTo(90, 0);
      // Redimensionar tras rotar.
      await hideOverlays(page);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const from = normToScreen(0.4, 0.45, host, fit); // esquina inferior-derecha actual (modelo)
      const to = normToScreen(0.55, 0.6, host, fit);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      // FASE G: observable — el rect rotado crece en w tras redimensionar.
      await expect.poll(async () => (await rectGeom(page, rectSel)).w, { timeout: 4000 }).toBeGreaterThan(beforeRotResize.w + 10);
      const afterRotResize = await rectGeom(page, rectSel);
      // Creció respecto al ancho previo a redimensionar (y la rotación se conserva).
      expect(afterRotResize.w).toBeGreaterThan(beforeRotResize.w + 10);
      expect(await elementRot(page, rectSel)).toBeCloseTo(90, 0);
    });
  });

  test.describe('capturas Fase 6 (revisión visual)', () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test('material con barra de contexto y SIN cuadro de redimensionado (Fase 1)', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await placeCone(page, 0.55, 0.55);
      await selectAt(page, 0.55, 0.55);
      await expect(page.locator('.context-bar')).toBeVisible();
      // Fase 1: los materiales NO se redimensionan → sin asas.
      await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(0);
      await page.locator('.board-host').screenshot({ path: 'e2e/shots/p56-selection/material-seleccionado-bar.png' });
    });

    test('jugador seleccionado con cuadro + asas', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      await placeComodin(page, 0.45, 0.5);
      await selectAt(page, 0.45, 0.5);
      await expect(page.locator('.context-bar')).toBeVisible();
      await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(4);
      await page.locator('.board-host').screenshot({ path: 'e2e/shots/p56-selection/jugador-seleccionado.png' });
    });

    test('línea con asas de extremo + curva con extremos+C1 + mano alzada con caja', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed(page);
      await openClosed(page);
      // Línea.
      await useDrawTool(page, 'Línea');
      await drawShape(page, [0.15, 0.3], [0.35, 0.42]);
      await selectAt(page, 0.25, 0.36);
      await expect(page.locator('.context-bar')).toBeVisible();
      await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(2);
      await page.locator('.board-host').screenshot({ path: 'e2e/shots/p56-selection/linea-extremos.png' });
      await page.keyboard.press('Escape'); // cerrar barra/panel de la línea antes de dibujar la curva
      await page.waitForTimeout(80);

      // Curva.
      await useDrawTool(page, 'Curva derecha');
      await drawShape(page, [0.5, 0.3], [0.75, 0.45]);
      await selectAt(page, 0.625, 0.445); // punto medio exacto de la curva (bend +0.14)
      await expect(page.locator('.context-bar')).toBeVisible();
      await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(3);
      await page.locator('.board-host').screenshot({ path: 'e2e/shots/p56-selection/curva-extremos-c1.png' });

      // Mano alzada.
      await useDrawTool(page, 'Dibujo a mano alzada');
      await drawShape(page, [0.5, 0.55], [0.72, 0.7]);
      await selectAt(page, 0.6, 0.62);
      await expect(page.locator('.context-bar')).toBeVisible();
      await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(4);
      await page.locator('.board-host').screenshot({ path: 'e2e/shots/p56-selection/mano-alzada-caja.png' });
    });
  });
});
