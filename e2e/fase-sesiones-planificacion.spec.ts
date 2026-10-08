import { expect, test } from '@playwright/test';

test('sesión de 120 min: bloques, carpetas, series y asistencia sobreviven a una recarga', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([
        {
          id: 't1',
          name: 'Juvenil B',
          accentColor: '#3056d3',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify([
        {
          id: 'p1',
          teamId: 't1',
          name: 'Portero',
          number: 1,
          position: 'GK',
          color: '#3056d3',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'p2',
          teamId: 't1',
          name: 'Delantero',
          number: 9,
          position: 'FW',
          color: '#3056d3',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );
    localStorage.setItem(
      'entrenolab:folders',
      JSON.stringify([
        { id: 'f1', teamId: 't1', parentId: null, name: 'Calentamiento' },
        { id: 'f2', teamId: 't1', parentId: 'f1', name: 'Ruedas' },
      ]),
    );
    const exercise = (id: string, title: string, folderId: string | null) => ({
      id,
      teamId: 't1',
      folderId,
      title,
      description: '',
      explanation: '',
      category: 'Técnica',
      objectives: [],
      materials: [],
      durationMinutes: 10,
      minPlayers: null,
      maxPlayers: null,
      loadMode: 'fixed',
      seriesCount: null,
      repetitionsCount: null,
      workSeconds: null,
      restSeconds: null,
      isTemplate: false,
      canvas: null,
      thumbnail: null,
      savedAt: '2026-01-01T00:00:00.000Z',
    });
    localStorage.setItem(
      'entrenolab:exercises',
      JSON.stringify([
        exercise('e1', 'Rueda 4-3-3', 'f2'),
        exercise('e2', 'Partido condicionado', null),
      ]),
    );
    localStorage.setItem('entrenolab:sessions', '[]');
  });
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Nueva sesión' }).click();
  await expect(page.locator('input[name="number"]')).toHaveValue('1');
  await expect(page.locator('input[name="dur"]')).toHaveValue('120');
  await page.locator('textarea[name="objectives"]').fill('Transición tras robo');
  await page
    .locator('.section-heading')
    .filter({ hasText: 'Calentamiento' })
    .getByRole('button')
    .click();
  await page.locator('.folder-choice select').selectOption('f1');
  await expect(page.locator('.picker-item')).toHaveCount(1);
  await page.locator('.picker-item').click();
  await page.locator('.picker-inline').getByRole('button', { name: 'Listo' }).click();
  const task = page.locator('.task').filter({ hasText: 'Rueda 4-3-3' });
  await task.getByLabel('Series').fill('2');
  await task.getByLabel('Series').dispatchEvent('change');
  await task.getByLabel('Min/serie').fill('8');
  await task.getByLabel('Min/serie').dispatchEvent('change');
  await expect(task.locator('.task-sum')).toHaveText('16 min');
  const keeper = page.locator('.attendance-row').filter({ hasText: 'Portero' });
  await keeper.getByLabel('Estado').selectOption('Asiste');
  await expect(keeper.getByLabel('Estado')).toHaveValue('Asiste');
  await page.screenshot({ path: 'test-results/session-planning-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.modal-body').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator('.modal')).toBeInViewport();
  expect(
    await page.locator('.modal').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/session-planning-mobile.png' });
  await page.setViewportSize({ width: 1360, height: 900 });
  await keeper.getByLabel('Minutos').fill('110');
  await keeper.getByLabel('Minutos').dispatchEvent('change');
  await expect(keeper.getByLabel('Estado')).toHaveValue('Asiste');
  await page.getByRole('button', { name: 'Guardar sesión' }).click();
  await expect(page.locator('.session-title')).toHaveText('Sesión 1');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('entrenolab:sessions') ?? '[]')[0].attendance[0].status,
    ),
  ).toBe('Asiste');
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('entrenolab:sessions') ?? '[]')[0].attendance[0].status,
    ),
  ).toBe('Asiste');
  await page.getByTitle('Editar').click();
  await expect(page.locator('.attendance-head')).toContainText('1 presentes');
  await expect(page.locator('textarea[name="objectives"]')).toHaveValue('Transición tras robo');
  await expect(page.locator('.section-heading').filter({ hasText: 'Calentamiento' })).toBeVisible();
  await expect(
    page.locator('.task').filter({ hasText: 'Rueda 4-3-3' }).locator('.task-sum'),
  ).toHaveText('16 min');
  await expect(
    page.locator('.attendance-row').filter({ hasText: 'Portero' }).getByLabel('Estado'),
  ).toHaveValue('Asiste');
  await expect(
    page.locator('.attendance-row').filter({ hasText: 'Portero' }).getByLabel('Minutos'),
  ).toHaveValue('110');
});
