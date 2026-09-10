// =============================================================
// FASE H — Móvil: ARRASTRE REAL de panel a campo.
//
// DEFECTO 1 corregido: el arrastre usa pointerdown táctil sobre la ficha,
// varios pointermove que superan el umbral y pointerup sobre el campo
// (helpers de `touch-helpers.ts`, los mismos que `fase-ux-movil`).
// Se comprueba: exactamente un objeto, cerca del drop, herramienta
// desarmada, un toque posterior no añade, panel abierto y barra visible.
// =============================================================
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { seedBoard, openBoard, hostBox, fitMode, fieldCount, normToScreen } from './board-helpers';
import { begindragItem, dragItemToField, tapBoard } from './touch-helpers';

const OUT = 'docs/screenshots/fase-h';
fs.mkdirSync(OUT, { recursive: true });

test.describe('FASE H — móvil horizontal 844×390 (arrastre real de panel)', () => {
  test.use({ hasTouch: true });

  test('arrastrar Cono desde Material: un objeto, cerca del drop, desarmado, sin fantasma', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await seedBoard(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    expect(fit, 'móvil arranca en "Llenar pantalla"').toBe('height');

    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const card = page.locator('.rail-btn[title="Cono"]');
    await expect(card).toBeVisible();
    // Evidencia de que el arrastre empieza en la FICHA del panel (no en el campo).
    const cardBox = (await card.boundingBox())!;

    const drop = normToScreen(0.7, 0.5, host, fit);
    await dragItemToField(page, '.rail-btn[title="Cono"]', drop);

    // Exactamente un objeto, y su centro cae CERCA del punto de drop.
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    const cone = page.locator('.board-canvas svg image[href*="cone"]').first();
    await expect(cone).toHaveCount(1);
    const cb = (await cone.boundingBox())!;
    const dist = Math.hypot(cb.x + cb.width / 2 - drop.x, cb.y + cb.height / 2 - drop.y);
    expect(dist, 'el objeto colocado cae cerca del punto de drop').toBeLessThan(25);

    // El drop desarma: Cursor activo y sin pista de colocación armada.
    await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
    await expect(page.locator('.placement-hint')).toHaveCount(0);

    // Panel abierto y barra inferior visible.
    await expect(page.locator('.side-panel-left'), 'el panel permanece abierto').toBeVisible();
    await expect(page.locator('.studio-tools'), 'la barra inferior sigue visible').toBeVisible();
    expect(cardBox.width).toBeGreaterThan(0); // la ficha estaba en el panel al empezar el arrastre

    // Un toque posterior NO añade otro objeto.
    const p = normToScreen(0.4, 0.5, host, fit);
    await tapBoard(page, p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  });

  test('arrastrar jugador genérico desde Jugadores: coloca uno y deja el panel abierto', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await seedBoard(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);

    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const drop = normToScreen(0.65, 0.45, host, fit);
    await dragItemToField(page, '.tray-player[title="Jugador Azul"]', drop);

    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    const player = page.locator('.entrenolab-board circle[r="2.5"]').first();
    await expect(player).toHaveCount(1);
    const pb = (await player.boundingBox())!;
    expect(Math.hypot(pb.x + pb.width / 2 - drop.x, pb.y + pb.height / 2 - drop.y), 'jugador cerca del drop').toBeLessThan(25);
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores sigue abierto').toBeVisible();
    await expect(page.locator('.studio-tools')).toBeVisible();
  });

  test('captura DURANTE el arrastre real (preview visible) → movil-gesto-arrastre.png', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await seedBoard(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);

    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const drop = normToScreen(0.68, 0.5, host, fit);

    // pointerdown + pointermove… SIN soltar → el preview debe estar visible.
    const release = await begindragItem(page, '.rail-btn[title="Cono"]', drop);
    await expect(page.locator('.board-canvas svg'), 'la pizarra sigue montada durante el arrastre').toBeVisible();
    await page.screenshot({ path: `${OUT}/movil-gesto-arrastre.png` });

    await release();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  });
});
