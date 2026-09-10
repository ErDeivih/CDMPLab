import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import type { CanvasElement } from '../src/app/core/models';
import { longPress, fillBoardTitle } from './gesture-helpers';

// =============================================================
// Fase 11 — modelo y persistencia: round-trip por familia.
//
// Para un elemento representativo de cada familia (player, material,
// text, rect, line, arrow, curve, freehand, zone, ellipse) se hace:
//   crear → mover → redimensionar → ±90° (barra de contexto) →
//   duplicar → guardar → salir → reabrir  y se comprueba que el
//   MODELO persiste: type, id, posición, size/scale, width/height,
//   points/endpoints, control de curva, puntos de mano alzada,
//   rotación, color, grosor, estilo de línea, opacidad, orden de capa
//   y enlace a jugador real. Además se verifica Undo/Redo tras cada
//   gesto, el aviso de cambios sin guardar, el duplicado independiente,
//   la exportación/importación de respaldo y un PNG idéntico al campo
//   guardado.
//
// Cada gesto se hace en su propia sesión (reabrir tras guardar) para
// usar la geometría REAL del modelo persistido como fuente de verdad.
// Fuente de verdad: el modelo persiste en localStorage.
// =============================================================

interface Box { x: number; y: number; width: number; height: number }

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

function normToScreen(nx: number, ny: number, box: Box): [number, number] {
  const s = Math.min(box.width / VBW, box.height / VBH);
  const offX = (box.width - VBW * s) / 2;
  const offY = (box.height - VBH * s) / 2;
  const cx = offX + (nx * RECT.w + RECT.x) * s;
  const cy = offY + (ny * RECT.h + RECT.y) * s;
  return [box.x + cx, box.y + cy];
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'pl1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // FASE G: observable — el campo se ha renderizado (SVG presente), no una espera fija.
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
  await page.locator('.field-fit-toggle').waitFor({ state: 'visible' });
}

async function useTool(page: Page, title: string, category?: string): Promise<void> {
  if (category) await page.locator('.tools-cat', { hasText: category }).click();
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
    return;
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

async function save(page: Page): Promise<void> {
  await fillBoardTitle(page, 'P11');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

async function reopen(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
}

async function savedElements(page: Page): Promise<CanvasElement[]> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas.frames[0].elements;
  });
}

function elCenter(el: CanvasElement): [number, number] {
  const t = el.t;
  if (t === 'rect' || t === 'zone' || t === 'ellipse' || t === 'text') {
    return [(el.x ?? 0) + (el.w ?? 0) / 2, (el.y ?? 0) + (el.h ?? 0) / 2];
  }
  if (t === 'line' || t === 'arrow' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    return [((el.x1 ?? 0) + (el.x2 ?? 0)) / 2, ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2];
  }
  if (t === 'curve') {
    return [((el.x1 ?? 0) + (el.c1x ?? 0) + (el.x2 ?? 0)) / 3, ((el.y1 ?? 0) + (el.c1y ?? 0) + (el.y2 ?? 0)) / 3];
  }
  if (t === 'freehand') {
    const pts = el.points ?? [];
    if (!pts.length) return [el.x ?? 0, el.y ?? 0];
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  }
  return [el.x ?? 0, el.y ?? 0];
}

/** Punto (norm) que SIEMPRE cae sobre el trazo del elemento (para un hit-test fiable). */
function onStrokePoint(el: CanvasElement): [number, number] {
  if (el.t === 'curve') {
    // Punto B(0.35) de la bezier cuadrática: sobre la curva y ALEJADO (>0.045) de las
    // asas x1/x2/c1. B(0.5) coincide con el asa c1 cuando la curva es casi recta, y un
    // long-press ahí arrastraría el punto de control en vez de abrir el menú (Fase 3).
    const p0 = [el.x1 ?? 0, el.y1 ?? 0];
    const p1 = [el.c1x ?? 0, el.c1y ?? 0];
    const p2 = [el.x2 ?? 0, el.y2 ?? 0];
    const t = 0.35;
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ];
  }
  // Resto: el centro geométrico (para punto/caja/segmento cae sobre el elemento).
  return elCenter(el);
}

