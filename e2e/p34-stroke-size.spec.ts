// =============================================================
// Fase 3/4 — Trazo táctico fino (~mitad) y tamaño inicial ~75 %.
//
// Verifica con la UI REAL:
//   1) El trazo por defecto de línea/flecha/mano alzada es ~0.4 (mitad del
//      0.8 anterior) y el del rectángulo ~0.3 (mitad del 0.6); la punta de
//      flecha se reduce proporcionalmente; el campo (FIELD_LINE_WIDTH=0.3)
//      no se toca.
//   2) Un cono nace con `size` ~75 % de la base y un jugador se renderiza
//      con `scale(0.75)`.
//   3) Los valores PERSISTEN al guardar/reabrir y la migración por
//      `schemaVersion` SOLO encoge una vez (nunca dos).
//
// Capturas en e2e/shots/p34-stroke-size/.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import type { CanvasDocument, CanvasElement } from '../src/app/core/models';
import { TACTICAL_SIZE, MATERIAL_SIZE_RATIO, materialBaseSize } from '../src/app/core/tactic-assets';
import { MATERIAL_BOX } from '../src/app/core/render';

const SHOTS = 'e2e/shots/p34-stroke-size';
fs.mkdirSync(SHOTS, { recursive: true });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RECT_CANON = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

function normToScreen(nx: number, ny: number, box: Box): [number, number] {
  const s = Math.min(box.width / 100, box.height / 80);
  const offX = (box.width - 100 * s) / 2;
  const offY = (box.height - 80 * s) / 2;
  return [box.x + offX + (nx * RECT_CANON.w + RECT_CANON.x) * s, box.y + offY + (ny * RECT_CANON.h + RECT_CANON.y) * s];
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  await ensureFitMode(page);
}

async function ensureFitMode(page: Page): Promise<void> {
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

async function deselect(page: Page, box: Box): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function useDrawTool(page: Page, title: string): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

async function dragDraw(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await hostBox(page);
  const [x1, y1] = normToScreen(from[0], from[1], box);
  const [x2, y2] = normToScreen(to[0], to[1], box);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

async function draw(page: Page, title: string, from: [number, number], to: [number, number]): Promise<void> {
  await useDrawTool(page, title);
  await dragDraw(page, from, to);
  await deselect(page, await hostBox(page));
}

async function placePlayer(page: Page, nx: number, ny: number): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await page.locator('.rail-btn[title="Jugador propio"]').click();
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
  await deselect(page, box);
}

async function placeCone(page: Page, nx: number, ny: number): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
  await deselect(page, box);
}

async function boardSvg(page: Page): Promise<string> {
  return await page.evaluate(() => document.querySelector('.entrenolab-board')?.innerHTML ?? '');
}

async function save(page: Page): Promise<void> {
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

async function reopen(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

function canvasDoc(page: Page): Promise<CanvasDocument> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas as CanvasDocument;
  });
}

/** Encuentra el rectángulo dibujado por sus coordenadas SOLO (no el borde del campo). */
function findDrawnRectStruct(svg: string, ex: number, ey: number, ew: number, eh: number): { strokeWidth: number } | null {
  const re = /<rect\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const tag = m[0];
    const x = parseFloat(tag.match(/\bx="([^"]+)"/)?.[1] ?? 'NaN');
    const y = parseFloat(tag.match(/\by="([^"]+)"/)?.[1] ?? 'NaN');
    const width = parseFloat(tag.match(/\bwidth="([^"]+)"/)?.[1] ?? 'NaN');
    const height = parseFloat(tag.match(/\bheight="([^"]+)"/)?.[1] ?? 'NaN');
    const sw = parseFloat(tag.match(/\bstroke-width="([^"]+)"/)?.[1] ?? 'NaN');
    if (![x, y, width, height, sw].every(Number.isFinite)) continue;
    // Coincidencia por posición y tamaño (tolerancia por decimales de coma flotante).
    if (Math.abs(x - ex) < 0.3 && Math.abs(y - ey) < 0.3 && Math.abs(width - ew) < 0.3 && Math.abs(height - eh) < 0.3) {
      return { strokeWidth: sw };
    }
  }
  return null;
}

test.setTimeout(120_000);

