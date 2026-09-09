// FASE 1 — arcos de córner. Genera capturas en primer plano de las CUATRO esquinas
// y del campo completo, en horizontal y vertical. Para acercar una esquina se usa la
// herramienta "Mano" (comportamiento real de paneo a zoom >100%), sin esperas fijas.
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/corners';
fs.mkdirSync(SHOTS, { recursive: true });

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
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
    // Espera observable: si el overlay flotante existe, se cierra; en otro caso sigue.
    if (await loc.isVisible().catch(() => false)) await loc.click();
  }
  await expect(page.locator('.board-host')).toBeVisible();
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

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en HORIZONTAL. */
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

/** Lee panX/panY/zoom del transform inline del `.board-canvas`. */
async function readView(page: Page): Promise<{ panX: number; panY: number; zoom: number }> {
  return page.locator('.board-canvas').evaluate((el) => {
    const t = (el as HTMLElement).style.transform;
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
    return m ? { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { panX: 0, panY: 0, zoom: 1 };
  });
}

async function setZoom(page: Page, z: number): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').click();
  const zoomSlider = page.locator('.studio-panel .field', { hasText: 'Zoom' }).locator('input[type="range"]');
  await zoomSlider.evaluate((input: HTMLInputElement, val) => {
    input.value = val;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(z));
  await page.locator('.studio-panel .panel-close').click();
  // Espera observable: el zoom aplicado se refleja en el transform del canvas.
  await expect.poll(async () => (await readView(page)).zoom, { timeout: 4000 }).toBeCloseTo(z, 1);
}

async function setOrientation(page: Page, o: 'horizontal' | 'vertical'): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').click();
  await page.locator('.studio-panel .chip', { hasText: o === 'horizontal' ? 'Porterías izquierda y derecha' : 'Porterías arriba y abajo' }).click();
  await page.locator('.studio-panel .panel-close').click();
}

async function setField(page: Page, field: string): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').click();
  await page.locator('.studio-panel select[aria-label="Campo base"]').selectOption(field);
  await page.locator('.studio-panel .panel-close').click();
}

/** Usa la herramienta "Mano" para panear hasta que la esquina (nx,ny) quede en el
 *  centro del host. Arrastra desde un punto vacío (fuera del objeto) para no mover nada. */
async function centerCorner(page: Page, nx: number, ny: number): Promise<void> {
  await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const v = await readView(page);
  const corner = normToScreen(nx, ny, host, fit, v.panX, v.panY, v.zoom);
  const ox = host.x + host.width / 2;
  const oy = host.y + host.height / 2;
  const dx = ox - corner.x;
  const dy = oy - corner.y;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  // Arrastrar con Mano desde el centro (campo vacío en la esquina) por (dx,dy).
  await page.mouse.move(ox, oy);
  await page.mouse.down();
  await page.mouse.move(ox + dx, oy + dy, { steps: 8 });
  await page.mouse.up();
  // Espera observable: panX/panY cambiaron hacia el objetivo.
  await expect.poll(async () => {
    const nv = await readView(page);
    return Math.abs(nv.panX - v.panX) + Math.abs(nv.panY - v.panY);
  }, { timeout: 4000 }).toBeGreaterThan(1);
}

async function captureCorners(page: Page, prefix: string): Promise<void> {
  const corners: Array<[number, number]> = [
    [0, 0], [1, 0], [0, 1], [1, 1],
  ];
  for (const [i, [nx, ny]] of corners.entries()) {
    await centerCorner(page, nx, ny);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/${prefix}-corner-${i}.png` });
  }
}

test.describe('FASE 1 — capturas de córneres', () => {
  test('campo completo horizontal: campo completo y 4 esquinas en primer plano (zoom 2.4)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openClosed(page);
    await setField(page, 'full');
    await setOrientation(page, 'horizontal');
    // Captura del campo completo en su estado inicial (sin pan, zoom 1): centrado.
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/h-full.png` });
    await setZoom(page, 2.4);
    await captureCorners(page, 'h');
  });

  test('campo completo vertical: campo completo y 4 esquinas en primer plano (zoom 2.4)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openClosed(page);
    await setField(page, 'full');
    await setOrientation(page, 'vertical');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/v-full.png` });
    await setZoom(page, 2.4);
    await captureCorners(page, 'v');
  });
});
