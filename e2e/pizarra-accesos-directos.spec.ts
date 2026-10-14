import { test, expect } from '@playwright/test';
import { seedBoard, openBoard, hostBox, normToScreen, fitMode } from './board-helpers';

for (const viewport of [
  { width: 1360, height: 900 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
]) {
  test(`categorías directas y paneles independientes ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await seedBoard(page);
    await openBoard(page, { keepProperties: true });
    const right = page.getByRole('dialog', { name: 'Propiedades', exact: true });
    await expect(right).toBeVisible();
    await expect(page.locator('.tools-toggle, .panel-min, .panel-tab')).toHaveCount(0);
    await expect(page.locator('.tools-cat')).toHaveCount(3);
    await page.locator('.tools-cat[title="Material"]').click();
    const left = page.getByRole('dialog', { name: 'Herramientas de Material', exact: true });
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    const a = (await left.boundingBox())!,
      b = (await right.boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    await page.screenshot({ path: `test-results/paneles-coexistentes-${viewport.width}.png` });
    await right.locator('.panel-close').click();
    await expect(left).toBeVisible();
    await left.locator('.panel-close').click();
    await expect(left).toHaveCount(0);
    await expect(page.locator('.tools-menu')).toBeVisible();
  });
}

test('variantes y colores arman el material sin volver a pulsar su padre', async ({ page }) => {
  await seedBoard(page);
  await openBoard(page, { keepProperties: true });
  await page.locator('.tools-cat[title="Material"]').click();
  const host = await hostBox(page),
    fit = await fitMode(page);
  const choices = [
    ['Variantes de BOSU', 'BOSU pequeño', 'bosu_small'],
    ['Variantes de Valla', 'Valla naranja', 'hurdle_orange'],
    ['Variantes de Cono', 'Cono (azul)', 'cone_blue'],
  ];
  for (const [group, name, kind] of choices) {
    await page
      .getByRole('group', { name: group, exact: true })
      .getByRole('button', { name, exact: true })
      .click();
    await expect(page.locator('.placement-hint')).toBeVisible();
    const point = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(`.board-canvas [data-asset-kind="${kind}"]`)).toHaveCount(1);
  }
  for (const [group, name] of [
    ['Colores de Chino', 'Chino Verde'],
    ['Colores de Pica', 'Pica Rojo'],
  ]) {
    await page
      .getByRole('group', { name: group, exact: true })
      .getByRole('button', { name, exact: true })
      .click();
    const point = normToScreen(0.55, 0.55, host, fit);
    await page.mouse.click(point.x, point.y);
  }
  await expect(page.locator('.field-count')).toHaveText('5');
  await expect(page.locator('.board-canvas [data-el-type="pica"]')).toHaveAttribute(
    'data-color',
    '#e74c3c',
  );
  await expect(page.locator('.board-canvas [data-el-type="target"]')).toHaveAttribute(
    'data-color',
    '#22c55e',
  );
  const physics = page.locator('.tools-material-group').filter({
    has: page.locator('.tools-material-group-title', { hasText: 'Preparación física' }),
  });
  await expect(physics.locator('.rail-row[title="Balón medicinal"]')).toBeVisible();
});

test('asignar colores coloca en orden de lectura y no cambia la plantilla', async ({ page }) => {
  await seedBoard(page);
  await page.addInitScript(() => {
    const sample = JSON.parse(localStorage.getItem('entrenolab:players')!)[0];
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify(
        Array.from({ length: 12 }, (_, i) => ({
          ...sample,
          id: `p${i}`,
          name: `Jugador ${i}`,
          number: i + 1,
        })),
      ),
    );
  });
  await openBoard(page, { keepProperties: true });
  await page.locator('.tools-cat[title="Jugadores"]').click();
  for (let i = 0; i < 12; i++)
    await page
      .getByRole('radiogroup', {
        name: `Paleta de color de Jugador ${i} en este ejercicio`,
        exact: true,
      })
      .locator('[data-color]')
      .first()
      .click();
  await expect(page.locator('.field-count')).toHaveText('12');
  const points = await page
    .locator('.board-canvas [data-el-type="player"]')
    .evaluateAll((elements) =>
      elements
        .filter((el) => el.querySelector('circle'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y };
        }),
    );
  expect(points.length).toBe(12);
  for (let i = 1; i < points.length; i++) {
    expect(points[i].y).toBeGreaterThanOrEqual(points[i - 1].y - 1);
    if (Math.abs(points[i].y - points[i - 1].y) < 1)
      expect(points[i].x).toBeGreaterThan(points[i - 1].x);
  }
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('entrenolab:players')!).every(
        (p: { color: string }) => p.color === '#1a73e8',
      ),
    ),
  ).toBe(true);
});

test('móvil vertical: nombre y cinco colores del jugador siguen juntos y dentro del panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBoard(page);
  await openBoard(page, { keepProperties: true });
  await page.locator('.tools-cat[title="Jugadores"]').click();
  const row = page.locator('.roster-row').first();
  await expect(row.locator('.mini-name')).toBeVisible();
  const name = (await row.locator('.mini-name').boundingBox())!,
    colors = (await row.locator('.roster-color-menu').boundingBox())!,
    panel = (await page.locator('.side-panel-left').boundingBox())!;
  expect(name.width).toBeGreaterThan(30);
  expect(colors.x + colors.width).toBeLessThanOrEqual(panel.x + panel.width);
  expect(name.x + name.width).toBeLessThanOrEqual(colors.x);
  expect(Math.abs(name.y + name.height / 2 - colors.y - colors.height / 2)).toBeLessThan(2);
  await expect(row.locator('[role="radio"]')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/jugadores-colores-movil.png' });
});

for (const width of [360, 390, 430]) {
  test(`inspector de texto a ${width}px: acciones completas sin desbordar el panel compartido`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedBoard(page);
    await openBoard(page, { keepProperties: true });
    await page.locator('.tools-cat[title="Dibujo"]').click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.locator('.side-panel-left .panel-close').click();
    const host = await hostBox(page);
    await page.mouse.click(host.x + host.width * 0.4, host.y + host.height * 0.2);
    await expect(page.locator('.field-count')).toHaveText('1');
    const panel = page.getByRole('dialog', { name: 'Propiedades', exact: true });
    await expect(panel.locator('.inspector')).toBeVisible();
    const overflow = await panel.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
    const box = (await panel.boundingBox())!;
    const actions = await panel.locator('.inspector-actions button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }),
    );
    expect(actions.length).toBeGreaterThan(3);
    for (const action of actions) {
      expect(action.width).toBeGreaterThan(0);
      expect(action.left).toBeGreaterThanOrEqual(box.x);
      expect(action.right).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    await page.screenshot({ path: `test-results/inspector-texto-movil-${width}.png` });
  });
}

test('dibujo sin borrador y flecha continua por defecto con movimiento discontinuo explícito', async ({
  page,
}) => {
  await seedBoard(page);
  await page.addInitScript(() => localStorage.removeItem('cdmplab:tool-line-style:v1'));
  await openBoard(page, { keepProperties: true });
  await page.locator('.tools-cat[title="Dibujo"]').click();
  await expect(page.locator('.rail-row[title="Borrar elemento"]')).toHaveCount(0);
  await page.locator('.rail-row[title="Flecha (movimiento)"]').click();
  await expect(page.getByRole('button', { name: 'Trazo continuo', exact: true })).toHaveClass(
    /chip-active/,
  );
  await expect(page.getByRole('button', { name: 'Trazo continuo', exact: true })).toHaveText(
    'Pase / golpeo',
  );
  await page.getByRole('button', { name: 'Trazo discontinuo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trazo discontinuo', exact: true })).toHaveText(
    'Sin balón',
  );
  await expect(page.getByRole('button', { name: 'Trazo discontinuo', exact: true })).toHaveClass(
    /chip-active/,
  );
});
