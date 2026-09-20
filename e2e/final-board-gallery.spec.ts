// =============================================================
// Galería final — 10 escenas construidas a través de la UI real.
//
// Regla central: ningún objeto del campo se escribe directamente en
// localStorage. Todo se coloca con clics/arrastres reales sobre la
// pizarra (paneles, herramientas, asas, variantes). Solo el equipo y
// la plantilla se siembran vía addInitScript.
//
// Verificación por escena:
//   1) Guardar → reabrir → re-guardar → el documento persistido
//      (frames / field / elements) es IGUAL (deep-equal).
//   2) Exportar PNG real, comprobar firma + dimensiones (1600x1280
//      horizontal) y dif de píxeles en la región de los centros de
//      elementos colocados frente al campo vacío.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';
import type { CanvasDocument, CanvasElement } from '../src/app/core/models';
import { TACTICAL_SIZE, MATERIAL_SIZE_RATIO } from '../src/app/core/tactic-assets';
import { longPress, fillBoardTitle, toggleFillScreen } from './gesture-helpers';

const SHOTS = 'e2e/shots/final-board-gallery';
fs.mkdirSync(SHOTS, { recursive: true });

// -------------------------------------------------------------
// Geometría (espejo del render SVG y del mapeo norm→pantalla).
// -------------------------------------------------------------
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normToScreen(nx: number, ny: number, box: Box): [number, number] {
  const rect = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
  const s = Math.min(box.width / 100, box.height / 80);
  const offX = (box.width - 100 * s) / 2;
  const offY = (box.height - 80 * s) / 2;
  return [box.x + offX + (nx * rect.w + rect.x) * s, box.y + offY + (ny * rect.h + rect.y) * s];
}

/** Centro geométrico (normalizado) de un elemento; espejo de board-selection. */
function elCenter(el: CanvasElement): [number, number] {
  const t = el.t;
  if (t === 'rect' || t === 'zone' || t === 'ellipse' || t === 'text') {
    return [(el.x ?? 0) + (el.w ?? 0) / 2, (el.y ?? 0) + (el.h ?? 0) / 2];
  }
  if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    return [((el.x1 ?? 0) + (el.x2 ?? 0)) / 2, ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2];
  }
  if (t === 'curve') {
    return [
      ((el.x1 ?? 0) + (el.c1x ?? 0) + (el.x2 ?? 0)) / 3,
      ((el.y1 ?? 0) + (el.c1y ?? 0) + (el.y2 ?? 0)) / 3,
    ];
  }
  if (t === 'freehand') {
    const pts = el.points ?? [];
    if (!pts.length) return [el.x ?? 0, el.y ?? 0];
    return [
      pts.reduce((a, p) => a + p[0], 0) / pts.length,
      pts.reduce((a, p) => a + p[1], 0) / pts.length,
    ];
  }
  return [el.x ?? 0, el.y ?? 0];
}

function isPointLike(t: string): boolean {
  return (
    t === 'player' ||
    t === 'ball' ||
    t === 'cone' ||
    t === 'text' ||
    t === 'mannequin' ||
    t === 'minigoal' ||
    t === 'pole' ||
    t === 'marker' ||
    t === 'hurdle' ||
    t === 'ring' ||
    t === 'ladder' ||
    t === 'flag' ||
    t === 'trampoline' ||
    t === 'target' ||
    t === 'net' ||
    t === 'vball' ||
    t === 'coachC' ||
    t === 'peto' ||
    t === 'chaleco' ||
    t === 'bosu' ||
    t === 'fitball' ||
    t === 'pica'
  );
}

function visualBBox(el: CanvasElement): { x: number; y: number; w: number; h: number } {
  const t = el.t;
  if (isPointLike(t)) {
    const hs = 0.055;
    return { x: (el.x ?? 0) - hs, y: (el.y ?? 0) - hs, w: hs * 2, h: hs * 2 };
  }
  if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    const x1 = el.x1 ?? 0,
      y1 = el.y1 ?? 0,
      x2 = el.x2 ?? 0,
      y2 = el.y2 ?? 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  if (t === 'curve') {
    const x1 = el.x1 ?? 0,
      y1 = el.y1 ?? 0,
      x2 = el.x2 ?? 0,
      y2 = el.y2 ?? 0;
    const cx = el.c1x ?? (x1 + x2) / 2,
      cy = el.c1y ?? (y1 + y2) / 2;
    return {
      x: Math.min(x1, x2, cx),
      y: Math.min(y1, y2, cy),
      w: Math.max(x1, x2, cx) - Math.min(x1, x2, cx),
      h: Math.max(y1, y2, cy) - Math.min(y1, y2, cy),
    };
  }
  if (t === 'freehand') {
    const pts = el.points ?? [];
    if (!pts.length) return { x: el.x ?? 0, y: el.y ?? 0, w: 0, h: 0 };
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: el.x ?? 0, y: el.y ?? 0, w: el.w ?? 0, h: el.h ?? 0 };
}

function rotHandle(el: CanvasElement): { x: number; y: number } {
  const bb = visualBBox(el);
  if (bb.w < 0.001 && bb.h < 0.001) return { x: bb.x, y: bb.y - 0.12 };
  return { x: bb.x + bb.w / 2, y: bb.y - 0.12 };
}

function boxHandles(el: CanvasElement): Array<{ x: number; y: number; key: string }> {
  const t = el.t;
  if (t !== 'rect' && t !== 'zone' && t !== 'ellipse' && t !== 'text') return [];
  const x = el.x ?? 0,
    y = el.y ?? 0,
    w = el.w ?? 0,
    h = el.h ?? 0;
  return [
    { x, y, key: 'tl' },
    { x: x + w, y, key: 'tr' },
    { x, y: y + h, key: 'bl' },
    { x: x + w, y: y + h, key: 'br' },
  ];
}

function segHandles(el: CanvasElement): Array<{ x: number; y: number; key: string }> {
  const t = el.t;
  if (!(
    t === 'line' ||
    t === 'arrow' ||
    t === 'curve' ||
    t === 'doubleArrow' ||
    t === 'measure' ||
    t === 'dribble'
  ))
    return [];
  const hs = [
    { x: el.x1 ?? 0, y: el.y1 ?? 0, key: 'x1' },
    { x: el.x2 ?? 0, y: el.y2 ?? 0, key: 'x2' },
  ];
  if (t === 'curve') hs.push({ x: el.c1x ?? 0, y: el.c1y ?? 0, key: 'c1' });
  return hs;
}

