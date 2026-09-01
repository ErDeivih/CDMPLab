// =============================================================
// EntrenoLab — Contrato del generador de ejercicios con IA.
//
// `AiExerciseDraftV1` es un documento que representa INTENCIÓN
// futbolística (formaciones, jugadores, materiales, movimientos),
// NO SVG ni HTML arbitrarios. Está separado del modelo persistido
// `CanvasDocument`: la IA produce un borrador semántico y un
// compilador determinista (ai-compiler) lo convierte en elementos
// del campo. Solo se guarda tras la confirmación del entrenador.
//
// Versión del esquema: 1. Un documento con `schemaVersion !== 1`
// se rechaza por el validador (incompatible / parcial).
//
// REGLAS DE VALIDACIÓN (estricta):
//  - tipos de campo/orientación/shape conocidos;
//  - todos los números finitos;
//  - coordenadas normalizadas en [0, 1];
//  - cantidades limitadas (no miles de elementos);
//  - un jugador de plantilla real (`playerId`) no se duplica;
//  - materiales con `kind` conocido en el catálogo;
//  - documento completo y con la versión de esquema esperada.
// =============================================================
import { FieldType } from '../models';

export const AI_DRAFT_SCHEMA_VERSION = 1;

/** Límites de cantidad para evitar borradores absurdos. */
export const AI_DRAFT_LIMITS = {
  maxPlayers: 60, // propio + rival + porteros
  maxMaterials: 80,
  maxShapes: 160,
  maxTexts: 40,
  maxPointsPerFreehand: 200,
} as const;

export const AI_FIELD_TYPES: readonly FieldType[] = [
  'full', 'half', 'vertical_half', 'third', 'box', 'futsal', 'f7', 'blank',
] as const;

export type AiOrientation = 'horizontal' | 'vertical';

export type AiShapeKind =
  | 'line'
  | 'arrow'
  | 'doubleArrow'
  | 'curve'
  | 'zigzag'
  | 'freehand'
  | 'rect'
  | 'ellipse';

export const AI_SHAPE_KINDS: readonly AiShapeKind[] = [
  'line', 'arrow', 'doubleArrow', 'curve', 'zigzag', 'freehand', 'rect', 'ellipse',
] as const;

/** Punto normalizado 0..1 (compartido por jugadores, materiales, formas). */
export interface AiPoint {
  x: number;
  y: number;
}

export interface AiPlayer {
  /** Id estable del borrador (p. ej. 'own-1', 'rival-gk'). */
  id: string;
  team: 'own' | 'rival';
  position: AiPoint;
  number?: number;
  label?: string;
  isGoalkeeper?: boolean;
  /** Color hex del jugador (si falta, se usa el color del equipo). */
  color?: string;
  /** Si es un jugador de plantilla real, su `playerId` (una sola instancia). */
  playerId?: string;
}

export interface AiMaterial {
  /** `assetKind` del catálogo (p. ej. 'cone_red', 'ball', 'pole'). */
  kind: string;
  position: AiPoint;
  size?: number;
}

export interface AiShape {
  kind: AiShapeKind;
  from: AiPoint;
  to: AiPoint;
  /** Punto de control de la curva. */
  control?: AiPoint;
  /** Puntos de la mano alzada (>=2). */
  points?: AiPoint[];
  /** `true` = relleno, `false` = perímetro (solo rect/ellipse). */
  fill?: boolean;
  /** Color hex. */
  color?: string;
}

export interface AiText {
  position: AiPoint;
  value: string;
  size?: number;
}

export interface AiExerciseDraftV1 {
  schemaVersion: 1;
  title: string;
  description?: string;
  objective?: string;
  durationMinutes?: number;
  material?: string;
  field: FieldType;
  orientation: AiOrientation;
  playerCount?: number;
  ownColor?: string;
  rivalColor?: string;
  /** Id de formación propia ('4-3-3', '4-4-2', ...). */
  ownFormation?: string;
  /** Id de formación rival. */
  rivalFormation?: string;
  players?: AiPlayer[];
  materials?: AiMaterial[];
  shapes?: AiShape[];
  texts?: AiText[];
}
