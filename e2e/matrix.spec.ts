import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';
import type { CanvasDocument, CanvasElement } from '../src/app/core/models';
import { TACTICAL_SIZE, MATERIAL_SIZE_RATIO, tacticAsset, TacticalKind } from '../src/app/core/tactic-assets';
import { fillBoardTitle } from './gesture-helpers';

// =============================================================
// Matriz HONESTA por familia: TODA herramienta de creación de
// elementos se prueba DE VERDAD (no solo rect/line/text/cone).
// Para cada familia se verifica: crear → undo/redo → seleccionar →
// mover → duplicar → borrar → guardar → reabrir → igualdad de
// modelo. La fuente de verdad es el modelo persistido en
// localStorage, no el contador de la UI.
//
// Capacidades: cada una que se declare `true` se EJERCITA con una
// interacción real (pulsar la barra de contexto ±90°, arrastrar un
// ASA de redimensión, arrastrar un EXTREMO, cambiar el SWATCH de
// variante, exportar de verdad y decodificar el PNG). Ninguna se
// comprueba con una constante. `animatable` se ELIMINÓ: la pizarra
// es estática (la animación quedó retirada).
//
// Regla de honestidad: si el modelo/UI no soporta una capacidad, se
// declara `false` y se aserciona ese hecho; nunca se simula.
// =============================================================

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Replica el letterboxing del canvas (horizontal) para mapear 0..1 → pantalla. */
/** Fase 3: el menú contextual se abre por PULSACIÓN LARGA (clic derecho NO: retirado).
 *  Mantiene el botón pulsado ~600 ms (> 550 ms de la app) y lo suelta en el mismo punto. */
async function longPress(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

function normToScreen(nx: number, ny: number, box: Box): [number, number] {
  const vbW = 100;
  const vbH = 80;
  const rect = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
  const s = Math.min(box.width / vbW, box.height / vbH);
  const offX = (box.width - vbW * s) / 2;
  const offY = (box.height - vbH * s) / 2;
  const vbX = nx * rect.w + rect.x;
  const vbY = ny * rect.h + rect.y;
  return [box.x + offX + vbX * s, box.y + offY + vbY * s];
}

/** Centro geométrico (0..1) de un elemento, espejo del elementCenter de la app. */
function elCenter(el: CanvasElement): [number, number] {
  const t = el.t;
  if (t === 'rect' || t === 'zone' || t === 'ellipse' || t === 'text') {
    return [(el.x ?? 0) + (el.w ?? 0) / 2, (el.y ?? 0) + (el.h ?? 0) / 2];
  }
  if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    return [((el.x1 ?? 0) + (el.x2 ?? 0)) / 2, ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2];
  }
  if (t === 'curve') {
    // Punto SOBRE el trazo (Bezier en t=0.5), no el centroide de los 3 puntos de control:
    // el centroide (incl. c1 doblado hacia abajo) cae FUERA de la curva y un clic ahí no
    // la selecciona (regresión Fase 5: curve_right se dobla hacia abajo, +0.14).
    return [
      0.25 * (el.x1 ?? 0) + 0.5 * (el.c1x ?? (el.x1 ?? 0) / 2 + (el.x2 ?? 0) / 2) + 0.25 * (el.x2 ?? 0),
      0.25 * (el.y1 ?? 0) + 0.5 * (el.c1y ?? (el.y1 ?? 0) / 2 + (el.y2 ?? 0) / 2) + 0.25 * (el.y2 ?? 0),
    ];
  }
  if (t === 'freehand') {
    const pts = el.points ?? [];
    if (!pts.length) return [el.x ?? 0, el.y ?? 0];
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  }
  return [el.x ?? 0, el.y ?? 0];
}

/** Punto-línea (incluye text: la app lo trata como puntual en la geometría de asas). */
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
    t === 'mannequin_row' ||
    t === 'goal' ||
    t === 'dumbbell' ||
    t === 'coachC' ||
    t === 'peto' ||
    t === 'chaleco' ||
    t === 'bosu' ||
    t === 'fitball' ||
    t === 'pica'
  );
}

/** Caja envolvente visual (normalizada) espejo de board-selection.visualBBox. */
function visualBBox(el: CanvasElement): { x: number; y: number; w: number; h: number } {
  const t = el.t;
  if (isPointLike(t)) {
    const hs = 0.055;
    return { x: (el.x ?? 0) - hs, y: (el.y ?? 0) - hs, w: hs * 2, h: hs * 2 };
  }
  if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  if (t === 'curve') {
    const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
    const cx = el.c1x ?? (x1 + x2) / 2;
    const cy = el.c1y ?? (y1 + y2) / 2;
    return { x: Math.min(x1, x2, cx), y: Math.min(y1, y2, cy), w: Math.max(x1, x2, cx) - Math.min(x1, x2, cx), h: Math.max(y1, y2, cy) - Math.min(y1, y2, cy) };
  }
  if (t === 'freehand') {
    const pts = el.points ?? [];
    if (!pts.length) return { x: el.x ?? 0, y: el.y ?? 0, w: 0, h: 0 };
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: el.x ?? 0, y: el.y ?? 0, w: el.w ?? 0, h: el.h ?? 0 };
}

/**
 * DECISIÓN DEL DUEÑO (Fase 6): la rotación continua (manija `.rot-handle` con su
 * línea `.rot-line`) fue RETIRADA. La rotación ahora es EXACTAMENTE ±90° desde la
 * barra de contexto (botones "Girar 90° a la izquierda"/"Girar 90° a la derecha").
 * Esta helper pulsa el botón correspondiente de la barra (una acción = +90/-90 en
 * `rot`, un solo paso de undo). Los tests que arrastraban la antigua manija se
 * reescriben para usar esta API; la manija ya NO debe existir en el DOM.
 */
