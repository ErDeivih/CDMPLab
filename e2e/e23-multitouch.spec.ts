import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };

type Box = { x: number; y: number; width: number; height: number };
type PointerType = 'touch' | 'mouse' | 'pen';

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
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Abre la pizarra (defecto móvil "Llenar pantalla") y descarta ayuda/pistas. */
async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) {
    await page.locator('.fill-hint-close').click();
  }
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

/** Lee panX/panY/zoom del transform inline del `.board-canvas`. */
async function readView(page: Page): Promise<{ panX: number; panY: number; zoom: number }> {
  return page.locator('.board-canvas').evaluate((el) => {
    const t = (el as HTMLElement).style.transform;
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
    return m ? { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { panX: 0, panY: 0, zoom: 1 };
  });
}

/** Norm (0..1) de un elemento leído del `translate` de su <g> más cercano. */
async function objectNorm(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const v = await page.locator(selector).first().evaluate((el) => {
    const g = el.closest('g');
    const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  });
  expect(v, `el objeto (${selector}) debe estar renderizado con translate`).not.toBeNull();
  return { x: (v!.x - RECT.x) / RECT.w, y: (v!.y - RECT.y) / RECT.h };
}

/** Centro en PANTALLA (page coords) del bounding box de un selector del SVG.
 *  Usa `getBoundingClientRect()` vía evaluate: `locator.boundingBox()` devuelve null
 *  de forma intermitente en hijos SVG. */
async function objectScreen(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout: 5000 });
  const b = await loc.evaluate((el) => {
    const r = (el as SVGGraphicsElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Despacha un PointerEvent sintético de un `pointerType` dado sobre `.board-host`. */
async function ptr(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  pointerId: number,
  pointerType: PointerType = 'touch',
  isPrimary = false
): Promise<void> {
  await page.evaluate(({ type, x, y, pointerId, pointerType, isPrimary }) => {
    const host = document.querySelector('.board-host') as HTMLElement | null;
    if (!host) return;
    const up = type === 'pointerup' || type === 'pointercancel';
    host.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType,
        isPrimary,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: up ? 0 : 1,
      })
    );
  }, { type, x, y, pointerId, pointerType, isPrimary });
}

/** Despacha un `lostpointercapture` sintético sobre `.board-host`. */
async function lostCapture(page: Page, x: number, y: number, pointerId: number, pointerType: PointerType = 'touch'): Promise<void> {
  await page.evaluate(({ x, y, pointerId, pointerType }) => {
    const host = document.querySelector('.board-host') as HTMLElement | null;
    if (!host) return;
    host.dispatchEvent(
      new PointerEvent('lostpointercapture', {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 0,
      })
    );
  }, { x, y, pointerId, pointerType });
}

/** Un TAP táctil (down+up sin moverse) en (x,y). */
async function tap(page: Page, x: number, y: number, id = 7): Promise<void> {
  await ptr(page, 'pointerdown', x, y, id, 'touch', true);
  await ptr(page, 'pointerup', x, y, id, 'touch');
}

/** Coloca un Portero en el CENTRO del host y devuelve su centro en pantalla. */
async function placeComodinAtCenter(page: Page): Promise<{ x: number; y: number }> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador de la plantilla NO cierra el panel.
  await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  // FASE B (regla C): el panel persistente tapa el centro del host en móvil; se cierra por su
  // botón X (.panel-close) —que no desarma la colocación— para poder tocar correctamente.
  await page.locator('.side-panel-left .panel-close').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
  const host = await hostBox(page);
  await page.touchscreen.tap(host.x + host.width / 2, host.y + host.height / 2);
  await expect(page.locator('.field-count')).toHaveText('1');
  // Fase 3: la colocación es continua → DESARMAR con Seleccionar para que tests posteriores
  // (pinch de 3 dedos y arrastre de un dedo) muevan/seleccionen en lugar de colocar.
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  return objectScreen(page, '.entrenolab-board circle[r="2.5"]');
}

/** Arma un Cono (material) sin colocar nada. */
async function armCone(page: Page): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
}

// ============================================================================

