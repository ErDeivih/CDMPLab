import { test, expect, Page } from '@playwright/test';

const seed = () => `(() => {
  if (localStorage.getItem('entrenolab:seeded')) return;
  const now = new Date().toISOString();
  localStorage.setItem('entrenolab:seeded', '1');
  localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
  localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
  localStorage.setItem('entrenolab:folders', JSON.stringify([]));
  localStorage.setItem('entrenolab:exercises', JSON.stringify([{ id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now }]));
  localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
})()`;

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

test.describe('Fase 1 — el escudo CDM Pizarrales es pequeño y vive dentro de la cabecera', () => {
  for (const [w, h] of [[1366, 900], [360, 800], [390, 844]] as Array<[number, number]>) {
    test(`[${w}x${h}] el escudo tiene tamaño pequeño y NO invade cabecera/campo/paneles`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(seed());
      await openClosed(page);

      const shield = page.locator('.studio-top .brand-shield');
      await expect(shield).toHaveCount(1);
      const sb = (await shield.boundingBox())!;
      expect(sb, 'el escudo debe estar renderizado').not.toBeNull();

      // Dimensiones pequeñas y explícitas (jamás el tamaño natural 512px del PNG).
      expect(sb.width, 'ancho del escudo').toBeLessThanOrEqual(40);
      expect(sb.height, 'alto del escudo').toBeLessThanOrEqual(40);

      // Debe estar DENTRO de la cabecera (".studio-top").
      const header = await page.locator('.studio-top').boundingBox();
      expect(sb.x, 'escudo dentro de la cabecera (izquierda)').toBeGreaterThanOrEqual(header!.x);
      expect(sb.x + sb.width, 'escudo dentro de la cabecera (derecha)').toBeLessThanOrEqual(header!.x + header!.width + 1);
      expect(sb.y, 'escudo dentro de la cabecera (arriba)').toBeGreaterThanOrEqual(header!.y);
      expect(sb.y + sb.height, 'escudo dentro de la cabecera (abajo)').toBeLessThanOrEqual(header!.y + header!.height + 1);

      // No debe solaparse con el campo (el ancho del escudo es mínimo y el campo empieza
      // por debajo de la cabecera).
      const field = await page.locator('.entrenolab-grass').boundingBox();
      expect(field, 'el campo debe existir').not.toBeNull();
      expect(sb.y + sb.height, 'el escudo no invade el campo').toBeLessThanOrEqual(field!.y + 1);
    });
  }
});