// -------------------------------------------------------------
// Seed: igual al de matrix.spec (con guarda) para que la pizarra
// arranque SIN ejercicios y el ciclo guardar/reabrir no borre nada.
// -------------------------------------------------------------
async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify([
        {
          id: 'p1',
          teamId: 't1',
          name: 'Marcos',
          number: 2,
          position: 'DF',
          color: '#1a73e8',
          active: true,
          createdAt: now,
        },
        {
          id: 'p2',
          teamId: 't1',
          name: 'Pau',
          number: 10,
          position: 'MF',
          color: '#c0392b',
          active: true,
          createdAt: now,
        },
      ]),
    );
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem(
      'entrenolab:folders',
      JSON.stringify([{ id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' }]),
    );
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (
    await page
      .locator('.help-close')
      .isVisible()
      .catch(() => false)
  )
    await page.locator('.help-close').click();
  // Esta galería verifica colocación → persistencia → exportación PNG a partir del
  // mapeo norm→pantalla con letterbox "meet" (campo completo). El modo por defecto
  // en móvil pasó a ser "Llenar pantalla" (campo escalado a llenar la altura, que
  // desborda el ancho); para que la colocación aterrice en el mismo norm que el
  // helper, se fuerza aquí el modo "Campo completo". El modo "Llenar pantalla" con
  // su round-trip y sus medidas se verifica aparte en fase2-mobile-field.spec.ts.
  await ensureFitMode(page);
}

/** Deja la pizarra en "Campo completo" (letterbox a todo el host) si estaba en
 *  "Llenar pantalla", para que el helper norm→pantalla (fit) coincida con el render. */
async function ensureFitMode(page: Page): Promise<void> {
  const fill = await page
    .locator('.board-host')
    .evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await toggleFillScreen(page);
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}

async function dismissHelp(page: Page): Promise<void> {
  if (
    await page
      .locator('.help-close')
      .isVisible()
      .catch(() => false)
  )
    await page.locator('.help-close').click();
}

async function openProps(page: Page): Promise<void> {
  if (
    await page
      .locator('.studio-panel')
      .isVisible()
      .catch(() => false)
  )
    return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

async function useTool(page: Page, title: string, category?: string): Promise<void> {
  if (category) await openCat(page, category);
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
    return;
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

/** FASE B (paneles persistentes): abre la categoría sin re-togglear una que ya está
 *  desplegada (re-clickar la misma la cerraría). Distingue Jugadores de Material/Dibujo
 *  por el aria-label del panel para no confundir categorías. */
async function openCat(page: Page, category: string): Promise<void> {
  const probe: Record<string, string> = {
    Jugadores: '.side-panel-left[aria-label="Jugadores"]',
    Material: '.side-panel-left[aria-label="Herramientas de Material"]',
    Dibujo: '.side-panel-left[aria-label="Herramientas de Dibujo"]',
  };
  if (
    await page
      .locator(probe[category])
      .isVisible()
      .catch(() => false)
  )
    return;
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: category }).click();
  await expect(page.locator(probe[category])).toBeVisible();
}

/** FASE B (regla C): en móvil vertical el panel persistente (300px, left:0) tapa el
 *  centro del campo. Lo cerramos con su X (.panel-close) ANTES de tocar/arrastrar el
 *  campo para que el punto de colocación quede accesible. Cerrar el panel NO desarma una
 *  colocación ya armada. En escritorio el panel no tapa el campo, así que no se toca. */
async function closePanelIfBlocking(page: Page): Promise<void> {
  const vp = await page.viewportSize();
  if (!vp || vp.width >= 700) return;
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function save(page: Page): Promise<void> {
  // A5: el guardado se BLOQUEA si el título está vacío. Solo se fija un título
  // cuando el modelado realmente lo necesita (campo vacío o ejercicio nuevo sin
  // metaTitle persistido); si ya hay un título — por la UI o del ejercicio que se
  // acaba de reabrir — no se sobrescribe ni se abre el panel en balde.
  const hasTitle = await page
    .evaluate(() => {
      const raw = localStorage.getItem('entrenolab:exercises');
      let persisted = '';
      if (raw) {
        try {
          const list = JSON.parse(raw) as Array<{ metaTitle?: string }>;
          persisted = (list?.[0]?.metaTitle ?? '').trim();
        } catch {
          persisted = '';
        }
      }
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Título del ejercicio"]',
      );
      const inputTitle = (input && input.value ? input.value : '').trim();
      return persisted !== '' || inputTitle !== '';
    })
    .catch(() => false);
  if (!hasTitle) await fillBoardTitle(page, 'Galería');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

async function reopen(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
}

function canvasDoc(page: Page): Promise<CanvasDocument> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas as CanvasDocument;
  });
}

async function elementCount(page: Page): Promise<number> {
  return Number(await page.locator('.field-count').innerText());
}

/** Deselecciona (clic en zona vacía) y deja la herramienta en Seleccionar. */
async function deselect(page: Page, box: Box): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

// -------------------------------------------------------------
// Colocación real de elementos.
// -------------------------------------------------------------
/** Bounding box ACTUAL del campo. En móvil el host se redimensiona/desplaza al
 *  abrir/cerrar paneles, así que se re-captura justo antes de cada interacción. */
async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

async function placePlayer(
  page: Page,
  box: Box,
  title: string,
  nx: number,
  ny: number,
): Promise<void> {
  await openCat(page, 'Jugadores');
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
  } else {
    await page.locator(`.rail-btn[title="${title}"]`).click();
  }
  box = await hostBox(page);
  await closePanelIfBlocking(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y, { button: 'right' });
}

async function placeTrayPlayer(
  page: Page,
  box: Box,
  title: string,
  nx: number,
  ny: number,
): Promise<void> {
  await openCat(page, 'Jugadores');
  await page.locator(`.tray-player[title="${title}"]`).click();
  box = await hostBox(page);
  await closePanelIfBlocking(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
}

/** Coloca un material (con variante opcional elegida antes de armar). */
async function placeMaterial(
  page: Page,
  box: Box,
  tool: string,
  nx: number,
  ny: number,
  variantIndex?: number,
): Promise<void> {
  await openCat(page, 'Material');
  if (variantIndex != null) {
    const card = page.locator('.tools-material-card', {
      has: page.locator(`.rail-btn[title="${tool}"]`),
    });
    const variantCount = await card.locator('.variant-swatch').count();
    if (variantCount > 0) await card.locator('.variant-swatch').nth(variantIndex).click();
  }
  await page.locator(`.rail-btn[title="${tool}"]`).click();
  box = await hostBox(page);
  await closePanelIfBlocking(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
  // Un material se auto-selecciona al colocarlo y abre el panel Propiedades,
  // que en móvil tapa el campo y bloquea el siguiente clic. Se deselecciona.
  await deselect(page, box);
}

/** Arrastra para dibujar una forma/línea entre dos puntos normalizados. */
async function dragDraw(
  page: Page,
  box: Box,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  box = await hostBox(page);
  const [x1, y1] = normToScreen(from[0], from[1], box);
  const [x2, y2] = normToScreen(to[0], to[1], box);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

/** Dibuja una forma configurada con color y relleno desde el rail de herramientas. */
async function drawShape(
  page: Page,
  box: Box,
  tool: string,
  from: [number, number],
  to: [number, number],
  colorIndex?: number,
  fill?: boolean,
): Promise<void> {
  await openCat(page, 'Dibujo');
  await page.locator(`.rail-btn[title="${tool}"]`).click();
  if (colorIndex != null) await page.locator('.tools-caption .swatch').nth(colorIndex).click();
  if (fill != null)
    await page.locator('.tools-caption .chip', { hasText: fill ? 'Relleno' : 'Perímetro' }).click();
  await closePanelIfBlocking(page);
  await dragDraw(page, box, from, to);
}

/** Coloca un texto y rellena su contenido multilínea. */
async function placeText(
  page: Page,
  box: Box,
  nx: number,
  ny: number,
  value: string,
): Promise<void> {
  await useTool(page, 'Texto', 'Dibujo');
  box = await hostBox(page);
  await closePanelIfBlocking(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
  const ta = page.locator('.studio-panel .inspector textarea');
  await ta.fill(value);
  await ta.dispatchEvent('change');
  await ta.evaluate((el) => (el as HTMLElement).blur());
  await page.waitForTimeout(120);
  await deselect(page, box);
}

/** Selecciona el elemento situado en la coordenada normalizada. */
async function selectAt(page: Page, box: Box, nx: number, ny: number): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  // Fase 3: el clic corto selecciona (muestra asas) SIN abrir el menú contextual.
  await page.mouse.click(x, y);
  await expect(page.locator('.inspector')).toBeVisible();
}

async function dragHandle(
  page: Page,
  box: Box,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  box = await hostBox(page);
  const [fx, fy] = normToScreen(from[0], from[1], box);
  const [tx, ty] = normToScreen(to[0], to[1], box);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

/** Fase 6: rotación ±90° desde la BARRA DE CONTEXTO (se retira la manija continua).
 *  Fase 3: el menú contextual SOLO se abre por PULSACIÓN LARGA sobre el elemento. */
async function dragRotHandle(page: Page, el: CanvasElement, box: Box): Promise<void> {
  const [nx, ny] = elCenter(el);
  const [sx, sy] = normToScreen(nx, ny, box);
  await longPress(page, sx, sy);
  await expect(page.locator('.context-bar')).toBeVisible();
  await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
}

async function setInspNum(page: Page, label: string, value: string): Promise<void> {
  const input = page
    .locator('.studio-panel .inspector .field', { hasText: label })
    .locator('input');
  await input.fill(value);
  await input.press('Tab');
}

async function setInspColor(page: Page, index: number): Promise<void> {
  await page
    .locator('.studio-panel .inspector .field', { hasText: 'Color' })
    .locator('.swatch')
    .nth(index)
    .click();
}

async function setInspChip(page: Page, label: string, chipText: string): Promise<void> {
  await page
    .locator('.studio-panel .inspector .field', { hasText: label })
    .locator('.chip', { hasText: chipText })
    .click();
}

// -------------------------------------------------------------
// Exportación real de PNG y dif de píxeles por región.
// -------------------------------------------------------------
async function exportPngBuf(page: Page): Promise<Buffer> {
  const dlPromise = page.waitForEvent('download');
  await page.locator('[aria-label="Exportar"]').click();
  await expect(page.locator('.top-pop-export')).toBeVisible();
  await page.locator('.rail-btn[title="Descargar PNG"]').click();
  const dl = await dlPromise;
  const p = await dl.path();
  const buf = fs.readFileSync(p!);
  expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47');
  expect(buf.readUInt32BE(16)).toBe(1600);
  expect(buf.readUInt32BE(20)).toBe(1280);
  return buf;
}

async function pngRegionDiff(
  page: Page,
  a: Buffer,
  b: Buffer,
  nx: number,
  ny: number,
): Promise<number> {
  return await page.evaluate(
    async ({ a, b, nx, ny }) => {
      const load = (b64: string) =>
        new Promise<HTMLCanvasElement>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            c.getContext('2d')!.drawImage(img, 0, 0);
            resolve(c);
          };
          img.src = 'data:image/png;base64,' + b64;
        });
      const [ca, cb] = await Promise.all([load(a), load(b)]);
      const W = ca.width,
        H = ca.height;
      const sx = Math.round(((nx * 92 + 4) / 100) * W);
      const sy = Math.round(((ny * (92 / (105 / 68)) + 10) / 80) * H);
      const ctxA = ca.getContext('2d')!;
      const ctxB = cb.getContext('2d')!;
      let changed = 0;
      for (let dy = -80; dy <= 80; dy += 3) {
        for (let dx = -80; dx <= 80; dx += 3) {
          const pa = ctxA.getImageData(sx + dx, sy + dy, 1, 1).data;
          const pb = ctxB.getImageData(sx + dx, sy + dy, 1, 1).data;
          if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]) > 60)
            changed++;
        }
      }
      return changed;
    },
    { a: a.toString('base64'), b: b.toString('base64'), nx, ny },
  );
}

