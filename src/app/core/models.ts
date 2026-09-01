// =============================================================
// EntrenoLab — Modelos de dominio
// =============================================================

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
  | 'Partido';

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
  | 'full'
  | 'half'
  | 'vertical_half'
  | 'third'
  | 'box'
  | 'futsal'
  | 'f7'
  | 'blank';

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
  | 'minigoal'
  | 'pole'
  | 'marker'
  | 'hurdle'
  | 'ring'
  | 'ladder'
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
 */
export const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'player', 'ball', 'cone', 'text', 'zone', 'rect', 'ellipse', 'arrow', 'doubleArrow', 'measure',
  'curve', 'line', 'dribble', 'freehand', 'mannequin', 'minigoal', 'pole', 'marker', 'hurdle',
  'ring', 'ladder', 'flag', 'trampoline', 'target', 'net', 'vball', 'coachC', 'peto', 'chaleco',
  'bosu', 'fitball', 'pica',
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
