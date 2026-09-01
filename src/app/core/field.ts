import { FieldType } from './models';
import { f7Geometry } from './f7';

// =============================================================
// EntrenoLab — Geometría del campo.
// Devuelve fragmentos SVG (líneas) dentro de un viewBox 0 0 100 100,
// donde el rectángulo [x, y, w, h] es el área de juego (el "pitch").
// Los elementos usan coordenadas normalizadas 0..1 relativas a ese
// rectángulo, de modo que se renderizan igual en cualquier tamaño.
//
// ORIENTACIÓN: el campo se dibuja SIEMPRE con el largo (105 m) a lo
// largo del eje de longitud y el ancho (68 m) a lo largo del eje de
// anchura. Para la orientación vertical se INTERCAMBIAN los ejes:
// el largo va en el eje Y (porterías arriba/abajo) y el ancho en el X.
// La misma transformación se aplica a elementos/zonas (px/py usan el
// mismo rect), de modo que campo y elementos comparten el espacio.
// =============================================================

export interface FieldSpec {
  type: FieldType;
  label: string;
}

export const FIELD_SPECS: FieldSpec[] = [
  { type: 'full', label: 'Campo completo' },
  { type: 'half', label: 'Medio campo' },
  { type: 'vertical_half', label: 'Medio campo vertical' },
  { type: 'third', label: 'Tercio de campo' },
  { type: 'box', label: 'Área y portería' },
  { type: 'futsal', label: 'Futsal' },
  { type: 'blank', label: 'Lienzo' },
];

/** Campos base del complemento: solo estos se ofrecen en el selector. */
export const FIELD_BASE_SPECS: FieldSpec[] = [
  { type: 'full', label: 'Campo completo de fútbol' },
  { type: 'half', label: 'Medio campo de fútbol' },
  { type: 'f7', label: 'F7 transversal sobre medio campo F11' },
  { type: 'blank', label: 'Sin líneas / lienzo vacío' },
];

const NS = 'http://www.w3.org/2000/svg';

/** Grosor compartido de TODAS las marcas de campo (trazo de las líneas del campo).
 *  Fuente única: la usan field.ts (campos base, incl. el F7 compuesto) y
 *  render.ts (en el grupo de marcas). Cambiar aquí afina TODO el campo a la vez. */
export const FIELD_LINE_WIDTH = 0.3;

/** Las marcas del F7 real del club son azules y deben distinguirse de las
 *  líneas blancas del medio campo F11 que sirve de fondo a la plantilla. */
export const F7_LINE_COLOR = '#38bdf8';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Orientation = 'horizontal' | 'vertical';

/** Etiqueta de orientación por RESULTADO visual (decisión de usabilidad del dueño:
 *  "Horizontal/Vertical" era ambiguo). Depende del tipo de campo, pero los valores
 *  internos siguen siendo 'horizontal'/'vertical'. */
export function orientationLabel(field: FieldType, o: Orientation): string {
  if (field === 'half' || field === 'vertical_half') {
    // Medio campo: portería en un extremo y línea de medio campo en el otro.
    return o === 'vertical' ? 'Portería arriba' : 'Portería izquierda';
  }
  if (field === 'blank') {
    return o === 'horizontal' ? 'Apaisado' : 'Vertical';
  }
  // full y f7 (composición transversal): porterías a los lados / arriba y abajo.
  return o === 'horizontal' ? 'Porterías izquierda y derecha' : 'Porterías arriba y abajo';
}

/** Física real (metros) del campo: fuente ÚNICA de las proporciones.
 *  El campo completo es 105×68; el medio campo (52,5×68) NO se estira a 105×68. */
export function fieldDimensions(field: FieldType): { len: number; wid: number } {
  switch (field) {
    case 'half':
    case 'vertical_half':
      return { len: 52.5, wid: 68 };
    default:
      // full / f7 / blank / third / box / futsal conservan el rect canónico 105×68.
      return { len: 105, wid: 68 };
  }
}

