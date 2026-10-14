import { ensurePropsPanel } from './gesture-helpers';
import { test, expect } from '@playwright/test';
import {
  seedBoard,
  openBoard,
  abrirHerramientas,
  hostBox,
  normToScreen,
  fitMode,
} from './board-helpers';

const choices = [
  ['Valla', 'Valla naranja', 'hurdle_orange'],
  ['Valla', 'Valla clásica', 'hurdle'],
  ['Mancuerna / pesa', 'Mancuerna / pesa', 'dumbbell_metal'],
  ['Mancuerna / pesa', 'Pesa rusa', 'kettlebell'],
  ['Mancuerna / pesa', 'Disco de peso', 'weight_plate'],
  ['Gomas elásticas', 'Goma naranja', 'band_yellow'],
  ['Gomas elásticas', 'Goma roja', 'band_red'],
  ['Balón medicinal', 'Balón medicinal', 'medicine_ball'],
  ['Balón medicinal', 'Balón medicinal con asas', 'medicine_handles'],
  ['BOSU', 'BOSU', 'bosu_blue'],
  ['BOSU', 'BOSU pequeño', 'bosu_small'],
] as const;

for (const raw of [
  'null',
  '[]',
  '{"hurdle":"hurdle_high","marker":"no-existe","cone":"cone_blue"}',
]) {
  test(`preferencias antiguas o inválidas no bloquean el catálogo: ${raw}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedBoard(page);
    await page.addInitScript(
      (raw) => localStorage.setItem('cdmplab:material-variant:v1', raw),
      raw,
    );
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.rail-row[title="Valla"] .mat-thumb img')).toHaveAttribute(
      'src',
      'assets/tactical/hurdle-orange.png',
    );
    await expect(page.locator('.rail-row[title="BOSU"] .mat-thumb img')).toHaveAttribute(
      'src',
      'assets/tactical/bosu-blue.png',
    );
    expect(errors).toEqual([]);
  });
}

test('fotos: selector estable, todas las variantes, persistencia y PNG autocontenido', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await seedBoard(page);
  await openBoard(page);
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  const host = await hostBox(page),
    fit = await fitMode(page);
  let n = 0;
  for (const [title, label, kind] of choices) {
    const card = page
      .locator('.tools-material-card')
      .filter({ has: page.locator(`.rail-row[title="${title}"]`) });
    const variant = card
      .locator('.variant-swatch')
      .filter({ hasText: label })
      .filter({ has: page.locator('img') });
    // Comparación exacta por nombre accesible: hay etiquetas que son prefijos de otras.
    const button = card.locator(`.variant-swatch[aria-label="${label}"]`);
    const img = await button.locator('img').elementHandle();
    for (let i = 0; i < 12; i++) {
      await button.click();
      await page.mouse.move(host.x + host.width * 0.9, host.y + host.height * 0.3);
      expect(
        await img!.evaluate((e) => e.isConnected),
        'el nodo pulsado no desaparece durante el gesto',
      ).toBe(true);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(variant.first()).toBeVisible();
    await card.locator('.rail-row').click();
    const p = normToScreen(0.46 + (n % 5) * 0.1, 0.22 + Math.floor(n / 5) * 0.24, host, fit);
    await page.mouse.click(p.x, p.y);
    n++;
    await expect(page.locator('.field-count')).toHaveText(String(n));
    await expect(page.locator(`.board-canvas [data-asset-kind="${kind}"]`)).toHaveCount(1);
  }
  await page.screenshot({ path: 'test-results/materiales-fotos.png' });
  // Las dos porterías usan SVG con red, no símbolos genéricos o dibujos duplicados.
  for (const title of ['Miniportería', 'Portería grande']) {
    await expect(page.locator(`.rail-row[title="${title}"] .mat-thumb-vector svg`)).toHaveCount(1);
  }
  if (!(await page.locator('.studio-panel').isVisible())) await ensurePropsPanel(page);
  await page
    .getByRole('textbox', { name: 'Título del ejercicio', exact: true })
    .fill('Materiales nuevos');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  const doc = await page.evaluate(
    () => JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0],
  );
  expect(doc.canvas.frames[0].elements.map((e: { assetKind: string }) => e.assetKind)).toEqual(
    choices.map((c) => c[2]),
  );
  // La miniatura del producto es PNG (no SVG): comprobar que se rasteriza y carga.
  expect(doc.thumbnail).toMatch(/^data:image\/png;base64,/);
  const loaded = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, doc.thumbnail);
  expect(loaded.w).toBeGreaterThan(0);
  expect(loaded.h).toBeGreaterThan(0);
  await page.locator('.ex-card').first().locator('.ex-open-btn').click();
  await page.waitForURL('**/board');
  await expect(page.locator('.field-count')).toHaveText(String(choices.length));
  for (const [, , kind] of choices)
    await expect(page.locator(`.board-canvas [data-asset-kind="${kind}"]`)).toHaveCount(1);
});

test('los diez PNG tienen alpha real y el texto nuevo empieza a 1,4', async ({ page }) => {
  await seedBoard(page);
  await openBoard(page);
  const files = [
    'hurdle-orange',
    'dumbbell-metal',
    'kettlebell',
    'weight-plate',
    'band-yellow',
    'band-red',
    'medicine-ball',
    'medicine-handles',
    'bosu-blue',
    'bosu-small',
  ];
  for (const file of files) {
    const info = await page.evaluate(async (file) => {
      const img = new Image();
      img.src = `assets/tactical/${file}.png`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      return {
        w: img.width,
        h: img.height,
        alpha: data[3],
        transparent: data.filter((v, i) => i % 4 === 3 && v === 0).length,
      };
    }, file);
    expect(info.w).toBe(384);
    expect(info.h).toBe(384);
    expect(info.alpha).toBe(0);
    expect(info.transparent).toBeGreaterThan(384 * 384 * 0.1);
  }
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Texto"]').click();
  const p = normToScreen(0.5, 0.5, await hostBox(page), await fitMode(page));
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.board-canvas [data-el-type="text"] text')).toHaveAttribute(
    'font-size',
    '1.4',
  );
});
