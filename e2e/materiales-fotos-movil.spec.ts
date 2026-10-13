import { test, expect, Page } from '@playwright/test';
import {
  seedBoard,
  openBoard,
  abrirHerramientas,
  hostBox,
  normToScreen,
  fitMode,
} from './board-helpers';

test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });
async function swipe(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 12; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: start.x + ((end.x - start.x) * i) / 12, y: start.y + ((end.y - start.y) * i) / 12 },
        ],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

test('vertical: scroll nativo desde el nombre y arrastre hacia arriba desde la imagen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBoard(page);
  await openBoard(page);
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).tap();
  const panel = page.locator('.tools-panel-side');
  const ball = page.locator('.rail-row[title="Balón"]');
  await ball.scrollIntoViewIfNeeded();
  const b = (await ball.boundingBox())!,
    before = await panel.evaluate((e) => e.scrollTop);
  const start = { x: b.x + b.width * 0.65, y: b.y + b.height / 2 };
  await swipe(page, start, { x: start.x, y: start.y - 140 });
  await expect.poll(() => panel.evaluate((e) => e.scrollTop)).toBeGreaterThan(before + 10);
  await expect(page.locator('.field-count')).toHaveText('0');
  const icon = page.locator('.rail-row[title="Cono"] .mat-thumb');
  await icon.scrollIntoViewIfNeeded();
  const grip = (await icon.boundingBox())!,
    host = await hostBox(page);
  await swipe(
    page,
    { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
    { x: host.x + host.width * 0.65, y: host.y + host.height * 0.2 },
  );
  await expect(page.locator('.field-count')).toHaveText('1');
  await expect(page.locator('.board-canvas [data-el-type="cone"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/materiales-movil-vertical.png' });
});
for (const [title, label, type, kind] of [
  ['Gomas elásticas', 'Goma roja', 'resistance_band', 'band_red'],
  ['Balón medicinal', 'Balón medicinal con asas', 'medicine_ball', 'medicine_handles'],
] as const) {
  test(`móvil: seleccionar y arrastrar ${label}, sin bloqueo ni colocación fantasma`, async ({
    page,
  }) => {
    await seedBoard(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).tap();
    const card = page
      .locator('.tools-material-card')
      .filter({ has: page.locator(`.rail-row[title="${title}"]`) });
    const variant = card.locator(`.variant-swatch[aria-label="${label}"]`);
    for (let i = 0; i < 8; i++) {
      await variant.tap();
      await expect(variant).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.locator('.field-count')).toHaveText('0');
    const row = card.locator('.rail-row');
    await row.scrollIntoViewIfNeeded();
    const b = (await row.boundingBox())!,
      host = await hostBox(page);
    const destination = normToScreen(0.75, 0.5, host, await fitMode(page));
    const cdp = await page.context().newCDPSession(page);
    try {
      const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      for (let i = 1; i <= 8; i++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: start.x + ((destination.x - start.x) * i) / 8,
              y: start.y + ((destination.y - start.y) * i) / 8,
            },
          ],
        });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator(`.board-canvas [data-el-type="${type}"]`)).toHaveAttribute(
      'data-asset-kind',
      kind,
    );
    const empty = normToScreen(0.55, 0.2, host, await fitMode(page));
    await page.touchscreen.tap(empty.x, empty.y);
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.screenshot({ path: `test-results/materiales-movil-${type}.png` });
  });
}
