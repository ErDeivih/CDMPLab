import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import { toggleFillScreen } from './gesture-helpers';

// FASE 1 — color independiente por herramienta + pulsación larga para abrir la paleta.
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
    // FASE G: el letterbox se espera con la ausencia de board-fill (sin wait fijo).
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}
async function armTool(page: Page, title: string): Promise<void> {
  // FASE B (paneles persistentes): elegir una herramienta de Dibujo ya NO cierra el
  // panel. Abrir la categoría es IDEMPOTENTE: si el panel sigue desplegado no se
  // re-togglea con .tools-cat Dibujo (eso ahora lo cerraría y el .rail-btn siguiente
  // ya no sería visible). En el test 1 se arma dos veces seguidas (Línea→Flecha).
  const panel = page.locator('.side-panel-left.tools-panel-side');
  if (!(await panel.isVisible().catch(() => false))) {
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
}
async function pickPaletteColor(page: Page, hex: string): Promise<void> {
  const index = ['#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111', '#f4f4f4'].indexOf(hex);
  await page.locator('.tools-caption .swatch').nth(index).click();
}
async function drawLine(page: Page, host: Box, from: [number, number], to: [number, number]): Promise<void> {
  const a = normToScreen(from[0], from[1], host);
  const b = normToScreen(to[0], to[1], host);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 }); await page.mouse.up();
}

test('colores independientes por herramienta: Línea roja y Flecha azul coexisten', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const host = (await page.locator('.board-host').boundingBox())!;

  // Línea en ROJO.
  await armTool(page, 'Línea');
  await pickPaletteColor(page, '#c0392b');
  await drawLine(page, host, [0.15, 0.3], [0.5, 0.3]);

  // Flecha en AZUL (NO cambia el color de Línea).
  await armTool(page, 'Flecha (movimiento)');
  await pickPaletteColor(page, '#1a73e8');
  await drawLine(page, host, [0.15, 0.6], [0.5, 0.6]);

  const line = await page.locator('.board-canvas svg [data-el-type="line"]').getAttribute('data-color');
  const arrow = await page.locator('.board-canvas svg [data-el-type="arrow"]').getAttribute('data-color');
  expect(line, 'la línea conserva rojo').toBe('#c0392b');
  expect(arrow, 'la flecha es azul (independiente de Línea)').toBe('#1a73e8');
});

test('pulsación larga abre la paleta de color de la herramienta (sin crear objeto)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const before = await page.locator('.board-canvas svg [data-el-type]').count();

  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  const btn = page.locator('.side-panel-left .rail-btn[title="Línea"]');
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600); // >500ms → long-press
  // Se abre la paleta de color (popover), sin crear ningún objeto.
  await expect(page.locator('.bar-variant-pop', { hasText: 'Color de Línea' })).toBeVisible();
  await expect(page.locator('.board-canvas svg [data-el-type]')).toHaveCount(before);
  // Elegir verde → cierra la paleta y deja la herramienta armada (Línea activa).
  // (Se usa mouse.click sobre la coordenada porque el swatch tiene una transición
  //  CSS que hace que Playwright lo considere "inestable".)
  const sw = (await page.locator('.bar-variant-pop .swatch').nth(2).boundingBox())!;
  await page.mouse.click(sw.x + sw.width / 2, sw.y + sw.height / 2);
  await page.mouse.up(); // soltar el botón original (el clic posterior se suprime)
  // La pulsación larga NO crea ningún objeto (aunque la herramienta quede armada).
  await expect(page.locator('.field-count')).toHaveText('0');
});

test('la memoria de color por herramienta persiste entre sesiones', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  await armTool(page, 'Línea');
  await pickPaletteColor(page, '#7d3c98'); // morado
  // Recargar (nueva sesión): la preferencia local por herramienta se conserva.
  await page.reload();
  await page.locator('.board-host').waitFor({ state: 'visible' });
  // FASE G: el armado espera a que el .rail-btn sea accionable (auto-wait); sin wait fijo.
  await armTool(page, 'Línea');
  await pickPaletteColor(page, '#c0392b');
  // (El primer armado + paleta ya usó el color recordado de Línea.)
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const host = (await page.locator('.board-host').boundingBox())!;
  const a = normToScreen(0.3, 0.5, host); const b = normToScreen(0.7, 0.5, host);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 }); await page.mouse.up();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cdmplab:tool-colors:v1') ?? '{}'));
  expect(stored['line'], 'Línea recuerda su color').toBe('#c0392b');
  // BLOQUE E: la clave legacy se migra y deja de usarse (no vuelve a escribirse).
  const legacy = await page.evaluate(() => localStorage.getItem('entrenolab:tool-colors'));
  expect(legacy).toBeNull();
});
