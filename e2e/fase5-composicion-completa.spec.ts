// =============================================================
// FASE 5 — CAPTURA DE COMPOSICIÓN VERDADERAMENTE COMPLETA.
//
// Construye en la pizarra (con la UI real, no escrituras directas al
// modelo) UNA sola composición con un elemento de CADA familia
// soportada: línea, flecha, flecha doble, curva derecha, curva
// izquierda, zigzag (conducción), mano alzada, rect perímetro, rect
// relleno, elipse perímetro, elipse relleno, texto, jugador propio,
// jugador rival, portero, balón, cono, maniquí, mini portería,
// pértiga, marcador, valla, aro, escalera, banderín, minitrampolín,
// diana, red, balón morado, marcador C, peto, chaleco, BOSU, fitball,
// pica. Al terminar: nada seleccionado, sin paneles abiertos, y se
// asevera que CADA familia está presente en el modelo persistido.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase5-composicion';
fs.mkdirSync(SHOTS, { recursive: true });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
const VBW = 100;
const VBH = 80;

function normToScreen(nx: number, ny: number, box: Box, fit: 'contain' | 'height' = 'contain'): [number, number] {
  const s = fit === 'height' ? box.height / RECT.h : Math.min(box.width / VBW, box.height / VBH);
  const offX = (box.width - VBW * s) / 2;
  const offY = (box.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  const ox = box.width / 2;
  const oy = box.height / 2;
  return [box.x + ox + (cx - ox), box.y + oy + (cy - oy)];
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([{ id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' }]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function dismissHelp(page: Page): Promise<void> {
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

async function openBoardDesktop(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await dismissHelp(page);
}

async function useTool(page: Page, title: string, category?: string): Promise<void> {
  if (category) await page.locator('.tools-cat', { hasText: category }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

async function deselect(page: Page): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
}

async function placePlayer(page: Page, title: string, nx: number, ny: number, tray = false): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  if (tray) {
    await page.locator('.side-panel-left').first().waitFor();
    await page.locator(`.tray-player[title="${title}"]`).click();
  } else {
    await page.locator(`.rail-btn[title="${title}"]`).click();
  }
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
  await deselect(page);
}

async function placeMaterial(page: Page, tool: string, nx: number, ny: number): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  const card = page.locator('.tools-material-card', { has: page.locator(`.rail-btn[title="${tool}"]`) });
  const variantCount = await card.locator('.variant-swatch').count();
  if (variantCount > 0) await card.locator('.variant-swatch').first().click();
  await card.locator(`.rail-btn[title="${tool}"]`).click();
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
  await deselect(page);
}

async function dragDraw(page: Page, tool: string, from: [number, number], to: [number, number], fill?: boolean): Promise<void> {
  await useTool(page, tool, 'Dibujo');
  if (fill != null) await page.locator('.tools-caption .chip', { hasText: fill ? 'Relleno' : 'Perímetro' }).click();
  const box = await hostBox(page);
  const [x1, y1] = normToScreen(from[0], from[1], box);
  const [x2, y2] = normToScreen(to[0], to[1], box);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

async function placeText(page: Page, nx: number, ny: number, value: string): Promise<void> {
  await useTool(page, 'Texto', 'Dibujo');
  const box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
  const ta = page.locator('.studio-panel .inspector textarea');
  await ta.fill(value);
  await ta.dispatchEvent('change');
  await ta.evaluate((el) => (el as HTMLElement).blur());
  await page.waitForTimeout(80);
  await deselect(page);
}

function elements(page: Page): Promise<Array<{ t: string; side?: string; type?: string }>> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas.frames[0].elements as Array<{ t: string; side?: string; type?: string }>;
  });
}

/** Coordenadas de la composición ordenada: zona SUPERIOR para objetos puntuales
 *  (jugadores/materiales) en una rejilla compacta; zona INFERIOR para las formas
 *  (líneas/flechas/curvas/zigzag/mano alzada) y para rect/elipse en áreas libres,
 *  de modo que nada se solape y la composición sea legible. */
function pt(col: number, row: number): [number, number] {
  // Rejilla 10 columnas × 3 filas en la franja superior (y 0.10..0.34).
  return [0.1 + col * 0.08, 0.16 + row * 0.09];
}

test('composición completa: cada familia presente en el modelo, nada seleccionado y sin paneles', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await seed(page);
  await openBoardDesktop(page);

  // 1) Jugadores y portero (fila superior, a la izquierda).
  await placePlayer(page, 'Jugador propio', ...pt(0, 0));
  await placePlayer(page, 'Jugador rival', ...pt(1, 0));
  await placePlayer(page, 'Portero', ...pt(2, 0), true);

  // 2) Materiales (cada familia puntual) en la fila 1-2 de la franja superior.
  const materials: Array<[string, number, number]> = [
    ['Balón', 0, 1], ['Fitball', 1, 1], ['Balón morado', 2, 1], ['Cono', 3, 1],
    ['Marcador', 4, 1], ['Banderín', 5, 1], ['Diana', 6, 1], ['Marcador C', 7, 1],
    ['Pica coloreable', 8, 1], ['Pértiga / poste', 9, 1],
    ['Maniquí', 0, 2], ['Mini portería', 1, 2], ['Red', 2, 2], ['Valla', 3, 2],
    ['Aro', 4, 2], ['Escalera', 5, 2], ['Minitrampolín', 6, 2], ['Peto', 7, 2],
    ['Chaleco lastrado', 8, 2], ['BOSU', 9, 2],
  ];
  for (const [tool, c, r] of materials) await placeMaterial(page, tool, ...pt(c, r));

  // 3) Formas (dibujo por arrastre) en la mitad superior/central; el TEXTO queda en
  //    la esquina inferior-izquierda despejada (ninguna línea lo cruza).
  await dragDraw(page, 'Línea', [0.16, 0.42], [0.4, 0.46]);
  await dragDraw(page, 'Flecha (movimiento)', [0.5, 0.42], [0.72, 0.48]);
  await dragDraw(page, 'Flecha doble sentido', [0.16, 0.56], [0.4, 0.62]);
  await dragDraw(page, 'Curva derecha', [0.5, 0.56], [0.72, 0.62]);
  await dragDraw(page, 'Curva izquierda', [0.16, 0.7], [0.4, 0.76]);
  await dragDraw(page, 'Conducción (zigzag)', [0.5, 0.7], [0.72, 0.76]);
  await dragDraw(page, 'Dibujo a mano alzada', [0.3, 0.5], [0.42, 0.54]);
  await dragDraw(page, 'Rectángulo', [0.78, 0.42], [0.93, 0.5]); // relleno (libre a la derecha)
  await dragDraw(page, 'Rectángulo', [0.78, 0.56], [0.93, 0.64], false); // perímetro
  await dragDraw(page, 'Círculo / elipse', [0.78, 0.68], [0.93, 0.78]); // relleno
  await dragDraw(page, 'Círculo / elipse', [0.6, 0.66], [0.72, 0.73], false); // perímetro
  await placeText(page, 0.4, 0.9, 'Ejercicio completo\nConservación');

  // 4) Nada seleccionado y sin paneles abiertos.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await expect(page.locator('.context-bar')).toHaveCount(0);
  await expect(page.locator('.studio-panel, .side-panel-left, .side-panel-right')).toHaveCount(0);
  await expect(page.locator('.reshandle')).toHaveCount(0);

  // 5) Captura (en la pizarra, antes de guardar).
  await page.locator('.board-host').screenshot({ path: `${SHOTS}/composicion-completa.png` });

  // 6) Guardar y aseverar que CADA familia está en el modelo.
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  const els = await elements(page);

  const familyTypes = ['line', 'arrow', 'doubleArrow', 'curve', 'dribble', 'freehand', 'rect', 'ellipse', 'text',
    'player', 'ball', 'cone', 'mannequin', 'minigoal', 'pole', 'marker', 'hurdle', 'ring', 'ladder', 'flag',
    'trampoline', 'target', 'net', 'vball', 'coachC', 'peto', 'chaleco', 'bosu', 'fitball', 'pica'];
  for (const t of familyTypes) {
    expect(els.some((e) => e.t === t), `familia «${t}» presente en el modelo`).toBe(true);
  }
  // Rival y portero.
  expect(els.some((e) => e.t === 'player' && e.side === 'rival'), 'hay jugador RIVAL').toBe(true);
  expect(els.some((e) => e.t === 'player' && (e.type === 'goalkeeper')), 'hay PORTERO (goalkeeper)').toBe(true);
});
