import { test, expect, Page } from '@playwright/test';
import { fillBoardTitle } from './gesture-helpers';

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
  await fillBoardTitle(page, 'Formaciones');
  await page.locator('.chip-icon-primary').first().click().catch(() => void 0);
  await page.waitForTimeout(250);
  const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!);
  return ex[0].canvas;
}
async function applyForm(page: Page, mirror: boolean, f: string): Promise<void> {
  // FASE B (paneles persistentes): abrir Jugadores es IDEMPOTENTE — si ya está
  // desplegado (porque ya no se cierra al armar un color) no se re-togglea (lo cerraría).
  if (!(await page.locator('.side-panel-left').isVisible().catch(() => false))) {
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  }
  await page.locator('.side-panel-left').first().waitFor();
  // Elige el color del equipo (propio=azul, rival=rojo): el panel permanece abierto.
  await page.locator(`.tray-player[title="Jugador ${mirror ? 'Rojo' : 'Azul'}"]`).click();
  await page.locator('.side-panel-left').first().waitFor();
  const mirrorBox = page.locator('.formation-mirror input');
  if (mirror) await mirrorBox.check();
  else await mirrorBox.uncheck();
  await page.locator(`.formation-btn`, { hasText: f }).click();
  await page.waitForTimeout(120);
  await page.locator('.side-panel-left .panel-close').first().click().catch(() => void 0);
  await page.waitForTimeout(80);
}

test.describe('Fase 4 — formaciones correctas e idempotentes', () => {
  test('la formación coloca 11 CÍRCULOS genéricos del color elegido, sin rol de portero', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    await applyForm(page, false, '4-3-3');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    const doc = await canvas(page);
    const players = doc.frames[0].elements.filter((e) => e.t === 'player');
    // Los 11 de la formación son GENÉRICOS (sin playerId ni nombre).
    expect(players.every((e) => !e.playerId), 'ningún genérico tiene playerId').toBe(true);
    expect(players.every((e) => !e.label), 'ningún genérico tiene nombre').toBe(true);
    // Ningún círculo lleva rol especial (ni "POR"): portero de la formación = círculo normal.
    expect(players.every((e) => e.type !== 'goalkeeper'), 'sin portero especial').toBe(true);
    // Todos del color elegido (azul #1a73e8).
    expect(players.every((e) => e.c === '#1a73e8'), 'todos del color elegido').toBe(true);
  });

  test('aplicar la MISMA formación dos veces es idempotente (sigue habiendo 11, no 22)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    await applyForm(page, false, '4-3-3');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    await applyForm(page, false, '4-3-3');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    const doc = await canvas(page);
    const players = doc.frames[0].elements.filter((e) => e.t === 'player');
    expect(players.length, 'no se duplican al aplicar dos veces').toBe(11);
    const ids = new Set(players.map((e) => e.id));
    expect(ids.size, 'instancias únicas').toBe(11);
  });

  test('la formación es una transacción: reutiliza genéricos y conserva el de plantilla (un solo Undo)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    // Colocar manualmente al jugador p1 (plantilla, con playerId).
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left').first().waitFor();
    await page.locator('.side-panel-left .roster-item').first().click(); // p1 (primer roster visible)
    await page.waitForTimeout(100);
    const host = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(host.x + host.width / 2, host.y + host.height / 2);
    await expect(page.locator('.field-count')).toHaveText('1');

    await applyForm(page, false, '4-3-3');
    // 1 real de plantilla (conservado) + 11 genéricos de la formación = 12.
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(12);

    // Un único Undo deshace la formación completa (vuelve a la colocación manual de 1);
    // Rehacer vuelve a aplicarla (transacción atómica). Conserva el de plantilla.
    await page.keyboard.press('Control+z');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(1);
    await page.keyboard.press('Control+y');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(12);

    // Guardar + leer el modelo: el jugador de plantilla p1 sigue presente y los 11
    // genéricos NO llevan playerId (no son duplicados de la plantilla).
    const doc = await canvas(page);
    const players = doc.frames[0].elements.filter((e) => e.t === 'player');
    expect(players.length).toBe(12);
    const real = players.filter((e) => e.playerId);
    expect(real.length, 'el jugador de plantilla se conserva (1)').toBe(1);
    const generics = players.filter((e) => !e.playerId);
    expect(generics.length, '11 genéricos de la formación').toBe(11);
  });

  test('aplicar dos veces la formación RIVAL no supera 11 rivales', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed(ELEVEN));
    await openClosed(page);
    await applyForm(page, true, '4-4-2');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    await applyForm(page, true, '4-4-2');
    await expect.poll(() => count(page), { timeout: 5000 }).toBe(11);
    const doc = await canvas(page);
    const rivals = doc.frames[0].elements.filter((e) => e.t === 'player' && e.side === 'rival');
    expect(rivals.length, 'máximo 11 rivales').toBe(11);
  });
});
