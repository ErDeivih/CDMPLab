import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { fieldGeometry, FIELD_LINE_WIDTH, F7_LINE_COLOR } from '../src/app/core/field';

const SHOTS = 'e2e/shots/p2-half';
fs.mkdirSync(SHOTS, { recursive: true });

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function dismissHelp(page: Page): Promise<void> {
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
}

async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

type Geom = ReturnType<typeof fieldGeometry>;

/** Mapea norm (0..1) → pantalla replicando el render real: letterboxing del SVG
 *  (preserveAspectRatio meet) + rect canónico del tipo de campo + rotación vertical. */
function normToScreen(nx: number, ny: number, box: { x: number; y: number; width: number; height: number }, g: Geom): [number, number] {
  const s = Math.min(box.width / g.vbW, box.height / g.vbH);
  const offX = (box.width - g.vbW * s) / 2;
  const offY = (box.height - g.vbH * s) / 2;
  const cxg = nx * g.rect.w + g.rect.x;
  const cyg = ny * g.rect.h + g.rect.y;
  let vbX: number;
  let vbY: number;
  if (g.vertical) {
    const Tx = g.vbW / 2 + (g.rect.y + g.rect.h / 2);
    vbX = Tx - cyg;
    vbY = cxg;
  } else {
    vbX = cxg;
    vbY = cyg;
  }
  const cx = offX + vbX * s;
  const cy = offY + vbY * s;
  return [box.x + cx, box.y + cy];
}

test.describe('Medio campo (52,5×68) — geometría dinámica y F7 preservado', () => {
  test('medio campo HORIZONTAL: bbox renderizado con proporción 52,5/68 (NO deformado)', async ({ page }) => {
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('half');
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.entrenolab-grass')).toBeVisible();
    const b = (await page.locator('.entrenolab-grass').boundingBox())!;
    expect(b, 'el medio campo debe renderizarse').not.toBeNull();
    const ratio = b.width / b.height;
    // 52,5/68 ≈ 0.772. Si se estirara a la caja 105×68 sería ≈1.544 (deformado).
    expect(ratio).toBeCloseTo(52.5 / 68, 1);
    await page.screenshot({ path: `${SHOTS}/half-horizontal.png` });
  });

  test('medio campo VERTICAL (por defecto): bbox renderizado con proporción 68/52,5', async ({ page }) => {
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    // Seleccionar el medio campo lo pone por defecto en VERTICAL (portería arriba).
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('half');
    await page.waitForTimeout(300);
    await expect(page.locator('.entrenolab-grass')).toBeVisible();
    const b = (await page.locator('.entrenolab-grass').boundingBox())!;
    expect(b, 'el medio campo vertical debe renderizarse').not.toBeNull();
    const ratio = b.width / b.height;
    expect(ratio).toBeCloseTo(68 / 52.5, 1);
    await page.screenshot({ path: `${SHOTS}/half-vertical.png` });
  });

  test('un punto norm colocado en el medio campo vertical se guarda en la misma norm (round-trip)', async ({ page }) => {
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    const g = fieldGeometry('half', 'vertical');
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('half');
    await page.waitForTimeout(300);
    const box = (await page.locator('.board-host').boundingBox())!;
    // Colocar un jugador Portero en el punto norm (0.25, 0.35).
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .tray-player[title="Portero"]').click();
    const [sx, sy] = normToScreen(0.25, 0.35, box, g);
    await page.mouse.click(sx, sy);
    await expect(page.locator('.field-count')).toHaveText('1');
    // Guardar y leer el modelo: la colocación quedó en la misma norm (round-trip exacto).
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const el = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return ex.canvas.frames[0].elements[0];
    });
    expect(el.t).toBe('player');
    expect(el.x).toBeCloseTo(0.25, 2);
    expect(el.y).toBeCloseTo(0.35, 2);
  });

  test('campo base F7 preservado: F7 perpendicular y líneas de fuera de juego sobre los laterales del área F11', async ({ page }) => {
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(250);
    const svg = await page.locator('.board-canvas svg').first().innerHTML();
    // El F7 cruza el ancho del medio campo F11: sus bandas coinciden (width=92).
    expect(svg).toContain('width="92"');
    // La portería del medio campo F11 está presente.
    expect(svg).toContain('rgba(255,255,255,0.25)');
    // El F7 se dibuja en su color azul, separado de las líneas blancas del F11.
    expect(svg).toContain(`stroke="${F7_LINE_COLOR}"`);
    // El grosor compartido FIELD_LINE_WIDTH (0.3) se mantiene.
    expect(svg).toContain(`stroke-width="${FIELD_LINE_WIDTH}"`);
    expect(svg).not.toContain('stroke-width="1"');
    // Las líneas de fuera de juego del F7 caen sobre los laterales del área grande del F11
    // (40,32/68 de la anchura): x = 4 + (0,5 ± (40,32/68)/2) * 92.
    const verticalBlue = await page.evaluate(({ color, areaHa }) => {
      const svgEl = document.querySelector('.board-canvas svg')!;
      const xs: number[] = [];
      for (const line of svgEl.querySelectorAll('line')) {
        if ((line.getAttribute('stroke') ?? '') === color) {
          const x1 = Number(line.getAttribute('x1'));
          const x2 = Number(line.getAttribute('x2'));
          if (Math.abs(x1 - x2) < 1e-6) xs.push(x1);
        }
      }
      return xs;
    }, { color: F7_LINE_COLOR, areaHa: 1 });
    const areaSideL = 4 + (0.5 - (40.32 / 68) / 2) * 92;
    const areaSideR = 4 + (0.5 + (40.32 / 68) / 2) * 92;
    expect(verticalBlue.some((x) => Math.abs(x - areaSideL) < 0.5)).toBe(true);
    expect(verticalBlue.some((x) => Math.abs(x - areaSideR) < 0.5)).toBe(true);
  });
});
