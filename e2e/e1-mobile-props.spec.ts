import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { longPress } from './gesture-helpers';

const SHOTS = 'e2e/shots/e1-mobile-props';
fs.mkdirSync(SHOTS, { recursive: true });

// Tamaños móviles que el dueño usa para probar: 360×800, 390×844, 430×932.
const MOBILE: Array<[number, number]> = [
  [360, 800],
  [390, 844],
  [430, 932],
];

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

/**
 * Regresión móvil: el panel de Propiedades NO debe abrirse automáticamente al
 * colocar/seleccionar un objeto (ni durante el movimiento/rotación), porque lo tapa
 * y bloquea la manija de rotación. Solo se abre cuando el usuario pulsa el botón
 * "Propiedades"; al cerrarlo con un toque la selección y las manijas se conservan.
 */

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
    // Evitar los hints flotantes (ayuda general y pista de "Llenar pantalla"), que se
    // superpondrían al campo en las capturas. Son overlays de pointer-events:none.
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

/** Abre la pizarra con la ayuda y la pista descartadas (campo limpio). */
async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // Los hints flotantes se pintan tras el primer render: esperar antes de descartarlos.
  await page.waitForTimeout(250);
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) {
    await page.locator('.fill-hint-close').click();
  }
  await expect(page.locator('.board-host')).toBeVisible();
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'la caja real de .board-host').not.toBeNull();
  return b!;
}

/** Modo de encaje actual: 'height' si el host lleva la clase board-fill (Llenar pantalla). */
async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

