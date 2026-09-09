// =============================================================
// BLOQUE A / A5 — el guardado se BLOQUEA cuando el título está vacío.
//
// "Nueva pizarra" es SOLO el placeholder: la fuente real del título empieza
// vacía. Al intentar guardar sin título:
//   - se muestra el aviso,
//   - se detiene el guardado (no se crea ningún ejercicio con title:''),
//   - el usuario se queda en la pizarra (no navega a /library),
//   - no se marca como guardado,
//   - se abre/enfoca el campo de título.
// La descarga de PNG NO requiere título (el guardado del ejercicio sí).
//
// Fuente de verdad: el modelo en localStorage (`entrenolab:exercises`) y la
// URL (debe permanecer en /board).
// =============================================================
import { test, expect, Page } from '@playwright/test';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // Pequeño settle para que los hints flotantes (help/fill) aparezcan y poder cerrarlos;
  // sin él, a veces quedan tapando el campo y rompen los clics siguientes.
  await page.waitForTimeout(200);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
}

async function placeCone(page: Page, nx: number, ny: number): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  const box = (await page.locator('.board-host').boundingBox())!;
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
}

function exercisesCount(page: Page): Promise<number> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]').length);
}

test.setTimeout(90_000);

test.describe('A5 — guardado bloqueado sin título', () => {
  test('nuevo ejercicio: guardar sin título se bloquea, avisa, se queda en /board y no crea ejercicio', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await placeCone(page, 0.4, 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');

    await page.locator('.chip-icon-primary').click();

    // No navega a /library y no crea ningún ejercicio.
    await expect(page).toHaveURL(/\/board/);
    expect(await exercisesCount(page), 'no se crea ningún ejercicio sin título').toBe(0);
    // Aviso visible.
    await expect(page.locator('.board-notice')).toHaveText(/título/i);
    // Se abre el panel de Propiedades con el campo de título enfocado.
    await expect(page.locator('.studio-panel')).toBeVisible();
    await expect(page.locator('input[aria-label="Título del ejercicio"]')).toBeFocused();
  });

  test('Pon un título y ya se guarda; "Nueva pizarra" es solo placeholder', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await placeCone(page, 0.4, 0.5);

    await page.locator('.chip-icon-primary').click();
    await expect(page.locator('.studio-panel input[aria-label="Título del ejercicio"]')).toBeVisible();
    await page.locator('.studio-panel input[aria-label="Título del ejercicio"]').fill('Con solo título');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    expect(await exercisesCount(page)).toBe(1);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0]);
    expect(saved.title).toBe('Con solo título');
  });

  test('limpiar la pizarra deja el título vacío y vuelve a bloquear el guardado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await placeCone(page, 0.4, 0.5);
    // Poner título y guardar con éxito.
    await page.locator('.chip-icon-primary').click();
    await page.locator('.studio-panel input[aria-label="Título del ejercicio"]').fill('Para limpiar');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    // Reabrir un ejercicio existente.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.board-host')).toBeVisible();
    // Vaciar la pizarra → el título se vacía.
    await page.locator('button[aria-label="Más"]').click();
    await page.locator('.rail-btn[title="Limpiar pizarra"]').click();
    await page.getByRole('alertdialog', { name: 'Vaciar pizarra' }).getByRole('button', { name: 'Vaciar' }).click();
    await expect(page.locator('.field-count')).toHaveText('0');
    await page.locator('.chip-icon-primary').click();
    await expect(page).toHaveURL(/\/board/);
    expect(await exercisesCount(page), 'tras vaciar no se guarda sin título').toBe(1); // conserva el ejercicio previo
  });

  test('borrador IA con título vacío tampoco guarda', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    // Abrir la composición IA con un borrador que NO define título.
    await page.goto('/board/draft');
    await expect(page.locator('.board-host')).toBeVisible();
    await page.waitForTimeout(200);
    if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
    // El campo de título (si el draft no lo define) queda vacío → guardar se bloquea.
    await page.locator('.chip-icon-primary[aria-label="Guardar"]').click();
    await expect(page).toHaveURL(/\/board/);
    expect(await exercisesCount(page), 'un borrador sin título no se guarda').toBe(0);
  });

  test('descargar PNG NO requiere título (el guardado del ejercicio sí lo requiere)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await placeCone(page, 0.4, 0.5);
    const dlPromise = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await page.locator('.rail-btn[title="Descargar PNG"]').click();
    const dl = await dlPromise;
    expect(dl.suggestedFilename()).toMatch(/\.png$/i);
  });
});
