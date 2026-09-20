import type { CanvasFrame, Player } from './models';

// =============================================================
// EntrenoLab — COLOR DE JUGADOR POR EJERCICIO (FASE 2 del encargo).
//
// DEFECTO CORREGIDO: `setRosterColor` llamaba a `store.updatePlayer({ color })`, así que elegir
// un color en la pizarra cambiaba PERMANENTEMENTE al jugador de la plantilla (y con él, todos
// los ejercicios). Ahora el color vive en el DOCUMENTO del ejercicio (`CanvasDocument.playerColors`,
// un mapa `playerId → color`) y la plantilla no se toca nunca.
//
// Compatibilidad:
//  · Documentos antiguos: no tienen mapa. Las fichas YA colocadas conservan el color guardado en
//    cada elemento (`c`) y no se reescriben; las fichas NUEVAS de un jugador sin asignación salen
//    con el color común por defecto (azul), NO con el color de su plantilla.
//  · Jugadores genéricos por color (`QUICK_GENERIC_COLORS`): no tienen `playerId`, así que no
//    pasan por este módulo y siguen funcionando igual.
// =============================================================

/** Paleta de la fila de un jugador de plantilla (al menos los cinco del encargo). */
export const PALETA_JUGADOR: ReadonlyArray<{ nombre: string; color: string }> = [
  { nombre: 'Azul', color: '#1a73e8' },
  { nombre: 'Rojo', color: '#c0392b' },
  { nombre: 'Amarillo', color: '#f6c945' },
  { nombre: 'Naranja', color: '#e67e22' },
  { nombre: 'Morado', color: '#8e44ad' },
];

/** Color por defecto de un jugador sin asignación propia en el ejercicio. */
export const COLOR_JUGADOR_POR_DEFECTO = PALETA_JUGADOR[0].color;

export type MapaColoresJugador = Record<string, string>;

/** Normaliza un mapa de colores venido de un documento/almacenamiento desconocido. */
export function normalizarMapaColores(raw: unknown): MapaColoresJugador {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: MapaColoresJugador = {};
  for (const [id, color] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === 'string' && id && typeof color === 'string' && color) out[id] = color;
  }
  return out;
}

/**
 * Color con el que se pinta y se coloca un jugador de plantilla EN ESTE EJERCICIO.
 *
 * CONTRATO CORREGIDO (revisión externa del informe): antes caía al `Player.color` permanente
 * —`mapa → plantilla → azul`— y eso CONTRADICE el requisito del dueño: en la pizarra, un jugador
 * sin asignación propia del ejercicio debe salir SIEMPRE con el color común por defecto (azul),
 * aunque en la plantilla tenga otro color permanente. El color de la plantilla NO participa en
 * ninguna decisión sobre lo que se dibuja en la pizarra: solo lo usan pantallas como Plantilla.
 *
 * Lo que sí se respeta es lo ya guardado: las fichas de documentos históricos conservan su `c`
 * (no se reescriben), y solo las fichas NUEVAS de un jugador sin asignación salen azules.
 *
 * El parámetro acepta `color` solo por comodidad de las llamadas (se les pasa el `Player` entero):
 * NO se lee nunca. Es justo lo que fija la prueba unitaria con dos colores de plantilla distintos.
 */
export function colorDeJugador(
  mapa: MapaColoresJugador,
  jugador: Pick<Player, 'id'> & { color?: string },
): string {
  const propio = mapa[jugador.id];
  if (typeof propio === 'string' && propio.trim()) return propio.trim();
  return COLOR_JUGADOR_POR_DEFECTO;
}

/** Devuelve un mapa nuevo con el color asignado (inmutable: lo usan signals). */
export function conColorDeJugador(
  mapa: MapaColoresJugador,
  playerId: string,
  color: string,
): MapaColoresJugador {
  return { ...mapa, [playerId]: color };
}

/** Repinta las fichas YA colocadas de un jugador (solo las de ese `playerId`). */
export function pintarFichasDeJugador(
  frames: CanvasFrame[],
  playerId: string,
  color: string,
): CanvasFrame[] {
  return frames.map((f) => ({
    ...f,
    elements: f.elements.map((e) =>
      e.t === 'player' && e.playerId === playerId ? { ...e, c: color } : e,
    ),
  }));
}

/** ¿Cuántas fichas de ese jugador hay colocadas? (para saber si hay algo que repintar) */
export function fichasDeJugador(frames: CanvasFrame[], playerId: string): number {
  return frames.reduce(
    (n, f) => n + f.elements.filter((e) => e.t === 'player' && e.playerId === playerId).length,
    0,
  );
}