/** Escala consistente (px por metro) igual a la del campo completo (92 px ↔ 105 m).
 *  Así el ancho (68 m) se dibuja igual en todos los campos y el medio campo queda
 *  a media longitud (52,5 m) sin deformarse. */
const PX_PER_M = 92 / 105;
/** Margen del campo dentro del viewBox (px). */
const VB_MARGIN = 4;

export interface FieldGeom {
  vbW: number;
  vbH: number;
  /** Rect canónico de contenido (largo→X, ancho→Y) donde se dibujan campo + elementos.
   *  En vertical el contenido se ROTA (la misma transformación que el campo completo). */
  rect: Rect;
  /** Dimensiones físicas reales (m). */
  lenM: number;
  widM: number;
  /** true si la orientación es vertical (el contenido se gira 90°). */
  vertical: boolean;
}

function fullGeom(orientation: Orientation): FieldGeom {
  const rect = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
  return orientation === 'vertical'
    ? { vbW: 80, vbH: 100, rect, lenM: 105, widM: 68, vertical: true }
    : { vbW: 100, vbH: 80, rect, lenM: 105, widM: 68, vertical: false };
}

function halfGeom(orientation: Orientation): FieldGeom {
  const px = 52.5 * PX_PER_M; // largo del medio campo (52,5 m) en px → 46
  const py = 68 * PX_PER_M; // ancho (68 m) en px → 59.58
  const rect = { x: VB_MARGIN, y: VB_MARGIN, w: px, h: py };
  return orientation === 'vertical'
    ? // En vertical el contenido se rota: el viewBox encaja el campo girado (ancho→X, largo→Y).
      { vbW: py + 2 * VB_MARGIN, vbH: px + 2 * VB_MARGIN, rect, lenM: 52.5, widM: 68, vertical: true }
    : { vbW: px + 2 * VB_MARGIN, vbH: py + 2 * VB_MARGIN, rect, lenM: 52.5, widM: 68, vertical: false };
}

/**
 * Geometría dinámica del campo para el TIPO de campo y la ORIENTACIÓN actuales.
 * Devuelve el rect canónico de contenido con las proporciones REALES (105×68 campo
 * completo; 52,5×68 medio campo) y el viewBox que lo encaja. Es la ÚNICA fuente de
 * la geometría: la usan el render, la conversión pantalla↔norm, el hit-test, el
 * movimiento/redimensionado, el zoom/pan, las miniaturas, el PNG y al volver a abrir.
 */
export function fieldGeometry(field: FieldType, orientation: Orientation = 'horizontal'): FieldGeom {
  return field === 'half' || field === 'vertical_half' ? halfGeom(orientation) : fullGeom(orientation);
}

const LEN = 105; // largo del campo (m)
const WID = 68; // ancho del campo (m)
const lf = (m: number) => m / LEN; // fracción de longitud (eje de largo)
const wf = (m: number) => m / WID; // fracción de anchura (eje de ancho)

/**
 * Mapea coordenadas abstractas (l = fracción de longitud, w = fracción de
 * anchura) a píxeles del rect. En horizontal el largo va en X; en vertical
 * el largo va en Y (porterías arriba/abajo) y el ancho en X.
 */
function at(r: Rect, o: Orientation, l: number, w: number): [number, number] {
  return o === 'vertical' ? [r.x + w * r.w, r.y + l * r.h] : [r.x + l * r.w, r.y + w * r.h];
}

const line = (r: Rect, o: Orientation, l1: number, w1: number, l2: number, w2: number, dashed = false) => {
  const [x1, y1] = at(r, o, l1, w1);
  const [x2, y2] = at(r, o, l2, w2);
  const dash = dashed ? ' stroke-dasharray="2,1.2"' : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}"${dash} />`;
};

/** Círculo de radio físico Rm (m): circular EN PÍXELES en el rect del campo. */
const circlePx = (r: Rect, o: Orientation, l: number, w: number, Rm: number) => {
  const [cx, cy] = at(r, o, l, w);
  const rx = o === 'vertical' ? wf(Rm) * r.w : lf(Rm) * r.w;
  const ry = o === 'vertical' ? lf(Rm) * r.h : wf(Rm) * r.h;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
};

