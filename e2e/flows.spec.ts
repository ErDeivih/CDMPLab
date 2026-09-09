import { test, expect, Page } from '@playwright/test';
import { fillBoardTitle } from './gesture-helpers';

// Sembramos un equipo con jugadores en localStorage para que los flujos
// sean deterministas (la app arranca con ese equipo activo).
async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Solo sembramos una vez por contexto; no re-empezar en cada navegación.
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    const players = [
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
      { id: 'p3', teamId: 't1', name: 'Adrián', number: 7, position: 'FW', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p4', teamId: 't1', name: 'Dani', number: 1, position: 'GK', color: '#1a73e8', active: true, createdAt: now },
    ];
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

test.describe('EntrenoLab flujos', () => {
  test('plantilla muestra el equipo y sus jugadores', async ({ page }) => {
    await seed(page);
    await page.goto('/team');
    await expect(page.getByText('Primer Equipo', { exact: true })).toBeVisible();
    await expect(page.getByText('Marcos')).toBeVisible();
    await expect(page.getByText('Pau')).toBeVisible();
  });

  test('coloca un jugador en la pizarra y guarda en la biblioteca', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await expect(page.locator('.studio')).toBeVisible();

    // Estado inicial: 0 elementos.
    await expect(page.locator('.field-count')).toHaveText('0');

    // Colocamos un jugador desde el panel Jugadores (izquierda, antes abierto por defecto).
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .roster-item').first().click();
    // Tocar un jugador ARMA la colocación (no coloca aún). FASE B: el panel permanece abierto.
    await expect(page.locator('.field-count')).toHaveText('0');
    // El siguiente clic sobre el campo coloca al jugador en esa posición.
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');

    // La pizarra es estática (sin animación): guardamos directamente.
    await fillBoardTitle(page, 'Flows');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await expect(page.locator('.ex-card')).toHaveCount(1);
  });

  test('crea una tarea desde la biblioteca y pasa a la pizarra', async ({ page }) => {
    await seed(page);
    await page.goto('/library');
    await page.getByText('Crear tarea').first().click();
    const titleInput = page.locator('.modal input[name="title"]');
    await titleInput.fill('Rondos de pase');
    await page.getByText('Diseñar').click();
    await page.waitForURL('**/board');
    await expect(page.locator('.studio')).toBeVisible();
  });

  test('crea una sesión con un ejercicio de la biblioteca', async ({ page }) => {
    await seed(page);
    // Pre-creamos un ejercicio en la biblioteca.
    await page.goto('/library');
    await page.getByText('Crear tarea').first().click();
    await page.locator('.modal input[name="title"]').fill('Posesión 5x5');
    await page.getByText('Guardar').click();
    await expect(page.locator('.ex-card')).toHaveCount(1);

    // Vamos a sesiones y creamos una con ese ejercicio.
    await page.goto('/sessions');
    await page.getByText('Nueva sesión').click();
    await page.locator('.modal input[name="title"]').fill('Sesión de posesión');
    await page.getByText('Añadir ejercicio').click();
    await page.locator('.picker-item').first().click();
    await expect(page.locator('.task')).toHaveCount(1);
    await page.getByText('Guardar sesión').click();
    await expect(page.getByText('Sesión de posesión')).toBeVisible();
  });
});
