import { test, expect, Page, Locator } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';

// =============================================================
// FASE B — Aceptación: paneles persistentes + colocación continua.
// Cubre los puntos de aceptación que no son obvios en las specs de
// familia/matrix: tocar fuera no cierra, minimizar/reabrir, y el
// arrastre móvil que coloca exactamente una unidad.
//
// Incluye la integración de la antigua prueba temporal `_drag-check`
// (drag por ratón) y la especificación completa del CONTRATO TÁCTIL
// (arrastre de UN dedo → una unidad, desarme, un toque posterior no
// coloca otra, Cursor/Mano siguen funcionando, escritorio conserva la
// colocación continuada).
// =============================================================

const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;
type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

function normToScreen(nx: number, ny: number, host: Box, fit: Fit): Pt {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  return { x: host.x + host.width / 2 + cx - host.width / 2, y: host.y + host.height / 2 + cy - host.height / 2 };
}

async function seed(page: Page, players: unknown[] = []): Promise<void> {
  await page.addInitScript((players) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, players);
}

/** Un jugador REAL de plantilla (usado para la regla de "una sola instancia"). */
function realPlayer(): unknown {
  return {
    id: 'pl-1',
    teamId: 't1',
    name: 'David',
    number: 10,
    position: 'MC',
    color: '#1a73e8',
    active: true,
    createdAt: new Date().toISOString(),
  };
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (await page.locator(sel).isVisible().catch(() => false)) await page.locator(sel).click();
  }
}
async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b).not.toBeNull();
  return b!;
}
async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}
async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

// ---------- Helpers de arrastre TÁCTIL (PointerEvent sintético) ----------

/** Despacha un PointerEvent táctil sobre el elemento del panel que casa con `selector`. */
async function ptrItem(page: Page, selector: string, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture', x: number, y: number, pointerId: number): Promise<void> {
  await page.evaluate(({ selector, type, x, y, pointerId }) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
    }));
  }, { selector, type, x, y, pointerId });
}

/** Arrastra TÁCTIL el elemento `selector` del panel hasta el punto de pantalla `drop`. */
async function dragItemToField(page: Page, selector: string, drop: Pt, steps = 8): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const id = 91;
  await ptrItem(page, selector, 'pointerdown', startX, startY, id);
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((drop.x - startX) * i) / steps;
    const y = startY + ((drop.y - startY) * i) / steps;
    await ptrItem(page, selector, 'pointermove', x, y, id);
  }
  await ptrItem(page, selector, 'pointerup', drop.x, drop.y, id);
}

/** Despacha un PointerEvent táctil sobre `.board-host` (tap/gesto sobre el campo). */
async function ptrBoard(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number, pointerId = 7, isPrimary = false): Promise<void> {
  await page.evaluate(({ type, x, y, pointerId, isPrimary }) => {
    const host = document.querySelector('.board-host') as HTMLElement | null;
    if (!host) return;
    host.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
    }));
  }, { type, x, y, pointerId, isPrimary });
}

/** Un TAP táctil (down+up sin moverse) sobre un punto de pantalla. */
async function tapBoard(page: Page, x: number, y: number): Promise<void> {
  await ptrBoard(page, 'pointerdown', x, y, 7, true);
  await ptrBoard(page, 'pointerup', x, y, 7);
}

/** Toque corto táctil COMPLETO (down+up+click) sobre un elemento del panel, como ocurre en
 *  un dispositivo real donde el toque dispara el click posterior. Permite verificar que el
 *  click ejecuta el handler pero, en TÁCTIL, NO arma la colocación (Defecto 1). */
async function shortTouchTap(page: Page, selector: string, x: number, y: number, id: number): Promise<void> {
  await ptrItem(page, selector, 'pointerdown', x, y, id);
  await ptrItem(page, selector, 'pointerup', x, y, id);
  await page.evaluate(({ selector }) => {
    (document.querySelector(selector) as HTMLElement | null)?.click();
  }, { selector });
}

/** Botón de la herramienta "Cursor / Seleccionar y mover" del raíl inferior. */
async function cursorBtn(page: Page): Promise<Locator> {
  return page.locator('.rail-btn[title="Seleccionar y mover"]').first();
}