/** Rectángulo definido por dos esquinas en coordenadas (l, w). */
const rect = (r: Rect, o: Orientation, l0: number, w0: number, l1: number, w1: number, fill = 'none') => {
  const [x1, y1] = at(r, o, Math.min(l0, l1), Math.min(w0, w1));
  const [x2, y2] = at(r, o, Math.max(l0, l1), Math.max(w0, w1));
  return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${fill}" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
};

/** Punto de penalti (marca blanca). */
const spot = (r: Rect, o: Orientation, l: number, w: number) => {
  const [x, y] = at(r, o, l, w);
  return `<circle cx="${x}" cy="${y}" r="0.35" fill="#ffffff" />`;
};

/**
 * Arco de penalti: la parte de la circunferencia de 9,15 m (centrada en el
 * punto de penalti) que queda FUERA del área. En horizontal el arco se
 * dibuja correctamente; en vertical se intercambian los ejes.
 */
const penaltyArc = (r: Rect, o: Orientation, left: boolean, lenFrac: (m: number) => number) => {
  const Rm = 9.15;
  const rxL = lenFrac(Rm); // radio en fracción de longitud
  const ryW = wf(Rm); // radio en fracción de anchura
  const psL = left ? lenFrac(11) : 1 - lenFrac(11);
  const boxL = left ? lenFrac(16.5) : 1 - lenFrac(16.5);
  const dx = boxL - psL;
  const aTopW = ryW * Math.sqrt(Math.max(0, 1 - (dx / rxL) * (dx / rxL)));
  const centerW = 0.5;
  const [x1, y1] = at(r, o, boxL, centerW - aTopW);
  const [x2, y2] = at(r, o, boxL, centerW + aTopW);
  const rxP = o === 'vertical' ? ryW * r.w : rxL * r.w;
  const ryP = o === 'vertical' ? rxL * r.h : ryW * r.h;
  // La deformación de ejes invierte el sentido (sweep) al girar 90°.
  const sweep = o === 'horizontal' ? (left ? 1 : 0) : left ? 0 : 1;
  return `<path d="M ${x1} ${y1} A ${rxP} ${ryP} 0 0 ${sweep} ${x2} ${y2}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
};

/** Arcos de esquina (radio 1,2 m) por las cuatro esquinas del campo. */
const cornerArcs = (r: Rect, o: Orientation) => {
  const rl = lf(1.2); // radio en fracción de longitud
  const rw = wf(1.2); // radio en fracción de anchura
  const rlx = o === 'vertical' ? rw : rl;
  const rly = o === 'vertical' ? rl : rw;
  // Esquinas (l, w) con las direcciones hacia el interior en cada eje.
  const corners: Array<[number, number, number, number]> = [
    [0, 0, 1, 1],
    [1, 0, -1, 1],
    [0, 1, 1, -1],
    [1, 1, -1, -1],
  ];
  let s = '';
  for (const [cl, cw, dl, dw] of corners) {
    const [x0, y0] = at(r, o, cl, cw);
    // Puntos sobre los dos bordes: a lo largo del eje L y del eje W.
    const [xEdgeL, yEdgeL] = at(r, o, cl + dl * rl, cw);
    const [xEdgeW, yEdgeW] = at(r, o, cl, cw + dw * rw);
    // El sentido del arco depende de la orientación y de la esquina.
    const sweep = o === 'horizontal' ? (dw > 0 ? 1 : 0) : dl > 0 ? 0 : 1;
    s += `<path d="M ${xEdgeL} ${yEdgeL} A ${rlx * r.w} ${rly * r.h} 0 0 ${sweep} ${xEdgeW} ${yEdgeW}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  }
  return s;
};