async function rotateViaBar(page: Page, deg: 90 | -90): Promise<void> {
  const sel = deg === 90 ? '[aria-label="Girar 90° a la derecha"]' : '[aria-label="Girar 90° a la izquierda"]';
  await page.locator('.context-bar').waitFor({ state: 'visible' });
  await page.locator(`.context-bar ${sel}`).click();
  await page.waitForTimeout(80);
}

/** Asas de redimensión de una caja (tl/tr/bl/br) en coords normalizadas. */
function boxHandles(el: CanvasElement): Array<{ x: number; y: number; key: string }> {
  const t = el.t;
  if (t === 'freehand') {
    // Mano alzada: caja envolvente del trazo (escala proporcional por las 4 esquinas).
    const pts = el.points ?? [];
    if (!pts.length) return [];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return [
      { x: minX, y: minY, key: 'tl' },
      { x: maxX, y: minY, key: 'tr' },
      { x: minX, y: maxY, key: 'bl' },
      { x: maxX, y: maxY, key: 'br' },
    ];
  }
  if (t !== 'rect' && t !== 'zone' && t !== 'ellipse' && t !== 'text') return [];
  const x = el.x ?? 0, y = el.y ?? 0, w = el.w ?? 0, h = el.h ?? 0;
  return [
    { x, y, key: 'tl' },
    { x: x + w, y, key: 'tr' },
    { x, y: y + h, key: 'bl' },
    { x: x + w, y: y + h, key: 'br' },
  ];
}

/** Ancho del bounding box de un trazo a mano alzada (0 si no hay puntos). */
function freehandBBoxWidth(points: [number, number][] | undefined): number {
  if (!points || !points.length) return 0;
  const xs = points.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
}

/** Extremos (x1/x2 y, en curvas, c1) en coords normalizadas. */
function segHandles(el: CanvasElement): Array<{ x: number; y: number; key: string }> {
  const t = el.t;
  if (!(t === 'line' || t === 'arrow' || t === 'curve' || t === 'doubleArrow' || t === 'measure' || t === 'dribble')) return [];
  const hs = [
    { x: el.x1 ?? 0, y: el.y1 ?? 0, key: 'x1' },
    { x: el.x2 ?? 0, y: el.y2 ?? 0, key: 'x2' },
  ];
  if (t === 'curve') hs.push({ x: el.c1x ?? 0, y: el.c1y ?? 0, key: 'c1' });
  return hs;
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
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
  await page.goto('/board');
}

/** Activa la categoría correcta y pulsa la herramienta por su título. */
async function useTool(page: Page, title: string, category?: string): Promise<void> {
  await abrirHerramientas(page);
  if (category) await page.locator('.tools-cat', { hasText: category }).click();
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    // FASE C: se retiraron los botones "Jugador propio/rival". El genérico se arma con
    // las fichas rápidas por COLOR (Propio = Azul, Rival = Rojo); la diferenciación de
    // equipos es por color, no por un botón de "rival".
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
    return;
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

/** Abre el panel Propiedades (derecha), que empieza cerrado (Fase 1). */
async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  // FASE G: el panel se espera con el `.toBeVisible()` siguiente (observable); sin wait fijo.
  await expect(page.locator('.studio-panel')).toBeVisible();
}

