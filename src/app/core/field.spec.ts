import { describe, expect, it } from 'vitest';
import {
  fieldSvg,
  fieldPreviewSvg,
  FIELD_LINE_WIDTH,
  F7_LINE_COLOR,
  fieldGeometry,
  fieldDimensions,
  orientationLabel,
  FIELD_BASE_SPECS,
  fieldObjectScale,
  fieldSurface,
  FUTSAL_SURFACE_COLOR,
  FUTSAL_AREA_COLOR,
  OFFICIAL_PITCH_COLOR,
} from './field';
import { FieldType } from './models';

// Rect de referencia idéntico al de render.boardGeometry (proporción 105×68).
const H = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
const V = { x: 10, y: 4, w: 92 / (105 / 68), h: 92 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Extrae los rectángulos del SVG (x, y, w, h). */
function rects(svg: string): Box[] {
  const out: Box[] = [];
  const re = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
  return out;
}

/** Extrae las porterías (rectángulos con relleno translúcido). */
function goals(svg: string): Box[] {
  const out: Box[] = [];
  const re =
    /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" fill="rgba\(255,255,255,0.25\)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
  return out;
}

/** Extrae las elipses (cx, cy, rx, ry). */
function ellipses(svg: string): Box[] {
  const out: Box[] = [];
  const re = /<ellipse cx="([-\d.]+)" cy="([-\d.]+)" rx="([-\d.]+)" ry="([-\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
  return out;
}

/** Extrae los círculos de marca / spot (cx, cy, r). */
function circles(svg: string): Array<{ x: number; y: number; r: number }> {
  const out: Array<{ x: number; y: number; r: number }> = [];
  const re = /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], r: +m[3] });
  return out;
}

describe('field (geometría orientada)', () => {
  it('campo completo horizontal: porterías a izquierda y derecha, círculo central circular', () => {
    const svg = fieldSvg('full', H, 'horizontal');
    const g = goals(svg);
    expect(g).toHaveLength(2);
    const centerY = H.y + H.h / 2;
    const left = g.some((r) => r.x < H.x);
    const right = g.some((r) => r.x + r.w > H.x + H.w);
    expect(left).toBe(true);
    expect(right).toBe(true);
    for (const gr of g) expect(Math.abs(gr.y + gr.h / 2 - centerY)).toBeLessThan(0.5);
    const c = ellipses(svg).find(
      (e) => Math.abs(e.x - (H.x + H.w / 2)) < 0.5 && Math.abs(e.y - centerY) < 0.5,
    );
    expect(c).toBeDefined();
    expect(Math.abs(c!.w - c!.h)).toBeLessThan(0.05);
  });

  it('campo completo vertical: porterías arriba y abajo, círculo central circular', () => {
    const svg = fieldSvg('full', V, 'vertical');
    const g = goals(svg);
    expect(g).toHaveLength(2);
    const centerX = V.x + V.w / 2;
    const top = g.some((r) => r.y < V.y);
    const bottom = g.some((r) => r.y + r.h > V.y + V.h);
    expect(top).toBe(true);
    expect(bottom).toBe(true);
    for (const gr of g) expect(Math.abs(gr.x + gr.w / 2 - centerX)).toBeLessThan(0.5);
    const c = ellipses(svg).find(
      (e) => Math.abs(e.x - centerX) < 0.5 && Math.abs(e.y - (V.y + V.h / 2)) < 0.5,
    );
    expect(c).toBeDefined();
    expect(Math.abs(c!.w - c!.h)).toBeLessThan(0.05);
  });

  it('medio campo horizontal: portería y área en el extremo izquierdo (x pequeño)', () => {
    const svg = fieldSvg('half', H, 'horizontal');
    const g = goals(svg);
    expect(g).toHaveLength(1);
    // La portería queda en la línea de fondo (l=0 → izquierda), extendiéndose hacia fuera.
    expect(g[0].x).toBeLessThan(H.x + 2);
    const area = rects(svg).find((r) => r.w > H.w * 0.1 && r.x < H.x + H.w * 0.5);
    expect(area).toBeDefined();
  });

  it('medio campo vertical: portería y área en el extremo superior (y pequeño)', () => {
    const svg = fieldSvg('half', V, 'vertical');
    const g = goals(svg);
    expect(g).toHaveLength(1);
    // Con el largo en Y y la portería a l=0, la portería queda ARRIBA (y pequeño).
    expect(g[0].y).toBeLessThan(V.y + 2);
    const area = rects(svg).find((r) => r.h > V.h * 0.1 && r.y < V.y + V.h * 0.5);
    expect(area).toBeDefined();
  });

  it('vertical_half se dibuja orientado como un medio campo (portería en el extremo inicial)', () => {
    const svg = fieldSvg('vertical_half', H, 'horizontal');
    const g = goals(svg);
    expect(g).toHaveLength(1);
    // vertical_half es hoy un alias del 'half': la geometría (52,5×68) y la portería
    // se derivan de la orientación (en horizontal, portería a la izquierda).
    expect(g[0].x).toBeLessThan(H.x + 2);
  });

  it('lienzo (blank) no dibuja nada', () => {
    expect(fieldSvg('blank', H, 'horizontal')).toBe('');
    expect(fieldSvg('blank', V, 'vertical')).toBe('');
  });

  it('campo F7: mismo rect, fuera de juego y SIN línea/círculo central', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    // Los fondos del F7 coinciden con las bandas: ancho completo del rect (92).
    expect(svg).toContain('width="92"');
    // Las líneas interiores del F7 coinciden con los laterales del área grande
    // blanca del F11 (40,32 m de anchura sobre un campo de 68 m).
    const areaSide = H.x + ((68 - 40.32) / (2 * 68)) * H.w;
    expect(svg).toContain(`x1="${areaSide}`);
    // No hay círculo central ni ellipse (solo punto, r=0.35, y sin arcos de esquina).
    expect(svg).not.toContain('<ellipse');
    // Sin línea de medio campo: el F7 no la dibuja.
    const re = /<line x1="([-\d.]+)"/g;
    const xs: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) xs.push(+m[1]);
    const mid = H.x + H.w / 2;
    expect(xs.some((x) => Math.abs(x - mid) < 0.5)).toBe(false);
  });

  it('campo F7 con rect de referencia proporcional: se mantiene el mismo rect', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    // El F7 es un rectángulo único (el exterior) además de las áreas interna.
    const cs = rects(svg);
    const outer = cs.find((r) => Math.abs(r.w - H.w) < 0.01 && r.y > H.y);
    expect(outer).toBeDefined();
    expect(Math.abs(outer!.y - H.y)).toBeGreaterThan(0); // empieza dentro (w0>0)
  });

  it('plantilla F7: la portería del medio campo F11 está ARRIBA y la línea de medio campo ABAJO', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    const g = goals(svg);
    // Solo la portería del medio campo F11 (el F7 no dibuja porterías con relleno).
    expect(g).toHaveLength(1);
    // Portería en la parte superior (y pequeño, por encima/igual al borde superior del campo).
    expect(g[0].y).toBeLessThan(H.y + 2);
    // El contorno ocupa todo el ancho y su arista inferior ES la línea de medio campo (abajo).
    const boundary = rects(svg).find((r) => Math.abs(r.w - H.w) < 0.01);
    expect(boundary).toBeDefined();
    expect(boundary!.y).toBeCloseTo(H.y, 2);
    expect(boundary!.y + boundary!.h).toBeCloseTo(H.y + H.h, 2);
  });

  it('plantilla F7: el F7 queda a IZQUIERDA y DERECHA (cruza el ancho del medio campo)', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    const cs = rects(svg);
    // El rect exterior del F7 empieza y termina exactamente en las bandas del F11.
    const outer = cs.find((r) => Math.abs(r.w - H.w) < 0.01 && r.y > H.y);
    expect(outer).toBeDefined();
    expect(outer!.x).toBeCloseTo(H.x, 5);
    expect(outer!.x + outer!.w).toBeCloseTo(H.x + H.w, 5);
    // Las áreas grandes del F7 están en ambos extremos: izquierda y derecha.
    const big = cs.filter((r) => Math.abs(r.w - 0.14 * H.w) < 0.01);
    expect(big).toHaveLength(2);
    expect(big.some((r) => r.x < H.x + 10)).toBe(true);
    expect(big.some((r) => r.x + r.w > H.x + H.w - 10)).toBe(true);
  });

  it('plantilla F7: los ejes largos del F11 y del F7 son PERPENDICULARES', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    // El medio campo F11 cruza VERTICAL (portería arriba): su contorno va de arriba a abajo.
    const boundary = rects(svg).find((r) => Math.abs(r.w - H.w) < 0.01);
    expect(boundary!.y).toBeCloseTo(H.y, 0);
    expect(boundary!.y + boundary!.h).toBeCloseTo(H.y + H.h, 0);
    // El F7 cruza HORIZONTAL: su rect es ancho (X) y no ocupa todo el alto (Y).
    const outer = rects(svg).find((r) => Math.abs(r.w - H.w) < 0.01 && r.y > H.y);
    expect(outer).toBeDefined();
    expect(outer!.w).toBeGreaterThan(outer!.h); // largo en X (ancho > alto)
    // Los extremos ("porterías") del F7 están a izquierda/derecha (x), no arriba/abajo.
    const big = rects(svg).filter((r) => Math.abs(r.w - 12.88) < 0.5);
    expect(big).toHaveLength(2);
    expect(big.some((r) => r.x < H.x + 10)).toBe(true);
    expect(big.some((r) => r.x + r.w > H.x + H.w - 10)).toBe(true);
  });

  it('plantilla F7: SIN línea ni círculo central del F7; solo el punto central pequeño', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    // No hay ellipse de círculo central.
    expect(svg).not.toContain('<ellipse');
    // No hay línea vertical de medio campo en el centro x≈50.
    const re = /<line x1="([-\d.]+)"/g;
    const xs: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) xs.push(+m[1]);
    const mid = H.x + H.w / 2;
    expect(xs.some((x) => Math.abs(x - mid) < 0.5)).toBe(false);
    // No hay círculo central grande (solo el punto r=0.35).
    expect(svg.match(/<circle [^>]*r="1\.7"/g)).toBeNull();
    expect(svg).toContain('r="0.35"');
  });

  it('plantilla F7: separa las líneas azules del F7 de las blancas del medio campo F11', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    expect(svg).toContain(`stroke="${F7_LINE_COLOR}"`);
    expect(svg).toContain(`fill="${F7_LINE_COLOR}"`);
    expect(svg).toContain('stroke="#ffffff"');
  });

  it('plantilla F7: sus dos líneas interiores coinciden exactamente con los laterales del área F11', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    const expectedLeft = H.x + (0.5 - 40.32 / 68 / 2) * H.w;
    const expectedRight = H.x + (0.5 + 40.32 / 68 / 2) * H.w;
    const verticalLines = [
      ...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g),
    ]
      .filter((m) => Math.abs(Number(m[1]) - Number(m[3])) < 1e-9)
      .map((m) => Number(m[1]));
    expect(verticalLines.some((x) => Math.abs(x - expectedLeft) < 1e-9)).toBe(true);
    expect(verticalLines.some((x) => Math.abs(x - expectedRight) < 1e-9)).toBe(true);
  });

  it('plantilla F7: los arcos del F11 se abren hacia el terreno de juego', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    const paths = [
      ...svg.matchAll(/<path d="M ([\d.]+) ([\d.]+) A [^\"]+ 0 0 ([01]) ([\d.]+) ([\d.]+)"/g),
    ].map((m) => ({ y1: Number(m[2]), sweep: Number(m[3]), y2: Number(m[5]) }));
    const penaltyArc = paths.find((p) => Math.abs(p.y1 - (H.y + (16.5 / 52.5) * H.h)) < 0.01);
    const halfwayArc = paths.find((p) => Math.abs(p.y1 - (H.y + H.h)) < 0.01);
    expect(penaltyArc?.sweep).toBe(0);
    expect(halfwayArc?.sweep).toBe(1);
  });

  it('las marcas de campo usan el grosor compartido FIELD_LINE_WIDTH (0.3), no "1"', () => {
    const svg = fieldSvg('half', H, 'horizontal');
    // Todas las marcas del medio campo usan el nuevo grosor.
    expect(svg).not.toContain('stroke-width="1"');
    expect(svg).toContain(`stroke-width="${FIELD_LINE_WIDTH}"`);
    // El F7 compuesto también usa el grosor compartido.
    const f7 = fieldSvg('f7', H, 'horizontal');
    expect(f7).not.toContain('stroke-width="1"');
    expect(f7).toContain(`stroke-width="${FIELD_LINE_WIDTH}"`);
  });
});

