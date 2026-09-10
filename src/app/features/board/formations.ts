// =============================================================
// CDMPLab — Formaciones tácticas rápidas (data + lógica PURA).
//
// Módulo sin dependencias de Angular para poder probarse con los tests
// unitarios (vitest) y para separar la GEOMETRÍA de la colocación.
//
// Fase 5 (correctivo): las formaciones son INDEPENDIENTES DE LA PLANTILLA.
// `buildFormationPlayers` genera SIEMPRE 11 CÍRCULOS GENÉRICOS por lado, SIN
// `playerId` ni `label` y SIN rol especial visible (ni "POR"): todos son
// círculos del COLOR elegido con su dorsal. La diferenciación propia/rival es
// SOLO por color; `reflectRival` (espejo en X) es la geometría, no un selector
// de lado. No consume ni depende de la plantilla.
// =============================================================

export interface Formation {
  id: string;
  label: string;
  positions: Array<[number, number]>;
}

export const FORMATIONS: Formation[] = [
  {
    id: '4-3-3',
    label: '4-3-3',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.5, 0.25], [0.5, 0.5], [0.5, 0.75],
      [0.82, 0.2], [0.82, 0.5], [0.82, 0.8],
    ],
  },
  {
    id: '4-4-2',
    label: '4-4-2',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.5, 0.15], [0.5, 0.38], [0.5, 0.62], [0.5, 0.85],
      [0.8, 0.35], [0.8, 0.65],
    ],
  },
  {
    id: '3-5-2',
    label: '3-5-2',
    positions: [
      [0.06, 0.5],
      [0.26, 0.2], [0.26, 0.5], [0.26, 0.8],
      [0.5, 0.1], [0.5, 0.3], [0.5, 0.5], [0.5, 0.7], [0.5, 0.9],
      [0.8, 0.35], [0.8, 0.65],
    ],
  },
  {
    id: '4-2-3-1',
    label: '4-2-3-1',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.45, 0.4], [0.45, 0.6],
      [0.62, 0.2], [0.62, 0.5], [0.62, 0.8],
      [0.8, 0.5],
    ],
  },
  {
    id: '4-1-4-1',
    label: '4-1-4-1',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.4, 0.5],
      [0.58, 0.15], [0.58, 0.38], [0.58, 0.62], [0.58, 0.85],
      [0.8, 0.5],
    ],
  },
];

/** Resultado puro de la colocación de una formación: specs de jugadores genéricos.
 *  Sin `n` (sin dorsal), sin `side` (la diferenciación es por color) y sin `type`.
 *  `reflectRival` solo ESpeja las posiciones en X (la geometría del lado contrario). */
export interface FormationPlayerSpec {
  x: number;
  y: number;
  c: string;
}

/**
 * Genera la especificación de los 11 CÍRCULOS GENÉRICOS de una formación.
 * - Todos (índice 0..10) usan el color `color` recibido.
 * - NINGUNO asigna nombre, dorsal, `side` ni `type: 'goalkeeper'`: no hay "POR" ni rol.
 * - `reflectRival` refleja las posiciones en X (1-x): la geometría del lado contrario.
 *   La diferenciación propia/rival es por color; el espejo es solo geometría.
 * No depende de la plantilla: devuelve SIEMPRE 11 (o menos si la formación
 * tuviera menos posiciones, cosa que no ocurre en FORMATIONS).
 */
export function buildFormationPlayers(color: string, formationId: string, reflectRival = false): FormationPlayerSpec[] | null {
  const f = FORMATIONS.find((x) => x.id === formationId);
  if (!f) return null;
  return f.positions.map(([x, y]) => ({
    x: reflectRival ? 1 - x : x,
    y,
    c: color,
  }));
}

/** C1: fichas rápidas de jugador GENERICO por COLOR (la diferenciación es por color, no por
 *  concepto comodín). ≥5 fichas: azul, rojo, amarillo, verde y morado. Se exportan de este
 *  módulo puro para poder probarse con vitest (sin arrastrar Angular) y las consume el
 *  board a través de su propio import. */
export const QUICK_GENERIC_COLORS: Array<{ c: string; label: string }> = [
  { c: '#1a73e8', label: 'Azul' },
  { c: '#c0392b', label: 'Rojo' },
  { c: '#e6b800', label: 'Amarillo' },
  { c: '#1f7a4d', label: 'Verde' },
  { c: '#b884ff', label: 'Morado' },
];
