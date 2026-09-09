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

/** Comprueba que una fila de menú muestra icono + texto completo, con altura tácil ≥44. */
async function expectRowFull(page: Page, row: { locator: string; label: string }): Promise<void> {
  const r = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: 'no row' };
    const label = el.querySelector('.rail-label') as HTMLElement | null;
    if (!label) return { ok: false, why: 'no label' };
    const btn = el.getBoundingClientRect();
    const lb = label.getBoundingClientRect();
    const cs = getComputedStyle(label);
    return {
      ok: true,
      labelText: label.textContent?.trim() ?? '',
      btnWidth: btn.width,
      btnHeight: btn.height,
      labelWidth: lb.width,
      display: cs.display,
      visibility: cs.visibility,
      overflow: label.scrollWidth - label.clientWidth,
    };
  }, row.locator);
  expect(r.ok, `fila no encontrada: ${row.locator}`).toBe(true);
  expect(r!.labelText).toBe(row.label);
  expect(r!.btnHeight, `altura táctil de ${row.locator}`).toBeGreaterThanOrEqual(44);
  // La fila ocupa el ancho disponible (no es un cuadrado 44×44).
  expect(r!.btnWidth, `ancho de ${row.locator}`).toBeGreaterThan(120);
  // La etiqueta se ve (no display:none / visibility:hidden / width:0).
  expect(r!.display).not.toBe('none');
  expect(r!.visibility).not.toBe('hidden');
  expect(r!.labelWidth).toBeGreaterThan(0);
  // El texto no se trunca (sin desbordamiento horizontal notable).
  expect(r!.overflow, `texto truncado en ${row.locator}`).toBeLessThanOrEqual(1);
}

async function viewportAndOpen(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await seed(page);
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
}

for (const [W, H] of [
  [390, 844],
  [360, 800],
] as const) {
  test.describe(`Menús móviles ${W}×${H}`, () => {
    test('Material: filas con icono + texto completo, panel con scroll y todas las categorías', async ({ page }) => {
      await viewportAndOpen(page, W, H);
      // La ayuda inicial fue retirada por el dueño (decisión Fase 1): no hay banner
      // que cerrar, así que abrimos directamente el panel de Material.
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();

      // Todas las filas de Material muestran su texto completo.
      const rows = await page.locator('.side-panel-left .rail-btn.rail-row').count();
      expect(rows).toBeGreaterThan(5);
      for (const title of ['Balón', 'Cono', 'Miniportería', 'Minitrampolín', 'Fitball']) {
        // La fila existe y su etiqueta es legible (se consulta por el título de la fila).
        const row = page.locator(`.side-panel-left .rail-btn.rail-row[title="${title}"]`).first();
        await expect(row, `fila ${title}`).toBeVisible();
      }
      // Comprobar una fila concreta: icono + texto, altura, sin truncado.
      await expectRowFull(page, {
        locator: '.side-panel-left .rail-btn.rail-row[title="Miniportería"]',
        label: 'Miniportería',
      });

      // El panel hace scroll: bajamos hasta la última categoría y se ve.
      await page.evaluate(() => {
        const p = document.querySelector('.side-panel-left') as HTMLElement;
        if (p) p.scrollTop = p.scrollHeight;
      });
      await expect(page.locator('.tools-material-group-title', { hasText: 'Preparación física' })).toBeVisible();

      // Clic en una fila funciona: elegir "Balón" y colocarlo en el campo.
      await page.locator('.side-panel-left .rail-btn.rail-row[title="Balón"]').first().click();
      // FASE B (paneles persistentes): el panel Material permanece abierto tras armar el Balón
      // y, en móvil vertical, tapa el centro del campo. Se cierra con su X (no desarma la
      // colocación) antes de hacer tap en el campo para poder colocarlo.
      await page.locator('.side-panel-left .panel-close').click();
      const box = (await page.locator('.board-host').boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await expect(page.locator('.field-count')).toHaveText('1');
    });

    test('Exportar: "Descargar PNG" y "Opciones de exportación" con etiqueta, y clic funciona', async ({ page }) => {
      await viewportAndOpen(page, W, H);
      await page.locator('button[aria-label="Exportar"]').click();
      await expect(page.locator('.top-pop-export')).toBeVisible();
      await expectRowFull(page, { locator: '.top-pop-export .rail-btn.rail-row[title="Descargar PNG"]', label: 'Descargar PNG' });
      await expectRowFull(page, { locator: '.top-pop-export .rail-btn.rail-row[title="Exportar con opciones (PNG)"]', label: 'Opciones de exportación…' });
      // El clic en la fila abre el diálogo de exportación.
      await page.locator('.top-pop-export .rail-btn.rail-row[title="Exportar con opciones (PNG)"]').click();
      await expect(page.locator('.export')).toBeVisible();
    });

    test('Más: solo Limpiar pizarra, sin Ayuda ni GIF/animación', async ({ page }) => {
      await viewportAndOpen(page, W, H);
      await page.locator('button[aria-label="Más"]').click();
      await expect(page.locator('.top-pop-mas')).toBeVisible();
      // La opción "Ayuda" fue RETIRADA por decisión del dueño (ruido): no debe existir.
      await expect(page.locator('.top-pop-mas .rail-btn.rail-row[title="Ayuda"]')).toHaveCount(0);
      await expect(page.locator('.top-pop-mas [aria-label="Ayuda"]')).toHaveCount(0);
      await expectRowFull(page, { locator: '.top-pop-mas .rail-btn.rail-row[title="Limpiar pizarra"]', label: 'Limpiar pizarra' });
      // No debe haber nada de animación/GIF.
      await expect(page.locator('.top-pop-mas', { hasText: /GIF|Animación|anim/i })).toHaveCount(0);
      // Tampoco debe existir el banner de ayuda inicial.
      await expect(page.locator('.board-help')).toHaveCount(0);
    });
  });
}
