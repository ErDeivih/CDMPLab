// =============================================================
// LOTE C4 — Ajustes: restaurar la copia automática.
//
// Al importar un respaldo, el estado anterior se guarda solo como «copia automática»
// (store: KEY_AUTO_BACKUP). Hasta ahora esa copia era INALCANZABLE desde la interfaz:
// el usuario que se equivocaba al importar no tenía vuelta atrás.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { abrirAjustes } from './gesture-helpers';

const TEAM = {
  id: 't1',
  name: 'Primer Equipo',
  accentColor: '#3056d3',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function ex(id: string, title: string): Record<string, unknown> {
  return {
    id,
    teamId: 't1',
    folderId: null,
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
    savedAt: `2026-01-0${id.slice(-1)}T10:00:00.000Z`,
  };
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(
    (data: { team: unknown; exercises: unknown[] }) => {
      if (localStorage.getItem('entrenolab:seeded')) return;
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:teams', JSON.stringify([data.team]));
      localStorage.setItem('entrenolab:players', JSON.stringify([]));
      localStorage.setItem('entrenolab:exercises', JSON.stringify(data.exercises));
      localStorage.setItem('entrenolab:folders', JSON.stringify([]));
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    },
    { team: TEAM, exercises: [ex('x1', 'Uno'), ex('x2', 'Dos')] },
  );
}

async function openSettings(page: Page): Promise<void> {
  await abrirAjustes(page);
  await expect(page.locator('.settings')).toBeVisible();
}

test.describe('Lote C4 — Ajustes: copia automática', () => {
  test('tras importar aparece «Restaurar copia automática» y devuelve el estado anterior', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/library');
    await expect(page.locator('.ex-card')).toHaveCount(2);

    // Exportamos el respaldo de AHORA (2 ejercicios).
    await openSettings(page);
    const dl = page.waitForEvent('download');
    await page
      .locator('.settings-row', { hasText: 'Exportar respaldo' })
      .locator('button', { hasText: 'Exportar' })
      .click();
    const path = await (await dl).path();
    // Aún no hay copia automática: la fila no existe.
    await expect(
      page.locator('.settings-row', { hasText: 'Restaurar copia automática' }),
    ).toHaveCount(0);
    // Escape cierra Ajustes (como el resto de diálogos de la app).
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings')).toHaveCount(0);

    // Cambiamos el estado: un tercer ejercicio.
    await page.locator('button', { hasText: 'Crear ejercicio' }).first().click();
    await page.locator('.modal input[name="title"]').fill('Tres');
    await page.getByText('Guardar').click();
    await expect(page.locator('.ex-card')).toHaveCount(3);

    // Importamos el respaldo de 2 → el estado de 3 queda como copia automática.
    await openSettings(page);
    await page
      .locator('.settings-row', { hasText: 'Importar respaldo' })
      .locator('input[type="file"]')
      .setInputFiles(path!);
    await expect(page.locator('.settings-row', { hasText: 'Respaldo válido' })).toBeVisible();
    await page
      .locator('.settings-row', { hasText: 'Respaldo válido' })
      .locator('button', { hasText: 'Reemplazar' })
      .click();
    await expect(page.locator('.ex-card')).toHaveCount(2);

    // La fila de restauración aparece (el store avisa sin recargar).
    await openSettings(page);
    const row = page.locator('.settings-row', { hasText: 'Restaurar copia automática' });
    await expect(row).toBeVisible();

    // Restaurar → confirmación → vuelve el estado de 3 ejercicios.
    await row.locator('button', { hasText: 'Restaurar' }).click();
    await expect(page.locator('.confirm')).toBeVisible();
    await page.locator('.confirm .btn-danger-solid').click();
    await expect(page.locator('.ex-card')).toHaveCount(3);
  });
});