describe('fieldGeometry — proporciones reales por tipo y orientación', () => {
  it('campo completo horizontal: rect canónico 105×68', () => {
    const g = fieldGeometry('full', 'horizontal');
    expect(g.rect.w / g.rect.h).toBeCloseTo(105 / 68, 4);
    expect(g.vertical).toBe(false);
    expect(g.vbW).toBe(100);
    expect(g.vbH).toBe(80);
  });

  it('campo completo vertical: viewBox invertido y rotación activa', () => {
    const g = fieldGeometry('full', 'vertical');
    expect(g.vertical).toBe(true);
    expect(g.vbW).toBe(80);
    expect(g.vbH).toBe(100);
  });

  it('medio campo horizontal: rect 52,5×68 (NO estirado a 105×68)', () => {
    const g = fieldGeometry('half', 'horizontal');
    expect(g.rect.w / g.rect.h).toBeCloseTo(52.5 / 68, 4);
    expect(g.vertical).toBe(false);
  });

  it('medio campo vertical: ejes intercambiados (bbox renderizado 68×52,5)', () => {
    const g = fieldGeometry('half', 'vertical');
    expect(g.vertical).toBe(true);
    // Al rotar el contenido (largo → Y), el bbox renderizado es ancho×alto = 68×52,5.
    expect(g.rect.h / g.rect.w).toBeCloseTo(68 / 52.5, 4);
  });

  it('campo completo vs medio campo: el ancho se conserva y el largo se reduce a la mitad', () => {
    const fullH = fieldGeometry('full', 'horizontal').rect;
    const halfH = fieldGeometry('half', 'horizontal').rect;
    expect(halfH.h).toBeCloseTo(fullH.h, 5); // mismo ancho (68 m)
    expect(halfH.w).toBeCloseTo(fullH.w / 2, 5); // longitud a la mitad (52,5 m)
  });

  it('f7 usa el medio campo F11 APISAADO (68 en X, 52,5 en Y), no la proporción vertical antigua', () => {
    // Antes el F7 reutilizaba halfGeom (52,5→X, 68→Y = vertical), lo que contradecía la
    // referencia del dueño (medio campo F11 apaisado: portería WU arriba, porterías F7 a
    // izquierda/derecha). Ahora el F7 tiene geometría propia apaisada (68→X, 52,5→Y).
    const g = fieldGeometry('f7', 'horizontal');
    expect(g.rect.w / g.rect.h).toBeCloseTo(68 / 52.5, 4);
    expect(g.vertical).toBe(false);
    // La superficie física sigue siendo el medio campo (52,5×68): solo cambia el dibujo.
    expect(fieldDimensions('f7')).toEqual({ len: 52.5, wid: 68 });
  });

  it('blank conserva el rect del campo completo', () => {
    expect(fieldGeometry('blank', 'horizontal').rect.w).toBeCloseTo(92, 5);
  });

  it('las dimensiones físicas se reportan por tipo', () => {
    expect(fieldDimensions('half')).toEqual({ len: 52.5, wid: 68 });
    expect(fieldDimensions('full')).toEqual({ len: 105, wid: 68 });
    expect(fieldDimensions('third')).toEqual({ len: 35, wid: 68 });
  });

  it('FASE 2 (materiales): escala por campo con la NUEVA política (compensación × factor aparente)', () => {
    // CAMBIO DE CONTRATO INTENCIONADO (encargo de materiales, FASE 2): antes estos números eran la
    // compensación geométrica pura (`len/105`), que hacía que los objetos se vieran PRÁCTICAMENTE
    // IGUALES en todos los campos. El dueño pidió lo contrario: en los campos más cortos deben verse
    // ALGO MAYORES. El factor aparente se calibró MIDIENDO píxeles en
    // `e2e/fase-materiales-escala.spec.ts`; la política final es: campo completo 100 %, medio 120 %,
    // tercio 128 %, fútbol sala 118 %, F7 118 % y lienzo 100 % (documentado).
    expect(fieldObjectScale('full', 'horizontal')).toBe(1);
    expect(fieldObjectScale('full', 'vertical')).toBe(1);
    // La compensación geométrica sigue ahí (0,5 en medio campo) MULTIPLICADA por el factor aparente.
    expect(fieldObjectScale('half', 'horizontal')).toBeCloseTo(0.5 * 1.62, 5);
    expect(fieldObjectScale('vertical_half', 'vertical')).toBeCloseTo(0.5 * 1.62, 5);
    expect(fieldObjectScale('f7', 'horizontal')).toBeCloseTo(0.5 * 1.99, 5);
    expect(fieldObjectScale('third', 'horizontal')).toBeCloseTo((35 / 105) * 1.99, 5);
    // LIENZO = campo completo (encargo del dueño, 23/09/2026). Aquí hubo 1,25, que inflaba un 25 %
    // todo lo que se colocara en un lienzo: lo avisó un colaborador («los jugadores muy gordos») y el
    // comentario de la tabla ya decía que el objetivo era 1,00. Se comprueba contra el campo completo
    // en vez de contra un número suelto, que es la propiedad que se pidió.
    expect(fieldObjectScale('blank', 'horizontal')).toBeCloseTo(
      fieldObjectScale('full', 'horizontal'),
      5,
    );
    expect(fieldObjectScale('blank', 'vertical')).toBeCloseTo(
      fieldObjectScale('full', 'vertical'),
      5,
    );
    // Los campos RETIRADOS de la oferta conservan la apariencia de los documentos históricos.
    expect(fieldObjectScale('two_halves', 'horizontal')).toBeCloseTo(1, 5);
    expect(fieldObjectScale('box', 'horizontal')).toBeCloseTo(22 / 105, 5);
  });
});

