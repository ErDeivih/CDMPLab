import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';
import { fillBoardTitle, toggleFillScreen } from './gesture-helpers';

// FASE 0 — los objetos colocados NO muestran su nombre automáticamente.
// El modelo (SVG) debe tener exactamente los objetos colocados, sin elementos
// `text` extra, sin nombres de materiales en el render, y guardar/reabrir no
// introduce etiquetas.
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
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'pl1', teamId: 't1', name: 'Marcos', number: 9, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
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
    // FASE G: el letterbox se espera con la ausencia de board-fill.
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}
async function placeMaterial(page: Page, host: Box, title: string, nx: number, ny: number): Promise<void> {
  // FASE B (paneles persistentes): abrir la categoría Material es IDEMPOTENTE. Si el panel
  // ya está desplegado (ya no se cierra al elegir un material) no lo re-togglea, porque
  // re-clickear el mismo .tools-cat lo cerraría y rompería la siguiente colocación.
  if (!(await page.locator('.side-panel-left.tools-panel-side').isVisible().catch(() => false))) {
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
  }
  const input = page.locator('.tools-search-input');
  await input.fill(''); await input.fill(title);
  // FASE G: el rail-btn filtrado por búsqueda se espera en el click siguiente (auto-wait).
  await page.locator(`.rail-btn[title="${title}"]`).click();
  const p = normToScreen(nx, ny, host);
  await page.mouse.click(p[0], p[1]);
}
async function svgTextsNoNames(page: Page, names: string[]): Promise<string[]> {
  return page.evaluate((names) => {
    const out: string[] = [];
    for (const t of document.querySelectorAll('.board-canvas svg text')) {
      const content = t.textContent ?? '';
      if (names.some((n) => content.includes(n))) out.push(content);
    }
    return out;
  }, names);
}

test('colocar materiales y una línea: modelo 1:1, sin textos, sin nombres en el render', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const host = (await page.locator('.board-host').boundingBox())!;
  const mats = ['Cono', 'Balón', 'Maniquí individual', 'Aro', 'Valla', 'BOSU'];
  for (let i = 0; i < mats.length; i++) await placeMaterial(page, host, mats[i], 0.2 + 0.14 * i, 0.35);
  await page.keyboard.press('Escape'); // cerrar panel Propiedades
  // FASE G: observable — el panel de Propiedades se cierra.
  await expect(page.locator('.studio-panel')).toHaveCount(0);
  // Una línea.
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Línea"]').click();
  const a = normToScreen(0.3, 0.6, host); const b = normToScreen(0.7, 0.6, host);
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('Escape');
  // FASE G: observable — el panel de Propiedades se cierra.
  await expect(page.locator('.studio-panel')).toHaveCount(0);

  const total = await page.locator('.board-canvas svg [data-el-type]').count();
  const textEls = await page.locator('.board-canvas svg [data-el-type="text"]').count();
  expect(total, 'modelo = objetos colocados (6 materiales + 1 línea)').toBe(7);
  expect(textEls, 'sin elementos text automáticos').toBe(0);
  // El render no contiene el nombre de ningún material como texto.
  const names = await svgTextsNoNames(page, ['Cono', 'Balón', 'Maniquí individual', 'Aro', 'Valla', 'BOSU']);
  expect(names, 'sin nombres de materiales en el render').toEqual([]);

  // Guardar y reabrir: no introduce etiquetas.
  await fillBoardTitle(page, 'SinNombres');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await expect(page.locator('.board-host')).toBeVisible();
  // FASE G: observable — esperamos a que el modelo reabierto tenga los 7 objetos.
  await expect.poll(() => page.locator('.board-canvas svg [data-el-type]').count(), { timeout: 5000 }).toBe(7);
  const total2 = await page.locator('.board-canvas svg [data-el-type]').count();
  const textEls2 = await page.locator('.board-canvas svg [data-el-type="text"]').count();
  expect(total2, 'tras reabrir el modelo sigue siendo 7').toBe(7);
  expect(textEls2, 'tras reabrir no hay textos automáticos').toBe(0);
  const names2 = await svgTextsNoNames(page, ['Cono', 'Balón', 'Maniquí individual', 'Aro', 'Valla', 'BOSU']);
  expect(names2, 'tras reabrir no hay nombres de materiales').toEqual([]);
});

test('export PNG: no contiene nombres automáticos de materiales ni controles', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page);
  await openBoard(page);
  const host = (await page.locator('.board-host').boundingBox())!;
  await placeMaterial(page, host, 'Cono', 0.5, 0.5);
  await page.keyboard.press('Escape');
  // FASE G: observable — el panel de Propiedades se cierra.
  await expect(page.locator('.studio-panel')).toHaveCount(0);
  const dlPromise = page.waitForEvent('download');
  await page.locator('[aria-label="Exportar"]').click();
  await page.locator('.rail-btn[title="Descargar PNG"]').click();
  const dl = await dlPromise;
  const bytes = fs.readFileSync((await dl.path())!);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
  // El SVG de la pizarra (fuente del PNG) no contiene el nombre del material.
  const html = await page.locator('.board-canvas svg').innerHTML();
  expect(html).not.toContain('>Cono</text>');
  expect(html).not.toContain('>Cono<');
});
