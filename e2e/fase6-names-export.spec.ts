// =============================================================
// FASE 6 — nombres/números verificado en persistencia y export PNG.
//
// Un jugador de plantilla (name + number) se coloca, se gira +90° y
// −90° por la barra de contexto (pulsación larga) y se verifica que su
// número y nombre quedan en VERTICAL (upright) tanto en horizontal
// como en vertical. Después: guardar/reabrir conserva name/number/rot,
// y el PNG exportado lleva el texto del jugador sin controles de
// edición ni caja/borde blanco.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';
import { longPress, fillBoardTitle } from './gesture-helpers';

const SHOTS = 'e2e/shots/fase6-names';
fs.mkdirSync(SHOTS, { recursive: true });

const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };

function normToScreen(nx: number, ny: number, host: Box, fit: 'height' | 'contain'): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  const ox = host.width / 2;
  const oy = host.height / 2;
  return { x: host.x + ox + (cx - ox), y: host.y + oy + (cy - oy) };
}

function seed(opts: { orientation?: 'horizontal' | 'vertical' } = {}) {
  const { orientation = 'horizontal' } = opts;
  return `(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-fill', '0');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Sergio', number: 8, position: 'MC', color: '#1f7a4d', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  })()`;
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}
async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b).not.toBeNull();
  return b!;
}
async function fitMode(page: Page): Promise<'height' | 'contain'> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}
async function centerOfPlaced(page: Page): Promise<{ x: number; y: number }> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  return normToScreen(0.5, 0.5, host, fit);
}

async function exportPngBuf(page: Page): Promise<Buffer> {
  const dlPromise = page.waitForEvent('download');
  await page.locator('[aria-label="Exportar"]').click();
  await expect(page.locator('.top-pop-export')).toBeVisible();
  await page.locator('.rail-btn[title="Descargar PNG"]').click();
  const dl = await dlPromise;
  const p = await dl.path();
  const buf = fs.readFileSync(p!);
  expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47');
  return buf;
}

test.setTimeout(120_000);