describe('fútbol sala (40×20) — geometría propia y marcas reglamentarias', () => {
  it('futsal horizontal: rect con proporción 2:1 (40×20) y dimensiones físicas reales', () => {
    const g = fieldGeometry('futsal', 'horizontal');
    expect(g.rect.w / g.rect.h).toBeCloseTo(40 / 20, 4); // 2:1
    expect(g.vertical).toBe(false);
    expect(fieldDimensions('futsal')).toEqual({ len: 40, wid: 20 });
  });

  it('futsal: escala con la política nueva (compensación 40/105 × 1,66), igual en ambas orientaciones', () => {
    // CAMBIO DE CONTRATO INTENCIONADO (encargo de materiales, FASE 2): el fútbol sala debe verse un
    // 10-25 % MAYOR que el campo completo, no igual (factor aparente medido: 1,18).
    expect(fieldObjectScale('futsal', 'horizontal')).toBeCloseTo((40 / 105) * 1.66, 5);
    expect(fieldObjectScale('futsal', 'vertical')).toBeCloseTo((40 / 105) * 1.66, 5);
  });

  it('futsal: el círculo central es de 3 m (no los 9,15 m del fútbol once)', () => {
    const g = fieldGeometry('futsal', 'horizontal');
    const svg = fieldSvg('futsal', g.rect, 'horizontal');
    const m = /<ellipse cx="[^"]+" cy="[^"]+" rx="([\d.]+)" ry="([\d.]+)"/.exec(svg);
    expect(m, 'hay un círculo central').not.toBeNull();
    const rx = parseFloat(m![1]);
    expect(rx).toBeCloseTo(3 * (92 / 105), 2); // 3 m → ~2,63 px (muy inferior a 9,15 m)
  });

  it('futsal: el área de penalti es una D (arcos de 6 m desde los postes + tramo), NO un rectángulo 6×20', () => {
    const g = fieldGeometry('futsal', 'horizontal');
    const svg = fieldSvg('futsal', g.rect, 'horizontal');
    // Debe haber arcos (paths con A): 2 por área en D × 2 lados = 4, más los de esquina.
    const arcs = svg.match(/<path[^>]*d="M [^"]* A [^"]*" fill="none" stroke="#ffffff"/g) ?? [];
    expect(
      arcs.length,
      'arcos del área en D + esquinas (no un rectángulo a todo el ancho)',
    ).toBeGreaterThanOrEqual(4);
  });

  // El test anterior solo CONTABA arcos, y por eso pasó por alto que dos de los cuatro arcos del
  // área de fútbol sala giran al revés (reportado por el dueño: «el área no se ve como una D, dos
  // curvas de las cuatro están puestas en mala dirección»). Este comprueba el SENTIDO de verdad:
  // calcula el punto medio de cada arco con la conversión de la especificación SVG y exige que
  // caiga DENTRO del campo y a 6 m de su poste. Con el sentido invertido el arco recorre los 270°
  // que pasan por detrás de la línea de portería, y su punto medio cae fuera del campo.
  it('futsal: los 4 arcos del área giran hacia el interior (una D, no dos curvas al revés)', () => {
    const g = fieldGeometry('futsal', 'horizontal');
    const svg = fieldSvg('futsal', g.rect, 'horizontal');
    const pxX = g.rect.w / 40; // px de viewBox por metro de largo
    const pxY = g.rect.h / 20; // px de viewBox por metro de ancho
    const aMetros = (x: number, y: number) => ({
      x: (x - g.rect.x) / pxX,
      y: (y - g.rect.y) / pxY,
    });
    const arcos = arcosDeFutsal(svg, pxX, pxY);
    expect(arcos, 'dos arcos de 6 m por área × dos áreas').toHaveLength(4);
    // Los CUATRO postes del campo (reglamento): a 1,5 m del centro del ancho, en las dos
    // líneas de portería. (Comparar solo con los dos de una portería daba falsos fallos en los
    // arcos de la otra.)
    const postes: Array<[number, number]> = [
      [0, 8.5],
      [0, 11.5],
      [40, 8.5],
      [40, 11.5],
    ];
    for (const a of arcos) {
      const medio = aMetros(...puntoMedioArcoSvg(a));
      expect(
        medio.x,
        `el arco no sale por detrás de la portería (x=${medio.x.toFixed(2)} m)`,
      ).toBeGreaterThan(0);
      expect(
        medio.x,
        `el arco no se pasa del centro del campo (x=${medio.x.toFixed(2)} m)`,
      ).toBeLessThan(40);
      expect(medio.y, `dentro del ancho (y=${medio.y.toFixed(2)} m)`).toBeGreaterThan(0);
      expect(medio.y, `dentro del ancho (y=${medio.y.toFixed(2)} m)`).toBeLessThan(20);
      const dPoste = Math.min(...postes.map(([px, py]) => Math.hypot(medio.x - px, medio.y - py)));
      expect(
        dPoste,
        `el punto medio del arco está a 6 m de su poste (medio=${medio.x.toFixed(2)},${medio.y.toFixed(2)} arco=${JSON.stringify(a)})`,
      ).toBeCloseTo(6, 0);
    }
  });

  it('futsal: los arcos giran en sentidos OPUESTOS por poste, y en vertical se invierten (transposición de ejes)', () => {
    const h = fieldGeometry('futsal', 'horizontal');
    const v = fieldGeometry('futsal', 'vertical');
    // Los arcos del ÁREA son los de radio grande; las esquinas son de 0,25 m (0,22 unidades).
    const sweeps = (svg: string) =>
      [
        ...svg.matchAll(
          /<path[^>]*d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)"/g,
        ),
      ]
        .filter((m) => Math.min(+m[3], +m[4]) > 1)
        .map((m) => +m[5])
        .sort();
    const sh = sweeps(fieldSvg('futsal', h.rect, 'horizontal'));
    const sv = sweeps(fieldSvg('futsal', v.rect, 'vertical'));
    // Dos arcos de cada sentido: uno por poste. Con un `sweep` compartido saldrían [0,0,0,0] o
    // [1,1,1,1] y el área no se vería como una D (fallo reportado por el dueño).
    expect(sh, 'dos arcos giran en cada sentido').toEqual([0, 0, 1, 1]);
    // `at()` en vertical TRANSPONE los ejes (l→Y, w→X, sin negar), y una transposición invierte el
    // sentido de giro: los cuatro arcos van al revés que en horizontal.
    expect(sv, 'en vertical los cuatro arcos se invierten').toEqual(sh.map((s) => 1 - s).sort());
  });

  it('futsal: punto de penalti a 6 m y segundo punto a 10 m', () => {
    const g = fieldGeometry('futsal', 'horizontal');
    const svg = fieldSvg('futsal', g.rect, 'horizontal');
    // Hay al menos 4 <circle> de fondo blanco (2 puntos × 2 lados) — los puntos de penalti.
    const spots = (svg.match(/<circle[^>]*fill="#ffffff"/g) ?? []).length;
    expect(spots, 'puntos de penalti (6 m y 10 m) por ambos lados').toBeGreaterThanOrEqual(4);
  });

  it('futsal: arcos de esquina de 0,25 m (no 1,2 m del fútbol once)', () => {
    const g = fieldGeometry('futsal', 'horizontal');
    const svg = fieldSvg('futsal', g.rect, 'horizontal');
    // Los arcos se escriben como "A rx ry" dentro de un <path> (no como atributo rx="").
    const m = /A ([\d.]+) ([\d.]+)/g;
    let found = false;
    let mm: RegExpExecArray | null;
    while ((mm = m.exec(svg))) {
      const rx = parseFloat(mm[1]);
      // Radio de esquina 0,25 m → ~0,22 px (0,25/40*35,05). Los arcos del área en D son
      // de 6 m (≈5,26 px). Un radio < 0,5 px corresponde al arco de esquina de futsal.
      if (rx > 0 && rx < 0.5) {
        found = true;
        break;
      }
    }
    expect(found, 'hay un arco de esquina con radio de 0,25 m').toBe(true);
  });
});

describe('tercio de campo (35×68) — recorte medido del F11', () => {
  it('tercio horizontal: rect con proporción 35×68 y dimensiones físicas reales', () => {
    const g = fieldGeometry('third', 'horizontal');
    expect(g.rect.w / g.rect.h).toBeCloseTo(35 / 68, 4);
    expect(g.vertical).toBe(false);
    expect(fieldDimensions('third')).toEqual({ len: 35, wid: 68 });
  });

  it('tercio: escala con la política nueva (compensación 35/105 × 1,99), igual en ambas orientaciones', () => {
    // CAMBIO DE CONTRATO INTENCIONADO (encargo de materiales, FASE 2): en el tercio los objetos
    // deben verse un 20-35 % mayores que en campo completo (factor aparente medido: 1,28).
    expect(fieldObjectScale('third', 'horizontal')).toBeCloseTo((35 / 105) * 1.99, 5);
    expect(fieldObjectScale('third', 'vertical')).toBeCloseTo((35 / 105) * 1.99, 5);
  });

  it('tercio: dibuja portería, área pequeña, área penal y arco (marcas del extremo del F11)', () => {
    const g = fieldGeometry('third', 'horizontal');
    const svg = fieldSvg('third', g.rect, 'horizontal');
    expect(svg).toContain('rgba(255,255,255,0.25)'); // portería translúcida
    expect(svg).toContain('stroke="#ffffff"');
    // Contiene un arco (penalti/centro) y no un círculo central completo de 9,15 m.
    expect(svg).toMatch(/<path[^>]*d="M [^"]* A [^"]*"/);
    expect(svg).not.toContain('<ellipse'); // sin círculo central (recorte no llega al centro)
  });
});