/** Captura el campo vacío (línea base) exportando antes de colocar nada. */
async function captureBaseline(page: Page): Promise<Buffer> {
  await dismissHelp(page);
  const base = await exportPngBuf(page);
  await page.keyboard.press('Escape');
  return base;
}

// -------------------------------------------------------------
// Verificación compartida por escena.
// -------------------------------------------------------------
async function verifyPersistence(page: Page): Promise<CanvasDocument> {
  await save(page);
  const a = await canvasDoc(page);
  await reopen(page);
  await save(page);
  const b = await canvasDoc(page);
  expect(b).toEqual(a);
  return a;
}

async function verifyExport(
  page: Page,
  baseline: Buffer,
  checkPoints: Array<[number, number]>,
): Promise<void> {
  await reopen(page);
  const withEl = await exportPngBuf(page);
  expect(withEl.length).toBeGreaterThan(1000);
  for (const [nx, ny] of checkPoints) {
    const changed = await pngRegionDiff(page, baseline, withEl, nx, ny);
    expect(changed, `dif de píxeles en (${nx}, ${ny})`).toBeGreaterThan(0);
  }
}

function boxCenter(x1: number, y1: number, x2: number, y2: number): [number, number] {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

test.setTimeout(120_000);

test.describe('Galería final — escenas a través de la UI real', () => {
  // =====================================================================
  // 1. Jugadores y señalización
  // =====================================================================
  test('01-jugadores-senalizacion', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    await placePlayer(page, box, 'Jugador propio', 0.14, 0.16);
    await placePlayer(page, box, 'Jugador rival', 0.31, 0.16);
    await placeTrayPlayer(page, box, 'Jugador Azul', 0.48, 0.16);
    await placeTrayPlayer(page, box, 'Jugador Azul', 0.65, 0.16);
    await placeMaterial(page, box, 'Balón', 0.82, 0.16);
    // Conos de varios colores (variantes).
    await placeMaterial(page, box, 'Cono', 0.11, 0.45, 0); // rojo
    await placeMaterial(page, box, 'Cono', 0.23, 0.45, 1); // amarillo
    await placeMaterial(page, box, 'Cono', 0.35, 0.45, 2); // azul
    await placeMaterial(page, box, 'Cono', 0.47, 0.45, 3); // naranja
    await placeMaterial(page, box, 'Cono', 0.59, 0.45, 4); // blanco
    await placeMaterial(page, box, 'Cono', 0.71, 0.45, 5); // azul2
    await placeMaterial(page, box, 'BOSU', 0.85, 0.45);
    await placeMaterial(page, box, 'Banderín', 0.11, 0.68);
    await placeMaterial(page, box, 'Chino', 0.29, 0.7);
    await placeMaterial(page, box, 'Pica', 0.85, 0.7);

    await expect(page.locator('.field-count')).toHaveText('15');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/01-jugadores-senalizacion.png` });

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(15);
    await verifyExport(page, baseline, [
      [0.14, 0.16],
      [0.47, 0.45],
      [0.85, 0.45],
      [0.29, 0.7],
    ]);
  });

  // =====================================================================
  // 2. Material de entrenamiento
  // =====================================================================
  test('02-material-entrenamiento', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    // Fila superior: maniquí y fila, miniportería, pértiga.
    await placeMaterial(page, box, 'Maniquí individual', 0.12, 0.18, 0);
    await placeMaterial(page, box, 'Maniquí individual', 0.28, 0.18, 1);
    await placeMaterial(page, box, 'Miniportería', 0.45, 0.18);
    await placeMaterial(page, box, 'Pértiga / poste', 0.62, 0.18);
    // Fila central: valla, aros, escaleras, minitrampolín.
    await placeMaterial(page, box, 'Valla', 0.1, 0.45);
    await placeMaterial(page, box, 'Aro', 0.24, 0.45, 0);
    await placeMaterial(page, box, 'Aro', 0.38, 0.45, 1);
    await placeMaterial(page, box, 'Escalera', 0.53, 0.45, 0);
    await placeMaterial(page, box, 'Escalera', 0.67, 0.45, 1);
    await placeMaterial(page, box, 'Minitrampolín', 0.82, 0.45);
    // Fila inferior: peto, chaleco, BOSU, fitball.
    await placeMaterial(page, box, 'Peto', 0.12, 0.72);
    await placeMaterial(page, box, 'Chaleco lastrado', 0.26, 0.72);
    await placeMaterial(page, box, 'BOSU', 0.4, 0.72);
    await placeMaterial(page, box, 'Fitball', 0.54, 0.72);

    await expect(page.locator('.field-count')).toHaveText('14');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/02-material-entrenamiento.png` });

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(14);
    // Fase 3: cada material de la escena nace con su tamaño base normalizado.
    const vectorMat = ['coachC', 'peto', 'chaleco', 'bosu', 'fitball', 'pica'];
    for (const m of doc.frames[0].elements) {
      const key = (m.assetKind ?? m.t) as string;
      if (TACTICAL_SIZE[key] !== undefined && (m.assetKind || vectorMat.includes(m.t))) {
        // Fase 4: el tamaño inicial se reduce a 0.75 × la base antigua.
        expect(m.size, `tamaño base normalizado de ${key}`).toBeCloseTo(
          TACTICAL_SIZE[key] * MATERIAL_SIZE_RATIO,
          5,
        );
      }
    }
    await verifyExport(page, baseline, [
      [0.28, 0.18],
      [0.53, 0.45],
      [0.4, 0.72],
    ]);
  });

  // =====================================================================
  // 3. Dibujo de formas
  // =====================================================================
  test('03-dibujo-formas', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    // Solo perímetro.
    await drawShape(page, box, 'Rectángulo', [0.1, 0.11], [0.22, 0.2], undefined, false);
    await deselect(page, box);
    await drawShape(page, box, 'Círculo / elipse', [0.31, 0.11], [0.45, 0.2], 1, false);
    await deselect(page, box);
    // Con relleno translúcido.
    await drawShape(page, box, 'Rectángulo', [0.55, 0.11], [0.7, 0.2], 2, true);
    await deselect(page, box);
    await drawShape(page, box, 'Círculo / elipse', [0.78, 0.11], [0.92, 0.2], 3, true);
    await deselect(page, box);
    await drawShape(page, box, 'Rectángulo', [0.1, 0.28], [0.3, 0.38], 4, true);
    await deselect(page, box);
    // Líneas sólida / discontinua / puntos.
    await drawShape(page, box, 'Línea', [0.4, 0.28], [0.58, 0.31], 0);
    await deselect(page, box);
    await drawShape(page, box, 'Línea', [0.66, 0.28], [0.86, 0.31], 1);
    await deselect(page, box);
    await drawShape(page, box, 'Línea', [0.4, 0.36], [0.58, 0.38], 3);
    await deselect(page, box);
    // Flechas.
    await drawShape(page, box, 'Flecha (movimiento)', [0.66, 0.36], [0.86, 0.42], 0);
    await deselect(page, box);
    await drawShape(page, box, 'Flecha doble sentido', [0.1, 0.48], [0.28, 0.52], 1);
    await deselect(page, box);
    await drawShape(page, box, 'Curva derecha', [0.36, 0.46], [0.56, 0.56], 2);
    await deselect(page, box);
    // Zigzag, medición, mano alzada, texto multilínea.
    await drawShape(page, box, 'Conducción (zigzag)', [0.64, 0.48], [0.84, 0.56], 1);
    await deselect(page, box);
    await drawShape(page, box, 'Línea', [0.1, 0.66], [0.3, 0.68], 3);
    await deselect(page, box);
    await drawShape(page, box, 'Dibujo a mano alzada', [0.4, 0.66], [0.6, 0.76], 0);
    await deselect(page, box);
    await placeText(page, box, 0.68, 0.7, 'Rondos 4v2\nConservación\nPase en superioridad');
    await deselect(page, box);

    await expect(page.locator('.field-count')).toHaveText('15');
    // Ajustar grosor/trazo de una línea por el inspector.
    await selectAt(page, box, 0.49, 0.295);
    await setInspNum(page, 'Grosor', '1.6');
    await setInspChip(page, 'Trazo', 'Discontinuo');
    await setInspColor(page, 2);
    await deselect(page, box);

    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/03-dibujo-formas.png` });

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(15);
    // Regiones fiables para el dif: línea sólida (trazo en el centro) y texto.
    const solidLine = doc.frames[0].elements.find(
      (e) => e.t === 'line' && (e.lineStyle ?? 'solid') === 'solid',
    )!;
    const textEl = doc.frames[0].elements.find((e) => e.t === 'text')!;
    await verifyExport(page, baseline, [elCenter(solidLine), elCenter(textEl)]);
  });

  // =====================================================================
  // 4. Interacción seleccionada
  // =====================================================================
  test('04-interaccion-seleccionada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    // Construir los tres objetos.
    await drawShape(page, box, 'Rectángulo', [0.6, 0.16], [0.8, 0.3]);
    await deselect(page, box);
    await placeMaterial(page, box, 'Cono', 0.72, 0.62);
    await deselect(page, box);
    await drawShape(page, box, 'Curva derecha', [0.2, 0.3], [0.5, 0.52]);
    await deselect(page, box);
    await expect(page.locator('.field-count')).toHaveText('3');

    // Guardar para tener el modelo persistido (y poder calcular asas/manijas reales).
    await save(page);
    const els0 = (await canvasDoc(page)).frames[0].elements;
    const rect = els0.find((e) => e.t === 'rect')!;
    const cone0 = els0.find((e) => e.t === 'cone')!;
    const curve = els0.find((e) => e.t === 'curve')!;

    await reopen(page);
    const box2 = (await page.locator('.board-host').boundingBox())!;

    // Rotar el rectángulo con la MANIJA.
    await selectAt(page, box2, ...elCenter(rect));
    await dragRotHandle(page, rect, box2);
    await deselect(page, box2);

    // Rotar el material con la BARRA DE CONTEXTO (Fase 6); los materiales NO se
    // redimensionan (Fase 1: no hay control Tamaño ni asas).
    await selectAt(page, box2, ...elCenter(cone0));
    await expect(
      page.locator('.studio-panel .inspector .field', { hasText: 'Tamaño' }),
    ).toHaveCount(0);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const [ccx, ccy] = normToScreen(...elCenter(cone0), box2);
    await page.mouse.click(ccx, ccy);
    await dragRotHandle(page, cone0, box2);
    await deselect(page, box2);

    // Seleccionar la CURVA por último → muestra extremos + C1 + manija de rotación.
    // Se pincha el MIDPOINT de la Bézier (t=0,5): la tolerancia de selección es en px,
    // y el baricentro de los 3 puntos de control queda FUERA del arco.
    await selectAt(
      page,
      box2,
      (curve.x1 + 2 * (curve.c1x ?? curve.x1) + curve.x2) / 4,
      (curve.y1 + 2 * (curve.c1y ?? curve.y1) + curve.y2) / 4,
    );
    await expect(page.locator('.inspector-actions')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/04-interaccion-seleccionada.png` });

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(3);
    const curveF = doc.frames[0].elements.find((e) => e.t === 'curve')!;
    expect(typeof curveF.c1x).toBe('number');
    const rectF = doc.frames[0].elements.find((e) => e.t === 'rect')!;
    expect(Math.abs(rectF.rot ?? 0)).toBeGreaterThan(1);
    const coneF = doc.frames[0].elements.find((e) => e.t === 'cone')!;
    // Fase 1: el material NO se redimensiona (conserva su tamaño base); la rotación sí.
    expect(Math.abs(coneF.rot ?? 0)).toBeGreaterThan(1);
    await verifyExport(page, baseline, [elCenter(curveF), elCenter(coneF)]);
  });

  // =====================================================================
  // 5. Ejercicio final limpio (solo el campo)
  // =====================================================================
  test('05-ejercicio-final-limpio', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    await placePlayer(page, box, 'Jugador propio', 0.2, 0.2);
    await placeTrayPlayer(page, box, 'Jugador Azul', 0.12, 0.5);
    await placePlayer(page, box, 'Jugador rival', 0.7, 0.25);
    await placeMaterial(page, box, 'Balón', 0.4, 0.42);
    await placeMaterial(page, box, 'Cono', 0.25, 0.5, 1);
    await placeMaterial(page, box, 'Cono', 0.55, 0.5, 2);
    await drawShape(page, box, 'Flecha (movimiento)', [0.32, 0.28], [0.52, 0.38], 0);
    await deselect(page, box);
    await drawShape(page, box, 'Rectángulo', [0.6, 0.4], [0.8, 0.55], 3, true);
    await deselect(page, box);
    await placeText(page, box, 0.78, 0.78, 'Rondos 4v2');
    await deselect(page, box);

    await expect(page.locator('.field-count')).toHaveText('9');
    // Limpiar selección y cerrar paneles.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    expect(await page.locator('.studio-panel').count()).toBe(0);
    await page.screenshot({ path: `${SHOTS}/05-ejercicio-final-limpio.png` });

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(9);
    await verifyExport(page, baseline, [
      [0.2, 0.2],
      [0.42, 0.33],
      [0.7, 0.475],
    ]);
  });

  // =====================================================================
  // 6. Biblioteca tras guardar
  // =====================================================================
  test('06-biblioteca-tras-guardar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    await placePlayer(page, box, 'Jugador propio', 0.25, 0.25);
    await placeTrayPlayer(page, box, 'Jugador Azul', 0.4, 0.4);
    await placeMaterial(page, box, 'Cono', 0.5, 0.55, 1);
    await drawShape(page, box, 'Flecha (movimiento)', [0.3, 0.5], [0.45, 0.62], 0);
    await deselect(page, box);
    await expect(page.locator('.field-count')).toHaveText('4');

    // Rellenar la metadata (Datos del ejercicio) POR LA UI.
    await openProps(page);
    await page
      .locator('.studio-panel input[aria-label="Título del ejercicio"]')
      .fill('Rondos de pase y recepción');
    await page.locator('.studio-panel select[aria-label="Categoría"]').selectOption('Táctica');
    await page
      .locator('.studio-panel textarea[aria-label="Descripción"]')
      .fill('Conservación en superioridad con pase al apoyo');
    // Decisión del dueño: el checklist «Material necesario» se retira del panel, así que el
    // material ya no se marca por la UI. La tarjeta de Biblioteca no depende de él (miniatura,
    // título, descripción, duración, jugadores, categoría y carpeta se comprueban abajo).
    await page.locator('.studio-panel select[aria-label="Carpeta"]').selectOption('f1');
    const dur = page.locator('.studio-panel .field-grid2 > div').nth(0).locator('input');
    await dur.fill('14');
    const minIn = page.locator('.studio-panel input[placeholder="min"]');
    const maxIn = page.locator('.studio-panel input[placeholder="max"]');
    await minIn.fill('6');
    await maxIn.fill('10');

    await save(page);
    await expect(page.locator('.ex-card')).toHaveCount(1);
    // La tarjeta muestra miniatura, título, descripción, duración, jugadores, categoría y carpeta.
    await expect(page.locator('.ex-card .thumb-img')).toHaveAttribute('src', /data:image\/png/);
    await expect(page.locator('.ex-card .ex-title')).toHaveText('Rondos de pase y recepción');
    await expect(page.locator('.ex-card .ex-desc')).toContainText('Conservación en superioridad');
    await expect(page.locator('.ex-card .ex-meta')).toContainText('14′');
    await expect(page.locator('.ex-card .ex-meta')).toContainText('10 jug.');
    await expect(page.locator('.ex-card .ex-meta')).toContainText('Táctica');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/06-biblioteca-tras-guardar.png` });

    // Verificar persistencia + export.
    const doc = await canvasDoc(page);
    expect(doc.frames[0].elements).toHaveLength(4);
    await reopen(page);
    await save(page);
    expect(await canvasDoc(page)).toEqual(doc);
    await verifyExport(page, baseline, [
      [0.25, 0.25],
      [0.5, 0.55],
    ]);
  });

  // =====================================================================
  // 7. Móvil — campo cerrado
  // =====================================================================
  test('07-movil-campo-cerrado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    await placePlayer(page, box, 'Jugador propio', 0.25, 0.25);
    await placeTrayPlayer(page, box, 'Jugador Azul', 0.5, 0.5);
    await placeMaterial(page, box, 'Cono', 0.35, 0.7, 1);
    await drawShape(page, box, 'Línea', [0.1, 0.4], [0.3, 0.45], 0);
    await deselect(page, box);
    await expect(page.locator('.field-count')).toHaveText('4');

    // Campo protagonista, herramientas visibles, sin textos cortados.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const studio = (await page.locator('.studio').boundingBox())!;
    const field = (await page.locator('.studio-field').boundingBox())!;
    expect(field.width / studio.width).toBeGreaterThanOrEqual(0.9);
    expect(field.height / studio.height).toBeGreaterThanOrEqual(0.7);
    expect(await page.locator('.studio-tools').isVisible()).toBeTruthy();
    await page.screenshot({ path: `${SHOTS}/07-movil-campo-cerrado.png` });

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(4);
    await verifyExport(page, baseline, [
      [0.25, 0.25],
      [0.35, 0.7],
    ]);
  });

  // =====================================================================
  // 8. Móvil — menú Material abierto
  // =====================================================================
  test('08-movil-material', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    await placePlayer(page, box, 'Jugador propio', 0.3, 0.3);
    await placeMaterial(page, box, 'Balón', 0.5, 0.6);
    await placeMaterial(page, box, 'Cono', 0.7, 0.5, 0);
    await expect(page.locator('.field-count')).toHaveText('3');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/08-movil-material.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(3);
    await verifyExport(page, baseline, [
      [0.3, 0.3],
      [0.7, 0.5],
    ]);
  });

  // =====================================================================
  // 9. Móvil — menú Dibujo abierto
  // =====================================================================
  test('09-movil-dibujo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    await drawShape(page, box, 'Rectángulo', [0.2, 0.2], [0.4, 0.34], 0);
    await deselect(page, box);
    await drawShape(page, box, 'Flecha (movimiento)', [0.3, 0.5], [0.5, 0.62], 1);
    await deselect(page, box);
    await expect(page.locator('.field-count')).toHaveText('2');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/09-movil-dibujo.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(2);
    // La figura con relleno translúcido apenas altera el centro: se muestrea el
    // borde sólido (0.3, 0.2) del rectángulo y el centro de la flecha.
    await verifyExport(page, baseline, [
      [0.3, 0.2],
      [0.4, 0.56],
    ]);
  });

  // =====================================================================
  // 10. Móvil — menú Exportar abierto
  // =====================================================================
  test('10-movil-exportar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;
    const baseline = await captureBaseline(page);

    await placeMaterial(page, box, 'Balón', 0.4, 0.4);
    await placeMaterial(page, box, 'Cono', 0.6, 0.6, 2);
    await expect(page.locator('.field-count')).toHaveText('2');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await page.locator('[aria-label="Exportar"]').click();
    await expect(page.locator('.top-pop-export')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/10-movil-exportar.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const doc = await verifyPersistence(page);
    expect(doc.frames[0].elements).toHaveLength(2);
    await verifyExport(page, baseline, [
      [0.4, 0.4],
      [0.6, 0.6],
    ]);
  });
});

// =============================================================
// FASE 4 — Objetos ASIMÉTRICOS: verificación VISUAL.
//
// Las familias de la matriz validan sobre todo el MODELO. Aquí se
// comprueba, además, que lo que se VE (el SVG renderizado y el PNG
// exportado) realmente contiene la transformación: rotación real
// (manija), redimensión real (inspector / asa / extremo) y, para los
// objetos largos (pértiga, escalera), que la ORIENTACIÓN en píxeles
// cambió al girar ~90°. Se comprueba también que el transform sigue
// presente tras reabrir (persistencia visual), no solo el modelo.
//
// Regla de honestidad: no se simula ninguna comprobación visual. Si
// el PNG no permite afirmar una orientación precisa (objetos casi
// simétricos como cono/miniportería/texto/flecha/rectángulo), la
// orientación se verifica con precisión en el SVG y se declara en el
// PNG solo la presencia/posición en la región (limitación declarada).
// =============================================================

// Rect canónico del contenido (espejo de `render.ts` HORIZONTAL.rect).
const CBB_RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
const vbX = (nx: number) => nx * CBB_RECT.w + CBB_RECT.x;
const vbY = (ny: number) => ny * CBB_RECT.h + CBB_RECT.y;
const MATERIAL_BOX = 5.2;
const FASE4_SHOTS = 'e2e/shots/fase4';
fs.mkdirSync(FASE4_SHOTS, { recursive: true });

async function singleEl(page: Page): Promise<CanvasElement> {
  return (await canvasDoc(page)).frames[0].elements[0];
}

/** Desplaza un elemento en memoria (espejo de translateElement) para calcular
 *  las asas/manijas en la posición a la que quedará tras un arrastre real. */
function shifted(el: CanvasElement, dx: number, dy: number): CanvasElement {
  const t = el.t;
  if (
    t === 'arrow' ||
    t === 'line' ||
    t === 'dribble' ||
    t === 'doubleArrow' ||
    t === 'measure' ||
    t === 'curve' ||
    t === 'freehand'
  ) {
    return {
      ...el,
      x1: (el.x1 ?? 0) + dx,
      y1: (el.y1 ?? 0) + dy,
      x2: (el.x2 ?? 0) + dx,
      y2: (el.y2 ?? 0) + dy,
    };
  }
  return { ...el, x: (el.x ?? 0) + dx, y: (el.y ?? 0) + dy };
}

/** Arrastra (desde el centro del elemento) para desplaazarlo por un delta normalizado. */
async function dragMove(
  page: Page,
  box: Box,
  nx: number,
  ny: number,
  delta: [number, number],
): Promise<void> {
  const [x1, y1] = normToScreen(nx, ny, box);
  const [x2, y2] = normToScreen(nx + delta[0], ny + delta[1], box);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
}

interface RotFrag {
  angle: number;
  cx: number;
  cy: number;
}

/** <g transform="rotate(...)"> más interno que envuelve la posición `pos`.
 *  Cuenta <g>/</g> para no confundir el grupo de rotación de otro elemento. */
function enclosingRot(svg: string, pos: number): RotFrag | null {
  const re = /<g\b[^>]*>|<\/g>/g;
  const stack: Array<RotFrag | null> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) && m.index < pos) {
    if (m[0] === '</g>') stack.pop();
    else {
      const t = m[0].match(/transform="rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)"/);
      stack.push(
        t ? { angle: parseFloat(t[1]), cx: parseFloat(t[2]), cy: parseFloat(t[3]) } : null,
      );
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i];
  return null;
}

function imageAttrs(
  svg: string,
  href: string,
): { x: number; y: number; width: number; height: number } {
  const i = svg.indexOf(`<image href="${href}"`);
  expect(i, `<image href="${href}"`).toBeGreaterThan(-1);
  const tag = svg.slice(i, svg.indexOf('/>', i));
  const n = (k: string) => parseFloat(tag.match(new RegExp(`\\b${k}="([^"]+)"`))![1]);
  return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
}

