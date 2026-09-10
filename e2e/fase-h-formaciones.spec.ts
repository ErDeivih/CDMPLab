// =============================================================
// FASE H — Formaciones realmente aplicadas.
//
// DEFECTO 2 corregido: se aplican formaciones DE VERDAD (no solo captura
// del panel) y se comprueba el modelo persistido: 11 genéricos sin
// nombre/dorsal/side/type/POR, y una segunda formación REFLEJADA con otro
// color (geometría espejada + dos colores).
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { fillBoardTitle } from './gesture-helpers';
import { seedBoard, openBoard, showCategory, fieldCount } from './board-helpers';

const OUT = 'docs/screenshots/fase-h';
fs.mkdirSync(OUT, { recursive: true });

type El = { t: string; c?: string; x?: number; y?: number; n?: number; side?: string; type?: string; label?: string; playerId?: string };

/** Guarda el ejercicio y devuelve los elementos persistidos de la pizarra. */
async function saveAndRead(page: Page, title: string): Promise<El[]> {
  await fillBoardTitle(page, title);
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas.frames[0].elements as El[];
  });
}

async function openBoardAgain(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
}

test.describe('FASE H — formaciones aplicadas de verdad', () => {
  test('4-3-3 sin plantilla → 11 genéricos sin nombre/dorsal/side/type/POR', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false }); // SIN plantilla
    await openBoard(page);
    await showCategory(page, 'Jugadores');

    // Color propio (azul, primer chip genérico) y formación 4-3-3.
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);

    // El render NO contiene "POR" ni nombres.
    const svg = await page.locator('.board-canvas svg').innerHTML();
    expect(svg, 'sin rol de portero en genéricos').not.toContain('POR');
    const circles = page.locator('.entrenolab-board circle[r="2.5"]');
    await expect(circles).toHaveCount(11);

    // Modelo persistido: 11 jugadores genéricos SIN nombre/dorsal/side/type/playerId.
    const els = await saveAndRead(page, 'Formacion 433');
    const players = els.filter((e) => e.t === 'player');
    expect(players.length, '11 genéricos de la formación').toBe(11);
    for (const p of players) {
      expect(p.label, 'genérico sin nombre').toBeFalsy();
      expect(p.playerId, 'genérico sin playerId').toBeFalsy();
      expect(p.side, 'genérico sin side').toBeFalsy();
      expect(p.type, 'genérico sin type (ni portero)').toBeFalsy();
      expect(p.n, 'genérico sin dorsal').toBeFalsy();
      expect(p.c, 'genérico con color').toBeTruthy();
    }
    // Todos del color elegido (propio = azul por defecto del chip).
    expect(new Set(players.map((p) => p.c)).size, 'un solo color').toBe(1);

    await openBoardAgain(page);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
  });

  test('segunda formación REFLEJADA y con otro color → geometría espejada y dos colores', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false });
    await openBoard(page);
    await showCategory(page, 'Jugadores');

    // Propia azul: 4-3-3.
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);

    // Rival rojo + Reflejar: 4-4-2.
    await page.locator('.tray-quick .tray-quick-chip').nth(1).click();
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(22);

    const els = await saveAndRead(page, 'Formaciones 433 442');
    const players = els.filter((e) => e.t === 'player');
    expect(players.length, '11 propias + 11 rivales').toBe(22);
    const colors = new Set(players.map((p) => p.c));
    expect(colors.size, 'dos colores (propio y rival)').toBe(2);
    const own = players.filter((p) => p.c === players[0].c);
    const rival = players.filter((p) => p.c !== players[0].c);
    expect(own.length).toBe(11);
    expect(rival.length).toBe(11);
    // Geometría REFLEJADA: el centroide en X del rival es ~1-x del propio.
    const cx = (arr: El[]) => arr.reduce((a, p) => a + (p.x ?? 0), 0) / arr.length;
    expect(Math.abs(cx(rival) - (1 - cx(own))), 'el rival está reflejado en X').toBeLessThan(0.05);
    // Ninguno tiene nombre/dorsal/POR.
    for (const p of players) {
      expect(p.label).toBeFalsy();
      expect(p.n).toBeFalsy();
      expect(p.type).toBeFalsy();
    }
  });

  test('captura escritorio-formaciones.png: panel Jugadores + campo con formaciones', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false });
    await openBoard(page);
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    await page.locator('.tray-quick .tray-quick-chip').nth(1).click();
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(22);
    // Captura de PÁGINA completa (panel + campo + barra), no solo el locator del panel.
    await page.screenshot({ path: `${OUT}/escritorio-formaciones.png` });
  });
});
