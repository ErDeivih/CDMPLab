// =============================================================
// EntrenoLab — Geometría del "F7 transversal sobre medio campo F11".
// Preset normalizado y VERSIONADO (F7_PRESET_V1). Es la ÚNICA fuente
// de la proporción del F7: la usan tanto el overlay de compatibilidad
// (render.f7Svg) como la plantilla base 'f7' (field.f7Field), que dibuja
// el F7 PERPENDICULAR al medio campo del F11. Cambiar aquí actualiza
// ambos usos a la vez, sin exponer lenFrac/widFrac al modelo.
// =============================================================

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Preset "F7 transversal sobre medio campo F11" (v1). Todo en fracciones
 * normalizadas del campo (l = eje longitudinal, w = eje transversal).
 * En la plantilla base 'f7' el F7 se dibuja PERPENDICULAR al medio campo
 * del F11: sus porterías quedan a IZQUIERDA/DERECHA y su eje largo cruza el
 * ancho del medio campo; ver field.f7Field.
 * - Los fondos del F7 coinciden exactamente con las bandas del F11
 *   (l0=0 … l1=1), como en el campo real del club.
 * - Límites superior/inferior ~11-12 % desde los extremos (w0=0.115, w1=0.875).
 * - Las dos líneas interiores coinciden exactamente con los laterales del área
 *   grande del F11 (40,32 m sobre 68 m): 0,203529… y 0,796470… del largo.
 * - Áreas: profundidad 0,14 (grande) y 0,046 (pequeña), en fracción del largo.
 * Las cifras provienen de la referencia del club y se ajustarán por calibración
 * (nueva versión del preset → BUMO Y AL cambio de constante).
 */
export const F7_PRESET_V1 = {
  l0: 0,
  l1: 1,
  w0: 0.115,
  w1: 0.875,
  offside: [(68 - 40.32) / (2 * 68), 1 - (68 - 40.32) / (2 * 68)] as const,
  bigDepth: 0.14,
  bigW0: 0.193,
  bigW1: 0.807,
  smallDepth: 0.046,
  smallW0: 0.353,
  smallW1: 0.661,
};

export interface F7Geom {
  x: number;
  y: number;
  w: number;
  h: number;
  offsideX: [number, number];
  center: { x: number; y: number };
  big: Rect[];
  small: Rect[];
}

/** Computa la geometría del F7 en unidades de viewBox del rect canónico.
 *  F7-space: fl ∈ [0,1] a lo largo (eje l), fw ∈ [0,1] a lo ancho (eje w). */
export function f7Geometry(r: Rect): F7Geom {
  const p = F7_PRESET_V1;
  const xo = (fl: number) => r.x + (p.l0 + fl * (p.l1 - p.l0)) * r.w;
  const yo = (fw: number) => r.y + (p.w0 + fw * (p.w1 - p.w0)) * r.h;
  // Ancho/alto de un tramo en F7-space medidas en unidades de viewBox.
  const lSpan = (fl0: number, fl1: number) => (p.l1 - p.l0) * (fl1 - fl0) * r.w;
  const wSpan = (fw0: number, fw1: number) => (p.w1 - p.w0) * (fw1 - fw0) * r.h;
  return {
    x: xo(0),
    y: yo(0),
    w: xo(1) - xo(0),
    h: yo(1) - yo(0),
    offsideX: [xo(p.offside[0]), xo(p.offside[1])],
    center: { x: xo(0.5), y: yo(0.5) },
    big: [
      { x: xo(0), y: yo(p.bigW0), w: lSpan(0, p.bigDepth), h: wSpan(p.bigW0, p.bigW1) },
      { x: xo(1 - p.bigDepth), y: yo(p.bigW0), w: lSpan(1 - p.bigDepth, 1), h: wSpan(p.bigW0, p.bigW1) },
    ],
    small: [
      { x: xo(0), y: yo(p.smallW0), w: lSpan(0, p.smallDepth), h: wSpan(p.smallW0, p.smallW1) },
      { x: xo(1 - p.smallDepth), y: yo(p.smallW0), w: lSpan(1 - p.smallDepth, 1), h: wSpan(p.smallW0, p.smallW1) },
    ],
  };
}
