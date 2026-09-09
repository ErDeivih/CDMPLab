// =============================================================
// EntrenoLab — Transformación geométrica CENTRALIZADA al cambiar de campo (FASE 5).
//
// Funciones PURAS: reciben elementos (con sus coordenadas normalizadas 0..1 en el
// rect del campo ORIGEN) y devuelven los mismos elementos con las coordenadas de
// destino, sin mutar el estado. Son la ÚNICA fuente de la transformación: la usan
// el editor (al cambiar de medio campo a campo completo) y los tests.
//
// Convenciones de coordenadas:
//  - Cada elemento usa coordenadas normalizadas 0..1 RELATIVAS al rect de contenido
//    del campo en el que vive (la misma para elementos, hit-test, render y PNG).
//  - El rect del campo completo (horizontal) es {x:4,y:10,w:92,h:59.58} (105×68 m).
//  - El rect del medio campo (horizontal) es {x:4,y:4,w:46,h:59.58} (52,5×68 m):
//    el LARGO va en X (46) y el ANCHO en Y (59.58), igual que el campo completo
//    pero con la mitad de longitud.
//
// Por tanto, al pasar de medio campo a campo completo (colocando el ejercicio en la
// PRIMERA mitad), la fracción de longitud se divide por 2 (×52,5/105) y la fracción
// de anchura NO cambia (el ancho 68 m es idéntico). En VERTICAL los ejes se
// intercambian (el largo va en Y), pero la transformación de FRACCIONES es la misma:
// la mitad "equivalente"/superior mantiene la proporción.
// =============================================================

import { CanvasElement, CanvasFrame } from './models';

/** Lee las coordenadas posicionales de un elemento según su tipo. */
type Vec = { x: number; y: number };

/** Fracción de longitud del medio campo respecto al campo completo (52,5/105). */
export const HALF_LEN_RATIO = 52.5 / 105; // = 0.5

/** Coloca el ejercicio del medio campo en la PRIMERA mitad del campo completo.
 *  La mitad superior (vertical) o la primera mitad equivalente (horizontal).
 *  `vertical` indica la orientación VISUAL del campo completo destino.
 *  La fracción de LARGO se divide por 2 (52,5/105); la de ANCHO (68 m, idéntico)
 *  se conserva. En horizontal el largo va en X; en vertical el largo va en Y. */
export function transformHalfToFull(el: CanvasElement, vertical: boolean): CanvasElement {
  const out: CanvasElement = { ...el };
  // Por eje: length (se divide por rata) vs width (se conserva = identidad).
  const lengthAxis = vertical ? 'y' : 'x';
  const widthAxis = vertical ? 'x' : 'y';
  const mapPoint = (v?: number, axis?: 'x' | 'y') => {
    if (v === undefined) return v;
    if (axis === lengthAxis) return v * HALF_LEN_RATIO;
    return v;
  };
  const px = (v?: number) => mapPoint(v, 'x');
  const py = (v?: number) => mapPoint(v, 'y');
  const t = el.t;
  if (t === 'player' || t === 'ball' || t === 'cone' || t === 'mannequin' || t === 'mannequin_row' || t === 'minigoal' || t === 'goal' || t === 'pole' || t === 'marker' || t === 'hurdle' || t === 'ring' || t === 'ladder' || t === 'flag' || t === 'trampoline' || t === 'target' || t === 'net' || t === 'vball' || t === 'coachC' || t === 'peto' || t === 'chaleco' || t === 'bosu' || t === 'fitball' || t === 'pica' || t === 'dumbbell') {
    out.x = px(out.x);
    out.y = py(out.y);
  } else if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    out.x1 = px(out.x1); out.y1 = py(out.y1);
    out.x2 = px(out.x2); out.y2 = py(out.y2);
  } else if (t === 'curve') {
    out.x1 = px(out.x1); out.y1 = py(out.y1);
    out.x2 = px(out.x2); out.y2 = py(out.y2);
    out.c1x = px(out.c1x); out.c1y = py(out.c1y);
  } else if (t === 'freehand') {
    out.points = (el.points ?? []).map(([ax, ay]) => [px(ax) ?? 0, py(ay) ?? 0] as [number, number]);
  } else if (t === 'rect' || t === 'ellipse' || t === 'zone' || t === 'text') {
    out.x = px(out.x);
    out.y = py(out.y);
    out.w = mapPoint(out.w, 'x');
    out.h = mapPoint(out.h, 'y');
  }
  return out;
}

/** Aplica la transformación a una lista de elementos. */
export function transformElementsHalfToFull(elements: CanvasElement[], vertical: boolean): CanvasElement[] {
  return elements.map((e) => transformHalfToFull(e, vertical));
}

/** Aplica la transformación medio → completo a TODOS los frames (misma transformación
 *  por frame, porque el ejercicio es estático). */
export function transformFramesHalfToFull(frames: CanvasFrame[], vertical: boolean): CanvasFrame[] {
  return frames.map((f) => ({ ...f, elements: transformElementsHalfToFull(f.elements, vertical) }));
}

/** "ENC AJAR TODO en un medio campo" (A2): conserva la composición COMPLETA adaptándola
 *  al rectángulo del medio campo. Las coordenadas NORMALIZADAS se conservan (identidad),
 *  porque el rect del medio campo ya es físicamente la mitad de largo: el ejercicio ocupa
 *  el mismo [0,1] de cada contenido. NO se multiplica por 0,5 (eso comprimiría una segunda
 *  vez: medio→full→medio pasaría de 0,5 a 0,125) ni por 2 (0,75→1,5 sale del dominio).
 *  En vertical el largo va en Y, pero la FRACCIÓN se conserva igual. */
