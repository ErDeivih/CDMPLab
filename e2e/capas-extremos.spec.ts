import { test, expect, Page } from '@playwright/test';

const colors = ['#1a73e8', '#c0392b', '#f6c945', '#e67e22', '#8e44ad', '#ec4899'];
const order = (page: Page) =>
  page
    .locator('.board-canvas [data-el-type]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-color')));

for (const type of ['rect', 'cone'] as const) {
  test(`${type}: una pulsación mueve al extremo, con undo/redo y guardado`, async ({ page }) => {
    await page.addInitScript(
      ({ type, colors }) => {
        if (localStorage.getItem('entrenolab:seeded')) return;
        const now = new Date().toISOString();
        localStorage.setItem('entrenolab:seeded', '1');
        localStorage.setItem('entrenolab:board-hints', '1');
        localStorage.setItem('entrenolab:fill-hint', '1');
        localStorage.setItem(
          'entrenolab:teams',
          JSON.stringify([{ id: 't1', name: 'Equipo', accentColor: '#3056d3', createdAt: now }]),
        );
        for (const key of ['players', 'folders', 'sessions'])
          localStorage.setItem(`entrenolab:${key}`, '[]');
        const elements = colors.map((c, i) => ({
          id: `e${i}`,
          t: i === 5 ? type : 'rect',
          x: i === 5 ? 0.75 : 0.25,
          y: i === 5 ? 0.5 : 0.2 + i * 0.12,
          w: 0.06,
          h: 0.06,
          c,
        }));
        localStorage.setItem(
          'entrenolab:exercises',
          JSON.stringify([
            {
              id: 'ex1',
              teamId: 't1',
              folderId: null,
              title: 'Capas',
              description: '',
              explanation: '',
              category: 'Técnica',
              objectives: [],
              materials: [],
              durationMinutes: 10,
              minPlayers: null,
              maxPlayers: null,
              loadMode: 'fixed',
              isTemplate: false,
              thumbnail: null,
              savedAt: now,
              canvas: {
                version: 2,
                schemaVersion: 4,
                field: 'full',
                orientation: 'horizontal',
                frames: [{ duration: 1000, elements }],
              },
            },
          ]),
        );
      },
      { type, colors },
    );
    const open = async () => {
      await page.locator('.ex-card', { hasText: 'Capas' }).locator('.ex-open-btn').click();
      await page.waitForURL('**/board');
      await expect(page.locator('.field-count')).toHaveText('6');
    };
    const save = async () => {
      await page.locator('.chip-icon-primary').click();
      await page.waitForURL('**/library');
      await open();
    };
    const select = async () => {
      await page.locator('.board-canvas [data-color="#ec4899"]').click();
      await expect(page.locator('.inspector-actions')).toBeVisible();
    };
    await page.goto('/library');
    await open();
    await select();
    await page.getByRole('button', { name: 'Atrasar una capa', exact: true }).click();
    await expect.poll(() => order(page)).toEqual([...colors.slice(0, 4), colors[5], colors[4]]);
    await page.getByRole('button', { name: 'Adelantar una capa', exact: true }).click();
    await expect.poll(() => order(page)).toEqual(colors);
    await page.getByRole('button', { name: 'Enviar al fondo', exact: true }).click();
    const back = [colors[5], ...colors.slice(0, 5)];
    await expect.poll(() => order(page)).toEqual(back);
    await page.keyboard.press('Control+z');
    await expect.poll(() => order(page)).toEqual(colors);
    await page.keyboard.press('Control+y');
    await expect.poll(() => order(page)).toEqual(back);
    if (!(await page.locator('.chip-icon-primary').isVisible())) {
      await page.getByRole('button', { name: 'Propiedades', exact: true }).click();
    }
    await save();
    await expect.poll(() => order(page)).toEqual(back);
    await select();
    await page.getByRole('button', { name: 'Traer al frente', exact: true }).click();
    await expect.poll(() => order(page)).toEqual(colors);
    await page.getByRole('button', { name: 'Traer al frente', exact: true }).click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => order(page)).toEqual(back);
    await page.keyboard.press('Control+y');
    await expect.poll(() => order(page)).toEqual(colors);
  });
}
