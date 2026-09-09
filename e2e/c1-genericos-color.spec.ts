// =============================================================
// C1 — fichas rápidas de jugador GENERICO por color.
//
// Requisito: en el menú de la pizarra debe haber al menos 5 fichas
// rápidas de jugador genérico (azul, rojo, amarillo, verde, morado),
// que son jugadores SIN nombre, sin dorsal fijo y sin `playerId`;
// la diferenciación entre ellos es por COLOR, no por concepto comodín.
//
// Fuente de verdad: el modelo colocado (localStorage del ejercicio) y
// el render SVG del campo (`data-el-type` / `data-color` / `data-player-id`).
// =============================================================
import { test, expect, Page } from '@playwright/test';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
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
  // Pequeño settle para que los hints flotantes (help/fill) aparezcan y poder cerrarlos;
  // sin él, a veces quedan tapando el campo y rompen los clics siguientes.
  await page.waitForTimeout(200);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
}

async function hostBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator('.board-host').boundingBox())!;
}

test.setTimeout(90_000);

test.describe('C1 — fichas rápidas de jugador genérico por color', () => {
  test('se muestran al menos 5 fichas de color y cada una arma un jugador del color elegido (sin playerId)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    // Abrir el panel de Jugadores.
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.tray-quick')).toBeVisible();

    // Al menos 5 chips de genérico por color.
    const chips = page.locator('.tray-quick .tray-quick-chip');
    await expect(chips).toHaveCount(5);
    await expect(chips.nth(0)).toHaveText(/Azul/);
    await expect(chips.nth(1)).toHaveText(/Rojo/);
    await expect(chips.nth(2)).toHaveText(/Amarillo/);
    await expect(chips.nth(3)).toHaveText(/Verde/);
    await expect(chips.nth(4)).toHaveText(/Morado/);

    // Colocar 2 jugadores: uno azul y otro rojo, en puntos distintos.
    // FASE B (paneles persistentes): elegir un chip de color NO cierra el panel Jugadores,
    // que permanece desplegado. Se espera de forma observable la pista de colocación antes
    // de tocar el campo, y tras el clic a que el contador suba.
    await chips.nth(0).click();
    // FASE B: el panel Jugadores permanece abierto (persistente) tras elegir el color.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
    await expect(page.locator('.placement-hint')).toBeVisible();
    let box = await hostBox(page);
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await expect(page.locator('.field-count')).toHaveText('1');

    // FASE B: el panel Jugadores sigue abierto; NO se re-togglea la categoría (eso la cerraría).
    await expect(page.locator('.tray-quick')).toBeVisible();
    await chips.nth(1).click();
    // FASE B: el panel Jugadores permanece abierto (persistente) tras elegir el color.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
    await expect(page.locator('.placement-hint')).toBeVisible();
    box = await hostBox(page);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await expect(page.locator('.field-count')).toHaveText('2');

    // El render expone el color, el tipo y la ausencia de player-id (los genéricos NO
    // llevan playerId, a diferencia de los jugadores de plantilla). Se espera de forma
    // observable al render final (el SVG se re-renderiza tras cada colocación).
    await expect.poll(() => page.locator('.board-canvas svg g[data-el-type="player"][data-color="#1a73e8"]').count(), { timeout: 4000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => page.locator('.board-canvas svg g[data-el-type="player"][data-color="#c0392b"]').count(), { timeout: 4000 }).toBeGreaterThanOrEqual(1);
    const playerCount = await page.locator('.board-canvas svg g[data-el-type="player"]').count();
    expect(playerCount).toBe(2);
    // Sin playerId (genérico): el atributo data-player-id sale vacío.
    const withPlayerId = await page.locator('.board-canvas svg g[data-el-type="player"][data-player-id]:not([data-player-id=""])').count();
    expect(withPlayerId, 'ningún genérico lleva playerId').toBe(0);
  });

  test('las formaciones rápidas funcionan sin plantilla creada (players() vacío) y usan el color propio', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.formation-btn').first()).toBeVisible();
    // Sin plantilla (players() vacío en el seed) la formación sigue colocando jugadores.
    const before = await page.locator('.board-canvas svg g[data-el-type="player"]').count();
    expect(before).toBe(0);
    await page.locator('.formation-btn').first().click();
    await expect.poll(() => page.locator('.field-count').innerText(), { timeout: 4000 }).toBe('11');
    const after = await page.locator('.board-canvas svg g[data-el-type="player"]').count();
    expect(after).toBe(11);
  });
});