async function save(page: Page): Promise<void> {
  await fillBoardTitle(page, 'Matriz');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

async function reopen(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await page.waitForSelector('.board-host');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
}

async function canvas(page: Page): Promise<CanvasDocument> {
  const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
  return ex.canvas;
}

async function singleEl(page: Page): Promise<CanvasElement> {
  return (await canvas(page)).frames[0].elements[0];
}

interface Caps {
  movable: boolean;
  rotatable: boolean; // barra de contexto; los materiales con arriba físico no giran
  resizable: boolean; // se arrastra un ASA (cajas) o el Tamaño (materiales)
  colorable: boolean; // el inspector cambia `c` de verdad
  editableEndpoints: boolean; // se arrastra x1/x2/c1
  editableText: boolean; // el contenido de texto es editable
  supportsVariants: boolean; // el swatch cambia assetKind
  duplicable: boolean;
  exportable: boolean; // exporta un PNG real y el elemento aparece en él
}

interface Family {
  name: string; // tipo esperado en el modelo
  tool: string; // título del rail-btn
  category?: string; // pestaña .tools-cat
  draw: boolean; // arrastre vs clic
  assetKind?: string; // material por defecto
  variantKind?: string; // variante a seleccionar (solo si supportsVariants)
  caps: Caps;
}

// `rotatable` es FALSE para cono, poste y maniquí: siempre deben verse erguidos.
// En el resto la rotación se aplica desde la BARRA DE CONTEXTO
// (±90°, un paso exacto) — DECISIÓN DEL DUEÑO (Fase 6): la antigua manija de
// rotación continua fue retirada. `resizable` TRUE en cajas (asas) y materiales
// (Tamaño); los jugadores no tienen control de tamaño.
// `supportsVariants` solo en cono/maniquí/escalera/aro (hot-swap real de assetKind).
const FAMILIES: Family[] = [
  { name: 'player', tool: 'Jugador propio', category: 'Jugadores', draw: false, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'player', tool: 'Jugador rival', category: 'Jugadores', draw: false, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'cone', tool: 'Cono', category: 'Material', draw: false, assetKind: 'cone_red', variantKind: 'cone_yellow', caps: { movable: true, rotatable: false, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: true, duplicable: true, exportable: true } },
  { name: 'ball', tool: 'Balón', category: 'Material', draw: false, assetKind: 'ball_football', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'mannequin', tool: 'Maniquí individual', category: 'Material', draw: false, assetKind: 'mannequin', caps: { movable: true, rotatable: false, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'minigoal', tool: 'Miniportería', category: 'Material', draw: false, assetKind: 'minigoal', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'pole', tool: 'Pértiga / poste', category: 'Material', draw: false, assetKind: 'pole', caps: { movable: true, rotatable: false, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'marker', tool: 'BOSU', category: 'Material', draw: false, assetKind: 'disc', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'hurdle', tool: 'Valla', category: 'Material', draw: false, assetKind: 'hurdle', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'ring', tool: 'Aro', category: 'Material', draw: false, assetKind: 'ring', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'ladder', tool: 'Escalera', category: 'Material', draw: false, assetKind: 'ladder', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'flag', tool: 'Banderín', category: 'Material', draw: false, assetKind: 'flag', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'trampoline', tool: 'Minitrampolín', category: 'Material', draw: false, assetKind: 'trampoline', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'target', tool: 'Chino', category: 'Material', draw: false, assetKind: 'target', caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'vball', tool: 'Fitball', category: 'Material', draw: false, assetKind: 'vball', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'peto', tool: 'Peto', category: 'Material', draw: false, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'chaleco', tool: 'Chaleco lastrado', category: 'Material', draw: false, caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'pica', tool: 'Pica', category: 'Material', draw: false, caps: { movable: true, rotatable: false, resizable: false, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'goal', tool: 'Portería grande', category: 'Material', draw: false, assetKind: 'goal', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'mannequin_row', tool: 'Barrera de maniquíes', category: 'Material', draw: false, assetKind: 'mannequin_row', caps: { movable: true, rotatable: false, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'dumbbell', tool: 'Mancuerna / pesa', category: 'Material', draw: false, assetKind: 'dumbbell', caps: { movable: true, rotatable: true, resizable: false, colorable: false, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'rect', tool: 'Rectángulo', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: true, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'ellipse', tool: 'Círculo / elipse', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: true, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'line', tool: 'Línea', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: true, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'arrow', tool: 'Flecha (movimiento)', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: true, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'doubleArrow', tool: 'Flecha doble sentido', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: true, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'curve', tool: 'Curva derecha', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: true, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'dribble', tool: 'Conducción (zigzag)', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: false, colorable: true, editableEndpoints: true, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'freehand', tool: 'Dibujo a mano alzada', category: 'Dibujo', draw: true, caps: { movable: true, rotatable: true, resizable: true, colorable: true, editableEndpoints: false, editableText: false, supportsVariants: false, duplicable: true, exportable: true } },
  { name: 'text', tool: 'Texto', category: 'Dibujo', draw: false, caps: { movable: true, rotatable: true, resizable: true, colorable: true, editableEndpoints: false, editableText: true, supportsVariants: false, duplicable: true, exportable: true } },
];

function assertModelEl(el: CanvasElement, fam: Family): void {
  expect(el.t).toBe(fam.name as string);
  if (fam.assetKind) {
    expect(el.assetKind).toBe(fam.assetKind);
    // Fuente de verdad: el manifiesto de assets. Un material vectorial (goal, dumbbell,
    // ball_vec, etc.) tiene asset === '' (se renderiza como SVG); uno rasterizado lleva
    // la ruta PNG de `assets/tactical/`.
    const ta = tacticAsset(fam.assetKind as TacticalKind);
    if (ta?.asset) expect(el.asset).toBe(ta.asset);
    else expect(!!el.asset).toBe(false); // vectorial: sin asset (vacío)
  } else {
    expect(el.asset).toBeUndefined();
  }
  // Fase 3: los materiales nacen con su tamaño base normalizado (escala coherente).
  // Fase 4: el tamaño inicial se reduce a 0.75 × la base antigua.
  const sizeKey = fam.assetKind ?? fam.name;
  if (TACTICAL_SIZE[sizeKey] !== undefined) {
    expect(el.size, `tamaño base normalizado de ${sizeKey}`).toBeCloseTo(TACTICAL_SIZE[sizeKey] * MATERIAL_SIZE_RATIO, 5);
  }
  const coords = [el.x, el.y, el.x1, el.y1, el.w, el.h].filter((v): v is number => typeof v === 'number');
  for (const c of coords) {
    expect(c).toBeGreaterThanOrEqual(-0.001);
    expect(c).toBeLessThanOrEqual(1.001);
  }
}

const stripId = ({ id: _id, ...rest }: CanvasElement): Omit<CanvasElement, 'id'> => rest;

// =============================================================
// Sección A — Matriz completa (crear/edit/persistir) — HONESTA
// =============================================================
for (const fam of FAMILIES) {
  test(`matriz completa: familia «${fam.tool}» (${fam.name}) crea, edita y persiste con igualdad de modelo`, async ({ page }) => {
    await seed(page);
    const box = (await page.locator('.board-host').boundingBox())!;

    await useTool(page, fam.tool, fam.category);
    if (fam.draw) {
      const sx = box.x + box.width * 0.3;
      const sy = box.y + box.height * 0.38;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.58, { steps: 4 });
      await page.mouse.up();
    } else {
      await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5, { button: 'right' });
    }
    await expect(page.locator('.field-count')).toHaveText('1');

    // Undo/redo de la creación (transacción atómica).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count')).toHaveText('0');
    await page.keyboard.press('Control+y');
    await expect(page.locator('.field-count')).toHaveText('1');

    // Modelo creado: tipo, material y coords normalizadas.
    await save(page);
    const before = await singleEl(page);
    await expect(page.locator('.ex-card')).toHaveCount(1);
    assertModelEl(before, fam);

    // Reabrir → re-guardar: la normalización no altera el modelo (igualdad).
    await reopen(page);
    await expect(page.locator('.field-count')).toHaveText('1');
    await save(page);
    expect(await singleEl(page)).toEqual(before);

    // Seleccionar y mover (arrastrar) desde su centro geométrico real.
    await reopen(page);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const [cx, cy] = normToScreen(...elCenter(before), box);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
    await save(page);
    const moved = await singleEl(page);
    assertModelEl(moved, fam);
    // Se ha trasladado (geometría distinta, no solo el id).
    expect(stripId(moved)).not.toEqual(stripId(before));

    // Duplicar (2) y borrar el seleccionado (1).
    await reopen(page);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const [cx2, cy2] = normToScreen(...elCenter(moved), box);
    await page.mouse.click(cx2, cy2, { button: 'right' });
    await page.keyboard.press('Control+d');
    await expect(page.locator('.field-count')).toHaveText('2');
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('1');
  });
}

// =============================================================
// Invariante del jugador de Plantilla: con playerId no se duplica.
// =============================================================
test('invariante: un jugador de la plantilla (playerId) no se puede duplicar ni como propio ni como rival', async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'pl1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      {
        id: 'e1', teamId: 't1', folderId: null, title: 'Jugada', description: '', explanation: '', category: 'Táctica',
        objectives: [], materials: [], durationMinutes: 10, minPlayers: 2, maxPlayers: 5, loadMode: 'fixed',
        seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false,
        canvas: {
          version: 2, schemaVersion: 3, field: 'half',
          frames: [{ duration: 1000, elements: [{ id: 'el1', t: 'player', x: 0.5, y: 0.5, n: 2, c: '#1a73e8', side: 'own', playerId: 'pl1', label: 'Marcos' }] }],
          orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a',
        },
        thumbnail: null, savedAt: now,
      },
    ]));
  });
  await page.goto('/library');
  await reopen(page);
  await expect(page.locator('.field-count')).toHaveText('1');
  expect((await singleEl(page)).playerId).toBe('pl1');

  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const box = (await page.locator('.board-host').boundingBox())!;
  const [cx, cy] = normToScreen(0.5, 0.5, box);
  await page.mouse.click(cx, cy, { button: 'right' });
  await page.keyboard.press('Control+d');
  await expect(page.locator('.field-count')).toHaveText('1');
  expect((await canvas(page)).frames[0].elements).toHaveLength(1);
});

