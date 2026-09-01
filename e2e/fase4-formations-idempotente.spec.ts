import { test, expect, Page } from '@playwright/test';

type PlayerSeed = { id: string; number: number; position: string; name: string };

const ELEVEN = Array.from({ length: 11 }, (_, i) => ({
  id: `p${i + 1}`, teamId: 't1', name: `Jugador ${i + 1}`, number: i + 1,
  // Portero en la ÚLTIMA posición para comprobar que se prioriza a la portería.
  position: i === 10 ? 'GK' : 'DF', color: '#1a73e8', active: true, createdAt: '2026-01-01T00:00:00.000Z',
}));

function seed(players = ELEVEN) {
  return `(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify(${JSON.stringify(players)}));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  })()`;
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}
function count(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}
async function canvas(page: Page): Promise<CanvasDocument> {
  // Guardar para persistir el modelo y poder leerlo desde localStorage.
  await page.locator('.chip-icon-primary').first().click().catch(() => void 0);
  await page.waitForTimeout(250);
  const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!);
  return ex[0].canvas;
}
async function applyForm(page: Page, side: 'own' | 'rival', f: string): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await page.locator('.side-panel-left').first().waitFor();
  if (side === 'rival') await page.locator('.seg-btn', { hasText: 'Rival' }).click();
  await page.locator(`.formation-btn`, { hasText: f }).click();
  await page.waitForTimeout(120);
  await page.locator('.side-panel-left .panel-close').first().click().catch(() => void 0);
  await page.waitForTimeout(80);
}

test.describe('Fase 4 — formaciones correctas e idempotentes', () => {
  test('el portero real (aunque esté al final de la plantilla) va a la portería', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    await applyForm(page, 'own', '4-3-3');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    const doc = await canvas(page);
    const players = doc.frames[0].elements.filter((e) => e.t === 'player');
    // El GK (playerId p11) debe estar en la posición de portero (la más baja, x menor).
    const gk = players.find((e) => e.playerId === 'p11');
    expect(gk, 'el portero está colocado').toBeTruthy();
    const minX = Math.min(...players.map((e) => e.x ?? 1));
    expect(gk!.x, 'el portero en la portería (x menor)').toBeCloseTo(minX, 5);
    expect(gk!.type, 'el portero con type goalkeeper').toBe('goalkeeper');
  });

  test('aplicar la MISMA formación dos veces es idempotente (sigue habiendo 11, no 22)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    await applyForm(page, 'own', '4-3-3');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    await applyForm(page, 'own', '4-3-3');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    const doc = await canvas(page);
    const players = doc.frames[0].elements.filter((e) => e.t === 'player');
    expect(players.length, 'no se duplican al aplicar dos veces').toBe(11);
    const ids = new Set(players.map((e) => e.id));
    expect(ids.size, 'instancias únicas').toBe(11);
  });

  test('reutiliza jugadores ya colocados (los recoloca, no duplica) y un solo Undo deshace', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    // Colocar manualmente al jugador p3 (DF).
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left').first().waitFor();
    await page.locator('.side-panel-left .roster-item').first().click(); // p1 (primer roster visible)
    await page.waitForTimeout(100);
    const host = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(host.x + host.width / 2, host.y + host.height / 2);
    await expect(page.locator('.field-count')).toHaveText('1');

    await applyForm(page, 'own', '4-3-3');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);

    // Un solo Undo deshace la formación completa (vuelve a la colocación manual de 1);
    // Rehacer vuelve a aplicarla (transacción atómica).
    await page.keyboard.press('Control+z');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(1);
    await page.keyboard.press('Control+y');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);

    // Guardar + leer el modelo: reutiliza la instancia colocada (no duplica).
    const doc = await canvas(page);
    const players = doc.frames[0].elements.filter((e) => e.t === 'player');
    const ids = new Set(players.map((e) => e.id));
    expect(ids.size, 'reutiliza la instancia colocada (no duplica)').toBe(11);
  });

  test('aplicar dos veces la formación RIVAL no supera 11 rivales', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    await applyForm(page, 'rival', '4-4-2');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    await applyForm(page, 'rival', '4-4-2');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    const doc = await canvas(page);
    const rivals = doc.frames[0].elements.filter((e) => e.t === 'player' && e.side === 'rival');
    expect(rivals.length, 'máximo 11 rivales').toBe(11);
  });
});
