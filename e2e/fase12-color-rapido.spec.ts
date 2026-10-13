import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas, showCategory } from './board-helpers';

// FASE 12 — color rápido por jugador en el panel Jugadores, sin abrir el inspector.
async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify([
        {
          id: 'p1',
          teamId: 't1',
          name: 'Marcos',
          number: 2,
          position: 'DF',
          color: '#1a73e8',
          active: true,
          createdAt: now,
        },
      ]),
    );
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}
async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // FASE G: el clic siguiente (`.tools-cat`) espera a que el panel esté accionable;
  // el wait fijo post-carga era redundante.
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
}

test('FASE 12 + FASE 2: cambiar el color de un jugador NO toca la plantilla; queda en el ejercicio', async ({
  page,
}) => {
  await seed(page);
  await openBoard(page);
  await expect(page.locator('.roster-item')).toHaveCount(1);
  // Contrato nuevo: paleta siempre visible; elegir color también coloca al jugador.
  await expect(page.locator('.roster-color-menu')).toBeVisible();
  await page.locator('.roster-color-menu .swatch[aria-label^="Color Naranja"]').click();
  await expect(page.locator('.field-count')).toHaveText('1');
  await expect(page.locator('.board-canvas svg [data-player-id="p1"]')).toHaveAttribute(
    'data-color',
    '#e67e22',
  );
  await page.keyboard.press('Control+z');
  await expect(page.locator('.field-count')).toHaveText('0');
  await expect(page.locator('.roster-color-menu [aria-checked="true"]')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.field-count')).toHaveText('1');

  // Un clic repetido no modifica el documento ni destruye la operación pendiente de rehacer.
  await page.locator('.roster-color-menu [data-color="#1a73e8"]').click();
  await page.keyboard.press('Control+z');
  await page.locator('.roster-color-menu [data-color="#e67e22"]').click();
  await page.keyboard.press('Control+y');
  await expect(page.locator('.board-canvas [data-player-id="p1"]')).toHaveAttribute(
    'data-color',
    '#1a73e8',
  );
  await page.keyboard.press('Control+z');

  // CONTRATO ACTUALIZADO (FASE 2 del encargo del dueño): esta prueba exigía antes que el color
  // del JUGADOR DE PLANTILLA cambiase en el almacén (`entrenolab:players[0].color === '#1f7a4d'`).
  // Ese era justo el defecto: elegir un color en la pizarra modificaba la plantilla para siempre.
  // Ahora el color pertenece al EJERCICIO, así que lo correcto es lo contrario.
  const storeColor = await page.evaluate(
    () => JSON.parse(localStorage.getItem('entrenolab:players')!)[0].color,
  );
  expect(storeColor, 'la plantilla NO se modifica al elegir color en la pizarra').toBe('#1a73e8');

  // Y la paleta marca el color elegido (accesible con aria-checked + tick).
  await expect(page.locator('.roster-color-menu .swatch[aria-checked="true"]')).toHaveAttribute(
    'data-color',
    '#e67e22',
  );
  await expect(page.locator('.roster-color-menu .swatch[aria-checked="true"] .msi')).toHaveText(
    'check',
  );
});

test('FASE 12: cambiar el color estando ya colocado actualiza la ficha visible en el campo', async ({
  page,
}) => {
  await seed(page);
  await openBoard(page);
  // Colocar al jugador.
  await page.locator('.roster-item').click();
  const host = (await page.locator('.board-host').boundingBox())!;
  await page.mouse.click(host.x + host.width * 0.5, host.y + host.height * 0.5);
  await expect(page.locator('.field-count')).toHaveText('1');
  // FASE B: el panel Jugadores permanece abierto tras colocar, así que NO se re-togglea
  // (eso lo cerraría); se usa el panel ya desplegado.
  await page.locator('.roster-color-menu .swatch[aria-label^="Color Naranja"]').click();
  await expect(page.locator('.field-count')).toHaveText('1');
  // Fase 12: el color del jugador YA colocado se refleja en el campo (reactivo).
  await expect(page.locator('.board-canvas svg [data-el-type="player"]')).toHaveAttribute(
    'data-color',
    '#e67e22',
  );
  // Un único playerId en el ejercicio.
  const playerIds = await page
    .locator('.board-canvas svg [data-el-type="player"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-player-id')));
  expect(playerIds).toEqual(['p1']);
});

test('chinos con color previo y vallas baja/alta se colocan y conservan sus variantes', async ({
  page,
}) => {
  await seed(page);
  await openBoard(page);
  await showCategory(page, 'Material');
  await page.locator('.chino-colors [data-color="#a855f7"]').click();
  const chino = page.locator('.tools-material-card').filter({ has: page.locator('.chino-colors') });
  await chino.locator('.rail-row').click();
  const host = (await page.locator('.board-host').boundingBox())!;
  await page.mouse.click(host.x + host.width * 0.65, host.y + host.height * 0.4);
  await expect(page.locator('.board-canvas [data-el-type="target"]')).toHaveAttribute(
    'data-color',
    '#a855f7',
  );
  for (const [label, kind, y] of [
    // Contrato nuevo: fotos realistas; baja/alta vectoriales quedan solo en documentos antiguos.
    ['Valla naranja', 'hurdle_orange', 0.55],
    ['Valla clásica', 'hurdle', 0.7],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const row = page
      .locator('.tools-material-card')
      .filter({ has: page.getByRole('button', { name: label, exact: true }) });
    await row.locator('.rail-row').click();
    await page.mouse.click(host.x + host.width * 0.65, host.y + host.height * y);
    await expect(page.locator(`.board-canvas [data-asset-kind="${kind}"]`)).toHaveCount(1);
  }
  await expect(page.locator('.field-count')).toHaveText('3');
  await page.screenshot({ path: 'test-results/materiales-colores-rapidos.png' });
  await page.getByRole('button', { name: 'Propiedades', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Título del ejercicio', exact: true })
    .fill('Materiales rápidos');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  await page.locator('.ex-card', { hasText: 'Materiales rápidos' }).locator('.ex-open-btn').click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-canvas [data-el-type="target"]')).toHaveAttribute(
    'data-color',
    '#a855f7',
  );
  await expect(page.locator('.board-canvas [data-asset-kind="hurdle_orange"]')).toHaveCount(1);
  await expect(page.locator('.board-canvas [data-asset-kind="hurdle"]')).toHaveCount(1);
  await expect(page.locator('.field-count')).toHaveText('3');
});