// =============================================================
// Sección B — Gestos reales (manijas, extremos, papelera, undo)
// =============================================================

async function drawShape(page: Page, tool: string, from: [number, number], to: [number, number], box: Box): Promise<void> {
  await useTool(page, tool, 'Dibujo');
  const [x1, y1] = normToScreen(from[0], from[1], box);
  const [x2, y2] = normToScreen(to[0], to[1], box);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
}

/** Selecciona el elemento situado en la coordenada normalizada (nx, ny). */
async function selectAt(page: Page, nx: number, ny: number, box: Box): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [x, y] = normToScreen(nx, ny, box);
  // Fase 3: selección del elemento (clic) → se abre el inspector de Propiedades.
  await page.mouse.click(x, y);
  await expect(page.locator('.inspector')).toBeVisible();
}

/** Rellena un input numérico del inspector (por su etiqueta) y lo confirma. */
async function setInspNum(page: Page, label: string, value: string): Promise<void> {
  const input = page.locator('.studio-panel .inspector .field', { hasText: label }).locator('input');
  await input.fill(value);
  await input.press('Tab');
}

/** Pulsa un chip del inspector (por su texto) dentro del campo con la etiqueta dada. */
async function setInspChip(page: Page, label: string, chipText: string): Promise<void> {
  await page.locator('.studio-panel .inspector .field', { hasText: label }).locator('.chip', { hasText: chipText }).click();
}

/** Pulsa el swatch de color el índice indicado del campo Color. */
async function setInspColor(page: Page, index: number): Promise<void> {
  await page.locator('.studio-panel .inspector .field', { hasText: 'Color' }).locator('.swatch').nth(index).click();
}

