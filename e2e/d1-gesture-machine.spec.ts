import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';

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

/** Inversa: pantalla→norm (replica screenToNorm de render.ts) para HORIZONTAL. */
function screenToNorm(clientX: number, clientY: number, host: Box, fit: Fit, panX = 0, panY = 0, zoom = 1): Pt {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const ox = host.width / 2;
  const oy = host.height / 2;
  const cx = ox + (clientX - host.x - panX - ox) / zoom;
  const cy = oy + (clientY - host.y - panY - oy) / zoom;
  const vbX = (cx - offX) / s;
  const vbY = (cy - offY) / s;
  return {
    x: Math.max(0, Math.min(1, (vbX - RECT.x) / RECT.w)),
    y: Math.max(0, Math.min(1, (vbY - RECT.y) / RECT.h)),
  };
}

async function seed(page: Page, opts: { orientation?: 'horizontal' | 'vertical'; fill?: 'fill' | 'contain' } = {}): Promise<void> {
  const { orientation = 'horizontal', fill = 'fill' } = opts;
  await page.addInitScript(({ orientation, fill }) => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    // Modo de pantalla deseado: '1' = Llenar pantalla (fill), '0' = Campo completo (contain).
    localStorage.setItem('entrenolab:board-fill', fill === 'fill' ? '1' : '0');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation, grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, { orientation, fill });
}

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

/** Modo de encaje actual: 'height' si el host lleva la clase board-fill (Llenar pantalla). */
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

/** Centro en PANTALLA (page coords) del bounding box de un selector del SVG. */
async function objectScreen(page: Page, selector: string): Promise<Pt> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'attached', timeout: 5000 });
  const b = await loc.evaluate((el) => {
    const r = (el as SVGGraphicsElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Norm (0..1) de un elemento leído del `translate` de su <g> más cercano (posición canónica,
 *  independiente del pan/zoom de la vista). */
async function objectNorm(page: Page, selector: string): Promise<Pt> {
  const v = await page.locator(selector).first().evaluate((el) => {
    const g = el.closest('g');
    const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  });
  expect(v, `el objeto (${selector}) debe estar renderizado con translate`).not.toBeNull();
  return { x: (v!.x - RECT.x) / RECT.w, y: (v!.y - RECT.y) / RECT.h };
}

/** Norm de un material <image> (asset PNG): el centro se codifica en las coordenadas
 *  x/y (esquina sup-izq) y width/height del <image>, NO en un <g transform>. */
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

/** Nº de elementos del campo (elementos de la vista actual). */
function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Despacha un PointerEvent sintético sobre `.board-host`. Un gesto real de dos toques no puede
 *  generarse con `page.touchscreen`, así que usamos dos `pointerId` distintos (touch). */
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

/** Pinch de dos dedos. `steps` = pares de posiciones {a,b} de los dos dedos, en orden.
 *  El primero es la bajada conjunta y el último el levantamiento (tras mover). */
async function gestureFingers(page: Page, steps: Array<{ a: Pt; b: Pt }>): Promise<void> {
  const idA = 101;
  const idB = 102;
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

/** Pinch simétrico alrededor de (cx,cy); `spreads` = distancias (px) entre dedos en cada paso. */
async function twoFinger(page: Page, cx: number, cy: number, spreads: number[]): Promise<void> {
  const steps = spreads.map((s) => ({ a: { x: cx - s / 2, y: cy }, b: { x: cx + s / 2, y: cy } }));
  await gestureFingers(page, steps);
}

// ---------- Colocación de objetos ----------

/** Coloca un Portero (jugador genérico) en el norm (nx,ny) y devuelve su centro en pantalla. */
async function placeComodinAt(page: Page, nx: number, ny: number): Promise<Pt> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador de la plantilla NO cierra el panel.
  await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  // FASE B (regla C): en móvil el panel persistente tapa el centro del campo; se cierra por
  // su botón X (.panel-close) —que no desarma la colocación— para poder tocar el punto.
  await page.locator('.side-panel-left .panel-close').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
  // Re-capturar el host (el panel es un overlay: el host no cambia al cerrarlo, se re-toma por robustez).
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(nx, ny, host, fit);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  // FASE 3: la colocación es continua → DESARMAR con Seleccionar para que los gestos
  // posteriores (mover/panear) no coloquen un segundo genérico.
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  return objectScreen(page, '.entrenolab-board circle[r="2.5"]');
}

/** Coloca un Portero en el CENTRO del host (norm 0.5,0.5 en horizontal Y vertical),
 *  sin depender de la fórmula norm→pantalla (que solo es válida en horizontal). */
async function placeComodinAtCenter(page: Page): Promise<Pt> {
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
  // FASE 3: la colocación es continua → DESARMAR con Seleccionar.
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  return objectScreen(page, '.entrenolab-board circle[r="2.5"]');
}

/** Abre el panel Propiedades y, si está, cierra el panel de herramientas solapado. */
async function openStudio(page: Page): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').first().click();
  await expect(page.locator('.studio-panel')).toBeVisible();
}
async function closeStudio(page: Page): Promise<void> {
  await page.locator('.studio-panel .panel-close').click();
  await expect(page.locator('.studio-panel')).toHaveCount(0);
}

/** Restablece la vista (zoom 1, pan 0) desde el botón del panel Propiedades. */
async function resetBoardView(page: Page): Promise<void> {
  await openStudio(page);
  await page.locator('.studio-panel button', { hasText: 'Restablecer vista' }).click();
  await closeStudio(page);
}

/** Coloca un Cono (material) en el norm (nx,ny); ciérra Propiedades si se abre. */
async function placeConeAt(page: Page, nx: number, ny: number): Promise<Pt> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  // FASE B (paneles persistentes): el panel Material sigue abierto y en móvil tapa el centro
  // del campo. Se cierra por su botón X (.panel-close), que no desarma la colocación.
  await page.locator('.side-panel-left.tools-panel-side .panel-close').click();
  await expect(page.locator('.side-panel-left.tools-panel-side')).toHaveCount(0);
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(nx, ny, host, fit);
  await page.touchscreen.tap(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) {
    await page.locator('.studio-panel .panel-close').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
  }
  // El cono se renderiza como <image> (asset PNG cone-red.png).
  return objectScreen(page, '.board-canvas svg image[href*="cone"]');
}

/** Arma una colocación (Cono) desde el panel Material, sin colocar nada. */
async function armCone(page: Page): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
}

