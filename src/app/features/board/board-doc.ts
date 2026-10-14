import { CanvasElement, CanvasFrame } from '../../core/models';
import { materialBaseSize } from '../../core/tactic-assets';
import {
  elementCenter,
  MARGIN_STRIP,
  FIXED_UPRIGHT_TYPES,
  DEFAULT_TEXT_SIZE,
} from '../../core/render';

/** Reexporta el centro geométrico compartido (render + transformaciones). */
export { elementCenter };

/** Transforma una selección alrededor de su centro, en unidades físicas del campo.
 * Las coordenadas de líneas/curvas se transforman directamente; las cajas conservan
 * sus dimensiones y usan rot. No muta objetos bloqueados ni referencias de otros frames. */
export function transformSelectionFrames(
  frames: CanvasFrame[],
  ids: readonly string[],
  rect: { w: number; h: number },
  factor = 1,
  degrees = 0,
  origin?: { x: number; y: number },
): CanvasFrame[] {
  const selected = new Set(ids);
  const angle = (degrees * Math.PI) / 180;
  return frames.map((frame) => {
    const elements = frame.elements.filter((el) => selected.has(el.id) && !el.locked);
    if (!elements.length) return frame;
    const centers = elements.map(elementCenter);
    const cx =
      origin?.x ??
      (Math.min(...centers.map((p) => p.x)) + Math.max(...centers.map((p) => p.x))) / 2;
    const cy =
      origin?.y ??
      (Math.min(...centers.map((p) => p.y)) + Math.max(...centers.map((p) => p.y))) / 2;
    const point = (x: number, y: number): [number, number] => {
      const dx = (x - cx) * rect.w * factor,
        dy = (y - cy) * rect.h * factor;
      return [
        cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) / rect.w,
        cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) / rect.h,
      ];
    };
    return {
      ...frame,
      elements: frame.elements.map((el) => {
        if (!selected.has(el.id) || el.locked) return el;
        const out = { ...el };
        if (el.x1 != null && el.y1 != null && el.x2 != null && el.y2 != null) {
          [out.x1, out.y1] = point(el.x1, el.y1);
          [out.x2, out.y2] = point(el.x2, el.y2);
          if (el.c1x != null && el.c1y != null) [out.c1x, out.c1y] = point(el.c1x, el.c1y);
        } else if (el.t === 'freehand') {
          out.points = (el.points ?? []).map(([x, y]) => point(x, y));
        } else {
          const center = elementCenter(el);
          const [x, y] = point(center.x, center.y);
          const box = el.w != null && el.h != null;
          out.x = x - (box ? (el.w! * factor) / 2 : 0);
          out.y = y - (box ? (el.h! * factor) / 2 : 0);
          if (box) {
            out.w = el.w! * factor;
            out.h = el.h! * factor;
          }
          if (!FIXED_UPRIGHT_TYPES.has(el.t)) out.rot = ((el.rot ?? 0) + degrees + 360) % 360;
        }
        if (factor !== 1) {
          if (el.t === 'text' || (el.x1 == null && el.t !== 'freehand' && el.w == null))
            out.size =
              (el.size ??
                (el.t === 'text' ? DEFAULT_TEXT_SIZE : materialBaseSize(el.assetKind ?? el.t))) *
              factor;
          if (el.strokeWidth != null) out.strokeWidth = el.strokeWidth * factor;
        }
        return out;
      }),
    };
  });
}

// =============================================================
// EntrenoLab — Operaciones PURAS del documento de pizarra.
// Cada función recibe los frames y devuelve unos nuevos (inmutables).
// Responsabilidad: mutaciones del documento. Sin estado, sin UI.
// =============================================================

export function addElementToFrames(frames: CanvasFrame[], el: CanvasElement): CanvasFrame[] {
  return frames.map((f) => ({ ...f, elements: [...f.elements, { ...el }] }));
}

export function removeElementFromFrames(frames: CanvasFrame[], id: string): CanvasFrame[] {
  return frames.map((f) => ({ ...f, elements: f.elements.filter((e) => e.id !== id) }));
}

/** Mueve un elemento en el frame indicado. */
/** Traslada un elemento según su geometría (puntual, línea, curva, mano alzada o caja). */
export function translateElement(el: CanvasElement, dx: number, dy: number): CanvasElement {
  const t = el.t;
  const out: CanvasElement = { ...el };
  const tr = (v?: number, dv = 0) =>
    v === undefined ? v : Math.max(-MARGIN_STRIP, Math.min(1 + MARGIN_STRIP, v + dv));
  if (
    t === 'player' ||
    t === 'ball' ||
    t === 'cone' ||
    t === 'mannequin' ||
    t === 'mannequin_row' ||
    t === 'minigoal' ||
    t === 'goal' ||
    t === 'pole' ||
    t === 'marker' ||
    t === 'hurdle' ||
    t === 'ring' ||
    t === 'ladder' ||
    t === 'flag' ||
    t === 'trampoline' ||
    t === 'target' ||
    t === 'net' ||
    t === 'vball' ||
    t === 'coachC' ||
    t === 'peto' ||
    t === 'chaleco' ||
    t === 'bosu' ||
    t === 'fitball' ||
    t === 'pica' ||
    t === 'dumbbell' ||
    t === 'resistance_band' ||
    t === 'medicine_ball'
  ) {
    out.x = tr(out.x, dx);
    out.y = tr(out.y, dy);
  } else if (
    t === 'arrow' ||
    t === 'line' ||
    t === 'dribble' ||
    t === 'doubleArrow' ||
    t === 'measure'
  ) {
    out.x1 = tr(out.x1, dx);
    out.y1 = tr(out.y1, dy);
    out.x2 = tr(out.x2, dx);
    out.y2 = tr(out.y2, dy);
  } else if (t === 'curve') {
    out.x1 = tr(out.x1, dx);
    out.y1 = tr(out.y1, dy);
    out.x2 = tr(out.x2, dx);
    out.y2 = tr(out.y2, dy);
    out.c1x = tr(out.c1x, dx);
    out.c1y = tr(out.c1y, dy);
  } else if (t === 'freehand') {
    out.points = (el.points ?? []).map(
      ([px, py]) =>
        [
          Math.max(-MARGIN_STRIP, Math.min(1 + MARGIN_STRIP, px + dx)),
          Math.max(-MARGIN_STRIP, Math.min(1 + MARGIN_STRIP, py + dy)),
        ] as [number, number],
    );
  } else if (t === 'rect' || t === 'ellipse' || t === 'zone' || t === 'text') {
    out.x = tr(out.x, dx);
    out.y = tr(out.y, dy);
  }
  return out;
}

