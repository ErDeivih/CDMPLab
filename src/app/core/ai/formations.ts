// =============================================================
// EntrenoLab — Formaciones tácticas reutilizables.
//
// Posiciones normalizadas 0..1 (X = largo, Y = ancho), mismas que usa
// la formación 4-3-3 / 4-4-2 en la pizarra. El compilador determinista
// del generador (ai-compiler) reutiliza este catálogo; el componente
// del tablero también lo usa para "Colocar formación".
// =============================================================

export interface Formation {
  id: string;
  label: string;
  /** Posiciones normalizadas (X, Y) de los 11 jugadores (portero + 10). */
  positions: Array<[number, number]>;
}

export const FORMATIONS: Formation[] = [
  { id: '4-3-3', label: '4-3-3', positions: [
    [0.06, 0.5],
    [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
    [0.5, 0.25], [0.5, 0.5], [0.5, 0.75],
    [0.82, 0.2], [0.82, 0.5], [0.82, 0.8],
  ] },
  { id: '4-4-2', label: '4-4-2', positions: [
    [0.06, 0.5],
    [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
    [0.5, 0.15], [0.5, 0.38], [0.5, 0.62], [0.5, 0.85],
    [0.8, 0.35], [0.8, 0.65],
  ] },
  { id: '3-5-2', label: '3-5-2', positions: [
    [0.06, 0.5],
    [0.26, 0.2], [0.26, 0.5], [0.26, 0.8],
    [0.5, 0.1], [0.5, 0.3], [0.5, 0.5], [0.5, 0.7], [0.5, 0.9],
    [0.8, 0.35], [0.8, 0.65],
  ] },
  { id: '4-2-3-1', label: '4-2-3-1', positions: [
    [0.06, 0.5],
    [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
    [0.45, 0.4], [0.45, 0.6],
    [0.62, 0.2], [0.62, 0.5], [0.62, 0.8],
    [0.8, 0.5],
  ] },
  { id: '4-1-4-1', label: '4-1-4-1', positions: [
    [0.06, 0.5],
    [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
    [0.4, 0.5],
    [0.58, 0.15], [0.58, 0.38], [0.58, 0.62], [0.58, 0.85],
    [0.8, 0.5],
  ] },
];

export function getFormation(id: string): Formation | undefined {
  return FORMATIONS.find((f) => f.id === id);
}
