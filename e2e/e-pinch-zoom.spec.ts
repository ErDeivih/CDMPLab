import { test, expect, Page } from '@playwright/test';

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en horizontal.
 *  `fit` = 'height' (llenar pantalla) | 'contain' (campo completo). */
function normToScreen(
  nx: number,
  ny: number,
  host: Box,
  fit: 'height' | 'contain',
  panX = 0,
  panY = 0,
  zoom = 1
): { x: number; y: number } {
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

/** Inversa: pantalla→norm (replica screenToNorm de render.ts). */
function screenToNorm(
  clientX: number,
  clientY: number,
  host: Box,
  fit: 'height' | 'contain',
  panX = 0,
  panY = 0,
  zoom = 1
): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const ox = host.width / 2;
  const oy = host.height / 2;
  const cx = ox + (clientX - host.x - panX - ox) / zoom;
  const cy = oy + (clientY - host.y - panY - oy) / zoom;
  const vbX = (cx - offX) / s;
  const vbY = (cy - offY) / s;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x: clamp01((vbX - RECT.x) / RECT.w),
    y: clamp01((vbY - RECT.y) / RECT.h),
  };
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
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Abre la pizarra en modo "Llenar pantalla" (defecto móvil) y descarta ayuda/pistas. */
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

/** Lee la posición normalizada del Portero (primer círculo r=2.5) desde el `translate`
 *  de su <g>. El translate es la posición CANÓNICA (norm) del elemento — el pan/zoom de
 *  la vista viven en el `.board-canvas`, no en el elemento. */
async function readComodinNorm(page: Page): Promise<{ nx: number; ny: number }> {
  const v = await page.locator('.entrenolab-board circle[r="2.5"]').first().evaluate((el) => {
    const g = el.closest('g');
    const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  });
  expect(v, 'el Portero debe estar renderizado').not.toBeNull();
  return { nx: (v!.x - RECT.x) / RECT.w, ny: (v!.y - RECT.y) / RECT.h };
}

/** Despacha un PointerEvent sintético sobre `.board-host`. Un gesto real de dos toques no
 *  puede generarse con `page.touchscreen` (solo un dedo), así que usamos dos `pointerId`
 *  distintos para demostrar el pinch multi-táctil. */
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

/** Gesto de dos dedos simétrico alrededor de (cx,cy). `spreads` = distancias (px) entre los
 *  dos dedos en cada paso. Secuencia: bajan los 2 en spreads[0], se mueven por los siguientes
 *  y se levantan en el último. */
async function twoFinger(page: Page, cx: number, cy: number, spreads: number[]): Promise<void> {
  const idA = 101;
  const idB = 102;
  const pts = spreads.map((s) => ({ ax: cx - s / 2, ay: cy, bx: cx + s / 2, by: cy }));
  await ptr(page, 'pointerdown', pts[0].ax, pts[0].ay, idA, true);
  await ptr(page, 'pointerdown', pts[0].bx, pts[0].by, idB, false);
  for (let i = 1; i < pts.length; i++) {
    await ptr(page, 'pointermove', pts[i].ax, pts[i].ay, idA);
    await ptr(page, 'pointermove', pts[i].bx, pts[i].by, idB);
  }
  const last = pts[pts.length - 1];
  await ptr(page, 'pointerup', last.ax, last.ay, idA);
  await ptr(page, 'pointerup', last.bx, last.by, idB);
}

/** Coloca un Portero en el CENTRO (pantalla) de la pizarra y cierra Propiedades. */
async function placeComodinAtCenter(page: Page): Promise<{ cx: number; cy: number }> {
  const host = await hostBox(page);
  const cx = host.x + host.width / 2;
  const cy = host.y + host.height / 2;
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Portero"]').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
  await page.touchscreen.tap(cx, cy);
  await expect(page.locator('.field-count')).toHaveText('1');
  // Se auto-abre Propiedades con el Portero; cerrarlo para dejar el campo libre.
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) {
    await page.locator('.studio-panel .panel-close').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
  }
  return { cx, cy };
}

