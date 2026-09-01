import { describe, expect, it } from 'vitest';
import { isPointLike, isMaterial, selCenter, elementOutline, resizeHandles, normalizeRotation, pointLikeResizeHalf, MIN_RESIZE_HALF } from './board-selection';
import { CanvasElement } from '../../core/models';

/** Instancia un elemento dado `t` con las coords indicadas. */
function el(t: CanvasElement['t'], extra: Partial<CanvasElement> = {}): CanvasElement {
  return { id: 'x', t, ...extra } as CanvasElement;
}

describe('board-selection (geometría/selección pura)', () => {
  it('reconoce elementos "puntuales" movibles', () => {
    expect(isPointLike('player')).toBe(true);
    expect(isPointLike('cone')).toBe(true);
    expect(isPointLike('rect')).toBe(false);
    expect(isPointLike('arrow')).toBe(false);
    expect(isPointLike('text')).toBe(true);
  });

  it('calcula el centro de una zona/rectángulo', () => {
    const r = el('rect', { x: 0.2, y: 0.2, w: 0.4, h: 0.2 });
    const c = selCenter(r);
    expect(c.x).toBeCloseTo(0.4);
    expect(c.y).toBeCloseTo(0.3);
  });

  it('calcula el centro de una flecha', () => {
    const a: CanvasElement = { id: 'a', t: 'arrow', x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.4 };
    const c = selCenter(a);
    expect(c.x).toBeCloseTo(0.4);
    expect(c.y).toBeCloseTo(0.3);
  });

  it('genera el contorno (SVG) de un rectángulo con la geometría activa', () => {
    const r: CanvasElement = { id: 'r', t: 'rect', x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    const rect = { x: 4, y: 10, w: 92, h: 70 };
    const svg = elementOutline(r, rect);
    expect(svg).toContain('stroke="#2563eb"');
    expect(svg).toContain('width="46"');
  });

  it('texto: el contorno de selección NO pinta nada sobre el origen (cadena vacía)', () => {
    const t = el('text', { x: 0.4, y: 0.5, w: 0.3, h: 0.14 });
    const rect = { x: 4, y: 10, w: 92, h: 70 };
    expect(elementOutline(t, rect)).toBe('');
  });

  it('mantiene el contorno de selección (círculo) para los elementos puntuales', () => {
    const p: CanvasElement = { id: 'p', t: 'player', x: 0.4, y: 0.5 };
    const rect = { x: 4, y: 10, w: 92, h: 70 };
    const svg = elementOutline(p, rect);
    expect(svg).toContain('<circle');
    expect(svg).toContain('stroke="#2563eb"');
  });

  it('mantiene el contorno de selección (línea) para flechas/líneas', () => {
    const a: CanvasElement = { id: 'a', t: 'arrow', x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.4 };
    const rect = { x: 4, y: 10, w: 92, h: 70 };
    const svg = elementOutline(a, rect);
    expect(svg).toContain('<line');
    expect(svg).toContain('stroke="#2563eb"');
  });

  // =============================================================
  // FASE 6 — manijas de redimensionado POR FAMILIA (la manija de
  // rotación continua se retira; la rotación pasa a ±90° en la barra
  // de contexto).
  // =============================================================

  it('rect/zone/ellipse/texto: 4 asas de esquina del cuadro (tl/tr/bl/br)', () => {
    for (const t of ['rect', 'zone', 'ellipse', 'text'] as const) {
      const e = el(t, { x: 0.2, y: 0.3, w: 0.4, h: 0.2 });
      const hs = resizeHandles(e);
      expect(hs).toHaveLength(4);
      const keys = hs.map((h) => h.key).sort();
      expect(keys).toEqual(['bl', 'br', 'tl', 'tr']);
      // esquinas del cuadro [0.2..0.6]×[0.3..0.5]
      expect(hs.find((h) => h.key === 'tl')!.x).toBeCloseTo(0.2, 10);
      expect(hs.find((h) => h.key === 'tl')!.y).toBeCloseTo(0.3, 10);
      expect(hs.find((h) => h.key === 'tr')!.x).toBeCloseTo(0.6, 10);
      expect(hs.find((h) => h.key === 'tr')!.y).toBeCloseTo(0.3, 10);
      expect(hs.find((h) => h.key === 'bl')!.x).toBeCloseTo(0.2, 10);
      expect(hs.find((h) => h.key === 'bl')!.y).toBeCloseTo(0.5, 10);
      expect(hs.find((h) => h.key === 'br')!.x).toBeCloseTo(0.6, 10);
      expect(hs.find((h) => h.key === 'br')!.y).toBeCloseTo(0.5, 10);
    }
  });

  it('línea/flecha/medición/zigzag/doble sentido: asas en AMBOS extremos', () => {
    for (const t of ['line', 'arrow', 'measure', 'dribble', 'doubleArrow'] as const) {
      const e = el(t, { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.5 });
      const hs = resizeHandles(e);
      expect(hs, `asas de ${t}`).toHaveLength(2);
      expect(hs.find((h) => h.key === 'x1')).toMatchObject({ x: 0.2, y: 0.2 });
      expect(hs.find((h) => h.key === 'x2')).toMatchObject({ x: 0.6, y: 0.5 });
    }
  });

  it('curva: asas en extremos + punto de control (C1)', () => {
    const c = el('curve', { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.5, c1x: 0.4, c1y: 0.1 });
    const hs = resizeHandles(c);
    expect(hs).toHaveLength(3);
    expect(hs.find((h) => h.key === 'c1')).toMatchObject({ x: 0.4, y: 0.1 });
  });

  it('mano alzada: caja envolvente con 4 asas de esquina', () => {
    const f = el('freehand', { points: [[0.2, 0.2], [0.5, 0.4], [0.4, 0.7]] });
    const hs = resizeHandles(f);
    expect(hs).toHaveLength(4);
    const xs = hs.map((h) => h.x);
    const ys = hs.map((h) => h.y);
    expect(Math.min(...xs)).toBeCloseTo(0.2);
    expect(Math.max(...xs)).toBeCloseTo(0.5);
    expect(Math.min(...ys)).toBeCloseTo(0.2);
    expect(Math.max(...ys)).toBeCloseTo(0.7);
  });

  it('FASE 1: un MATERIAL no tiene asas de redimensionado (solo se mueve/rota/duplica)', () => {
    for (const t of ['cone', 'ball', 'mannequin', 'minigoal', 'pole', 'marker', 'hurdle', 'ring', 'ladder', 'flag', 'trampoline', 'target', 'net', 'vball', 'coachC', 'peto', 'chaleco', 'bosu', 'fitball', 'pica'] as const) {
      const e = el(t, { x: 0.5, y: 0.5, size: 1 });
      expect(isMaterial(t)).toBe(true);
      expect(resizeHandles(e), `asas de material ${t}`).toHaveLength(0);
    }
  });

  it('jugador: cuadro de selección con 4 asas de esquina (escala uniforme vía size, se mantiene)', () => {
    const player = el('player', { x: 0.5, y: 0.5, size: 1, n: 9 });
    const hs = resizeHandles(player);
    expect(hs).toHaveLength(4);
    const half = pointLikeResizeHalf(player.size ?? 1);
    expect(hs.find((h) => h.key === 'tl')!.x).toBeCloseTo(0.5 - half.hw, 10);
    expect(hs.find((h) => h.key === 'br')!.x).toBeCloseTo(0.5 + half.hw, 10);
  });

  // =============================================================
  // FASE 6 — giros ±90° exactos (barra de contexto).
  // =============================================================

  it('normalizeRotation normaliza el ángulo a [0,360) y los giros ±90° son EXACTOS', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
    // +90 desde 90 → 180; desde 270 → 0 (wrap).
    expect(normalizeRotation(90 + 90)).toBe(180);
    expect(normalizeRotation(270 + 90)).toBe(0);
    // -90 desde 90 → 0; desde 0 → 270 (wrap).
    expect(normalizeRotation(90 - 90)).toBe(0);
    expect(normalizeRotation(0 - 90)).toBe(270);
    // dos giros +90 repetidos acumulan exactamente 180.
    expect(normalizeRotation(normalizeRotation(45 + 90) + 90)).toBe(225);
  });
});
