// =============================================================
// FASE H — Exportación PNG real.
//
// DEFECTO 8 corregido: se guarda y reabre antes de exportar; se comprueba
// el TÍTULO, el NOMBRE SUGERIDO de la descarga (saneado), las dimensiones
// del PNG, que contiene el contenido (campo + jugadores + material +
// dibujos) y que NO incluye paneles, barra, papelera, selección, asas ni
// menús contextuales.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { fillBoardTitle } from './gesture-helpers';
import { seedBoard, openBoard, hostBox, fitMode, fieldCount, normToScreen, showCategory } from './board-helpers';

const OUT = 'docs/screenshots/fase-h';
fs.mkdirSync(OUT, { recursive: true });

const TITLE = 'Rondo de posesión';

async function clickNorm(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page); const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
}
async function closePanel(page: Page): Promise<void> {
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
}
async function drawLine(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const host = await hostBox(page); const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], host, fit);
  const b = normToScreen(to[0], to[1], host, fit);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
}

test.describe('FASE H — exportación PNG con el título', () => {
  test('guarda, reabre y exporta: título saneado, dimensiones y sin controles', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    const host = await hostBox(page); const fit = await fitMode(page);

    // Contenido: 2 jugadores genéricos + 1 material + 1 línea + 1 rectángulo.
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await closePanel(page);
    await clickNorm(page, 0.3, 0.4);
    await clickNorm(page, 0.5, 0.4);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();

    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').click();
    await closePanel(page);
    await clickNorm(page, 0.7, 0.5);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();

    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Línea"]').click();
    await closePanel(page);
    await drawLine(page, [0.25, 0.7], [0.6, 0.7]);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Rectángulo"]').click();
    await closePanel(page);
    await drawLine(page, [0.15, 0.12], [0.35, 0.25]);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(5);

    // GUARDAR con el título real…
    await fillBoardTitle(page, TITLE);
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const savedTitle = await page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0].title);
    expect(savedTitle, 'el ejercicio guarda el título').toBe(TITLE);

    // …REABRIR y exportar desde el ejercicio guardado.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(5);
    // Título conservado al reabrir.
    await page.locator('button[aria-label="Propiedades"]').click();
    await expect(page.locator('.studio-panel input[aria-label="Título del ejercicio"]')).toHaveValue(TITLE);

    // Deseleccionar y exportar.
    await page.keyboard.press('Escape');
    const dl = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await expect(page.locator('.top-pop-export')).toBeVisible();
    await page.locator('.rail-btn[title="Descargar PNG"]').click();
    const download = await dl;

    // 2) El NOMBRE SUGERIDO contiene el título saneado.
    const suggested = download.suggestedFilename();
    console.log(`[fase-h export] nombre sugerido = "${suggested}"`);
    expect(suggested, 'extensión PNG').toMatch(/\.png$/i);
    expect(suggested.toLowerCase(), 'el nombre sugerido contiene el título saneado').toContain('rondo');
    expect(suggested, 'el nombre no lleva acentos/espacios crudos').not.toContain('ó');
    expect(suggested, 'sin espacios').not.toContain(' ');

    // 3) Dimensiones válidas del PNG (IHDR 1600×1280, campo horizontal).
    const buf = fs.readFileSync((await download.path())!);
    expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47');
    const w = buf.readUInt32BE(16); const h = buf.readUInt32BE(20);
    expect(w, 'ancho válido').toBe(1600);
    expect(h, 'alto válido').toBe(1280);
    fs.writeFileSync(`${OUT}/ejercicio-exportado.png`, buf);
    expect(fs.statSync(`${OUT}/ejercicio-exportado.png`).size, 'PNG con contenido').toBeGreaterThan(2000);

    // 4) El SVG fuente del PNG CONTIENE el contenido (campo + jugadores + material + línea + rect).
    const svg = await page.locator('.entrenolab-board').innerHTML();
    expect(svg, 'campo (césped) presente').toContain('entrenolab-grass');
    expect(svg, 'marcas del campo').toContain('stroke-width="0.3"');
    expect((svg.match(/data-el-type="player"/g) ?? []).length, '2 jugadores').toBe(2);
    expect((svg.match(/data-el-type="cone"/g) ?? []).length, '1 material').toBe(1);
    expect((svg.match(/data-el-type="line"/g) ?? []).length, '1 línea').toBe(1);
    expect((svg.match(/data-el-type="rect"/g) ?? []).length, '1 figura').toBe(1);

    // 5) NO incluye UI del editor (paneles, barra, papelera, selección, asas, menús).
    expect(svg, 'sin asas de selección').not.toContain('reshandle');
    expect(svg, 'sin menú contextual').not.toContain('context-bar');
    expect(svg, 'sin caja de edición de texto').not.toContain('text-edit-rect');
    // La papelera (fuera del SVG del tablero) no está activa y no forma parte del PNG.
    await expect(page.locator('.board-trash')).not.toHaveClass(/trash-visible/);
    expect(svg, 'la papelera no está en el SVG exportado').not.toContain('board-trash');
    expect(svg, 'la barra inferior no está en el SVG exportado').not.toContain('studio-tools');
    await expect(page.locator('.studio-tools')).toBeVisible(); // la barra está en la app, no en el PNG
  });
});