/** Material PNG: <image ... width=5.2·size> y su <g transform="rotate(...)">. */
function assertMaterialSvg(svg: string, el: CanvasElement, created: CanvasElement): void {
  // CAMBIO DE CONTRATO (encargo de materiales, FASE 4): la portería, la escalera, la miniportería y
  // el chino se dibujan SIEMPRE en VECTOR, así que su PNG (que el documento sigue guardando) ya no
  // se pinta como <image>. Se comprueba lo contrario: que el dibujo vectorial está y el PNG no.
  const SIEMPRE_VECTOR = new Set(['ladder', 'ladder_yellow', 'minigoal', 'target', 'goal']);
  if (SIEMPRE_VECTOR.has(el.t) || SIEMPRE_VECTOR.has(el.assetKind ?? '')) {
    expect(
      svg.includes(`data-el-type="${el.t}"`),
      `el dibujo vectorial de "${el.t}" está en el SVG`,
    ).toBe(true);
    if (el.asset) {
      expect(
        svg.includes(`<image href="${el.asset}"`),
        `"${el.t}" ya NO pinta su PNG (dibujo vectorial)`,
      ).toBe(false);
    }
    return;
  }
  const href = el.asset!;
  const i = svg.indexOf(`<image href="${href}"`);
  expect(i, `el <image> de "${el.assetKind ?? el.t}" está en el SVG`).toBeGreaterThan(-1);
  const a = imageAttrs(svg, href);
  const half = (MATERIAL_BOX * (el.size ?? 1)) / 2;
  // tamaño renderizado = 5.2 × size (coincide con el modelo) y creció tras el Tamaño.
  expect(a.width).toBeCloseTo(MATERIAL_BOX * (el.size ?? 1), 2);
  expect(a.height).toBeCloseTo(MATERIAL_BOX * (el.size ?? 1), 2);
  // Fase 1: los materiales NO se redimensionan (resizable:false), así que el tamaño
  // renderizado coincide con el del estado creado (no puede superarlo).
  expect(a.width).toBeGreaterThanOrEqual(MATERIAL_BOX * (created.size ?? 1) - 0.01);
  // posición renderizada = centro del elemento.
  expect(a.x).toBeCloseTo(vbX(el.x!) - half, 2);
  expect(a.y).toBeCloseTo(vbY(el.y!) - half, 2);
  // rotación: el <g transform="rotate(rot cx cy)"> envuelve la imagen.
  const rot = enclosingRot(svg, i);
  if (el.rot) {
    expect(rot, `el <g> de ${el.t} envuelve la imagen con rotate(...)`).not.toBeNull();
    expect(rot!.angle).toBeCloseTo(el.rot, 0);
    expect(rot!.cx).toBeCloseTo(vbX(el.x!), 2);
    expect(rot!.cy).toBeCloseTo(vbY(el.y!), 2);
  } else {
    expect(rot).toBeNull();
  }
}

