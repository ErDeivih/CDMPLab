import { describe, expect, it } from 'vitest';
import { CanvasFrame } from '../../core/models';
import { materialBaseSize } from '../../core/tactic-assets';
import { renderBoardSvg, weightedVestDrawing } from '../../core/render';
import { layerShiftFrames, transformSelectionFrames } from './board-doc';

describe('selección de grupo', () => {
  const frames: CanvasFrame[] = [
    {
      duration: 1000,
      elements: [
        { id: 'a', t: 'pica', x: 0.3, y: 0.5, size: 1 },
        { id: 'b', t: 'player', x: 0.7, y: 0.5, size: 1 },
        { id: 'c', t: 'ball', x: 0.5, y: 0.2, locked: true },
        { id: 'd', t: 'cone', x: 0.2, y: 0.3 },
      ],
    },
  ];
  it('gira respecto al centro del grupo usando unidades físicas, no porcentajes', () => {
    const result = transformSelectionFrames(frames, ['a', 'b', 'c'], { w: 100, h: 50 }, 1, 90)[0]
      .elements;
    expect(result[0].x).toBeCloseTo(0.5);
    expect(result[0].y).toBeCloseTo(0.1);
    expect(result[1].y).toBeCloseTo(0.9);
    expect(result[0].rot).toBe(90);
    expect(result[2]).toBe(frames[0].elements[2]);
    expect(frames[0].elements[0].x).toBe(0.3);
  });
  it('escala distancias y tamaños; no aplica dos veces los factores de balón y miniportería', () => {
    const source: CanvasFrame[] = [
      {
        duration: 1000,
        elements: [
          { id: 'ball', t: 'ball', x: 0.5, y: 0.5 },
          { id: 'mini', t: 'minigoal', x: 0.6, y: 0.6 },
        ],
      },
    ];
    const result = transformSelectionFrames(source, ['ball', 'mini'], { w: 100, h: 50 }, 1.1)[0]
      .elements;
    expect(result[0].size).toBeCloseTo(materialBaseSize('ball') * 1.1);
    expect(result[1].size).toBeCloseTo(materialBaseSize('minigoal') * 1.1);
    expect(result[0].x).toBeCloseTo(0.495);
  });
  it('las capas conservan el orden del grupo tanto en extremos como en pasos', () => {
    const ids = (direction: 1 | -1, step = false) =>
      layerShiftFrames(frames, ['a', 'c'], direction, step)[0].elements.map((el) => el.id);
    expect(ids(1)).toEqual(['b', 'd', 'a', 'c']);
    expect(ids(-1)).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(1, true)).toEqual(['b', 'a', 'd', 'c']);
    expect(ids(-1, true)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('transforma líneas, curvas, trazos y cajas sin perder su geometría', () => {
    const source: CanvasFrame[] = [
      {
        duration: 1000,
        elements: [
          { id: 'l', t: 'curve', x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7, c1x: 0.5, c1y: 0.2 },
          {
            id: 'f',
            t: 'freehand',
            points: [
              [0.4, 0.4],
              [0.6, 0.6],
            ],
          },
          { id: 't', t: 'text', x: 0.4, y: 0.4, w: 0.2, h: 0.2, v: 'Texto', size: 1.4 },
        ],
      },
    ];
    const scaled = transformSelectionFrames(source, ['l', 'f', 't'], { w: 100, h: 100 }, 2)[0]
      .elements;
    expect(scaled[0].x1).toBeCloseTo(0.1);
    // La curva incluye el punto de control en su centro: el centro común Y es 0.45.
    expect(scaled[0].c1y).toBeCloseTo(-0.05);
    expect(scaled[1].points?.[0][0]).toBeCloseTo(0.3);
    expect(scaled[2].w).toBeCloseTo(0.4);
    expect(scaled[2].size).toBeCloseTo(2.8);
  });
  it('el render recolorea conos/aros fotográficos y reconoce un chaleco con bolsillos de lastre', () => {
    for (const t of ['cone', 'ring'] as const) {
      const svg = renderBoardSvg(
        'full',
        [{ id: t, t, x: 0.5, y: 0.5, c: '#a855f7', asset: 'assets/tactical/cone-red.png' }],
        {},
      );
      expect(svg).toContain('feComponentTransfer');
      expect(svg).toContain('filter="url(');
    }
    expect(weightedVestDrawing().match(/width="1" height="0.85"/g)).toHaveLength(4);
    expect(renderBoardSvg('full', [{ id: 'vest', t: 'chaleco', x: 0.5, y: 0.5 }], {})).toContain(
      weightedVestDrawing(),
    );
  });
});