export function transformFullToHalf(el: CanvasElement, vertical: boolean): CanvasElement {
  const out: CanvasElement = { ...el };
  const mapPoint = (v?: number, _axis?: 'x' | 'y') => {
    // Identidad en ambos ejes: la composición completa se conserva (se adapta al rect
    // del medio campo, físicamente la mitad de largo, sin una segunda compresión).
    return v;
  };
  const px = (v?: number) => mapPoint(v, 'x');
  const py = (v?: number) => mapPoint(v, 'y');
  const t = el.t;
  if (t === 'player' || t === 'ball' || t === 'cone' || t === 'mannequin' || t === 'mannequin_row' || t === 'minigoal' || t === 'goal' || t === 'pole' || t === 'marker' || t === 'hurdle' || t === 'ring' || t === 'ladder' || t === 'flag' || t === 'trampoline' || t === 'target' || t === 'net' || t === 'vball' || t === 'coachC' || t === 'peto' || t === 'chaleco' || t === 'bosu' || t === 'fitball' || t === 'pica' || t === 'dumbbell') {
    out.x = px(out.x); out.y = py(out.y);
  } else if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    out.x1 = px(out.x1); out.y1 = py(out.y1);
    out.x2 = px(out.x2); out.y2 = py(out.y2);
  } else if (t === 'curve') {
    out.x1 = px(out.x1); out.y1 = py(out.y1);
    out.x2 = px(out.x2); out.y2 = py(out.y2);
    out.c1x = px(out.c1x); out.c1y = py(out.c1y);
  } else if (t === 'freehand') {
    out.points = (el.points ?? []).map(([ax, ay]) => [px(ax) ?? 0, py(ay) ?? 0] as [number, number]);
  } else if (t === 'rect' || t === 'ellipse' || t === 'zone' || t === 'text') {
    out.x = px(out.x); out.y = py(out.y);
    out.w = mapPoint(out.w, 'x');
    out.h = mapPoint(out.h, 'y');
  }
  return out;
}

/** A2: transforma el eje longitudinal de un ejercicio de MEDIO campo al campo completo
 *  o dos medios campos (colocar en la PRIMERA mitad). Es la MISMA operación que
 *  `transformHalfToFull` (×0,5 del largo). Alias semántico. */
export { transformHalfToFull as transformHalfToWider };

export function transformElementsFullToHalf(elements: CanvasElement[], vertical: boolean): CanvasElement[] {
  return elements.map((e) => transformFullToHalf(e, vertical));
}
export function transformFramesFullToHalf(frames: CanvasFrame[], vertical: boolean): CanvasFrame[] {
  return frames.map((f) => ({ ...f, elements: transformElementsFullToHalf(f.elements, vertical) }));
}

/** Traslada (todos los tipos) por un delta en coordenadas normalizadas, sin clamp,
 *  para que la transformación de campo NO recorte elementos en la franja. */
export function translateElementFree(el: CanvasElement, dx: number, dy: number): CanvasElement {
  const out: CanvasElement = { ...el };
  const tr = (v?: number, dv = 0) => (v === undefined ? v : v + dv);
  const t = el.t;
  if (t === 'player' || t === 'ball' || t === 'cone' || t === 'mannequin' || t === 'mannequin_row' || t === 'minigoal' || t === 'goal' || t === 'pole' || t === 'marker' || t === 'hurdle' || t === 'ring' || t === 'ladder' || t === 'flag' || t === 'trampoline' || t === 'target' || t === 'net' || t === 'vball' || t === 'coachC' || t === 'peto' || t === 'chaleco' || t === 'bosu' || t === 'fitball' || t === 'pica' || t === 'dumbbell') {
    out.x = tr(out.x, dx); out.y = tr(out.y, dy);
  } else if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    out.x1 = tr(out.x1, dx); out.y1 = tr(out.y1, dy);
    out.x2 = tr(out.x2, dx); out.y2 = tr(out.y2, dy);
  } else if (t === 'curve') {
    out.x1 = tr(out.x1, dx); out.y1 = tr(out.y1, dy);
    out.x2 = tr(out.x2, dx); out.y2 = tr(out.y2, dy);
    out.c1x = tr(out.c1x, dx); out.c1y = tr(out.c1y, dy);
  } else if (t === 'freehand') {
    out.points = (el.points ?? []).map(([ax, ay]) => [ax + dx, ay + dy] as [number, number]);
  } else if (t === 'rect' || t === 'ellipse' || t === 'zone' || t === 'text') {
    out.x = tr(out.x, dx); out.y = tr(out.y, dy);
  }
  return out;
}

/** A2: "Dos medios campos" conserva las coordenadas normalizadas (campo completo →
 *  two_halves cambia solo la geometría de fondo, sin perder elementos). Es identidad. */
export function mapToTwoHalves(elements: CanvasElement[], vertical: boolean): CanvasElement[] {
  return elements.map((e) => ({ ...e }));
}

/** A2: aplica `mapToTwoHalves` a todos los frames (identidad de coordenadas). */
export function mapFramesToTwoHalves(frames: CanvasFrame[], vertical: boolean): CanvasFrame[] {
  return frames.map((f) => ({ ...f, elements: mapToTwoHalves(f.elements, vertical) }));
}

export type { Vec };
