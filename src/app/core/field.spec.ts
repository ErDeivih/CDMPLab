import { describe, expect, it } from 'vitest';
import { fieldSvg, FIELD_LINE_WIDTH, F7_LINE_COLOR, fieldGeometry, fieldDimensions, orientationLabel } from './field';

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
  const re = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" fill="rgba\(255,255,255,0.25\)"/g;
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
    const c = ellipses(svg).find((e) => Math.abs(e.x - (H.x + H.w / 2)) < 0.5 && Math.abs(e.y - centerY) < 0.5);
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
    const c = ellipses(svg).find((e) => Math.abs(e.x - centerX) < 0.5 && Math.abs(e.y - (V.y + V.h / 2)) < 0.5);
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
    const expectedLeft = H.x + (0.5 - (40.32 / 68) / 2) * H.w;
    const expectedRight = H.x + (0.5 + (40.32 / 68) / 2) * H.w;
    const verticalLines = [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)]
      .filter((m) => Math.abs(Number(m[1]) - Number(m[3])) < 1e-9)
      .map((m) => Number(m[1]));
    expect(verticalLines.some((x) => Math.abs(x - expectedLeft) < 1e-9)).toBe(true);
    expect(verticalLines.some((x) => Math.abs(x - expectedRight) < 1e-9)).toBe(true);
  });

  it('plantilla F7: los arcos del F11 se abren hacia el terreno de juego', () => {
    const svg = fieldSvg('f7', H, 'horizontal');
    const paths = [...svg.matchAll(/<path d="M ([\d.]+) ([\d.]+) A [^\"]+ 0 0 ([01]) ([\d.]+) ([\d.]+)"/g)]
      .map((m) => ({ y1: Number(m[2]), sweep: Number(m[3]), y2: Number(m[5]) }));
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

  it('f7 conserva el rect del campo completo (105×68) para no deformar la plantilla', () => {
    const g = fieldGeometry('f7', 'horizontal');
    expect(g.rect.w / g.rect.h).toBeCloseTo(105 / 68, 4);
  });

  it('blank conserva el rect del campo completo', () => {
    expect(fieldGeometry('blank', 'horizontal').rect.w).toBeCloseTo(92, 5);
  });

  it('las dimensiones físicas se reportan por tipo', () => {
    expect(fieldDimensions('half')).toEqual({ len: 52.5, wid: 68 });
    expect(fieldDimensions('full')).toEqual({ len: 105, wid: 68 });
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
  function cornerArcs(svg: string, cornerRx: number): Array<{ d: string; x1: number; y1: number; rx: number; ry: number; sweep: number; x2: number; y2: number }> {
    const out: Array<{ d: string; x1: number; y1: number; rx: number; ry: number; sweep: number; x2: number; y2: number }> = [];
    const re = /<path d="M ([-\d.]+) ([-\d.]+) A ([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)" fill="none" stroke="#ffffff" stroke-width="0\.3" \/>/g;
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
        [H.x, H.y], [H.x + H.w, H.y], [H.x, H.y + H.h], [H.x + H.w, H.y + H.h],
      ];
      const nearCorner = corners.some(([cx, cy]) =>
        Math.hypot(a.x1 - cx, a.y1 - cy) < radial * 1.05 || Math.hypot(a.x2 - cx, a.y2 - cy) < radial * 1.05
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
    const radH = Math.hypot(cornerArcs(fieldSvg('full', H, 'horizontal'), cornerRxFor(H, 'horizontal'))[0].rx, cornerArcs(fieldSvg('full', H, 'horizontal'), cornerRxFor(H, 'horizontal'))[0].ry);
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
      [H.x, H.y], [H.x + H.w, H.y], [H.x, H.y + H.h], [H.x + H.w, H.y + H.h],
    ];
    for (const a of arcs) {
      // La distancia desde un extremo a la esquina MÁS CERCANA debe ser ~radial.
      const d1 = Math.min(...corners.map(([cx, cy]) => Math.hypot(a.x1 - cx, a.y1 - cy)));
      const d2 = Math.min(...corners.map(([cx, cy]) => Math.hypot(a.x2 - cx, a.y2 - cy)));
      expect(d1, 'extremo del arco cerca de una esquina').toBeLessThan(radial * 1.2);
      expect(d2, 'otro extremo cerca de una esquina').toBeLessThan(radial * 1.2);
    }
  });

  it('medio campo, lienzo y F7: NO hay arcos de esquina', () => {
    for (const field of ['half', 'blank', 'f7'] as const) {
      const svg = fieldSvg(field, H, 'horizontal');
      expect(cornerArcs(svg, cornerRxFor(H, 'horizontal')), `${field} no tiene arcos de esquina`).toHaveLength(0);
    }
  });
});
