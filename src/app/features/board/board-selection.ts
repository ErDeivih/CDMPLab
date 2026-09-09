import { CanvasElement } from '../../core/models';
import { CANONICAL_MATERIALS } from '../../core/material-registry';
import { py, px, BOARD_CANON_RECT, materialSize, MATERIAL_BOX, SEL_STROKE, SEL_STROKE_POINT } from '../../core/render';
import { elementCenter } from './board-doc';

// =============================================================
// EntrenoLab — Selección/geometría PURA de la pizarra.
// sin estado, sin UI. Operan sobre elementos + geometría.
// =============================================================

/**
 * Ids de CATEGORÍA MATERIAL (objetos del catálogo, NO jugadores ni texto), derivados
 * del REGISTRO CANÓNICO (`material-registry.ts`) — la fuente ÚNICA del catálogo.
 * Se incluyen TAMBIÉN los materiales retirados (`hidden`) porque un documento antiguo
 * puede contener cualquiera de esos ids y debe seguir tratándose como material (sin
 * asas de redimensionado). Al derivarlo del registro se evita mantener a mano esta
 * lista en paralelo.
 */
const MATERIAL_TYPES: ReadonlySet<string> = new Set(CANONICAL_MATERIALS.map((c) => c.id));

/** Elementos PUNTUALES no-material (jugador y texto) que sumamos a los materiales. */
const POINT_LIKE_NON_MATERIAL: ReadonlySet<string> = new Set(['player', 'text']);

/** true si el tipo pertenece a la categoría Material (no jugador ni texto). */
export function isMaterial(t: string): boolean {
  return MATERIAL_TYPES.has(t);
}

/** true si el tipo es "puntual" (jugador/genérico, texto o material): se mueve con un
 *  punto, rota ±90° y (los no-material) se redimensionan vía `size`. */
export function isPointLike(t: string): boolean {
  return POINT_LIKE_NON_MATERIAL.has(t) || isMaterial(t);
}

/** Centro (normalizado 0..1) de un elemento, según su geometría. */
export function selCenter(el: CanvasElement): { x: number; y: number } {
  return elementCenter(el);
}

/** Normaliza un ángulo (grados) a [0, 360). Se usa en los giros ±90° para que el
 *  resultado sea siempre un múltiplo exacto de 90 en el intervalo canónico. */
export function normalizeRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const SEL = '#2563eb';

/** Mitad (normalizada) MÍNIMA del cuadro de redimensionado de un material/jugador.
 *  Es mayor que el material de tamaño pequeño para que las asas de esquina queden
 *  CLARAMENTE separadas del centro: así tocar el CENTRO mueve el objeto y tocar un
 *  asa lo escala (sin esto, el asa quedaría dentro de la tolerancia de toque del
 *  centro y arruinaría el arrastre para mover). */
export const MIN_RESIZE_HALF = 0.06;

/** Semiejes (normalizado 0..1) del cuadro de redimensionado de un material/jugador
 *  para UN tamaño `size` concreto: la caja del material (MATERIAL_BOX × size) pero
 *  con un mínimo `MIN_RESIZE_HALF` por eje. */
export function pointLikeResizeHalf(size: number, r: { x: number; y: number; w: number; h: number } = BOARD_CANON_RECT): { hw: number; hh: number } {
  const hw = Math.max((MATERIAL_BOX * size / 2) / r.w, MIN_RESIZE_HALF);
  const hh = Math.max((MATERIAL_BOX * size / 2) / r.h, MIN_RESIZE_HALF);
  return { hw, hh };
}

/**
 * Asas de redimensionado (normalizado 0..1) de un elemento, según su familia.
 * - rect/zone/ellipse/text: cuatro asas de esquina del cuadro (tl/tr/bl/br).
 * - línea/flecha/doble-sentido/medición/zigzag: asas en AMBOS extremos.
 * - flecha curva: extremos + punto de control (c1).
 * - mano alzada: caja envolvente con asas de esquina (escala proporcional).
 * - jugadores/materiales: cuadro de selección con asas de esquina (escala UNIFORME
 *   vía `size`). `MUCHO más pequeño` visualmente que la antigua manija de rotación,
 *   con un área táctil mayor (la tolerancia de toque la amplía el llamador).
 * `r` es el rect canónico activo (por defecto BOARD_CANON_RECT).
 */