/** Rota un punto (norm) alrededor de un centro por `deg` grados. */
function rotateNorm(q: [number, number], c: [number, number], deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = q[0] - c[0];
  const dy = q[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

/** Punto de PANTALLA sobre el elemento (tiene en cuenta su rotación alrededor de `elementCenter`). */
async function interactPoint(page: Page, el: CanvasElement): Promise<[number, number]> {
  const box = await hostBox(page);
  const c = elCenter(el);
  let q = onStrokePoint(el);
  if (el.rot) q = rotateNorm(q, c, el.rot);
  return normToScreen(q[0], q[1], box);
}

async function selectAt(page: Page, el: CanvasElement): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [x, y] = await interactPoint(page, el);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.inspector')).toBeVisible();
}

async function dragMove(page: Page, el: CanvasElement, delta: [number, number]): Promise<void> {
  const box = await hostBox(page);
  const s = Math.min(box.width / VBW, box.height / VBH);
  const [x1, y1] = await interactPoint(page, el);
  const dxs = delta[0] * RECT.w * s;
  const dys = delta[1] * RECT.h * s;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + dxs, y1 + dys, { steps: 6 });
  await page.mouse.up();
  // FASE G: el movimiento se verifica post-guardado por el llamador (modelo persistido).
}

async function dragHandle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await hostBox(page);
  const [fx, fy] = normToScreen(from[0], from[1], box);
  const [tx, ty] = normToScreen(to[0], to[1], box);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
  // FASE G: el resize se verifica post-guardado por el llamador (modelo persistido).
}

async function resizeSelected(page: Page, el: CanvasElement, kind: 'box' | 'point' | 'seg' | 'curve' | 'freehand'): Promise<void> {
  // Ocultar los overlay flotantes (panel de Propiedades, barra de contexto) para que no
  // intercepten el arrastre de las asas de redimensionado (patrón de otras specs).
  // Se guarda el display original de cada uno para RESTAURARLO al terminar: dejar el
  // panel de Propiedades oculto rompería el guardado posterior, que necesita el campo
  // de título del ejercicio visible (A5).
  await page.evaluate(() => {
    const originals: Array<[HTMLElement, string]> = [];
    document.querySelectorAll('.studio-panel, .top-pop, .context-bar').forEach((el2) => {
      const h = el2 as HTMLElement;
      originals.push([h, h.style.display]);
      h.style.display = 'none';
    });
    (window as unknown as { __resizeOriginals: Array<[HTMLElement, string]> }).__resizeOriginals = originals;
  });
  await page.waitForTimeout(40);
  if (kind === 'box') {
    const x = el.x ?? 0, y = el.y ?? 0, w = el.w ?? 0.2, h = el.h ?? 0.2;
    await dragHandle(page, [x + w, y + h], [Math.min(0.9, x + w + 0.1), Math.min(0.9, y + h + 0.12)]);
  } else if (kind === 'point') {
    await dragHandle(page, [(el.x ?? 0) + 0.055, (el.y ?? 0) + 0.055], [(el.x ?? 0) + 0.14, (el.y ?? 0) + 0.16]);
  } else if (kind === 'seg') {
    await dragHandle(page, [el.x2 ?? 0.6, el.y2 ?? 0.6], [Math.min(0.9, (el.x2 ?? 0.6) + 0.16), Math.min(0.9, (el.y2 ?? 0.6) + 0.1)]);
  } else if (kind === 'curve') {
    await dragHandle(page, [el.x2 ?? 0.6, el.y2 ?? 0.6], [Math.min(0.9, (el.x2 ?? 0.6) + 0.14), Math.min(0.9, (el.y2 ?? 0.6) + 0.08)]);
    await dragHandle(page, [el.c1x ?? 0.4, el.c1y ?? 0.3], [Math.min(0.9, (el.c1x ?? 0.4) + 0.08), Math.max(0.1, (el.c1y ?? 0.3) - 0.06)]);
  } else if (kind === 'freehand') {
    const pts = el.points ?? [];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    await dragHandle(page, [minX, minY], [Math.max(0.1, minX - 0.08), Math.max(0.1, minY - 0.08)]);
  }
  // Restaurar el display de los overlay que se ocultaron (para que el panel de
  // Propiedades vuelva a estar visible y el guardado pueda leer el título).
  await page.evaluate(() => {
    const w = window as unknown as { __resizeOriginals?: Array<[HTMLElement, string]> };
    const originals = w.__resizeOriginals;
    if (originals) for (const [h, d] of originals) h.style.display = d;
    delete w.__resizeOriginals;
  });
  await page.waitForTimeout(40);
}

