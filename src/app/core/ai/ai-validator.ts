// =============================================================
// EntrenoLab — Validador ESTRICTO del contrato AiExerciseDraftV1.
//
// Rechaza (devolviendo un error descriptivo) cualquier borrador que:
//  - no sea un objeto o tenga `schemaVersion !== 1`;
//  - no use ARRAYS reales para players/materials/shapes/texts;
//  - contenga propiedades DESCONOCIDAS en cualquier nivel (additionalProperties=false);
//  - use tipos de campo / orientación / forma desconocidos;
//  - tenga valores no finitos o coordenadas fuera de [0, 1];
//  - exceda las cantidades máximas (AI_DRAFT_LIMITS);
//  - duplique un jugador de plantilla real (`playerId`);
//  - use un material inexistente en el catálogo o una formación inexistente;
//  - tenga tipos incorrectos o límites absurdos (duration, playerCount, sizes, texto);
//  - tenga shapes degeneradas (ancho/largo cero) o `points` fuera de mano alzada;
//  - sea parcial / incompatible con la versión.
//
// Devuelve `{ ok: true }` o `{ ok: false, error }`. No lanza.
// Existe un JSON Schema equivalente (AI_DRAFT_JSON_SCHEMA, additionalProperties=false)
// para usar como Structured Output de la Responses API.
// =============================================================
import {
  AiExerciseDraftV1, AiPlayer, AiMaterial, AiShape, AiText,
  AI_DRAFT_SCHEMA_VERSION, AI_DRAFT_LIMITS, AI_FIELD_TYPES, AI_SHAPE_KINDS,
} from './ai-draft';
import { getFormation } from './formations';
import { TACTIC_ASSETS } from '../tactic-assets';

/** Tipos de elemento que son material (se colocan con clic, no se dibujan). */
const MATERIAL_ELEMENT_TYPES = new Set([
  'ball', 'fitball', 'vball', 'cone', 'marker', 'flag', 'target', 'coachC', 'pica',
  'pole', 'mannequin', 'minigoal', 'net', 'hurdle', 'ring', 'ladder', 'trampoline',
  'peto', 'chaleco', 'bosu',
]);
/** assetKind válidos del catálogo de PNG. */
const ASSET_KINDS: Set<string> = new Set(TACTIC_ASSETS.map((a) => a.kind as string));

export function isValidMaterialKind(key: string): boolean {
  return MATERIAL_ELEMENT_TYPES.has(key) || ASSET_KINDS.has(key);
}

const MAX_TEXT_LENGTH = 200;
const MAX_DURATION_MIN = 240;

// ---------- utilidades ----------

export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string };

type V = ValidateResult;

const ok: V = { ok: true };
const fail = (error: string): V => ({ ok: false, error });

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Verifica que el objeto NO tenga propiedades fuera del conjunto permitido. */
function noExtra(obj: Record<string, unknown>, allowed: string[], what: string): V {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) return fail(`${what}: propiedad desconocida «${k}»`);
  }
  return ok;
}

