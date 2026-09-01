import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import crypto from 'node:crypto';

// Capturas obligatorias del pinch del dueño (DEFECT 2) con indicador de zoom VERIFICABLE.
const SHOTS = 'e2e/shots/d2-pinch';
fs.mkdirSync(SHOTS, { recursive: true });

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en HORIZONTAL.
 *  `fit` = 'height' (llenar pantalla) | 'contain' (campo completo). */
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

async function seed(page: Page, opts: { orientation?: 'horizontal' | 'vertical' } = {}): Promise<void> {
  const { orientation = 'horizontal' } = opts;
  await page.addInitScript(({ orientation }) => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    // Móvil: modo "Llenar pantalla" (fill) por defecto; fijarlo explícitamente.
    localStorage.setItem('entrenolab:board-fill', '1');
    // Fase 2: este spec prueba la pista de "Llenar pantalla" en aislamiento; se descarta
    // el aviso de orientación para que la pista sea la única visible.
    localStorage.setItem('entrenolab:orient-hint', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation, grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, { orientation });
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
  // La pista de recorrido solo aparece TRAS descartar la ayuda (un tick después), así que
  // esperamos a que sea visible antes de intentar cerrarla.
  try {
    await page.locator('.fill-hint').waitFor({ state: 'visible', timeout: 2500 });
  } catch {
    /* la pista puede no llegar a mostrarse en algunos estados */
  }
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) {
    await page.locator('.fill-hint-close').click();
  }
  // Dejar la pizarra limpia de hints.
  await expect(page.locator('.board-help')).toBeHidden();
  await expect(page.locator('.fill-hint')).toBeHidden();
}

/** Abre la pizarra SIN descartar ningún hint (para capturar el estado de los hints). */
async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
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

/** Lee panX/panY/zoom del transform inline del `.board-canvas`. */
async function readView(page: Page): Promise<{ panX: number; panY: number; zoom: number }> {
  return page.locator('.board-canvas').evaluate((el) => {
    const t = (el as HTMLElement).style.transform;
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
    return m ? { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { panX: 0, panY: 0, zoom: 1 };
  });
}

/** Box en PANTALLA (page coords) del campo renderizado (el `<g class="entrenolab-grass">`).
 *  Al ser un hijo del SVG que escala con `.board-canvas`, su bbox refleja el zoom
 *  (comparación geométrica del área del campo). */
async function grassBox(page: Page): Promise<Box> {
  return page.locator('.entrenolab-grass').evaluate((el) => {
    const r = (el as SVGGraphicsElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** Centro en PANTALLA del bounding box de un selector del SVG. */
async function objectScreen(page: Page, selector: string): Promise<Pt> {
  const b = (await page.locator(selector).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Norm (0..1) de un elemento leído del `translate` de su <g> (posición canónica). */
async function objectNorm(page: Page, selector: string): Promise<Pt> {
  const v = await page.locator(selector).first().evaluate((el) => {
    const g = el.closest('g');
    const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  });
  expect(v, `el objeto (${selector}) debe estar renderizado con translate`).not.toBeNull();
  return { x: (v!.x - RECT.x) / RECT.w, y: (v!.y - RECT.y) / RECT.h };
}

/** Norm de un material <image> (asset PNG): centro en x/y + width/height del <image>. */
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

/** Nº de elementos del campo. */
function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Nº de hints flotantes visibles (0 o 1: nunca debe ser 2). La ayuda inicial fue
 *  retirada por el dueño (decisión Fase 1), así que el único hint es la pista de recorrido. */
async function visibleHints(page: Page): Promise<number> {
  let n = 0;
  if (await page.locator('.fill-hint').isVisible().catch(() => false)) n += 1;
  return n;
}

/** Despacha un PointerEvent sintético sobre `.board-host` (touch). */
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

async function tap(page: Page, x: number, y: number, id = 7): Promise<void> {
  await ptr(page, 'pointerdown', x, y, id, true);
  await ptr(page, 'pointerup', x, y, id);
}

/** Pinch simétrico alrededor de (cx,cy); `spreads` = distancias (px) entre dedos. */
async function twoFinger(page: Page, cx: number, cy: number, spreads: number[]): Promise<void> {
  const idA = 101;
  const idB = 102;
  const steps = spreads.map((s) => ({ a: { x: cx - s / 2, y: cy }, b: { x: cx + s / 2, y: cy } }));
  const first = steps[0];
  await ptr(page, 'pointerdown', first.a.x, first.a.y, idA, true);
  await ptr(page, 'pointerdown', first.b.x, first.b.y, idB, false);
  for (let i = 1; i < steps.length; i++) {
    await ptr(page, 'pointermove', steps[i].a.x, steps[i].a.y, idA);
    await ptr(page, 'pointermove', steps[i].b.x, steps[i].b.y, idB);
  }
  const last = steps[steps.length - 1];
  await ptr(page, 'pointerup', last.a.x, last.a.y, idA);
  await ptr(page, 'pointerup', last.b.x, last.b.y, idB);
}

// ---------- Colocación de objetos ----------

/** Coloca un Portero en un norm (horizontal) y devuelve su centro en pantalla. */
async function placeComodinAt(page: Page, nx: number, ny: number, expectCount = 1): Promise<Pt> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Portero"]').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(nx, ny, host, fit);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText(String(expectCount));
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) {
    await page.locator('.studio-panel .panel-close').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
  }
  return objectScreen(page, '.entrenolab-board circle[r="2.5"]');
}

/** Coloca un Portero en el CENTRO del host (funciona en horizontal y vertical). */
async function placeComodinAtCenter(page: Page, expectCount = 1): Promise<Pt> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Portero"]').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
  const host = await hostBox(page);
  await page.touchscreen.tap(host.x + host.width / 2, host.y + host.height / 2);
  await expect(page.locator('.field-count')).toHaveText(String(expectCount));
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) {
    await page.locator('.studio-panel .panel-close').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
  }
  return objectScreen(page, '.entrenolab-board circle[r="2.5"]');
}

/** Coloca un Cono (material) en un norm (horizontal) y devuelve su centro. */
async function placeConeAt(page: Page, nx: number, ny: number, expectCount = 1): Promise<Pt> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(nx, ny, host, fit);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText(String(expectCount));
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) {
    await page.locator('.studio-panel .panel-close').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
  }
  return objectScreen(page, '.board-canvas svg image[href*="cone"]');
}

/** Arma una colocación (Cono) sin colocar nada. */
async function armCone(page: Page): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
}