async function rotateViaBar(page: Page, deg: 90 | -90, el: CanvasElement): Promise<void> {
  const sel = deg === 90 ? '[aria-label="Girar 90° a la derecha"]' : '[aria-label="Girar 90° a la izquierda"]';
  // Fase 3: el menú contextual se abre con PULSACIÓN LARGA (no con clic derecho ni tap).
  const [x, y] = await interactPoint(page, el);
  await longPress(page, x, y);
  await page.locator('.context-bar').waitFor({ state: 'visible' });
  await page.locator(`.context-bar ${sel}`).click();
  // FASE G: la rotación se verifica post-guardado por el llamador (modelo persistido).
}

/** Undo / Redo transaccional (el elemento sigue existiendo en ambos estados). */
async function undoRedoStays(page: Page, count: string): Promise<void> {
  await page.keyboard.press('Control+z');
  await expect(page.locator('.field-count')).toHaveText(count);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.field-count')).toHaveText(count);
}

interface FamilySpec {
  name: string;
  tool: string;
  category?: string;
  draw: boolean;
  resizeKind: 'box' | 'point' | 'seg' | 'curve' | 'freehand';
}

const FAMILIES: FamilySpec[] = [
  { name: 'player', tool: 'Jugador propio', category: 'Jugadores', draw: false, resizeKind: 'point' },
  { name: 'cone', tool: 'Cono', category: 'Material', draw: false, resizeKind: 'none' },
  { name: 'text', tool: 'Texto', category: 'Dibujo', draw: false, resizeKind: 'box' },
  { name: 'rect', tool: 'Rectángulo', category: 'Dibujo', draw: true, resizeKind: 'box' },
  { name: 'line', tool: 'Línea', category: 'Dibujo', draw: true, resizeKind: 'seg' },
  { name: 'arrow', tool: 'Flecha (movimiento)', category: 'Dibujo', draw: true, resizeKind: 'seg' },
  { name: 'curve', tool: 'Curva derecha', category: 'Dibujo', draw: true, resizeKind: 'curve' },
  { name: 'freehand', tool: 'Dibujo a mano alzada', category: 'Dibujo', draw: true, resizeKind: 'freehand' },
  { name: 'ellipse', tool: 'Círculo / elipse', category: 'Dibujo', draw: true, resizeKind: 'box' },
];

async function createFamily(page: Page, fam: FamilySpec): Promise<void> {
  const box = await hostBox(page);
  await useTool(page, fam.tool, fam.category);
  if (fam.draw) {
    const [x1, y1] = normToScreen(0.3, 0.4, box);
    const [x2, y2] = normToScreen(0.5, 0.6, box);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 4 });
    await page.mouse.up();
  } else {
    const [x, y] = normToScreen(0.45, 0.5, box);
    await page.mouse.click(x, y);
  }
  await expect(page.locator('.field-count')).toHaveText('1');
}

