import { describe, expect, it } from 'vitest';
import {
  CANONICAL_MATERIALS,
  visibleMaterials,
  canonicalTitle,
  isRetiredMaterial,
  MATERIAL_ALIAS,
  chinoSvg,
  dumbbellSvg,
  hurdleSvg,
  CHINO_COLORS,
} from './material-registry';
import { materialAsset, materialBaseSize, materialHitFrac } from './tactic-assets';
import { isKnownElementType } from './models';

describe('material-registry (B1) — catálogo canónico y compatibilidad', () => {
  it('expone el catálogo visible final con los nombres esperados', () => {
    const titles = visibleMaterials().map((m) => m.title);
    for (const t of [
      'Balón',
      'Fitball',
      'Cono',
      'Chino',
      'BOSU',
      'Portería grande',
      'Escalera',
      'Aro',
      'Maniquí individual',
      'Barrera de maniquíes',
      'Mancuerna / pesa',
    ]) {
      expect(titles, `falta ${t}`).toContain(t);
    }
  });

  it('el catálogo visible NO contiene ningún nombre retirado (Bloque F #10)', () => {
    const titles = visibleMaterials().map((m) => m.title.toUpperCase());
    for (const retired of ['Marcador C', 'Diana', 'RED', 'ARO PLANO', 'Marcador']) {
      expect(titles, `"${retired}" no debe estar en el catálogo visible`).not.toContain(retired);
    }
  });

  it('FASE 8D: el material se llama «Pica» (ya no «Pica coloreable») sin cambiar su id interno', () => {
    const titles = visibleMaterials().map((m) => m.title);
    expect(titles, 'el nombre visible es «Pica»').toContain('Pica');
    expect(titles, 'el nombre viejo ya no está en el catálogo').not.toContain('Pica coloreable');
    expect(
      titles.some((t) => t.toLowerCase().includes('coloreable')),
      'ningún material visible se anuncia como «coloreable»',
    ).toBe(false);
    // El id interno y el tipo de elemento NO cambian: los documentos y las copias de seguridad
    // antiguas siguen siendo válidos (compatibilidad exigida por el encargo).
    const pica = CANONICAL_MATERIALS.find((m) => m.id === 'pica');
    expect(pica, 'el id interno sigue siendo pica').toBeTruthy();
    expect(pica!.title).toBe('Pica');
    expect(pica!.help).toBe('Pica');
    expect(isKnownElementType('pica'), 'el tipo de elemento guardado sigue siendo válido').toBe(
      true,
    );
  });

  it('FASE 8B: el Chino es un platillo visto desde arriba, transparente y PEQUEÑO respecto al cono', () => {
    const azul = chinoSvg('#2c7be5');
    const rojo = chinoSvg('#e74c3c');
    // Recoloreable: usa el color pedido y no arrastra otro.
    expect(azul).toContain('#2c7be5');
    expect(azul).not.toContain('#e74c3c');
    expect(rojo).toContain('#e74c3c');
    // Perspectiva "ligeramente desde arriba": aro exterior, PARED del plato (path) y sombra.
    expect(azul, 'aro exterior').toMatch(/<ellipse[^>]*rx="12\.2"[^>]*ry="5\.6"/);
    expect(azul, 'pared del plato (da la perspectiva)').toContain('<path');
    expect(azul, 'sombra de apoyo en el suelo').toMatch(/<ellipse[^>]*fill="#000000"/);
    // Fondo transparente: ningún rectángulo que cubra el viewBox entero.
    expect(azul, 'sin fondo opaco').not.toMatch(/<rect[^>]*width="32"[^>]*height="32"/);
    // Único SVG: la estructura es idéntica con cualquier color (no hay una imagen por color).
    const normalizar = (s: string) => s.replace(/#[0-9a-f]{6}/gi, '#COLOR');
    expect(normalizar(azul), 'el mismo SVG sirve para todos los colores').toBe(normalizar(rojo));
    expect(azul.length).toBe(rojo.length);
    // Pequeño respecto al cono: como mucho el 70 % de su tamaño base.
    const cono = materialBaseSize('cone_red');
    const chino = materialBaseSize('target');
    expect(chino, `chino ${chino} vs cono ${cono}`).toBeLessThan(cono * 0.7);
    // Y la caja visible coincide con la figura: el platillo AGRANDADO mide 2,0 × 1,29 de semiejes
    // sobre una caja de 5,2 unidades, es decir 0,81 × 0,75 de la mitad de la caja (antes 0,6 × 0,62).
    // CIERRE DEL ENCARGO DE MATERIALES: el chino se agrandó porque medía ~30 % del cono y en pantalla
    // parecía un punto; ahora su anchura visible queda en el 45-55 % pedido (16 px frente a 32).
    expect(materialHitFrac('target')).toEqual({ w: 0.81, h: 0.75 });
  });

  it('oculta los retirados (Marcador C, Diana, Red, Aro plano, fitball naranja)', () => {
    expect(isRetiredMaterial('coachC')).toBe(true);
    expect(isRetiredMaterial('net')).toBe(true);
    expect(isRetiredMaterial('ring_flat')).toBe(true);
    expect(isRetiredMaterial('bosu')).toBe(true);
    expect(isRetiredMaterial('cone')).toBe(false);
  });

  it('convierte ids de material a título canónico', () => {
    expect(canonicalTitle('target')).toBe('Chino');
    expect(canonicalTitle('marker')).toBe('BOSU');
    expect(canonicalTitle('vball')).toBe('Fitball');
    expect(canonicalTitle('desconocido')).toBe('desconocido');
  });

  it('el Chino es recoloreable con 5+ colores y usa un único SVG', () => {
    expect(CHINO_COLORS.length).toBeGreaterThanOrEqual(5);
    expect(chinoSvg('#ff0000')).toContain('ff0000');
    expect(chinoSvg()).not.toContain('data:image'); // SVG, no imagen rasterizada
  });

  it('dumbell y hurdle producen SVG transparentes válidos', () => {
    expect(dumbbellSvg()).toContain('<svg');
    expect(hurdleSvg()).toContain('<svg');
    expect(dumbbellSvg()).toContain('fill="#20242a"');
  });

  it('Bloque F #22 — los recursos SVG originales son TRANSPARENTES (sin fondo ni marca de agua, sin imagen rasterizada)', () => {
    for (const svg of [chinoSvg(), dumbbellSvg(), hurdleSvg()]) {
      // Vectorial: NUNCA una imagen embebida (data:image) con fondo/foto.
      expect(svg, 'no hay imagen rasterizada embebida').not.toContain('data:image');
      // Sin <image> ni <foreignObject> (fotos/objetos externos).
      expect(svg, 'no hay <image> (foto)').not.toContain('<image');
      // Sin marca de agua (términos de watermark/logo real, no el xmlns estándar).
      expect(svg, 'sin texto de marca de agua').not.toMatch(/watermark|marca de agua|copyright/i);
      expect(svg, 'sin href a archivo externo').not.toContain('href="');
      // Sin fondo opaco: el primer elemento no es un <rect> que cubra todo el viewBox.
      expect(svg, 'sin fondo de damero/foto').not.toContain('repeating-conic-gradient');
    }
  });

  it('Bloque F #22 — los SVG originales no llevan un rectángulo de FONDO que cubra casi todo el viewBox', () => {
    // Un elemento de material (icono transparente en un viewBox de 32×32) nunca debe
    // abrir con un rect grande de fondo opaco (el falso "damero"/foto de las capturas
    // entregadas). Si un rect ocupa ≥87 % del viewBox, es un fondo, no un objeto.
    const bgRect = /<rect[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g;
    for (const svg of [chinoSvg(), dumbbellSvg(), hurdleSvg()]) {
      let m: RegExpExecArray | null;
      let biggest = 0;
      while ((m = bgRect.exec(svg)) !== null) {
        const w = parseFloat(m[1]);
        const h = parseFloat(m[2]);
        if (Number.isFinite(w) && Number.isFinite(h)) biggest = Math.max(biggest, w * h);
      }
      expect(biggest, 'ningún rect del material cubre casi todo el lienzo').toBeLessThan(
        32 * 32 * 0.87,
      );
    }
  });

  it('Bloque F #11 — los ids de documentos antiguos siguen "abriendo" (se normalizan a título canónico, nunca fallan)', () => {
    // Ids válidos y retirados de ejercicios ANTERIORES: no deben romper la presentación.
    const ids = [
      'ball',
      'vball',
      'cone',
      'target',
      'marker',
      'coachC',
      'net',
      'fitball',
      'ring_flat',
      'bosu',
      'hurdle',
      'dumbbell',
    ];
    for (const id of ids) {
      const t = canonicalTitle(id);
      // Todo id conocido produce un título canónico NO vacío y distinto del id "bruto".
      // Los retirados se detectan (para ocultarlos) y los visibles se listan.
      const isRetired = isRetiredMaterial(id);
      const isVisible = visibleMaterials().some((m) => m.id === id);
      expect(t, `el id ${id} se presenta con un título`).not.toBe('');
      expect(isRetired || isVisible, `el id ${id} es retirado o visible`).toBe(true);
    }
    // Alias concretos requieren presentación canónica concreta (antiguo → nuevo).
    expect(canonicalTitle('vball')).toBe('Fitball');
    expect(canonicalTitle('target')).toBe('Chino');
    expect(canonicalTitle('marker')).toBe('BOSU');
  });

  it('B1 modelo: el catálogo usa TIPOS de elemento colocables (goal/mannequin_row) y corrige ladder→Escalera', () => {
    // `ladder` es la escalera real (elemento `ladder`); la "Portería grande" es un tipo `goal`
    // NUEVO y la "Barrera de maniquíes" un `mannequin_row`. Así el catálogo visible se
    // corresponde con elementos colocables de verdad (no con ids fantasma).
    expect(canonicalTitle('goal')).toBe('Portería grande');
    expect(canonicalTitle('ladder')).toBe('Escalera');
    expect(canonicalTitle('mannequin_row')).toBe('Barrera de maniquíes');
    expect(isKnownElementType('goal')).toBe(true);
    expect(isKnownElementType('mannequin_row')).toBe(true);
    // Ya no hay título "Portería grande" colgado del id fantasma `ladder_yellow`.
    expect(
      visibleMaterials().some(
        (m) => m.id === 'ladder_yellow' || (m.title === 'Portería grande' && m.id === 'ladder'),
      ),
    ).toBe(false);
  });

  it('FASE F: cada material canónico define help (texto de ayuda) y es puntual (sin asas)', () => {
    for (const m of CANONICAL_MATERIALS) {
      expect(m.help, `${m.id} help`).toBeTruthy();
      expect(m.point, `${m.id} es puntual`).toBe(true);
    }
  });

  it('FASE F (profundo): los objetivos que antes fallaron tienen recurso visual real (goal/mannequin_row/dumbbell)', () => {
    // El recurso que consume el PRODUCTO es `materialAsset` (tactic-assets); el registro es
    // la fuente canónica de ids/títulos. No hay una fachada artificial solo para tests.
    expect(materialAsset('cone')?.kind).toBe('cone_red');
    expect(materialAsset('goal')?.label).toBe('Portería grande');
    expect(materialAsset('mannequin_row')?.kind).toBe('mannequin_row');
    expect(materialAsset('dumbbell')?.label).toBe('Mancuerna / pesa');
  });
});
