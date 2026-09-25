import { test, expect, Page } from '@playwright/test';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

// CONTRATO ACTUALIZADO: la pizarra se abre desde Biblioteca, no desde la barra inferior; quedan
// TRES destinos + «Más», y
// «Miembros» vive DENTRO de «Más» (requisito explícito del encargo). Antes eran cinco enlaces con
// Miembros en la barra; el quinto label de la barra es ahora «Más» y Miembros se comprueba en la
// hoja (ver el test siguiente). El contrato anterior dejó de ser válido porque la barra superior y
// su reparto de destinos cambiaron a propósito.
const NAV_LABELS = ['Plantilla', 'Biblioteca', 'Sesiones', 'Más'];

for (const [W, H] of [
  [360, 800],
  [390, 844],
] as const) {
  test.describe(`Barra de navegación móvil ${W}×${H}`, () => {
    test('«Miembros» vive dentro de «Más», no en la barra inferior', async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await page.goto('/team');
      // Ya no hay un enlace de Miembros en la barra…
      await expect(page.locator('.nav-movil .nav-item', { hasText: 'Miembros' })).toHaveCount(0);
      // …y sí una acción de Miembros dentro de la hoja «Más».
      await page.locator('.nav-mas').click();
      await expect(page.locator('.cuenta-panel')).toBeVisible();
      await expect(
        page.locator('.cuenta-panel .cuenta-accion', { hasText: 'Miembros' }),
      ).toHaveCount(1);
    });
    test('cada etiqueta de navegación está completa (sin recorte) y la ruta activa está marcada', async ({
      page,
    }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await page.goto('/team');
      await expect(page.locator('.nav-movil')).toBeVisible();

      const items = await page.evaluate((labels: string[]) => {
        const out: Array<{
          label: string;
          width: number;
          clipLeft: number;
          clipRight: number;
          visible: boolean;
        }> = [];
        for (const item of Array.from(
          document.querySelectorAll<HTMLElement>('.nav-movil .nav-item'),
        )) {
          const label = item.querySelector<HTMLElement>('.nav-label');
          if (!label) continue;
          const lb = label.getBoundingClientRect();
          const ib = item.getBoundingClientRect();
          const cs = getComputedStyle(label);
          out.push({
            label: label.textContent?.trim() ?? '',
            width: lb.width,
            clipLeft: Math.max(0, ib.left - lb.left),
            clipRight: Math.max(0, lb.right - ib.right),
            visible: cs.display !== 'none' && cs.visibility !== 'hidden' && lb.width > 0,
          });
        }
        return out;
      }, NAV_LABELS);

      expect(items.length).toBe(NAV_LABELS.length);
      for (const label of NAV_LABELS) {
        const it = items.find((i) => i.label === label)!;
        expect(it, `etiqueta ${label} presente`).toBeTruthy();
        expect(it.visible, `${label} visible`).toBe(true);
        expect(it.width, `${label} con ancho`).toBeGreaterThan(20);
        expect(it.clipLeft, `${label} recortada por la izquierda`).toBeLessThanOrEqual(1);
        expect(it.clipRight, `${label} recortada por la derecha`).toBeLessThanOrEqual(1);
      }

      // La ruta activa (Plantilla → /team) está marcada de forma inequívoca.
      const activeText = (
        await page.locator('.nav-movil .nav-item.nav-active .nav-label').textContent()
      )?.trim();
      expect(activeText).toBe('Plantilla');
      const activeCount = await page.locator('.nav-movil .nav-item.nav-active').count();
      expect(activeCount).toBe(1);
    });
  });
}
