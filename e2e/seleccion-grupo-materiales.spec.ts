import { test, expect, Page } from '@playwright/test';
import type { CanvasElement, CanvasFrame } from '../src/app/core/models';
import {
  seedBoard,
  openBoard,
  normToScreen,
  hostBox,
  fitMode,
  showCategory,
} from './board-helpers';
import { ensurePropsPanel } from './gesture-helpers';

async function fixture(page: Page, elements: CanvasElement[]) {
  await page.setViewportSize({ width: 1360, height: 900 });
  await seedBoard(page);
  await openBoard(page);
  await page.evaluate((elements) => {
    const ng = (
      window as unknown as {
        ng: { getComponent(el: Element): { frames: { set(v: CanvasFrame[]): void } } };
      }
    ).ng;
    ng.getComponent(document.querySelector('app-board')!).frames.set([
      { duration: 1000, elements },
    ]);
  }, elements);
  await expect(page.locator('.board-canvas [data-el-type]')).toHaveCount(elements.length);
}
async function state(page: Page) {
  return page.evaluate(() => {
    const ng = (
      window as unknown as {
        ng: {
          getComponent(el: Element): { frames: () => CanvasFrame[]; selectedIds: () => string[] };
        };
      }
    ).ng;
    const board = ng.getComponent(document.querySelector('app-board')!);
    return { elements: board.frames()[0].elements, selected: board.selectedIds() };
  });
}
async function clickAt(page: Page, x: number, y: number) {
  const p = normToScreen(x, y, await hostBox(page), await fitMode(page));
  await page.mouse.click(p.x, p.y);
}
const elements: CanvasElement[] = [
  { id: 'a', t: 'pica', x: 0.38, y: 0.4, size: 0.7, c: '#22c55e' },
  { id: 'b', t: 'peto', x: 0.53, y: 0.55, size: 0.7, c: '#f6c945' },
  { id: 'c', t: 'cone', x: 0.68, y: 0.7, size: 0.7, c: '#e74c3c' },
];

test('Ctrl añade y quita objetos; color, escala, giro y borrar afectan al grupo con undo único', async ({
  page,
}) => {
  await fixture(page, elements);
  await clickAt(page, 0.38, 0.4);
  await page.keyboard.down('Control');
  await clickAt(page, 0.53, 0.55);
  expect((await state(page)).selected).toEqual(['a', 'b']);
  await clickAt(page, 0.53, 0.55);
  expect((await state(page)).selected).toEqual(['a']);
  await clickAt(page, 0.53, 0.55);
  await page.keyboard.up('Control');
  await ensurePropsPanel(page);
  await expect(
    page.getByRole('status').filter({ hasText: '2 objetos seleccionados' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Color rojo', exact: true }).click();
  expect((await state(page)).elements.slice(0, 2).every((el) => el.c === '#c0392b')).toBe(true);
  expect((await state(page)).elements[2].c).toBe('#e74c3c');
  await page.getByRole('button', { name: 'Ampliar selección 10%', exact: true }).click();
  const scaled = await state(page);
  expect(scaled.elements[0].size).toBeCloseTo(0.77);
  expect(scaled.elements[1].size).toBeCloseTo(0.77);
  expect(scaled.elements[2].size).toBe(0.7);
  await page
    .getByRole('button', { name: 'Girar selección 45 grados a la derecha', exact: true })
    .click();
  expect((await state(page)).elements[0].rot).toBe(45);
  expect((await state(page)).elements[1].rot).toBe(45);
  await page.keyboard.press('Control+z');
  expect((await state(page)).elements[0].rot ?? 0).toBe(0);
  expect((await state(page)).elements[1].rot ?? 0).toBe(0);
});

test('las asas del grupo redimensionan todos desde un ancla y Escape cancela sin guardar cambios', async ({
  page,
}) => {
  await fixture(page, elements);
  await clickAt(page, 0.38, 0.4);
  await page.keyboard.down('Control');
  await clickAt(page, 0.53, 0.55);
  await page.keyboard.up('Control');
  await expect(page.locator('.group-resize-handle')).toHaveCount(4);
  const b = (await page.locator('.group-resize-handle').nth(2).boundingBox())!;
  const before = await state(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 50, b.y + 35, { steps: 10 });
  await page.mouse.up();
  const after = await state(page);
  expect(after.elements[0].size!).toBeGreaterThan(before.elements[0].size!);
  expect(after.elements[1].size).toBeCloseTo(after.elements[0].size!);
  expect(after.elements[2]).toEqual(before.elements[2]);
  const next = (await page.locator('.group-resize-handle').nth(2).boundingBox())!;
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2);
  await page.mouse.down();
  await page.mouse.move(next.x + 30, next.y + 30, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await state(page)).elements).toEqual(after.elements);
  await page.keyboard.press('Control+z');
  expect((await state(page)).elements).toEqual(before.elements);
});

test('recuadro en vacío selecciona varios, arrastra el grupo, copia y pega todo', async ({
  page,
}) => {
  await fixture(page, elements);
  const host = await hostBox(page),
    fit = await fitMode(page);
  const start = normToScreen(0.3, 0.3, host, fit),
    end = normToScreen(0.59, 0.63, host, fit);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 15 });
  await expect(page.locator('.selection-marquee')).toBeVisible();
  await page.mouse.up();
  expect((await state(page)).selected).toEqual(['a', 'b']);
  const from = normToScreen(0.38, 0.4, host, fit),
    to = normToScreen(0.42, 0.45, host, fit);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  expect((await state(page)).elements[0].x).toBeCloseTo(0.42, 2);
  expect((await state(page)).elements[1].x).toBeCloseTo(0.57, 2);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  expect((await state(page)).elements).toHaveLength(5);
  expect((await state(page)).selected).toHaveLength(2);
  await page.keyboard.press('Delete');
  expect((await state(page)).elements).toHaveLength(3);
  await page.keyboard.press('Control+z');
  expect((await state(page)).elements).toHaveLength(5);
});

