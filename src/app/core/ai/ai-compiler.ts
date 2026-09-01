// =============================================================
// EntrenoLab — Compilador DETERMINISTA del borrador IA.
//
// `compileAiDraft(draft)` convierte un `AiExerciseDraftV1` (intención
// futbolística) en un `CanvasDocument` (elementos del campo) SIN
// depender de la IA. Es PURO y determinista:
//  - los ids se generan aquí con una fábrica determinista (por tipo e
//    índice), NO por la IA ni con UUID aleatorios;
//  - no inventa un segundo motor de pizarra (usa CanvasElement);
//  - respeta tamaños por defecto, orientación, límites y la regla de
//    una sola instancia por jugador de plantilla real;
//  - la formación RIVAL se refleja según el sentido del campo y usa su
//    propio color.
//
// Devuelve `doc` (borrador editable) y `meta` (los metadatos del
// borrador, de modo que el panel "Datos del ejercicio" se inicialice
// con el título/descripción/objetivo/duración/material/min-max que la
// IA propuso). Animaciones fuera de alcance (un solo frame).
// =============================================================
import {
  AiExerciseDraftV1, AiPoint, AiMaterial, AiPlayer, AiShape, AI_DRAFT_LIMITS,
} from './ai-draft';
import { validateAiDraft } from './ai-validator';
import { getFormation } from './formations';
import { materialAsset, materialBaseSize } from '../tactic-assets';
import { CanvasDocument, CanvasElement, CanvasFrame, FieldType } from '../models';
import { CANVAS_SCHEMA_VERSION } from '../canvas';
import { DEFAULT_TEXT_SIZE, DEFAULT_TEXT_W, DEFAULT_TEXT_H, DEFAULT_STROKE_WIDTH, DEFAULT_SHAPE_STROKE } from '../render';

/** Metadatos del borrador que el panel "Datos del ejercicio" debe conservar. */
export interface DraftMeta {
  title: string;
  description: string;
  explanation: string;
  durationMinutes: number | null;
  materials: string;
  minPlayers: number | null;
  maxPlayers: number | null;
  field: FieldType;
  orientation: 'horizontal' | 'vertical';
}

/** Fábrica de identificadores deterministas (inyectable para tests). */
export type IdFactory = (prefix: string, index: number) => string;