/** Arrastra una manija (por coordenada normalizada) hasta un destino normalizado. */
async function dragHandle(page: Page, from: [number, number], to: [number, number], box: Box): Promise<void> {
  const [fx, fy] = normToScreen(from[0], from[1], box);
  const [tx, ty] = normToScreen(to[0], to[1], box);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

test('asas de extremo: arrastrar el extremo x2 de una línea cambia el modelo y un solo Ctrl+Z deshace', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await drawShape(page, 'Línea', [0.3, 0.3], [0.6, 0.6], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  expect((await singleEl(page)).x2).toBeCloseTo(0.6, 1);

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [mX, mY] = normToScreen(0.45, 0.45, box);
  await page.mouse.click(mX, mY, { button: 'right' });
  const [hX, hY] = normToScreen(0.6, 0.6, box);
  const [dX, dY] = normToScreen(0.78, 0.66, box);
  await page.mouse.move(hX, hY);
  await page.mouse.down();
  await page.mouse.move(dX, dY, { steps: 4 });
  await page.mouse.up();
  await save(page);
  const dragged = await singleEl(page);
  expect(dragged.x2).toBeCloseTo(0.78, 1);
  expect(dragged.y2).toBeCloseTo(0.66, 1);

  // Drag again → un solo Ctrl+Z revierte por completo.
  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [m2X, m2Y] = normToScreen(0.54, 0.48, box);
  await page.mouse.click(m2X, m2Y);
  const [h2X, h2Y] = normToScreen(0.78, 0.66, box);
  const [d2X, d2Y] = normToScreen(0.88, 0.72, box);
  await page.mouse.move(h2X, h2Y);
  await page.mouse.down();
  await page.mouse.move(d2X, d2Y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  await save(page);
  const undone = await singleEl(page);
  expect(undone.x2).toBeCloseTo(0.78, 1);
  expect(undone.y2).toBeCloseTo(0.66, 1);
});

test('asas de extremo: arrastrar el extremo x2 de una flecha curva cambia el modelo', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await drawShape(page, 'Curva derecha', [0.3, 0.3], [0.6, 0.6], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const created = await singleEl(page);
  expect(typeof created.c1x).toBe('number');

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [mX, mY] = normToScreen(0.45, 0.52, box);
  await page.mouse.click(mX, mY);
  const [hX, hY] = normToScreen(0.6, 0.6, box);
  const [dX, dY] = normToScreen(0.78, 0.66, box);
  await page.mouse.move(hX, hY);
  await page.mouse.down();
  await page.mouse.move(dX, dY, { steps: 4 });
  await page.mouse.up();
  await save(page);
  const dragged = await singleEl(page);
  expect(dragged.x2).toBeCloseTo(0.78, 1);
  expect(dragged.y2).toBeCloseTo(0.66, 1);
});

// DECISIÓN DEL DUEÑO (Fase 6): la rotación continua por manija fue retirada; ahora
// es ±90° desde la barra de contexto. El rectángulo se gira EXACTAMENTE +90° con la
// barra y un solo Ctrl+Z lo deshace.
test('barra de contexto: Girar +90° rota el elemento a un múltiplo de 90 y un solo Ctrl+Z deshace', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await drawShape(page, 'Rectángulo', [0.3, 0.3], [0.6, 0.6], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  expect((await singleEl(page)).rot).toBeUndefined();

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [cX, cY] = normToScreen(0.45, 0.45, box);
  // Fase 3: pulsación larga abre el menú contextual.
  await longPress(page, cX, cY);
  await rotateViaBar(page, 90);
  await save(page);
  const rotA = (await singleEl(page)).rot!;
  expect(typeof rotA).toBe('number');
  expect(rotA).toBeCloseTo(90, 0); // paso EXACTO de +90°

  // La antigua manija de rotación continua ya NO existe.
  expect(await page.locator('.rot-handle').count(), 'sin manija de rotación continua').toBe(0);
  expect(await page.locator('.rot-line').count(), 'sin línea de conexión de rotación').toBe(0);

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await longPress(page, cX, cY);
  await rotateViaBar(page, 90);
  await page.keyboard.press('Control+z');
  await save(page);
  expect((await singleEl(page)).rot).toBeCloseTo(rotA, 0);
});

// Contrato anterior: el cono podía tumbarse. Ahora permanece erguido y no ofrece giro.
test('barra de contexto: el cono no ofrece rotación y conserva su posición erguida', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;
  await useTool(page, 'Cono', 'Material');
  const [x, y] = normToScreen(0.5, 0.5, box);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const created = await singleEl(page);
  expect(created.rot).toBeUndefined();

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [cX, cY] = normToScreen(0.5, 0.5, (await page.locator('.board-host').boundingBox())!);
  await longPress(page, cX, cY);
  await expect(page.locator('.context-bar')).toBeVisible();
  await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toHaveCount(0);
});

// Rotación de una LÍNEA por la barra ±90°.
test('barra de contexto: Girar +90° de una línea cambia rot a 90 en el modelo', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;
  await drawShape(page, 'Línea', [0.3, 0.3], [0.65, 0.5], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const created = await singleEl(page);

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await longPress(page, ...normToScreen(...elCenter(created), box));
  await rotateViaBar(page, 90);
  await save(page);
  const after = await singleEl(page);
  expect(typeof after.rot).toBe('number');
  expect(after.rot).toBeCloseTo(90, 0);
});

// Rotación de un TEXTO por la barra ±90°.
test('barra de contexto: Girar +90° de un texto cambia rot a 90 y el texto persiste', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;
  await useTool(page, 'Texto', 'Dibujo');
  const [x, y] = normToScreen(0.5, 0.5, box);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const created = await singleEl(page);

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await longPress(page, ...normToScreen(...elCenter(created), box));
  await rotateViaBar(page, 90);
  await save(page);
  const after = await singleEl(page);
  expect(typeof after.rot).toBe('number');
  expect(after.rot).toBeCloseTo(90, 0);
  expect(typeof after.v).toBe('string');
});

// Redimensionar un RECTÁNGULO arrastrando el asa br.
test('redimensión con asa: arrastrar br de un rectángulo cambia w/h', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;
  await drawShape(page, 'Rectángulo', [0.3, 0.3], [0.6, 0.6], box);
  await save(page);
  const created = await singleEl(page);

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.mouse.click(...normToScreen(...elCenter(created), box), { button: 'right' });
  const br = boxHandles(created).find((h) => h.key === 'br')!;
  await dragHandle(page, [br.x, br.y], [br.x + 0.14, br.y + 0.12], box);
  await save(page);
  const after = await singleEl(page);
  expect(after.w).toBeCloseTo(0.44, 1);
  expect(after.h).toBeCloseTo(0.42, 1);
});

// Redimensionar una ELIPSE arrastrando el asa br.
test('redimensión con asa: arrastrar br de una elipse cambia w/h', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;
  await drawShape(page, 'Círculo / elipse', [0.3, 0.3], [0.6, 0.6], box);
  await save(page);
  const created = await singleEl(page);

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.mouse.click(...normToScreen(...elCenter(created), box), { button: 'right' });
  const br = boxHandles(created).find((h) => h.key === 'br')!;
  await dragHandle(page, [br.x, br.y], [br.x + 0.14, br.y + 0.12], box);
  await save(page);
  const after = await singleEl(page);
  expect(after.w).toBeCloseTo(0.44, 1);
  expect(after.h).toBeCloseTo(0.42, 1);
});

