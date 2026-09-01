import { describe, expect, it } from 'vitest';
import { normalizeCanvas, CANVAS_SCHEMA_VERSION } from './canvas';
import { CanvasElement } from './models';
import { MATERIAL_SIZE_RATIO } from './tactic-assets';

function el(x: number, y: number): CanvasElement {
  return { t: 'player', x, y, n: 9, c: '#1a73e8', side: 'own' } as CanvasElement;
}

describe('normalizeCanvas (schemaVersion/migrador)', () => {
  it('convierte un array v1 a un documento v2 con un único frame', () => {
    const doc = normalizeCanvas([el(0.3, 0.5), el(0.6, 0.5)]);
    expect(doc.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(doc.frames).toHaveLength(1);
    expect(doc.frames[0].elements).toHaveLength(2);
    // Asigna ids estables a elementos sin id.
    expect(doc.frames[0].elements.every((e) => e.id)).toBe(true);
  });

  it('asegura schemaVersion, duraciones e ids en un documento v2', () => {
    const raw = {
      version: 2,
      field: 'full',
      frames: [{ duration: 0, elements: [el(0.2, 0.2)] }],
    };
    const doc = normalizeCanvas(raw);
    expect(doc.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(doc.frames[0].duration).toBe(1000);
    expect(doc.frames[0].elements[0].id).toBeTruthy();
  });

  it('devuelve un lienzo vacío si el documento es inválido', () => {
    const doc = normalizeCanvas(null);
    expect(doc.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(doc.frames).toHaveLength(1);
    expect(doc.frames[0].elements).toHaveLength(0);
    expect(doc.field).toBe('full');
  });

  it('conserva los ids existentes (no los reemplaza)', () => {
    const a = el(0.2, 0.2);
    a.id = 'keep-me';
    const doc = normalizeCanvas({ version: 2, field: 'half', frames: [{ duration: 500, elements: [a] }] });
    expect(doc.frames[0].elements[0].id).toBe('keep-me');
    expect(doc.field).toBe('half');
  });

  it('restaura orientación, colores y rejilla al abrir', () => {
    const doc = normalizeCanvas({
      version: 2,
      field: 'full',
      orientation: 'vertical',
      backgroundColor: '#123456',
      lineColor: '#ff0000',
      grass: 'plain',
      grid: true,
      frames: [{ duration: 800, elements: [el(0.2, 0.2)] }],
    });
    expect(doc.orientation).toBe('vertical');
    expect(doc.backgroundColor).toBe('#123456');
    expect(doc.lineColor).toBe('#ff0000');
    expect(doc.grid).toBe(true);
    expect(doc.frames[0].duration).toBe(800);
  });

  it('acepta los tipos nuevos (ellipse/freehand/curve) y valida sus puntos/control', () => {
    const el: CanvasElement = {
      id: 'mix',
      t: 'curve',
      x1: 0.2,
      y1: 0.2,
      c1x: 0.5,
      c1y: 0.5,
      x2: 0.8,
      y2: 0.2,
    };
    const fr: CanvasElement = { id: 'f', t: 'freehand', points: [[0.1, 0.2], [9, -3], [0.5, 0.5]] };
    const ep: CanvasElement = { id: 'e', t: 'ellipse', x: 0.2, y: 0.2, w: 0.3, h: 0.2, fill: false };
    const doc = normalizeCanvas({ version: 2, field: 'full', frames: [{ duration: 1000, elements: [el, fr, ep] }] });
    const ids = doc.frames[0].elements.map((e) => e.id);
    expect(ids).toContain('mix');
    expect(ids).toContain('f');
    expect(ids).toContain('e');
    const freehand = doc.frames[0].elements.find((e) => e.id === 'f')!;
    expect(freehand.points).toEqual([[0.1, 0.2], [1, 0], [0.5, 0.5]]);
  });

  it('migra materiales: vector histórico, asset sin assetKind, assetKind válido y desconocido', () => {
    const vector: CanvasElement = { id: 'v', t: 'cone', x: 0.2, y: 0.2 }; // histórico: sin asset ni assetKind
    const legacy: CanvasElement = { id: 'l', t: 'cone', x: 0.3, y: 0.3, asset: '/assets/tactical/cone-red.png' }; // asset sin assetKind
    const valid: CanvasElement = { id: 'ok', t: 'cone', x: 0.4, y: 0.4, asset: '/assets/tactical/cone-blue.png', assetKind: 'cone_blue' };
    const unknown: CanvasElement = { id: 'u', t: 'ring', x: 0.5, y: 0.5, asset: '/assets/tactical/esto-no-existe.png', assetKind: 'no-existe' };
    const doc = normalizeCanvas({ version: 2, field: 'full', frames: [{ duration: 1000, elements: [vector, legacy, valid, unknown] }] });
    const byId = (id: string) => doc.frames[0].elements.find((e) => e.id === id)!;
    expect(byId('v').asset).toBeUndefined(); // se conserva vectorial
    expect(byId('l').asset).toBe('/assets/tactical/cone-red.png'); // compat: asset se mantiene
    expect(byId('ok').asset).toBe('/assets/tactical/cone-blue.png');
    expect(byId('u').asset).toBeUndefined(); // materialKind desconocido → fallback vectorial
    expect(byId('u').t).toBe('ring');
  });

  it('no descarta los materiales nuevos (flag/trampoline/target/net/vball) al normalizar', () => {
    const newOnes: CanvasElement[] = [
      { id: 'f', t: 'flag', x: 0.2, y: 0.2, asset: '/assets/tactical/flag.png', assetKind: 'flag' },
      { id: 't', t: 'trampoline', x: 0.3, y: 0.3, asset: '/assets/tactical/trampoline.png', assetKind: 'trampoline' },
      { id: 'g', t: 'target', x: 0.4, y: 0.4, asset: '/assets/tactical/target.png', assetKind: 'target' },
      { id: 'n', t: 'net', x: 0.5, y: 0.5, asset: '/assets/tactical/net.png', assetKind: 'net' },
      { id: 'v', t: 'vball', x: 0.6, y: 0.6, asset: '/assets/tactical/ball-purple.png', assetKind: 'vball' },
    ];
    const doc = normalizeCanvas({ version: 2, field: 'full', frames: [{ duration: 1000, elements: newOnes }] });
    const ids = doc.frames[0].elements.map((e) => e.id);
    expect(ids).toEqual(['f', 't', 'g', 'n', 'v']);
    // Se conservan tipo, asset y assetKind (ninguno cae al fallback vectorial por ser "desconocido").
    for (const e of doc.frames[0].elements) {
      expect(e.asset).toContain('/assets/tactical/');
      expect(e.assetKind).toBeTruthy();
    }
  });

  it('conserva varios fotogramas y duraciones tras normalizar', () => {
    const frames = [
      { duration: 800, elements: [] },
      { duration: 1200, elements: [] },
      { duration: 600, elements: [] },
    ];
    const doc = normalizeCanvas({ version: 2, field: 'full', frames });
    expect(doc.frames).toHaveLength(3);
    expect(doc.frames.map((f) => f.duration)).toEqual([800, 1200, 600]);
  });

  it('guarda/carga el texto multilínea EXACTO (líneas vacías iniciales, finales y consecutivas)', () => {
    const v = '\nRondos 4v2\n\nConservación\n\nPase en superioridad\n';
    const t: CanvasElement = { id: 't', t: 'text', x: 0.3, y: 0.3, v, size: 3, w: 0.3, h: 0.3, autoH: false };
    const doc = normalizeCanvas({ version: 2, field: 'full', frames: [{ duration: 1000, elements: [t] }] });
    const out = doc.frames[0].elements.find((e) => e.id === 't')!;
    expect(out.t).toBe('text');
    // El contenido (con sus saltos) se conserva bit a bit.
    expect(out.v).toBe(v);
    // El flag de "cuadro fijado a mano" persiste.
    expect(out.autoH).toBe(false);
  });

  // ---------- Fase 4 — migración de tamaños (una sola vez, idempotente) ----------

  it('migra UNA vez el size de materiales/texto de un documento antiguo (schemaVersion < 4)', () => {
    const cone: CanvasElement = { id: 'c', t: 'cone', x: 0.3, y: 0.3, size: 1.0, assetKind: 'cone_red', asset: '/assets/tactical/cone-red.png' };
    const pole: CanvasElement = { id: 'p', t: 'pole', x: 0.5, y: 0.5, size: 1.6, assetKind: 'pole', asset: '/assets/tactical/pole.png' };
    const txt: CanvasElement = { id: 't', t: 'text', x: 0.2, y: 0.2, v: 'Hola', size: 3, w: 0.3, h: 0.14 };
    const player: CanvasElement = { id: 'pl', t: 'player', x: 0.4, y: 0.5, n: 5, c: '#1a73e8', side: 'own' };
    const raw = { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [cone, pole, txt, player] }] };

    const doc = normalizeCanvas(raw);
    const byId = (id: string) => doc.frames[0].elements.find((e) => e.id === id)!;
    expect(doc.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(byId('c').size).toBeCloseTo(1.0 * MATERIAL_SIZE_RATIO, 6);
    expect(byId('p').size).toBeCloseTo(1.6 * MATERIAL_SIZE_RATIO, 6);
    expect(byId('t').size).toBeCloseTo(3 * MATERIAL_SIZE_RATIO, 6);
    // Un jugador SIN size no se toca (su base curre por materialBaseSize ya reducida).
    expect(byId('pl').size).toBeUndefined();
  });

  it('la migración es IDEMPOTENTE: aplicar normalizeCanvas DOS veces no vuelve a encoger', () => {
    const cone: CanvasElement = { id: 'c', t: 'cone', x: 0.3, y: 0.3, size: 1.0, assetKind: 'cone_red', asset: '/assets/tactical/cone-red.png' };
    const txt: CanvasElement = { id: 't', t: 'text', x: 0.2, y: 0.2, v: 'Hola', size: 3, w: 0.3, h: 0.14 };
    const raw = { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [cone, txt] }] };
    const once = normalizeCanvas(raw);
    const twice = normalizeCanvas(once);
    // Al reabrir (ya con version 4), NO se vuelve a escalar.
    expect(twice.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    const byId = (doc: typeof once, id: string) => doc.frames[0].elements.find((e) => e.id === id)!;
    expect(byId(twice, 'c').size).toBeCloseTo(byId(once, 'c').size!, 6);
    expect(byId(twice, 't').size).toBeCloseTo(byId(once, 't').size!, 6);
  });

  it('conserva los valores explícitos de un documento YA migrado (schemaVersion >= 4)', () => {
    const cone: CanvasElement = { id: 'c', t: 'cone', x: 0.3, y: 0.3, size: 0.75, assetKind: 'cone_red', asset: '/assets/tactical/cone-red.png' };
    const raw = { version: 2, schemaVersion: CANVAS_SCHEMA_VERSION, field: 'full', frames: [{ duration: 1000, elements: [cone] }] };
    const doc = normalizeCanvas(raw);
    expect(doc.frames[0].elements[0].size).toBe(0.75);
  });

  it('Fase 3: migra los documentos v4 (ya a 0.75) al nuevo tamaño 0.60 UNA sola vez (idempotente)', () => {
    const cone: CanvasElement = { id: 'c', t: 'cone', x: 0.3, y: 0.3, size: 0.75, assetKind: 'cone_red', asset: '/assets/tactical/cone-red.png' };
    const raw = { version: 2, schemaVersion: 4, field: 'full', frames: [{ duration: 1000, elements: [cone] }] };
    const doc = normalizeCanvas(raw);
    expect(doc.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    // 0.75 (base antigua) × 0.80 = 0.60 (nuevo tamaño base).
    expect(doc.frames[0].elements[0].size).toBeCloseTo(0.75 * 0.80, 6);
    // Reabrir (ya v5) NO vuelve a encoger.
    const twice = normalizeCanvas(doc);
    expect(twice.frames[0].elements[0].size).toBeCloseTo(0.75 * 0.80, 6);
  });

  it('no toca las líneas/flechas al migrar (solo tamaño de puntuales/materiales/texto)', () => {
    const line: CanvasElement = { id: 'l', t: 'line', x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8, strokeWidth: 0.8 };
    const arrow: CanvasElement = { id: 'a', t: 'arrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3, strokeWidth: 0.4 };
    const raw = { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [line, arrow] }] };
    const doc = normalizeCanvas(raw);
    expect(doc.frames[0].elements[0].strokeWidth).toBe(0.8);
    expect(doc.frames[0].elements[1].strokeWidth).toBe(0.4);
  });
});