/** Despacha un PointerEvent sintético sobre `.board-host` (puntero táctil). */
async function ptr(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, pointerId: number, isPrimary = false): Promise<void> {
  await page.evaluate(({ type, x, y, pointerId, isPrimary }) => {
    const host = document.querySelector('.board-host') as HTMLElement | null;
    if (!host) return;
    const up = type === 'pointerup';
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

/** Centro en PANTALLA (coordenadas de página) del bounding box de un selector del SVG. */
async function objectScreen(page: Page, selector: string): Promise<Pt> {
  const b = (await page.locator(selector).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Norm (0..1) de un material <image> (el centro se codifica en x/y + width/height). */
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

/** Rotación (grados) del envoltorio externo `rotate(r …)` del elemento, subiendo por el DOM. */
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

/** Rotación del PRIMER grupo del SVG envuelto en rotate(...). Robusto porque en
 *  horizontal el campo no se envuelve en rotate, así que el primer grupo rotado es el
 *  elemento dibujado (y su ángulo coincide con `rot`). */
async function firstRot(page: Page): Promise<number> {
  return page.locator('.board-canvas svg').evaluate((svg) => {
    const g = svg.querySelector('g[transform*="rotate("]');
    if (!g) return 0;
    const m = /rotate\((-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
    return m ? parseFloat(m[1]) : 0;
  });
}

/** Nº de elementos del campo. */
async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Arma la colocación de un Cono (material). */
async function armCone(page: Page): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  await expect(page.locator('.placement-hint')).toBeVisible();
}

/** Arma la colocación de un Portero (jugador genérico). */
async function armComodin(page: Page): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Portero"]').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
}

/** Arrastra (arrastre de UN dedo, táctil) desde (x,y) por (dx,dy). */
async function drag(page: Page, x: number, y: number, dx: number, dy: number, id = 7): Promise<void> {
  await ptr(page, 'pointerdown', x, y, id, true);
  await ptr(page, 'pointermove', x + dx, y + dy, id);
  await ptr(page, 'pointerup', x + dx, y + dy, id);
  await page.waitForTimeout(60); // dejar que Angular pinte el movimiento
}

/** Rota el elemento seleccionado con la manija: baja en la manija y mueve el puntero
 *  a la DERECHA del centro (≈90°) para cambiar la rotación con el panel CERRADO. */
async function rotateGesture(page: Page, handleScreen: Pt, centerScreen: Pt, id = 8): Promise<void> {
  const v = { x: handleScreen.x - centerScreen.x, y: handleScreen.y - centerScreen.y };
  const r = Math.hypot(v.x, v.y);
  const target = { x: centerScreen.x + r, y: centerScreen.y };
  await ptr(page, 'pointerdown', handleScreen.x, handleScreen.y, id, true);
  await ptr(page, 'pointermove', target.x, target.y, id);
  await ptr(page, 'pointerup', target.x, target.y, id);
  await page.waitForTimeout(60);
}

// Selectores reutilizados.
const CONE = '.board-canvas svg image[href*="cone"]';
const PLAYER = '.entrenolab-board circle[r="2.5"]';
const SEL = '.board-canvas svg [stroke="#2563eb"]';

test.describe('E1 — el panel Propiedades NO bloquea el movimiento en móvil (≤700px)', () => {
  test.use({ hasTouch: true });

  for (const [W, H] of MOBILE) {
    test(`a ${W}×${H}: colocar/seleccionar/mover/rotar NO abre Propiedades; solo el botón la abre y la X mantiene la selección`, async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await openClosed(page);
      const fit = await fitMode(page);
      expect(fit, `[${W}x${H}] por defecto en móvil es "Llenar pantalla"`).toBe('height');

      // El panel comienza cerrado.
      await expect(page.locator('.studio-panel')).toHaveCount(0);

      // ---- 1. Colocar un cono: selección + manijas visibles, panel CERRADO ----
      await armCone(page);
      let host = await hostBox(page);                 // re-capturar: el host se mueve al abrir paneles
      let s = normToScreen(0.35, 0.6, host, fit);
      await page.touchscreen.tap(s.x, s.y);
      await expect(page.locator('.field-count')).toHaveText('1');
      await expect(page.locator('.studio-panel')).toHaveCount(0);          // NO auto-abre
      await expect(page.locator(SEL)).not.toHaveCount(0);                  // manijas/selección visibles
      // Fase 6: la rotación ya no es una manija continua sino la BARRA/MENÚ contextual (±90°).
      await expect(page.locator('.rot-handle')).toHaveCount(0);            // sin manija de rotación
      const coneScreen = await objectScreen(page, CONE);                   // posición real del cono (pantalla)
      // Fase 3: el menú contextual se abre con pulsación larga.
      await longPress(page, coneScreen.x, coneScreen.y);
      await expect(page.locator('.context-bar')).toBeVisible();            // menú contextual (±90°)
      if (W === 390 && H === 844) {
        await page.screenshot({ path: `${SHOTS}/movil-objeto-seleccionado-panel-cerrado.png`, fullPage: false });
      }

      // ---- 1b. Colocar un Portero (jugador) para poder seleccionarlo después ----
      await armComodin(page);
      host = await hostBox(page);
      s = normToScreen(0.65, 0.35, host, fit);
      await page.touchscreen.tap(s.x, s.y);
      await expect(page.locator('.field-count')).toHaveText('2');
      await expect(page.locator('.studio-panel')).toHaveCount(0);          // sigue cerrado
      const playerScreen = await objectScreen(page, PLAYER);               // posición real del jugador (pantalla)

      // ---- 2. Seleccionar un jugador existente → panel CERRADO ----
      // (tras colocar, la herramienta ya es "Seleccionar"; un toque sobre el jugador lo selecciona)
      await page.touchscreen.tap(playerScreen.x, playerScreen.y);
      await expect(page.locator('.studio-panel')).toHaveCount(0);          // NO auto-abre
      await expect(page.locator(SEL)).not.toHaveCount(0);                  // selección presente

      // ---- 3. Arrastrar (táctil) un material y un jugador → cambia la posición, panel CERRADO ----
      // Jugador primero y material después (así el material queda seleccionado para rotar).
      const playerBefore = await objectNorm(page, PLAYER);
      await drag(page, playerScreen.x, playerScreen.y, -38, -26);
      await expect(page.locator('.studio-panel')).toHaveCount(0);          // mover NO abre
      const playerAfter = await objectNorm(page, PLAYER);
      expect(playerAfter.x - playerBefore.x, '[player] el jugador se mueve con el arrastre').toBeLessThan(-0.01);

      const coneBefore = await imageNorm(page, CONE);
      await drag(page, coneScreen.x, coneScreen.y, 42, 22);
      await expect(page.locator('.studio-panel')).toHaveCount(0);          // mover NO abre
      const coneAfter = await imageNorm(page, CONE);
      expect(coneAfter.x - coneBefore.x, '[cone] el material se mueve con el arrastre').toBeGreaterThan(0.01);
      if (W === 390 && H === 844) {
        await page.screenshot({ path: `${SHOTS}/movil-durante-movimiento-panel-cerrado.png`, fullPage: false });
      }

      // ---- 4. Rotar con el MENÚ CONTEXTUAL (panel CERRADO) → cambia `rot` a ±90° ----
      // Tras arrastrar el material por último, el cono es el elemento seleccionado: el menú
      // se abre con pulsación larga (Fase 3) y el panel sigue cerrado.
      const coneNow = await objectScreen(page, CONE);
      await longPress(page, coneNow.x, coneNow.y);
      await expect(page.locator('.studio-panel')).toHaveCount(0);
      await expect(page.locator('.context-bar')).toBeVisible();
      const rotBefore = await firstRot(page);
      await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
      await page.waitForTimeout(100); // dejar que Angular pinte el giro del cono
      await expect(page.locator('.studio-panel')).toHaveCount(0);          // rotar NO abre
      const rotAfter = await firstRot(page);
      const expected = (((rotBefore % 360) + 360) % 360 + 90) % 360;
      expect(rotAfter, '[rotate] la rotación gira a +90° desde la barra de contexto').toBeCloseTo(expected, 0);
      if (W === 390 && H === 844) {
        await page.screenshot({ path: `${SHOTS}/movil-manija-rotacion-visible.png`, fullPage: false });
      }

      // ---- 5. Pulsar el botón "Propiedades" → se abre el inspector correcto ----
      await page.locator('button[aria-label="Propiedades"]').click();
      await expect(page.locator('.studio-panel')).toBeVisible();
      // Fase 6: el inspector ya NO ofrece el control numérico "Rotación (°)".
      expect(await page.locator('.studio-panel .inspector .field', { hasText: 'Rotación' }).count(), '[inspector] sin control Rotación (°)').toBe(0);
      if (W === 390 && H === 844) {
        await page.screenshot({ path: `${SHOTS}/movil-propiedades-explicitas.png`, fullPage: false });
      }

      // ---- 6. Cerrar con UN toque → panel CERRADO y selección conservada ----
      await page.locator('.studio-panel .panel-close').click();
      await expect(page.locator('.studio-panel')).toHaveCount(0);          // cerrado en un toque
      await expect(page.locator(SEL)).not.toHaveCount(0);                  // la selección sigue viva
      await expect(page.locator('.field-count')).toHaveText('2');          // los objetos siguen

      // ---- 7. Un Undo por movimiento/rotación, sin entradas fantasma ----
      // La última operación fue cerrar el panel (no es histórico). La anterior en el
      // historial es la ROTACIÓN: un único Undo la revierte, pero NO borra el cono.
      await page.keyboard.press('Control+z');
      await expect(page.locator('.field-count'), '[undo] un solo Undo no borra elementos').toHaveText('2');
      // El render tras deshacer es asíncrono: esperar a que la rotación vuelva a la previa.
      await expect.poll(async () => firstRot(page), { timeout: 4000 }).toBeCloseTo(rotBefore, 0);
    });
  }
});
