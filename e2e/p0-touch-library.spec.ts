import { test, expect, Page } from '@playwright/test';

async function seedFoldersExercise(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([
      { id: 'f1', teamId: 't1', parentId: null, name: 'Posesión', createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: 'Conservación', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

for (const [W, H] of [
  [390, 844],
  [360, 800],
] as const) {
  test.describe(`Biblioteca táctil ${W}×${H}`, () => {
    test('la tarjeta tiene acción primaria visible y un menú "Más" táctil que funciona', async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await seedFoldersExercise(page);
      await page.goto('/library');
      await expect(page.locator('.ex-card')).toHaveCount(1);

      // Acción primaria SIEMPRE visible (no solo en hover).
      const openBtn = page.locator('.ex-open-btn').first();
      await expect(openBtn).toBeVisible();
      await expect(openBtn).toHaveAttribute('title', 'Diseñar en pizarra');

      // Menú "Más": se abre con un tap (no hover).
      await page.locator('.ex-card .ex-more-btn').first().click();
      await expect(page.locator('.ex-more-menu')).toBeVisible();
      await expect(page.locator('.ex-more-menu').getByText('Duplicar')).toBeVisible();
      await expect(page.locator('.ex-more-menu').getByText('Mover a carpeta')).toBeVisible();
      await expect(page.locator('.ex-more-menu').getByText('Editar datos')).toBeVisible();
      await expect(page.locator('.ex-more-menu').getByText('Eliminar')).toBeVisible();

      // Duplicar desde el menú → ahora hay 2 tarjetas.
      await page.locator('.ex-more-menu').getByText('Duplicar').click();
      await expect(page.locator('.ex-card')).toHaveCount(2);
    });

    test('crear, abrir, mover, renombrar y borrar funcionan por táctil', async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: W, height: H });
      await seedFoldersExercise(page);
      await page.goto('/library');

      // Crear una tarea nueva (táctil).
      await page.getByText('Crear tarea').first().click();
      await page.locator('.modal input[name="title"]').fill('Nuevo circuito');
      await page.locator('.modal-foot .btn', { hasText: 'Diseñar' }).click();
      await page.waitForURL('**/board');
      await expect(page.locator('.studio')).toBeVisible();
      await page.locator('button[aria-label="Volver"]').click();
      await expect(page.locator('.library')).toBeVisible();
      await expect(page.locator('.ex-card')).toHaveCount(2);

      // Mover a la carpeta 'Posesión' desde el menú "Más".
      await page.locator('.ex-card').first().locator('.ex-more-btn').click();
      await page.locator('.ex-more-menu').getByText('Mover a carpeta').click();
      await expect(page.locator('.modal-sm')).toBeVisible();
      await page.locator('.picker-item', { hasText: 'Posesión' }).click();
      await expect(page.locator('.modal-sm')).toHaveCount(0);

      // En móvil el árbol de carpetas vive en un cajón: abrirlo.
      await page.locator('.sidebar-toggle').click();
      await expect(page.locator('.lib-sidebar.open')).toBeVisible();

      // Menú contextual de carpeta (siempre visible): renombrar.
      await page.locator('.tree-row .tree-more-btn').first().click();
      await expect(page.locator('.folder-more-menu')).toBeVisible();
      await page.locator('.folder-more-menu').getByText('Renombrar').click();
      await expect(page.locator('.tree-inline input.folder-input')).toBeVisible();
      await page.locator('.tree-inline input.folder-input').fill('Posesión 2');
      await page.locator('.tree-inline').getByText('OK').click();
      await expect(page.locator('.tree-name', { hasText: 'Posesión 2' })).toBeVisible();

      // Nueva subcarpeta desde el menú.
      await page.locator('.tree-row .tree-more-btn').first().click();
      await page.locator('.folder-more-menu').getByText('Nueva subcarpeta').click();
      await expect(page.locator('.tree-inline input.folder-input')).toBeVisible();
      await page.locator('.tree-inline input.folder-input').fill('Rondos');
      await page.locator('.tree-inline').getByText('Crear').click();
      await expect(page.locator('.tree-name', { hasText: 'Rondos' })).toBeVisible();

      // Cerrar el cajón (tap en la zona del fondo fuera de la barra lateral).
      await page.mouse.click(W - 10, 220);
      await expect(page.locator('.lib-sidebar.open')).toHaveCount(0);

      // Borrar ejercicio desde el menú "Más" (con confirmación).
      await page.locator('.ex-card').first().locator('.ex-more-btn').click();
      await page.locator('.ex-more-menu').getByText('Eliminar').click();
      await page.locator('.confirm-actions .btn-danger-solid').click();
      await expect(page.locator('.ex-card')).toHaveCount(1);
    });
  });
}
