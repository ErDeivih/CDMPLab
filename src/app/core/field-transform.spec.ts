import { describe, expect, it } from 'vitest';
import { transformHalfToFull, transformElementsHalfToFull, HALF_LEN_RATIO, mapToTwoHalves, transformFullToHalf, transformElementsFullToHalf, transformFramesHalfToFull, transformFramesFullToHalf, mapFramesToTwoHalves } from './field-transform';
import { CanvasElement, CanvasFrame, FieldType } from './models';

describe('field-transform (FASE 5) — transformación centralizada medio → completo', () => {
  it('HALF_LEN_RATIO es 0,5 (52,5 de 105 m)', () => {
    expect(HALF_LEN_RATIO).toBeCloseTo(0.5, 5);
  });

  it('player: la fracción de LONGITUD se divide por 2; la de ANCHURA se conserva (horizontal => largo en X)', () => {
    const p: CanvasElement = { id: 'p', t: 'player', x: 0.6, y: 0.7 };
    const out = transformHalfToFull(p, false);
    expect(out.x).toBeCloseTo(0.3, 5);
    expect(out.y).toBeCloseTo(0.7, 5);
  });

  it('vertical: el largo va en Y, así que se divide Y y se conserva X', () => {
    const p: CanvasElement = { id: 'p', t: 'player', x: 0.6, y: 0.7 };
    const out = transformHalfToFull(p, true);
    expect(out.y).toBeCloseTo(0.35, 5);
    expect(out.x).toBeCloseTo(0.6, 5);
  });

  it('línea (x/y inicial-final) transforma ambos extremos y el control de curva', () => {
    const line: CanvasElement = { id: 'l', t: 'line', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.9 };
    const out = transformHalfToFull(line, false);
    expect(out.x1).toBeCloseTo(0.1, 5);
    expect(out.y1).toBeCloseTo(0.3, 5);
    expect(out.x2).toBeCloseTo(0.4, 5);
    expect(out.y2).toBeCloseTo(0.9, 5);
  });

  it('rect/zone conserva el ancho y divide el alto/x por 2 (largo)', () => {
    const r: CanvasElement = { id: 'r', t: 'rect', x: 0.4, y: 0.5, w: 0.2, h: 0.1 };
    const out = transformHalfToFull(r, false);
    expect(out.x).toBeCloseTo(0.2, 5);
    expect(out.w).toBeCloseTo(0.1, 5);
    expect(out.y).toBeCloseTo(0.5, 5);
    expect(out.h).toBeCloseTo(0.1, 5);
  });

  it('transformElementsHalfToFull aplica a la lista completa sin mutar el original', () => {
    const els: CanvasElement[] = [
      { id: 'a', t: 'player', x: 0.5, y: 0.5 },
      { id: 'b', t: 'cone', x: 1, y: 0.4 },
    ];
    const snapshot = JSON.stringify(els);
    const out = transformElementsHalfToFull(els, false);
    expect(out).toHaveLength(2);
    expect(out[0].x).toBeCloseTo(0.25, 5);
    expect(out[1].x).toBeCloseTo(0.5, 5);
    expect(JSON.stringify(els)).toBe(snapshot); // no muta
  });

  it('A2: mapToTwoHalves conserva coordenadas (full→two_halves solo cambia el fondo)', () => {
    const els: CanvasElement[] = [
      { id: 'a', t: 'player', x: 0.9, y: 0.5 },
      { id: 'b', t: 'rect', x: 0.5, y: 0.5, w: 0.4, h: 0.2 },
    ];
    const out = mapToTwoHalves(els, false);
    expect(out[0].x).toBeCloseTo(0.9, 5);
    expect(out[1].x).toBeCloseTo(0.5, 5);
    expect(out[1].w).toBeCloseTo(0.4, 5);
  });

  it('A2: full→half (encajar todo) CONSERVA la composición (identidad), nunca fuera de [0,1] ni comprimida dos veces', () => {
    const p: CanvasElement = { id: 'p', t: 'player', x: 0.75, y: 0.7 };
    const out = transformFullToHalf(p, false);
    // Encajar todo = las coordenadas normalizadas se conservan (el rect del medio campo
    // ya es físicamente la mitad): 0,75 no se comprime a 0,375 ni sale a 1,5.
    expect(out.x).toBeCloseTo(0.75, 5);
    expect(out.y).toBeCloseTo(0.7, 5);
  });

  it('medio→full→medio NO comprime el doble: 0,5 pasa a 0,25, nunca a 0,125', () => {
    const p: CanvasElement = { id: 'p', t: 'player', x: 0.5, y: 0.5 };
    const out = transformFullToHalf(transformHalfToFull(p, false), false);
    // half→full (×0,5 → 0,25) luego full→half (identidad → 0,25). La compresión doble
    // (0,5*0,5*0,5=0,125) queda corregida.
    expect(out.x).toBeCloseTo(0.25, 5);
  });

  it('transformFramesHalfToFull/transformFramesFullToHalf aplican a frames sin mutar', () => {
    const frames: CanvasFrame[] = [{ duration: 1000, elements: [{ id: 'a', t: 'player', x: 0.5, y: 0.5 }] }];
    const h = transformFramesHalfToFull(frames, false);
    // half→full (×0,5) → 0,25; luego full→half (identidad) → 0,25 (sin doble compresión).
    const f = transformFramesFullToHalf(h, false);
    expect(f[0].elements[0].x).toBeCloseTo(0.25, 5);
    expect(frames[0].elements[0].x).toBe(0.5); // no muta
  });

  it('Bloque F #5 — half → two_halves coloca el ejercicio en la PRIMERA MITAD (×0,5) y dentro de [0,1]', () => {
    // Un elemento a mitad de un medio campo (x=0.5) se sitúa en el primer cuarto del
    // campo completo (x=0.25): es decir, en la primera mitad del "dos medios campos".
    const halfEl: CanvasElement = { id: 'a', t: 'player', x: 0.5, y: 0.5 };
    const full = transformHalfToFull(halfEl, false); // ×0,5 → 0,25 (primera mitad)
    expect(full.x).toBeCloseTo(0.25, 5);
    expect(full.x, 'la coordenada queda dentro de [0,1]').toBeGreaterThanOrEqual(0);
    expect(full.x).toBeLessThanOrEqual(1);
    // Al pasar a dos medios campos (identidad) se conserva esa primera mitad.
    const two = mapToTwoHalves([full], false);
    expect(two[0].x).toBeCloseTo(0.25, 5);
  });

  it('Bloque F #3 — ninguna transformación deja coordenadas fuera del dominio de la franja [-0.05, 1.05]', () => {
    const edge: CanvasElement[] = [
      { id: 'a', t: 'player', x: 1.0, y: 1.0 }, // extremo (dentro del dominio)
      { id: 'b', t: 'rect', x: 0.6, y: 0.7, w: 0.3, h: 0.2 },
      { id: 'c', t: 'line', x1: 1.0, y1: 0.0, x2: 0.9, y2: 1.0 },
    ];
    // full → half (encajar todo = identidad): las coordenadas se conservan, nunca salen
    // del dominio de la franja (que es el rango válido persistente, FASE 3).
    const down = transformElementsFullToHalf(edge, false);
    const allIn = (els: CanvasElement[]) => {
      for (const el of els) {
        const xs = [el.x, el.x1, el.x2, el.w ? el.x! + el.w! : undefined, el.y, el.y1, el.y2, el.h ? el.y! + el.h! : undefined].filter((v) => typeof v === 'number' && Number.isFinite(v));
        for (const v of xs) expect(v).toBeGreaterThanOrEqual(-0.05);
        for (const v of xs) expect(v).toBeLessThanOrEqual(1.05);
      }
    };
    allIn(down);
    // Para el rect válido, x+w (0,6 + 0,3 = 0,9) permanece ≤ 1.
    expect(down[1].x).toBeCloseTo(0.6, 5);
    expect(down[1].x! + down[1].w!).toBeLessThanOrEqual(1);
  });

  it('Bloque F #4 — full → two_halves → full conserva modelo y posición (coordenadas idénticas)', () => {
    const els: CanvasElement[] = [
      { id: 'a', t: 'player', x: 0.9, y: 0.5 },
      { id: 'b', t: 'rect', x: 0.5, y: 0.4, w: 0.4, h: 0.2 },
      { id: 'c', t: 'line', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.7 },
    ];
    const two = mapToTwoHalves(els, false); // full → two_halves: identidad de coordenadas
    expect(two).toEqual(els);
    // Volver a full (mapToTwoHalves es idempotente): el modelo y la posición se conservan.
    const back = mapToTwoHalves(two, false);
    expect(back).toEqual(els);
    // La identidad NO muta (campos por referencia distintos pero con el mismo contenido).
    const frames: CanvasFrame[] = [{ duration: 1000, elements: els }];
    const framesTwo = mapFramesToTwoHalves(frames, false);
    expect(framesTwo[0].elements).toEqual(els);
  });

  it('Bloque F #7 — F7 (media extensión) participa en las conversiones: half→full (×0,5) y full→half (identidad) sin salir de [0,1]', () => {
    // F7 usa la extensión de medio campo (52,5 m) igual que `half`, así que ambas
    // conversiones usan el dominio correcto y no dejan coordenadas fuera del rango.
    const f7Els: CanvasElement[] = [{ id: 'p', t: 'player', x: 0.8, y: 0.5 }];
    const toFull = transformElementsHalfToFull(f7Els, false); // ×0,5 → 0,4
    expect(toFull[0].x).toBeCloseTo(0.4, 5);
    const back = transformElementsFullToHalf(toFull, false); // encajar todo = identidad → 0,4
    expect(back[0].x).toBeCloseTo(0.4, 5);
    // Ninguna coordenada fuera de [0,1].
    expect(back[0].x).toBeGreaterThanOrEqual(0);
    expect(back[0].x).toBeLessThanOrEqual(1);
  });

  it('los tipos nuevos goal/mannequin_row/dumbbell participan en las conversiones de campo (x*y transformados)', () => {
    for (const t of ['goal', 'mannequin_row', 'dumbbell'] as Array<CanvasElement['t']>) {
      const el: CanvasElement = { id: `${t}-c`, t, x: 0.6, y: 0.4, assetKind: String(t) };
      const full = transformHalfToFull(el, false); // ×0,5 el largo (x)
      expect((full.x ?? 0)).toBeCloseTo(0.3, 5);
      expect((full.y ?? 0)).toBeCloseTo(0.4, 5);
      const half = transformFullToHalf(full, false); // encajar todo = identidad
      expect((half.x ?? 0)).toBeCloseTo(0.3, 5);
      expect((half.y ?? 0)).toBeCloseTo(0.4, 5);
    }
  });
});
