import { test, expect } from '@playwright/test';
import { seedBoard, openBoard, hostBox, fitMode, normToScreen } from './board-helpers';
import { fillBoardTitle } from './gesture-helpers';

test('balones y chinos fotográficos: escoger, colocar, guardar, reabrir y exportar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedBoard(page);
  await openBoard(page, { keepProperties: true });
  await page.locator('.side-panel-right .panel-close').click();
  await page.locator('.tools-cat[title="Material"]').click();
  const host = await hostBox(page),
    fit = await fitMode(page);
  let count = 0;
  for (const name of [
    'Balón de fútbol',
    'Balón Tiro rojo',
    'Balón Tiro blanco / negro',
    'Balón Tango',
  ]) {
    await page
      .getByRole('group', { name: 'Variantes de Balón', exact: true })
      .getByRole('button', { name, exact: true })
      .click();
    const p = normToScreen(0.4 + count * 0.1, 0.25, host, fit);
    await page.mouse.click(p.x, p.y);
    count++;
  }
  await expect(page.locator('.board-canvas [data-el-type="ball"]')).toHaveCount(4);
  await page
    .getByRole('group', { name: 'Variantes de Chino', exact: true })
    .getByRole('button', { name: 'Chino fotografía', exact: true })
    .click();
  const colors = page
    .getByRole('group', { name: 'Colores de Chino', exact: true })
    .locator('[data-color]');
  for (let i = 0; i < 10; i++) {
    await colors.nth(i).click();
    const p = normToScreen(0.4 + (i % 5) * 0.08, 0.5 + Math.floor(i / 5) * 0.15, host, fit);
    await page.mouse.click(p.x, p.y);
    count++;
  }
  await expect(
    page.locator('.board-canvas [data-asset-kind="chino_photo"] image[filter]'),
  ).toHaveCount(10);
  await page
    .getByRole('group', { name: 'Variantes de Chino', exact: true })
    .getByRole('button', { name: 'Chino', exact: true })
    .click();
  const p = normToScreen(0.45, 0.8, host, fit);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.field-count')).toHaveText(String(count + 1));
  await expect(page.locator('.board-canvas [data-asset-kind="target"] image')).toHaveCount(0);
  await page.locator('.side-panel-left .panel-close').click();
  await fillBoardTitle(page, 'Balones y chinos de fotografía');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  const exercise = await page.evaluate(
    () => JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0],
  );
  expect(
    exercise.canvas.frames[0].elements.filter(
      (el: { assetKind: string }) => el.assetKind === 'chino_photo',
    ),
  ).toHaveLength(10);
  expect(exercise.thumbnail).toMatch(/^data:image\/png;base64,/);
  await page.locator('.ex-card .ex-open-btn').first().click();
  await expect(page.locator('.board-canvas [data-asset-kind="chino_photo"] image')).toHaveCount(10);
  await page.screenshot({ path: 'test-results/balones-chinos-fotos.png' });
  expect(errors).toEqual([]);
});

test.describe('selección directa táctil de variantes', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });
  test('elegir una variante deja el objeto listo para tocar el campo, sin pulsar el padre', async ({
    page,
  }) => {
    await seedBoard(page);
    await openBoard(page, { keepProperties: true });
    await page.locator('.tools-cat[title="Material"]').tap();
    await page
      .getByRole('group', { name: 'Variantes de Balón', exact: true })
      .getByRole('button', { name: 'Balón Tango', exact: true })
      .tap();
    await expect(page.locator('.placement-hint')).toBeVisible();
    await page.locator('.side-panel-right .panel-close').tap();
    await page.locator('.side-panel-left .panel-close').tap();
    const p = normToScreen(0.5, 0.5, await hostBox(page), await fitMode(page));
    await page.touchscreen.tap(p.x, p.y);
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.board-canvas [data-el-type="ball"]')).toHaveAttribute(
      'data-asset-kind',
      'ball_tango',
    );
  });
});

test('fotografías transparentes y normalizadas sin fondo ni sombra exterior', async ({ page }) => {
  await page.goto('/');
  for (const name of ['ball-tiro-red', 'ball-tiro-black', 'ball-tango', 'chino-photo-green']) {
    const result = await page.evaluate(async (name) => {
      const image = new Image();
      image.src = `assets/tactical/${name}.png`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 0) transparent++;
      return { width: image.width, height: image.height, corner: pixels[3], transparent };
    }, name);
    expect(result.width).toBe(384);
    expect(result.height).toBe(384);
    expect(result.corner).toBe(0);
    expect(result.transparent).toBeGreaterThan(384 * 384 * 0.2);
  }
});