function fullField(r: Rect, o: Orientation): string {
  const centerW = 0.5;
  const boxL = lf(16.5); // profundidad del área (16,5 m)
  const boxHW = wf(40.32) / 2; // media anchura del área (40,32 m)
  const goalL = lf(2); // profundidad de portería
  const goalHW = wf(7.32) / 2;
  const sixL = lf(5.5);
  const sixHW = wf(18.32) / 2;
  const spotL = lf(11);
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  s += line(r, o, 0.5, 0, 0.5, 1, false); // medio campo CONTINUA
  s += circlePx(r, o, 0.5, centerW, 9.15);
  for (const left of [true, false]) {
    const b0 = left ? 0 : 1 - boxL;
    s += rect(r, o, b0, centerW - boxHW, b0 + boxL, centerW + boxHW);
    const s0 = left ? 0 : 1 - sixL;
    s += rect(r, o, s0, centerW - sixHW, s0 + sixL, centerW + sixHW);
    const g0 = left ? -goalL : 1;
    s += rect(r, o, g0, centerW - goalHW, g0 + goalL, centerW + goalHW, 'rgba(255,255,255,0.25)');
    const pl = left ? spotL : 1 - spotL;
    s += spot(r, o, pl, centerW);
    s += penaltyArc(r, o, left, lf);
  }
  return s + cornerArcs(r, o);
}

function halfField(r: Rect, o: Orientation): string {
  // Medio campo: la PORTERÍA en l=0 y la LÍNEA DE MEDIO CAMPO en l=1.
  // Con el giro del render en vertical (rotate 90), la portería queda ARRIBA y la
  // línea de medio campo ABAJO (la orientación por defecto que pidió el dueño).
  // El largo del medio campo son 52,5 m → las fracciones de longitud usan 52,5.
  const HL = 52.5;
  const hlf = (m: number) => m / HL;
  const centerW = 0.5;
  const boxL = hlf(16.5);
  const boxHW = wf(40.32) / 2;
  const goalL = hlf(2);
  const goalHW = wf(7.32) / 2;
  const sixL = hlf(5.5);
  const sixHW = wf(18.32) / 2;
  const spotL = hlf(11);
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  s += rect(r, o, 0, centerW - boxHW, boxL, centerW + boxHW); // área grande (portería a l=0)
  s += rect(r, o, 0, centerW - sixHW, sixL, centerW + sixHW); // área pequeña (portería a l=0)
  s += rect(r, o, -goalL, centerW - goalHW, 0, centerW + goalHW, 'rgba(255,255,255,0.25)'); // portería
  s += spot(r, o, spotL, centerW); // punto de penalti
  s += penaltyArc(r, o, true, hlf); // arco de penalti
  // Semicírculo central en la línea de medio campo (hacia el interior del campo).
  const Rm = 9.15;
  const rxL = hlf(Rm);
  const ryW = wf(Rm);
  const rxP = o === 'vertical' ? ryW * r.w : rxL * r.w;
  const ryP = o === 'vertical' ? rxL * r.h : ryW * r.h;
  const [x1, y1] = at(r, o, 1, centerW - ryW);
  const [x2, y2] = at(r, o, 1, centerW + ryW);
  const sweep = o === 'horizontal' ? 0 : 1;
  s += `<path d="M ${x1} ${y1} A ${rxP} ${ryP} 0 0 ${sweep} ${x2} ${y2}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  return s;
}

function thirdField(r: Rect, o: Orientation): string {
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  const centerW = 0.5;
  const boxL = 0.28;
  const boxHW = 0.3;
  const goalL = 0.02;
  const goalHW = 0.13;
  s += rect(r, o, 1 - boxL, centerW - boxHW, 1, centerW + boxHW);
  s += rect(r, o, 1, centerW - goalHW, 1 + goalL, centerW + goalHW, 'rgba(255,255,255,0.25)');
  s += circlePx(r, o, 0.5, centerW, 9.15);
  return s;
}

function boxField(r: Rect, o: Orientation): string {
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  const centerW = 0.5;
  const goalL = 0.06;
  const goalHW = 0.13;
  s += rect(r, o, 1, centerW - goalHW, 1 + goalL, centerW + goalHW, 'rgba(255,255,255,0.25)');
  s += circlePx(r, o, 0.5, centerW, 9.15);
  s += line(r, o, 0, centerW, 0.2, centerW, true);
  return s;
}

function futsalField(r: Rect, o: Orientation): string {
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  const centerW = 0.5;
  const boxL = 0.12;
  const boxHW = 0.25;
  s += line(r, o, 0.5, 0, 0.5, 1, true);
  s += circlePx(r, o, 0.5, centerW, 9.15);
  for (const left of [true, false]) {
    const b0 = left ? 0 : 1 - boxL;
    s += rect(r, o, b0, centerW - boxHW, b0 + boxL, centerW + boxHW);
  }
  return s;
}

/** Mapea (fl = fracción de longitud desde la línea de medio campo [0] hasta la
 *  portería [1], fw = fracción de anchura [0=izquierda, 1=derecha]) a píxeles del
 *  rect, con la PORTERÍA ARRIBA (y pequeño) y la LÍNEA DE MEDIO CAMPO ABAJO.
 *  Es el medio campo del F11 dibujado en vertical (eje largo en Y). */
function halfAtTop(r: Rect, fl: number, fw: number): [number, number] {
  return [r.x + fw * r.w, r.y + (1 - fl) * r.h];
}

/** Rectángulo definido por dos esquinas en coordenadas (fl, fw) con portería arriba. */
function halfRectAtTop(r: Rect, fl0: number, fw0: number, fl1: number, fw1: number, fill = 'none'): string {
  const [x1, y1] = halfAtTop(r, fl0, fw0);
  const [x2, y2] = halfAtTop(r, fl1, fw1);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return `<rect x="${x}" y="${y}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="${fill}" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
}

