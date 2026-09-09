// =============================================================
// B1 — los nuevos tipos colocables del catálogo (Portería grande,
// Barrera de maniquíes) aparecen en el panel de Material y se colocan.
// =============================================================
import { test, expect, Page } from '@playwright/test';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
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
  // Los hints están suprimidos por el seed; el pequeño settle evita que un hint
  // residual tape el campo antes de cerrarlo.
  await page.waitForTimeout(150);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
}

test.setTimeout(90_000);

test.describe('B1 — catálogo con tipos colocables', () => {
  test('la Portería grande (goal) y la Barrera de maniquíes (mannequin_row) aparecen y se colocan', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    let n = 0;
    for (const [title, elType] of [
      ['Portería grande', 'goal'],
      ['Barrera de maniquíes', 'mannequin_row'],
    ] as Array<[string, string]>) {
      n++;
      // FASE B (paneles persistentes): abrir la categoría Material es IDEMPOTENTE. Si el panel
      // ya está desplegado (ya no se cierra al elegir un material) no lo re-togglea, porque
      // re-clickear el mismo .tools-cat lo cerraría y rompería la siguiente colocación.
      if (!(await page.locator('.side-panel-left.tools-panel-side').isVisible().catch(() => false))) {
        await page.locator('.tools-cat', { hasText: 'Material' }).click();
      }
      const btn = page.locator(`.rail-btn[title="${title}"]`);
      await expect(btn, `el material "${title}" está en el panel`).toBeVisible();
      await btn.click();
      const box = (await page.locator('.board-host').boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
      await expect(page.locator('.field-count'), `al colocar "${title}" sube el contador`).toHaveText(String(n));
      // El render lo dibuja como <g> vectorial de ese tipo.
      await expect.poll(() => page.locator(`.board-canvas svg g[data-el-type="${elType}"]`).count(), { timeout: 4000 }).toBeGreaterThanOrEqual(1);
      // Volver a Seleccionar (deselecciona y cierra Propiedades) para la siguiente colocación.
      await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    }
  });
});