function finite(v: unknown, what: string): V {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${what} debe ser un número finito`);
  return ok;
}

function inUnit(v: number, what: string): string | null {
  if (v < 0 || v > 1) return `${what} fuera de rango (0..1), recibido ${v}`;
  return null;
}

function checkPoint(p: unknown, what: string): V {
  if (!isPlainObject(p)) return fail(`${what} debe ser un objeto {x, y}`);
  const e = noExtra(p, ['x', 'y'], what);
  if (!e.ok) return e;
  const fx = finite(p['x'], `${what}.x`);
  if (!fx.ok) return fx;
  const fy = finite(p['y'], `${what}.y`);
  if (!fy.ok) return fy;
  const r = inUnit(p['x'] as number, `${what}.x`) || inUnit(p['y'] as number, `${what}.y`);
  return r ? fail(r) : ok;
}

function checkHex(v: unknown, what: string): V {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return fail(`${what} no es un color hex válido (#rrggbb)`);
  return ok;
}

function checkString(v: unknown, what: string, max: number, allowEmpty = false): V {
  if (typeof v !== 'string') return fail(`${what} debe ser una cadena`);
  if (!allowEmpty && v.trim().length === 0) return fail(`${what} no puede estar vacío`);
  if (v.length > max) return fail(`${what} excede ${max} caracteres`);
  return ok;
}

const DRAFT_ALLOWED = ['schemaVersion', 'title', 'description', 'objective', 'durationMinutes', 'material', 'field', 'orientation', 'playerCount', 'ownColor', 'rivalColor', 'ownFormation', 'rivalFormation', 'players', 'materials', 'shapes', 'texts'];
const PLAYER_ALLOWED = ['id', 'team', 'position', 'number', 'label', 'isGoalkeeper', 'color', 'playerId'];
const MATERIAL_ALLOWED = ['kind', 'position', 'size'];
const SHAPE_ALLOWED = ['kind', 'from', 'to', 'control', 'points', 'fill', 'color'];
const TEXT_ALLOWED = ['position', 'value', 'size'];

export function validateAiDraft(raw: unknown): ValidateResult {
  if (!isPlainObject(raw)) return fail('El borrador no es un objeto');
  const d = raw as Record<string, unknown>;

  if (d['schemaVersion'] !== AI_DRAFT_SCHEMA_VERSION) {
    return fail(`Versión de esquema incompatible: esperada ${AI_DRAFT_SCHEMA_VERSION}, recibida ${String(d['schemaVersion'])}`);
  }
  const extra = noExtra(d, DRAFT_ALLOWED, 'borrador');
  if (!extra.ok) return extra;

  const title = checkString(d['title'], 'title', MAX_TEXT_LENGTH);
  if (!title.ok) return title;

  // description / objective / material: cadenas opcionales (vacías permitidas).
  for (const k of ['description', 'objective', 'material'] as const) {
    if (d[k] !== undefined && typeof d[k] !== 'string') return fail(`${k} debe ser una cadena`);
    if (typeof d[k] === 'string' && (d[k] as string).length > MAX_TEXT_LENGTH) return fail(`${k} excede ${MAX_TEXT_LENGTH} caracteres`);
  }

  if (typeof d['field'] !== 'string' || !AI_FIELD_TYPES.includes(d['field'] as (typeof AI_FIELD_TYPES)[number])) {
    return fail(`Tipo de campo desconocido: ${String(d['field'])}`);
  }
  if (d['orientation'] !== 'horizontal' && d['orientation'] !== 'vertical') {
    return fail(`Orientación desconocida: ${String(d['orientation'])}`);
  }

  // durationMinutes: opcional, número finito, positivo, límite razonable.
  if (d['durationMinutes'] !== undefined) {
    const f = finite(d['durationMinutes'], 'durationMinutes');
    if (!f.ok) return f;
    const n = d['durationMinutes'] as number;
    if (n <= 0) return fail('durationMinutes debe ser > 0');
    if (n > MAX_DURATION_MIN) return fail(`durationMinutes excede ${MAX_DURATION_MIN}`);
  }

  // playerCount: opcional, entero, dentro de límite.
  if (d['playerCount'] !== undefined) {
    const f = finite(d['playerCount'], 'playerCount');
    if (!f.ok) return f;
    const n = d['playerCount'] as number;
    if (!Number.isInteger(n)) return fail('playerCount debe ser un entero');
    if (n < 0 || n > AI_DRAFT_LIMITS.maxPlayers) return fail(`playerCount fuera de límite (0..${AI_DRAFT_LIMITS.maxPlayers})`);
  }

  // Colores opcionales.
  for (const k of ['ownColor', 'rivalColor'] as const) {
    if (d[k] !== undefined) {
      const e = checkHex(d[k], k);
      if (!e.ok) return e;
    }
  }

  // Formaciones: si vienen, deben existir.
  for (const k of ['ownFormation', 'rivalFormation'] as const) {
    if (d[k] !== undefined) {
      if (typeof d[k] !== 'string') return fail(`${k} debe ser una cadena`);
      if (!getFormation(d[k] as string)) return fail(`Formación inexistente: ${String(d[k])}`);
    }
  }

  // Arrays reales.
  const players = d['players'];
  const materials = d['materials'];
  const shapes = d['shapes'];
  const texts = d['texts'];
  if (players !== undefined && !Array.isArray(players)) return fail('players debe ser un array');
  if (materials !== undefined && !Array.isArray(materials)) return fail('materials debe ser un array');
  if (shapes !== undefined && !Array.isArray(shapes)) return fail('shapes debe ser un array');
  if (texts !== undefined && !Array.isArray(texts)) return fail('texts debe ser un array');

  const pArr = (players ?? []) as unknown[];
  const mArr = (materials ?? []) as unknown[];
  const sArr = (shapes ?? []) as unknown[];
  const tArr = (texts ?? []) as unknown[];

  if (pArr.length > AI_DRAFT_LIMITS.maxPlayers) return fail(`Demasiados jugadores (${pArr.length} > ${AI_DRAFT_LIMITS.maxPlayers})`);
  if (mArr.length > AI_DRAFT_LIMITS.maxMaterials) return fail(`Demasiados materiales (${mArr.length} > ${AI_DRAFT_LIMITS.maxMaterials})`);
  if (sArr.length > AI_DRAFT_LIMITS.maxShapes) return fail(`Demasiadas formas (${sArr.length} > ${AI_DRAFT_LIMITS.maxShapes})`);
  if (tArr.length > AI_DRAFT_LIMITS.maxTexts) return fail(`Demasiados textos (${tArr.length} > ${AI_DRAFT_LIMITS.maxTexts})`);

  // Jugadores.
  const seenPlayerIds = new Set<string>();
  const seenRealPlayers = new Set<string>();
  for (let i = 0; i < pArr.length; i++) {
    const p = pArr[i] as unknown;
    if (!isPlainObject(p)) return fail(`players[${i}] debe ser un objeto`);
    const e = noExtra(p, PLAYER_ALLOWED, `players[${i}]`);
    if (!e.ok) return e;
    const team = p['team'];
    if (team !== 'own' && team !== 'rival') return fail(`players[${i}].team debe ser 'own' o 'rival'`);
    const cp = checkPoint(p['position'], `players[${i}].position`);
    if (!cp.ok) return cp;
    if (typeof p['id'] !== 'string' || !(p['id'] as string)) return fail(`players[${i}].id es obligatorio`);
    if (seenPlayerIds.has(p['id'] as string)) return fail(`Id de jugador duplicado: ${p['id']}`);
    seenPlayerIds.add(p['id'] as string);
    if (p['playerId'] !== undefined) {
      if (typeof p['playerId'] !== 'string') return fail(`players[${i}].playerId debe ser una cadena`);
      if (seenRealPlayers.has(p['playerId'] as string)) return fail(`Jugador de plantilla duplicado: ${p['playerId']} (una sola instancia)`);
      seenRealPlayers.add(p['playerId'] as string);
    }
    if (p['label'] !== undefined) {
      const ls = checkString(p['label'], `players[${i}].label`, 40, true);
      if (!ls.ok) return ls;
    }
    if (p['number'] !== undefined) {
      const fn = finite(p['number'], `players[${i}].number`);
      if (!fn.ok) return fn;
      const n = p['number'] as number;
      if (!Number.isInteger(n) || n < 0 || n > 99) return fail(`players[${i}].number debe ser un entero 0..99`);
    }
    if (p['isGoalkeeper'] !== undefined && typeof p['isGoalkeeper'] !== 'boolean') return fail(`players[${i}].isGoalkeeper debe ser booleano`);
    if (p['color'] !== undefined) {
      const hc = checkHex(p['color'], `players[${i}].color`);
      if (!hc.ok) return hc;
    }
  }

  // Materiales.
  for (let i = 0; i < mArr.length; i++) {
    const m = mArr[i] as unknown;
    if (!isPlainObject(m)) return fail(`materials[${i}] debe ser un objeto`);
    const e = noExtra(m, MATERIAL_ALLOWED, `materials[${i}]`);
    if (!e.ok) return e;
    if (typeof m['kind'] !== 'string' || !isValidMaterialKind(m['kind'])) {
      return fail(`Material inexistente: ${String(m['kind'])}`);
    }
    const cp = checkPoint(m['position'], `materials[${i}].position`);
    if (!cp.ok) return cp;
    if (m['size'] !== undefined) {
      const fs = finite(m['size'], `materials[${i}].size`);
      if (!fs.ok) return fs;
      if ((m['size'] as number) <= 0) return fail(`materials[${i}].size debe ser > 0`);
    }
  }

  // Formas.
  for (let i = 0; i < sArr.length; i++) {
    const s = sArr[i] as unknown;
    if (!isPlainObject(s)) return fail(`shapes[${i}] debe ser un objeto`);
    const e = noExtra(s, SHAPE_ALLOWED, `shapes[${i}]`);
    if (!e.ok) return e;
    if (typeof s['kind'] !== 'string' || !AI_SHAPE_KINDS.includes(s['kind'] as (typeof AI_SHAPE_KINDS)[number])) {
      return fail(`Tipo de forma desconocido: ${String(s['kind'])}`);
    }
    const cf = checkPoint(s['from'], `shapes[${i}].from`);
    if (!cf.ok) return cf;
    const ct = checkPoint(s['to'], `shapes[${i}].to`);
    if (!ct.ok) return ct;
    const kind = s['kind'] as string;
    if (s['control'] !== undefined) {
      const cc = checkPoint(s['control'], `shapes[${i}].control`);
      if (!cc.ok) return cc;
    }
    if (s['points'] !== undefined) {
      if (kind !== 'freehand') return fail(`shapes[${i}].points solo está permitido para mano alzada (freehand)`);
      if (!Array.isArray(s['points']) || (s['points'] as unknown[]).length < 2) return fail(`shapes[${i}].points necesita >= 2 puntos`);
      if ((s['points'] as unknown[]).length > AI_DRAFT_LIMITS.maxPointsPerFreehand) return fail(`shapes[${i}].points excede el límite`);
      for (let j = 0; j < (s['points'] as unknown[]).length; j++) {
        const pp = checkPoint((s['points'] as unknown[])[j], `shapes[${i}].points[${j}]`);
        if (!pp.ok) return pp;
      }
    }
    if (s['fill'] !== undefined && typeof s['fill'] !== 'boolean') return fail(`shapes[${i}].fill debe ser booleano`);
    if (s['color'] !== undefined) {
      const hc = checkHex(s['color'], `shapes[${i}].color`);
      if (!hc.ok) return hc;
    }
    // Formas degeneradas (ancho o largo cero) no tienen sentido salvo puntos.
    if (kind === 'rect' || kind === 'ellipse') {
      const w = Math.abs((s['to'] as { x: number }).x - (s['from'] as { x: number }).x);
      const h = Math.abs((s['to'] as { y: number }).y - (s['from'] as { y: number }).y);
      if (w < 0.004 || h < 0.004) return fail(`shapes[${i}]: la figura no puede tener ancho o largo cero`);
    }
  }

  // Textos.
  for (let i = 0; i < tArr.length; i++) {
    const t = tArr[i] as unknown;
    if (!isPlainObject(t)) return fail(`texts[${i}] debe ser un objeto`);
    const e = noExtra(t, TEXT_ALLOWED, `texts[${i}]`);
    if (!e.ok) return e;
    const cp = checkPoint(t['position'], `textos[${i}].position`);
    if (!cp.ok) return cp;
    const vs = checkString(t['value'], `textos[${i}].value`, MAX_TEXT_LENGTH);
    if (!vs.ok) return vs;
    if (t['size'] !== undefined) {
      const fs = finite(t['size'], `textos[${i}].size`);
      if (!fs.ok) return fs;
      if ((t['size'] as number) <= 0) return fail(`textos[${i}].size debe ser > 0`);
    }
  }

  return { ok: true };
}

// Re-exporta los tipos de material válidos como ayuda para las herramientas.
export const AI_MATERIAL_KINDS = [...MATERIAL_ELEMENT_TYPES, ...ASSET_KINDS];

// =============================================================
// JSON Schema equivalente (additionalProperties=false). Útil para exigir una
// respuesta JSON ajustada a esquema con la Responses API (Structured Output).
// =============================================================
const pointSchema = {
  type: 'object',
  properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } },
  required: ['x', 'y'],
  additionalProperties: false,
} as const;