describe('área/box (22×44) — recorte con portería, áreas y arco', () => {
  it('box horizontal: rect con proporción 22×44 (incluye área penal + arco)', () => {
    const g = fieldGeometry('box', 'horizontal');
    expect(g.rect.w / g.rect.h).toBeCloseTo(22 / 44, 4);
    expect(g.vertical).toBe(false);
    expect(fieldDimensions('box')).toEqual({ len: 22, wid: 44 });
  });

  it('box: escala visual 22/105, igual en ambas orientaciones', () => {
    expect(fieldObjectScale('box', 'horizontal')).toBeCloseTo(22 / 105, 5);
    expect(fieldObjectScale('box', 'vertical')).toBeCloseTo(22 / 105, 5);
  });

  it('box: dibuja portería, área pequeña, área penal y arco de penalti (width-aware)', () => {
    const g = fieldGeometry('box', 'horizontal');
    const svg = fieldSvg('box', g.rect, 'horizontal');
    expect(svg).toContain('rgba(255,255,255,0.25)'); // portería
    expect(svg).toMatch(/<path[^>]*d="M [^"]* A [^"]*"/); // arco de penalti
    expect(svg).not.toContain('<ellipse'); // sin círculo central
  });
});

describe('field — marcas del medio campo derivadas de las proporciones 52,5×68', () => {
  it('medio campo horizontal en su rect real: área grande 16,5 de largo × 40,32 de ancho', () => {
    const Hr = fieldGeometry('half', 'horizontal').rect; // {4,4,46,59.58}
    const svg = fieldSvg('half', Hr, 'horizontal');
    const big = rects(svg).find((r) => {
      const depth = Math.abs(r.w - (16.5 / 52.5) * Hr.w) < 0.05;
      const width = Math.abs(r.h - (40.32 / 68) * Hr.h) < 0.05;
      return depth && width;
    });
    expect(big).toBeDefined();
    // El área grande está en la portería (l=0 → borde izquierdo del rect).
    expect(big!.x).toBeCloseTo(Hr.x, 2);
  });

  it('medio campo horizontal: área pequeña 5,5 de largo × 18,32 de ancho', () => {
    const Hr = fieldGeometry('half', 'horizontal').rect;
    const svg = fieldSvg('half', Hr, 'horizontal');
    const small = rects(svg).find((r) => {
      const depth = Math.abs(r.w - (5.5 / 52.5) * Hr.w) < 0.05;
      const width = Math.abs(r.h - (18.32 / 68) * Hr.h) < 0.05;
      return depth && width;
    });
    expect(small).toBeDefined();
    expect(small!.x).toBeCloseTo(Hr.x, 2);
  });

  it('medio campo: punto de penalti a 11 m y portería de 7,32 m', () => {
    const Hr = fieldGeometry('half', 'horizontal').rect;
    const svg = fieldSvg('half', Hr, 'horizontal');
    // Punto de penalti a 11/52,5 del largo desde la línea de fondo.
    const pen = circles(svg).find((c) => Math.abs(c.x - (Hr.x + (11 / 52.5) * Hr.w)) < 0.05);
    expect(pen).toBeDefined();
    // Portería: rect con relleno translúcido de 7,32 m de ancho (en el largo, l=-2..0).
    const goal = goals(svg).find((r) => Math.abs(r.h - (7.32 / 68) * Hr.h) < 0.05);
    expect(goal).toBeDefined();
  });

  it('medio campo vertical: semicírculo central de radio 9,15 m en la línea de medio campo (abajo)', () => {
    const Hr = fieldGeometry('half', 'vertical').rect;
    const svg = fieldSvg('half', Hr, 'vertical');
    // La línea de medio campo está en l=1 → abajo (portería arriba). El semicírculo
    // es un arco que parte del borde inferior del rect (y = Hr.y + Hr.h) y abre hacia el interior.
    const arcs = [...svg.matchAll(/<path d="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((d) => d.includes('A'));
    const half = arcs.find((d) => {
      const m = d.match(/^M [-\d.]+ ([-\d.]+)/);
      return m && Math.abs(Number(m[1]) - (Hr.y + Hr.h)) < 0.05;
    });
    expect(half).toBeDefined();
  });
});

describe('orientationLabel (decisión de usabilidad: etiquetas por resultado)', () => {
  it('campo completo/f7: porterías a los lados / arriba y abajo', () => {
    expect(orientationLabel('full', 'horizontal')).toBe('Porterías izquierda y derecha');
    expect(orientationLabel('full', 'vertical')).toBe('Porterías arriba y abajo');
    expect(orientationLabel('f7', 'horizontal')).toBe('Porterías izquierda y derecha');
    expect(orientationLabel('f7', 'vertical')).toBe('Porterías arriba y abajo');
  });

  it('medio campo: portería arriba (vertical) / izquierda (horizontal)', () => {
    expect(orientationLabel('half', 'vertical')).toBe('Portería arriba');
    expect(orientationLabel('half', 'horizontal')).toBe('Portería izquierda');
    expect(orientationLabel('vertical_half', 'horizontal')).toBe('Portería izquierda');
  });

  it('lienzo: apaisado / vertical', () => {
    expect(orientationLabel('blank', 'horizontal')).toBe('Apaisado');
    expect(orientationLabel('blank', 'vertical')).toBe('Vertical');
  });
});

// =============================================================
// FASE 7 — arcos de esquina (semántica). Los arcos de esquina (radio
// 1,2 m) viven SOLO en el campo completo (field.ts cornerArcs, usado
// por fullField): 4 arcos, uno por esquina reglamentaria, anclados a la
// esquina, abriendo hacia el interior, radio uniforme 1,2 m, grosor
// compartido FIELD_LINE_WIDTH, sin duplicados ni arcos en bordes que no
// son esquina. En 'half'/'blank'/'f7' NO hay arcos de esquina.
// =============================================================
describe('field — arcos de esquina (FASE 7)', () => {
  // Extrae los <path> de arco de esquina. El arco de esquina tiene radio 1,2 m (rx EJE-l
  // y ry EJE-w escalados al rect); se distingue del arco de penalti (radio 9,15 m, mucho
  // mayor) filtrando por el radio EJE-L del rect del campo. `cornerRx` es ese radio (px).
  function cornerArcs(
    svg: string,
    cornerRx: number,
  ): Array<{
    d: string;
    x1: number;
    y1: number;
    rx: number;
    ry: number;
    sweep: number;
    x2: number;
    y2: number;
  }> {
    const out: Array<{
      d: string;
      x1: number;
      y1: number;
      rx: number;
      ry: number;
      sweep: number;
      x2: number;
      y2: number;
    }> = [];
    const re =
      /<path[^>]*d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)" fill="none" stroke="#ffffff" stroke-width="0\.3" \/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) {
      const rx = +m[3];
      const ry = +m[4];
      // El radio EJE-l del arco de esquina es `rw` en vertical y `rl` en horizontal; en
      // ambos, el MENOR de rx/ry corresponde al eje de anchura (wf) y es mucho menor que
      // el arco de penalti. Aceptamos arcos cuyo radio menor esté cerca del esperado.
      const minR = Math.min(rx, ry);
      if (Math.abs(minR - cornerRx) > cornerRx * 0.05) continue;
      out.push({ d: m[0], x1: +m[1], y1: +m[2], rx, ry, sweep: +m[5], x2: +m[6], y2: +m[7] });
    }
    return out;
  }

  // Radio (px) del arco de esquina: el eje de ANCHURA (1,2 m / 68 m) escalado al eje de
  // anchura del rect (Y en horizontal, X en vertical). Es el menor de rx/ry en el path.
  function cornerRxFor(r: Box, o: 'horizontal' | 'vertical'): number {
    const wDim = o === 'vertical' ? r.w : r.h;
    return (1.2 / 68) * wDim;
  }

  it('campo completo horizontal: exactamente 4 arcos de esquina, anclados a las esquinas y sin duplicados', () => {
    const svg = fieldSvg('full', H, 'horizontal');
    const arcs = cornerArcs(svg, cornerRxFor(H, 'horizontal'));
    expect(arcs, 'el campo completo tiene 4 arcos de esquina').toHaveLength(4);
    const radial = Math.hypot(arcs[0].rx, arcs[0].ry);
    for (const a of arcs) {
      // Anclado a una esquina: su extremo 1 o 2 está a distancia radial de una esquina del rect.
      const corners = [
        [H.x, H.y],
        [H.x + H.w, H.y],
        [H.x, H.y + H.h],
        [H.x + H.w, H.y + H.h],
      ];
      const nearCorner = corners.some(
        ([cx, cy]) =>
          Math.hypot(a.x1 - cx, a.y1 - cy) < radial * 1.05 ||
          Math.hypot(a.x2 - cx, a.y2 - cy) < radial * 1.05,
      );
      expect(nearCorner, 'el arco arranca cerca de una esquina reglamentaria').toBe(true);
      // Radio uniforme (misma elipse radial para los 4).
      expect(Math.hypot(a.rx, a.ry)).toBeCloseTo(radial, 10);
    }
    // Sin duplicados.
    const unique = new Set(arcs.map((a) => a.d));
    expect(unique.size, 'no hay arcos de esquina duplicados').toBe(4);
    // Todos con el grosor compartido (0.3) y stroke blanco.
    for (const a of arcs) {
      expect(a.d).toContain(`stroke-width="${FIELD_LINE_WIDTH}"`);
      expect(a.d).not.toContain('stroke-width="1"');
    }
  });

  it('campo completo vertical: 4 arcos de esquina; el radio intercambia rx/ry pero sigue siendo 1,2 m', () => {
    const svg = fieldSvg('full', V, 'vertical');
    const arcs = cornerArcs(svg, cornerRxFor(V, 'vertical'));
    expect(arcs, 'el campo completo vertical tiene 4 arcos de esquina').toHaveLength(4);
    // rx/ry se intercambian respecto a horizontal (largo pasa a Y), pero la suma radial
    // de la elipse (en píxeles del rect) debe ser coherente.
    const radV = Math.hypot(arcs[0].rx, arcs[0].ry);
    const radH = Math.hypot(
      cornerArcs(fieldSvg('full', H, 'horizontal'), cornerRxFor(H, 'horizontal'))[0].rx,
      cornerArcs(fieldSvg('full', H, 'horizontal'), cornerRxFor(H, 'horizontal'))[0].ry,
    );
    expect(radV).toBeCloseTo(radH, 6);
    const unique = new Set(arcs.map((a) => a.d));
    expect(unique.size, 'sin duplicados en vertical').toBe(4);
  });

  it('campo completo: los 4 arcos de esquina abren HACIA EL INTERIOR (no sobresalen del campo)', () => {
    const svg = fieldSvg('full', H, 'horizontal');
    const arcs = cornerArcs(svg, cornerRxFor(H, 'horizontal'));
    expect(arcs).toHaveLength(4);
    // El punto medio del arco (aprox.) debe caer DENTRO del rect del campo.
    for (const a of arcs) {
      const mx = (a.x1 + a.x2) / 2;
      const my = (a.y1 + a.y2) / 2;
      expect(mx).toBeGreaterThanOrEqual(H.x - 0.001);
      expect(mx).toBeLessThanOrEqual(H.x + H.w + 0.001);
      expect(my).toBeGreaterThanOrEqual(H.y - 0.001);
      expect(my).toBeLessThanOrEqual(H.y + H.h + 0.001);
    }
  });

  it('campo completo: ningún arco de esquina adicional en bordes que NO son esquina', () => {
    const svg = fieldSvg('full', H, 'horizontal');
    const arcs = cornerArcs(svg, cornerRxFor(H, 'horizontal'));
    expect(arcs).toHaveLength(4);
    // Cada arco debe estar a distancia <= radial de una esquina (no a mitad de borde).
    const radial = Math.hypot(arcs[0].rx, arcs[0].ry);
    const corners = [
      [H.x, H.y],
      [H.x + H.w, H.y],
      [H.x, H.y + H.h],
      [H.x + H.w, H.y + H.h],
    ];
    for (const a of arcs) {
      // La distancia desde un extremo a la esquina MÁS CERCANA debe ser ~radial.
      const d1 = Math.min(...corners.map(([cx, cy]) => Math.hypot(a.x1 - cx, a.y1 - cy)));
      const d2 = Math.min(...corners.map(([cx, cy]) => Math.hypot(a.x2 - cx, a.y2 - cy)));
      expect(d1, 'extremo del arco cerca de una esquina').toBeLessThan(radial * 1.2);
      expect(d2, 'otro extremo cerca de una esquina').toBeLessThan(radial * 1.2);
    }
  });

  // CORRECCIÓN (petición del dueño: «hay quesitos de corners en algún campo mal puestos»):
  // esta prueba exigía 4 arcos en el MEDIO campo, y estaba MAL: en el extremo de la línea de
  // medio campo el campo continúa, así que no hay córner que dibujar. Ahora el medio campo
  // lleva arcos SOLO en sus dos esquinas de la línea de portería (l=0), y el extremo opuesto
  // queda sin arcos a propósito.
  it('medio campo (half): arcos SOLO en las dos esquinas de la línea de portería; lienzo y F7 aparte', () => {
    const svg = fieldSvg('half', H, 'horizontal');
    const arcs = cornerArcs(svg, cornerRxFor(H, 'horizontal'));
    expect(arcs, 'el medio campo tiene 2 arcos (los de la línea de portería)').toHaveLength(2);
    const radial = Math.hypot(arcs[0].rx, arcs[0].ry);
    // Las dos esquinas de la línea de PORTERÍA están en l=0, es decir x = H.x (el medio campo
    // se dibuja con la portería a la izquierda y la línea de medio campo a la derecha).
    const cornersPorteria = [
      [H.x, H.y],
      [H.x, H.y + H.h],
    ];
    for (const a of arcs) {
      const enPorteria = cornersPorteria.some(
        ([cx, cy]) =>
          Math.hypot(a.x1 - cx, a.y1 - cy) < radial * 1.05 ||
          Math.hypot(a.x2 - cx, a.y2 - cy) < radial * 1.05,
      );
      expect(enPorteria, 'cada arco del medio campo está en una esquina de la portería').toBe(true);
    }
    // Y NO hay ningún arco anclado a la línea de medio campo (x = H.x + H.w): ahí el campo
    // continúa y no hay esquina.
    const xMedio = H.x + H.w;
    const enMedioCampo = arcs.filter(
      (a) => Math.min(Math.abs(a.x1 - xMedio), Math.abs(a.x2 - xMedio)) < radial * 1.05,
    );
    expect(enMedioCampo, 'no hay quesitos en la línea de medio campo').toHaveLength(0);
    // El TERCIO es otro recorte: también lleva sus dos arcos de la línea de portería.
    expect(
      cornerArcs(fieldSvg('third', H, 'horizontal'), (1.2 / 68) * H.h),
      'el tercio tiene sus 2 arcos de la línea de portería',
    ).toHaveLength(2);
    // Lienzo sin arcos; el F7 SÍ tiene sus 4 arcos de esquina propios (FASE 8b: antes se
    // asumía que no los tenía, pero la plantilla F7 los requiere). Los arcos del F7 son
    // del color de contraste del F7 (F7_LINE_COLOR), no blancos, por lo que el helper de
    // arcos blancos (`cornerArcs`) no los cuenta: se comprueban con su propio patrón.
    expect(
      cornerArcs(fieldSvg('blank', H, 'horizontal'), cornerRxFor(H, 'horizontal')),
      'lienzo sin arcos',
    ).toHaveLength(0);
    const f7Svg = fieldSvg('f7', H, 'horizontal');
    const f7Arcs =
      f7Svg.match(
        /<path[^>]*d="M [^"]* A [^"]*" fill="none" stroke="#38bdf8" stroke-width="0\.3" \/>/g,
      ) ?? [];
    expect(f7Arcs.length, 'el F7 tiene sus 4 arcos de esquina propios (FASE 8b)').toBe(4);
  });

  it('Dos medios campos: exactamente 4 arcos, uno por esquina REAL (antes solo en una mitad)', () => {
    const svg = fieldSvg('two_halves', H, 'horizontal');
    const arcs = cornerArcs(svg, cornerRxFor(H, 'horizontal'));
    expect(arcs, 'las 4 esquinas reales del campo tienen su arco').toHaveLength(4);
    // Dos en cada mitad, y ninguno en la arista central (donde se juntan las dos mitades).
    const mitad = H.w / 2;
    const enCentral = arcs.filter((a) => {
      const xs = [a.x1, a.x2];
      return xs.some((x) => Math.abs(x - (H.x + mitad)) < 0.01);
    });
    expect(enCentral, 'ningún arco en la arista central').toHaveLength(0);
  });

  it('campo completo horizontal: los 4 arcos son cuartos de circunferencia finos con extremos en fondo y banda, sin relleno', () => {
    const svg = fieldSvg('full', H, 'horizontal');
    const arcs = cornerArcs(svg, cornerRxFor(H, 'horizontal'));
    expect(arcs, '4 arcos de esquina').toHaveLength(4);
    for (const a of arcs) {
      // Sin relleno (solo contorno) y stroke fino compartido.
      expect(a.d).toContain('fill="none"');
      expect(a.d).toContain(`stroke-width="${FIELD_LINE_WIDTH}"`);
      // Cada extremo cae sobre UN borde del campo (distancia ~0 en fondo o banda).
      const onEdgeX =
        Math.abs(a.x1 - H.x) < 0.6 ||
        Math.abs(a.x1 - (H.x + H.w)) < 0.6 ||
        Math.abs(a.x2 - H.x) < 0.6 ||
        Math.abs(a.x2 - (H.x + H.w)) < 0.6;
      const onEdgeY =
        Math.abs(a.y1 - H.y) < 0.6 ||
        Math.abs(a.y1 - (H.y + H.h)) < 0.6 ||
        Math.abs(a.y2 - H.y) < 0.6 ||
        Math.abs(a.y2 - (H.y + H.h)) < 0.6;
      expect(onEdgeX, 'un extremo sobre una línea de fondo/banda vertical').toBe(true);
      expect(onEdgeY, 'el otro extremo sobre una línea de fondo/banda horizontal').toBe(true);
    }
    // Sentido (sweep) correcto: los arcos de la MITAD SUPERIOR (y=borde.top) y los de la
    // MITAD INFERIOR no deben quedar invertidos → cada arco abre HACIA EL CENTRO del campo.
    // Verifica que el punto medio del arco cae DENTRO del rect (ya cubierto) y que el sweep
    // de los dos arcos superiores difiere del de los dos inferiores (apertura simétrica).
    const topSweep = arcs.filter((a) => Math.min(a.y1, a.y2) < H.y + H.h / 2).map((a) => a.sweep);
    const bottomSweep = arcs
      .filter((a) => Math.max(a.y1, a.y2) > H.y + H.h / 2)
      .map((a) => a.sweep);
    expect(topSweep.length, '2 arcos superiores').toBe(2);
    expect(bottomSweep.length, '2 arcos inferiores').toBe(2);
    // Arriba y abajo usan sweep OPUESTOS (si no, un arco sobresaldría hacia fuera).
    expect(topSweep[0]).not.toBe(bottomSweep[0]);
    expect(topSweep[1]).not.toBe(bottomSweep[1]);
  });

  it('FASE 4: el F7 es el medio campo F11 APISAADO (68 en X, 52,5 en Y) y sus bandas coinciden con las del medio campo', () => {
    const g = fieldGeometry('f7', 'horizontal');
    // Rect apaisado: 68 m en X (~59,58) × 52,5 m en Y (~46). Antes usaba 46 de ancho (vertical).
    expect(g.rect.w).toBeCloseTo(68 * (92 / 105), 4); // no es el 92 del campo completo
    const svg = fieldSvg('f7', g.rect, 'horizontal');
    // Además del contorno blanco del medio campo, el F7 transversal dibuja su rect
    // en color de contraste cruzando TODO el ancho (68 m) del medio campo apaisado.
    const f7Rect =
      /<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*stroke="#38bdf8"/.exec(
        svg,
      );
    expect(f7Rect, 'el F7 transversal dibuja su rect en color de contraste').not.toBeNull();
    expect(
      parseFloat(f7Rect![3]),
      'el F7 cruza todo el ancho (68 m) del medio campo apaisado',
    ).toBeCloseTo(68 * (92 / 105), 4);
  });

  it('AUDITORÍA: la galería ofrece los SEIS campos base sin duplicar el medio campo', () => {
    // CORRECCIÓN URGENTE (dueño): la galería se queda con seis tarjetas. «Área y portería» (`box`)
    // y «Dos medios campos» (`two_halves`) DEJAN DE OFRECERSE (el dueño no los usa), pero siguen
    // admitidos y renderizándose para los ejercicios antiguos: eso se comprueba más abajo y en
    // `store.spec.ts` (respaldos) y en las pruebas de carga de documentos históricos.
    const required = ['full', 'half', 'third', 'futsal', 'f7', 'blank'];
    const types = FIELD_BASE_SPECS.map((s) => s.type);
    for (const r of required) expect(types, `falta ${r} en la galería`).toContain(r);
    expect(types, 'la galería tiene exactamente los seis campos pedidos').toEqual(required);
    // DECISIÓN DE PRODUCTO (auditoría final): `vertical_half` NO se ofrece como tarjeta
    // propia porque su SVG es EXACTAMENTE el de `half` con orientación vertical: eran dos
    // tarjetas para el mismo campo. Sigue ADMITIDO para documentos antiguos
    // (`models.FIELD_TYPES`) y el normalizador lo migra a `half` + orientación vertical.
    expect(types, 'la galería no duplica el medio campo').not.toContain('vertical_half');
    // Los campos retirados de la OFERTA tampoco aparecen como tarjeta.
    expect(types, 'ni «Área y portería»').not.toContain('box');
    expect(types, 'ni «Dos medios campos»').not.toContain('two_halves');
    // Y sigue pintándose igual que un medio campo (compatibilidad de render).
    expect(
      fieldSvg('vertical_half' as FieldType, H, 'vertical'),
      'el alias conserva su render',
    ).toBe(fieldSvg('half' as FieldType, H, 'vertical'));
    // Los campos VISUALMENTE distintos deben renderizarse cada uno con su propio dibujo real.
    // Se incluyen los RETIRADOS DE LA OFERTA: un ejercicio antiguo con `box` o `two_halves` tiene
    // que seguir dibujándose distinto (no en blanco, no como otro campo).
    const svg = (t: string) => fieldSvg(t as FieldType, H, 'horizontal');
    expect(
      new Set([
        svg('full'),
        svg('half'),
        svg('third'),
        svg('futsal'),
        svg('f7'),
        svg('box'),
        svg('two_halves'),
      ]).size,
      'los campos visualmente distintos se renderizan cada uno distinto',
    ).toBe(7);
    // 'blank' (lienzo) no dibuja ninguna marca.
    expect(svg('blank')).toBe('');
  });

  it('Bloque F #2 — "Dos medios campos" (two_halves) es un campo DIFFERENTE de "Encajar todo" (half)', () => {
    // Geometría física: two_halves ocupa el largo COMPLETO (105 m), half solo el medio campo (52,5 m).
    const gTwo = fieldGeometry('two_halves', 'horizontal');
    const gHalf = fieldGeometry('half', 'horizontal');
    expect(gTwo.lenM, 'two_halves es de 105 m (campo completo)').toBe(105);
    expect(gHalf.lenM, 'half es de 52,5 m (medio campo)').toBe(52.5);
    // Los rect de contenido son distintos (longitud del campo ≠ longitud del medio campo).
    expect(gTwo.rect.w, 'la anchura del rect difiere').not.toBe(gHalf.rect.w);
    // El SVG renderizado también es distinto (dos medios campos vs un medio campo).
    const svgTwo = fieldSvg('two_halves' as FieldType, H, 'horizontal');
    const svgHalf = fieldSvg('half' as FieldType, H, 'horizontal');
    expect(svgTwo, 'el render de two_halves no es idéntico al de half').not.toBe(svgHalf);
    // two_halves dibuja DOS porterías/áreas (una por medio campo) → más marcas que half.
    const count = (s: string, needle: string) => s.split(needle).length - 1;
    const marksTwo = count(svgTwo, 'rect');
    const marksHalf = count(svgHalf, 'rect');
    // Al menos dos mitades (el texto incluye dos porterías): no debe ser más simple que half.
    expect(marksTwo, 'two_halves dibuja las marcas de dos medios campos').toBeGreaterThan(
      marksHalf,
    );
  });
});

