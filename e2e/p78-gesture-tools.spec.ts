import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

// Capturas de las fases 7-9 (pulsación larga abre el menú contextual → Duplicar, Mano, papelera).
const SHOTS = 'e2e/shots/p78-gesture-tools';
fs.mkdirSync(SHOTS, { recursive: true });

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en HORIZONTAL. */
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

async function seed(page: Page, opts: { fill?: 'fill' | 'contain' } = {}): Promise<void> {
  const { fill = 'fill' } = opts;
  await page.addInitScript(({ fill }) => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    // Modo de pantalla: '1' = Llenar pantalla (permite paneo con la herramienta Mano).
    localStorage.setItem('entrenolab:board-fill', fill === 'fill' ? '1' : '0');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    // Suprimir los hints flotantes (ayuda general y pista de "Llenar pantalla") para
    // que no tapen el campo en las capturas.
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  }, { fill });
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(200);
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

/** Despacha un PointerEvent sintético sobre `.board-host` (puntero táctil). */
async function ptr(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number, pointerId: number, isPrimary = false): Promise<void> {
  await page.evaluate(({ type, x, y, pointerId, isPrimary }) => {
    const host = document.querySelector('.board-host') as HTMLElement | null;
    if (!host) return;
    const up = type === 'pointerup' || type === 'pointercancel';
    host.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        isPrimary,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: up ? 0 : 1,
      })
    );
  }, { type, x, y, pointerId, isPrimary });
}

/** Un TAP táctil (down+up sin moverse) en (x,y). */
async function tap(page: Page, x: number, y: number, id = 7): Promise<void> {
  await ptr(page, 'pointerdown', x, y, id, true);
  await ptr(page, 'pointerup', x, y, id);
}

/** Lee panX/panY/zoom del transform inline del `.board-canvas`. */
async function readView(page: Page): Promise<{ panX: number; panY: number; zoom: number }> {
  return page.locator('.board-canvas').evaluate((el) => {
    const t = (el as HTMLElement).style.transform;
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
    return m ? { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { panX: 0, panY: 0, zoom: 1 };
  });
}

/** Centro en PANTALLA (page coords) del bounding box de un selector del SVG.
 *  Usa `getBoundingClientRect()` vía evaluate (robusto para SVG), en vez de
 *  `locator.boundingBox()`, que devuelve null de forma intermitente en SVG. */
async function objectScreen(page: Page, selector: string): Promise<Pt> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout: 5000 });
  const b = await loc.evaluate((el) => {
    const r = (el as SVGGraphicsElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Norm (0..1) de un elemento leído del `translate` de su <g> más cercano. */
async function objectNorm(page: Page, selector: string): Promise<Pt> {
  const v = await page.locator(selector).first().evaluate((el) => {
    const g = el.closest('g');
    const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  });
  expect(v, `el objeto (${selector}) debe estar renderizado con translate`).not.toBeNull();
  return { x: (v!.x - RECT.x) / RECT.w, y: (v!.y - RECT.y) / RECT.h };
}

/** Norm de un material <image> (asset PNG): el centro se codifica en x/y + width/height. */
async function imageNorm(page: Page, selector: string): Promise<Pt> {
  const v = await page.locator(selector).first().evaluate((el) => {
    const w = parseFloat(el.getAttribute('width') ?? '0');
    const h = parseFloat(el.getAttribute('height') ?? '0');
    const x = parseFloat(el.getAttribute('x') ?? '0');
    const y = parseFloat(el.getAttribute('y') ?? '0');
    return { x: x + w / 2, y: y + h / 2 };
  });
  return { x: (v.x - RECT.x) / RECT.w, y: (v.y - RECT.y) / RECT.h };
}

/** Coloca un Portero (jugador genérico) en el norm (nx,ny). Devuelve su centro en pantalla.
 *  (Fase 3): la colocación de genéricos es CONTINUA, así que tras colocar este helper
 *  vuelve a "Seleccionar" para que el test que continúa opere sobre el objeto.) */
async function placeComodinAt(page: Page, nx: number, ny: number): Promise<Pt> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador genérico NO cierra el panel.
  await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(nx, ny, host, fit);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  return objectScreen(page, '.entrenolab-board circle[r="2.5"]');
}

/** Coloca un Cono (material) en el norm (nx,ny); ciérra Propiedades si se abre.
 *  (Fase 3): la colocación es continua; este helper vuelve a "Seleccionar" al final. */
async function placeConeAt(page: Page, nx: number, ny: number): Promise<Pt> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(nx, ny, host, fit);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) {
    await page.locator('.studio-panel .panel-close').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
  }
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  return objectScreen(page, '.board-canvas svg image[href*="cone"]');
}

