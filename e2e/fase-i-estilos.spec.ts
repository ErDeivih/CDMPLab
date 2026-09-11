// =============================================================
// LOTE D — CSS consolidado: comprobación de que NO cambió nada visible.
//
// Se movieron a `styles.scss` la base de los modales (.modal-backdrop/.modal/.modal-head/
// .modal-body/.modal-foot), `.field-row` y los botones (.btn y variantes), que estaban
// copiados en app.scss, roster, library, sessions y confirm-dialog. Aquí se comprueba con
// estilos COMPUTADOS que cada modal conserva lo suyo (ancho, scroll) y que los botones
// siguen pintándose igual desde la regla global.
// =============================================================
import { test, expect, Page } from '@playwright/test';

const TEAM = {
  id: 't1',
  name: 'Primer Equipo',
  accentColor: '#3056d3',
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function seed(page: Page): Promise<void> {
  await page.addInitScript((team: unknown) => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem(
      'entrenolab:exercises',
      JSON.stringify([
        {
          id: 'x1',
          teamId: 't1',
          folderId: null,
          title: 'Uno',
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
          savedAt: '2026-01-01T10:00:00.000Z',
        },
      ]),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, TEAM);
}

/** Propiedades computadas de un elemento. */
async function css(page: Page, selector: string, props: string[]): Promise<Record<string, string>> {
  return page
    .locator(selector)
    .first()
    .evaluate((el, list) => {
      const s = getComputedStyle(el);
      return Object.fromEntries((list as string[]).map((p) => [p, s.getPropertyValue(p)]));
    }, props);
}

test.describe('Lote D — CSS consolidado', () => {
  test('cada modal conserva su base (fondo, cabecera, pie) y lo suyo (ancho, scroll)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);

    // Biblioteca: 480 px y cuerpo con scroll.
    await page.goto('/library');
    await page.locator('button', { hasText: 'Crear ejercicio' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();
    expect((await css(page, '.modal', ['width'])).width).toBe('480px');
    expect((await css(page, '.modal-body', ['overflow-y']))['overflow-y']).toBe('auto');
    // La base viene de la regla GLOBAL: cabecera con borde inferior y pie con borde superior.
    expect((await css(page, '.modal-head', ['border-bottom-width']))['border-bottom-width']).toBe(
      '1px',
    );
    expect((await css(page, '.modal-foot', ['border-top-width']))['border-top-width']).toBe('1px');
    // El fondo del modal (z-index 50) es el global.
    expect((await css(page, '.modal-backdrop', ['position', 'z-index'])).position).toBe('fixed');
    expect((await css(page, '.modal-backdrop', ['z-index']))['z-index']).toBe('50');
    await page.locator('.modal-foot button', { hasText: 'Cancelar' }).click();

    // Plantilla: modal más ESTRECHO (420), override del componente.
    await page.goto('/team');
    await page.locator('button', { hasText: 'Añadir jugador' }).click();
    await expect(page.locator('.modal')).toBeVisible();
    expect((await css(page, '.modal', ['width'])).width, 'Plantilla mantiene su ancho propio').toBe(
      '420px',
    );
    await page.locator('.modal-foot button', { hasText: 'Cancelar' }).click();

    // Sesiones: 640 (modal-lg) con el cuerpo scrolleable.
    await page.goto('/sessions');
    await page.locator('button', { hasText: 'Nueva sesión' }).click();
    await expect(page.locator('.modal-lg')).toBeVisible();
    expect((await css(page, '.modal-lg', ['width'])).width).toBe('640px');
    expect((await css(page, '.modal-lg', ['max-height']))['max-height']).not.toBe('none');
  });

  test('los botones siguen pintándose igual desde la regla global', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);

    // Ajustes (app shell): botón normal del sistema.
    await page.goto('/library');
    await page.locator('button[aria-label="Ajustes"]').click();
    const row = page.locator('.settings-row', { hasText: 'Exportar respaldo' }).locator('button');
    const btn = await css(page, '.settings-row button', [
      'height',
      'cursor',
      'border-radius',
      'font-size',
    ]);
    expect(btn.height).toBe('36px');
    expect(btn.cursor, 'los botones son clicables (cursor de mano)').toBe('pointer');
    expect(btn['border-radius']).not.toBe('0px');
    expect(btn['font-size']).toBe('14px');
    await expect(row).toBeVisible();
    await page.keyboard.press('Escape');

    // La Biblioteca conserva SU variante pequeña (28 px), que es una diferencia a propósito.
    const sm = await css(page, '.ex-card .btn-sm', ['height']);
    expect(sm.height, 'la variante pequeña de la Biblioteca sigue en 28 px').toBe('28px');

    // Barra de confirmación: botones del diálogo (la copia local se eliminó).
    await page.locator('.ex-card .ex-more-btn').first().click();
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    await expect(page.locator('.confirm')).toBeVisible();
    const confirmBtn = await css(page, '.confirm-actions .btn', ['height', 'cursor']);
    expect(confirmBtn.height).toBe('36px');
    expect(confirmBtn.cursor).toBe('pointer');
  });
});