/** Punto de penalti del medio campo F11 (portería arriba). */
function halfSpotAtTop(r: Rect, fl: number, fw: number): string {
  const [x, y] = halfAtTop(r, fl, fw);
  return `<circle cx="${x}" cy="${y}" r="0.35" fill="#ffffff" />`;
}

/** Arco de penalti del medio campo F11 (portería arriba): la parte de la
 *  circunferencia de 9,15 m que queda FUERA del área, hacia el campo (abajo). */
function halfPenaltyArcAtTop(r: Rect): string {
  const Rm = 9.15;
  const rxL = Rm / 52.5; // radio en fracción de longitud
  const ryW = Rm / 68; // radio en fracción de anchura
  const boxL = 16.5 / 52.5; // profundidad del área
  const psL = 11 / 52.5; // punto de penalti
  const dx = boxL - psL;
  const aTopW = ryW * Math.sqrt(Math.max(0, 1 - (dx / rxL) * (dx / rxL)));
  const centerW = 0.5;
  const [x1, y1] = halfAtTop(r, 1 - boxL, centerW - aTopW);
  const [x2, y2] = halfAtTop(r, 1 - boxL, centerW + aTopW);
  const rxP = ryW * r.w;
  const ryP = rxL * r.h;
  // Desde la línea del área debe sobresalir hacia el centro del campo (abajo),
  // no entrar hacia la portería. Con el eje Y de SVG, ese arco usa sweep=0.
  return `<path d="M ${x1} ${y1} A ${rxP} ${ryP} 0 0 0 ${x2} ${y2}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
}

/** Semicírculo central en la línea de medio campo (hacia el interior del campo). */
function halfCenterSemiAtTop(r: Rect): string {
  const Rm = 9.15;
  const rxL = Rm / 52.5;
  const ryW = Rm / 68;
  const centerW = 0.5;
  const [x1, y1] = halfAtTop(r, 0, centerW - ryW);
  const [x2, y2] = halfAtTop(r, 0, centerW + ryW);
  const rxP = ryW * r.w;
  const ryP = rxL * r.h;
  // El semicírculo entra en el medio campo (arriba desde la línea inferior).
  return `<path d="M ${x1} ${y1} A ${rxP} ${ryP} 0 0 1 ${x2} ${y2}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
}