function findRectAt(svg: string, ex: number, ey: number, ew: number, eh: number): number {
  const re = /<rect\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const tag = m[0];
    const x = parseFloat(tag.match(/\bx="([^"]+)"/)?.[1] ?? 'NaN');
    const y = parseFloat(tag.match(/\by="([^"]+)"/)?.[1] ?? 'NaN');
    const w = parseFloat(tag.match(/\bwidth="([^"]+)"/)?.[1] ?? 'NaN');
    const h = parseFloat(tag.match(/\bheight="([^"]+)"/)?.[1] ?? 'NaN');
    if (
      Math.abs(x - ex) < 0.08 &&
      Math.abs(y - ey) < 0.08 &&
      Math.abs(w - ew) < 0.12 &&
      Math.abs(h - eh) < 0.12
    )
      return m.index;
  }
  return -1;
}

/** Rectángulo: <rect width/height> creció y su <g transform="rotate(...)">. */
function assertRectSvg(svg: string, el: CanvasElement, created: CanvasElement): void {
  const ex = vbX(el.x!),
    ey = vbY(el.y!);
  const ew = (el.w ?? 0) * CBB_RECT.w,
    eh = (el.h ?? 0) * CBB_RECT.h;
  const pos = findRectAt(svg, ex, ey, ew, eh);
  expect(pos, `el <rect> de ${el.t} en su posición renderizada`).toBeGreaterThan(-1);
  const tag = svg.slice(pos, svg.indexOf('/>', pos));
  const width = parseFloat(tag.match(/\bwidth="([^"]+)"/)![1]);
  const height = parseFloat(tag.match(/\bheight="([^"]+)"/)![1]);
  // la caja creció al redimensionar por el inspector (Ancho/Alto).
  expect(width).toBeGreaterThan((created.w ?? 0) * CBB_RECT.w + 0.05);
  expect(height).toBeGreaterThan((created.h ?? 0) * CBB_RECT.h + 0.05);
  expect(width).toBeCloseTo(ew, 2);
  expect(height).toBeCloseTo(eh, 2);
  const rot = enclosingRot(svg, pos);
  if (el.rot) {
    expect(rot, `el <g> de ${el.t} envuelve el rect con rotate(...)`).not.toBeNull();
    expect(rot!.angle).toBeCloseTo(el.rot, 0);
    expect(rot!.cx).toBeCloseTo(ex + ew / 2, 2);
    expect(rot!.cy).toBeCloseTo(ey + eh / 2, 2);
  }
}

