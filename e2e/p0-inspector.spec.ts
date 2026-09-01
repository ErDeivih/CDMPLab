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

test.describe('Botones del inspector en panel oscuro', () => {
  test('son legibles (contraste AA), visibles y con nombre accesible', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto('/board');

    // Colocar un material (cono) que se auto-selecciona y abre el inspector.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.inspector-actions')).toBeVisible();

    const results = await page.evaluate(() => {
      const lumC = (r: number, g: number, b: number): number => {
        const f = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const toRgb = (s: string): [number, number, number] | null => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map((x) => parseFloat(x));
        return [p[0], p[1], p[2]];
      };
      const contrast = (a: [number, number, number], b: [number, number, number]): number => {
        const L1 = lumC(...a);
        const L2 = lumC(...b);
        const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
        return (hi + 0.05) / (lo + 0.05);
      };
      return Array.from(document.querySelectorAll<HTMLElement>('.inspector-actions button')).map((btn) => {
        const cs = getComputedStyle(btn);
        const col = toRgb(cs.color);
        const bg = toRgb(cs.backgroundColor);
        const rect = btn.getBoundingClientRect();
        const name = btn.getAttribute('aria-label') || (btn.textContent ?? '').trim();
        return {
          name,
          text: (btn.textContent ?? '').trim(),
          color: cs.color,
          background: cs.backgroundColor,
          contrast: col && bg ? contrast(col, bg) : 0,
          visible: rect.width > 0 && rect.height > 0,
        };
      });
    });

    // Fase 3: el inspector NO contiene Duplicar/Eliminar (viven en la barra de contexto,
    // que se abre por pulsación larga). Solo quedan las acciones generales.
    const names = results.map((r) => r.name);
    expect(names, 'no hay Duplicar en el inspector (Fase 3)').not.toContain('Duplicar');
    expect(names, 'no hay Eliminar en el inspector (Fase 3)').not.toContain('Eliminar');
    const general = ['Bloquear', 'Desbloquear', 'Traer adelante', 'Enviar atrás'];
    const presentGeneral = general.filter((g) => names.some((n) => n.includes(g)));
    expect(presentGeneral.length, 'quedan las acciones generales').toBeGreaterThanOrEqual(3);
    for (const r of results) {
      expect(r.name, `botón sin nombre accesible (color=${r.color} bg=${r.background})`).toBeTruthy();
      expect(r.visible, `${r.name} debe ser visible`).toBe(true);
      expect(r.contrast, `contraste insuficiente de "${r.name}": ${r.contrast.toFixed(2)} (color=${r.color} bg=${r.background})`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