// Mismo fallo que el área de fútbol sala, pero en los quesitos de córner: el SENTIDO del arco se
// calculaba con una fórmula distinta para vertical que no corresponde a la transposición de ejes
// de `at()` (l→Y, w→X, sin negar), así que en vertical los arcos abrían hacia FUERA del campo.
// Este test mide el punto medio REAL de cada arco (conversión SVG) y exige que caiga dentro del
// rectángulo del campo, en todos los campos que tienen esquinas y en las dos orientaciones.
describe('field — los arcos de esquina abren hacia DENTRO del campo (medido)', () => {
  const camposConEsquinas: Array<[string, number]> = [
    ['full', 4],
    ['half', 2],
    ['third', 2],
    ['two_halves', 4],
  ];
  for (const [campo, cuantos] of camposConEsquinas) {
    for (const o of ['horizontal', 'vertical'] as const) {
      it(`${campo} · ${o}: ${cuantos} arcos, todos hacia dentro`, () => {
        const g = fieldGeometry(campo as never, o);
        const svg = fieldSvg(campo as never, g.rect, o);
        const arcos = [
          ...svg.matchAll(
            /<path class="entrenolab-corner"[^>]*d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)"/g,
          ),
        ].map((m) => ({
          x0: +m[1],
          y0: +m[2],
          rx: +m[3],
          ry: +m[4],
          sweep: +m[5],
          x1: +m[6],
          y1: +m[7],
        }));
        expect(arcos, `${campo} tiene ${cuantos} arcos de esquina`).toHaveLength(cuantos);
        for (const a of arcos) {
          const [mx, my] = puntoMedioArcoSvg(a);
          const desc = `arco=${JSON.stringify(a)}`;
          expect(mx, `abre hacia dentro (x=${mx.toFixed(2)}) ${desc}`).toBeGreaterThan(g.rect.x);
          expect(mx, `abre hacia dentro (x=${mx.toFixed(2)}) ${desc}`).toBeLessThan(
            g.rect.x + g.rect.w,
          );
          expect(my, `abre hacia dentro (y=${my.toFixed(2)}) ${desc}`).toBeGreaterThan(g.rect.y);
          expect(my, `abre hacia dentro (y=${my.toFixed(2)}) ${desc}`).toBeLessThan(
            g.rect.y + g.rect.h,
          );
        }
      });
    }
  }
});

