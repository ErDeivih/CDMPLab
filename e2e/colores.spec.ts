import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { longPress, fillBoardTitle } from './gesture-helpers';

// FASE 1 — color de líneas/familias al estilo Bcoach.
// Matriz para la familia `line`: elegir rojo antes de dibujar → previsualización
// roja → crear → volver al cursor → seleccionar → cambiar a azul → undo → redo →
// duplicar (azul) → guardar/reabrir (azul) → PNG → respaldo.
const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
type Box = { x: number; y: number; width: number; height: number };
function normToScreen(nx: number, ny: number, b: Box): [number, number] {
  const s = Math.min(b.width / VBW, b.height / VBH);
  const offX = (b.width - VBW * s) / 2;
  const offY = (b.height - VBH * s) / 2;
  const cx = offX + (nx * RECT.w + RECT.x) * s;
  const cy = offY + (ny * RECT.h + RECT.y) * s;
  return [b.x + cx, b.y + cy];
}
async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}
async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    // FASE G: observable — el letterbox se espera con la ausencia de board-fill.
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}
// PALETTE = ['#1a73e8','#c0392b','#1f7a4d','#e67e22','#7d3c98','#b8860b','#111111','#f4f4f4']
async function setPaletteColor(page: Page, hex: string, scope: '.tools-caption' | '.studio-panel .inspector'): Promise<void> {
  const index = ['#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111', '#f4f4f4'].indexOf(hex);
  await page.locator(`${scope} .swatch`).nth(index).click();
}
async function lineStroke(page: Page): Promise<string | null> {
  return page.locator('.board-canvas svg [data-el-type="line"]').first().getAttribute('data-color');
}
async function drawLine(page: Page, host: Box, from: [number, number], to: [number, number]): Promise<void> {
  const a = normToScreen(from[0], from[1], host);
  const b = normToScreen(to[0], to[1], host);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 }); await page.mouse.up();
}

test('color de línea: rojo → azul, undo/redo, duplicar, persiste en guardar/reabrir, PNG y respaldo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const host = (await page.locator('.board-host').boundingBox())!;

  // 1) Elegir rojo antes de dibujar.
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Línea"]').click();
  await setPaletteColor(page, '#c0392b', '.tools-caption');

  // 2) Previsualización roja DURANTE el gesto (antes de soltar).
  const a = normToScreen(0.25, 0.4, host); const b = normToScreen(0.75, 0.4, host);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 });
  await expect(page.locator('.board-canvas svg line[stroke="#c0392b"]'), 'previsualización roja').not.toHaveCount(0);
  await page.mouse.up();

  // 3) Creado en rojo y vuelve al cursor (Seleccionar activo).
  await expect(page.locator('.field-count')).toHaveText('1');
  expect(await lineStroke(page), 'la línea se crea en rojo').toBe('#c0392b');

  // 4/5) Seleccionar y cambiar a azul desde el inspector.
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.mouse.click(a[0], a[1], { button: 'right' });
  await expect(page.locator('.inspector')).toBeVisible();
  await setPaletteColor(page, '#1a73e8', '.studio-panel .inspector');
  // FASE G: observable — el trazo ya es azul (no una espera fija).
  await expect.poll(() => lineStroke(page), { timeout: 5000 }).toBe('#1a73e8');
  expect(await lineStroke(page), 'la línea pasa a azul').toBe('#1a73e8');

  // 6/7) Undo vuelve a rojo; redo vuelve a azul. (Fase 3: atajos Ctrl+Z / Ctrl+Y.)
  await page.keyboard.press('Control+z');
  // FASE G: observable — el undo se espera con expect.poll del trazo.
  await expect.poll(() => lineStroke(page), { timeout: 5000 }).toBe('#c0392b');
  expect(await lineStroke(page), 'undo recupera rojo').toBe('#c0392b');
  await page.keyboard.press('Control+y');
  // FASE G: observable — el redo se espera con expect.poll del trazo.
  await expect.poll(() => lineStroke(page), { timeout: 5000 }).toBe('#1a73e8');
  expect(await lineStroke(page), 'redo recupera azul').toBe('#1a73e8');

  // 8) Duplicar conserva azul (re-seleccionar la línea, ya que undo/redo limpió la selección).
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const mid = normToScreen(0.5, 0.4, host);
  // Fase 3: pulsación larga abre el menú contextual (selecciona la línea).
  await longPress(page, mid[0], mid[1]);
  await expect(page.locator('.context-bar')).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.field-count')).toHaveText('2');
  const strokes = await page.locator('.board-canvas svg [data-el-type="line"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-color')));
  expect(strokes, 'duplicado conserva azul').toEqual(['#1a73e8', '#1a73e8']);

  // 9) Guardar y reabrir conserva azul.
  await fillBoardTitle(page, 'Colores');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  expect(await lineStroke(page), 'tras reabrir la línea sigue azul').toBe('#1a73e8');

  // 10) Export PNG válido.
  const dlPromise = page.waitForEvent('download');
  await page.locator('[aria-label="Exportar"]').click();
  await page.locator('.rail-btn[title="Descargar PNG"]').click();
  const dl = await dlPromise;
  const bytes = fs.readFileSync((await dl.path())!);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');

  // 11) Respaldo conserva el color (volver a la Biblioteca primero).
  await page.locator('button[title="Volver"]').click();
  await page.waitForURL('**/library');
  await page.locator('button[aria-label="Ajustes"]').click();
  const dl2Promise = page.waitForEvent('download');
  await page.locator('.settings-row', { hasText: 'Exportar respaldo' }).locator('button', { hasText: 'Exportar' }).click();
  const dl2 = await dl2Promise;
  const parsed = JSON.parse(fs.readFileSync((await dl2.path())!, 'utf8'));
  const el = parsed.exercises[0].canvas.frames[0].elements.find((e: any) => e.t === 'line');
  expect(el.c, 'el respaldo conserva el color azul').toBe('#1a73e8');
});
