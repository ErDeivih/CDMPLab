// =============================================================
// FASE 2 — Césped único + franja exterior.
//
// La pizarra usa un ÚNICO césped oficial (sin selector de textura ni color) y
// añade alrededor del campo una franja de césped LISO (~5 % del lado corto) que
// forma parte del lienzo y del PNG, y que permite colocar/seleccionar/mover
// objetos ligeramente FUERA de las líneas del terreno.
//
// Se verifican: presencia de la franja, desplazamiento del pointer a la franja
// (colocar fuera de las líneas), selección y movimiento de un objeto fuera de las
// líneas, y que un ejercicio guardado/reabierto conserva esas posiciones.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase2-franja';
fs.mkdirSync(SHOTS, { recursive: true });

const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Fit = 'height' | 'contain';
type Pt = { x: number; y: number };

function normToScreen(nx: number, ny: number, host: Box, fit: Fit, panX = 0, panY = 0, zoom = 1): Pt {
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

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    const loc = page.locator(sel);
    if (await loc.isVisible().catch(() => false)) await loc.click();
  }
  await expect(page.locator('.board-canvas svg')).toBeVisible();
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

/** Norm (0..1) de un material <image>: el centro se codifica en x/y + width/height. */
async function imageNorm(page: Page, selector: string): Promise<Pt> {
  const v = await page.locator(selector).first().evaluate((el) => {
    const w = parseFloat(el.getAttribute('width') ?? '0');
    const h = parseFloat(el.getAttribute('height') ?? '0');
    const x = parseFloat(el.getAttribute('x') ?? '0');
    const y = parseFloat(el.getAttribute('y') ?? '0');
    return { x: x + w / 2, y: y + h / 2 };
  });
  return { x: (v.x - RECT.x) / RECT.w, y: (v.y - RECT.y) / RECT.h };
}

const CONE = '.board-canvas svg image[href*="cone"]';
const SEL = '.board-canvas svg [stroke="#2563eb"]';

test.describe('FASE 2 — césped único y franja exterior', () => {
  test('la franja exterior LISA existe como capa propia, separada del césped de franjas', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    // El césped de franjas y la franja exterior son grupos SVG distintos.
    await expect(page.locator('.entrenolab-grass')).toHaveCount(1);
    await expect(page.locator('.entrenolab-strip')).toHaveCount(1);
    // El rect de la franja sobresale del rect de contenido (se extiende fuera de 0..1).
    const strip = await page.locator('.entrenolab-strip rect').first().evaluate((el) => {
      const x = parseFloat(el.getAttribute('x') ?? '0');
      const y = parseFloat(el.getAttribute('y') ?? '0');
      return { x, y };
    });
    expect(strip.x, 'la franja se extiende a la izquierda del rect (x<0)').toBeLessThan(0);
    expect(strip.y, 'la franja se extiende por arriba del rect (y<0)').toBeLessThan(0);
  });

  test('coloca un cono FUERA de las líneas (en la franja), lo selecciona y lo mueve', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await expect(page.locator('.placement-hint')).toBeVisible();
    // FASE B (paneles persistentes): elegir el cono NO cierra el panel Material. El
    // punto de colocación (norm -0.03) y la posterior selección/arrastre del cono viven
    // en la franja izquierda, bajo el panel, así que se cierra con su X (el cierre NO
    // desarma la colocación) antes de pinchar el campo.
    await page.locator('.side-panel-left .panel-close').first().click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    // Norm ligeramente negativo en X (fuera de la línea de fondo, dentro de la franja).
    const s = normToScreen(-0.03, 0.5, host, fit);
    await page.mouse.click(s.x, s.y);
    // Disarm (Fase 3): el material genérico coloca en continuo.
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await expect(page.locator('.field-count')).toHaveText('1');
    // El cono quedó en x<0 (fuera de las líneas).
    const norm = await imageNorm(page, CONE);
    expect(norm.x, 'el cono se colocó fuera de la línea de fondo (x<0)').toBeLessThan(0);
    expect(norm.x, 'pero dentro de la franja (no exageradamente lejos)').toBeGreaterThan(-0.08);
    // Seleccionarlo clicando sobre su centro (en la franja).
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/cono-en-franja.png` });
    await page.mouse.click(s.x, s.y);
    await expect(page.locator(SEL)).not.toHaveCount(0);
    // Moverlo ligeramente (aún en la franja) y comprobar que cambia de posición.
    const before = await imageNorm(page, CONE);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x - 30, s.y + 18, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => {
      const n = await imageNorm(page, CONE);
      return Math.abs(n.x - before.x) + Math.abs(n.y - before.y);
    }, { timeout: 4000 }).toBeGreaterThan(0.005);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/cono-movido-en-franja.png` });
  });

  test('una colocación claramente dentro del campo NO se daña por la franja (regresión)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    // FASE B (paneles persistentes): elegir un genérico NO cierra el panel Jugadores.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const s = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(s.x, s.y);
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    const norm = await page.locator('.entrenolab-board circle[r="2.5"]').first().evaluate((el) => {
      const g = el.closest('g');
      const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
      const R = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
      return m ? { x: (parseFloat(m[1]) - R.x) / R.w, y: (parseFloat(m[2]) - R.y) / R.h } : null;
    });
    expect(norm, 'el jugador se coloca dentro del campo').not.toBeNull();
    expect(norm!.x, 'x dentro del campo (0..1)').toBeGreaterThanOrEqual(0);
    expect(norm!.y, 'y dentro del campo (0..1)').toBeGreaterThanOrEqual(0);
  });
});
