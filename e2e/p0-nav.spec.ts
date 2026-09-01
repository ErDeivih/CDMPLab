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

const NAV_LABELS = ['Plantilla', 'Pizarra', 'Biblioteca', 'Sesiones', 'Miembros'];

for (const [W, H] of [
  [360, 800],
  [390, 844],
] as const) {
  test.describe(`Barra de navegación móvil ${W}×${H}`, () => {
    test('cada etiqueta de navegación está completa (sin recorte) y la ruta activa está marcada', async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await page.goto('/team');
      await expect(page.locator('.nav')).toBeVisible();

      const items = await page.evaluate((labels: string[]) => {
        const out: Array<{ label: string; width: number; clipLeft: number; clipRight: number; visible: boolean }> = [];
        for (const item of Array.from(document.querySelectorAll<HTMLElement>('.nav .nav-item'))) {
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
      const activeText = (await page.locator('.nav-item.nav-active .nav-label').textContent())?.trim();
      expect(activeText).toBe('Plantilla');
      const activeCount = await page.locator('.nav-item.nav-active').count();
      expect(activeCount).toBe(1);
    });
  });
}
