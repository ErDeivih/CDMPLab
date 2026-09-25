import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import { fillBoardTitle, toggleFillScreen } from './gesture-helpers';

// FASE 2 — perímetro, relleno y opacidad INDEPENDIENTES en rect/elipse/zona.
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
    await toggleFillScreen(page);
    // FASE G: condición observable — el letterbox se espera con la ausencia de board-fill.
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}
const PALETTE = ['#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111', '#f4f4f4'];
// El caption tiene DOS contenedores de swatches: 0 = color del perímetro, 1 = color del relleno.
async function captionSwatch(page: Page, containerIndex: number, hex: string): Promise<void> {
  await page.locator('.tools-caption .swatches').nth(containerIndex).locator('.swatch').nth(PALETTE.indexOf(hex)).click();
}
async function drawShape(page: Page, host: Box, from: [number, number], to: [number, number]): Promise<void> {
  const a = normToScreen(from[0], from[1], host);
  const b = normToScreen(to[0], to[1], host);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 }); await page.mouse.up();
}
async function rectData(page: Page): Promise<{ fill: string; fillColor: string | null; fillOpacity: string | null }> {
  const el = page.locator('.board-canvas svg [data-el-type="rect"]');
  return {
    fill: (await el.locator('rect').getAttribute('fill')) ?? '',
    fillColor: await el.getAttribute('data-fill-color'),
    fillOpacity: await el.getAttribute('data-fill-opacity'),
  };
}

test('FASE 10: rectángulo con perímetro rojo y relleno rojo al 50% (el relleno usa el color del perímetro)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const host = (await page.locator('.board-host').boundingBox())!;

  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Rectángulo"]').click();
  // Perímetro ROJO (contenedor 0).
  await captionSwatch(page, 0, '#c0392b');
  // Relleno = mismo color que el perímetro; solo se elige opacidad 50%.
  await page.locator('.tools-caption .chip', { hasText: 'Relleno' }).click();
  // El antiguo chip de porcentajes se sustituyó por un deslizador continuo.
  await page.locator('#tool-fill-opacity').evaluate((el: HTMLInputElement) => {
    el.value = '0.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await drawShape(page, host, [0.2, 0.3], [0.6, 0.6]);

  const d = await rectData(page);
  expect(d.fillColor, 'color de relleno = color del perímetro (rojo)').toBe('#c0392b');
  expect(d.fillOpacity, 'opacidad de relleno 50%').toBe('0.5');
  const svg = await page.locator('.board-canvas svg [data-el-type="rect"]').innerHTML();
  expect(svg, 'perímetro rojo').toContain('stroke="#c0392b"');
  expect(svg, 'relleno rojo translúcido').toContain('rgba(192,57,43,');
});

test('solo perímetro: fill:false no rellena', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const host = (await page.locator('.board-host').boundingBox())!;
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Rectángulo"]').click();
  await page.locator('.tools-caption .chip', { hasText: 'Perímetro' }).click();
  await drawShape(page, host, [0.2, 0.3], [0.5, 0.5]);
  const svg = await page.locator('.board-canvas svg [data-el-type="rect"]').innerHTML();
  expect(svg, 'sin relleno').toContain('fill="none"');
});

test('FASE 10: guardar/reabrir y respaldo conservan relleno, color y opacidad (vía inspector)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const host = (await page.locator('.board-host').boundingBox())!;
  // Rectángulo con relleno (shapeFill por defecto true). Fase 8: la herramienta "Zona"
  // fue retirada; Fase 10: el relleno usa el mismo color que el perímetro.
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Rectángulo"]').click();
  await drawShape(page, host, [0.2, 0.3], [0.6, 0.6]);
  await expect(page.locator('.field-count')).toHaveText('1');
  // Seleccionar y, desde el inspector, fijar color PERÍMETRO verde + opacidad 20%
  // (Fase 10: el relleno usa el mismo color que el perímetro).
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const c = normToScreen(0.4, 0.45, host);
  await page.mouse.click(c[0], c[1]);
  await expect(page.locator('.inspector')).toBeVisible();
  // La barra de dibujo y el inspector comparten paleta; cambiar solo el objeto seleccionado.
  await page.locator('.studio-panel .inspector .swatch[aria-label="Color verde"]').click();
  await page.locator('#selected-fill-opacity').evaluate((el: HTMLInputElement) => {
    el.value = '0.2';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(120);
  await fillBoardTitle(page, 'Relleno');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
  const rect = ex.canvas.frames[0].elements.find((e: any) => e.t === 'rect');
  expect(rect.fillColor, 'relleno = color del perímetro').toBe('#1f7a4d');
  expect(rect.fillOpacity).toBeCloseTo(0.2, 5);
});
