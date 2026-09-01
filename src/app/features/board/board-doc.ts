import { CanvasElement, CanvasFrame } from '../../core/models';
import { elementCenter } from '../../core/render';

/** Reexporta el centro geométrico compartido (render + transformaciones). */
export { elementCenter };

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
  const tr = (v?: number, dv = 0) => (v === undefined ? v : Math.max(0, Math.min(1, v + dv)));
  if (t === 'player' || t === 'ball' || t === 'cone' || t === 'mannequin' || t === 'minigoal' || t === 'pole' || t === 'marker' || t === 'hurdle' || t === 'ring' || t === 'ladder' || t === 'flag' || t === 'trampoline' || t === 'target' || t === 'net' || t === 'vball' || t === 'coachC' || t === 'peto' || t === 'chaleco' || t === 'bosu' || t === 'fitball' || t === 'pica') {
    out.x = tr(out.x, dx);
    out.y = tr(out.y, dy);
  } else if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
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
    out.points = (el.points ?? []).map(([px, py]) => [Math.max(0, Math.min(1, px + dx)), Math.max(0, Math.min(1, py + dy))] as [number, number]);
  } else if (t === 'rect' || t === 'ellipse' || t === 'zone' || t === 'text') {
    out.x = tr(out.x, dx);
    out.y = tr(out.y, dy);
  }
  return out;
}

/** Traslada un elemento del frame indicado por un delta (dx, dy). */
export function moveElementInFrame(frames: CanvasFrame[], frameIndex: number, id: string, dx: number, dy: number): CanvasFrame[] {
  return frames.map((f, i) =>
    i !== frameIndex
      ? f
      : { ...f, elements: f.elements.map((e) => (e.id === id ? translateElement(e, dx, dy) : e)) }
  );
}

/** Traslada VARIOS elementos (selección múltiple) del frame indicado por un mismo delta. */
export function moveElementsInFrame(frames: CanvasFrame[], frameIndex: number, ids: string[], dx: number, dy: number): CanvasFrame[] {
  const set = new Set(ids);
  return frames.map((f, i) =>
    i !== frameIndex
      ? f
      : { ...f, elements: f.elements.map((e) => (set.has(e.id) ? translateElement(e, dx, dy) : e)) }
  );
}

/** Actualiza un elemento en TODOS los frames (propiedades, no posición). */
export function updateElementInFrames(frames: CanvasFrame[], id: string, patch: Partial<CanvasElement>): CanvasFrame[] {
  return frames.map((f) => ({ ...f, elements: f.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
}

/** Cambia la capa (orden) de un elemento dentro de todos los frames. */
export function layerShiftFrames(frames: CanvasFrame[], id: string, dir: -1 | 1): CanvasFrame[] {
  return frames.map((f) => {
    const els = [...f.elements];
    const idx = els.findIndex((e) => e.id === id);
    if (idx === -1) return f;
    const to = Math.max(0, Math.min(els.length - 1, idx + dir));
    if (to === idx) return f;
    const [el] = els.splice(idx, 1);
    els.splice(to, 0, el);
    return { ...f, elements: els };
  });
}

export function addFrame(frames: CanvasFrame[], afterIndex: number, duration: number): CanvasFrame[] {
  const base = frames[afterIndex];
  const copy: CanvasFrame = { duration: base?.duration ?? duration, elements: base?.elements.map((e) => ({ ...e })) ?? [] };
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
  return frames.map((f, i) => (i === index ? { ...f, duration: Math.max(200, Math.min(5000, ms)) } : f));
}