test.describe('Multitáctil: pinch con dedos fijos (defecto 3 dedos) y solo dos dedos táctiles', () => {
  test.use({ hasTouch: true });

  // ---------- DEFECTO 2: tres dedos ----------

  test('D2-a: A+B pellizcan; C baja; A se levanta → el pinch termina SIN transferirse a C y sin salto', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idA = 101;
    const idB = 102;
    const idC = 103;

    // A + B bajan (pinch) y se separan → el zoom sube desde 1.
    await ptr(page, 'pointerdown', cx - 40, cy, idA, 'touch', true);
    await ptr(page, 'pointerdown', cx + 40, cy, idB, 'touch', false);
    await ptr(page, 'pointermove', cx - 90, cy, idA, 'touch');
    await ptr(page, 'pointermove', cx + 90, cy, idB, 'touch');
    const vPinch = await readView(page);
    expect(vPinch.zoom, 'el pinch (A+B) ha subido el zoom').toBeGreaterThan(1.2);

    // Tercer dedo C baja: se ignora por completo (no cambia el zoom/pan).
    await ptr(page, 'pointerdown', cx + 20, cy + 60, idC, 'touch', false);
    const vAfterCDown = await readView(page);
    expect(vAfterCDown.zoom, 'el tercer dedo no altera el zoom').toBeCloseTo(vPinch.zoom, 6);
    expect(vAfterCDown.panX, 'el tercer dedo no altera el panX').toBeCloseTo(vPinch.panX, 6);
    expect(vAfterCDown.panY, 'el tercer dedo no altera el panY').toBeCloseTo(vPinch.panY, 6);

    // Una participante (A) se levanta: el pinch TERMINA sin transferirse a C (sin salto).
    await ptr(page, 'pointerup', cx - 90, cy, idA, 'touch');
    const vAfterAUp = await readView(page);
    expect(vAfterAUp.zoom, 'levantar A congela el zoom (sin salto)').toBeCloseTo(vPinch.zoom, 6);
    expect(vAfterAUp.panX, 'levantar A congela el panX (sin salto)').toBeCloseTo(vPinch.panX, 6);
    expect(vAfterAUp.panY, 'levantar A congela el panY (sin salto)').toBeCloseTo(vPinch.panY, 6);

    // Mover los dedos restantes (C y el retirado B) NO hace zoom ni pan.
    await ptr(page, 'pointermove', cx + 300, cy - 120, idC, 'touch');
    await ptr(page, 'pointermove', cx - 250, cy + 150, idB, 'touch');
    const vAfterMove = await readView(page);
    expect(vAfterMove.zoom, 'mover C/B no cambia el zoom').toBeCloseTo(vPinch.zoom, 6);
    expect(vAfterMove.panX, 'mover C/B no cambia el panX').toBeCloseTo(vPinch.panX, 6);
    expect(vAfterMove.panY, 'mover C/B no cambia el panY').toBeCloseTo(vPinch.panY, 6);

    // El pinch es SOLO vista: sin objetos, sin dirty, sin undo, sin Propiedades.
    expect(await fieldCount(page), 'no se crea ningún elemento').toBe(0);
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await fieldCount(page), 'sin historial, undo es no-op').toBe(0);

    // Levantar los dedos sobrantes.
    await ptr(page, 'pointerup', cx + 300, cy - 120, idC, 'touch');
    await ptr(page, 'pointerup', cx - 250, cy + 150, idB, 'touch');
  });

  test('D2-b: A+B+C; pointercancel de un participante (B) → el pinch termina sin salto', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idA = 201;
    const idB = 202;
    const idC = 203;

    await ptr(page, 'pointerdown', cx - 40, cy, idA, 'touch', true);
    await ptr(page, 'pointerdown', cx + 40, cy, idB, 'touch', false);
    await ptr(page, 'pointermove', cx - 90, cy, idA, 'touch');
    await ptr(page, 'pointermove', cx + 90, cy, idB, 'touch');
    const vPinch = await readView(page);
    expect(vPinch.zoom, 'el pinch (A+B) ha subido el zoom').toBeGreaterThan(1.2);

    await ptr(page, 'pointerdown', cx + 20, cy + 60, idC, 'touch', false);

    // El navegador CANCELA un participante (B): el pinch termina sin transferirse a C.
    await ptr(page, 'pointercancel', cx + 90, cy, idB, 'touch', false);
    const v = await readView(page);
    expect(v.zoom, 'pointercancel del participante congela el zoom').toBeCloseTo(vPinch.zoom, 6);
    expect(v.panX, 'pointercancel del participante congela el panX').toBeCloseTo(vPinch.panX, 6);
    expect(v.panY, 'pointercancel del participante congela el panY').toBeCloseTo(vPinch.panY, 6);

    // Mover A/C no cambia nada.
    await ptr(page, 'pointermove', cx - 250, cy + 120, idA, 'touch');
    await ptr(page, 'pointermove', cx + 300, cy - 90, idC, 'touch');
    const v2 = await readView(page);
    expect(v2.zoom, 'mover A/C tras cancelar no cambia el zoom').toBeCloseTo(vPinch.zoom, 6);
    expect(v2.panX, 'mover A/C tras cancelar no cambia el panX').toBeCloseTo(vPinch.panX, 6);
    expect(v2.panY, 'mover A/C tras cancelar no cambia el panY').toBeCloseTo(vPinch.panY, 6);

    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await fieldCount(page), 'sin historial, undo es no-op').toBe(0);

    await ptr(page, 'pointerup', cx - 250, cy + 120, idA, 'touch');
    await ptr(page, 'pointerup', cx + 300, cy - 90, idC, 'touch');
  });

  test('D2-c: lostpointercapture de un participante → el pinch termina sin salto', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idA = 301;
    const idB = 302;
    const idC = 303;

    await ptr(page, 'pointerdown', cx - 40, cy, idA, 'touch', true);
    await ptr(page, 'pointerdown', cx + 40, cy, idB, 'touch', false);
    await ptr(page, 'pointermove', cx - 90, cy, idA, 'touch');
    await ptr(page, 'pointermove', cx + 90, cy, idB, 'touch');
    const vPinch = await readView(page);
    expect(vPinch.zoom, 'el pinch (A+B) ha subido el zoom').toBeGreaterThan(1.2);

    await ptr(page, 'pointerdown', cx + 20, cy + 60, idC, 'touch', false);

    // Se pierde la captura de un participante (B): el pinch termina sin salto.
    await lostCapture(page, cx + 90, cy, idB, 'touch');
    const v = await readView(page);
    expect(v.zoom, 'lostpointercapture del participante congela el zoom').toBeCloseTo(vPinch.zoom, 6);
    expect(v.panX, 'lostpointercapture del participante congela el panX').toBeCloseTo(vPinch.panX, 6);
    expect(v.panY, 'lostpointercapture del participante congela el panY').toBeCloseTo(vPinch.panY, 6);

    await ptr(page, 'pointermove', cx - 250, cy + 120, idA, 'touch');
    await ptr(page, 'pointermove', cx + 300, cy - 90, idC, 'touch');
    const v2 = await readView(page);
    expect(v2.zoom, 'mover A/C tras perder captura no cambia el zoom').toBeCloseTo(vPinch.zoom, 6);
    expect(v2.panX, 'mover A/C tras perder captura no cambia el panX').toBeCloseTo(vPinch.panX, 6);

    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await fieldCount(page), 'sin historial, undo es no-op').toBe(0);

    await ptr(page, 'pointerup', cx - 250, cy + 120, idA, 'touch');
    await ptr(page, 'pointerup', cx + 300, cy - 90, idC, 'touch');
  });

  test('D2-d: tras levantar los tres dedos, un tap coloca EXACTAMENTE un objeto', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await armCone(page);
    await expect(page.locator('.field-count')).toHaveText('0');
    await expect(page.locator('.placement-hint')).toBeVisible();
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idA = 401;
    const idB = 402;
    const idC = 403;

    // A, B, C bajan; A+B forman el pinch que se separa; luego TODOS se levantan.
    await ptr(page, 'pointerdown', cx - 40, cy, idA, 'touch', true);
    await ptr(page, 'pointerdown', cx + 40, cy, idB, 'touch', false);
    await ptr(page, 'pointermove', cx - 90, cy, idA, 'touch');
    await ptr(page, 'pointermove', cx + 90, cy, idB, 'touch');
    await ptr(page, 'pointerdown', cx + 20, cy + 60, idC, 'touch', false);
    await ptr(page, 'pointerup', cx - 90, cy, idA, 'touch');
    await ptr(page, 'pointerup', cx + 90, cy, idB, 'touch');
    await ptr(page, 'pointerup', cx + 20, cy + 60, idC, 'touch');

    // El pinch de 3 dedos no crea nada y la herramienta sigue armada.
    expect(await fieldCount(page), 'el pinch de 3 dedos no crea nada').toBe(0);
    await expect(page.locator('.placement-hint')).toHaveCount(1);

    // Un tap posterior coloca EXACTAMENTE UN cono.
    await tap(page, cx - 60, cy + 40, 11);
    expect(await fieldCount(page), 'el tap posterior coloca exactamente uno').toBe(1);
    // Fase 3: la colocación es continua → el cono sigue armado (pista visible, no Seleccionar).
    await expect(page.locator('.placement-hint')).toHaveCount(1);
    await expect(page.locator('.tools-caption-title')).toHaveText('Cono');
  });

  test('D2-e: tras el pinch de 3 dedos, un arrastre de un dedo mueve el objeto correctamente', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const obj = await placeComodinAtCenter(page);
    const beforeNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idA = 501;
    const idB = 502;
    const idC = 503;

    // Pinch de 3 dedos sobre zona vacía (fuera del objeto): A+B pellizcan, C baja.
    await ptr(page, 'pointerdown', cx - 90, cy, idA, 'touch', true);
    await ptr(page, 'pointerdown', cx + 30, cy, idB, 'touch', false);
    await ptr(page, 'pointerdown', cx + 50, cy + 80, idC, 'touch', false);
    await ptr(page, 'pointermove', cx - 140, cy, idA, 'touch');
    await ptr(page, 'pointermove', cx + 80, cy, idB, 'touch');
    // A (participante) se levanta → el pinch termina; luego B y C se levantan.
    await ptr(page, 'pointerup', cx - 140, cy, idA, 'touch');
    await ptr(page, 'pointerup', cx + 80, cy, idB, 'touch');
    await ptr(page, 'pointerup', cx + 50, cy + 80, idC, 'touch');

    // El objeto NO se movió durante el pinch de 3 dedos y NO se abre Propiedades.
    const midNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    expect(Math.abs(midNorm.x - beforeNorm.x), 'el objeto no se mueve con el pinch (x)').toBeLessThan(0.005);
    expect(Math.abs(midNorm.y - beforeNorm.y), 'el objeto no se mueve con el pinch (y)').toBeLessThan(0.005);
    await expect(page.locator('.studio-panel')).toHaveCount(0);

    // Un arrastre de UN dedo sobre el objeto lo mueve correctamente.
    const objPos = await objectScreen(page, '.entrenolab-board circle[r="2.5"]');
    await ptr(page, 'pointerdown', objPos.x, objPos.y, 504, 'touch', true);
    await ptr(page, 'pointermove', objPos.x + 45, objPos.y + 28, 504, 'touch');
    await ptr(page, 'pointerup', objPos.x + 45, objPos.y + 28, 504, 'touch');
    // Espera observable: el objeto se mueve (su norm cambia respecto al inicio).
    await expect.poll(async () => {
      const n = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
      return Math.abs(n.x - beforeNorm.x) + Math.abs(n.y - beforeNorm.y);
    }, { timeout: 4000 }).toBeGreaterThan(0.005);
    const afterNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    expect(Math.abs(afterNorm.x - beforeNorm.x), 'el objeto se mueve tras el pinch (x)').toBeGreaterThan(0.005);
    expect(Math.abs(afterNorm.y - beforeNorm.y), 'el objeto se mueve tras el pinch (y)').toBeGreaterThan(0.005);
  });

  // ---------- DEFECTO 3: solo dos punteros táctiles inician un pinch ----------

  test('D3-a: mouse + touch NO es un pinch (zoom intacto); el ratón conserva su comportamiento inmediato', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idMouse = 601;
    const idTouch = 602;
    const v0 = await readView(page);

    // Fase 5: Seleccionar ya NO panea. Para que el arrastre de ratón panea, se activa
    // explícitamente la herramienta "Desplazar campo" (Mano).
    await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
    // Ratón baja sobre campo vacío y arrastra → PAN inmediato (comportamiento de Mano).
    await ptr(page, 'pointerdown', cx - host.width * 0.30, cy, idMouse, 'mouse', true);
    await ptr(page, 'pointermove', cx - host.width * 0.30 + 60, cy + 30, idMouse, 'mouse');
    const vDrag = await readView(page);
    expect(Math.abs(vDrag.panX - v0.panX), 'el arrastre de ratón panea inmediatamente').toBeGreaterThan(5);

    // Un dedo TÁCTIL baja mientras el ratón sigue bajado: NO es un pinch.
    await ptr(page, 'pointerdown', cx + 60, cy + 40, idTouch, 'touch', false);
    const vTouch = await readView(page);
    expect(vTouch.zoom, 'mouse+touch NO es un pinch (zoom intacto)').toBeCloseTo(v0.zoom, 4);
    expect(vTouch.panX, 'mouse+touch NO cambia el panX').toBeCloseTo(vDrag.panX, 6);

    await ptr(page, 'pointerup', cx + 60, cy + 40, idTouch, 'touch');
    await ptr(page, 'pointerup', cx - host.width * 0.30 + 60, cy + 30, idMouse, 'mouse');

    const vFinal = await readView(page);
    expect(vFinal.zoom, 'zoom intacto al terminar').toBeCloseTo(v0.zoom, 4);
    expect(vFinal.panX, 'panX de ratón se mantiene al terminar').toBeCloseTo(vDrag.panX, 6);
    expect(vFinal.panY, 'panY se mantiene al terminar').toBeCloseTo(vDrag.panY, 6);

    // Modelo/selección/panel/historial intactos: sin objeto, sin Propiedades, sin dirty, sin undo.
    expect(await fieldCount(page), 'no se crea ningún elemento').toBe(0);
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await expect(page.locator('.board-canvas svg [stroke="#2563eb"]')).toHaveCount(0);
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await fieldCount(page), 'sin historial, undo es no-op').toBe(0);
  });

  test('D3-b: pen + touch NO es un pinch (zoom intacto); el lápiz conserva su comportamiento inmediato', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idPen = 701;
    const idTouch = 702;
    const v0 = await readView(page);

    // Fase 5: Seleccionar ya NO panea; se activa "Desplazar campo" (Mano) para que el
    // arrastre de lápiz panea.
    await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
    // Lápiz baja sobre campo vacío y arrastra → PAN inmediato.
    await ptr(page, 'pointerdown', cx - host.width * 0.30, cy, idPen, 'pen', true);
    await ptr(page, 'pointermove', cx - host.width * 0.30 + 60, cy + 30, idPen, 'pen');
    const vDrag = await readView(page);
    expect(Math.abs(vDrag.panX - v0.panX), 'el arrastre de lápiz panea inmediatamente').toBeGreaterThan(5);

    // Dedo táctil baja con el lápiz bajado: NO es un pinch.
    await ptr(page, 'pointerdown', cx + 60, cy + 40, idTouch, 'touch', false);
    const vTouch = await readView(page);
    expect(vTouch.zoom, 'pen+touch NO es un pinch (zoom intacto)').toBeCloseTo(v0.zoom, 4);
    expect(vTouch.panX, 'pen+touch NO cambia el panX').toBeCloseTo(vDrag.panX, 6);

    await ptr(page, 'pointerup', cx + 60, cy + 40, idTouch, 'touch');
    await ptr(page, 'pointerup', cx - host.width * 0.30 + 60, cy + 30, idPen, 'pen');

    const vFinal = await readView(page);
    expect(vFinal.zoom, 'zoom intacto al terminar').toBeCloseTo(v0.zoom, 4);
    expect(vFinal.panX, 'panX de lápiz se mantiene al terminar').toBeCloseTo(vDrag.panX, 6);
    expect(vFinal.panY, 'panY se mantiene al terminar').toBeCloseTo(vDrag.panY, 6);

    expect(await fieldCount(page), 'no se crea ningún elemento').toBe(0);
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await expect(page.locator('.board-canvas svg [stroke="#2563eb"]')).toHaveCount(0);
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await fieldCount(page), 'sin historial, undo es no-op').toBe(0);
  });

  test('D3-c: touch + touch SÍ es un pinch (zoom cambia)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const v0 = await readView(page);
    const idA = 801;
    const idB = 802;

    await ptr(page, 'pointerdown', cx - 40, cy, idA, 'touch', true);
    await ptr(page, 'pointerdown', cx + 40, cy, idB, 'touch', false);
    await ptr(page, 'pointermove', cx - 110, cy, idA, 'touch');
    await ptr(page, 'pointermove', cx + 110, cy, idB, 'touch');
    const v1 = await readView(page);
    expect(v1.zoom, 'touch+touch hace zoom').toBeGreaterThan(v0.zoom);

    await ptr(page, 'pointerup', cx - 110, cy, idA, 'touch');
    await ptr(page, 'pointerup', cx + 110, cy, idB, 'touch');

    // El pinch es SOLO vista: sin dirty, sin undo, sin objeto.
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await fieldCount(page), 'sin historial, undo es no-op').toBe(0);
    expect(await fieldCount(page), 'no se crea ningún elemento').toBe(0);
  });
});