/** Traslada un elemento del frame indicado por un delta (dx, dy). */
export function moveElementInFrame(
  frames: CanvasFrame[],
  frameIndex: number,
  id: string,
  dx: number,
  dy: number,
): CanvasFrame[] {
  return frames.map((f, i) =>
    i !== frameIndex
      ? f
      : { ...f, elements: f.elements.map((e) => (e.id === id ? translateElement(e, dx, dy) : e)) },
  );
}

/** Traslada VARIOS elementos (selección múltiple) del frame indicado por un mismo delta. */
export function moveElementsInFrame(
  frames: CanvasFrame[],
  frameIndex: number,
  ids: string[],
  dx: number,
  dy: number,
): CanvasFrame[] {
  const set = new Set(ids);
  return frames.map((f, i) =>
    i !== frameIndex
      ? f
      : {
          ...f,
          elements: f.elements.map((e) => (set.has(e.id) ? translateElement(e, dx, dy) : e)),
        },
  );
}

/** Actualiza un elemento en TODOS los frames (propiedades, no posición). */
export function updateElementInFrames(
  frames: CanvasFrame[],
  id: string,
  patch: Partial<CanvasElement>,
): CanvasFrame[] {
  return frames.map((f) => ({
    ...f,
    elements: f.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }));
}

/** Lleva el elemento al fondo (-1) o al frente (1), en todos los frames.
 * Conserva el orden relativo del resto; con step=true desplaza solo una capa. */
export function layerShiftFrames(
  frames: CanvasFrame[],
  id: string | readonly string[],
  dir: -1 | 1,
  step = false,
): CanvasFrame[] {
  let changed = false;
  const ids = new Set(typeof id === 'string' ? [id] : id);
  const next = frames.map((f) => {
    const els = [...f.elements];
    if (Array.isArray(id)) {
      if (step) {
        const indices = dir === 1 ? [...els.keys()].reverse() : [...els.keys()];
        for (const i of indices) {
          const j = i + dir;
          if (ids.has(els[i].id) && j >= 0 && j < els.length && !ids.has(els[j].id)) {
            [els[i], els[j]] = [els[j], els[i]];
          }
        }
      } else {
        const selected = els.filter((e) => ids.has(e.id));
        const rest = els.filter((e) => !ids.has(e.id));
        els.splice(0, els.length, ...(dir === 1 ? [...rest, ...selected] : [...selected, ...rest]));
      }
      if (els.every((e, i) => e === f.elements[i])) return f;
      changed = true;
      return { ...f, elements: els };
    }
    const idx = els.findIndex((e) => e.id === id);
    if (idx === -1) return f;
    const to = step
      ? Math.max(0, Math.min(els.length - 1, idx + dir))
      : dir === -1
        ? 0
        : els.length - 1;
    if (to === idx) return f;
    const [el] = els.splice(idx, 1);
    els.splice(to, 0, el);
    changed = true;
    return { ...f, elements: els };
  });
  return changed ? next : frames;
}

export function addFrame(
  frames: CanvasFrame[],
  afterIndex: number,
  duration: number,
): CanvasFrame[] {
  const base = frames[afterIndex];
  const copy: CanvasFrame = {
    duration: base?.duration ?? duration,
    elements: base?.elements.map((e) => ({ ...e })) ?? [],
  };
  const next = [...frames];
  next.splice(afterIndex + 1, 0, copy);
  return next;
}

export function removeFrame(frames: CanvasFrame[], index: number): CanvasFrame[] {
  if (frames.length <= 1) return frames;
  return frames.filter((_, idx) => idx !== index);
}

export function moveFrame(frames: CanvasFrame[], index: number, dir: -1 | 1): CanvasFrame[] {
  const to = index + dir;
  if (to < 0 || to >= frames.length) return frames;
  const next = [...frames];
  const [t] = next.splice(index, 1);
  next.splice(to, 0, t);
  return next;
}

export function setFrameDuration(frames: CanvasFrame[], index: number, ms: number): CanvasFrame[] {
  return frames.map((f, i) =>
    i === index ? { ...f, duration: Math.max(200, Math.min(5000, ms)) } : f,
  );
}
