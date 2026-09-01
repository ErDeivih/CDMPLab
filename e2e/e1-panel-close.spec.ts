import { test, expect, Page } from '@playwright/test';

const SHOTS = 'e2e/shots';

/**
 * Regresión del panel Propiedades: la X debe cerrarlo en UN toque y CONSERVAR la
 * selección. Antes, `showPropsPanel()` se mostraba también con solo existir un
 * elemento seleccionado; si `panelOpen` quedaba en `false` (p. ej. tras el baile
 * de "un solo panel principal" en móvil), el botón X (que usaba `togglePanel()`)
 * volvía a ABRIR el panel en vez de cerrarlo: hacían falta dos toques.
 */

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** La selección de un elemento se dibuja en el SVG del campo con este azul. */
const SELECTION_MARKER = '.board-canvas svg [stroke="#2563eb"]';

/** Coloca un texto en el CENTRO del campo. Re-captura el host justo antes del clic:
 *  en móvil el host se redimensiona/mueve al abrir el panel de herramientas. */
async function placeTextAtCenter(page: Page): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Texto"]').click();
  const box = (await page.locator('.board-host').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
}

test.describe('Panel Propiedades: la X cierra en un toque y conserva la selección', () => {
  for (const [W, H] of [
    [360, 800],
    [390, 844],
    [430, 932],
    [1366, 900],
  ] as const) {
    test(`a ${W}×${H}`, async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await page.goto('/board');
      await expect(page.locator('.board-host')).toBeVisible();

      // Al crear el texto se auto-abre Propiedades con el inspector del elemento, PERO
      // solo en escritorio. En móvil (≤700px) la creación NO abre el panel (regresión
      // cubierta por `e1-mobile-props`): se abre explícitamente con el botón Propiedades
      // para poder comprobar que la X lo cierra en un toque conservando la selección.
      await placeTextAtCenter(page);
      await expect(page.locator('.field-count')).toHaveText('1');
      if (W <= 700) {
        // Móvil: la creación no auto-abre el panel → lo abrimos con el disparador explícito.
        await page.locator('button[aria-label="Propiedades"]').click();
      }
      await expect(page.locator('.studio-panel')).toBeVisible();
      const ta = page.locator('.studio-panel .inspector textarea');
      await expect(ta).toBeVisible();
      await expect(ta).toHaveValue('Texto');
      // El objeto queda marcado/seleccionado en el campo.
      await expect(page.locator(SELECTION_MARKER)).not.toHaveCount(0);

      // UN toque en la X del panel.
      await page.locator('.studio-panel .panel-close').click();

      // El panel queda oculto de verdad...
      await expect(page.locator('.studio-panel')).toHaveCount(0);
      // ...y la selección sigue viva: el objeto existe y continúa marcado en el campo.
      await expect(page.locator('.field-count')).toHaveText('1');
      await expect(page.locator(SELECTION_MARKER)).not.toHaveCount(0);

      // Reabrir con el disparador Propiedades: vuelve a mostrar el MISMO objeto.
      await page.locator('button[aria-label="Propiedades"]').click();
      await expect(page.locator('.studio-panel')).toBeVisible();
      const taReopened = page.locator('.studio-panel .inspector textarea');
      await expect(taReopened).toBeVisible();
      await expect(taReopened).toHaveValue('Texto');
      await expect(page.locator('.field-count')).toHaveText('1');

      if (W === 390 && H === 844) {
        // Captura: panel cerrado con el objeto todavía seleccionado en el campo.
        await page.locator('.studio-panel .panel-close').click();
        await expect(page.locator('.studio-panel')).toHaveCount(0);
        await expect(page.locator(SELECTION_MARKER)).not.toHaveCount(0);
        await page.screenshot({ path: `${SHOTS}/panel-close-mobile.png`, fullPage: false });
      }
    });
  }
});