/** Arma la colocación de un jugador de plantilla (roster) sin colocar nada. */
async function armRoster(page: Page): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.side-panel-left .roster-item').first().click();
}

/** Arma la herramienta de dibujo Texto (sin colocar nada). */
async function armText(page: Page): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Texto"]').click();
}

/** Arma la herramienta de dibujo Flecha (arrow) (sin colocar nada). */
async function armArrow(page: Page): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Flecha (movimiento)"]').click();
}

// ============================================================================

test.describe('Máquina de gestos táctil: dedo único ↔ pinch en la pizarra', () => {
  test.use({ hasTouch: true });

  test('1. dedo BAJO directamente sobre un jugador + segundo dedo → pinch zoom, el jugador NO se mueve, sin selección ni Propiedades', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Campo completo (contain): sin paneo, el pinch central es determinista y el zoom
    // resultante es estable. En "Llenar pantalla" el zoom de un pinch con spread corto
    // variaba (1.06 vs >1.2) según el frame, haciendo el umbral imposible de cumplir.
    await seed(page, { fill: 'contain' });
    await openClosed(page);
    const host = await hostBox(page);
    // Portero en el centro del campo.
    const obj = await placeComodinAt(page, 0.5, 0.5);
    const beforeNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    const beforeCount = await fieldCount(page);
    expect(beforeCount).toBe(1);
    // Deseleccionar (el Portero colocado no abre Propiedades; asegurarnos de no dejar selección).
    await expect(page.locator('.studio-panel')).toHaveCount(0);

    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    // Dedo A BAJA directamente sobre el objeto; el B baja a 120px a la derecha y fuera del objeto.
    await ptr(page, 'pointerdown', obj.x, obj.y, 101, true);
    await ptr(page, 'pointerdown', obj.x + 120, cy, 102, false);
    await ptr(page, 'pointermove', obj.x, obj.y, 101);
    await ptr(page, 'pointermove', obj.x + 200, cy, 102);
    await ptr(page, 'pointerup', obj.x, obj.y, 101);
    await ptr(page, 'pointerup', obj.x + 200, cy, 102);

    // A8: el zoom/pan se aplica vía change-detection de Angular (transform CSS); bajo
    // carga conjunta puede ir un frame por detrás del dispatch sintético. Se espera de
    // forma OBSERVABLE (sin retardo fijo) a que el zoom final quede aplicado.
    // A8: el zoom/pan se aplica vía change-detection de Angular (transform CSS); bajo
    // carga conjunta puede ir un frame por detrás del dispatch sintético. Se espera de
    // forma OBSERVABLE (sin retardo fijo) a que el zoom final quede aplicado.
    await expect.poll(async () => (await readView(page)).zoom, { timeout: 4000 }).toBeGreaterThan(1.05);
    const afterView = await readView(page);
    expect(afterView.zoom, 'el pinch debe haber cambiado el zoom').toBeGreaterThan(1.05);
    await expect.poll(async () => Math.abs((await objectNorm(page, '.entrenolab-board circle[r="2.5"]')).x - beforeNorm.x), { timeout: 4000 }).toBeLessThan(0.005);
    await expect.poll(async () => Math.abs((await objectNorm(page, '.entrenolab-board circle[r="2.5"]')).y - beforeNorm.y), { timeout: 4000 }).toBeLessThan(0.005);
    const afterNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    expect(Math.abs(afterNorm.x - beforeNorm.x), 'x del jugador intacto').toBeLessThan(0.005);
    expect(Math.abs(afterNorm.y - beforeNorm.y), 'y del jugador intacto').toBeLessThan(0.005);
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir Propiedades').toBe(0);
    expect(await page.locator('.board-canvas svg [stroke="#2563eb"]').count(), 'no debe quedar selección').toBe(0);
    expect(await fieldCount(page), 'no debe crearse ni borrarse ningún elemento').toBe(beforeCount);
  });

  test('2. Cono ARMADO + pinch → no se crea cono, el contador no cambia, la herramienta sigue armada; un tap posterior coloca UNO', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await armCone(page);
    await expect(page.locator('.field-count')).toHaveText('0');
    await expect(page.locator('.placement-hint')).toBeVisible();
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;

    // Pinch (ambos dedos bajan juntos, se separan) sobre campo vacío.
    await twoFinger(page, cx, cy, [80, 220]);
    expect(await fieldCount(page), 'el pinch NO debe crear ningún cono').toBe(0);
    expect(await page.locator('.placement-hint').count(), 'la herramienta debe seguir armada tras el pinch').toBe(1);
    await expect(page.locator('.placement-hint')).toContainText('Cono');
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir Propiedades').toBe(0);

    // Un tap posterior coloca EXACTAMENTE UN cono.
    await tap(page, cx, cy - 40, 11);
    expect(await fieldCount(page), 'el tap coloca exactamente un cono').toBe(1);
    // FASE 3: la colocación de material es CONTINUA → sigue armado (hint visible, no vuelve
    // a Seleccionar). Se desarma con la herramienta Cursor (Seleccionar).
    await expect(page.locator('.placement-hint')).toHaveCount(1);
    await expect(page.locator('.placement-hint')).toContainText('Cono');
  });

  test('3. Jugador de PLANTILLA y Texto (armados) → el pinch no crea nada; un tap posterior coloca correctamente', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;

    // --- Plantilla ---
    await armRoster(page);
    await expect(page.locator('.placement-hint')).toBeVisible();
    await twoFinger(page, cx, cy, [80, 220]);
    expect(await fieldCount(page), 'el pinch no debe colocar al jugador de plantilla').toBe(0);
    expect(await page.locator('.placement-hint').count(), 'la colocación sigue armada').toBe(1);
    await tap(page, cx - 60, cy + 40, 12);
    expect(await fieldCount(page), 'el tap coloca al jugador de plantilla').toBe(1);
    await expect(page.locator('.placement-hint')).toHaveCount(0);

    // --- Texto ---
    await armText(page);
    expect(await fieldCount(page), 'el texto aún no se ha creado').toBe(1);
    await twoFinger(page, cx, cy, [80, 220]);
    expect(await fieldCount(page), 'el pinch no debe crear texto').toBe(1);
    expect(await page.locator('.placement-hint').count(), 'la colocación de texto sigue armada').toBe(1);
    await tap(page, cx + 40, cy + 60, 13);
    expect(await fieldCount(page), 'el tap crea exactamente un texto').toBe(2);
    await expect(page.locator('.placement-hint')).toHaveCount(0);
    // El texto creado queda seleccionado (manijas/línea visibles), PERO en móvil NO
    // auto-abre Propiedades (regresión cubierta por `e1-mobile-props`).
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await expect(page.locator('.board-canvas svg [stroke="#2563eb"]')).not.toHaveCount(0);
  });

  test('4. Dibujo (Flecha/Rect/Manos libres) armado → el pinch NO crea elemento ni preview ni history; luego se dibuja con normalidad', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;

    await armArrow(page);
    await expect(page.locator('.field-count')).toHaveText('0');
    // Nº de <path> del SVG antes del pinch (el campo ya dibuja arcos con <path>).
    const pathsBefore = await page.locator('.board-canvas svg path').count();
    // Pinch: no debe crear nada ni dejar preview (el SVG no debe añadir paths de flecha).
    await twoFinger(page, cx, cy, [80, 220]);
    expect(await fieldCount(page), 'el pinch no debe crear una flecha').toBe(0);
    // Fase 3: Deshacer/Rehacer viven en el menú contextual; aquí verificamos que sin historial
    // el atajo Ctrl+Z (gated por canUndo) es un NO-OP (equivale a Deshacer deshabilitado).
    await page.keyboard.press('Control+z');
    expect(await fieldCount(page), 'sin historial, undo es no-op').toBe(0);
    expect(await page.locator('.board-canvas svg path').count(), 'el pinch no debe dejar preview de dibujo').toBe(pathsBefore);
    expect(await page.locator('.board-canvas svg polygon').count(), 'no debe haber flecha (polygon) falsa').toBe(0);

    // Ahora un arrastre de UN dedo dibuja una flecha (de 0.2,0.3 a 0.6,0.6).
    const fit = await fitMode(page);
    const a = normToScreen(0.2, 0.3, host, fit);
    const b = normToScreen(0.62, 0.6, host, fit);
    await ptr(page, 'pointerdown', a.x, a.y, 201, true);
    await ptr(page, 'pointermove', b.x, b.y, 201);
    await ptr(page, 'pointerup', b.x, b.y, 201);
    expect(await fieldCount(page), 'tras el pinch, el arrastre dibuja la flecha').toBe(1);
    // Fase 3: el historial existe → Ctrl+Z (canUndo) deshace (equivale a Deshacer habilitado).
    await page.keyboard.press('Control+z');
    // Espera AUTOMÁTICA (no una lectura inmediata): el undo re-renderiza y el contador
    // del campo se actualiza en el siguiente frame. Una lectura inmediata es un flake.
    await expect(page.locator('.field-count'), 'undo del dibujo').toHaveText('0');
  });

  test('5. pequeño ARRASTRE del objeto con el 1er dedo + 2º dedo → el modelo vuelve EXACTAMENTE a la posición previa, el pinch funciona y NO hay ninguna edición fantasma', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    await placeComodinAt(page, 0.5, 0.5);
    const beforeCount = await fieldCount(page);
    // Colocar el Portero ya crea UNA entrada de undo (colocación). Tras el arrastre cancelado
    // no debe haber NINGUNA entrada fantasma encima: un Undo debe volver a vacío (0).
    // Fase 3: los botones de deshacer/rehacer viven en el menú contextual; aquí los verificamos
    // por atajos: Ctrl+Z deshace y Ctrl+Y rehace (neto = estado previo, sin romper el gesto).
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    // Espera AUTOMÁTICA: el neto de undo+redo deja el contador en el estado previo.
    await expect(page.locator('.field-count'), 'undo+redo de la colocación').toHaveText(String(beforeCount));

    // Tras el undo+redo el elemento se RE-RENDERIZA: recalcular su posición en pantalla y su
    // norma AHORA (justo antes del arrastre), no con las capturadas antes del undo. Así la
    // bajada del dedo acierta el objeto aunque el redo lo haya recolocado (p. ej. bajo carga).
    const obj2 = await objectScreen(page, '.entrenolab-board circle[r="2.5"]');
    const beforeNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');

    // Dedo A BAJA sobre el objeto y arrastra (supera el umbral) → comienza un movimiento.
    await ptr(page, 'pointerdown', obj2.x, obj2.y, 301, true);
    await ptr(page, 'pointermove', obj2.x + 40, obj2.y + 25, 301);
    // Espera observable (sin waitForTimeout): el movimiento en curso se pinta cuando el
    // norm cambia respecto al inicio. Así el test no depende de un retardo fijo.
    await expect.poll(async () => {
      const n = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
      return Math.abs(n.x - beforeNorm.x) + Math.abs(n.y - beforeNorm.y);
    }, { timeout: 4000 }).toBeGreaterThan(0.005);

    // Llega el SEGUNDO dedo: el modelo debe restaurarse EXACTAMENTE y empezar el pinch.
    await ptr(page, 'pointerdown', obj2.x + 180, obj2.y, 302, false);
    await ptr(page, 'pointermove', obj2.x + 30, obj2.y + 20, 301);
    await ptr(page, 'pointermove', obj2.x + 260, obj2.y, 302);
    await ptr(page, 'pointerup', obj2.x + 30, obj2.y + 20, 301);
    await ptr(page, 'pointerup', obj2.x + 260, obj2.y, 302);

    const afterNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    expect(Math.abs(afterNorm.x - beforeNorm.x), 'el objeto vuelve a su x original').toBeLessThan(0.005);
    expect(Math.abs(afterNorm.y - beforeNorm.y), 'el objeto vuelve a su y original').toBeLessThan(0.005);
    const afterView = await readView(page);
    expect(afterView.zoom, 'el pinch sigue funcionando').toBeGreaterThan(1.2);
    expect(await fieldCount(page), 'sin elementos extra').toBe(beforeCount);
    expect(await page.locator('.studio-panel').count(), 'Propiedades no debe quedar abierta').toBe(0);
    // Un único Undo deshace SOLO la colocación (vuelve a 0): el arrastre cancelado NO dejó
    // ninguna entrada fantasma de undo por encima. (matcher con reintentos: el pintado del
    // contador tras deshacer tarda un tick de change detection).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count'), 'un solo Undo vuelve al estado previo (0): sin edición fantasma').toHaveText('0');
  });

  test.describe('6. matriz: orientación × modo de pantalla (cada combinación en página nueva)', () => {
    const orientations: Array<'horizontal' | 'vertical'> = ['horizontal', 'vertical'];
    const fills: Array<'fill' | 'contain'> = ['fill', 'contain'];

    for (const orient of orientations) {
      for (const fill of fills) {
        test(`pinch en ${orient}/${fill} (punto medio centrado y desplazado, clamp 100–300%)`, async ({ page }) => {
          await page.setViewportSize({ width: 390, height: 844 });
          await seed(page, { orientation: orient, fill });
          await openClosed(page);

          // Un Portero en el centro del host (norm 0.5,0.5); no debe moverse.
          await placeComodinAtCenter(page);
          if (await page.locator('.studio-panel').isVisible().catch(() => false)) {
            await closeStudio(page);
          }
          const host = await hostBox(page);
          const cx = host.x + host.width / 2;
          const cy = host.y + host.height / 2;
          const beforeNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');

          // Pinch CENTRADO y simétrico: abre los dedos → zoom sube desde 1.
          await twoFinger(page, cx, cy, [70, 210]);
          const after = await readView(page);
          expect(after.zoom, `[${orient}/${fill}] pinch centrado debe subir el zoom`).toBeGreaterThan(1.05);
          expect(after.zoom, `[${orient}/${fill}] el zoom respeta el clamp 100–300%`).toBeGreaterThanOrEqual(1);
          expect(after.zoom, `[${orient}/${fill}] el zoom no supera el 300%`).toBeLessThanOrEqual(3.01);

          // Pinch con el punto medio DESPLAZADO, partiendo de vista limpia.
          await resetBoardView(page);
          const ox = host.x + host.width * 0.72;
          const oy = host.y + host.height * 0.28;
          await twoFinger(page, ox, oy - 20, [70, 190]);
          const afterOff = await readView(page);
          expect(afterOff.zoom, `[${orient}/${fill}] pinch desplazado debe subir el zoom`).toBeGreaterThan(1.05);
          expect(afterOff.zoom, `[${orient}/${fill}] zoom dentro del rango (máx)`).toBeLessThanOrEqual(3.01);

          // El objeto NO se mueve durante ninguno de los pellizcos.
          const afterNorm = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
          expect(Math.abs(afterNorm.x - beforeNorm.x), `[${orient}/${fill}] el objeto no se mueve en x`).toBeLessThan(0.01);
          expect(Math.abs(afterNorm.y - beforeNorm.y), `[${orient}/${fill}] el objeto no se mueve en y`).toBeLessThan(0.01);
          expect(await page.locator('.studio-panel').count(), `[${orient}/${fill}] el pinch no abre Propiedades`).toBe(0);
        });
      }
    }
  });

  test('7. el TAP táctil con una herramienta puntual coloca, y el ARRASTRE con Seleccionar PANEA (vacío) o MUEVE (objeto)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;

    // TAP táctil con puntual (Portero): coloca en el punto del tap.
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    // FASE B (paneles persistentes): elegir un jugador NO cierra el panel Jugadores.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
    // FASE B (regla C): el panel persistente tapa el punto (0.4,0.5) en móvil; se cierra por
    // su botón X (.panel-close) —que no desarma la colocación— para poder tocar el campo.
    await page.locator('.side-panel-left .panel-close').click();
    await expect(page.locator('.side-panel-left')).toHaveCount(0);
    const host2 = await hostBox(page);
    const s = normToScreen(0.4, 0.5, host2, await fitMode(page));
    await page.locator('.board-host').tap({ position: { x: s.x - host2.x, y: s.y - host2.y } });
    await expect(page.locator('.field-count')).toHaveText('1');
    // FASE 3: la colocación es continua → DESARMAR con Seleccionar para poder mover/panear.
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    const placed = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    expect(placed.x, 'la x del elemento coincide con el punto del tap').toBeCloseTo(0.4, 2);
    expect(placed.y, 'la y del elemento coincide con el punto del tap').toBeCloseTo(0.5, 2);

    // ARRASTRE con Seleccionar sobre VACÍO → NO PANEA (FASE 5: Seleccionar deselecciona,
    // no desplaza la vista). Se verifica que panX/panY no cambian.
    const host3 = await hostBox(page);
    const fit3 = await fitMode(page);
    const p0 = await readView(page);
    const panFrom = normToScreen(0.72, 0.18, host3, fit3);
    const panTo = normToScreen(0.9, 0.3, host3, fit3);
    await ptr(page, 'pointerdown', panFrom.x, panFrom.y, 401, true);
    await ptr(page, 'pointermove', panTo.x, panTo.y, 401);
    await ptr(page, 'pointerup', panTo.x, panTo.y, 401);
    const p1 = await readView(page);
    expect(Math.abs(p1.panX - p0.panX), 'Seleccionar sobre vacío NO panea (panX)').toBeLessThan(1);
    expect(Math.abs(p1.panY - p0.panY), 'Seleccionar sobre vacío NO panea (panY)').toBeLessThan(1);

    // ARRASTRE con la herramienta "Mano" sobre VACÍO → SÍ PANEA (modo explícito de desplazamiento).
    await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
    const p2 = await readView(page);
    await ptr(page, 'pointerdown', panFrom.x, panFrom.y, 403, true);
    await ptr(page, 'pointermove', panTo.x, panTo.y, 403);
    await ptr(page, 'pointerup', panTo.x, panTo.y, 403);
    const p3 = await readView(page);
    expect(Math.abs(p3.panX - p2.panX), 'Mano sobre vacío PANEA (panX cambia)').toBeGreaterThan(5);

    // ARRASTRE sobre el OBJETO → MUEVE el objeto.
    // Vuelve a "Seleccionar" (la prueba de paneo anterior activó "Desplazar campo").
    // Se espera de forma observable a que la herramienta esté realmente activa
    // (.rail-active) antes de medir y arrastrar: evita la carrera tool==hand que
    // convertiría el arrastre en paneo en lugar de movimiento.
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await expect(page.locator('.rail-btn[aria-label="Seleccionar y mover"]')).toHaveClass(/rail-active/);
    const objPos = await objectScreen(page, '.entrenolab-board circle[r="2.5"]');
    const beforeMove = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
    await ptr(page, 'pointerdown', objPos.x, objPos.y, 402, true);
    await ptr(page, 'pointermove', objPos.x + 45, objPos.y + 28, 402);
    await ptr(page, 'pointerup', objPos.x + 45, objPos.y + 28, 402);
    // Espera observable: el objeto se mueve (su norma cambia respecto al inicio). El
    // arrastre es diagonal (+45,+28), así que la distancia total confirma el movimiento
    // sin depender de un retardo fijo ni de un umbral por eje (que escala con el viewport).
    await expect.poll(async () => {
      const n = await objectNorm(page, '.entrenolab-board circle[r="2.5"]');
      return Math.abs(n.x - beforeMove.x) + Math.abs(n.y - beforeMove.y);
    }, { timeout: 4000 }).toBeGreaterThan(0.005);
  });

  test('8. el pinch sobre un material (Cono colocado) NO lo mueve ni abre Propiedades, y la selección no cambia', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const host = await hostBox(page);
    const obj = await placeConeAt(page, 0.5, 0.5);
    const beforeNorm = await imageNorm(page, '.board-canvas svg image[href*="cone"]');
    const beforeCount = await fieldCount(page);
    // Tras colocar un material queda seleccionado; la selección NO debe cambiar con el pinch.
    const selectBefore = await page.locator('.board-canvas svg [stroke="#2563eb"]').count();

    // Dedo A BAJA sobre el cono; el B a 130px a la derecha fuera del cono.
    await ptr(page, 'pointerdown', obj.x, obj.y, 501, true);
    await ptr(page, 'pointerdown', obj.x + 130, host.y + host.height / 2, 502, false);
    await ptr(page, 'pointermove', obj.x, obj.y, 501);
    await ptr(page, 'pointermove', obj.x + 220, host.y + host.height / 2, 502);
    await ptr(page, 'pointerup', obj.x, obj.y, 501);
    await ptr(page, 'pointerup', obj.x + 220, host.y + host.height / 2, 502);

    const afterNorm = await imageNorm(page, '.board-canvas svg image[href*="cone"]');
    expect(Math.abs(afterNorm.x - beforeNorm.x), 'el cono no se mueve en x').toBeLessThan(0.005);
    expect(Math.abs(afterNorm.y - beforeNorm.y), 'el cono no se mueve en y').toBeLessThan(0.005);
    expect((await readView(page)).zoom, 'el pinch debe hacer zoom').toBeGreaterThan(1.2);
    expect(await page.locator('.studio-panel').count(), 'el pinch no debe abrir Propiedades').toBe(0);
    expect(await page.locator('.board-canvas svg [stroke="#2563eb"]').count(), 'la selección NO cambia con el pinch').toBe(selectBefore);
    expect(await fieldCount(page), 'sin elementos extra').toBe(beforeCount);
  });
});
