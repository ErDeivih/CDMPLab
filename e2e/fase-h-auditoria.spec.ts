// =============================================================
// FASE H — Recorrido principal (capturas demostrativas).
//
// Este spec es el RECORRIDO PRINCIPAL: crea un ejercicio completo y captura
// las imágenes de conjunto (escritorio y móvil). Las comprobaciones
// detalladas de cada requisito viven en los specs específicos:
//   fase-h-formaciones · fase-h-dibujos · fase-h-seleccion ·
//   fase-h-movil · fase-h-campos · fase-h-export.
// Comentarios = lo que realmente se ejecuta aquí.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { seedBoard, openBoard, hostBox, fitMode, fieldCount, normToScreen, showCategory } from './board-helpers';

const OUT = 'docs/screenshots/fase-h';
fs.mkdirSync(OUT, { recursive: true });

async function closePanel(page: Page): Promise<void> {
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
}
async function clickNorm(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page); const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
}
async function dragNorm(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const host = await hostBox(page); const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], host, fit);
  const b = normToScreen(to[0], to[1], host, fit);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
}
/** Dibuja una herramienta de Dibujo y vuelve a Cursor. */
async function drawWith(page: Page, title: string, from: [number, number], to: [number, number]): Promise<void> {
  await showCategory(page, 'Dibujo');
  await page.locator(`.rail-btn[title="${title}"]`).click();
  await closePanel(page);
  await dragNorm(page, from, to);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
}

test.describe('FASE H — recorrido principal y capturas de conjunto', () => {
  test('escritorio: ejercicio completo (jugadores + materiales + dibujos) → capturas', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);

    // Jugadores de 5 colores (fichas rápidas).
    await showCategory(page, 'Jugadores');
    const chips = page.locator('.tray-quick .tray-quick-chip');
    await expect(chips).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await chips.nth(i).click();
      await clickNorm(page, 0.12 + i * 0.14, 0.18);
    }
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();

    // Materiales (varios).
    for (const [title, x, y] of [['Cono', 0.25, 0.45], ['Balón', 0.45, 0.45], ['Miniportería', 0.65, 0.45], ['Escalera', 0.85, 0.45], ['Mancuerna / pesa', 0.35, 0.6]] as Array<[string, number, number]>) {
      await showCategory(page, 'Material');
      await page.locator(`.rail-btn[title="${title}"]`).click();
      await closePanel(page);
      await clickNorm(page, x, y);
      await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    }

    // Dibujos: línea, flecha, curva, zigzag, rect, elipse.
    await drawWith(page, 'Línea', [0.15, 0.75], [0.4, 0.75]);
    await drawWith(page, 'Flecha (movimiento)', [0.45, 0.75], [0.7, 0.75]);
    await drawWith(page, 'Curva derecha', [0.15, 0.88], [0.4, 0.95]);
    await drawWith(page, 'Conducción (zigzag)', [0.45, 0.88], [0.7, 0.95]);
    await drawWith(page, 'Rectángulo', [0.75, 0.6], [0.92, 0.78]);
    await drawWith(page, 'Círculo / elipse', [0.75, 0.82], [0.9, 0.95]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(16);

    // Escritorio-completo: PÁGINA completa (campo + barra), paneles cerrados.
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${OUT}/escritorio-completo.png` });

    // Escritorio-materiales: campo con materiales + PANEL de Material abierto.
    await showCategory(page, 'Material');
    await page.screenshot({ path: `${OUT}/escritorio-materiales.png` });
  });

  test('móvil horizontal: panel + campo + barra (Jugadores/Material/Dibujo) → capturas', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await seedBoard(page); await openBoard(page);
    expect(await fitMode(page), 'móvil arranca en Llenar pantalla').toBe('height');

    // Un jugador y un material ya colocados para que el campo no esté vacío.
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await closePanel(page);
    await clickNorm(page, 0.35, 0.45);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').click();
    await closePanel(page);
    await clickNorm(page, 0.6, 0.5);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);

    // movil-horizontal-jugadores: campo + barra + panel (PÁGINA).
    await showCategory(page, 'Jugadores');
    await page.screenshot({ path: `${OUT}/movil-horizontal-jugadores.png` });
    await closePanel(page);

    // movil-horizontal-material: panel + zona de drop (PÁGINA).
    await showCategory(page, 'Material');
    await page.screenshot({ path: `${OUT}/movil-horizontal-material.png` });
    await closePanel(page);

    // movil-horizontal-dibujo: panel + campo visible (PÁGINA).
    await showCategory(page, 'Dibujo');
    await page.screenshot({ path: `${OUT}/movil-horizontal-dibujo.png` });
  });

  test('paneles Jugadores/Material/Dibujo: abrir, cerrar y reabrir; barra visible y último elemento accesible', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    const itemsFor = (cat: string) =>
      cat === 'Jugadores' ? page.locator('.tray-quick .tray-quick-chip')
        : cat === 'Material' ? page.locator('.tools-material-card')
          : page.locator('.tools-panel-list .rail-btn');
    for (const cat of ['Jugadores', 'Material', 'Dibujo']) {
      // ABRIR.
      await showCategory(page, cat);
      await expect(page.locator('.side-panel-left')).toBeVisible();
      // La BARRA INFERIOR sigue visible (no queda tapada por el panel).
      await expect(page.locator('.studio-tools'), `la barra sigue visible con ${cat}`).toBeVisible();
      // El ÚLTIMO elemento del panel es accesible (se trae a la vista si desborda).
      const items = itemsFor(cat);
      expect(await items.count(), `el panel ${cat} tiene elementos`).toBeGreaterThan(0);
      await items.last().scrollIntoViewIfNeeded();
      await expect(items.last(), `último elemento de ${cat} accesible`).toBeVisible();
      // CERRAR (minimizar).
      await page.locator('.side-panel-left .panel-close').first().click();
      await expect(page.locator('.side-panel-left')).toHaveCount(0);
      // REABRIR.
      await showCategory(page, cat);
      await expect(page.locator('.side-panel-left'), `reabrir ${cat}`).toBeVisible();
      await page.locator('.side-panel-left .panel-close').first().click();
    }
  });

  test('material recoloreable (Chino): cambiar su color se refleja en el campo', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    // Colocar un Chino.
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Chino"]').click();
    await closePanel(page);
    await clickNorm(page, 0.5, 0.5);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    const chino = page.locator('.board-canvas svg g[data-el-type="target"]');
    await expect(chino).toHaveCount(1);
    const before = await chino.getAttribute('data-color');
    // Seleccionarlo y cambiar el color desde el inspector.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await clickNorm(page, 0.5, 0.5);
    await expect(page.locator('.studio-panel .inspector')).toBeVisible();
    const swatches = page.locator('.studio-panel .inspector .field', { hasText: 'Color' }).locator('.swatch');
    expect(await swatches.count(), 'el material recoloreable ofrece paleta de color').toBeGreaterThan(1);
    await swatches.nth(2).click();
    await expect.poll(() => chino.getAttribute('data-color'), { timeout: 4000 }).not.toBe(before);
  });
});
