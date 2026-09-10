import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const LANDSCAPE: Array<[number, number]> = [[800, 360], [844, 390], [932, 430]];
const SHOTS = 'e2e/shots/fase1-landscape';
fs.mkdirSync(SHOTS, { recursive: true });

function seed() {
  return `(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  })()`;
}

type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, sel: string): Promise<Box> {
  const b = await page.locator(sel).boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

test.describe('Fase 1 — móvil en horizontal: la pizarra compacta es realmente usable', () => {
  test.use({ hasTouch: true });

  for (const [W, H] of LANDSCAPE) {
    test(`[${W}x${H}] el campo es el protagonista: campo que llena, barra de una fila, sin overflow`, async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await page.addInitScript(seed());
      await page.goto('/board');
      await expect(page.locator('.board-host')).toBeVisible();
      if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
      await page.waitForTimeout(300);

      // Sin preferencia guardada → "Llenar pantalla" por defecto.
      await expect(page.locator('.board-host')).toHaveClass(/board-fill/);

      // Sin panel de propiedades abierto inicialmente.
      await expect(page.locator('.studio-panel')).toHaveCount(0);

      // Alturas: cabecera compacta, barra inferior en una sola fila (cabe en la pantalla).
      const header = await box(page, '.studio-top');
      const tools = await box(page, '.studio-tools');
      expect(header.height, 'cabecera compacta').toBeLessThanOrEqual(56);
      expect(tools.height, 'barra inferior compacta').toBeLessThan(110);
      const toolsTop = tools.y + tools.height;
      expect(toolsBottomWithin(tools, H), 'la barra inferior no se sale de la pantalla').toBe(true);

      // El host aprovecha prácticamente toda la altura entre el final de la barra de
      // estado del campo (.field-status) y la barra inferior (la pista de herramienta
      // se oculta en compactos; queda el 44px del toggle de pantalla).
      const host = await box(page, '.board-host');
      const fs = await box(page, '.field-status');
      const usable = tools.y - (fs.y + fs.height);
      expect(usable, 'hay espacio utilizable para el campo').toBeGreaterThan(80);
      expect(host.height, 'host alto respecto al espacio usable').toBeGreaterThanOrEqual(usable * 0.9);
      // FASE 1 (móvil horizontal): en "Llenar pantalla" (cover) el campo CUBRE el host:
      // en landscape aprovecha el ANCHO (>=85%) y sobresale en altura (se panea).
      const grass = await box(page, '.entrenolab-grass');
      expect(grass.width, 'el césped es más ancho que alto (campo horizontal)').toBeGreaterThan(grass.height);
      expect(grass.width, 'el campo aprovecha el ancho disponible').toBeGreaterThanOrEqual(host.width * 0.85);
      // Cover: el campo CUBRE el host (al menos una dimensión llena; puede sobresalir en la otra).
      expect(grass.height, 'el campo cubre la altura (no queda contenido)').toBeGreaterThanOrEqual(host.height - 2);
      // Proporción del campo 105:68 → ancho/alto ≈ 1.54 en modo fill (no una columna vertical).
      const ratio = grass.width / grass.height;
      expect(ratio, 'relación ancho/alto del campo (≈1.5, no vertical)').toBeGreaterThan(1.3);
      expect(ratio).toBeLessThan(1.8);

      // Sin scroll horizontal de documento ni de .studio.
      const ov = await page.evaluate(() => {
        const d = document.documentElement;
        const studio = document.querySelector('.studio') as HTMLElement | null;
        return { doc: d.scrollWidth - d.clientWidth, studio: studio ? studio.scrollWidth - studio.clientWidth : 0, body: document.body.scrollWidth - document.body.clientWidth };
      });
      expect(ov.doc, 'sin overflow de documento').toBeLessThanOrEqual(1);
      expect(ov.studio, 'sin overflow de .studio').toBeLessThanOrEqual(1);
      expect(ov.body, 'sin overflow de body').toBeLessThanOrEqual(1);

      // Controles de la barra en UNA sola fila (la leyenda de la herramienta se oculta).
      const captionDisplay = await page.locator('.tools-caption').first().evaluate((el) => getComputedStyle(el).display);
      expect(captionDisplay, 'la leyenda de herramienta ocupa su fila solo si es de color').toBe('none');

      // Abrir/cerrar cada panel no altera el tamaño del host (son overlays).
      const hostBefore = (await box(page, '.board-host')).height;
      for (const cat of ['Jugadores', 'Material', 'Dibujo']) {
        await page.locator('.tools-cat', { hasText: cat }).click();
        await expect(page.locator('.side-panel-left')).toBeVisible();
        await page.locator('.side-panel-left .panel-close').first().click();
        await expect(page.locator('.side-panel-left')).toHaveCount(0);
      }
      const hostAfter = (await box(page, '.board-host')).height;
      expect(Math.abs(hostAfter - hostBefore), 'abrir/cerrar paneles no cambia la altura del host').toBeLessThanOrEqual(2);

      // FASE 1 (capturas): pista de llenado visible, y luego tras cerrarla.
      await page.locator('.board-host').screenshot({ path: `${SHOTS}/pizarra-${W}x${H}.png` });
      // La pista de "Llenar pantalla" se cierra y no permanece tapando el campo.
      if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) {
        await page.locator('.fill-hint-close').click();
      }
      // FASE G: la pista se espera con el `toHaveCount(0)` siguiente (observable).
      await expect(page.locator('.fill-hint'), 'la pista de llenado se cierra').toHaveCount(0);
      await page.locator('.board-host').screenshot({ path: `${SHOTS}/pizarra-${W}x${H}-sin-pista.png` });
    });
  }
});

function toolsBottomWithin(tools: { y: number; height: number }, H: number): boolean {
  return tools.y + tools.height <= H + 2;
}