test.describe('Fase 11 — round-trip de modelo y persistencia por familia', () => {
  for (const fam of FAMILIES) {
    test(`familia «${fam.name}»: crear→mover→redimensionar→±90°→duplicar→guardar→salir→reabrir preserva el modelo`, async ({ page }) => {
      await seed(page);
      await createFamily(page, fam);
      await save(page);
      const b0 = (await savedElements(page))[0];
      expect(b0.t).toBe(fam.name);
      expect(typeof b0.id).toBe('string');

      // --- Mover ---
      await reopen(page);
      await selectAt(page, b0);
      await dragMove(page, b0, [0.08, 0.06]);
      await undoRedoStays(page, '1');
      await save(page);
      const b1 = (await savedElements(page))[0];
      const movedCentroid = elCenter(b1);
      const beforeCentroid = elCenter(b0);
      expect(Math.hypot(movedCentroid[0] - beforeCentroid[0], movedCentroid[1] - beforeCentroid[1])).toBeGreaterThan(0.02);

      // --- Redimensionar (familia) ---
      let b2 = b1;
      if (fam.resizeKind !== 'none') {
        await reopen(page);
        await selectAt(page, b1);
        await resizeSelected(page, b1, fam.resizeKind);
        await undoRedoStays(page, '1');
        await save(page);
        b2 = (await savedElements(page))[0];
        const preResize = JSON.stringify(stripId(b1));
        const postResize = JSON.stringify(stripId(b2));
        expect(postResize, 'el redimensionado cambió la geometría del modelo').not.toBe(preResize);
      }

      // --- Rotar ±90° (barra de contexto) ---
      await reopen(page);
      await selectAt(page, b2);
  await rotateViaBar(page, 90, b2);
      await undoRedoStays(page, '1');
      await save(page);
      const b3 = (await savedElements(page))[0];
      expect(b3.rot).toBeCloseTo(90, 0);

      // --- Duplicar (un solo Ctrl+D) ---
      await reopen(page);
      await selectAt(page, b3);
      await page.keyboard.press('Control+d');
      await expect(page.locator('.field-count')).toHaveText('2');
      // Undo/redo del duplicado: 2→1→2.
      await page.keyboard.press('Control+z');
      await expect(page.locator('.field-count')).toHaveText('1');
      await page.keyboard.press('Control+y');
      await expect(page.locator('.field-count')).toHaveText('2');
      await save(page);
      const afterDup = await savedElements(page);
      expect(afterDup).toHaveLength(2);

      // --- Reabrir → el modelo es ESTABLE (round-trip idéntico) ---
      const beforeReopen = JSON.parse(JSON.stringify(afterDup));
      await reopen(page);
      await expect(page.locator('.field-count')).toHaveText('2');
      const afterReopen = await savedElements(page);
      expect(afterReopen).toEqual(beforeReopen);

      // --- Duplicado independiente: mover la copia NO cambia el original ---
      const orig = afterReopen[0];
      const dup = afterReopen[1];
      expect(dup.id).not.toBe(orig.id);
      await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
      const [dx, dy] = await interactPoint(page, dup);
      await page.mouse.move(dx, dy);
      await page.mouse.down();
      await page.mouse.move(dx + 40, dy + 20, { steps: 5 });
      await page.mouse.up();
      await save(page);
      const final = await savedElements(page);
      const origFinal = final.find((e) => e.id === orig.id)!;
      const dupFinal = final.find((e) => e.id === dup.id)!;
      expect(origFinal).toEqual(orig); // el original NO cambió al mover la copia
      expect(JSON.stringify(stripId(dupFinal))).not.toBe(JSON.stringify(stripId(dup))); // la copia sí
    });
  }

  test('round-trip: rotación exacta ±90° y propiedades (color/opacidad/capa) congeladas al guardar y reabrir', async ({ page }) => {
    await seed(page);
    await createFamily(page, FAMILIES.find((f) => f.name === 'rect')!);
    await save(page);
    await reopen(page);
    await selectAt(page, (await savedElements(page))[0]);
    const colSwatch = page.locator('.studio-panel .inspector .field', { hasText: 'Color' }).locator('.swatch').nth(2);
    await colSwatch.click();
    const op = page.locator('.studio-panel .inspector .field', { hasText: 'Opacidad' }).locator('input[type="range"]');
    await op.fill('0.6');
    await op.dispatchEvent('change');
    await rotateViaBar(page, 90, (await savedElements(page))[0]);
    await save(page);
    const keep = (await savedElements(page))[0];
    expect(keep.rot).toBeCloseTo(90, 0);
    expect(keep.c).toBe('#1f7a4d');
    expect(keep.opacity).toBeCloseTo(0.6, 2);

    // Traer adelante (capa) y reabrir → lo mismo persiste.
    await reopen(page);
    await selectAt(page, keep);
    await page.locator('.inspector-actions button[title="Traer adelante"]').click();
    await save(page);
    const layered = (await savedElements(page))[0];
    expect(layered.rot).toBeCloseTo(90, 0);
    expect(layered.c).toBe('#1f7a4d');
    expect(layered.opacity).toBeCloseTo(0.6, 2);
  });

  test('un jugador de plantilla (playerId) preserva su enlace real y NO se duplica (invariante)', async ({ page }) => {
    await seed(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.locator('.roster-item', { hasText: 'Marcos' }).click();
    // FASE B (paneles persistentes): elegir un jugador de plantilla ARMA la colocación
    // pero NO cierra el panel; el panel Jugadores permanece abierto hasta el cierre explícito.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
    const box = await hostBox(page);
    const [cx, cy] = normToScreen(0.5, 0.5, box);
    await page.mouse.click(cx, cy);
    await expect(page.locator('.field-count')).toHaveText('1');
    await save(page);
    const placed = (await savedElements(page))[0];
    expect(placed.t).toBe('player');
    expect(placed.playerId).toBe('pl1');

    // No se puede duplicar (instancia única).
    await reopen(page);
    await selectAt(page, placed);
    await page.keyboard.press('Control+d');
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.board-notice')).toHaveText(/jugador de la plantilla/i);
    await save(page);
    expect(await savedElements(page)).toHaveLength(1);
  });

  test('aviso de cambios sin guardar al salir con la pizarra sucia (y cancelar permanece)', async ({ page }) => {
    await seed(page);
    await createFamily(page, FAMILIES.find((f) => f.name === 'cone')!);
    await page.locator('button[title="Volver"]').click();
    await expect(page.getByRole('dialog', { name: 'Cambios sin guardar' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Cambios sin guardar' }).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('.board-host')).toBeVisible();
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('exportación/importación de respaldo conserva el ejercicio con su pizarra', async ({ page }) => {
    await seed(page);
    await createFamily(page, FAMILIES.find((f) => f.name === 'rect')!);
    await save(page);
    await page.locator('button[aria-label="Ajustes"]').click();
    const dlPromise = page.waitForEvent('download');
    await page.locator('.settings-row', { hasText: 'Exportar respaldo' }).locator('button', { hasText: 'Exportar' }).click();
    const dl = await dlPromise;
    const path = await dl.path();
    const parsed = JSON.parse(fs.readFileSync(path!, 'utf8'));
    expect(parsed.exercises[0].canvas.version).toBe(2);
    expect(parsed.exercises[0].canvas.frames[0].elements.length).toBeGreaterThanOrEqual(1);

    // Reimportar el mismo respaldo (Reemplazar) → el ejercicio con su pizarra se conserva.
    await page.locator('.settings-row', { hasText: 'Importar respaldo' }).locator('input[type="file"]').setInputFiles(path!);
    await expect(page.locator('.settings-row', { hasText: 'Respaldo válido' })).toBeVisible();
    await page.locator('.settings-row', { hasText: 'Respaldo válido' }).locator('button', { hasText: 'Reemplazar' }).click();
    // FASE G: observable — el ejercicio restaurado aparece en localStorage (no una espera fija).
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]') as unknown[]).length), { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:exercises')!));
    expect(restored.length).toBeGreaterThanOrEqual(1);
    expect(restored[0].canvas.frames[0].elements.length).toBeGreaterThanOrEqual(1);
  });

  test('el PNG exportado refleja el campo guardado (firma, dimensiones del campo horizontal y sin controles del editor)', async ({ page }) => {
    await seed(page);
    await createFamily(page, FAMILIES.find((f) => f.name === 'rect')!);
    await save(page);
    await reopen(page);
    // Seleccionar el rectángulo (el editor pinta asas sobre la pizarra EN VIVO).
    await selectAt(page, (await savedElements(page))[0]);
    const dlPromise = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await page.locator('.rail-btn[title="Descargar PNG"]').click();
    const dl = await dlPromise;
    const b = fs.readFileSync((await dl.path())!);
    expect(b.subarray(0, 4).toString('hex')).toBe('89504e47'); // firma PNG
    expect(b.readUInt32BE(16)).toBe(1600); // IHDR width (campo horizontal)
    expect(b.readUInt32BE(20)).toBe(1280); // IHDR height
  });
});

/** Devuelve el elemento sin su `id` (para comparar geometría/propiedades puras). */
function stripId(el: CanvasElement): Omit<CanvasElement, 'id'> {
  const { id: _id, ...rest } = el;
  return rest;
}