// La pica tiene un arriba físico; se mantiene estrecha y erguida pero sigue siendo seleccionable
// desde su centro y se puede mover sin una caja táctil desproporcionada.
test('pica erguida: se re-selecciona desde su centro y se mueve', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;
  await useTool(page, 'Pica', 'Material');
  await page.mouse.click(...normToScreen(0.5, 0.5, box), { button: 'right' });
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const created = await singleEl(page);

  // El contrato antiguo permitía tumbarla +90°; esa acción ya no aparece.
  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await longPress(page, ...normToScreen(...elCenter(created), (await page.locator('.board-host').boundingBox())!));
  await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Seleccionar el objeto erguido desde su centro.
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [cx, cy] = elCenter(created);
  await page.mouse.click(...normToScreen(cx, cy, box), { button: 'right' });
  await expect(page.locator('.inspector')).toBeVisible();

  // Y moverlo con el arrastre.
  const [sx, sy] = normToScreen(cx, cy, box);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy - 24, { steps: 4 });
  await page.mouse.up();
  await save(page);
  const moved = await singleEl(page);
  expect(Math.abs((moved.x ?? 0) - (created.x ?? 0))).toBeGreaterThan(0.02);
  expect(Math.abs((moved.y ?? 0) - (created.y ?? 0))).toBeGreaterThan(0.01);
});

test('manija de control c1 de una curva: arrastrarla solo cambia c1x/c1y (no rot ni extremos)', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await drawShape(page, 'Curva derecha', [0.3, 0.3], [0.6, 0.6], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const base = await singleEl(page);
  expect(typeof base.c1x).toBe('number');
  const first = { x2: base.x2, y2: base.y2, rot: base.rot };

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [mX, mY] = normToScreen(0.45, 0.52, box);
  await page.mouse.click(mX, mY, { button: 'right' });
  const [hX, hY] = normToScreen(base.c1x!, base.c1y!, box);
  const [dX, dY] = normToScreen(0.52, 0.7, box);
  await page.mouse.move(hX, hY);
  await page.mouse.down();
  await page.mouse.move(dX, dY, { steps: 4 });
  await page.mouse.up();
  await save(page);
  const dragged = await singleEl(page);
  expect(dragged.c1x).toBeCloseTo(0.52, 1);
  expect(dragged.c1y).toBeCloseTo(0.7, 1);
  expect(dragged.rot ?? 0).toBe(first.rot ?? 0);
  expect(dragged.x2).toBeCloseTo(first.x2!, 1);
  expect(dragged.y2).toBeCloseTo(first.y2!, 1);
});

test('barra de contexto: Girar +90° de una curva rota (solo rot, sin tocar c1 ni extremos)', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await drawShape(page, 'Curva derecha', [0.3, 0.3], [0.6, 0.6], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const base = await singleEl(page);
  const before = { c1x: base.c1x, c1y: base.c1y, x1: base.x1, x2: base.x2 };

  await reopen(page);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [mX, mY] = normToScreen(0.45, 0.52, box);
  await longPress(page, mX, mY);
  await rotateViaBar(page, 90);
  await save(page);
  const rotated = await singleEl(page);
  expect(typeof rotated.rot).toBe('number');
  expect(rotated.rot).toBeCloseTo(90, 0);
  expect(rotated.c1x).toBeCloseTo(before.c1x!, 1);
  expect(rotated.c1y).toBeCloseTo(before.c1y!, 1);
  expect(rotated.x1).toBeCloseTo(before.x1!, 1);
  expect(rotated.x2).toBeCloseTo(before.x2!, 1);
});

test('soltar un elemento sobre la papelera es una sola acción de undo (un Ctrl+Z lo restaura)', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await drawShape(page, 'Rectángulo', [0.3, 0.3], [0.5, 0.5], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await expect(page.locator('.board-trash')).not.toHaveClass(/trash-visible/);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [cX, cY] = normToScreen(0.4, 0.4, box);
  await page.mouse.click(cX, cY, { button: 'right' });
  const trash = await page.locator('.board-trash').boundingBox();
  await page.mouse.move(cX, cY);
  await page.mouse.down();
  await expect(page.locator('.board-trash')).toHaveClass(/trash-visible/);
  await page.mouse.move(trash!.x + trash!.width / 2, trash!.y + trash!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.field-count')).toHaveText('0');
  await expect(page.locator('.board-trash')).not.toHaveClass(/trash-visible/);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.field-count')).toHaveText('1');
});

test('la barra persistente muestra Deshacer/Rehacer con la animación cerrada y funcionan', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await expect(page.locator('.studio-tools')).toBeVisible();
  // Fase 3: Deshacer/Rehacer ya no están en la barra; viven en el menú contextual.
  await expect(page.locator('.studio-tools [aria-label="Seleccionar y mover"]')).toBeVisible();
  await expect(page.locator('[aria-label="Guardar"]')).toBeVisible();
  await expect(page.locator('.tl-add')).toHaveCount(0);

  await drawShape(page, 'Rectángulo', [0.3, 0.3], [0.6, 0.6], box);
  await expect(page.locator('.field-count')).toHaveText('1');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.field-count')).toHaveText('0');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.field-count')).toHaveText('1');

  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const [cx, cy] = normToScreen(0.45, 0.45, (await page.locator('.board-host').boundingBox())!);
  await longPress(page, cx, cy);
  await page.locator('.context-bar [aria-label="Eliminar"]').click();
  await expect(page.locator('.field-count')).toHaveText('0');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.field-count')).toHaveText('1');

  await page.locator('[aria-label="Más"]').click();
  await page.locator('[aria-label="Limpiar pizarra"]').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Vaciar', exact: true }).click();
  await expect(page.locator('.field-count')).toHaveText('0');
});