/** Arcos del ÁREA de fútbol sala (radio 6 m) presentes en el SVG de un campo. */
function arcosDeFutsal(
  svg: string,
  pxX: number,
  pxY: number,
): Array<{
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  sweep: number;
  x1: number;
  y1: number;
}> {
  return [
    ...svg.matchAll(
      /<path[^>]*d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)"/g,
    ),
  ]
    .map((m) => ({
      x0: +m[1],
      y0: +m[2],
      rx: +m[3],
      ry: +m[4],
      sweep: +m[5],
      x1: +m[6],
      y1: +m[7],
    }))
    .filter((a) => Math.abs(a.rx - 6 * pxX) < 0.05 && Math.abs(a.ry - 6 * pxY) < 0.05);
}

/** Conversión de un arco SVG a centro y ángulos (especificación SVG; `fA = 0`: arcos de 90°). */
function conversionArcoSvg(a: {
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  sweep: number;
  x1: number;
  y1: number;
}): { cx: number; cy: number; rx: number; ry: number; t0: number; delta: number } {
  const fA = 0; // arcos de 90°: siempre el arco pequeño
  const dx2 = (a.x0 - a.x1) / 2;
  const dy2 = (a.y0 - a.y1) / 2;
  const lambda = (dx2 * dx2) / (a.rx * a.rx) + (dy2 * dy2) / (a.ry * a.ry);
  const k = lambda > 1 ? Math.sqrt(lambda) : 1;
  const rx = a.rx * k;
  const ry = a.ry * k;
  const num = rx * rx * ry * ry - rx * rx * dy2 * dy2 - ry * ry * dx2 * dx2;
  const den = rx * rx * dy2 * dy2 + ry * ry * dx2 * dx2;
  const coef = (fA !== a.sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * ((rx * dy2) / ry);
  const cyp = coef * (-(ry * dx2) / rx);
  const cx = cxp + (a.x0 + a.x1) / 2;
  const cy = cyp + (a.y0 + a.y1) / 2;
  const t0 = Math.atan2((dy2 - cyp) / ry, (dx2 - cxp) / rx);
  const t1 = Math.atan2((-dy2 - cyp) / ry, (-dx2 - cxp) / rx);
  let delta = t1 - t0;
  if (a.sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  if (a.sweep === 1 && delta < 0) delta += 2 * Math.PI;
  return { cx, cy, rx, ry, t0, delta };
}

/** Punto medio REAL de un arco SVG `M P0 A rx ry 0 0 sweep P1`. Es lo que permite comprobar el
 *  SENTIDO del arco: con el `sweep` invertido el arco recorre los 270° que pasan por detrás de la
 *  portería. */
function puntoMedioArcoSvg(a: {
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  sweep: number;
  x1: number;
  y1: number;
}): [number, number] {
  const c = conversionArcoSvg(a);
  const tm = c.t0 + c.delta / 2;
  return [c.cx + c.rx * Math.cos(tm), c.cy + c.ry * Math.sin(tm)];
}

/** CENTRO real del arco, en coordenadas del SVG. Es la medida que distingue un arco bien orientado
 *  de uno girado: el arco de esquina tiene su centro EN LA ESQUINA, y con el `sweep` invertido el
 *  centro se va al otro lado de la cuerda, a `(rx, ry)` de la esquina. */
function centroArcoSvg(a: {
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  sweep: number;
  x1: number;
  y1: number;
}): [number, number] {
  const c = conversionArcoSvg(a);
  return [c.cx, c.cy];
}

/** Las MISMAS coordenadas que usa el render: `at()` de field.ts (en vertical TRANSPONE los ejes,
 *  no niega: `[x + w·w, y + l·h]`). */
function puntoCampo(
  r: { x: number; y: number; w: number; h: number },
  o: 'horizontal' | 'vertical',
  l: number,
  w: number,
): [number, number] {
  return o === 'vertical' ? [r.x + w * r.w, r.y + l * r.h] : [r.x + l * r.w, r.y + w * r.h];
}

function arcosDeEsquina(svg: string): Array<{
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  sweep: number;
  x1: number;
  y1: number;
}> {
  return [
    ...svg.matchAll(
      /<path class="entrenolab-corner"[^>]*d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)"/g,
    ),
  ].map((m) => ({
    x0: +m[1],
    y0: +m[2],
    rx: +m[3],
    ry: +m[4],
    sweep: +m[5],
    x1: +m[6],
    y1: +m[7],
  }));
}

describe('field — el CENTRO del arco de esquina ES la esquina (medido, no supuesto)', () => {
  // El arco de córner es un cuarto de círculo con centro EN LA ESQUINA: si el `sweep` está
  // invertido, el arco sigue teniendo los mismos extremos y el mismo radio, pero su centro se va
  // al OTRO lado de la cuerda — a `(rx, ry)` de la esquina (≈1,5 unidades del viewBox) — y el arco
  // se ve «plano» y despegado del córner. Medir el punto medio no bastaba: seguía cayendo dentro
  // del campo. Por eso se mide el CENTRO.
  const CON_ESQUINAS: FieldType[] = ['full', 'two_halves', 'half', 'third'];

  for (const campo of CON_ESQUINAS) {
    for (const o of ['horizontal', 'vertical'] as const) {
      it(`${campo} · ${o}: cada arco tiene su centro en una esquina del rect`, () => {
        const g = fieldGeometry(campo, o);
        const arcos = arcosDeEsquina(fieldSvg(campo, g.rect, o));
        expect(arcos.length, `${campo} · ${o}: hay arcos de esquina`).toBeGreaterThan(0);
        // «Dos medios campos» NO se dibuja como un rect: se dibuja como DOS medios campos
        // (`twoHalvesField`), así que sus arcos se centran en las esquinas de esas dos mitades
        // —la izquierda en las de su línea de portería y la derecha en las suyas—. En el tablero,
        // que siempre dibuja el sistema canónico, eso deja los cuatro córners reales del rect (es
        // lo que comprueba `two_halves · horizontal`).
        const subRects =
          campo === 'two_halves'
            ? [
                { ...g.rect, w: g.rect.w / 2 },
                { x: g.rect.x + g.rect.w / 2, y: g.rect.y, w: g.rect.w / 2, h: g.rect.h },
              ]
            : [g.rect];
        const esquinas = subRects.flatMap((sub) =>
          [0, 1].flatMap((l) => [0, 1].map((w) => puntoCampo(sub, o, l, w))),
        );
        for (const a of arcos) {
          const [cx, cy] = centroArcoSvg(a);
          const distancia = Math.min(...esquinas.map(([ex, ey]) => Math.hypot(cx - ex, cy - ey)));
          expect(
            distancia,
            `centro (${cx.toFixed(2)}, ${cy.toFixed(2)}) de un arco de ${campo} · ${o} debe ser una esquina`,
          ).toBeLessThan(0.3);
        }
      });
    }
  }
  it('f7: los cuatro arcos de esquina tienen su centro en las esquinas del campo', () => {
    // El F7 dibuja sus córners con su propio color y SIN la clase `entrenolab-corner`, así que se
    // localizan por la forma del `path` (son los únicos arcos del SVG del F7).
    const g = fieldGeometry('f7', 'horizontal');
    const svg = fieldSvg('f7', g.rect, 'horizontal');
    const cajas = rects(svg);
    const arcos = [
      ...svg.matchAll(
        /<path d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)"/g,
      ),
    ].map((m) => ({
      x0: +m[1],
      y0: +m[2],
      rx: +m[3],
      ry: +m[4],
      sweep: +m[5],
      x1: +m[6],
      y1: +m[7],
    }));
    // El SVG del F7 trae 6 arcos: los 4 córners (radio pequeño, 1,2 m) y los 2 semicírculos del
    // área. Los córners son los del radio pequeño.
    const radio = Math.min(...arcos.map((a) => a.rx));
    const corners = arcos.filter((a) => Math.abs(a.rx - radio) < 0.01);
    expect(corners, 'el F7 tiene sus cuatro córners').toHaveLength(4);
    // El rect del CAMPO es el MENOR rect del SVG que contiene todos los extremos de los córners
    // (el otro candidato es la franja exterior de césped, que es mayor).
    const dentro = (
      b: { x: number; y: number; w: number; h: number },
      a: { x0: number; y0: number; x1: number; y1: number },
    ) =>
      [a.x0, a.x1].every((x) => x >= b.x - 1e-6 && x <= b.x + b.w + 1e-6) &&
      [a.y0, a.y1].every((y) => y >= b.y - 1e-6 && y <= b.y + b.h + 1e-6);
    const campo = cajas
      .filter((b) => corners.every((a) => dentro(b, a)))
      .sort((p, q) => p.w * p.h - q.w * q.h)[0];
    expect(campo, 'el rect del campo del F7').toBeTruthy();
    const esquinas = [
      [campo.x, campo.y],
      [campo.x + campo.w, campo.y],
      [campo.x, campo.y + campo.h],
      [campo.x + campo.w, campo.y + campo.h],
    ] as Array<[number, number]>;
    for (const a of corners) {
      const [cx, cy] = centroArcoSvg(a);
      const distancia = Math.min(...esquinas.map(([ex, ey]) => Math.hypot(cx - ex, cy - ey)));
      expect(
        distancia,
        `centro (${cx.toFixed(2)}, ${cy.toFixed(2)}) debe ser una esquina del F7`,
      ).toBeLessThan(0.3);
    }
  });
  it('fútbol sala: los cuatro arcos de esquina tienen su centro en las esquinas del campo', () => {
    // Los córners del futsal (0,25 m) se dibujan sin clase, así que se localizan por RADIO: son
    // los arcos más pequeños del SVG (los del área miden 6 m y el del penalti 9,15 m).
    const g = fieldGeometry('futsal', 'horizontal');
    const svg = fieldSvg('futsal', g.rect, 'horizontal');
    const cajas = rects(svg);
    const arcos = [
      ...svg.matchAll(
        /<path[^>]*d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)"/g,
      ),
    ].map((m) => ({
      x0: +m[1],
      y0: +m[2],
      rx: +m[3],
      ry: +m[4],
      sweep: +m[5],
      x1: +m[6],
      y1: +m[7],
    }));
    const radio = Math.min(...arcos.map((a) => a.rx));
    const corners = arcos.filter((a) => Math.abs(a.rx - radio) < 0.02);
    expect(corners, 'el futsal tiene sus cuatro córners').toHaveLength(4);
    const dentro = (
      b: { x: number; y: number; w: number; h: number },
      a: { x0: number; y0: number; x1: number; y1: number },
    ) =>
      [a.x0, a.x1].every((x) => x >= b.x - 1e-6 && x <= b.x + b.w + 1e-6) &&
      [a.y0, a.y1].every((y) => y >= b.y - 1e-6 && y <= b.y + b.h + 1e-6);
    const campo = cajas
      .filter((b) => corners.every((a) => dentro(b, a)))
      .sort((p, q) => p.w * p.h - q.w * q.h)[0];
    expect(campo, 'el rect del campo de futsal').toBeTruthy();
    const esquinas = [
      [campo.x, campo.y],
      [campo.x + campo.w, campo.y],
      [campo.x, campo.y + campo.h],
      [campo.x + campo.w, campo.y + campo.h],
    ] as Array<[number, number]>;
    for (const a of corners) {
      const [cx, cy] = centroArcoSvg(a);
      const distancia = Math.min(...esquinas.map(([ex, ey]) => Math.hypot(cx - ex, cy - ey)));
      expect(
        distancia,
        `centro (${cx.toFixed(2)}, ${cy.toFixed(2)}) debe ser una esquina del futsal`,
      ).toBeLessThan(0.3);
    }
  });
});