test.describe('FASE B — aceptación de paneles persistentes y colocación continua', () => {
  test.describe('escritorio', () => {
    test('tocar fuera del panel NO cierra Jugadores, ni tras elegir un color', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      // Elegir un color: el panel permanece abierto.
      await page.locator('.tray-player[title="Jugador Azul"]').click();
      await expect(page.locator('.side-panel-left'), 'el panel permanece abierto al elegir color').toBeVisible();
      // Tocar el campo (fuera del panel) NO lo cierra.
      const host = await hostBox(page);
      const p = normToScreen(0.5, 0.5, host, await fitMode(page));
      const c = (await page.locator('.tray-player[title="Jugador Azul"]').boundingBox())!;
      await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2); // clic en la ficha
      await page.mouse.click(p.x, p.y); // clic en el campo
      await expect(page.locator('.side-panel-left'), 'tocar el campo no cierra Jugadores').toBeVisible();
    });

    test('tocar fuera del panel NO cierra Material', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const p = normToScreen(0.5, 0.5, await hostBox(page), await fitMode(page));
      await page.mouse.click(p.x, p.y);
      await expect(page.locator('.tools-panel-side'), 'tocar el campo no cierra Material').toBeVisible();
    });

    test('el control explícito minimiza el panel y este puede reabrirse', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.locator('.side-panel-left .panel-close').click();
      await expect(page.locator('.side-panel-left')).toHaveCount(0);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
    });

    test('colocación continua: 3 jugadores con un solo color y Cursor cancela', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await page.locator('.tray-player[title="Jugador Azul"]').click();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      for (const [nx, ny] of [[0.3, 0.5], [0.4, 0.62], [0.5, 0.5]] as Array<[number, number]>) {
        const p = normToScreen(nx, ny, host, fit);
        await page.mouse.click(p.x, p.y);
      }
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
      // Cursor cancela la colocación continua.
      await (await cursorBtn(page)).click();
      const p = normToScreen(0.6, 0.5, host, fit);
      await page.mouse.click(p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
    });

    test('escritorio conserva colocación continuada al arrastrar con ratón (drag = una unidad y sigue armado)', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await page.locator('.tray-player[title="Jugador Azul"]').click();
      const chip = page.locator('.tray-player[title="Jugador Azul"]');
      const cb = (await chip.boundingBox())!;
      const host = await hostBox(page);
      const drop = normToScreen(0.5, 0.5, host, await fitMode(page));
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.mouse.down();
      await page.mouse.move(drop.x, drop.y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // Ratón (escritorio): la colocación sigue ARMADA (continuada). Un clic siguiente sobre
      // el campo añade una segunda unidad sin volver a elegir la herramienta.
      const p2 = normToScreen(0.62, 0.5, host, await fitMode(page));
      await page.mouse.click(p2.x, p2.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);
    });
  });

  test.describe('móvil horizontal', () => {
    test('un arrastre desde el panel coloca EXACTAMENTE una unidad', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const chip = page.locator('.tray-player[title="Jugador Azul"]');
      const cb = (await chip.boundingBox())!;
      const host = await hostBox(page);
      const drop = { x: host.x + host.width * 0.75, y: host.y + host.height * 0.5 };
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.mouse.down();
      await page.mouse.move(drop.x, drop.y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      await expect(page.locator('.side-panel-left')).toBeVisible();
    });

    test('DRAG por ratón: arrastrar ficha genérica desde el panel coloca UNA (integrada de _drag-check)', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const chip = page.locator('.tray-player[title="Jugador Azul"]');
      const cb = (await chip.boundingBox())!;
      const host = (await page.locator('.board-host').boundingBox())!;
      const drop = { x: host.x + host.width * 0.75, y: host.y + host.height * 0.5 };
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.mouse.down();
      await page.mouse.move(drop.x, drop.y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      await expect(page.locator('.side-panel-left')).toBeVisible();
      // El jugador genérico (círculo azul) está en el campo.
      expect(await page.locator('.entrenolab-board circle[r="2.5"][fill="#1a73e8"]').count()).toBe(1);
    });

    test('la barra inferior sigue visible y operable con el panel abierto', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const bar = await page.locator('.studio-tools').boundingBox();
      expect(bar).not.toBeNull();
      // La barra es operable: pulsar Cursor cambia la herramienta.
      await (await cursorBtn(page)).click();
      await expect(await cursorBtn(page)).toHaveClass(/rail-active/);
    });
  });

  // ---------- CONTRATO TÁCTIL (un dedo, PointerEvent 'touch') ----------
  test.describe('táctil (contrato móvil)', () => {
    test('arrastrar jugador genérico coloca UNA y un toque posterior en el campo no añade otra', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const drop = normToScreen(0.7, 0.5, host, fit);
      await dragItemToField(page, '.tray-player[title="Jugador Azul"]', drop);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // Un toque posterior sobre el campo NO coloca otra (la herramienta se desarmó y pasó a Cursor).
      const p = normToScreen(0.35, 0.5, host, fit);
      await tapBoard(page, p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // El panel permanece abierto tras el arrastre.
      await expect(page.locator('.side-panel-left')).toBeVisible();
    });

    test('un segundo jugador genérico requiere un segundo arrastre (el toque no vuelve a armar)', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      await dragItemToField(page, '.tray-player[title="Jugador Azul"]', normToScreen(0.7, 0.5, host, fit));
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // Tocar el campo después del drop NO coloca una segunda.
      const t1 = normToScreen(0.4, 0.5, host, fit);
      await tapBoard(page, t1.x, t1.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // Un SEGUNDO arrastre (desde el panel) sí coloca la segunda.
      await dragItemToField(page, '.tray-player[title="Jugador Azul"]', normToScreen(0.4, 0.55, host, fit));
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);
    });

    test('arrastrar jugador real coloca EXACTAMENTE una y deshabilita su tarjeta', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page, [realPlayer()]);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const item = page.locator('.side-panel-left .roster-item').first();
      await expect(item).toBeEnabled();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      await dragItemToField(page, '.side-panel-left .roster-item', normToScreen(0.7, 0.5, host, fit));
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // La tarjeta del jugador real queda DESHABILITADA (instancia única, no duplicable).
      await expect(item).toBeDisabled();
      await expect(item).toHaveClass(/tray-disabled/);
      await expect(page.locator('.side-panel-left')).toBeVisible();
    });

    test('arrastrar Cono coloca EXACTAMENTE una y un toque posterior no añade otra', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      await dragItemToField(page, '.rail-btn[title="Cono"]', normToScreen(0.7, 0.5, host, fit));
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      const t2 = normToScreen(0.5, 0.5, host, fit);
      await tapBoard(page, t2.x, t2.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      await expect(page.locator('.tools-panel-side')).toBeVisible();
    });

    test('arrastrar Maniquí tres veces coloca tres unidades', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      await dragItemToField(page, '.rail-btn[title="Maniquí individual"]', normToScreen(0.35, 0.5, host, fit));
      await dragItemToField(page, '.rail-btn[title="Maniquí individual"]', normToScreen(0.5, 0.5, host, fit));
      await dragItemToField(page, '.rail-btn[title="Maniquí individual"]', normToScreen(0.65, 0.5, host, fit));
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
    });

    test('seleccionar material con toque corto NO coloca nada por sí solo', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      // Toque corto sobre la tarjeta del Cono (down+up sin mover): puede armar la colocación
      // pero NO coloca nada por sí solo.
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const id = 92;
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', cb.x + cb.width / 2, cb.y + cb.height / 2, id);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', cb.x + cb.width / 2, cb.y + cb.height / 2, id);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('pulsación larga sobre material abre variantes y NO inicia un arrastre', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const id = 93;
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', cb.x + cb.width / 2, cb.y + cb.height / 2, id);
      // Mantener sin mover más de LONG_PRESS (550 ms): espera OBSERVABLE a que el
      // temporizador abra el selector de variantes (no una espera fija).
      await expect(page.locator('.bar-variant-pop')).toBeVisible();
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', cb.x + cb.width / 2, cb.y + cb.height / 2, id);
      // Se abre el selector de variantes (bar-variant-pop) y NO se coloca nada.
      await expect(page.locator('.bar-variant-pop')).toBeVisible();
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('mover antes de completar la pulsación larga inicia el arrastre y NO abre variantes', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      // Bajar y mover de inmediato (antes de 550 ms): el gesto se convierte en arrastre.
      await dragItemToField(page, '.rail-btn[title="Cono"]', normToScreen(0.7, 0.5, host, fit), 4);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // No se abre el selector de variantes.
      await expect(page.locator('.bar-variant-pop')).toHaveCount(0);
    });

    test('pointercancel no coloca nada y deja la pizarra usable', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const startX = cb.x + cb.width / 2;
      const startY = cb.y + cb.height / 2;
      const id = 94;
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', startX, startY, id);
      // Un pequeño movimiento (puede superar el umbral) y luego pointercancel.
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', startX + 24, startY, id);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointercancel', startX + 40, startY, id);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
      // La pizarra sigue usable: Cursor y Mano siguen activables.
      await (await cursorBtn(page)).click();
      await expect(await cursorBtn(page)).toHaveClass(/rail-active/);
      await page.locator('.rail-btn[title="Desplazar campo"]').click();
      await expect(page.locator('.rail-btn[title="Desplazar campo"]')).toHaveClass(/rail-active/);
    });

    test('el panel permanece abierto y la barra inferior visible tras cada arrastre', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      await dragItemToField(page, '.rail-btn[title="Cono"]', normToScreen(0.7, 0.5, host, fit));
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const bar = await page.locator('.studio-tools').boundingBox();
      expect(bar).not.toBeNull();
    });

    test('Cursor y Mano siguen funcionando tras un drop táctil', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      await dragItemToField(page, '.tray-player[title="Jugador Azul"]', normToScreen(0.7, 0.5, host, fit));
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      // Tras el drop, la herramienta es Cursor.
      await expect(await cursorBtn(page)).toHaveClass(/rail-active/);
      // Mano sigue operable: pulsarla activa la herramienta y el panel sigue abierto.
      await page.locator('.rail-btn[title="Desplazar campo"]').click();
      await expect(page.locator('.rail-btn[title="Desplazar campo"]')).toHaveClass(/rail-active/);
      await expect(page.locator('.side-panel-left')).toBeVisible();
    });
  });

  // ---------- DEFECTOS de contrato (toque corto táctil / segundo dedo / mensaje) ----------
  test.describe('táctil (defectos de contrato)', () => {
    test('T1: toque corto táctil en Cono NO arma; tocar el campo deja 0 objetos', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const x = cb.x + cb.width / 2;
      const y = cb.y + cb.height / 2;
      await shortTouchTap(page, '.rail-btn[title="Cono"]', x, y, 11);
      // No arma colocación individual.
      await expect(page.locator('.placement-hint')).toHaveCount(0);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const p = normToScreen(0.7, 0.5, host, fit);
      await tapBoard(page, p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('T2: toque corto táctil en jugador genérico NO arma; tocar el campo deja 0 objetos', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const chip = page.locator('.tray-player[title="Jugador Azul"]');
      const cb = (await chip.boundingBox())!;
      const x = cb.x + cb.width / 2;
      const y = cb.y + cb.height / 2;
      await shortTouchTap(page, '.tray-player[title="Jugador Azul"]', x, y, 21);
      await expect(page.locator('.placement-hint')).toHaveCount(0);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const p = normToScreen(0.7, 0.5, host, fit);
      await tapBoard(page, p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('T3: toque corto táctil en jugador REAL NO arma; tocar el campo deja 0 objetos', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page, [realPlayer()]);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const item = page.locator('.side-panel-left .roster-item').first();
      const ib = (await item.boundingBox())!;
      const x = ib.x + ib.width / 2;
      const y = ib.y + ib.height / 2;
      await shortTouchTap(page, '.side-panel-left .roster-item', x, y, 31);
      await expect(page.locator('.placement-hint')).toHaveCount(0);
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const p = normToScreen(0.7, 0.5, host, fit);
      await tapBoard(page, p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('T4: tocar un color genérico actualiza el color de formación sin armar colocación individual', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const chip = page.locator('.tray-player[title="Jugador Verde"]');
      const cb = (await chip.boundingBox())!;
      const x = cb.x + cb.width / 2;
      const y = cb.y + cb.height / 2;
      await shortTouchTap(page, '.tray-player[title="Jugador Verde"]', x, y, 41);
      // No arma colocación individual.
      await expect(page.locator('.placement-hint')).toHaveCount(0);
      // Aplicar una formación con el color recordado (verde #1f7a4d): 11 jugadores verdes.
      await page.locator('.formation-btn', { hasText: '4-3-3' }).first().click();
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
      expect(await page.locator('.entrenolab-board circle[r="2.5"][fill="#1f7a4d"]').count()).toBe(11);
    });

    test('T5: la activación por teclado en escritorio sigue armando la colocación', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      // Enfocar la tarjeta del Cono y activarla por teclado (Enter): no es un toque táctil.
      await page.locator('.rail-btn[title="Cono"]').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.placement-hint')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const p = normToScreen(0.7, 0.5, host, fit);
      await page.mouse.click(p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    });

    test('T6: primer dedo arrastra Cono y un segundo dedo toca el campo → 0 objetos', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const drop = normToScreen(0.72, 0.5, host, fit);
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      // Primer dedo: arranca el arrastre (down + movimiento, sin soltar).
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', sx, sy, 51);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', sx + 30, sy, 51);
      // Segundo dedo: toca el CAMPO → cancela el gesto del panel (sin colocar).
      await ptrBoard(page, 'pointerdown', drop.x, drop.y, 52, false);
      await ptrBoard(page, 'pointerup', drop.x, drop.y, 52);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', sx + 30, sy, 51);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('T7: primer dedo arrastra jugador y un segundo dedo toca el panel → 0 objetos', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const chip = page.locator('.tray-player[title="Jugador Azul"]');
      const cb = (await chip.boundingBox())!;
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      await ptrItem(page, '.tray-player[title="Jugador Azul"]', 'pointerdown', sx, sy, 61);
      await ptrItem(page, '.tray-player[title="Jugador Azul"]', 'pointermove', sx + 30, sy, 61);
      // Segundo dedo: toca el PANEL (otra ficha genérica) → cancela el gesto.
      const chip2 = page.locator('.tray-player[title="Jugador Rojo"]');
      const cb2 = (await chip2.boundingBox())!;
      await ptrItem(page, '.tray-player[title="Jugador Rojo"]', 'pointerdown', cb2.x + cb2.width / 2, cb2.y + cb2.height / 2, 62);
      await ptrItem(page, '.tray-player[title="Jugador Rojo"]', 'pointerup', cb2.x + cb2.width / 2, cb2.y + cb2.height / 2, 62);
      await ptrItem(page, '.tray-player[title="Jugador Azul"]', 'pointerup', sx + 30, sy, 61);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('T8: tras cancelar con segundo dedo, un nuevo drag normal coloca exactamente uno', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const drop = normToScreen(0.72, 0.5, host, fit);
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      // Primer dedo inicia drag; segundo dedo en el campo cancela.
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', sx, sy, 71);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', sx + 30, sy, 71);
      await ptrBoard(page, 'pointerdown', drop.x, drop.y, 72, false);
      await ptrBoard(page, 'pointerup', drop.x, drop.y, 72);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', sx + 30, sy, 71);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
      // Un nuevo drag normal coloca exactamente uno.
      await dragItemToField(page, '.rail-btn[title="Cono"]', drop);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    });

    test('T9: pointercancel y lostpointercapture limpian los registros (no colocan)', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      // pointercancel en pleno arrastre.
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', sx, sy, 81);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', sx + 30, sy, 81);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointercancel', sx + 40, sy, 81);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
      // lostpointercapture tras un segundo arrastre.
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', sx, sy, 82);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', sx + 30, sy, 82);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'lostpointercapture', sx + 40, sy, 82);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });

    test('T10: durante un arrastre la pista dice "Suelta en el campo para colocar…"', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const drop = normToScreen(0.72, 0.5, host, fit);
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', sx, sy, 91);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', sx + 40, sy, 91);
      // En pleno arrastre la pista debe ser "Suelta en el campo…".
      await expect(page.locator('.placement-hint-text')).toHaveText(/Suelta en el campo para colocar Cono/);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', drop.x, drop.y, 91);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    });

    test('T11: con la herramienta armada en escritorio la pista dice "Toca el campo…"', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      // Clic de ratón en el Cono arma la colocación continuada (escritorio).
      await page.locator('.rail-btn[title="Cono"]').click();
      await expect(page.locator('.placement-hint-text')).toHaveText(/Toca el campo para colocar a Cono/);
      await expect(page.locator('.placement-hint')).toBeVisible();
    });

    test('T12: tras cancelar con segundo dedo no hay historial/undo fantasma', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const drop = normToScreen(0.72, 0.5, host, fit);
      const card = page.locator('.rail-btn[title="Cono"]');
      const cb = (await card.boundingBox())!;
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', sx, sy, 101);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', sx + 30, sy, 101);
      await ptrBoard(page, 'pointerdown', drop.x, drop.y, 102, false);
      await ptrBoard(page, 'pointerup', drop.x, drop.y, 102);
      await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', sx + 30, sy, 101);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
      // Deshacer no revierte nada (el gesto cancelado no creó entrada fantasma).
      await page.keyboard.press('Control+z');
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });
  });
});