/** Coloca un jugador de PLANTILLA (roster, playerId) en el norm (nx,ny). */
async function placeRosterAt(page: Page, nx: number, ny: number): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.side-panel-left .roster-item').first().click();
  // FASE B (paneles persistentes): elegir un jugador de plantilla NO cierra el panel.
  await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(nx, ny, host, fit);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
}

/** Oculta los paneles flotantes (Propiedades y barra de contexto) para que no tapen el
 *  campo ni intercepten el arrastre (patrón usado por otras specs del proyecto). */
async function hideOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.studio-panel, .top-pop, .context-bar').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  });
  await page.waitForTimeout(40);
}

// Selectores reutilizados.
const PLAYER = '.entrenolab-board circle[r="2.5"]';
const CONE = '.board-canvas svg image[href*="cone"]';
const SEL = '.board-canvas svg [stroke="#2563eb"]';

// ============================================================================
// Fases 7-8-9: pulsación larga abre el menú contextual (Duplicar a mano),
// herramienta "Mano" y papelera accesible dentro del área de arrastre.
// ============================================================================

test.describe('Fases 7-9: pulsación larga abre el menú contextual, herramienta Mano y papelera', () => {
  test.use({ hasTouch: true });

  test('(a) un TAP corto sobre un objeto SOLO selecciona y NO duplica', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    const obj = await placeComodinAt(page, 0.5, 0.5);
    expect(await fieldCount(page)).toBe(1);
    // Tap corto sobre el objeto (sin mantener): un down+up inmediato NUNCA arma el
    // temporizador de pulsación larga (el up lo cancela), así que no hay que esperar
    // 300 ms. Se recalcula el centro en pantalla justo antes (bajo carga el objeto puede
    // moverse un frame respecto a la lectura de placeComodinAt y el tap debe aterrizar sobre él).
    const t = await objectScreen(page, PLAYER);
    await tap(page, t.x, t.y, 8);
    await expect(page.locator(SEL)).not.toHaveCount(0);
    expect(await fieldCount(page), 'un tap corto NO duplica').toBe(1);
    await expect(page.locator('.context-bar')).toHaveCount(0);   // nada se abre por long-press
  });

  test('(b) mantener ~600 ms abre el menú contextual y pulsa Duplicar (una vez) con un solo Undo', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await placeComodinAt(page, 0.5, 0.5);
    expect(await fieldCount(page)).toBe(1);
    // DEFECTO DE TEST CORREGIDO: el caso de tap corto recalcula el centro del objeto
    // justo antes de tocarlo porque, bajo carga, puede desplazarse un frame desde la
    // lectura de placeComodinAt. El caso de long-press reutilizaba las coordenadas de
    // colocación, así que el pointerdown podía caer FUERA del objeto y la pulsación
    // larga no abriría el menú. Se recalcula el centro inmediatamente antes del gesto
    // (sin subir timeouts ni tocar LONG_PRESS_MS).
    const t = await objectScreen(page, PLAYER);
    // Pulsación larga real: Fase 3 — abre el MENÚ CONTEXTUAL (no duplica solo).
    await ptr(page, 'pointerdown', t.x, t.y, 9, true);
    // Sin wait fijo: se espera de forma observable a que el temporizador de la
    // pulsación larga abra el menú contextual (el componente usa LONG_PRESS_MS).
    await expect.poll(() => page.locator('.context-bar').count(), { timeout: 2000 }).toBe(1);
    await ptr(page, 'pointerup', t.x, t.y, 9);
    await expect(page.locator('.context-bar')).toBeVisible();
    await expect(page.locator('.field-count'), 'el long-press solo abre el menú').toHaveText('1');
    // FASE 8 evidencia: la barra de contexto abierta por PULSACIÓN LARGA (Fase 3: el clic
    // derecho ya no la abre) con sus acciones Deshacer/Rehacer/girar/Duplicar/Eliminar.
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/barra-contexto-long-press.png` });
    // Duplicar desde el menú contextual.
    await page.locator('.context-bar .ctx-btn[title="Duplicar"]').click();
    await expect(page.locator('.field-count')).toHaveText('2');
    // La copia (desplazada) queda seleccionada.
    await expect(page.locator(SEL)).not.toHaveCount(0);
    // Captura del RESULTADO de la duplicación (los dos jugadores visibles).
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/long-press-duplicar.png` });
    // Una única deshacer vuelve a UN solo elemento (la colocación).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count'), 'un solo Undo deshace la duplicación').toHaveText('1');
  });

  test('(f) un MATERIAL genérico (cono) TAMBIÉN abre el menú contextual y se duplica desde él', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await placeConeAt(page, 0.5, 0.5);
    expect(await fieldCount(page)).toBe(1);
    const obj = await objectScreen(page, CONE);
    await ptr(page, 'pointerdown', obj.x, obj.y, 10, true);
    // Espera observable (sin waitForTimeout): el temporizador de la pulsación larga
    // abre el menú contextual mientras el dedo sigue bajado.
    await expect.poll(() => page.locator('.context-bar').count(), { timeout: 2000 }).toBe(1);
    await ptr(page, 'pointerup', obj.x, obj.y, 10);
    await expect(page.locator('.context-bar')).toBeVisible();
    await page.locator('.context-bar .ctx-btn[title="Duplicar"]').click();
    await expect(page.locator('.field-count'), 'el cono se duplica con la pulsación larga').toHaveText('2');
  });

  test('(c) un arrastre ANTES de completar el tiempo CANCELA la duplicación y MUEVE el objeto', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    const obj = await placeComodinAt(page, 0.5, 0.5);
    const before = await objectNorm(page, PLAYER);
    expect(await fieldCount(page)).toBe(1);
    // Baja, mueve (supera la tolerancia) y suelta ANTES de los 550 ms. Se RECALCULA el
    // centro en pantalla del objeto justo antes de bajar (bajo carga el render del objeto
    // puede moverse un frame respecto a la lectura inicial de placeComodinAt, y el puntero
    // debe aterrizar sobre él para que el arrastre lo mueva, no duplique).
    const down = await objectScreen(page, PLAYER);
    await ptr(page, 'pointerdown', down.x, down.y, 11, true);
    await ptr(page, 'pointermove', down.x + 55, down.y + 34, 11);
    await ptr(page, 'pointerup', down.x + 55, down.y + 34, 11);
    // Espera observable: el arrastre procesado mueve el objeto. Sin retardo fijo; si
    // quedara un timer de pulsación larga, se cancela por el move antes del umbral.
    await expect.poll(async () => {
      const n = await objectNorm(page, PLAYER);
      return Math.abs(n.x - before.x) + Math.abs(n.y - before.y);
    }, { timeout: 4000 }).toBeGreaterThan(0.005);
    const after = await objectNorm(page, PLAYER);
    expect(await fieldCount(page), 'un arrastre NO duplica').toBe(1);
    expect(Math.abs(after.x - before.x), 'el objeto se movió con el arrastre').toBeGreaterThan(0.005);
    expect(Math.abs(after.y - before.y), 'el objeto se movió con el arrastre (y)').toBeGreaterThan(0.005);
  });

  test('(d) un SEGUNDO dedo cancela la pulsación larga y empieza el pinch (sin duplicar)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    // Campo completo: el pinch central es determinista (en Llenar pantalla el zoom de un
    // spread corto variaba 1.10 vs >1.2 según el frame).
    await seed(page, { fill: 'contain' });
    await openClosed(page);
    const obj = await placeComodinAt(page, 0.5, 0.5);
    const host = await hostBox(page);
    const cy = host.y + host.height / 2;
    expect(await fieldCount(page)).toBe(1);
    // Dedo A baja sobre el objeto (arma la pulsación larga); el B baja enseguida (pinch).
    await ptr(page, 'pointerdown', obj.x, obj.y, 12, true);
    await ptr(page, 'pointerdown', obj.x + 120, cy, 13, false);
    await ptr(page, 'pointermove', obj.x, obj.y, 12);
    await ptr(page, 'pointermove', obj.x + 220, cy, 13);
    await ptr(page, 'pointerup', obj.x, obj.y, 12);
    await ptr(page, 'pointerup', obj.x + 220, cy, 13);
    // Espera observable: el pinch hace zoom (se procesó). El segundo dedo cancela el
    // temporizador de la pulsación larga (se limpia en pointerup), así que no hay
    // duplicación pendiente: verificamos el campo y el zoom, sin retardo fijo.
    await expect.poll(async () => (await readView(page)).zoom, { timeout: 4000 }).toBeGreaterThan(1.05);
    await expect(page.locator('.field-count'), 'el segundo dedo cancela la duplicación').toHaveText('1');
    const v = await readView(page);
    expect(v.zoom, 'el pinch sigue haciendo zoom').toBeGreaterThan(1.05);
  });

  test('(e) un jugador de PLANTILLA NO se duplica y muestra "Este jugador ya está en el campo"', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await placeRosterAt(page, 0.5, 0.5);
    expect(await fieldCount(page)).toBe(1);
    const obj = await objectScreen(page, PLAYER);
    await ptr(page, 'pointerdown', obj.x, obj.y, 14, true);
    // Espera observable (sin waitForTimeout): el temporizador abre el menú contextual.
    await expect.poll(() => page.locator('.context-bar').count(), { timeout: 2000 }).toBe(1);
    await ptr(page, 'pointerup', obj.x, obj.y, 14);
    await expect(page.locator('.context-bar')).toBeVisible();
    await expect(page.locator('.field-count'), 'el jugador de plantilla NO se duplica').toHaveText('1');
    // Duplicar desde el menú contextual: un jugador de plantilla está BLOQUEADO.
    await page.locator('.context-bar .ctx-btn[title="Duplicar"]').click();
    await expect(page.locator('.field-count'), 'el jugador de plantilla NO se duplica').toHaveText('1');
    await expect(page.locator('.board-notice')).toContainText('ya está en el campo');
  });

  test('(g) herramienta "Mano": arrastrar SOBRE un objeto (a zoom>100%) PANEA la vista y NUNCA lo selecciona/mueve', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await placeComodinAt(page, 0.5, 0.5);
    const beforeNorm = await objectNorm(page, PLAYER);
    // La herramienta "Mano" existe junto a "Seleccionar", con su aria-label.
    await expect(page.locator('.rail-btn[aria-label="Desplazar campo"]')).toBeVisible();
    // A zoom >100% hay contenido oculto que panear (el caso de uso del requisito).
    const zz = page.locator('.studio-panel .field', { hasText: 'Zoom' }).locator('input[type="range"]');
    await page.locator('button[aria-label="Propiedades"]').click();
    await zz.evaluate((input: HTMLInputElement) => {
      input.value = '2';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('.studio-panel .panel-close').click();
    await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
    await expect(page.locator('.board-host')).toHaveClass(/cursor-grab/);
    const obj = await objectScreen(page, PLAYER);
    const v0 = await readView(page);
    // Arrastra EMPEZANDO sobre el objeto (posiciones de pantalla).
    await page.mouse.move(obj.x, obj.y);
    await page.mouse.down();
    await page.mouse.move(obj.x + 80, obj.y - 40, { steps: 6 });
    await expect(page.locator('.board-host')).toHaveClass(/cursor-grabbing/);
    await page.mouse.up();
    // FASE G: observable — el paneo se espera con expect.poll del panX (no un wait fijo).
    await expect.poll(async () => Math.abs((await readView(page)).panX - v0.panX), { timeout: 5000 }).toBeGreaterThan(5);
    const v1 = await readView(page);
    expect(Math.abs(v1.panX - v0.panX), 'la herramienta Mano PANEA (panX cambia)').toBeGreaterThan(5);
    // El objeto NO se mueve ni se selecciona.
    const afterNorm = await objectNorm(page, PLAYER);
    expect(Math.abs(afterNorm.x - beforeNorm.x), 'el objeto no se mueve en x').toBeLessThan(0.005);
    expect(Math.abs(afterNorm.y - beforeNorm.y), 'el objeto no se mueve en y').toBeLessThan(0.005);
    expect(await page.locator('.studio-panel').count(), 'la Mano no abre Propiedades').toBe(0);
    expect(await page.locator(SEL).count(), 'la Mano no selecciona el objeto').toBe(0);
    expect(await fieldCount(page), 'la Mano no crea ni borra elementos').toBe(1);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/mano-paneo-campo.png` });
  });

  test('(h) papelera: soltar sobre ella ELIMINA (un solo Undo); moverse fuera antes de soltar NO elimina', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await placeConeAt(page, 0.55, 0.5);
    expect(await fieldCount(page)).toBe(1);
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    // Ocultar Propiedades/barra de contexto para que la captura muestre el campo limpio.
    await hideOverlays(page);
    const obj = await objectScreen(page, CONE);
    const trash = (await page.locator('.board-trash').boundingBox())!;

    // --- Parte 1: movimiento dentro de la papelera y soltar → elimina ---
    await page.mouse.move(obj.x, obj.y);
    await page.mouse.down();
    await expect(page.locator('.board-trash')).toHaveClass(/trash-visible/);
    await page.mouse.move(trash.x + trash.width / 2, trash.y + trash.height / 2, { steps: 6 });
    await expect(page.locator('.board-trash')).toHaveClass(/trash-hot/);
    // Ocultar los paneles recién creados por el pointerdown para que la captura sea limpia.
    await hideOverlays(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/objeto-entrando-papelera.png` });
    await page.mouse.up();
    await expect(page.locator('.field-count'), 'soltar sobre la papelera elimina').toHaveText('0');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count'), 'un solo Undo restaura el elemento').toHaveText('1');

    // --- Parte 2: acercarse a la papelera pero moverse FUERA antes de soltar → NO elimina ---
    const obj2 = await objectScreen(page, CONE);
    await page.mouse.move(obj2.x, obj2.y);
    await page.mouse.down();
    await page.mouse.move(trash.x + trash.width / 2, trash.y + trash.height / 2, { steps: 6 });
    await expect(page.locator('.board-trash')).toHaveClass(/trash-hot/);
    // Mover FUERA de la papelera antes de soltar.
    await page.mouse.move(obj2.x + 60, obj2.y - 20, { steps: 6 });
    await expect(page.locator('.board-trash')).not.toHaveClass(/trash-hot/);
    await page.mouse.up();
    await expect(page.locator('.field-count'), 'moverse fuera antes de soltar NO elimina').toHaveText('1');
  });

  test('(i) Escape a mitad de un arrastre CANCELA el gesto: no borra en la papelera, el objeto vuelve a su sitio y el historial queda intacto', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await placeConeAt(page, 0.55, 0.5);
    expect(await fieldCount(page)).toBe(1);
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await hideOverlays(page);
    // Posición del cono en PANTALLA: el material se mide por su caja real (su `<image>` no
    // lleva el `translate` en el `<g>`, así que `objectNorm` no sirve para materiales).
    const obj = await objectScreen(page, CONE);
    const distFromStart = async (): Promise<number> => {
      const n = await objectScreen(page, CONE);
      return Math.hypot(n.x - obj.x, n.y - obj.y);
    };
    const trash = (await page.locator('.board-trash').boundingBox())!;

    // Arrastre EN CURSO hasta la papelera (con el botón todavía bajado).
    await page.mouse.move(obj.x, obj.y);
    await page.mouse.down();
    await page.mouse.move(trash.x + trash.width / 2, trash.y + trash.height / 2, { steps: 6 });
    await expect(page.locator('.board-trash')).toHaveClass(/trash-hot/);
    // El cono ACOMPAÑA al puntero: hay un gesto de movimiento realmente en curso.
    await expect.poll(distFromStart, { timeout: 4000 }).toBeGreaterThan(20);

    // Escape con el gesto a medias: lo CANCELA y devuelve el objeto a su sitio.
    await page.keyboard.press('Escape');
    await expect(page.locator(CONE), 'el cono sigue en el campo').toHaveCount(1);
    await expect.poll(distFromStart, { timeout: 4000 }).toBeLessThan(2);

    // Soltar ENCIMA de la papelera ya NO borra: el gesto se canceló al pulsar Escape.
    await page.mouse.up();
    await expect(
      page.locator('.field-count'),
      'Escape cancela: soltar en la papelera no borra',
    ).toHaveText('1');
    expect(await distFromStart(), 'el objeto vuelve a su sitio').toBeLessThan(2);

    // El gesto cancelado NO deja entrada de historial: el primer Undo deshace la COLOCACIÓN
    // del cono (si el arrastre hubiera confirmado algo, el contador seguiría en 1).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count'), 'un Undo deshace la colocación').toHaveText('0');
  });

  test('(j) Escape con el botón BAJADO sobre un objeto mata también la pulsación larga pendiente', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await placeComodinAt(page, 0.5, 0.5);
    await hideOverlays(page);
    const obj = await objectScreen(page, PLAYER);
    // Bajar SIN moverse: se arma el temporizador de la pulsación larga (LONG_PRESS_MS = 550).
    await page.mouse.move(obj.x, obj.y);
    await page.mouse.down();
    await page.keyboard.press('Escape'); // cancela el gesto a media pulsación
    // Espera MAYOR que LONG_PRESS_MS: si el temporizador siguiera vivo, abriría la barra.
    await page.waitForTimeout(900);
    await expect(
      page.locator('.context-bar'),
      'Escape mata la pulsación larga pendiente',
    ).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('.field-count'), 'no se duplica ni se borra nada').toHaveText('1');
  });

  test('(extra) captura del tablero con la barra de herramientas (botón Mano visible)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    // Seleccionar la herramienta "Mano" para que aparezca activa en la barra inferior
    // y capturar el tablero completo (barra superior, campo y raíl de herramientas).
    await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
    await expect(page.locator('.rail-btn[aria-label="Desplazar campo"]')).toHaveClass(/rail-active/);
    await page.screenshot({ path: `${SHOTS}/tablero-barra-herramientas.png` });
  });
});