describe('field — la miniatura de la galería aplica la orientación UNA sola vez (como el tablero)', () => {
  const CAMPOS: FieldType[] = [
    'full',
    'half',
    'vertical_half',
    'third',
    'box',
    'futsal',
    'f7',
    'two_halves',
  ];

  it('vertical: dibuja el campo CANÓNICO y lo envuelve en rotate(90)', () => {
    for (const f of CAMPOS) {
      const geo = fieldGeometry(f, 'vertical');
      const svg = fieldPreviewSvg(f, 'vertical');
      expect(svg, `${f}: viewBox con los ejes intercambiados`).toContain(
        `viewBox="0 0 ${geo.vbW} ${geo.vbH}"`,
      );
      // El contenido tiene que ser EXACTAMENTE el canónico: antes se le pasaba la orientación
      // vertical a `fieldSvg` y ADEMÁS se envolvía en rotate(90), y como el paso a vertical de
      // `at()` ya es una transposición de ejes, la tarjeta salía transpuesta y anisotrópica
      // (porterías a los lados, arcos del doble de largo en un eje que en el tablero).
      expect(svg, `${f}: contenido canónico dentro del rotate(90)`).toContain(
        fieldSvg(f, geo.rect, 'horizontal'),
      );
      expect(svg, `${f}: una sola rotación`).toContain('rotate(90)');
    }
  });

  it('horizontal: sin rotación y con el campo canónico', () => {
    for (const f of CAMPOS) {
      const geo = fieldGeometry(f, 'horizontal');
      const svg = fieldPreviewSvg(f, 'horizontal');
      expect(svg, `${f}: sin rotación`).not.toContain('rotate(90)');
      expect(svg, `${f}: contenido canónico`).toContain(fieldSvg(f, geo.rect, 'horizontal'));
    }
  });
});