test.describe('Fase 3/4 — trazo fino y tamaño inicial ~75 %', () => {
  test('dibujo: el trazo por defecto es ~mitad (0.4) y el contorno del rect ~0.3', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    // Línea.
    await draw(page, 'Línea', [0.2, 0.3], [0.5, 0.3]);
    let svg = await boardSvg(page);
    expect(svg).toContain('stroke-width="0.4"'); // línea (0.4) ≠ campo (0.3)

    // Flecha: 0.4 + punta (polygon).
    await draw(page, 'Flecha (movimiento)', [0.2, 0.5], [0.5, 0.5]);
    svg = await boardSvg(page);
    expect(svg).toContain('stroke-width="0.4"');
    expect(svg).toContain('<polygon');

    // Mano alzada.
    await draw(page, 'Dibujo a mano alzada', [0.2, 0.7], [0.5, 0.75]);
    svg = await boardSvg(page);
    expect(svg).toContain('stroke-width="0.4"');

    // Rectángulo grande (para identificarlo frente a las marcas del campo).
    await draw(page, 'Rectángulo', [0.1, 0.1], [0.9, 0.9]);
    svg = await boardSvg(page);
    // Posición/tamaño del rect en coords del viewBox (espejo del render). La
    // coordenada x=13.2 descarta el borde del campo (x=4) y sus cajas (pequeñas).
    const ex = 0.1 * RECT_CANON.w + RECT_CANON.x;
    const ey = 0.1 * RECT_CANON.h + RECT_CANON.y;
    const ew = (0.9 - 0.1) * RECT_CANON.w;
    const eh = (0.9 - 0.1) * RECT_CANON.h;
    const rect = findDrawnRectStruct(svg, ex, ey, ew, eh);
    expect(rect, 'el rectángulo dibujado está en el SVG').not.toBeNull();
    expect(rect!.strokeWidth).toBeCloseTo(0.3, 5); // contorno reducido a ~mitad (0.6 → 0.3)

    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/01-trazo-fino.png` });

    // El campo NO se toca: sigue en FIELD_LINE_WIDTH (0.3).
    expect(svg).toContain('stroke-width="0.3"');
  });

  test('tamaño inicial: cono base 0.60 y jugador con scale(0.60) (Decisión del dueño, Fase 3)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    await placeCone(page, 0.3, 0.5);
    await placePlayer(page, 0.6, 0.5);

    const svg = await boardSvg(page);
    // Cono (material PNG): caja 5.2·0.60 = 3.12 (0.75 → 0.60: 20 % menor).
    const coneW = MATERIAL_BOX * materialBaseSize('cone_red');
    expect(svg).toContain(`width="${coneW}"`);
    // Jugador (vectorial): se envuelve con scale(0.60), es decir ~60 % del antiguo 1
    // (Decisión del dueño, Fase 3: los objetos puntuales/players son un 20 % más pequeños).
    expect(svg).toMatch(/scale\(0\.6/);

    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/02-tamano-60.png` });

    // Modelo: el cono persiste `size` = 0.75 × base.
    await save(page);
    const doc = await canvasDoc(page);
    const cone = doc.frames[0].elements.find((e) => e.t === 'cone')!;
    expect(cone.size).toBeCloseTo(TACTICAL_SIZE['cone_red'] * MATERIAL_SIZE_RATIO, 5);
  });

  test('persistencia + migración: encoge UNA vez y no al reabrir', async ({ page }) => {
    // Ejercicio sembrado ANTIGUO: schemaVersion 3, cono size=1.0, texto size=3.
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
      const ex = {
        id: 'old', teamId: 't1', folderId: null, title: 'Antiguo', description: '', explanation: '',
        category: 'Técnica', objectives: [], materials: [], durationMinutes: 0, minPlayers: null, maxPlayers: null,
        loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null,
        isTemplate: false,
        canvas: {
          version: 2, schemaVersion: 3, field: 'full',
          frames: [{
            duration: 1000,
            elements: [
              { id: 'c', t: 'cone', x: 0.3, y: 0.5, size: 1.0, assetKind: 'cone_red', asset: '/assets/tactical/cone-red.png' },
              { id: 't', t: 'text', x: 0.5, y: 0.3, v: 'Hola', size: 3, w: 0.3, h: 0.14, autoH: false },
            ],
          }],
          orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a',
        },
        thumbnail: null, savedAt: now,
      };
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
      localStorage.setItem('entrenolab:players', JSON.stringify([]));
      localStorage.setItem('entrenolab:exercises', JSON.stringify([ex]));
    });

    await page.goto('/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.board-host')).toBeVisible();
    if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();

    // Primera apertura: migra y escalado a la nueva base 0.60 (cone 1.0 → 0.60, texto 3 → 1.80).
    // DECISIÓN DEL DUEÑO (Fase 3): el tamaño base pasa de 0.75 a 0.60 (20 % menor).
    await save(page);
    let doc = await canvasDoc(page);
    expect(doc.schemaVersion).toBe(5);
    let cone = doc.frames[0].elements.find((e) => e.t === 'cone')!;
    let text = doc.frames[0].elements.find((e) => e.t === 'text')!;
    expect(cone.size).toBeCloseTo(1.0 * MATERIAL_SIZE_RATIO, 5);
    expect(text.size).toBeCloseTo(3 * MATERIAL_SIZE_RATIO, 5);

    // Reabrir y volver a guardar: NO se vuelve a encoger (idempotente).
    await reopen(page);
    await save(page);
    doc = await canvasDoc(page);
    cone = doc.frames[0].elements.find((e) => e.t === 'cone')!;
    text = doc.frames[0].elements.find((e) => e.t === 'text')!;
    expect(cone.size).toBeCloseTo(1.0 * MATERIAL_SIZE_RATIO, 5);
    expect(text.size).toBeCloseTo(3 * MATERIAL_SIZE_RATIO, 5);

    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/03-migracion-una-vez.png` });
  });
});
