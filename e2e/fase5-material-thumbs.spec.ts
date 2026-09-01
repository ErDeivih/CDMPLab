import { test, expect, Page } from '@playwright/test';

const seed = () => {
  return `(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([{ id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now }]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  })()`;
};

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

test.describe('Fase 5 — miniaturas REALES de todos los materiales (sin icono genérico)', () => {
  for (const title of ['Escritorio']) {
    test(`${title}: cada material muestra un <img> PNG o un <svg> gráfico real, nunca el símbolo genérico`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.addInitScript(seed());
      await openClosed(page);

      // Abrir el panel Material.
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      const panel = page.locator('.side-panel-left.tools-panel-side');
      await expect(panel).toBeVisible();

      // Cada fila de material tiene una miniatura dentro de `.mat-thumb`.
      const cards = panel.locator('.tools-material-card');
      const n = await cards.count();
      expect(n, 'hay materiales en el panel').toBeGreaterThan(0);

      const failed: string[] = [];
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        const label = await card.locator('.rail-label').textContent();
        const thumb = card.locator('.mat-thumb');
        await expect(thumb, `miniatura presente en "${label}"`).toHaveCount(1);
        const hasImg = await thumb.locator('img').count();
        const hasSvg = await thumb.locator('svg.mat-thumb-svg').count();
        const hasIcon = await thumb.locator('span.msi').count();
        // Debe haber un recurso gráfico real (PNG o SVG del render) y NO un icono de fuente.
        if (!hasImg && !hasSvg) failed.push(`${label} (sin img/svg)`);
        if (hasIcon && !hasSvg) failed.push(`${label} (usa icono de fuente)`);
      }
      expect(failed, `materiales con miniatura NO real: ${failed.join(', ')}`).toHaveLength(0);

      // Al menos un PNG y al menos un SVG vectorial (ambas familias presentes).
      const totalImg = await panel.locator('.mat-thumb img').count();
      const totalSvg = await panel.locator('.mat-thumb svg.mat-thumb-svg').count();
      expect(totalImg, 'hay al menos una miniatura PNG').toBeGreaterThan(0);
      expect(totalSvg, 'hay al menos una miniatura SVG vectorial').toBeGreaterThan(0);
    });
  }

  test('la miniatura SVG vectorial se dibuja de verdad (no vacía) y es reconocible', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed());
    await openClosed(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    const panel = page.locator('.side-panel-left.tools-panel-side');
    await expect(panel).toBeVisible();

    // El Fitball es vectorial y debe tener un <svg.mat-thumb-svg> con un <circle>.
    const fitball = panel.locator('.tools-material-card', { hasText: 'Fitball' }).first();
    const svg = fitball.locator('svg.mat-thumb-svg');
    await expect(svg).toHaveCount(1);
    // Dentro del SVG hay al menos un elemento gráfico (circle/path/rect).
    const nShapes = await svg.locator('circle, path, rect, text').count();
    expect(nShapes, 'el SVG vectorial dibuja una forma real').toBeGreaterThan(0);
  });
});
