import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// =============================================================
// Defecto residual 1 — barra inferior móvil en DOS FILAS.
//
// Antes: en 360×800 y 390×844 la barra persistente (.studio-tools)
// envolvía a una segunda fila (≈105 px) y "Dibujo" caía solo abajo,
// restando campo. Ahora los 7 controles persistentes (Deshacer,
// Rehacer, Seleccionar, Mano, Jugadores, Material, Dibujo) deben
// caber en UNA sola fila (max. 60 px de altura), con objetivo táctil
// ≥44×44 px, sin overflow horizontal, y el campo gana el alto
// liberado. En móvil las categorías se identifican por ICONO (la
// etiqueta textual se conserva para accesibilidad vía aria-label).
// =============================================================

const SHOTS = 'e2e/shots/mobile-toolbar';
fs.mkdirSync(SHOTS, { recursive: true });

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

type Box = { x: number; y: number; width: number; height: number };
type Fit = 'contain' | 'height';

const SIZES: Array<[number, number]> = [
  [360, 800],
  [390, 844],
  [430, 932],
];

function normToScreen(nx: number, ny: number, host: Box, fit: Fit, panX = 0, panY = 0, zoom = 1) {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  const ox = host.width / 2;
  const oy = host.height / 2;
  return { x: host.x + ox + panX + zoom * (cx - ox), y: host.y + oy + panY + zoom * (cy - oy) };
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(250);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}

// Los 7 controles persistentes que deben estar en una sola fila.
const CONTROLS: Array<[string, string]> = [
  // Fase 3: Deshacer/Rehacer ya no están en la barra; viven en el menú contextual.
  ['Seleccionar', '.rail-btn[aria-label="Seleccionar y mover"]'],
  ['Mano', '.rail-btn[aria-label="Desplazar campo"]'],
  ['Jugadores', '.tools-cat[aria-label="Jugadores"]'],
  ['Material', '.tools-cat[aria-label="Material"]'],
  ['Dibujo', '.tools-cat[aria-label="Dibujo"]'],
];

test.describe('Defecto 1 — barra inferior móvil en una sola fila', () => {
  for (const [w, h] of SIZES) {
    test(`[${w}×${h}] los 7 controles están en una sola fila, accesibles y sin overflow`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoard(page);

      // 1) Los 7 controles visibles y dentro del viewport.
      const boxes: Record<string, Box> = {};
      for (const [name, sel] of CONTROLS) {
        const loc = page.locator(sel);
        await expect(loc, `${name} visible`).toBeVisible();
        const b = await loc.boundingBox();
        expect(b, `${name} con boundingBox`).not.toBeNull();
        expect(b!.x + b!.width, `${name} no desborda la derecha`).toBeLessThanOrEqual(w + 1);
        expect(b!.y, `${name} dentro de la vista`).toBeGreaterThanOrEqual(0);
        boxes[name] = b!;
      }

      // 2) Misma fila: los `top` deben coincidir dentro de una tolerancia pequeña.
      const tops = Object.values(boxes).map((b) => b.y);
      const minTop = Math.min(...tops);
      const maxTop = Math.max(...tops);
      expect(maxTop - minTop, 'los 7 controles comparten fila (tolerancia 6 px)').toBeLessThanOrEqual(6);

      // 3) Altura total de barra ≤ 60 px.
      const bar = await page.locator('.studio-tools').boundingBox();
      expect(bar, '.studio-tools existe').not.toBeNull();
      expect(bar!.height, 'barra inferior ≤ 60 px').toBeLessThanOrEqual(60);

      // 4) Objetivos táctiles ≥ 44×44.
      for (const [name, b] of Object.entries(boxes)) {
        const dim = Math.min(b.width, b.height);
        expect(dim, `objetivo táctil de ${name} ≥ 44`).toBeGreaterThanOrEqual(44);
      }

      // 5) Sin overflow horizontal y sin wrapping en la barra persistente.
      const noOverflow = await page.evaluate(() => {
        const tools = document.querySelector<HTMLElement>('.studio-tools');
        const persist = document.querySelector<HTMLElement>('.tools-persist');
        const doc = document.documentElement;
        return {
          docScroll: doc.scrollWidth <= window.innerWidth,
          toolsScroll: tools ? tools.scrollWidth <= tools.clientWidth : true,
          persistH: persist ? persist.getBoundingClientRect().height : 0,
        };
      });
      expect(noOverflow.docScroll, 'sin overflow horizontal del documento').toBe(true);
      expect(noOverflow.toolsScroll, 'sin overflow horizontal de .studio-tools').toBe(true);
      // La fila persistente mide una sola fila de altura (no envolvió).
      expect(noOverflow.persistH, '.tools-persist en una sola fila').toBeLessThanOrEqual(60);

      // Captura con menús cerrados.
      await page.screenshot({ path: `${SHOTS}/${w}x${h}-una-fila.png` });
    });
  }

  test('[390×844] abrir Jugadores, Material y Dibujo desde la fila y colocar un elemento desde cada menú', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);

    // Jugadores → colocar un Portero.
    await page.locator('.tools-cat[aria-label="Jugadores"]').click();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    // FASE B (paneles persistentes): el panel Jugadores permanece abierto tras armar el
    // jugador y, en móvil vertical, tapa el punto de colocación. Se cierra con su X
    // (no desarma la colocación) antes de hacer tap en el campo.
    await page.locator('.side-panel-left .panel-close').click();
    let p = normToScreen(0.35, 0.45, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Material → colocar un Cono.
    await page.keyboard.press('Escape');
    await page.locator('.tools-cat[aria-label="Material"]').click();
    await page.locator('.rail-btn[title="Cono"]').click();
    // FASE B (paneles persistentes): cerrar el panel con su X (sin desarmar) para poder
    // colocar el cono en el campo, que queda fuera del panel cerrado.
    await page.locator('.side-panel-left .panel-close').click();
    p = normToScreen(0.55, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.field-count')).toHaveText('2');

    // Dibujo → dibujar una línea (arrastre).
    await page.keyboard.press('Escape');
    await page.locator('.tools-cat[aria-label="Dibujo"]').click();
    await page.locator('.rail-btn[title="Línea"]').click();
    // FASE B (paneles persistentes): el panel Dibujo permanece abierto y tapa el inicio del
    // arrastre; se cierra con su X (no desarma la herramienta) para dibujar sobre el campo.
    await page.locator('.side-panel-left .panel-close').click();
    const a = normToScreen(0.42, 0.4, host, fit);
    const b = normToScreen(0.6, 0.55, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('3');
  });

  test('[390×844] captura con cada uno de los tres menús abierto', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);

    for (const [name, sel, panelSel] of [
      ['jugadores', '.tools-cat[aria-label="Jugadores"]', '.side-panel-left'],
      ['material', '.tools-cat[aria-label="Material"]', '.side-panel-left'],
      ['dibujo', '.tools-cat[aria-label="Dibujo"]', '.side-panel-left'],
    ] as Array<[string, string, string]>) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
      await page.locator(sel).click();
      await expect(page.locator(panelSel)).toBeVisible();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/390x844-menu-${name}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
    }
  });
});