test('pica gira y capas/bloqueo respetan la selección completa', async ({ page }) => {
  await fixture(page, elements);
  await clickAt(page, 0.38, 0.4);
  await ensurePropsPanel(page);
  await page
    .getByRole('button', { name: 'Girar selección 45 grados a la derecha', exact: true })
    .click();
  expect((await state(page)).elements[0].rot).toBe(45);
  await expect(page.locator('[data-el-type="pica"] [transform*="rotate(45"]')).toHaveCount(1);
  await page.locator('.studio-panel .panel-close').click();
  await page.keyboard.down('Control');
  await clickAt(page, 0.53, 0.55);
  await page.keyboard.up('Control');
  await ensurePropsPanel(page);
  await page.getByRole('button', { name: 'Traer al frente', exact: true }).click();
  expect((await state(page)).elements.map((el) => el.id)).toEqual(['c', 'a', 'b']);
  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  expect((await state(page)).elements.filter((el) => el.locked).map((el) => el.id)).toEqual([
    'a',
    'b',
  ]);
  await page.keyboard.press('Delete');
  expect((await state(page)).elements).toHaveLength(3);
  await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await page.keyboard.press('Delete');
  expect((await state(page)).elements.map((el) => el.id)).toEqual(['c']);
});

test('diez colores de conos, aros y petos arman directamente el objeto y se ven en el campo', async ({
  page,
}) => {
  await fixture(page, []);
  await showCategory(page, 'Material');
  for (const [title, type] of [
    ['Cono', 'cone'],
    ['Aro', 'ring'],
    ['Peto', 'peto'],
  ]) {
    const palette = page.getByRole('group', { name: `Colores de ${title}`, exact: true });
    await expect(palette.locator('button')).toHaveCount(10);
    await palette.getByRole('button', { name: `${title} Morado`, exact: true }).click();
    await clickAt(page, 0.5, 0.5);
    const object = page.locator(`.board-canvas [data-el-type="${type}"]`);
    await expect(object).toHaveAttribute('data-color', '#a855f7');
    if (type === 'peto') await expect(object.locator('path')).toHaveAttribute('fill', '#a855f7');
    else await expect(object.locator('image')).toHaveAttribute('filter', /url/);
  }
});
