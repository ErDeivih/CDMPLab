// =============================================================
// FASE H — Galería de campos COMPLETA y conversiones de campo.
//
// DEFECTO 6 corregido: se exige la lista EXPLÍCITA de campos (9 tipos),
// se verifica cada tarjeta, se desplaza la galería, se abre cada tipo
// comprobando que el SVG cambia y se generan capturas de CADA campo para
// componer un contact sheet real (no una captura parcial del viewport).
// DEFECTO 7 corregido: conversiones de campo con elementos, undo/redo y
// guardar/reabrir.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { fillBoardTitle } from './gesture-helpers';
import { seedBoard, openBoard, hostBox, fitMode, fieldCount, normToScreen, showCategory } from './board-helpers';

const OUT = 'docs/screenshots/fase-h';
const CARDS = `${OUT}/_fieldcards`;
fs.mkdirSync(CARDS, { recursive: true });

/** Lista EXPLÍCITA de los campos base esperados (id → etiqueta de la tarjeta). */
const FIELDS: Array<[string, string]> = [
  ['full', 'Campo completo'],
  ['half', 'Medio campo'],
  ['vertical_half', 'Medio campo vertical'],
  ['third', 'Tercio de campo'],
  ['box', 'Área y portería'],
  ['futsal', 'Fútbol sala'],
  ['f7', 'F7 transversal'],
  ['two_halves', 'Dos medios campos'],
  ['blank', 'Lienzo'],
];

async function openProps(page: Page): Promise<void> {
  if (!(await page.locator('.studio-panel').isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Propiedades"]').click();
  }
  await expect(page.locator('.studio-panel')).toBeVisible();
}

async function clickNorm(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page); const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
}

/** Selecciona un campo por su tarjeta de la galería (interacción real). */
async function pickFieldCard(page: Page, label: string): Promise<void> {
  await openProps(page);
  const card = page.locator(`.field-gallery .field-card[aria-label="Campo ${label}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
}

test.describe('FASE H — galería de campos completa', () => {
  test('la galería ofrece EXACTAMENTE los campos esperados, cada uno con miniatura', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await openProps(page);
    const gallery = page.locator('.field-gallery');
    await expect(gallery).toBeVisible();
    // Exactamente 9 tarjetas (lista explícita, no ">=5").
    await expect(page.locator('.field-gallery .field-card')).toHaveCount(FIELDS.length);
    // Cada campo esperado tiene EXACTAMENTE una tarjeta, con miniatura SVG y nombre.
    for (const [id, label] of FIELDS) {
      const card = page.locator(`.field-gallery .field-card[aria-label="Campo ${label}"]`);
      await expect(card, `${id} presente una vez`).toHaveCount(1);
      await expect(card.locator('.field-card-thumb svg'), `${id} con miniatura SVG`).toHaveCount(1);
      await expect(card.locator('.field-card-name')).toHaveText(label);
    }
    // La galería es DESPLAZABLE horizontalmente (no cabe entera).
    const scrollable = await gallery.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrollable, 'la galería tiene desplazamiento horizontal').toBe(true);
  });

  test('abre cada campo: el SVG cambia y se captura cada uno (contact sheet real)', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    const svgs: Record<string, string> = {};
    for (const [id, label] of FIELDS) {
      await pickFieldCard(page, label);
      await expect(page.locator('.board-canvas svg')).toBeVisible();
      const html = await page.locator('.board-canvas svg').innerHTML();
      expect(html.length, `el campo ${id} renderiza un SVG`).toBeGreaterThan(50);
      svgs[id] = html;
      // Captura del CAMPO (board) de cada tipo para el contact sheet.
      await page.locator('.board-host').screenshot({ path: `${CARDS}/${id}.png` });
    }
    // `vertical_half` es un ALIAS documentado de `half` en el mismo renderizador
    // (field.ts: "el medio campo vertical es hoy un alias del 'half' orientado").
    expect(svgs['vertical_half'], 'vertical_half es alias documentado de half').toBe(svgs['half']);
    // Los 8 campos NO alias renderizan DISTINTO entre sí.
    const others = FIELDS.map(([id]) => id).filter((id) => id !== 'vertical_half');
    const distinct = new Set(others.map((id) => svgs[id]));
    expect(distinct.size, 'los campos no-alias renderizan distinto').toBe(others.length);
  });

  test('orientación horizontal/vertical cambia el SVG en el mismo campo', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await openProps(page);
    // En "Campo completo" la orientación SÍ aplica (rota el terreno).
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('full');
    await expect.poll(() => page.locator('.board-host').getAttribute('data-field')).toBe('full');
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]')).toHaveClass(/chip-active/);
    const h = await page.locator('.board-canvas svg').innerHTML();
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]')).toHaveClass(/chip-active/);
    const v = await page.locator('.board-canvas svg').innerHTML();
    expect(v, 'vertical y horizontal renderizan distinto').not.toBe(h);
  });
});

test.describe('FASE H — conversiones de campo con elementos', () => {
  test('full↔half y two_halves conservan los elementos; undo/redo y guardar/reabrir', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    const host = await hostBox(page); const fit = await fitMode(page);

    // Ejercicio con jugadores, material, línea y figura.
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    let close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    await page.mouse.click(...Object.values(normToScreen(0.35, 0.4, host, fit)) as [number, number]);
    await page.mouse.click(...Object.values(normToScreen(0.5, 0.5, host, fit)) as [number, number]);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').click();
    close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    await clickNorm(page, 0.6, 0.6);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Línea"]').click();
    close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    const a = normToScreen(0.3, 0.7, host, fit); const b = normToScreen(0.7, 0.7, host, fit);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Rectángulo"]').click();
    close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    const r1 = normToScreen(0.2, 0.15, host, fit); const r2 = normToScreen(0.4, 0.3, host, fit);
    await page.mouse.move(r1.x, r1.y); await page.mouse.down(); await page.mouse.move(r2.x, r2.y, { steps: 5 }); await page.mouse.up();
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(5);
    const total = 5;

    // helper: el campo activo y el nº de elementos.
    const fieldOf = () => page.locator('.board-host').getAttribute('data-field');

    // full → half (con elementos abre el diálogo → "Dos medios campos").
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('half');
    const dlg = page.locator('.field-change-dialog');
    await expect(dlg).toBeVisible();
    await dlg.getByText('Dos medios campos — recomendado').click();
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('two_halves');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Undo/redo de la conversión: restaura el campo COMPLETO previo y los elementos.
    await page.keyboard.press('Control+z');
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('full');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);
    await page.keyboard.press('Control+y');
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('two_halves');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Volver a "Campo completo" conserva los elementos.
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('full');
    if (await dlg.isVisible().catch(() => false)) await dlg.getByText('Encajar todo').first().click();
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('full');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Cambio de orientación conserva los elementos.
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]')).toHaveClass(/chip-active/);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Guardar y reabrir conserva campo, orientación y elementos.
    await fillBoardTitle(page, 'Conversiones');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const saved = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return { field: ex.canvas.field, orientation: ex.canvas.orientation, n: ex.canvas.frames[0].elements.length };
    });
    expect(saved.field).toBe('full');
    expect(saved.orientation).toBe('vertical');
    expect(saved.n).toBe(total);

    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('full');
    await openProps(page);
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]')).toHaveClass(/chip-active/);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);
  });
});
