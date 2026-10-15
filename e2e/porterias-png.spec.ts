import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  seedBoard,
  openBoard,
  showCategory,
  hostBox,
  fitMode,
  normToScreen,
} from './board-helpers';

test('catálogo y campo usan los PNG solicitados, sin confundir ladder.png con la escalera', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await seedBoard(page);
  await openBoard(page);
  for (const [title, type, file, x, y] of [
    ['Portería grande', 'goal', 'ladder.png', 0.3, 0.35],
    ['Miniportería', 'minigoal', 'minigoal.png', 0.7, 0.65],
  ] as const) {
    await showCategory(page, 'Material');
    const tool = page.locator(`.rail-row[title="${title}"]`);
    await expect(tool.locator('image')).toHaveAttribute('href', `assets/tactical/${file}`);
    await tool.click();
    await page.locator('.side-panel-left .panel-close').click();
    const p = normToScreen(x, y, await hostBox(page), await fitMode(page));
    await page.mouse.click(p.x, p.y);
    const object = page.locator(`.board-canvas [data-el-type="${type}"]`);
    await expect(object.locator('image')).toHaveAttribute('href', `assets/tactical/${file}`);
    await expect(object.locator('.goal-photo')).toHaveCount(1);
  }
  await showCategory(page, 'Material');
  await expect(page.locator('.rail-row[title="Escalera"] image')).toHaveCount(0);
  await page.locator('.side-panel-left .panel-close').click();
  await page.screenshot({ path: 'test-results/porterias-png.png' });
  const download = page.waitForEvent('download');
  await page.locator('.studio-top button[aria-label="Exportar"]').click();
  await page.locator('.rail-btn', { hasText: 'PNG' }).first().click();
  const result = await download;
  const file = await result.path();
  const data = (await readFile(file!)).toString('base64');
  const counts = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return [
      [0.3, 0.35],
      [0.7, 0.65],
    ].map(([x, y]) => {
      const sx = ((4 + x * 92) / 100) * canvas.width,
        sy = ((10 + (y * 92 * 68) / 105) / 80) * canvas.height;
      const w = Math.round(canvas.width * 0.08),
        h = Math.round(canvas.height * 0.07);
      const pixels = ctx.getImageData(Math.round(sx - w / 2), Math.round(sy - h / 2), w, h).data;
      let white = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) white++;
      return { white, total: w * h };
    });
  }, data);
  for (const area of counts) {
    expect(area.white).toBeGreaterThan(20);
    expect(area.white / area.total).toBeLessThan(0.5);
  }
});

test('las porterías de documentos anteriores usan las imágenes nuevas sin reescribir el documento', async ({
  page,
}) => {
  await seedBoard(page);
  await openBoard(page);
  const original = [
    { id: 'g', t: 'goal', x: 0.3, y: 0.4, asset: '', size: 1.6 },
    { id: 'm', t: 'minigoal', x: 0.7, y: 0.6, size: 1.45, asset: 'assets/antigua.png' },
  ];
  await page.evaluate((elements) => {
    const ng = (
      window as unknown as {
        ng: { getComponent(el: Element): { frames: { set(value: unknown[]): void } } };
      }
    ).ng;
    ng.getComponent(document.querySelector('app-board')!).frames.set([
      { duration: 1000, elements },
    ]);
  }, original);
  await expect(page.locator('[data-el-type="goal"] image')).toHaveAttribute(
    'href',
    'assets/tactical/ladder.png',
  );
  await expect(page.locator('[data-el-type="minigoal"] image')).toHaveAttribute(
    'href',
    'assets/tactical/minigoal.png',
  );
  const saved = await page.evaluate(() => {
    const ng = (
      window as unknown as {
        ng: { getComponent(el: Element): { frames: () => { elements: unknown[] }[] } };
      }
    ).ng;
    return ng.getComponent(document.querySelector('app-board')!).frames()[0].elements;
  });
  expect(saved).toEqual(original);
});
