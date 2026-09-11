// =============================================================
// LOTE C3 — Plantilla: validación del alta/edición y filtros de la lista.
//
// Antes se podía guardar un jugador SIN posición (la opción «—» del selector), con un
// DORSAL REPETIDO (dos jugadores con el 10) o con dorsal 0, y en plantillas largas no
// había forma de encontrar a nadie.
// =============================================================
import { test, expect, Page } from '@playwright/test';

const TEAM = {
  id: 't1',
  name: 'Primer Equipo',
  accentColor: '#3056d3',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PLAYERS = [
  {
    id: 'p1',
    teamId: 't1',
    name: 'Dani',
    number: 1,
    position: 'GK',
    color: '#1a73e8',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'p2',
    teamId: 't1',
    name: 'Marcos',
    number: 4,
    position: 'DF',
    color: '#1a73e8',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'p3',
    teamId: 't1',
    name: 'Pau',
    number: 10,
    position: 'MF',
    color: '#c0392b',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

async function seedRoster(page: Page): Promise<void> {
  await page.addInitScript(
    (data: { team: unknown; players: unknown[] }) => {
      if (localStorage.getItem('entrenolab:seeded')) return;
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:teams', JSON.stringify([data.team]));
      localStorage.setItem('entrenolab:players', JSON.stringify(data.players));
      localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
      localStorage.setItem('entrenolab:folders', JSON.stringify([]));
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    },
    { team: TEAM, players: PLAYERS },
  );
}

const rows = (page: Page) => page.locator('.data-table tbody tr');

async function openEditor(page: Page, name: string): Promise<void> {
  await page.locator('button', { hasText: 'Añadir jugador' }).click();
  await page.locator('.modal input[name="name"]').fill(name);
}

test.describe('Lote C3 — Plantilla: validación', () => {
  test('rechaza un dorsal repetido y NO guarda al jugador', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedRoster(page);
    await page.goto('/team');
    await expect(rows(page)).toHaveCount(3);

    await openEditor(page, 'Repetido');
    await page.locator('.modal input[name="number"]').fill('10'); // Pau ya lleva el 10
    await page.locator('.modal button', { hasText: 'Guardar' }).click();

    await expect(page.locator('.modal .form-error')).toBeVisible();
    await expect(page.locator('.modal .form-error')).toContainText('El dorsal 10 ya lo lleva Pau');
    // El modal sigue abierto y NO se ha creado nada.
    await expect(page.locator('.modal')).toBeVisible();
    await page.locator('.modal button', { hasText: 'Cancelar' }).click();
    await expect(rows(page)).toHaveCount(3);
  });

  test('rechaza un dorsal fuera del 1–99', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedRoster(page);
    await page.goto('/team');

    await openEditor(page, 'Cien');
    await page.locator('.modal input[name="number"]').fill('100');
    await page.locator('.modal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('.modal .form-error')).toContainText('del 1 al 99');

    await page.locator('.modal input[name="number"]').fill('0');
    await page.locator('.modal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('.modal .form-error')).toContainText('del 1 al 99');
    await expect(rows(page)).toHaveCount(3);
  });

  test('rechaza un jugador SIN posición', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedRoster(page);
    await page.goto('/team');

    await openEditor(page, 'Sin puesto');
    await page.locator('.modal select[name="position"]').selectOption('');
    await page.locator('.modal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('.modal .form-error')).toContainText('Elige una posición');
    await expect(rows(page)).toHaveCount(3);
  });

  test('guarda un jugador válido y lo muestra en la tabla', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedRoster(page);
    await page.goto('/team');

    await openEditor(page, 'Nuevo');
    await page.locator('.modal input[name="number"]').fill('7');
    await page.locator('.modal select[name="position"]').selectOption('FW');
    await page.locator('.modal button', { hasText: 'Guardar' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator('.data-table tbody')).toContainText('Nuevo');
  });
});

test.describe('Lote C3 — Plantilla: filtros', () => {
  test('buscador, filtro por posición y contador', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedRoster(page);
    await page.goto('/team');
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator('.roster-filters .result-count')).toContainText('3 jugadores');

    // Buscar por nombre.
    await page.locator('.roster-filters input').fill('pau');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('.roster-filters .result-count')).toContainText('1 jugador');
    await expect(page.locator('.roster-filters .result-count')).toContainText('de 3');
    await expect(page.locator('.data-table tbody')).toContainText('Pau');

    // Buscar por DORSAL.
    await page.locator('.roster-filters input').fill('4');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('.data-table tbody')).toContainText('Marcos');

    // Limpiar y filtrar por posición.
    await page.locator('.roster-filters .search-clear').click();
    await expect(rows(page)).toHaveCount(3);
    await page.locator('.roster-filters select').selectOption('DF');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('.data-table tbody')).toContainText('Marcos');

    // Un filtro sin resultados explica qué hacer y "Limpiar filtros" lo deshace.
    await page.locator('.roster-filters input').fill('zzz');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('.empty-title')).toContainText('Ningún jugador con esos filtros');
    await page.locator('.roster-filters button', { hasText: 'Limpiar filtros' }).click();
    await expect(rows(page)).toHaveCount(3);
  });
});
