import { CanvasDocument, CanvasFrame, CanvasElement, ElementType, FieldType, ELEMENT_TYPES } from './models';
import { TACTIC_ASSETS, MATERIAL_SIZE_RATIO } from './tactic-assets';

const VALID_KINDS = new Set<string>(TACTIC_ASSETS.map((a) => a.kind));

let idCounter = 0;
function genId(): string {
  idCounter += 1;
  return `el-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

// Fuente única de tipos admitidos (ELEMENT_TYPES en models) para no divergir.
const VALID_TYPES: ReadonlySet<string> = ELEMENT_TYPES;

/**
 * Versión actual del esquema de la pizarra. Fase 4: subió a 4 para que la
 * migración de tamaños (escalar objetos puntuales/material/texto a ~75 %)
 * se ejecute UNA sola vez y nunca se re-encoge el mismo ejercicio al reabrir.
 */
export const CANVAS_SCHEMA_VERSION = 5;
/** Los documentos con `schemaVersion < SIZE_MIGRATION_VERSION` se migran. */
const SIZE_MIGRATION_VERSION = 5;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function clampSize(v: number): number {
  return Math.max(0.2, Math.min(6, v));
}

function ensureId(el: CanvasElement): CanvasElement {
  return el.id ? el : { ...el, id: genId() };
}

/** Valida un elemento: tipo conocido y coordenadas acotadas; descarta inválidos. */
function normalizeElement(raw: unknown): CanvasElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const el = raw as CanvasElement;
  if (!VALID_TYPES.has(el.t as string)) return null;
  const out: CanvasElement = { ...ensureId(el) };
  const x = num(out.x);
  const y = num(out.y);
  if (x !== undefined) out.x = clamp01(x);
  if (y !== undefined) out.y = clamp01(y);
  const w = num(out.w);
  const h = num(out.h);
  if (w !== undefined) out.w = Math.max(0, clamp01(w));
  if (h !== undefined) out.h = Math.max(0, clamp01(h));
  const size = num(out.size);
  if (size !== undefined) out.size = clampSize(size);
  if (typeof out.fillOpacity === 'number') {
    out.fillOpacity = Math.max(0, Math.min(1, out.fillOpacity));
  }
  if (out.fillColor && typeof out.fillColor === 'string' && !/^#?[0-9a-fA-F]{3,8}$/.test(out.fillColor)) {
    delete out.fillColor; // relleno con color inválido: se deriva del perímetro
  }
  if (el.t === 'freehand') {
    out.points = Array.isArray(out.points)
      ? (out.points as unknown[])
          .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length === 2 && num(pt[0]) !== undefined && num(pt[1]) !== undefined)
          .map((pt) => [clamp01(num(pt[0]) as number), clamp01(num(pt[1]) as number)] as [number, number])
      : [];
  }
  if (el.t === 'curve') {
    if (num(out.c1x) !== undefined) out.c1x = clamp01(num(out.c1x) as number);
    if (num(out.c1y) !== undefined) out.c1y = clamp01(num(out.c1y) as number);
  }
  // Material: si el identificador es desconocido, cae al fallback vectorial (no romper la actividad).
  if (out.assetKind && !VALID_KINDS.has(out.assetKind)) {
    delete (out as { asset?: string }).asset;
  }
  return out;
}

/** Tipos "puntuales"/materiales cuyo `size` controla el tamaño visual. */
const POINT_LIKE: ReadonlySet<string> = new Set([
  'player', 'ball', 'cone', 'mannequin', 'minigoal', 'pole', 'marker', 'hurdle', 'ring', 'ladder',
  'flag', 'trampoline', 'target', 'net', 'vball', 'coachC', 'peto', 'chaleco', 'bosu', 'fitball', 'pica',
]);

/** La base por defecto de los objetos puntuales/materiales/texto (Fase 3: el dueño
 *  pide que aparezcan un 20 % más pequeños que el estado anterior, 0.75 → 0.60). */
const PREVIOUS_RATIO = 0.75; // ratio usado en Fase 4 (ya aplicado a documentos v4).
// Nuevo ratio base (Fase 3): 0.75 × 0.80 = 0.60 respecto al tamaño histórico original.

/** Factor de migración de tamaño según la versión entrante (idempotente por versión). */
function sizeFactorForVersion(v: number): number {
  if (v >= SIZE_MIGRATION_VERSION) return 1; // ya migrado: no volver a tocar
  if (v === 4) return MATERIAL_SIZE_RATIO / PREVIOUS_RATIO; // v4 (ya a 0.75) → ×0.80 → 0.60
  return MATERIAL_SIZE_RATIO; // < 4: nunca migrado → 0.60 (una vez respecto al original)
}

/** Escala el tamaño de un objeto puntual/material/texto por `factor` (si tiene `size`). */
function scaleElementSize(el: CanvasElement, factor: number): CanvasElement {
  if (el.size === undefined) return el;
  if (el.t === 'text' || POINT_LIKE.has(el.t)) {
    return { ...el, size: clampSize(el.size * factor) };
  }
  return el;
}

/** Aplica la migración de tamaños a todos los elementos de todos los frames. */
function migrateSizes(frames: CanvasFrame[], factor: number): CanvasFrame[] {
  return frames.map((f) => ({ ...f, elements: f.elements.map((el) => scaleElementSize(el, factor)) }));
}

function normalizeFrame(frame: Partial<CanvasFrame>): CanvasFrame {
  const rawEls = Array.isArray(frame.elements) ? frame.elements : [];
  return {
    duration: typeof frame.duration === 'number' && frame.duration > 0 ? Math.round(frame.duration) : 1000,
    elements: rawEls.map(normalizeElement).filter((e): e is CanvasElement => e !== null),
  };
}

function emptyDoc(): CanvasDocument {
  return {
    version: 2,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    field: 'full',
    frames: [{ duration: 1000, elements: [] }],
  };
}

/**
 * Normaliza / migra un `canvas_data` a un CanvasDocument v4 estable.
 * Retrocompatible:
 *  - v1 (array plano) → un único frame (y migración de tamaños, al ser legacy).
 *  - v2 (objeto con frames) → se asegura `schemaVersion`, ids y duraciones.
 *  - Fase 4: si el documento viene con `schemaVersion < 4`, se escala UNA sola vez
 *    el `size` de los objetos puntuales/materiales/texto a ~75 % y se sella la
 *    versión. Idempotente: al reabrir (ya con version 4) no se vuelve a encoger.
 * Si el documento es inválido, devuelve un lienzo nuevo vacío (no rompe la carga).
 */
export function normalizeCanvas(raw: unknown): CanvasDocument {
  if (Array.isArray(raw)) {
    // v1: lista de elementos (legacy, nunca migrado → factor MATERIAL_SIZE_RATIO).
    const frames = [{ duration: 1000, elements: (raw as CanvasElement[]).map(ensureId) }];
    return {
      version: 2,
      schemaVersion: CANVAS_SCHEMA_VERSION,
      field: 'full',
      frames: migrateSizes(frames, MATERIAL_SIZE_RATIO),
    };
  }

  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const field = (r['field'] as FieldType) || 'full';
    const framesRaw = r['frames'];
    let frames: CanvasFrame[] = [];
    if (Array.isArray(framesRaw) && framesRaw.length > 0) {
      frames = (framesRaw as Partial<CanvasFrame>[]).map(normalizeFrame);
    } else {
      frames = [{ duration: 1000, elements: [] }];
    }
    const incomingVersion = typeof r['schemaVersion'] === 'number' ? (r['schemaVersion'] as number) : 3;
    const factor = sizeFactorForVersion(incomingVersion);
    if (factor !== 1) {
      frames = migrateSizes(frames, factor);
    }
    return {
      version: 2,
      schemaVersion: CANVAS_SCHEMA_VERSION,
      field,
      frames,
      orientation: (r['orientation'] as CanvasDocument['orientation']) ?? 'horizontal',
      backgroundColor: (r['backgroundColor'] as string) ?? undefined,
      lineColor: (r['lineColor'] as string) ?? undefined,
      grass: (r['grass'] as CanvasDocument['grass']) ?? 'stripes',
      grid: Boolean(r['grid']),
      guide: (r['guide'] as CanvasDocument['guide']) ?? 'none',
      f7: (r['f7'] as CanvasDocument['f7']) ?? null,
    };
  }

  return emptyDoc();
}