function textClipId(el: CanvasElement): string {
  return 'txtclip-' + String(el.id).replace(/[^a-zA-Z0-9]/g, '');
}

/** Texto: el clipPath (cuadro) crece, el <text font-size> crece, y su
 *  <g transform="rotate(...)"> envuelve el texto. */
function assertTextSvg(svg: string, el: CanvasElement, created: CanvasElement): void {
  const cid = textClipId(el);
  const i = svg.indexOf(`id="${cid}"`);
  expect(i, `el clipPath del texto "${el.v}" está en el SVG`).toBeGreaterThan(-1);
  const seg = svg.slice(i, svg.indexOf('</clipPath>', i));
  const rect = seg.match(/<rect\b[^>]*>/)![0];
  const w = parseFloat(rect.match(/\bwidth="([^"]+)"/)![1]);
  const h = parseFloat(rect.match(/\bheight="([^"]+)"/)![1]);
  const maxW = Math.max((el.size ?? 3) * 0.5, CBB_RECT.w - (el.x ?? 0) * CBB_RECT.w);
  expect(w).toBeCloseTo(Math.min((el.w ?? 1) * CBB_RECT.w, maxW), 2);
  expect(h).toBeCloseTo((el.h ?? 1) * CBB_RECT.h, 2);
  // el tamaño de fuente creció al redimensionar (Tamaño).
  expect(svg).toContain(`<text font-size="${el.size ?? 3}"`);
  expect(el.size ?? 3).toBeGreaterThan((created.size ?? 3) + 0.1);
  const rot = enclosingRot(svg, i);
  if (el.rot) {
    expect(rot, `el <g> de ${el.t} envuelve el texto con rotate(...)`).not.toBeNull();
    expect(rot!.angle).toBeCloseTo(el.rot, 0);
    expect(rot!.cx).toBeCloseTo(vbX((el.x ?? 0) + (el.w ?? 0) / 2), 2);
    expect(rot!.cy).toBeCloseTo(vbY((el.y ?? 0) + (el.h ?? 0) / 2), 2);
  }
  // contenido multilínea persistido.
  expect(el.v).toContain('Conservación');
  expect(el.v).toContain('\n');
}