/** Arrastra con el ratón (un solo puntero) desde (x,y) hasta (x+dx,y+dy). */
async function mouseDrag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe('pinch-to-zoom real (dos dedos) en la pizarra', () => {
  test.use({ hasTouch: true });

  test('pellizcar hacia FUERA aumenta el zoom y hacia DENTRO lo reduce (ratio de distancia)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const start = await readView(page);
    expect(start.zoom, 'zoom inicial').toBeCloseTo(1, 2);
    // En una pizarra LIMPIA (sin tocar objetos) el zoom/pan son solo VISTA: no deben
    // marcar el ejercicio como modificado ni empujar al historial de deshacer.
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await page.locator('.entrenolab-board [data-el-type]').count(), 'sin elementos, undo es no-op').toBe(0);

    // Dos dedos bajan juntos (spread 80), se SEPARAN (spread 220) y se vuelven a JUNTAR (spread 60).
    const idA = 101;
    const idB = 102;
    const s0 = 80;
    const s1 = 220;
    const s2 = 60;
    await ptr(page, 'pointerdown', cx - s0 / 2, cy, idA, true);
    await ptr(page, 'pointerdown', cx + s0 / 2, cy, idB, false);
    await ptr(page, 'pointermove', cx - s1 / 2, cy, idA);
    await ptr(page, 'pointermove', cx + s1 / 2, cy, idB);
    const afterSpread = await readView(page);
    expect(afterSpread.zoom, 'zoom tras SEPARAR los dedos').toBeGreaterThan(1.5);
    await ptr(page, 'pointermove', cx - s2 / 2, cy, idA);
    await ptr(page, 'pointermove', cx + s2 / 2, cy, idB);
    const afterClose = await readView(page);
    expect(afterClose.zoom, 'zoom tras JUNTAR los dedos').toBeLessThan(afterSpread.zoom);
    expect(afterClose.zoom, 'zoom nunca baja del 100%').toBeGreaterThanOrEqual(1);
    await ptr(page, 'pointerup', cx - s2 / 2, cy, idA);
    await ptr(page, 'pointerup', cx + s2 / 2, cy, idB);

    // Tras el pinch la vista sigue siendo SOLO vista: sin dirty y sin entrada de undo.
    await expect(page.locator('.dirty-dot')).toHaveCount(0);
    // Fase 3: deshacer/rehacer viven en el menú contextual; sin historial Ctrl+Z es un no-op.
    await page.keyboard.press('Control+z');
    expect(await page.locator('.entrenolab-board [data-el-type]').count(), 'tras pinch, undo es no-op').toBe(0);
  });

  test('el punto de campo bajo el punto medio NO se desplaza durante el zoom (ancla del pinch)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const fit: 'height' | 'contain' = 'height';

    const before = await readView(page);
    const normBefore = screenToNorm(cx, cy, host, fit, before.panX, before.panY, before.zoom);

    // Pinch simétrico: el punto medio queda fijo en (cx,cy) mientras los dedos se separan.
    await twoFinger(page, cx, cy, [80, 200]);

    const after = await readView(page);
    expect(after.zoom, 'el pinch debe haber cambiado el zoom').toBeGreaterThan(before.zoom);
    const normAfter = screenToNorm(cx, cy, host, fit, after.panX, after.panY, after.zoom);
    console.log(`[pinch-ancla] norm antes=(${normBefore.x.toFixed(4)},${normBefore.y.toFixed(4)}) después=(${normAfter.x.toFixed(4)},${normAfter.y.toFixed(4)}) zoom ${before.zoom.toFixed(2)}→${after.zoom.toFixed(2)}`);
    expect(Math.abs(normAfter.x - normBefore.x), 'norm X del punto medio estable').toBeLessThan(0.02);
    expect(Math.abs(normAfter.y - normBefore.y), 'norm Y del punto medio estable').toBeLessThan(0.02);
  });

  test('un objeto bajo el gesto NO se mueve/rota/redimensiona durante el pinch', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const { cx, cy } = await placeComodinAtCenter(page);
    const before = await readComodinNorm(page);

    // Los dedos caen FUERA del objeto (spread 120) y se separan hasta 220: el objeto queda
    // bajo el punto medio, pero ningún dedo lo toca. No debe moverse ni abrir el inspector.
    await twoFinger(page, cx, cy, [120, 220]);
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir el inspector').toBe(0);

    const afterView = await readView(page);
    expect(afterView.zoom, 'el pinch debe haber cambiado el zoom').toBeGreaterThan(1.5);
    const after = await readComodinNorm(page);
    console.log(`[pinch-objeto] antes=(${before.nx.toFixed(4)},${before.ny.toFixed(4)}) después=(${after.nx.toFixed(4)},${after.ny.toFixed(4)})`);
    expect(Math.abs(after.nx - before.nx), 'x del objeto intacto tras pinch').toBeLessThan(0.005);
    expect(Math.abs(after.ny - before.ny), 'y del objeto intacto tras pinch').toBeLessThan(0.005);
  });

  test('pointercancel deja la pizarra usable: un dedo que se libera no deja un arrastre fantasma', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const idA = 101;
    const idB = 102;

    // Dos dedos bajan, se separan y el navegador CANCELA el segundo (el primero se levanta).
    await ptr(page, 'pointerdown', cx - 50, cy, idA, true);
    await ptr(page, 'pointerdown', cx + 50, cy, idB, false);
    await ptr(page, 'pointermove', cx - 90, cy, idA);
    await ptr(page, 'pointermove', cx + 90, cy, idB);
    await ptr(page, 'pointercancel', cx + 90, cy, idB);
    await ptr(page, 'pointerup', cx - 90, cy, idA);

    // La vista quedó en el estado del pinch (zoom > 1) y NO hay arrastre fantasma: un
    // arrastre de UN dedo sobre campo vacío debe PAREAR la pizarra con normalidad.
    const v = await readView(page);
    expect(v.zoom, 'zoom tras pointercancel').toBeGreaterThan(1);

    const v0 = await readView(page);
    await mouseDrag(page, cx - host.width * 0.32, cy + host.height * 0.1, 60, 30);
    const v1 = await readView(page);
    expect(v1.panX, 'el paneo de un dedo sigue funcionando tras el pinch cancelado').not.toBeCloseTo(v0.panX, 6);
  });

  test('tras el pinch, el PAN de un dedo y el MOVIMIENTO de un objeto siguen funcionando', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const { cx, cy } = await placeComodinAtCenter(page);
    const host = await hostBox(page);

    // Pinch de acercar (los dedos caen fuera del objeto → no lo toca, el inspector queda cerrado).
    await twoFinger(page, cx, cy, [120, 220]);
    expect((await readView(page)).zoom, 'zoom tras pinch').toBeGreaterThan(1.5);
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir el inspector').toBe(0);

    // 1) PAN de un dedo (campo vacío).
    const panBefore = await readView(page);
    await mouseDrag(page, cx - host.width * 0.32, cy + host.height * 0.1, 55, 25);
    const panAfter = await readView(page);
    expect(Math.abs(panAfter.panX - panBefore.panX), 'panX cambió tras arrastrar vacío').toBeGreaterThan(5);

    // 2) MOVIMIENTO de un objeto de un dedo.
    const beforeNorm = await readComodinNorm(page);
    const objScreen = normToScreen(beforeNorm.nx, beforeNorm.ny, host, 'height', panAfter.panX, panAfter.panY, panAfter.zoom);
    await mouseDrag(page, objScreen.x, objScreen.y, 40, 24);
    const afterNorm = await readComodinNorm(page);
    console.log(`[pinch-uso] objeto antes=(${beforeNorm.nx.toFixed(4)},${beforeNorm.ny.toFixed(4)}) después=(${afterNorm.nx.toFixed(4)},${afterNorm.ny.toFixed(4)})`);
    expect(Math.abs(afterNorm.nx - beforeNorm.nx), 'el objeto se MUEVE con un dedo tras el pinch').toBeGreaterThan(0.005);
    expect(Math.abs(afterNorm.ny - beforeNorm.ny), 'el objeto se MUEVE con un dedo tras el pinch (y)').toBeGreaterThan(0.005);
    // Mover un objeto SÍ es una edición real: marca el ejercicio como modificado.
    await expect(page.locator('.dirty-dot')).toHaveCount(1);
  });
});
