// =============================================================
// EntrenoLab — Modelos de dominio
// =============================================================

import { CANONICAL_MATERIALS } from './material-registry';

export type Position = 'GK' | 'DF' | 'MF' | 'FW' | '';

export interface Team {
  id: string;
  name: string;
  accentColor: string;
  createdAt: string;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  number: number | null;
  position: Position;
  color: string;
  active: boolean;
  createdAt: string;
}

export type ExerciseCategory =
  | 'Técnica'
  | 'Táctica'
  | 'Físico'
  | 'Portero'
  | 'Calentamiento'
  | 'Rondo'
  | 'Posesión'
  | 'Finalización'
  | 'Defensa'
  | 'Ataque'
  | 'Transiciones'
  | 'Estrategia / ABP'
  | 'Partido'
  | 'Recuperación';

/** Lista ÚNICA de categorías (FASE 7). Se usa en el selector para evitar listas
 *  duplicadas. Los ejercicios antiguos conservan su categoría aunque no esté en la lista. */
export const EXERCISE_CATEGORIES: readonly ExerciseCategory[] = [
  'Técnica',
  'Táctica',
  'Físico',
  'Portero',
  'Calentamiento',
  'Rondo',
  'Posesión',
  'Finalización',
  'Defensa',
  'Ataque',
  'Transiciones',
  'Estrategia / ABP',
  'Partido',
  'Recuperación',
];

/** Opciones del checklist de "Material necesario" (FASE 8). Son las opciones mínimas
 *  que el dueño pedía, más "Otro" para elementos personalizados. Los valores se guardan
 *  como lista de strings y se conservan al guardar/reabrir/duplicar/exportar/importar. */
export const MATERIAL_OPTIONS: readonly string[] = [
  'Balones',
  'Conos',
  'Chinos',
  'Picas',
  'Petos',
  'Maniquíes',
  'Vallas',
  'Escalera',
  'Miniporterías',
  'Portería grande',
  'Aros',
  'BOSU',
  'Fitball',
  'Pesas / mancuernas',
  'Cronómetro',
  'Otro',
];

export type LoadMode = 'fixed' | 'interval';

export interface Exercise {
  id: string;
  teamId: string;
  folderId: string | null;
  title: string;
  description: string;
  explanation: string;
  category: ExerciseCategory;
  objectives: string[];
  materials: string[];
  durationMinutes: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  loadMode: LoadMode;
  seriesCount: number | null;
  repetitionsCount: number | null;
  workSeconds: number | null;
  restSeconds: number | null;
  isTemplate: boolean;
  canvas: CanvasDocument | null;
  thumbnail: string | null;
  savedAt: string;
  /** Concurrencia optimista: versión del ejercicio en el servidor (opcional). */
  revision?: number;
}

export interface ExerciseFolder {
  id: string;
  teamId: string;
  parentId: string | null;
  name: string;
}

// ---------- Canvas (pizarra táctica v2) ----------

export type FieldType =
  'full' | 'half' | 'vertical_half' | 'third' | 'box' | 'futsal' | 'f7' | 'blank' | 'two_halves'; // A2: dos medios campos (izquierda/derecha o arriba/abajo)

/**
 * Fuente ÚNICA y comprobable de los tipos de CAMPO ADMITIDOS. La usa la validación de
 * respaldo (`store.service`) y las pruebas de catálogo para no divergir: si se añade un
 * campo al catálogo (`field.FIELD_BASE_SPECS`) sin añadirlo aquí, un respaldo con ese campo
 * se rechaza ENTERO como "canvas inválido". Ya pasó dos veces (con `f7` y con `two_halves`,
 * que existían en el catálogo y no en la lista local del validador).
 *
 * Esta lista es la de los ADMITIDOS, no la de los OFRECIDOS: incluye `vertical_half`, que
 * ya NO se ofrece como tarjeta (su render es idéntico al de `half` con orientación
 * vertical) pero debe seguir validando los documentos antiguos. El normalizador de canvas
 * lo migra a `half` + orientación vertical.
 */
export const FIELD_TYPES: ReadonlySet<string> = new Set([
  'full',
  'half',
  'vertical_half',
  'third',
  'box',
  'futsal',
  'f7',
  'two_halves',
  'blank',
]);

export type ElementType =
  | 'player'
  | 'ball'
  | 'cone'
  | 'text'
  | 'zone'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'doubleArrow'
  | 'measure'
  | 'curve'
  | 'line'
  | 'dribble'
  | 'freehand'
  | 'mannequin'
  | 'mannequin_row'
  | 'minigoal'
  | 'goal'
  | 'pole'
  | 'marker'
  | 'hurdle'
  | 'ring'
  | 'ladder'
  | 'dumbbell'
  | 'flag'
  | 'trampoline'
  | 'target'
  | 'net'
  | 'vball'
  | 'coachC'
  | 'peto'
  | 'chaleco'
  | 'bosu'
  | 'fitball'
  | 'pica';

