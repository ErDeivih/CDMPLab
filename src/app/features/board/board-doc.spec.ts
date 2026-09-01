import { describe, expect, it } from 'vitest';
import {
  addElementToFrames,
  removeElementFromFrames,
  moveElementInFrame,
  moveElementsInFrame,
  updateElementInFrames,
  layerShiftFrames,
  addFrame,
  removeFrame,
  moveFrame,
  setFrameDuration,
  translateElement,
  elementCenter,
} from './board-doc';
import { CanvasElement, CanvasFrame } from '../../core/models';

function p(id: string, x: number, y: number): CanvasElement {
  return { id, t: 'player', x, y, n: 1, c: '#1a73e8', side: 'own' };
}
function frame(duration = 1000, ...els: CanvasElement[]): CanvasFrame {
  return { duration, elements: els };
}

describe('board-doc (operaciones puras del documento)', () => {
  it('añade un elemento a todos los frames (inmutable)', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2))];
    const out = addElementToFrames(frames, p('b', 0.5, 0.5));
    expect(out[0].elements).toHaveLength(2);
    expect(frames[0].elements).toHaveLength(1); // no muta el original
  });

  it('borra un elemento de todos los frames', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2), p('b', 0.5, 0.5))];
    const out = removeElementFromFrames(frames, 'a');
    expect(out[0].elements.map((e) => e.id)).toEqual(['b']);
  });

  it('mueve un elemento solo en el frame indicado, por DELTA (traslación real)', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2)), frame(1000, p('a', 0.2, 0.2))];
    const out = moveElementInFrame(frames, 1, 'a', 0.3, 0.1);
    expect(out[0].elements[0].x).toBe(0.2); // no se toca el otro frame
    expect(out[1].elements[0].x).toBeCloseTo(0.5, 5);
    expect(out[1].elements[0].y).toBeCloseTo(0.3, 5);
  });

  it('traslada VARIOS elementos (selección múltiple) con un mismo delta', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2), p('b', 0.5, 0.5), p('c', 0.7, 0.7))];
    const out = moveElementsInFrame(frames, 0, ['a', 'c'], 0.1, -0.05);
    expect(out[0].elements[0].x).toBeCloseTo(0.3, 5); // 'a' movido
    expect(out[0].elements[1].x).toBeCloseTo(0.5, 5); // 'b' intacto
    expect(out[0].elements[2].x).toBeCloseTo(0.8, 5); // 'c' movido
    expect(out[0].elements[0].y).toBeCloseTo(0.15, 5);
    expect(out[0].elements[2].y).toBeCloseTo(0.65, 5);
  });

  it('traslada líneas, curvas y mano alzada por su geometría', () => {
    const line = { id: 'l', t: 'line' as const, x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8 };
    const movedLine = translateElement(line, 0.05, -0.05);
    expect(movedLine.x1).toBeCloseTo(0.15);
    expect(movedLine.x2).toBeCloseTo(0.95);
    expect((movedLine as { t: string }).t).toBe('line');

    const curve = { id: 'c', t: 'curve' as const, x1: 0.1, y1: 0.1, c1x: 0.5, c1y: 0.9, x2: 0.9, y2: 0.1 };
    const movedCurve = translateElement(curve, 0.1, 0);
    expect(movedCurve.x1).toBeCloseTo(0.2);
    expect(movedCurve.c1x).toBeCloseTo(0.6);
    expect(movedCurve.x2).toBeCloseTo(1);

    const fh = { id: 'f', t: 'freehand' as const, points: [[0.2, 0.2], [0.4, 0.4]] as [number, number][] };
    const movedFh = translateElement(fh, 0.1, 0.1);
    expect(movedFh.points![0][0]).toBeCloseTo(0.3, 5);
    expect(movedFh.points![1][0]).toBeCloseTo(0.5, 5);
  });

  it('traslada (y por tanto permite mover/duplicar) los materiales nuevos flag/trampoline/target/net/vball', () => {
    const specs: Array<[CanvasElement['t'], number, number]> = [
      ['flag', 0.2, 0.3],
      ['trampoline', 0.3, 0.4],
      ['target', 0.4, 0.5],
      ['net', 0.5, 0.6],
      ['vball', 0.6, 0.7],
    ];
    for (const [t, x, y] of specs) {
      const el = { id: `${t}-x`, t, x, y, asset: '/assets/tactical/x.png', assetKind: String(t) } as CanvasElement;
      const moved = translateElement(el, 0.05, -0.02);
      expect(moved.x).toBeCloseTo(x + 0.05, 5);
      expect(moved.y).toBeCloseTo(y - 0.02, 5);
    }
  });

  it('calcula el centro geométrico de curva y mano alzada', () => {
    const curve = { id: 'c', t: 'curve' as const, x1: 0, y1: 0, c1x: 0.5, c1y: 0.5, x2: 1, y2: 0 };
    const c = elementCenter(curve);
    expect(c.x).toBeCloseTo(0.5, 5);
    const fh = { id: 'f', t: 'freehand' as const, points: [[0.2, 0.2], [0.4, 0.4], [0.6, 0.2]] as [number, number][] };
    const fc = elementCenter(fh);
    expect(fc.x).toBeCloseTo(0.4, 5);
  });

  it('actualiza una propiedad en todos los frames', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2)), frame(1000, p('a', 0.2, 0.2))];
    const out = updateElementInFrames(frames, 'a', { n: 9 });
    expect(out[0].elements[0].n).toBe(9);
    expect(out[1].elements[0].n).toBe(9);
  });

  it('mueve de capa un elemento', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2), p('b', 0.5, 0.5))];
    const out = layerShiftFrames(frames, 'a', 1);
    expect(out[0].elements.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('añade un fotograma (copia) y permite moverlo/borrarlo', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2))];
    const withAdded = addFrame(frames, 0, 1000);
    expect(withAdded).toHaveLength(2);
    const moved = moveFrame(withAdded, 1, -1);
    expect(moved[0].elements[0].id).toBe('a');
    const removed = removeFrame(withAdded, 0);
    expect(removed).toHaveLength(1);
  });

  it('no borra el último fotograma y ajusta la duración', () => {
    const frames = [frame(1000, p('a', 0.2, 0.2))];
    expect(removeFrame(frames, 0)).toHaveLength(1);
    expect(setFrameDuration(frames, 0, 2500)[0].duration).toBe(2500);
  });
});