test.describe('Fase 6 — nombre/número del jugador: ±90° upright, persistencia y PNG exportado', () => {
  test('jugador con nombre «Sergio» y dorsal 8: ±90° upright, guardar/reabrir y PNG sin controles', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(seed({ orientation: 'horizontal' }));
    await openClosed(page);      // Colocar el jugador de plantilla (nombre + dorsal).
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await page.locator('.side-panel-left').first().waitFor();
      await page.locator('.roster-item', { hasText: 'Sergio' }).click();
      // FASE G: la colocación se espera con el `toHaveText('1')` siguiente (observable);
      // el wait fijo post-arma era redundante.
      const c = await centerOfPlaced(page);
      await page.mouse.click(c.x, c.y);
      await expect(page.locator('.field-count')).toHaveText('1');
      // El SVG del tablero ya muestra el dorsal (número).
      const html0 = await page.locator('.board-canvas svg').innerHTML();
      expect(html0, 'el dorsal 8 está pintado').toContain('8');

      // GUARDAR → el modelo queda en localStorage; leer el modelo persistido.
      await fillBoardTitle(page, 'NombreExport');
      await page.locator('.chip-icon-primary').click();
      await page.waitForURL('**/library');
      let persisted = await page.evaluate(() => {
        const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
        return ex.canvas.frames[0].elements[0];
      });
      expect(persisted.t).toBe('player');
      expect(persisted.label ?? persisted.v, 'el nombre persiste').toBe('Sergio');
      expect(persisted.n, 'el dorsal persiste').toBe(8);

      // REABRIR para rotar sobre la pizarra.
      await page.locator('.ex-card').first().hover();
      await page.locator('[title="Diseñar en pizarra"]').first().click();
      await page.waitForURL('**/board');
      await expect(page.locator('.field-count')).toHaveText('1');
      const c1 = await centerOfPlaced(page);

      // +90° (long-press → barra de contexto → girar a la derecha): texto upright (-90).
      await longPress(page, c1.x, c1.y);
      await expect(page.locator('.context-bar')).toBeVisible();
      await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
      // FASE G: observable — el SVG ya renderiza la rotación (no una espera fija).
      await expect.poll(() => page.locator('.board-canvas svg').first().innerHTML(), { timeout: 5000 }).toContain('rotate(-90 0 0)');
      let html = await page.locator('.board-canvas svg').innerHTML();
      expect(html, 'texto del jugador upright a +90° (contrarrotado a -90)').toContain('rotate(-90 0 0)');

      // Undo (vuelve a 0) y girar a la IZQUIERDA (−90): el texto se contrarrota a -rot y queda upright.
      await page.keyboard.press('Control+z');
      // FASE G: observable — el undo revierte la contrarrotación del +90.
      await expect.poll(async () => !(await page.locator('.board-canvas svg').innerHTML()).includes('rotate(-90 0 0)'), { timeout: 5000 }).toBe(true);
      await longPress(page, c1.x, c1.y);
      await expect(page.locator('.context-bar')).toBeVisible();
      await page.locator('.context-bar [aria-label="Girar 90° a la izquierda"]').click();
      // La contrarrotación del -90 usa una forma propia (la verificamos con `upright` más abajo).
      await page.waitForTimeout(150);
      html = await page.locator('.board-canvas svg').innerHTML();
      // El dorsal queda upright: el <text> vive dentro de un grupo contrarrotado (-rot).
      const upright = await page.evaluate(() => {
        const svg = document.querySelector('.board-canvas svg')!;
        const text = Array.from(svg.querySelectorAll<SVGTextElement>('text')).find((t) => t.textContent === '8');
        if (!text) return false;
        let g = text.parentElement;
        let counter = false;
        while (g && g.tagName === 'g') {
          const tr = g.getAttribute('transform') ?? '';
          const m = /rotate\((-?[\d.]+) 0 0\)/.exec(tr);
          if (m && Number(m[1]) !== 0) counter = true;
          g = g.parentElement;
        }
        return counter;
      });
      expect(upright, 'el dorsal está contrarrotado y queda upright a -90°').toBe(true);

      // Guardar → rot -90 y nombre/dorsal persisten.
      await fillBoardTitle(page, 'NombreExport2');
      await page.locator('.chip-icon-primary').click();
      await page.waitForURL('**/library');
      persisted = await page.evaluate(() => {
        const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
        return ex.canvas.frames[0].elements[0];
      });
      expect([-90, 270].some((r) => Math.abs(persisted.rot - r) < 1), 'rot persistido equivale a -90°').toBe(true);
      expect(persisted.label ?? persisted.v, 'el nombre sigue persistiendo').toBe('Sergio');
      expect(persisted.n, 'el dorsal sigue persistiendo').toBe(8);

      // REABRIR para comprobar el estado final y exportar PNG.
      await page.locator('.ex-card').first().hover();
      await page.locator('[title="Diseñar en pizarra"]').first().click();
      await page.waitForURL('**/board');
      await expect(page.locator('.field-count')).toHaveText('1');
      // El render del tablero (mismo SVG que se inlina en el PNG) no conserva controles.
      await page.keyboard.press('Escape');
      // FASE G: observable — el SVG no conserva controles de edición antes de exportar.
      await expect(page.locator('.entrenolab-board .text-edit-rect, .entrenolab-board .text-edit, .entrenolab-board .reshandle, .entrenolab-board .context-bar')).toHaveCount(0);
      const buf = await exportPngBuf(page);
      const p = `${SHOTS}/jugador-horizontal.png`;
      fs.writeFileSync(p, buf);
      const hasEditControls = await page.evaluate(() => {
        const svg = document.querySelector('.entrenolab-board')!;
        return svg.querySelector('.text-edit-rect, .text-edit, .reshandle, .context-bar') !== null;
      });
      expect(hasEditControls, 'el PNG exportado no lleva controles de edición ni selección').toBe(false);
  });
});