export function resizeHandles(el: CanvasElement, r: { x: number; y: number; w: number; h: number } = BOARD_CANON_RECT): Array<{ x: number; y: number; key: string }> {
  const t = el.t;
  // Fase 1: los MATERIALES no se redimensionan — sin asas (ni UI ni gesto).
  if (isMaterial(t)) return [];
  if (t === 'rect' || t === 'zone' || t === 'ellipse' || t === 'text') {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.w ?? 0;
    const h = el.h ?? 0;
    return [
      { x, y, key: 'tl' },
      { x: x + w, y, key: 'tr' },
      { x, y: y + h, key: 'bl' },
      { x: x + w, y: y + h, key: 'br' },
    ];
  }
  if (t === 'line' || t === 'arrow' || t === 'curve' || t === 'doubleArrow' || t === 'measure' || t === 'dribble') {
    const hs = [
      { x: el.x1 ?? 0, y: el.y1 ?? 0, key: 'x1' },
      { x: el.x2 ?? 0, y: el.y2 ?? 0, key: 'x2' },
    ];
    if (t === 'curve') hs.push({ x: el.c1x ?? 0, y: el.c1y ?? 0, key: 'c1' });
    return hs;
  }
  if (t === 'freehand') {
    // Caja envolvente del trazo: asas en las 4 esquinas (escala proporcional).
    const pts = el.points ?? [];
    if (!pts.length) return [];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return [
      { x: minX, y: minY, key: 'tl' },
      { x: maxX, y: minY, key: 'tr' },
      { x: minX, y: maxY, key: 'bl' },
      { x: maxX, y: maxY, key: 'br' },
    ];
  }
  if (isPointLike(t)) {
    // Jugadores y materiales: cuadro de selección + asas de esquina para escala
    // UNIFORME (se persiste vía `size`). Caja centrada en (x,y) con un mínimo por
    // eje para que las asas queden lejos del centro (arrastrar el centro = mover).
    const { hw, hh } = pointLikeResizeHalf(el.size ?? materialSize(el), r);
    const cx = el.x ?? 0;
    const cy = el.y ?? 0;
    return [
      { x: cx - hw, y: cy - hh, key: 'tl' },
      { x: cx + hw, y: cy - hh, key: 'tr' },
      { x: cx - hw, y: cy + hh, key: 'bl' },
      { x: cx + hw, y: cy + hh, key: 'br' },
    ];
  }
  return [];
}

/** Contorno de selección (SVG) de un elemento, dado el rect activo. */
export function elementOutline(el: CanvasElement, r: { x: number; y: number; w: number; h: number }): string {
  // TEXTO: NO se pinta aquí ninguna forma. Su selección la dibujan el cuadro
  // punteado (`.text-edit-rect`, render.ts) y las 4 manijas de redimensionado
  // (board.component.ts). Un círculo centrado en el origen (el.x/el.y) taparía
  // los primeros glifos del texto.
  if (el.t === 'text') return '';
  if (isPointLike(el.t)) {
    const x = px(el.x ?? 0, r);
    const y = py(el.y ?? 0, r);
    return `<circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="${SEL}" stroke-width="${SEL_STROKE_POINT}" stroke-dasharray="1,0.7"/>`;
  }
  if (el.t === 'arrow' || el.t === 'line' || el.t === 'dribble' || el.t === 'doubleArrow' || el.t === 'measure') {
    return `<line x1="${px(el.x1 ?? 0, r)}" y1="${py(el.y1 ?? 0, r)}" x2="${px(el.x2 ?? 0, r)}" y2="${py(el.y2 ?? 0, r)}" stroke="${SEL}" stroke-width="${SEL_STROKE}" stroke-dasharray="1,0.7"/>`;
  }
  if (el.t === 'curve') {
    const cxd = ((el.x1 ?? 0) + (el.x2 ?? 0)) / 2;
    const cyd = ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2;
    return `<path d="M ${px(el.x1 ?? 0, r)} ${py(el.y1 ?? 0, r)} Q ${px(el.c1x ?? cxd, r)} ${py(el.c1y ?? cyd, r)} ${px(el.x2 ?? 0, r)} ${py(el.y2 ?? 0, r)}" fill="none" stroke="${SEL}" stroke-width="${SEL_STROKE}" stroke-dasharray="1,0.7"/>`;
  }
  if (el.t === 'freehand') {
    const pts = (el.points ?? []).map(([pxx, pyy]) => `${px(pxx, r)},${py(pyy, r)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${SEL}" stroke-width="${SEL_STROKE}" stroke-dasharray="1,0.7"/>`;
  }
  if (el.t === 'ellipse' || el.t === 'zone' || el.t === 'rect') {
    const x = px(el.x ?? 0, r);
    const y = py(el.y ?? 0, r);
    if (el.t === 'ellipse') {
      return `<ellipse cx="${x + ((el.w ?? 0) * r.w) / 2}" cy="${y + ((el.h ?? 0) * r.h) / 2}" rx="${((el.w ?? 0) * r.w) / 2}" ry="${((el.h ?? 0) * r.h) / 2}" fill="none" stroke="${SEL}" stroke-width="${SEL_STROKE}" stroke-dasharray="1,0.7"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${(el.w ?? 0) * r.w}" height="${(el.h ?? 0) * r.h}" fill="none" stroke="${SEL}" stroke-width="${SEL_STROKE}" stroke-dasharray="1,0.7"/>`;
  }
  return '';
}