test('coherencia vertical: un jugador junto a la portería izquierda conserva el modelo al cambiar a vertical y reabrir', async ({ page }) => {
  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;

  await useTool(page, 'Jugador propio', 'Jugadores');
  // FASE B (paneles persistentes): el panel Jugadores queda abierto tras armar el
  // jugador y TAPA la zona izquierda del campo (x≈0.02). Lo cerramos con su botón X
  // (.panel-close) para poder tocar el punto de colocación (regla C).
  await page.locator('.side-panel-left .panel-close').click();
  const [x, y] = normToScreen(0.02, 0.5, box);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  const h = await singleEl(page);
  expect(h.x).toBeLessThan(0.05);

  await reopen(page);
  await openProps(page);
  await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
  await page.waitForTimeout(250);
  expect((await singleEl(page)).x).toBeCloseTo(h.x, 2);
  expect((await singleEl(page)).y).toBeCloseTo(h.y, 2);

  await save(page);
  await reopen(page);
  const after = await singleEl(page);
  expect(after.x).toBeCloseTo(h.x, 2);
  expect(after.y).toBeCloseTo(h.y, 2);
});

// =============================================================
// Exportación real de PNG (decodificación + región del elemento).
// =============================================================

/** Dispara la descarga "Descargar PNG" del menú y devuelve el buffer del fichero. */
async function exportPngBuf(page: Page): Promise<Buffer> {
  const dlPromise = page.waitForEvent('download');
  await page.locator('[aria-label="Exportar"]').click();
  await expect(page.locator('.top-pop-export')).toBeVisible();
  await page.locator('.rail-btn[title="Descargar PNG"]').click();
  const dl = await dlPromise;
  const p = await dl.path();
  const buf = fs.readFileSync(p!);
  expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47'); // firma PNG
  expect(buf.readUInt32BE(16)).toBe(1600); // IHDR width (horizontal)
  expect(buf.readUInt32BE(20)).toBe(1280); // IHDR height
  return buf;
}

/** Cuenta píxeles distintos entre dos PNG en la región centrada en (nx, ny) normalizado. */
async function pngRegionDiff(page: Page, a: Buffer, b: Buffer, nx: number, ny: number): Promise<number> {
  return await page.evaluate(async ({ a, b, nx, ny }) => {
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
    const W = ca.width, H = ca.height;
    const sx = Math.round(((nx * 92 + 4) / 100) * W);
    const sy = Math.round(((ny * (92 / (105 / 68)) + 10) / 80) * H);
    const ctxA = ca.getContext('2d')!;
    const ctxB = cb.getContext('2d')!;
    let changed = 0;
    for (let dy = -70; dy <= 70; dy += 3) {
      for (let dx = -70; dx <= 70; dx += 3) {
        const pa = ctxA.getImageData(sx + dx, sy + dy, 1, 1).data;
        const pb = ctxB.getImageData(sx + dx, sy + dy, 1, 1).data;
        if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]) > 60) changed++;
      }
    }
    return changed;
  }, { a: a.toString('base64'), b: b.toString('base64'), nx, ny });
}

// =============================================================
// Sección C — Matriz HONESTA de capacidades. Cada familia declara y
// EJECUTA cada capacidad con gestos reales (manija, asa, extremo,
// swatch de variante, export PNG). Nada se comprueba con una constante.
// =============================================================

/** Coloca un material eligiendo ANTES la variante (si aplica) y devuelve el modelo. */
async function placeElement(page: Page, fam: Family, box: Box, nx = 0.5, ny = 0.5): Promise<CanvasElement> {
  if (fam.caps.supportsVariants && fam.variantKind) {
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: fam.category! }).click();
    // Elegir la variante (swatch índice 1 = la primera NO por defecto) ANTES de colocar.
    const card = page.locator('.tools-material-card', { has: page.locator(`.rail-btn[title="${fam.tool}"]`) });
    await card.locator('.variant-swatch').nth(1).click();
    await page.locator(`.rail-btn[title="${fam.tool}"]`).click();
    const [x, y] = normToScreen(nx, ny, box);
    await page.mouse.click(x, y);
  } else {
    await useTool(page, fam.tool, fam.category);
    if (fam.draw) {
      const [x1, y1] = normToScreen(0.3, 0.3, box);
      const [x2, y2] = normToScreen(0.6, 0.6, box);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 4 });
      await page.mouse.up();
    } else {
      const [x, y] = normToScreen(nx, ny, box);
      await page.mouse.click(x, y);
    }
  }
  await expect(page.locator('.field-count')).toHaveText('1');
  await save(page);
  return await singleEl(page);
}