/** Fábrica por defecto: ids legibles y deterministas `prefix-index`. */
function defaultIdFactory(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

export type CompileResult =
  | { ok: true; doc: CanvasDocument; meta: DraftMeta }
  | { ok: false; error: string };

const DEFAULT_OWN = '#1a73e8';
const DEFAULT_RIVAL = '#c0392b';

/** Resuelve un `kind` de material a su `t` (ElementType) y `assetKind`/`asset`. */
function resolveMaterial(kind: string): { t: string; asset?: string; assetKind?: string; size: number } {
  const asset = materialAsset(kind);
  if (asset) return { t: kind, asset: asset.asset, assetKind: asset.kind, size: materialBaseSize(asset.kind) };
  const tool = toolForAssetKind(kind);
  if (tool) return { t: tool, assetKind: kind, size: materialBaseSize(kind) };
  return { t: kind, assetKind: kind, size: materialBaseSize(kind) };
}

const ASSET_TO_TOOL: Record<string, string> = {
  cone_red: 'cone', cone_yellow: 'cone', cone_blue: 'cone', cone_orange: 'cone',
  cone_white: 'cone', cone_blue2: 'cone', mannequin_row: 'mannequin',
  ladder_yellow: 'ladder', ring_flat: 'ring', ball_football: 'ball', ball_vec: 'ball',
  disc: 'marker',
};

function toolForAssetKind(kind: string): string | undefined {
  return ASSET_TO_TOOL[kind];
}

function shapeElement(s: AiShape, id: string): CanvasElement {
  const c = s.color;
  switch (s.kind) {
    case 'line':
      return { id, t: 'line', x1: s.from.x, y1: s.from.y, x2: s.to.x, y2: s.to.y, c: c ?? '#ffffff', strokeWidth: DEFAULT_STROKE_WIDTH };
    case 'arrow':
      return { id, t: 'arrow', x1: s.from.x, y1: s.from.y, x2: s.to.x, y2: s.to.y, style: 'solid', c: c ?? '#ffffff', strokeWidth: DEFAULT_STROKE_WIDTH };
    case 'doubleArrow':
      return { id, t: 'doubleArrow', x1: s.from.x, y1: s.from.y, x2: s.to.x, y2: s.to.y, style: 'solid', c: c ?? '#ffffff', strokeWidth: DEFAULT_STROKE_WIDTH };
    case 'curve': {
      const cx = s.control ? s.control.x : (s.from.x + s.to.x) / 2;
      const cy = s.control ? s.control.y : (s.from.y + s.to.y) / 2;
      return { id, t: 'curve', x1: s.from.x, y1: s.from.y, x2: s.to.x, y2: s.to.y, c1x: cx, c1y: cy, c: c ?? '#ffffff', strokeWidth: DEFAULT_STROKE_WIDTH };
    }
    case 'zigzag':
      return { id, t: 'dribble', x1: s.from.x, y1: s.from.y, x2: s.to.x, y2: s.to.y, c: c ?? '#ffffff', strokeWidth: DEFAULT_STROKE_WIDTH };
    case 'freehand':
      return { id, t: 'freehand', points: (s.points ?? [{ x: s.from.x, y: s.from.y }, { x: s.to.x, y: s.to.y }]).map((p) => [p.x, p.y]), c: c ?? '#ffffff', strokeWidth: DEFAULT_STROKE_WIDTH };
    case 'rect': {
      const x = Math.min(s.from.x, s.to.x);
      const y = Math.min(s.from.y, s.to.y);
      const w = Math.abs(s.to.x - s.from.x);
      const h = Math.abs(s.to.y - s.from.y);
      const fill = s.fill ?? false;
      return { id, t: 'rect', x, y, w, h, c: c ?? '#ffffff', fill, fillColor: c, fillOpacity: fill ? 0.16 : undefined, strokeWidth: DEFAULT_SHAPE_STROKE };
    }
    case 'ellipse': {
      const x = Math.min(s.from.x, s.to.x);
      const y = Math.min(s.from.y, s.to.y);
      const w = Math.abs(s.to.x - s.from.x);
      const h = Math.abs(s.to.y - s.from.y);
      const fill = s.fill ?? false;
      return { id, t: 'ellipse', x, y, w, h, c: c ?? '#ffffff', fill, fillColor: c, fillOpacity: fill ? 0.16 : undefined, strokeWidth: DEFAULT_SHAPE_STROKE };
    }
  }
}

function playerElement(p: AiPlayer, id: string, baseColor: string): CanvasElement {
  return {
    id,
    t: 'player',
    x: p.position.x,
    y: p.position.y,
    n: p.number ?? 0,
    c: p.color ?? baseColor,
    side: p.team,
    label: p.label,
    type: p.isGoalkeeper ? 'goalkeeper' : undefined,
    ...(p.playerId ? { playerId: p.playerId } : {}),
  };
}

/** Genera los jugadores de un equipo a partir de una formación (portero + 10).
 *  `mirror` refleja la formación al sentido contrario del campo (X → 1 - X),
 *  de modo que el rival ataca en dirección opuesta. */
function teamPlayers(team: 'own' | 'rival', formationId: string | undefined, color: string, mirror: boolean): AiPlayer[] {
  const formation = formationId ? getFormation(formationId) : undefined;
  if (!formation) return [];
  return formation.positions.map(([x, y], idx) => ({
    id: `${team}-${formation.id}-${idx}`,
    team,
    position: { x: mirror ? 1 - x : x, y },
    number: idx === 0 ? 1 : idx + 1,
    isGoalkeeper: idx === 0,
    color,
  }));
}

export function compileAiDraft(
  draft: AiExerciseDraftV1,
  opts: { idFactory?: IdFactory } = {},
): CompileResult {
  const validation = validateAiDraft(draft);
  if (!validation.ok) return { ok: false, error: validation.error };

  const idFactory = opts.idFactory ?? defaultIdFactory;
  const elements: CanvasElement[] = [];
  let playerIdx = 0;
  let materialIdx = 0;
  let shapeIdx = 0;
  let textIdx = 0;

  const nextPlayerId = () => idFactory('player', playerIdx++);
  const nextMaterialId = () => idFactory('material', materialIdx++);
  const nextShapeId = () => idFactory('shape', shapeIdx++);
  const nextTextId = () => idFactory('text', textIdx++);

  const ownColor = draft.ownColor ?? DEFAULT_OWN;
  const rivalColor = draft.rivalColor ?? DEFAULT_RIVAL;

  // Decisión documentada: si el borrador trae jugadores explícitos, se usan SOLO
  // ellos (precedencia) y las formaciones se ignoran; si NO trae jugadores, se
  // generan por formación. Nunca se mezclan en silencio.
  const explicitPlayers = draft.players ?? [];
  if (explicitPlayers.length > 0) {
    for (const p of explicitPlayers) {
      const color = p.team === 'own' ? ownColor : rivalColor;
      elements.push(playerElement(p, nextPlayerId(), color));
    }
  } else {
    for (const p of teamPlayers('own', draft.ownFormation, ownColor, false)) {
      elements.push(playerElement(p, nextPlayerId(), ownColor));
    }
    for (const p of teamPlayers('rival', draft.rivalFormation, rivalColor, true)) {
      elements.push(playerElement(p, nextPlayerId(), rivalColor));
    }
  }

  // Materiales.
  for (const m of draft.materials ?? []) {
    const r = resolveMaterial(m.kind);
    elements.push({ id: nextMaterialId(), t: r.t as CanvasElement['t'], x: m.position.x, y: m.position.y, size: m.size ?? r.size, ...(r.assetKind ? { assetKind: r.assetKind } : {}), ...(r.asset ? { asset: r.asset } : {}) });
  }

  // Formas.
  for (const s of draft.shapes ?? []) elements.push(shapeElement(s, nextShapeId()));

  // Textos.
  for (const t of draft.texts ?? []) {
    elements.push({
      id: nextTextId(), t: 'text', x: t.position.x, y: t.position.y, v: t.value,
      size: t.size ?? DEFAULT_TEXT_SIZE, w: DEFAULT_TEXT_W, h: DEFAULT_TEXT_H,
    });
  }

  const frame: CanvasFrame = { duration: 1000, elements };
  const field: FieldType = draft.field;
  const doc: CanvasDocument = {
    version: 2,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    field,
    frames: [frame],
    orientation: draft.orientation,
    backgroundColor: '#2e7d45',
    lineColor: '#ffffff',
    grass: 'stripes',
  };

  // Metadatos: el panel "Datos del ejercicio" se inicializa con el borrador.
  const playerCount = draft.playerCount ?? Math.round((explicitPlayers.length ? explicitPlayers.length : ((draft.ownFormation ? 11 : 0) + (draft.rivalFormation ? 11 : 0))));
  const meta: DraftMeta = {
    title: draft.title,
    description: draft.description ?? '',
    explanation: draft.objective ?? draft.description ?? '',
    durationMinutes: draft.durationMinutes ?? null,
    materials: draft.material ?? '',
    // playerCount exacto → min/max iguales; si no es entero razonable, null.
    minPlayers: typeof playerCount === 'number' && Number.isInteger(playerCount) && playerCount > 0 ? playerCount : null,
    maxPlayers: typeof playerCount === 'number' && Number.isInteger(playerCount) && playerCount > 0 ? playerCount : null,
    field,
    orientation: draft.orientation,
  };

  return { ok: true, doc, meta };
}
