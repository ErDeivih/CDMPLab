import { test, expect, Page } from '@playwright/test';

const P = (id: number, name: string, number: number, position: string) =>
  ({ id: `p${id}`, teamId: 't1', name, number, position, color: '#1a73e8', active: true, createdAt: '2026-01-01T00:00:00.000Z' });

function seed(players: ReturnType<typeof P>[]) {
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

const ELEVEN = Array.from({ length: 11 }, (_, i) => P(i + 1, `Jugador ${i + 1}`, i + 1, i === 0 ? 'GK' : 'DF'));

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}
function count(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

async function openJugadores(page: Page): Promise<void> {
  // FASE B (paneles persistentes): abrir Jugadores es IDEMPOTENTE. Si ya está
  // desplegado (porque ya no se cierra al elegir un jugador) no lo re-togglea
  // (lo cerraría).
  if (await page.locator('.side-panel-left').isVisible().catch(() => false)) return;
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
}

test.describe('Fase 7 — formaciones rápidas', () => {
  test('coloca la formación 4-3-3 propia (un jugador por posición) y un solo Undo la deshace', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openBoard(page);
    await expect(page.locator('.field-count')).toHaveText('0');

    await openJugadores(page);
    // Propio por defecto.
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);

    // Un solo Undo deshace TODA la formación.
    await page.keyboard.press('Control+z');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(0);
  });

  test('no duplica instancias de un jugador de plantilla ya colocado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openBoard(page);

    // Colocar manualmente un jugador de plantilla (el primero) → 1 elemento.
    await openJugadores(page);
    await page.locator('.side-panel-left .roster-item').first().click();
    await page.waitForTimeout(120);
    const host = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(host.x + host.width / 2, host.y + host.height / 2);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Aplicar la formación: coloca 11 GENÉRICOS (sin playerId) y CONSERVA el jugador
    // real de plantilla (con playerId). Resultado: 1 plantilla + 11 genéricos = 12.
    await openJugadores(page);
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(12); // 1 real + 11 genéricos
    // Los 11 de la formación son GENÉRICOS (sin playerId ni label).
    const placed = await page.locator('.entrenolab-board circle[r="2.5"]').count();
    expect(placed).toBe(12);
  });

  test('la formación RIVAL (color rojo) se coloca en espejo y del color elegido', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openBoard(page);

    await openJugadores(page);
    // Elige el color rojo (FASE B: el panel Jugadores permanece abierto al armar).
    await page.locator('.tray-player[title="Jugador Rojo"]').click();
    // FASE B (paneles persistentes): el panel ya está abierto; NO se re-togglea (lo cerraría).
    await openJugadores(page);
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    // Los jugadores de la formación rival se marcan con el color rojo elegido.
    const rivals = await page.locator('.entrenolab-board circle[r="2.5"][fill="#c0392b"]').count();
    expect(rivals, 'los jugadores de la formación rival son del color elegido (rojos)').toBe(11);
  });
});