function findArrowLine(svg: string, el: CanvasElement): number {
  const x1 = vbX(el.x1!),
    y1 = vbY(el.y1!);
  // Documento antiguo sin `c`: el render usa su color por defecto (blanco).
  const col = el.c ?? '#ffffff';
  const re = /<line\b[^>]*>/g;
  let m: RegExpExecArray | null;
  let best = -1,
    bestD = Infinity;
  while ((m = re.exec(svg))) {
    const tag = m[0];
    if (!tag.includes(`stroke="${col}"`)) continue;
    const sx = parseFloat(tag.match(/\bx1="([^"]+)"/)?.[1] ?? 'NaN');
    const sy = parseFloat(tag.match(/\by1="([^"]+)"/)?.[1] ?? 'NaN');
    const d = Math.hypot(sx - x1, sy - y1);
    if (d < bestD) {
      bestD = d;
      best = m.index;
    }
  }
  return best;
}

/** Flecha: <line> con los extremos reales (se alargó al arrastrar x2) y su
 *  <g transform="rotate(...)"> envuelve el trazo. */
function assertArrowSvg(svg: string, el: CanvasElement, created: CanvasElement): void {
  const pos = findArrowLine(svg, el);
  expect(pos, `el <line> de la flecha (trazado ${el.c ?? '#1f2933'})`).toBeGreaterThan(-1);
  const tag = svg.slice(pos, svg.indexOf('/>', pos));
  const x1 = parseFloat(tag.match(/\bx1="([^"]+)"/)![1]);
  const y1 = parseFloat(tag.match(/\by1="([^"]+)"/)![1]);
  const x2 = parseFloat(tag.match(/\bx2="([^"]+)"/)![1]);
  const y2 = parseFloat(tag.match(/\by2="([^"]+)"/)![1]);
  // el extremo x2 se movió (la flecha se alargó).
  const createdLen = Math.hypot(
    (created.x2 ?? 0) - (created.x1 ?? 0),
    (created.y2 ?? 0) - (created.y1 ?? 0),
  );
  const len = Math.hypot(x2 - x1, y2 - y1);
  expect(len, `largo renderizado de la flecha`).toBeGreaterThan(createdLen * 92 - 0.5);
  expect(x2).toBeCloseTo(vbX(el.x2!), 2);
  expect(y2).toBeCloseTo(vbY(el.y2!), 2);
  const rot = enclosingRot(svg, pos);
  if (el.rot) {
    expect(rot, `el <g> de ${el.t} envuelve la flecha con rotate(...)`).not.toBeNull();
    expect(rot!.angle).toBeCloseTo(el.rot, 0);
    expect(rot!.cx).toBeCloseTo(vbX((el.x1! + el.x2!) / 2), 2);
    expect(rot!.cy).toBeCloseTo(vbY((el.y1! + el.y2!) / 2), 2);
  }
}

interface ChangedBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caja envolvente (px) de los píxeles que cambian entre dos PNG dentro de una
 *  región centrada en (nx, ny) - para inferir la ORIENTACIÓN de un objeto largo. */
async function pngChangedBBox(
  page: Page,
  a: Buffer,
  b: Buffer,
  nx: number,
  ny: number,
  half: number,
): Promise<ChangedBBox | null> {
  return await page.evaluate(
    async ({ a, b, nx, ny, half }) => {
      const load = (b64: string) =>
        new Promise<HTMLCanvasElement>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            c.getContext('2d')!.drawImage(img, 0, 0);
            resolve(c);
          };
          img.src = 'data:image/png;base64,' + b64;
        });
      const [ca, cb] = await Promise.all([load(a), load(b)]);
      const W = ca.width,
        H = ca.height;
      const sx = Math.round(((nx * 92 + 4) / 100) * W);
      const sy = Math.round(((ny * (92 / (105 / 68)) + 10) / 80) * H);
      const ctxA = ca.getContext('2d')!,
        ctxB = cb.getContext('2d')!;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity,
        count = 0;
      for (let dy = -half; dy <= half; dy += 3) {
        for (let dx = -half; dx <= half; dx += 3) {
          const pa = ctxA.getImageData(sx + dx, sy + dy, 1, 1).data;
          const pb = ctxB.getImageData(sx + dx, sy + dy, 1, 1).data;
          if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]) > 60) {
            count++;
            minX = Math.min(minX, dx);
            maxX = Math.max(maxX, dx);
            minY = Math.min(minY, dy);
            maxY = Math.max(maxY, dy);
          }
        }
      }
      if (count === 0) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    },
    { a: a.toString('base64'), b: b.toString('base64'), nx, ny, half },
  );
}

interface AsymSpec {
  label: string;
  create: (page: Page, box: Box) => Promise<void>;
  moveDelta: [number, number];
  resize: (page: Page, box: Box, el: CanvasElement) => Promise<void>;
  sx: (svg: string, el: CanvasElement, created: CanvasElement) => void;
  pngPoint: (el: CanvasElement) => [number, number];
  /** Orientación esperada en píxeles tras girar ~90°: 'wide' (bb.w > bb.h) o 'tall' (bb.h > bb.w). */
  orient?: 'wide' | 'tall';
  /** Ruta de captura del estado final (objeto rotado/redimensionado) para inspección visual. */
  shot?: string;
}

/** Ciclo completo de un objeto asimétrico: crear → mover → rotar (manija real) →
 *  redimensionar (control real) → verificar SVG + PNG → reabrir → igualdad →
 *  el transform SIGUE en el SVG tras reabrir. */
