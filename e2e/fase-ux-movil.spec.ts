import { test, expect, Page, Locator } from '@playwright/test';
import { ptrItem, dragItemToField, ptrBoard, tapBoard } from './touch-helpers';

// =============================================================
// FASE UX — comprobación móvil FINAL (horizontal 844×390).
// Panel persistente no oculta su control, barra visible, arrastre
// desde Jugadores/Material coloca exactamente una, toque corto NO
// arma, segundo dedo cancela, y tras el drop no hay colocación
// fantasma. (Cursor no panea / Mano sí se verifican en
// pizarra-usabilidad-colocacion-continua E.)
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

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-fill', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
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
async function cursorBtn(page: Page): Promise<Locator> {
  return page.locator('.rail-btn[title="Seleccionar y mover"]').first();
}

// Los helpers táctiles (ptrItem/dragItemToField/ptrBoard/tapBoard) viven ahora en
// `touch-helpers.ts` (UNA sola implementación reutilizada por los specs de FASE H y este).

test.describe('FASE UX — comprobación móvil final (horizontal 844×390)', () => {
  test('el panel no oculta su control X y la barra inferior sigue visible y operable', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page); await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    await expect(page.locator('.tools-panel-side .panel-close'), 'control X del panel visible').toBeVisible();
    const bar = await page.locator('.studio-tools').boundingBox();
    expect(bar).not.toBeNull();
    await (await cursorBtn(page)).click();
    await expect(await cursorBtn(page)).toHaveClass(/rail-active/);
  });

  test('arrastrar Cono desde Material coloca exactamente UNA y el toque posterior no añade', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page); await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const host = await hostBox(page); const fit = await fitMode(page);
    const drop = normToScreen(0.7, 0.5, host, fit);
    await dragItemToField(page, '.rail-btn[title="Cono"]', drop);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    // El drop desarma (Cursor) y un toque posterior NO coloca otra.
    await expect(await cursorBtn(page)).toHaveClass(/rail-active/);
    const p = normToScreen(0.4, 0.5, host, fit);
    await tapBoard(page, p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  });

  test('arrastrar jugador genérico desde Jugadores coloca una y deja el panel abierto', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page); await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const host = await hostBox(page); const fit = await fitMode(page);
    await dragItemToField(page, '.tray-player[title="Jugador Azul"]', normToScreen(0.7, 0.5, host, fit));
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await expect(page.locator('.side-panel-left')).toBeVisible();
  });

  test('un toque corto táctil en Cono NO arma; tocar el campo deja 0', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page); await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const card = page.locator('.rail-btn[title="Cono"]');
    const cb = (await card.boundingBox())!;
    const x = cb.x + cb.width / 2; const y = cb.y + cb.height / 2;
    await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', x, y, 51);
    await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', x, y, 51);
    await expect(page.locator('.placement-hint')).toHaveCount(0);
    const host = await hostBox(page); const fit = await fitMode(page);
    const p = normToScreen(0.7, 0.5, host, fit);
    await tapBoard(page, p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
  });

  test('un SEGUNDO dedo durante el arrastre de panel CANCELA (0 objetos, pizarra usable)', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page); await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const host = await hostBox(page); const fit = await fitMode(page);
    const drop = normToScreen(0.7, 0.5, host, fit);
    const card = page.locator('.rail-btn[title="Cono"]');
    const cb = (await card.boundingBox())!;
    const sx = cb.x + cb.width / 2; const sy = cb.y + cb.height / 2;
    await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerdown', sx, sy, 71);
    await ptrItem(page, '.rail-btn[title="Cono"]', 'pointermove', sx + 30, sy, 71);
    // Segundo dedo toca el campo → cancela (sin colocar).
    await ptrBoard(page, 'pointerdown', drop.x, drop.y, 72, false);
    await ptrBoard(page, 'pointerup', drop.x, drop.y, 72);
    await ptrItem(page, '.rail-btn[title="Cono"]', 'pointerup', sx + 30, sy, 71);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    // La pizarra sigue usable: un nuevo drag normal coloca exactamente uno.
    await dragItemToField(page, '.rail-btn[title="Cono"]', drop);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  });
});