// =============================================================
// CORRECCIÓN URGENTE (dueño) — FÚTBOL SALA AZUL
//
// El campo de fútbol sala dejó de usar césped verde con franjas: ahora es una superficie azul
// LISA con las áreas de penalti rellenas de un azul más claro y las líneas blancas por encima.
// Estas pruebas son ESTRUCTURALES (qué se dibuja y en qué orden), no una búsqueda de un color
// hexadecimal suelto: comprueban la superficie, la ausencia de franjas, el número de rellenos de
// área, que el relleno va DETRÁS de las líneas y que la miniatura de la galería usa el mismo
// diseño que el tablero.
// =============================================================
describe('field — fútbol sala azul (superficie lisa y áreas claras)', () => {
  const ORDENACIONES: Array<'horizontal' | 'vertical'> = ['horizontal', 'vertical'];

  it('la superficie de fútbol sala es azul LISA; el resto sigue con el césped oficial', () => {
    expect(fieldSurface('futsal')).toEqual({ color: FUTSAL_SURFACE_COLOR, grass: 'plain' });
    for (const f of ['full', 'half', 'third', 'f7', 'blank'] as FieldType[]) {
      expect(fieldSurface(f), `${f} conserva el césped oficial`).toEqual({
        color: OFFICIAL_PITCH_COLOR,
        grass: 'stripes',
      });
    }
    // El azul de la superficie y el de las áreas son DISTINTOS (el área se ve más clara).
    expect(FUTSAL_SURFACE_COLOR).not.toBe(FUTSAL_AREA_COLOR);
  });

  for (const o of ORDENACIONES) {
    it(`${o}: el área de penalti va rellena de azul claro y DEBAJO de las líneas blancas`, () => {
      const g = fieldGeometry('futsal', o);
      const svg = fieldSvg('futsal', g.rect, 'horizontal');
      const rellenos = svg.split(`fill="${FUTSAL_AREA_COLOR}"`).length - 1;
      expect(rellenos, 'dos áreas (una por portería)').toBe(2);
      // El relleno pertenece a la capa de áreas y no lleva trazo propio: las líneas se dibujan aparte.
      expect(svg.split('class="entrenolab-area-fill"').length - 1, 'dos figuras de relleno').toBe(
        2,
      );
      // ORDEN: cada relleno aparece ANTES de las líneas DE SU ÁREA (los arcos de 6 m), que es lo que
      // significa «el área clara va detrás de sus líneas blancas». No se compara con la primera
      // línea blanca del SVG porque esa es el PERÍMETRO del campo, que se dibuja antes que todo.
      const primerRelleno = svg.indexOf(FUTSAL_AREA_COLOR);
      const primerArco = svg.indexOf('class="entrenolab-area-arc"');
      expect(primerRelleno, 'hay relleno').toBeGreaterThan(-1);
      expect(primerArco, 'hay arcos de área').toBeGreaterThan(-1);
      expect(primerRelleno, 'el relleno va DETRÁS de las líneas del área').toBeLessThan(primerArco);
      // Y el relleno cubre las dos porterías (una a cada extremo): sus dos figuras están separadas.
      const posiciones = [...svg.matchAll(new RegExp(FUTSAL_AREA_COLOR, 'g'))].map((m) => m.index!);
      expect(posiciones.length).toBe(2);
      expect(Math.abs(posiciones[1] - posiciones[0]), 'una por extremo').toBeGreaterThan(200);
    });
  }

  it('la miniatura de la galería usa el MISMO diseño: azul de superficie, sin césped verde', () => {
    for (const o of ORDENACIONES) {
      const svg = fieldPreviewSvg('futsal', o);
      expect(svg, `${o}: superficie azul`).toContain(FUTSAL_SURFACE_COLOR);
      expect(svg, `${o}: áreas claras`).toContain(FUTSAL_AREA_COLOR);
      expect(svg, `${o}: sin verde de césped`).not.toContain(OFFICIAL_PITCH_COLOR);
    }
    // Y la miniatura de un campo de césped SÍ lleva el verde (control: no se ha pintado todo igual).
    expect(fieldPreviewSvg('full', 'horizontal')).toContain(OFFICIAL_PITCH_COLOR);
  });
});
