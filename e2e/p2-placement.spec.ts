import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import { fillBoardTitle } from './gesture-helpers';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    const players = [
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ];
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function openJugadores(page: Page): Promise<void> {
  // FASE B (paneles persistentes): abrir Jugadores es IDEMPOTENTE: si ya está
  // desplegado (porque ya no se cierra al elegir un jugador) no lo re-togglea.
  if (await page.locator('.side-panel-left').isVisible().catch(() => false)) return;
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
}

/** Replica el letterboxing del canvas (horizontal) para mapear norm (0..1) → pantalla. */
function normToScreen(nx: number, ny: number, box: { x: number; y: number; width: number; height: number }): [number, number] {
  const rect = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
  const s = Math.min(box.width / 100, box.height / 80);
  const offX = (box.width - 100 * s) / 2;
  const offY = (box.height - 80 * s) / 2;
  return [box.x + offX + (nx * rect.w + rect.x) * s, box.y + offY + (ny * rect.h + rect.y) * s];
}

test.describe('Fase 2 — colocación humana (jugadores / materiales / genéricos)', () => {
  test('tocar un jugador de plantilla ARMA la colocación y NO crea un elemento aún', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openJugadores(page);
    await page.locator('.side-panel-left .roster-item').first().click();
    // Aún no se ha creado ningún elemento.
    await expect(page.locator('.field-count')).toHaveText('0');
    // Se muestra la pista y la herramienta pasa a la categoría de colocación.
    await expect(page.locator('.placement-hint')).toBeVisible();
    await expect(page.locator('.placement-hint')).toContainText('Toca el campo para colocar a');
    // FASE B (paneles persistentes): elegir un jugador NO cierra el panel Jugadores.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  });

  test('el clic sobre el campo coloca al jugador en la posición normalizada tocada', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await openJugadores(page);
    await page.locator('.side-panel-left .roster-item').first().click();
    const [sx, sy] = normToScreen(0.25, 0.35, box);
    await page.mouse.click(sx, sy);
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.placement-hint')).toHaveCount(0);
    // Guardar y leer el modelo: quedó en (0.25, 0.35), no en una fila calculada.
    await fillBoardTitle(page, 'P2');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const el = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return ex.canvas.frames[0].elements[0];
    });
    expect(el.t).toBe('player');
    expect(el.x).toBeCloseTo(0.25, 2);
    expect(el.y).toBeCloseTo(0.35, 2);
  });

  test('tras colocar, la herramienta vuelve a Seleccionar', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await openJugadores(page);
    await page.locator('.side-panel-left .roster-item').first().click();
    await page.mouse.click(...normToScreen(0.35, 0.45, box));
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
  });

  test('Escape cancela el emplazamiento sin añadir ningún elemento', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openJugadores(page);
    await page.locator('.side-panel-left .roster-item').first().click();
    await expect(page.locator('.field-count')).toHaveText('0');
    await expect(page.locator('.placement-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.placement-hint')).toHaveCount(0);
    await expect(page.locator('.field-count')).toHaveText('0');
    await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
  });

  test('el tap sobre el propio material armado MANTIENE el modo de colocación continua (Fase 3)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await expect(page.locator('.field-count')).toHaveText('0');
    // El modo de colocación está armado (pista visible).
    await expect(page.locator('.placement-hint')).toBeVisible();
    // Fase 3: re-tocar el mismo material NO cancela; el modo sigue armado.
    // FASE B: el panel Material permanece abierto tras elegirlo, así que se re-toca
    // directamente la entrada (sin re-togglear la categoría, que ahora lo cerraría).
    await page.locator('.rail-btn[title="Cono"]').click();
    await expect(page.locator('.placement-hint')).toBeVisible();
    await expect(page.locator('.field-count')).toHaveText('0');
    // El modo de colocación continua sigue activo (no volvió a Seleccionar).
    await expect(page.locator('.tools-caption-title')).toHaveText('Cono');
  });

  test('un jugador de plantilla ya colocado sigue sin duplicarse (tarjeta deshabilitada)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await openJugadores(page);
    await page.locator('.side-panel-left .roster-item').first().click();
    await page.mouse.click(...normToScreen(0.4, 0.5, box));
    await expect(page.locator('.field-count')).toHaveText('1');
    // Reabrir el panel: la tarjeta queda deshabilitada con "Ya está en el campo".
    await openJugadores(page);
    const first = page.locator('.side-panel-left .roster-item').first();
    await expect(first).toHaveClass(/tray-disabled/);
    await expect(first.locator('.mini-name')).toHaveText('Ya está en el campo');
    await first.click({ force: true });
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('tocar un material (Cono) arma la colocación; el clic lo coloca y SIGUE armado (Fase 3)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await expect(page.locator('.field-count')).toHaveText('0'); // armado
    await expect(page.locator('.placement-hint')).toContainText('Toca el campo para colocar a Cono');
    await page.mouse.click(...normToScreen(0.5, 0.5, box));
    await expect(page.locator('.field-count')).toHaveText('1');
    // Fase 3: la colocación es CONTINUA — el Cono sigue armado, no volvió a Seleccionar.
    // El panel se cerró al elegir el material; se comprueba el estado armado por la pista
    // y por el título de la herramienta activa en la barra inferior.
    await expect(page.locator('.placement-hint')).toBeVisible();
    await expect(page.locator('.placement-hint')).toContainText('colocar a Cono');
    await expect(page.locator('.tools-caption-title')).toHaveText('Cono');
  });

  test('tocar un color (azul) arma la colocación y el clic la coloca', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await openJugadores(page);
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    await expect(page.locator('.field-count')).toHaveText('0'); // armado
    await expect(page.locator('.placement-hint')).toContainText('Toca el campo para colocar a Jugador azul');
    await page.mouse.click(...normToScreen(0.5, 0.5, box));
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('tocar un color (rojo) arma y coloca un jugador de ese color', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await openJugadores(page);
    await page.locator('.tray-player[title="Jugador Rojo"]').click();
    await expect(page.locator('.field-count')).toHaveText('0');
    await expect(page.locator('.placement-hint')).toContainText('Toca el campo para colocar a Jugador rojo');
    await page.mouse.click(...normToScreen(0.5, 0.5, box));
    await expect(page.locator('.field-count')).toHaveText('1');
    await fillBoardTitle(page, 'P2');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const el = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return ex.canvas.frames[0].elements[0];
    });
    // La diferenciación entre equipos es por COLOR (no por side): el rojo queda como
    // círculo genérico del color elegido.
    expect(el.c).toBe('#c0392b');
  });

  test('captura: colocación de un jugador en escritorio y móvil', async ({ page }) => {
    for (const [w, h, label] of [
      [1366, 900, 'desktop'],
      [390, 844, 'movil'],
    ] as Array<[number, number, string]>) {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await page.goto('/board');
      const box = (await page.locator('.board-host').boundingBox())!;
      await openJugadores(page);
      await page.locator('.side-panel-left .roster-item').first().click();
      await page.mouse.click(...normToScreen(0.4, 0.5, box));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `e2e/shots/p2-player-${label}.png` });
    }
  });

  test.describe('táctil (arrastre con touch)', () => {
    test.use({ hasTouch: true });

    test('el ARRASTRE táctil del panel al campo coloca al jugador', async ({ page }) => {
      await seed(page);
      await page.goto('/board');
      const box = (await page.locator('.board-host').boundingBox())!;
      await openJugadores(page);
      const item = page.locator('.side-panel-left .roster-item').first();
      const ib = (await item.boundingBox())!;
      const startX = ib.x + ib.width / 2;
      const startY = ib.y + ib.height / 2;
      const [tx, ty] = normToScreen(0.3, 0.4, box);
      const id = 71;
      const fire = (type: string, x: number, y: number) =>
        page.evaluate(({ type, x, y, id }) => {
          const el = document.querySelector('.side-panel-left .roster-item') as HTMLElement | null;
          el?.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true,
            button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
          }));
        }, { type, x, y, id });
      // FASE B (táctil): solo un ARRASTRE completo del panel → campo coloca una unidad.
      await fire('pointerdown', startX, startY);
      for (let i = 1; i <= 8; i++) {
        await fire('pointermove', startX + ((tx - startX) * i) / 8, startY + ((ty - startY) * i) / 8);
      }
      await fire('pointerup', tx, ty);
      await expect(page.locator('.field-count')).toHaveText('1');
    });
  });
});