/** Medio campo F11 (52,5×68) con la PORTERÍA ARRIBA y la LÍNEA DE MEDIO CAMPO
 *  ABAJO (con su semicírculo entrando en el campo), como pide el dueño para la
 *  plantilla F7. Reutiliza las fracciones del 'half' actual (16,5/5,5/11/2 m). */
function halfPitchAtTop(r: Rect): string {
  const hlf = (m: number) => m / 52.5;
  const centerW = 0.5;
  const boxL = hlf(16.5);
  const boxHW = wf(40.32) / 2;
  const goalL = hlf(2);
  const goalHW = wf(7.32) / 2;
  const sixL = hlf(5.5);
  const sixHW = wf(18.32) / 2;
  const spotL = hlf(11);
  let s = '';
  s += halfRectAtTop(r, 0, 0, 1, 1); // contorno (la arista inferior ES la línea de medio campo)
  s += halfRectAtTop(r, 1 - boxL, centerW - boxHW, 1, centerW + boxHW); // área grande
  s += halfRectAtTop(r, 1 - sixL, centerW - sixHW, 1, centerW + sixHW); // área pequeña
  s += halfRectAtTop(r, 1, centerW - goalHW, 1 + goalL, centerW + goalHW, 'rgba(255,255,255,0.25)'); // portería
  s += halfSpotAtTop(r, 1 - spotL, centerW); // punto de penalti
  s += halfPenaltyArcAtTop(r); // arco de penalti
  s += halfCenterSemiAtTop(r); // semicírculo de la línea de medio campo
  return s;
}

/** Campo base "F7 transversal sobre medio campo F11" (plantilla compuesta).
 *  Dibuja el MEDIO CAMPO del F11 (portería arriba) y, PERPENDICULAR a su eje largo
 *  (vertical), el F7 con sus porterías/áreas a IZQUIERDA y DERECHA: el F7 cruza el
 *  ancho del medio campo (mismo origen geométrico f7Geometry) y NO dibuja línea ni
 *  círculo central (solo el punto central r=0.35). En vertical, render board rota
 *  todo el contenido, de modo que áreas/porterías/centro se conservan sin deformar. */
function f7Field(r: Rect, o: Orientation): string {
  let out = halfPitchAtTop(r);
  const g = f7Geometry(r);
  const stroke = F7_LINE_COLOR;
  const lw = FIELD_LINE_WIDTH;
  out += `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" stroke="${stroke}" stroke-width="${lw}" fill="none"/>`;
  for (const x of g.offsideX) out += `<line x1="${x}" y1="${g.y}" x2="${x}" y2="${g.y + g.h}" stroke="${stroke}" stroke-width="${lw}"/>`;
  for (const b of g.big) out += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" stroke="${stroke}" stroke-width="${lw}" fill="none"/>`;
  for (const b of g.small) out += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" stroke="${stroke}" stroke-width="${lw}" fill="none"/>`;
  out += `<circle cx="${g.center.x}" cy="${g.center.y}" r="0.35" fill="${F7_LINE_COLOR}" stroke="none"/>`;
  return out;
}

export function fieldSvg(field: FieldType, rect: Rect, orientation: Orientation = 'horizontal'): string {
  switch (field) {
    case 'full':
      return fullField(rect, orientation);
    case 'half':
      return halfField(rect, orientation);
    case 'vertical_half':
      // El medio campo vertical es hoy un alias del 'half' orientado: la geometría
      // (52,5×68) se deriva del campo y la orientación, igual que para 'half'.
      return halfField(rect, orientation);
    case 'third':
      return thirdField(rect, orientation);
    case 'box':
      return boxField(rect, orientation);
    case 'futsal':
      return futsalField(rect, orientation);
    case 'f7':
      return f7Field(rect, orientation);
    case 'blank':
    default:
      return '';
  }
}

export const FIELD_RECT: Rect = { x: 4, y: 10, w: 92, h: 70 };

export function toSvgPoint(evt: PointerEvent, svg: SVGSVGElement): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  const r = FIELD_RECT;
  return { x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h };
}
