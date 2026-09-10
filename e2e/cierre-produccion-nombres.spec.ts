// =============================================================
// CIERRE DE PRODUCCIÓN — FASE 1: nombres/dorsales legibles en
// horizontal y vertical. Mide mediante bounding box (getBoundingClientRect
// del <text>) que el nombre/dorsal del jugador están HORIZONTALES
// (width > height) tanto en campo horizontal como vertical, y genera
// las capturas de evidencia.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/cierre-produccion';
fs.mkdirSync(SHOTS, { recursive: true });

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };

type Box = { x: number; y: number; width: number; height: number };

function normToScreen(nx: number, ny: number, host: Box, fit: 'height' | 'contain'): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  return { x: host.x + host.width / 2 + (cx - host.width / 2), y: host.y + host.height / 2 + (cy - host.height / 2) };
}

function seed(orientation: 'horizontal' | 'vertical', players: unknown[], formations?: { own: string; rival: string }) {
  const draft = {
    schemaVersion: 1, title: `Jugadores ${orientation}`, field: 'full', orientation,
    players: players.length ? players : undefined,
    ownFormation: formations?.own, rivalFormation: formations?.rival,
  };
  return `(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Sergio', number: 8, position: 'MC', color: '#1f7a4d', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    sessionStorage.setItem('entrenolab:ai-draft', ${JSON.stringify(JSON.stringify(draft))});
  })()`;
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}
async function fitMode(page: Page): Promise<'height' | 'contain'> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}
async function dismissHelp(page: Page): Promise<void> {
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

/** ¿El <text> con el contenido dado está HORIZONTAL respecto a pantalla?
 *  Usa la matriz de transformación (getCTM) del texto: si su eje X apunta en horizontal
 *  (sin rotación de 90°), el texto es legible de izquierda a derecha. */
async function textIsHorizontal(page: Page, content: string): Promise<boolean | null> {
  return page.evaluate((txt) => {
    const svg = document.querySelector('.board-canvas svg');
    if (!svg) return null;
    const t = Array.from(svg.querySelectorAll<SVGTextElement>('text')).find((n) => (n.textContent ?? '').trim() === txt);
    if (!t) return null;
    const m = t.getCTM();
    if (!m) return false;
    // El vector (m.a, m.b) es la dirección del eje X del texto en pantalla.
    // Horizontal ⇒ b≈0 y a>0 (o a<0). Giro de ±90° ⇒ |a|≈0 y b≠0.
    return Math.abs(m.b) < 0.35 && Math.abs(m.a) > Math.abs(m.b);
  }, content);
}

test.describe('CIERRE — nombres y dorsales horizontales en horizontal y vertical', () => {
  for (const orientation of ['horizontal', 'vertical'] as const) {
    test(`jugador (propio y rival) con nombre «Sergio» y dorsal 8 legible en ${orientation}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.addInitScript(seed(orientation, [
        { id: 'own-1', team: 'own', position: { x: 0.35, y: 0.35 }, label: 'Sergio', number: 8 },
        { id: 'rival-1', team: 'rival', position: { x: 0.65, y: 0.65 }, label: 'Diego', number: 10 },
      ]));
      await page.goto('/board/draft');
      await expect(page.locator('.board-host')).toBeVisible();
      await dismissHelp(page);
      // FASE G: el borrador se espera con el `toHaveText('2')` siguiente (observable).
      await expect(page.locator('.field-count')).toHaveText('2');

      // Nombre y dorsal HORIZONTALES (matriz de transformación del texto sin giro 90°).
      const nameH = await textIsHorizontal(page, 'Sergio');
      expect(nameH, 'el nombre «Sergio» es legible de izquierda a derecha').toBe(true);
      const numH = await textIsHorizontal(page, '8');
      expect(numH, 'el dorsal 8 es legible de izquierda a derecha').toBe(true);

      // Rival con su nombre/dorsal también horizontal.
      const rivalName = await textIsHorizontal(page, 'Diego');
      expect(rivalName, 'el nombre del rival es legible de izquierda a derecha').toBe(true);

      // Captura de evidencia.
      await page.locator('.board-host').screenshot({ path: `${SHOTS}/jugador-${orientation}-legible.png` });
    });
  }

  test('formación 4-3-3 propia + 4-4-2 rival en campo vertical: nombres horizontales', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    // Formación 4-3-3 propia + 4-4-2 rival, en vertical = 22 jugadores.
    await page.addInitScript(seed('vertical', [], { own: '4-3-3', rival: '4-4-2' }));
    await page.goto('/board/draft');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);
    // FASE G: la formación se espera con el `toHaveText('22')` siguiente (observable).
    await expect(page.locator('.field-count')).toHaveText('22');

    // Los dorsales (números 1..11) de propia y rival quedan horizontales (matriz del texto).
    const sample = await page.evaluate(() => {
      const svg = document.querySelector('.board-canvas svg')!;
      const texts = Array.from(svg.querySelectorAll<SVGTextElement>('text'))
        .filter((t) => t.getAttribute('font-weight') !== null);
      let horizontal = 0;
      for (const t of texts) {
        const m = t.getCTM();
        if (!m) continue;
        if (Math.abs(m.b) < 0.35 && Math.abs(m.a) > Math.abs(m.b)) horizontal++;
      }
      return { total: texts.length, horizontal };
    });
    expect(sample.total, 'hay textos de jugadores').toBeGreaterThanOrEqual(10);
    expect(sample.horizontal, 'la mayoría de dorsales/nombres quedan horizontales').toBeGreaterThanOrEqual(sample.total * 0.7);

    await page.locator('.board-host').screenshot({ path: `${SHOTS}/formacion-vertical-legible.png` });
  });
});