async function runAsym(page: Page, spec: AsymSpec, base: [number, number]): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 900 });
  await seed(page);
  await openBoard(page);
  let box = (await page.locator('.board-host').boundingBox())!;
  const baseline = await captureBaseline(page);

  await spec.create(page, box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const created = await singleEl(page);

  // Mover (arrastre real) desde el centro del estado creado.
  await reopen(page);
  await ensureFitMode(page);
  box = (await page.locator('.board-host').boundingBox())!;
  const [ccx, ccy] = elCenter(created);
  await selectAt(page, box, ccx, ccy);
  await dragMove(page, box, ccx, ccy, spec.moveDelta);
  const moved = shifted(created, spec.moveDelta[0], spec.moveDelta[1]);

  // Rotar (MANIJA real) usando el elemento desplazado, y redimensionar (control real).
  await dragRotHandle(page, moved, box);
  await spec.resize(page, box, moved);
  await save(page);
  const after = await singleEl(page);

  // El modelo giró de verdad (manija) y se movió.
  expect(Math.abs(after.rot ?? 0)).toBeGreaterThan(5);
  expect(
    Math.hypot(
      (after.x ?? 0) + (after.w ?? 0) / 2 - ccx,
      (after.y ?? 0) + (after.h ?? 0) / 2 - ccy,
    ),
  ).toBeGreaterThan(0.01);

  // SVG renderizado del estado final (deseleccionado).
  await reopen(page);
  await page.keyboard.press('Escape');
  const svg = await page.locator('.board-canvas svg').evaluate((el) => el.outerHTML as string);
  spec.sx(svg, after, created);
  if (spec.shot) await page.screenshot({ path: spec.shot });

  // PNG: presencia en la región esperada (+ orientación si aplica).
  const withEl = await exportPngBuf(page);
  const [pnx, pny] = spec.pngPoint(after);
  const diff = await pngRegionDiff(page, baseline, withEl, pnx, pny);
  expect(diff, `dif de píxeles de "${spec.label}" en (${pnx}, ${pny})`).toBeGreaterThan(0);
  if (spec.orient) {
    expect(Math.abs(after.rot ?? 0)).toBeGreaterThan(60); // ~90° para que la orientación invierta
    const bb = await pngChangedBBox(page, baseline, withEl, pnx, pny, 120);
    expect(bb, `bbox de píxeles de "${spec.label}"`).not.toBeNull();
    if (spec.orient === 'wide') {
      expect(bb!.w, `bbox ANCHO (objeto largo girado ~90°)`).toBeGreaterThan(bb!.h);
    } else {
      expect(bb!.h, `bbox ALTO (objeto ancho girado ~90°)`).toBeGreaterThan(bb!.w);
    }
  }

  // Persistencia del modelo.
  await save(page);
  const a = await canvasDoc(page);

  // Tras reabrir: el transform SIGUE en el SVG y el PNG aún muestra el objeto.
  await reopen(page);
  await page.keyboard.press('Escape');
  const svg2 = await page.locator('.board-canvas svg').evaluate((el) => el.outerHTML as string);
  spec.sx(svg2, after, created);
  const withEl2 = await exportPngBuf(page);
  const diff2 = await pngRegionDiff(page, baseline, withEl2, pnx, pny);
  expect(diff2, `dif de píxeles tras reabrir de "${spec.label}"`).toBeGreaterThan(0);

  await save(page);
  const b = await canvasDoc(page);
  expect(b).toEqual(a);
}

test.describe('Fase 4 — objetos asimétricos: SVG renderizado y PNG exportado', () => {
  test('cono (rojo): rotate + Tamaño → SVG con <image> crecido y <g rotate>, PNG en su posición', async ({
    page,
  }) => {
    await runAsym(
      page,
      {
        label: 'Cono',
        create: (pg, box) => placeMaterial(pg, box, 'Cono', 0.62, 0.6),
        moveDelta: [0.06, 0.04],
        resize: async () => undefined,
        sx: assertMaterialSvg,
        pngPoint: (el) => elCenter(el),
        shot: `${FASE4_SHOTS}/cono-rojo-rotado-resize.png`,
      },
      [0.62, 0.6],
    );
  });

  test('miniportería: rotate + Tamaño → SVG con <image> crecido y <g rotate>, PNG en su posición', async ({
    page,
  }) => {
    await runAsym(
      page,
      {
        label: 'Miniportería',
        create: (pg, box) => placeMaterial(pg, box, 'Miniportería', 0.62, 0.6),
        moveDelta: [0.06, 0.04],
        resize: async () => undefined,
        sx: assertMaterialSvg,
        pngPoint: (el) => elCenter(el),
      },
      [0.62, 0.6],
    );
  });

  test('pértiga: rotate ~90° + Tamaño → SVG con <g rotate> y el PNG ANCHO (orientación real)', async ({
    page,
  }) => {
    await runAsym(
      page,
      {
        label: 'Pértiga',
        create: (pg, box) => placeMaterial(pg, box, 'Pértiga / poste', 0.6, 0.5),
        moveDelta: [0.08, 0.05],
        resize: async () => undefined,
        sx: assertMaterialSvg,
        pngPoint: (el) => elCenter(el),
        orient: 'wide',
      },
      [0.6, 0.5],
    );
  });

  test('escalera: rotate ~90° + Tamaño → SVG con <g rotate> y el PNG ANCHO (orientación real)', async ({
    page,
  }) => {
    await runAsym(
      page,
      {
        label: 'Escalera',
        create: (pg, box) => placeMaterial(pg, box, 'Escalera', 0.6, 0.5),
        moveDelta: [0.08, 0.05],
        resize: async () => undefined,
        sx: assertMaterialSvg,
        pngPoint: (el) => elCenter(el),
        orient: 'tall',
      },
      [0.6, 0.5],
    );
  });

  test('texto: rotate (manija) + Tamaño → SVG con <text font-size> crecido y <g rotate>, PNG en su posición', async ({
    page,
  }) => {
    await runAsym(
      page,
      {
        label: 'Texto',
        create: (pg, box) => placeText(pg, box, 0.34, 0.58, 'Conservación\nPase'),
        moveDelta: [0.08, 0.05],
        resize: (pg) => setInspNum(pg, 'Tamaño', '4.5'),
        sx: assertTextSvg,
        pngPoint: (el) => elCenter(el),
        shot: `${FASE4_SHOTS}/texto-rotado-resize.png`,
      },
      [0.34, 0.58],
    );
  });

  test('flecha (movimiento): rotate (manija) + extremo x2 → SVG con <line> alargado y <g rotate>, PNG en su posición', async ({
    page,
  }) => {
    await runAsym(
      page,
      {
        label: 'Flecha',
        create: (pg, box) => {
          const tx = 0.62,
            ty = 0.6;
          return drawShape(
            pg,
            box,
            'Flecha (movimiento)',
            [tx - 0.08, ty - 0.05],
            [tx + 0.08, ty + 0.05],
            undefined,
            undefined,
          ).then(() => deselect(pg, box));
        },
        moveDelta: [0.06, 0.04],
        resize: (pg, box, el) =>
          dragHandle(pg, box, [el.x2!, el.y2!], [el.x2! + 0.13, el.y2! + 0.09]),
        sx: assertArrowSvg,
        pngPoint: (el) => elCenter(el),
      },
      [0.62, 0.6],
    );
  });

  test('rectángulo: rotate (manija) + Ancho/Alto → SVG con <rect> crecido y <g rotate>, PNG en el borde', async ({
    page,
  }) => {
    await runAsym(
      page,
      {
        label: 'Rectángulo',
        create: (pg, box) => {
          const tx = 0.62,
            ty = 0.6;
          return drawShape(
            pg,
            box,
            'Rectángulo',
            [tx - 0.08, ty - 0.05],
            [tx + 0.08, ty + 0.05],
            undefined,
            false,
          ).then(() => deselect(pg, box));
        },
        moveDelta: [0.06, 0.04],
        resize: async (pg) => {
          await setInspNum(pg, 'Ancho', '26');
          await setInspNum(pg, 'Alto', '17');
        },
        sx: assertRectSvg,
        // El rectángulo (perímetro) es hueco en el centro: se muestrea el borde superior.
        pngPoint: (el) => [(el.x ?? 0) + (el.w ?? 0) / 2, el.y ?? 0],
      },
      [0.62, 0.6],
    );
  });
});
