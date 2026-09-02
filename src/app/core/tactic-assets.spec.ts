import { describe, expect, it } from 'vitest';
import {
  TACTIC_ASSETS,
  TACTICAL_SIZE,
  materialBaseSize,
  materialHitFrac,
  tacticAsset,
  materialAsset,
  MATERIAL_SIZE_RATIO,
} from './tactic-assets';

describe('tactic-assets — manifiesto de material', () => {
  it('cada asset referencia un PNG existente o es vectorial (asset vacío)', () => {
    for (const a of TACTIC_ASSETS) {
      expect(a.kind).toBeTruthy();
      // Debe respetar el <base href>; una barra inicial rompería GitHub Pages
      // al sacar el recurso fuera de `/CDMPLab/`.
      if (a.asset) expect(a.asset).toMatch(/^assets\/tactical\//);
    }
  });

  it('materialAsset asigna la herramienta al material correcto', () => {
    expect(materialAsset('cone')?.kind).toBe('cone_red');
    expect(materialAsset('ball')?.kind).toBe('ball_football');
    expect(materialAsset('marker')?.kind).toBe('disc');
    expect(materialAsset('no-existe')).toBeUndefined();
  });

  it('tacticAsset localiza por TacticalKind', () => {
    expect(tacticAsset('pole')?.label).toBe('Pértiga');
    expect(tacticAsset('minigoal')?.label).toBe('Miniportería');
  });

  describe('TACTICAL_SIZE — tamaños base normalizados', () => {
    it('todo kind de la lista tiene un tamaño base positivo', () => {
      for (const a of TACTIC_ASSETS) {
        const s = materialBaseSize(a.kind);
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThanOrEqual(2);
      }
    });

    it('los elementos de longitud de campo son MÁS grandes que los compactos', () => {
      const pitchLength: string[] = ['pole', 'ladder', 'ladder_yellow', 'minigoal', 'mannequin_row', 'hurdle', 'flag', 'mannequin'];
      const compact: string[] = ['cone_red', 'cone_yellow', 'cone_blue', 'cone_orange', 'cone_white', 'cone_blue2', 'disc', 'target', 'ring', 'vball'];
      for (const p of pitchLength) expect(TACTICAL_SIZE[p]).toBeGreaterThan(1);
      for (const c of compact) expect(TACTICAL_SIZE[c]).toBeLessThanOrEqual(1);
    });

    it('materialBaseSize devuelve la base reducida a ~75 % (Fase 4) y no lanza con undefined', () => {
      // Fase 4: el tamaño inicial de los objetos colocados se reduce a 0.75 × la base.
      expect(materialBaseSize('pole')).toBeCloseTo(TACTICAL_SIZE['pole'] * MATERIAL_SIZE_RATIO, 6);
      expect(materialBaseSize('cone_red')).toBeCloseTo(1.0 * MATERIAL_SIZE_RATIO, 6);
      expect(materialBaseSize('clave-desconocida')).toBeCloseTo(MATERIAL_SIZE_RATIO, 6);
      expect(materialBaseSize(undefined)).toBeCloseTo(MATERIAL_SIZE_RATIO, 6);
    });
  });

  describe('TACTICAL_BBOX — fracción de contenido para la hit-box', () => {
    it('los materiales estrechos tienen una fracción de ancho pequeña (pértiga, escalera, maniquí)', () => {
      expect(materialHitFrac('pole').w).toBeLessThan(0.5);
      expect(materialHitFrac('ladder').h).toBeLessThan(0.5);
      expect(materialHitFrac('mannequin').w).toBeLessThan(0.5);
    });

    it('los compactos usan la caja completa (o casi) por defecto', () => {
      expect(materialHitFrac('target').w).toBe(1);
      expect(materialHitFrac('unknown').w).toBe(1);
      expect(materialHitFrac('unknown').h).toBe(1);
    });
  });
});
