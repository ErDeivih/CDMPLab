// =============================================================
// FASE 8 — el nombre/número del jugador se contrarrota (queda derecho
// al girar ±90°) en orientaciones HORIZONTAL y VERTICAL reales.
//
// Antes este test abría la pizarra vacía (no aplicaba la orientación)
// y las capturas horizontal/vertical eran idénticas. Ahora abre un
// borrador IA compileado con `orientation` real (vía /board/draft,
// cuyo guard abre el documento con la orientación correspondiente),
// coloca un jugador con nombre y dorsal, lo gira +90° y comprueba:
//   · la geometría del campo (orientación efectiva);
//   · el jugador girado +90° (marca `rotate(90`);
//   · el texto del jugador contrarrotado a -90° (upright);
//   · que horizontal y vertical producen capturas visualmente distintas.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { longPress } from './gesture-helpers';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase8-names';
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

function seed(orientation: 'horizontal' | 'vertical') {
  const draft = {
    schemaVersion: 1,
    title: `Jugador girado ${orientation}`,
    field: 'full',
    orientation,
    players: [
      { id: 'own-1', team: 'own', position: { x: 0.5, y: 0.5 }, label: 'Sergio', number: 8 },
    ],
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

test.describe('Fase 8 — el nombre/número del jugador se contrarrota al girar ±90° (H y V reales)', () => {
  for (const orientation of ['horizontal', 'vertical'] as const) {
    test(`jugador con nombre «Sergio» y dorsal 8 girado +90° en orientación ${orientation}: upright y geometría distinta`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.addInitScript(seed(orientation));

      // El guard abre el borrador CON la orientación del documento.
      await page.goto('/board/draft');
      await expect(page.locator('.board-host')).toBeVisible();
      await dismissHelp(page);
      await page.waitForTimeout(400);

      // El jugador con nombre y dorsal está colocado.
      await expect(page.locator('.field-count')).toHaveText('1');
      const html0 = await page.locator('.board-canvas svg').innerHTML();
      expect(html0, 'el dorsal 8 está pintado').toContain('8');
      expect(html0, 'el nombre «Sergio» está pintado').toContain('Sergio');

      // Geometría real según orientación: la caja del CÉSPED es más ancha en
      // horizontal y más alta en vertical (el viewBox del campo se intercambia).
      const grass = (await page.locator('.entrenolab-grass').boundingBox())!;
      if (orientation === 'horizontal') {
        expect(grass.width).toBeGreaterThan(grass.height);
      } else {
        expect(grass.height).toBeGreaterThan(grass.width);
      }

      // Girar +90° desde la barra de contexto (pulsación larga).
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const c = normToScreen(0.5, 0.5, host, fit);
      await longPress(page, c.x, c.y);
      await expect(page.locator('.context-bar')).toBeVisible();
      await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
      await page.waitForTimeout(150);

      // La marca gira +90° y el texto se contrarrota para quedar DERECHO por pantalla.
      // En horizontal, el texto compensa solo la rotación del jugador: -(0 + 90) = -90.
      // En vertical, además el CAMPO se gira +90 (todo el canvas), así que el texto debe
      // compensar BOTH: -(90 + 90) = -180. Este test, antes de la FASE 1, asumía -90 para
      // ambas orientaciones; eso era incorrecto para vertical (el texto quedaba a 90° y no
      // se leía de izquierda a derecha). La FASE 1 corrige el render.
      const expectedRot = orientation === 'vertical' ? 'rotate(-180 0 0)' : 'rotate(-90 0 0)';
      const html = await page.locator('.board-canvas svg').innerHTML();
      expect(html, 'la marca del jugador está girada +90°').toContain('rotate(90');
      expect(html, `el texto del jugador se contrarrota a ${expectedRot} (queda derecho) en ${orientation}`).toContain(expectedRot);

      // Evidencia: captura por orientación.
      await page.locator('.board-host').screenshot({ path: `${SHOTS}/nombre-${orientation}.png` });
    });
  }
});
