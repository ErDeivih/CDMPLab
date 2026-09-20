import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';

// =============================================================
// Capturas del CONTRATO TÁCTIL de FASE B (móvil horizontal):
// jugador y material ANTES / DURANTE / DESPUÉS del arrastre,
// más el panel abierto y la barra inferior visible.
// No son aserciones: solo generan la evidencia visual de la
// entrega. Usa el arrastre TÁCTIL (PointerEvent 'touch').
// =============================================================

const SHOTS = 'e2e/shots/drag-fase-b';
fs.mkdirSync(SHOTS, { recursive: true });

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

async function ptrItem(page: Page, selector: string, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, pointerId: number): Promise<void> {
  await page.evaluate(({ selector, type, x, y, pointerId }) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    }));
  }, { selector, type, x, y, pointerId });
}

/** Inicia el arrastre y devuelve {startX,startY,pointerId} para capturar el "durante". */
async function beginItemDrag(page: Page, selector: string): Promise<{ startX: number; startY: number; id: number }> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const id = 81;
  await ptrItem(page, selector, 'pointerdown', startX, startY, id);
  return { startX, startY, id };
}
async function stepItemDrag(page: Page, selector: string, from: Pt, to: Pt, frac: number, id: number): Promise<void> {
  const x = from.x + ((to.x - from.x) * frac);
  const y = from.y + ((to.y - from.y) * frac);
  await ptrItem(page, selector, 'pointermove', x, y, id);
}
async function endItemDrag(page: Page, selector: string, drop: Pt, id: number): Promise<void> {
  await ptrItem(page, selector, 'pointerup', drop.x, drop.y, id);
}

test.describe('Capturas del contrato táctil de FASE B (móvil horizontal)', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('jugador genérico: antes / durante / después del arrastre', async ({ page }) => {
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const drop = normToScreen(0.72, 0.5, host, fit);
    // ANTES: panel Jugadores abierto y barra inferior visible, campo vacío.
    await page.screenshot({ path: `${SHOTS}/jugador-antes.png` });
    const sel = '.tray-player[title="Jugador Azul"]';
    const { startX, startY, id } = await beginItemDrag(page, sel);
    // DURANTE: el arrastre ya superó el umbral (preview junto al puntero) pero aún no soltó.
    await stepItemDrag(page, sel, { x: startX, y: startY }, drop, 0.55, id);
    // La pista en pleno arrastre indica que hay que soltar (no "toca el campo").
    await expect(page.locator('.placement-hint-text')).toContainText('Suelta en el campo para colocar');
    await page.screenshot({ path: `${SHOTS}/jugador-durante.png` });
    // DESPUÉS: soltado → una unidad y herramienta a Cursor.
    await stepItemDrag(page, sel, { x: startX, y: startY }, drop, 1, id);
    await endItemDrag(page, sel, drop, id);
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
    await page.screenshot({ path: `${SHOTS}/jugador-despues.png` });
  });

  test('material (Cono): antes / durante / después del arrastre + panel/barra', async ({ page }) => {
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const drop = normToScreen(0.72, 0.5, host, fit);
    const sel = '.rail-btn[title="Cono"]';
    // ANTES: panel Material abierto y barra inferior visible, campo vacío.
    await page.screenshot({ path: `${SHOTS}/cono-antes.png` });
    const { startX, startY, id } = await beginItemDrag(page, sel);
    await stepItemDrag(page, sel, { x: startX, y: startY }, drop, 0.55, id);
    await expect(page.locator('.placement-hint-text')).toContainText('Suelta en el campo para colocar');
    await page.screenshot({ path: `${SHOTS}/cono-durante.png` });
    await stepItemDrag(page, sel, { x: startX, y: startY }, drop, 1, id);
    await endItemDrag(page, sel, drop, id);
    await expect(page.locator('.field-count')).toHaveText('1');
    // Panel abierto y barra inferior visible tras el drop.
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const bar = await page.locator('.studio-tools').boundingBox();
    expect(bar).not.toBeNull();
    await page.screenshot({ path: `${SHOTS}/cono-despues-panel-barra.png` });
  });
});