/** SHA-256 de un fichero (para probar que dos capturas NO son byte-idénticas). */
function sha256(path: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

// ============================================================================

test.describe('D2 — capturas obligatorias del pinch (DEFECT 2)', () => {
  test.use({ hasTouch: true });

  test('1. pinch-antes / pinch-despues: mismo campo antes y después, zoom CLARAMENTE distinto y verificado geométricamente', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);

    // Escena rica y estable: un Portero en el centro + un cono a su izquierda (iguales en ambas capturas).
    await placeComodinAt(page, 0.5, 0.5, 1);
    await placeConeAt(page, 0.35, 0.5, 2);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const beforeCount = await fieldCount(page);
    expect(beforeCount, 'escena con dos objetos (Portero + cono)').toBe(2);
    // Posiciones canónicas de los objetos: el pinch NO debe moverlas (solo cambia la VISTA).
    const comodinBefore = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    const coneBefore = await imageNorm(page, '.board-canvas svg image[href*="cone"]');

    // Estado VISTA pura antes del pinch (zoom = 100%).
    const beforeView = await readView(page);
    expect(beforeView.zoom, 'zoom inicial').toBeCloseTo(1, 2);
    const beforeGrass = await grassBox(page);

    const antesPath = `${SHOTS}/pinch-antes.png`;
    await page.waitForTimeout(60);
    await page.locator('.board-host').screenshot({ path: antesPath });

    // Pinch simétrico de acercar: separa de 80 a 200 px → zoom ≈ 2.5×.
    await twoFinger(page, cx, cy, [80, 200]);
    const afterView = await readView(page);
    const afterGrass = await grassBox(page);
    const afterCount = await fieldCount(page);

    const despuesPath = `${SHOTS}/pinch-despues.png`;
    await page.waitForTimeout(60);
    await page.locator('.board-host').screenshot({ path: despuesPath });

    // --- VERIFICACIÓN GEOMÉTRICA del zoom (no basta con que las imágenes difieran) ---
    const zoomRatio = afterView.zoom / beforeView.zoom;
    console.log(`[d2-antes/después] zoom ${beforeView.zoom.toFixed(2)}→${afterView.zoom.toFixed(2)} (ratio ${zoomRatio.toFixed(2)}); grass w ${beforeGrass.width.toFixed(0)}→${afterGrass.width.toFixed(0)}`);
    expect(zoomRatio, 'el pinch debe multiplicar el zoom ≥ 1.8×').toBeGreaterThan(1.8);
    expect(afterView.zoom, 'zoom acotado (máx 300%)').toBeLessThanOrEqual(3.01);
    // El área del campo (bbox del césped) crece con el ratio de zoom: comparación geométrica.
    const grassRatio = afterGrass.width / beforeGrass.width;
    expect(grassRatio, 'el ancho del campo crece con el pinch').toBeGreaterThan(1.5);
    expect(Math.abs(grassRatio - zoomRatio), 'el área del campo crece proporcional al zoom').toBeLessThan(0.25);

    // --- Las dos capturas NO pueden ser idénticas (una imagen byte-idéntica no prueba el pinch) ---
    expect(afterView.zoom, 'zoom distinto del inicial').not.toBeCloseTo(beforeView.zoom, 2);
    const h1 = sha256(antesPath);
    const h2 = sha256(despuesPath);
    console.log(`[d2-antes/después] sha256 antes=${h1.slice(0, 12)} después=${h2.slice(0, 12)}`);
    expect(h1, 'las capturas antes/después deben diferir byte a byte').not.toBe(h2);

    // --- EL MISMO tablero: la única diferencia es el zoom. Objetos intactos, sin elementos
    //     creados/borrados y sin Propiedades abierta. (El "es solo vista" sin undo/dirty se
    //     verifica en e-pinch-zoom.test 1, sobre una pizarra limpia; aquí hay objetos colocados.) ---
    const comodinAfter = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    const coneAfter = await imageNorm(page, '.board-canvas svg image[href*="cone"]');
    expect(Math.abs(comodinAfter.x - comodinBefore.x), 'el Portero no se mueve en x').toBeLessThan(0.005);
    expect(Math.abs(comodinAfter.y - comodinBefore.y), 'el Portero no se mueve en y').toBeLessThan(0.005);
    expect(Math.abs(coneAfter.x - coneBefore.x), 'el cono no se mueve en x').toBeLessThan(0.005);
    expect(Math.abs(coneAfter.y - coneBefore.y), 'el cono no se mueve en y').toBeLessThan(0.005);
    expect(afterCount, 'ningún elemento creado/borrado por el pinch').toBe(beforeCount);
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir Propiedades').toBe(0);
  });

  test('2. pinch-sobre-objeto: ambos dedos sobre/pegados al objeto → el objeto queda INTACTO y el zoom cambia', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const obj = await placeComodinAt(page, 0.5, 0.5);
    const beforeNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    const beforeCount = await fieldCount(page);
    expect(beforeCount).toBe(1);
    await expect(page.locator('.studio-panel')).toHaveCount(0);

    const cy = host.y + host.height / 2;
    // Dedo A cae DIRECTAMENTE sobre el objeto; el B cae a 120px a la derecha (fuera del objeto).
    await ptr(page, 'pointerdown', obj.x, obj.y, 101, true);
    await ptr(page, 'pointerdown', obj.x + 120, cy, 102, false);
    await ptr(page, 'pointermove', obj.x, obj.y, 101);
    await ptr(page, 'pointermove', obj.x + 210, cy, 102);
    await ptr(page, 'pointerup', obj.x, obj.y, 101);
    await ptr(page, 'pointerup', obj.x + 210, cy, 102);

    const afterView = await readView(page);
    const afterNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    console.log(`[d2-objeto] zoom ${afterView.zoom.toFixed(2)}; norm antes=(${beforeNorm.x.toFixed(4)},${beforeNorm.y.toFixed(4)}) después=(${afterNorm.x.toFixed(4)},${afterNorm.y.toFixed(4)})`);
    expect(afterView.zoom, 'el pinch debe haber cambiado el zoom').toBeGreaterThan(1.2);
    expect(Math.abs(afterNorm.x - beforeNorm.x), 'x del objeto intacto').toBeLessThan(0.005);
    expect(Math.abs(afterNorm.y - beforeNorm.y), 'y del objeto intacto').toBeLessThan(0.005);
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir Propiedades').toBe(0);
    expect(await fieldCount(page), 'ni crear ni borrar elementos').toBe(beforeCount);

    const path = `${SHOTS}/pinch-sobre-objeto.png`;
    await page.waitForTimeout(60);
    await page.locator('.board-host').screenshot({ path });
    expect(fs.existsSync(path), 'captura pinch-sobre-objeto').toBe(true);
  });

  test('3. pinch-con-herramienta-armada: Cono armado + pinch → NO se crea nada, la herramienta sigue armada', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await armCone(page);
    await expect(page.locator('.field-count')).toHaveText('0');
    await expect(page.locator('.placement-hint')).toBeVisible();
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;

    // Pinch sobre campo vacío con la herramienta Cono armada.
    await twoFinger(page, cx, cy, [80, 220]);
    expect(await fieldCount(page), 'el pinch NO debe crear ningún cono').toBe(0);
    expect(await page.locator('.placement-hint').count(), 'la herramienta debe seguir armada tras el pinch').toBe(1);
    await expect(page.locator('.placement-hint'), 'la pista indica la colocación del Cono').toBeVisible();
    await expect(page.locator('.placement-hint'), 'la pista indica la colocación del Cono').toContainText('Cono');
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir Propiedades').toBe(0);
    expect((await readView(page)).zoom, 'el pinch debe haber hecho zoom').toBeGreaterThan(1.2);

    // Captura del área del campo COMPLETA (incluye el banner "Cono" armado en la parte
    // superior del campo, que vive fuera del box del `.board-host`).
    const path = `${SHOTS}/pinch-con-herramienta-armada.png`;
    await page.waitForTimeout(60);
    await page.locator('.studio-field').screenshot({ path });
    expect(fs.existsSync(path), 'captura pinch-con-herramienta-armada').toBe(true);
  });

  test('4. movil-hint-unico: [390x844] SOLO un hint flotante (la pista de recorrido), sin ayuda general', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    // Estado inicial en móvil (Llenar pantalla): la pista de recorrido es el ÚNICO hint.
    // (La ayuda general fue retirada por el dueño y ya no tapa la pista.)
    await expect(page.locator('.fill-hint')).toBeVisible();
    await expect(page.locator('.board-help')).toHaveCount(0);
    expect(await visibleHints(page), 'al cargar solo la pista').toBe(1);
    // La pista es la de recorrido/pellizco, no la ayuda general.
    await expect(page.locator('.fill-hint')).toContainText('Desliza');
    await expect(page.locator('.fill-hint')).toContainText('pel');

    const path = `${SHOTS}/movil-hint-unico.png`;
    await page.waitForTimeout(120);
    await page.screenshot({ path });
    expect(fs.existsSync(path), 'captura movil-hint-unico').toBe(true);
  });

  test('5. vertical-pinch: pellizco en orientación VERTICAL (el zoom cambia y el objeto no se mueve)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, { orientation: 'vertical' });
    await openClosed(page);
    const host = await hostBox(page);
    const obj = await placeComodinAtCenter(page);
    const beforeCount = await fieldCount(page);
    expect(beforeCount).toBe(1);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;

    // Pinch simétrico en vertical: dedos sobre el campo (el objeto queda bajo el punto medio).
    await twoFinger(page, cx, cy, [70, 190]);
    const afterView = await readView(page);
    const afterCount = await fieldCount(page);
    console.log(`[d2-vertical] zoom ${afterView.zoom.toFixed(2)}`);
    expect(afterView.zoom, 'el pinch vertical debe cambiar el zoom').toBeGreaterThan(1.2);
    expect(afterCount, 'ningún elemento se crea/borra en vertical').toBe(beforeCount);
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir Propiedades').toBe(0);

    const path = `${SHOTS}/vertical-pinch.png`;
    await page.waitForTimeout(60);
    await page.locator('.board-host').screenshot({ path });
    expect(fs.existsSync(path), 'captura vertical-pinch').toBe(true);
  });
});
