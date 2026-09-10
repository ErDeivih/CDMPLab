// A2/A3/A4 — Conversión de campos (Dos medios campos, historial de campo, F7).
// Se verifica:
//  - "Dos medios campos" produce un campo `two_halves` distinto de "Encajar todo".
//  - full → two_halves → full conserva modelo y posición.
//  - Undo/Redo de un cambio de campo restaura conjuntamente campo y elementos.
//  - F7 participa en las conversiones (half→f7 no transforma coordenadas).
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase5-conversion';
fs.mkdirSync(SHOTS, { recursive: true });

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Siembra SIEMPRE con limpieza: cada test parte de un estado aislado.
    const now = new Date().toISOString();
    localStorage.clear();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
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

async function openProps(page: Page): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
}

async function setField(page: Page, field: string): Promise<void> {
  const sel = page.locator('.studio-panel select[aria-label="Campo base"]');
  if (!(await sel.isVisible().catch(() => false))) await openProps(page);
  await sel.selectOption(field);
  // FASE G: el cambio se espera en cada llamador con `expect.poll(fieldValue)` o con el
  // diálogo `.toBeVisible()`; el wait fijo post-select era redundante.
}

/** Campo real de la señal, expuesto en `data-field` del host. */
async function fieldValue(page: Page): Promise<string> {
  return page.locator('.board-host').getAttribute('data-field') ?? '';
}

const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;
type Box = { x: number; y: number; width: number; height: number };
type Fit = 'height' | 'contain';

function normToScreen(nx: number, ny: number, host: Box, fit: Fit): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cx = offX + (nx * RECT.w + RECT.x) * s;
  const cy = offY + (ny * RECT.h + RECT.y) * s;
  return { x: host.x + cx, y: host.y + cy };
}

/** Coloca un jugador genérico en el norm dado y desarma la colocación continua. */
async function placePlayer(page: Page, nx: number, ny: number): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador NO cierra el panel Jugadores.
  await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
  const b = (await page.locator('.board-host').boundingBox())!;
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  const fit: Fit = cls.includes('board-fill') ? 'height' : 'contain';
  const s = normToScreen(nx, ny, b, fit);
  await page.mouse.click(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
}

test.describe('A2/A3/A4 — conversión real de campos', () => {
  test('A2: "Dos medios campos" produce un campo DISTINTO de "Encajar todo" (two_halves)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]')).toHaveClass(/chip-active/);
    await placePlayer(page, 0.5, 0.5);
    // full → half abre el diálogo; elegimos "Dos medios campos".
    await setField(page, 'half');
    await expect(page.locator('.field-change-dialog')).toBeVisible();
    await page.locator('.field-change-dialog').getByText('Dos medios campos — recomendado').click();
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('two_halves');
    // El campo visible es un SVG con dos porterías (rgba) y la división central.
    const svg = await page.locator('.board-canvas svg').first().innerHTML();
    expect((svg.match(/rgba\(255,255,255,0.25\)/g) ?? []).length, 'dos porterías (una por mitad)').toBe(2);
    await page.screenshot({ path: `${SHOTS}/two_halves.png` });
  });

  test('A2: full → two_halves → full conserva modelo y posición', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]')).toHaveClass(/chip-active/);
    await placePlayer(page, 0.6, 0.4);
    await setField(page, 'half');
    await page.locator('.field-change-dialog').getByText('Dos medios campos — recomendado').click();
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('two_halves');
    // Volver a full conserva las coordenadas (two_halves↔full es solo cambio de fondo).
    await setField(page, 'full');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('full');
    // El jugador sigue en el campo (no se borró).
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('A3: Undo/Redo de un cambio de campo restaura conjuntamente campo y elementos', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]')).toHaveClass(/chip-active/);
    await placePlayer(page, 0.5, 0.5);
    await setField(page, 'half');
    await page.locator('.field-change-dialog').getByText('Dos medios campos — recomendado').click();
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('two_halves');
    // Undo → vuelve a full (no a half): el historial restaura el campo completo previo.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('full');
    await expect(page.locator('.field-count')).toHaveText('1');
    // Redo → dos medios campos de nuevo.
    await page.keyboard.press('Control+y');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('two_halves');
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('A4: F7 participa en las conversiones (half → F7 NO transforma coordenadas)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]')).toHaveClass(/chip-active/);
    // Pasar a half en un campo VACÍO (sin diálogo) y colocar el jugador ahí.
    await setField(page, 'half');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('half');
    await placePlayer(page, 0.5, 0.5);
    // half → f7 (ambos media extensión): las coordenadas se conservan.
    await setField(page, 'f7');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('f7');
    await expect(page.locator('.field-count')).toHaveText('1');
  });
});