export const AI_DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    schemaVersion: { const: AI_DRAFT_SCHEMA_VERSION },
    title: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
    description: { type: 'string', maxLength: MAX_TEXT_LENGTH },
    objective: { type: 'string', maxLength: MAX_TEXT_LENGTH },
    durationMinutes: { type: 'number', minimum: 1, maximum: MAX_DURATION_MIN },
    material: { type: 'string', maxLength: MAX_TEXT_LENGTH },
    field: { enum: [...AI_FIELD_TYPES] },
    orientation: { enum: ['horizontal', 'vertical'] },
    playerCount: { type: 'integer', minimum: 0, maximum: AI_DRAFT_LIMITS.maxPlayers },
    ownColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    rivalColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    ownFormation: { type: 'string' },
    rivalFormation: { type: 'string' },
    players: {
      type: 'array',
      maxItems: AI_DRAFT_LIMITS.maxPlayers,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          team: { enum: ['own', 'rival'] },
          position: pointSchema,
          number: { type: 'integer', minimum: 0, maximum: 99 },
          label: { type: 'string', maxLength: 40 },
          isGoalkeeper: { type: 'boolean' },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          playerId: { type: 'string' },
        },
        required: ['id', 'team', 'position'],
        additionalProperties: false,
      },
    },
    materials: {
      type: 'array',
      maxItems: AI_DRAFT_LIMITS.maxMaterials,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          position: pointSchema,
          size: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['kind', 'position'],
        additionalProperties: false,
      },
    },
    shapes: {
      type: 'array',
      maxItems: AI_DRAFT_LIMITS.maxShapes,
      items: {
        type: 'object',
        properties: {
          kind: { enum: [...AI_SHAPE_KINDS] },
          from: pointSchema,
          to: pointSchema,
          control: pointSchema,
          points: { type: 'array', minItems: 2, maxItems: AI_DRAFT_LIMITS.maxPointsPerFreehand, items: pointSchema },
          fill: { type: 'boolean' },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        },
        required: ['kind', 'from', 'to'],
        additionalProperties: false,
      },
    },
    texts: {
      type: 'array',
      maxItems: AI_DRAFT_LIMITS.maxTexts,
      items: {
        type: 'object',
        properties: {
          position: pointSchema,
          value: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
          size: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['position', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['schemaVersion', 'title', 'field', 'orientation'],
  additionalProperties: false,
} as const;