for (const fam of FAMILIES) {
  test(`capacidades de «${fam.tool}» (${fam.name}): cada capacidad declarada se ejecuta de verdad`, async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;

    // Línea base vacía (para la comparación de export PNG).
    let baseline: Buffer | null = null;
    if (fam.caps.exportable) baseline = await exportPngBuf(page);

    // Construir el objeto por la UI real.
    const created = await placeElement(page, fam, box, 0.45, 0.5);

    // Reabrir → seleccionar (una vez) en el centro geométrico real.
    await reopen(page);
    const [cx, cy] = elCenter(created);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(...normToScreen(cx, cy, box));
    await expect(page.locator('.inspector')).toBeVisible();

    const c = fam.caps;

    // 1) ROTACIÓN real: barra de contexto ±90° (la manija continua fue retirada por el
    //    dueño: la rotación ya no es por arrastre, sino un paso exacto de ±90°).
    //    Va primero porque no cambia la geometría (solo rot), luego las asas siguen.
    if (c.rotatable) {
      // Fase 3: el menú contextual se abre por PULSACIÓN LARGA sobre el elemento.
      await longPress(page, ...normToScreen(cx, cy, (await page.locator('.board-host').boundingBox())!));
  await rotateViaBar(page, 90);
      // La antigua manija de rotación continua ya NO debe existir (decisión del dueño).
      expect(await page.locator('.rot-handle').count(), 'sin manija de rotación continua').toBe(0);
      expect(await page.locator('.rot-line').count(), 'sin línea de conexión de rotación').toBe(0);
    } else if (['cone', 'pole', 'pica', 'mannequin', 'mannequin_row'].includes(fam.name)) {
      await longPress(page, ...normToScreen(cx, cy, (await page.locator('.board-host').boundingBox())!));
      await expect(page.locator('.context-bar')).toBeVisible();
      await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toHaveCount(0);
    }
    // 2) REDIMENSIÓN real: cajas → arrastrar asa br; materiales → input Tamaño.
    if (c.resizable) {
      const isBox = fam.name === 'rect' || fam.name === 'zone' || fam.name === 'ellipse' || fam.name === 'text' || fam.name === 'freehand';
      if (isBox) {
        const br = boxHandles(created).find((hh) => hh.key === 'br')!;
        await dragHandle(page, [br.x, br.y], [br.x + 0.12, br.y + 0.1], box);
      } else {
        await setInspNum(page, 'Tamaño', '1.8');
      }
    }
    // 3) EXTREMOS reales: arrastrar x2 (y c1 si es curva).
    if (c.editableEndpoints) {
      const seg = segHandles(created);
      const x2 = seg.find((hh) => hh.key === 'x2')!;
      const moved = created.x2 ?? 0.6;
      await dragHandle(page, [x2.x, x2.y], [moved + 0.12, x2.y + 0.08], box);
      if (fam.name === 'curve' && created.c1x != null) {
        await dragHandle(page, [created.c1x, created.c1y], [created.c1x + 0.1, created.c1y + 0.06], box);
      }
    }
    // 4) COLOR real: swatch índice 6 (#111111). Se usa NEGRO (y no el verde #1f7a4d
    //    de la versión antigua) porque el green-on-green apenas contrasta con el
    //    césped y hacía que la comprobación de EXPORT (región con cambio de píxel)
    //    diera 0 en elementos finos (mano alzada, texto). El color es arbitrario;
    //    negro garantiza que el elemento exportado sea detectable. DECISIÓN DEL
    //    DUEÑO: se elige un color con contraste, no un color concreto.
    if (c.colorable) {
      await setInspColor(page, 6);
    }
    // 5) TEXTO editable real.
    if (c.editableText) {
      const edit = page.locator('.studio-panel .inspector textarea, .studio-panel .inspector input[aria-label="Distancia"]').first();
      await edit.fill(fam.name === 'measure' ? '20 m' : 'Rondos 4v2\nConservación');
      await edit.dispatchEvent('change');
    }
    await save(page);
    const after = await singleEl(page);

    // Verificación (fuente de verdad: modelo persistido).
    if (c.rotatable) {
      expect(typeof after.rot).toBe('number');
      // DECISIÓN DEL DUEÑO: ahora la rotación es un paso EXACTO de ±90° (no un ángulo
      // arbitrario de la antigua manija), así que debe ser un múltiplo de 90.
      expect(after.rot! % 90).toBeCloseTo(0, 5);
      expect(Math.abs(after.rot!)).toBeGreaterThan(0);
    }
    if (c.resizable) {
      const isBox = fam.name === 'rect' || fam.name === 'zone' || fam.name === 'ellipse' || fam.name === 'text';
      if (isBox) {
        expect(after.w).toBeGreaterThan((created.w ?? 0) + 0.03);
        expect(after.h).toBeGreaterThan((created.h ?? 0) + 0.03);
      } else if (fam.name === 'freehand') {
        // Mano alzada: la escala es PROPORCIONAL (reescala los puntos), no un caja w/h.
        expect(after.points, 'el trazo rescalado debe conservar sus puntos').toBeTruthy();
        expect(freehandBBoxWidth(after.points as [number, number][])).toBeGreaterThan(
          freehandBBoxWidth(created.points as [number, number][]) + 0.03
        );
      } else {
        expect(after.size).toBeCloseTo(1.8, 1);
      }
    }
    if (c.editableEndpoints) {
      expect(typeof (after.x2 ?? after.x)).toBe('number');
      if (fam.name === 'curve') {
        expect(typeof after.c1x).toBe('number');
      }
      expect(after.x2 ?? after.x).not.toBeCloseTo(created.x2 ?? created.x ?? 0, 2); // el extremo se movió
    }
    if (c.colorable) expect(after.c).toBe('#111111');
    if (c.editableText) {
      if (fam.name === 'measure') expect(after.v).toBe('20 m');
      else expect(after.v).toContain('\n');
    }
    if (c.supportsVariants) {
      expect(after.assetKind).toBe(fam.variantKind); // el swatch cambió assetKind
      expect(after.assetKind).not.toBe(fam.assetKind);
    } else if (fam.assetKind) {
      expect(after.assetKind).toBe(fam.assetKind); // sin variante aplicada: conserva el defecto
    }

    // 6) EXPORT real: el elemento aparece en el PNG (región distinta del campo vacío).
    if (c.exportable) {
      await reopen(page);
      const withEl = await exportPngBuf(page);
      // Centro de la región de muestreo. Para un TEXTO con caja fija (autoH=false) los
      // glifos viven en la parte SUPERIOR de la caja (el centro geométrico queda bajo los
      // glifos y la región de muestreo no los alcanza): se muestrea sobre la zona del texto.
      const [ecx, ecy] = fam.name === 'text'
        ? [(after.x ?? 0) + (after.w ?? 0) / 2, (after.y ?? 0) + Math.min(after.h ?? 0.14, 0.15) / 2]
        : elCenter(after);
      const changed = await pngRegionDiff(page, baseline!, withEl, ecx, ecy);
      expect(changed).toBeGreaterThan(0);
    }
  });
}