/**
 * Fuente ÚNICA y comprobable de los tipos de elemento admitidos. El render, la
 * validación de respaldo y las pruebas deben usar esto para no divergir.
 * Los tipos de MATERIAL se derivan del REGISTRO CANÓNICO (material-registry.ts) para
 * no mantener la lista a mano; se incluyen los materiales retirados (`hidden`) porque
 * sus documentos antiguos deben seguir siendo válidos (p. ej. `ring_flat`).
 */
export const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'player',
  'text',
  'zone',
  'rect',
  'ellipse',
  'arrow',
  'doubleArrow',
  'measure',
  'curve',
  'line',
  'dribble',
  'freehand',
  ...CANONICAL_MATERIALS.map((c) => c.id),
]);

export function isKnownElementType(t: string): boolean {
  return ELEMENT_TYPES.has(t);
}

export interface CanvasElement {
  id: string;
  t: ElementType;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: [number, number][];
  c1x?: number; // punto de control de curva (x)
  c1y?: number; // punto de control de curva (y)
  fill?: boolean; // contorno (false) vs relleno translúcido (true) para figuras
  n?: number; // dorsal (player)
  c?: string; // color hex
  /** Color de RELLENO de figuras (rect/elipse/zona). Si falta, se deriva de `c`.
   *  Fase 2: perímetro y relleno independientes. */
  fillColor?: string;
  /** Opacidad del relleno (0..1) de figuras. Si falta y hay relleno, default 0.16. */
  fillOpacity?: number;
  side?: 'own' | 'rival';
  label?: string;
  v?: string; // texto
  size?: number;
  w?: number;
  h?: number;
  style?: 'solid' | 'dashed';
  rot?: number;
  playerId?: string;
  locked?: boolean; // no seleccionable ni movible
  zIndex?: number; // orden de capas (mayor = encima)
  opacity?: number; // 0..1
  strokeWidth?: number; // grosor de línea
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  type?: 'player' | 'goalkeeper' | 'neutral'; // jugador / portero / comodín
  asset?: string; // PNG de material (si existe; si no, se dibuja la forma vectorial)
  assetKind?: string; // identificador estable del material (p. ej. 'cone_blue')
  /** Texto: `false` = el usuario fijó el cuadro manualmente (no auto-crece en alto). */
  autoH?: boolean;
}

export interface CanvasFrame {
  duration: number; // ms
  elements: CanvasElement[];
}

/** Overlay de Fútbol 7 transversal (parametrizable mediante preset versionado).
 *  Las proporciones viven en el preset (F7_PRESET_V1) y las calibra un preset, no
 *  controles técnicos expuestos al usuario. */
export interface F7Overlay {
  enabled: boolean;
  color: string;
  thickness: number;
  opacity: number;
}

export interface CanvasDocument {
  version: 2;
  field: FieldType;
  frames: CanvasFrame[];
  schemaVersion?: number;
  orientation?: 'horizontal' | 'vertical';
  backgroundColor?: string;
  lineColor?: string;
  grass?: 'stripes' | 'plain' | 'checker';
  grid?: boolean;
  guide?: 'none' | '2x2' | '3x3' | 'thirds' | 'lanes';
  f7?: F7Overlay | null;
  /**
   * FASE 2: color de cada jugador de plantilla DENTRO de este ejercicio (`playerId → color`).
   * El color elegido en la pizarra NO modifica al jugador de la plantilla: vive aquí. Si falta
   * (documentos antiguos), cada ficha usa el color guardado en el propio elemento y los jugadores
   * sin entrada usan su color de plantilla.
   */
  playerColors?: Record<string, string>;
}

// ---------- Sesiones ----------

export interface SessionTask {
  id: string;
  exerciseId: string | null;
  title: string; // snapshot del título del ejercicio
  durationMinutes: number | null;
  material: string;
  sortOrder: number;
  /** Copia de los datos del ejercicio al añadirlo (la sesión no cambia si se edita el original). */
  snapshot?: Exercise;
}

export interface Session {
  id: string;
  teamId: string;
  title: string;
  date: string; // yyyy-mm-dd
  durationMinutes: number | null;
  notes: string;
  tasks: SessionTask[];
  createdAt: string;
  savedAt: string;
  /** Concurrencia optimista: versión de la sesión en el servidor (opcional). */
  revision?: number;
}
