import { FieldType } from './models';
import { f7Geometry } from './f7';
import type { F7Geom } from './f7';

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

/** Campos que se OFRECEN en el selector (galería visual). La orientación de cada uno se
 *  elige con los controles «Portería izquierda» / «Portería arriba».
 *
 *  Decisión de producto (auditoría final): «Medio campo» es UNA sola tarjeta. Antes había
 *  además «Medio campo vertical», pero su geometría y su SVG son EXACTAMENTE los de `half`
 *  con orientación vertical, así que se ofrecían dos tarjetas para el mismo campo.
 *  `vertical_half` sigue ADMITIDO como alias de compatibilidad para documentos antiguos
 *  (`models.FIELD_TYPES`) y el normalizador lo migra a `half` + orientación vertical.
 *
 *  `store.spec.ts` comprueba que la galería es un subconjunto de los admitidos y que la
 *  diferencia entre ambas listas son alias/compatibilidad.
 *
 *  CORRECCIÓN URGENTE (dueño): la galería se queda con SEIS campos. Se retiran de la oferta
 *  «Área y portería» (`box`) y «Dos medios campos» (`two_halves`) porque el dueño no los usa y
 *  hacían ruido en el selector. NO se eliminan del modelo: `box` y `two_halves` siguen en
 *  `FieldType`/`FIELD_TYPES`, siguen renderizándose y los ejercicios antiguos que los traen se
 *  abren igual; simplemente dejan de ofrecerse para ejercicios nuevos. */
export const FIELD_BASE_SPECS: FieldSpec[] = [
  { type: 'full', label: 'Campo completo' },
  { type: 'half', label: 'Medio campo' },
  { type: 'third', label: 'Tercio de campo' },
  { type: 'futsal', label: 'Fútbol sala' },
  { type: 'f7', label: 'F7 transversal' },
  { type: 'blank', label: 'Lienzo' },
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
    case 'f7':
      // El campo base F7 es la plantilla del MEDIO campo F11 (52,5×68), no del campo completo.
      return { len: 52.5, wid: 68 };
    case 'futsal':
      // Fútbol sala (40×20 m) tiene su propia geometría, no la del campo completo.
      return { len: 40, wid: 20 };
    case 'third':
      // Tercio de campo: recorte medido de 1/3 del largo del F11 (35 m × 68 m).
      return { len: 35, wid: 68 };
    case 'box':
      // Recorte "Área y portería": 22 m de largo × 44 m de ancho.
      return { len: 22, wid: 44 };
    default:
      // full / blank conservan el rect canónico 105×68.
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
      {
        vbW: py + 2 * VB_MARGIN,
        vbH: px + 2 * VB_MARGIN,
        rect,
        lenM: 52.5,
        widM: 68,
        vertical: true,
      }
    : {
        vbW: px + 2 * VB_MARGIN,
        vbH: py + 2 * VB_MARGIN,
        rect,
        lenM: 52.5,
        widM: 68,
        vertical: false,
      };
}

/** Geometría del campo base F7: medio campo F11 APISAADO (68 m en X, 52,5 m en Y).
 *  El medio campo F11 es 52,5 m de largo × 68 m de ancho; aquí se dibuja GIrado 90°
 *  (apaisado) porque así lo pide el dueño: portería F11 ARRIBA y porterías F7
 *  IZQUIERDA/DERECHA. El rect es, por tanto, 68 m en el eje X y 52,5 m en el eje Y;
 *  la superficie física sigue siendo el medio campo (52,5×68), solo cambia el dibujo. */
function f7Geom(orientation: Orientation): FieldGeom {
  const px = 68 * PX_PER_M; // 68 m (ancho del medio campo) en X → 59.58
  const py = 52.5 * PX_PER_M; // 52,5 m (largo del medio campo) en Y → 46
  const rect = { x: VB_MARGIN, y: VB_MARGIN, w: px, h: py };
  return orientation === 'vertical'
    ? {
        vbW: py + 2 * VB_MARGIN,
        vbH: px + 2 * VB_MARGIN,
        rect,
        lenM: 52.5,
        widM: 68,
        vertical: true,
      }
    : {
        vbW: px + 2 * VB_MARGIN,
        vbH: py + 2 * VB_MARGIN,
        rect,
        lenM: 52.5,
        widM: 68,
        vertical: false,
      };
}

/** Geometría del campo de FÚTBOL SALA (40×20 m). Rect canónico con proporción 2:1.
 *  La superficie física es 40 m de largo × 20 m de ancho; NO se estira a la caja 105×68.
 *  Las marcas se dibujan con las fracciones de futsal (círculo central 3 m, portería 3×2). */
function futsalGeom(orientation: Orientation): FieldGeom {
  const px = 40 * PX_PER_M; // 40 m en X → 35.05
  const py = 20 * PX_PER_M; // 20 m en Y → 17.52
  const rect = { x: VB_MARGIN, y: VB_MARGIN, w: px, h: py };
  return orientation === 'vertical'
    ? { vbW: py + 2 * VB_MARGIN, vbH: px + 2 * VB_MARGIN, rect, lenM: 40, widM: 20, vertical: true }
    : {
        vbW: px + 2 * VB_MARGIN,
        vbH: py + 2 * VB_MARGIN,
        rect,
        lenM: 40,
        widM: 20,
        vertical: false,
      };
}

/** Geometría del TERCIO de campo (35×68 m): recorte medido de 1/3 del largo del F11
 *  (105/3 = 35 m) conservando el ancho de 68 m. Rect propio, NO estirado a 105×68. */
function thirdGeom(orientation: Orientation): FieldGeom {
  const px = 35 * PX_PER_M; // 35 m en X → 30.67
  const py = 68 * PX_PER_M; // 68 m en Y → 59.58
  const rect = { x: VB_MARGIN, y: VB_MARGIN, w: px, h: py };
  return orientation === 'vertical'
    ? { vbW: py + 2 * VB_MARGIN, vbH: px + 2 * VB_MARGIN, rect, lenM: 35, widM: 68, vertical: true }
    : {
        vbW: px + 2 * VB_MARGIN,
        vbH: py + 2 * VB_MARGIN,
        rect,
        lenM: 35,
        widM: 68,
        vertical: false,
      };
}

/** Geometría del recorte "Área y portería" (22×44 m): crop del F11 que incluye la
 *  portería, el área pequeña (5,5×18,32 m), el área penal (16,5×40,32 m) y el arco de
 *  penalti (que sobresale hasta ~20 m de la línea de fondo). Rect propio. */
function boxGeom(orientation: Orientation): FieldGeom {
  const px = 22 * PX_PER_M; // 22 m en X → 19.28
  const py = 44 * PX_PER_M; // 44 m en Y → 38.57
  const rect = { x: VB_MARGIN, y: VB_MARGIN, w: px, h: py };
  return orientation === 'vertical'
    ? { vbW: py + 2 * VB_MARGIN, vbH: px + 2 * VB_MARGIN, rect, lenM: 22, widM: 44, vertical: true }
    : {
        vbW: px + 2 * VB_MARGIN,
        vbH: py + 2 * VB_MARGIN,
        rect,
        lenM: 22,
        widM: 44,
        vertical: false,
      };
}

/**
 * Geometría dinámica del campo para el TIPO de campo y la ORIENTACIÓN actuales.
 * Devuelve el rect canónico de contenido con las proporciones REALES (105×68 campo
 * completo; 52,5×68 medio campo; F7 medio campo apaisado 68×52,5; futsal 40×20;
 * tercio 35×68; área 22×44) y el viewBox que lo encaja. Es la ÚNICA fuente de la
 * geometría: la usan el render, la conversión pantalla↔norm, el hit-test, el
 * movimiento/redimensionado, el zoom/pan, las miniaturas, el PNG y al volver a abrir.
 */
export function fieldGeometry(
  field: FieldType,
  orientation: Orientation = 'horizontal',
): FieldGeom {
  if (field === 'f7') return f7Geom(orientation);
  if (field === 'futsal') return futsalGeom(orientation);
  if (field === 'third') return thirdGeom(orientation);
  if (field === 'box') return boxGeom(orientation);
  return field === 'half' || field === 'vertical_half'
    ? halfGeom(orientation)
    : fullGeom(orientation);
}

const LEN = 105; // largo del campo (m)
const WID = 68; // ancho del campo (m)
const lf = (m: number) => m / LEN; // fracción de longitud (eje de largo)
const wf = (m: number) => m / WID; // fracción de anchura (eje de ancho)

/** Franja exterior de césped liso alrededor del campo. Es ~5 % del lado corto (68 m)
 *  expresado como FRACCIÓN de la longitud (105 m), de modo que la franja tenga el
 *  mismo grosor visual en ambos ejes y los objetos puedan colocarse ligeramente
 *  fuera de las líneas del terreno. Fuente ÚNICA: la usan field.ts (render de la
 *  franja), render.ts (dominio de coordenadas permitidas) y el board (clamp/PNG). */
export const OUTER_STRIP_LEN_FRAC = (0.05 * WID) / LEN;
/** La misma franja como fracción de la anchura (≈5 %). */
export const OUTER_STRIP_WID_FRAC = 0.05;

/** A6: fuente ÚNICA del grosor de la franja (fracción del lado corto del campo).
 *  La usan el render (franja visible), `screenToNorm`/`MARGIN_STRIP` (coordenadas
 *  permitidas), el clamp de colocación/arrastre del board y el hit-test. */
export const STRIP_FRAC = 0.05;
/** Margen (en coords normalizadas) permitido FUERA de [0,1], el mismo en ambos ejes.
 *  Deriva de STRIP_FRAC y es la fuente de `MARGIN_STRIP` del render. */
export const STRIP_MARGIN_NORM = STRIP_FRAC;
/** Césped OFICIAL único (A7): color y textura fijos. El render usa SIEMPRE estos
 *  valores; los documentos antiguos con otro backgroundColor/grass siguen siendo
 *  válidos y no se sobrescriben al abrir, pero se visualizan con el césped oficial. */
export const OFFICIAL_PITCH_COLOR = '#31834a';
export const OFFICIAL_GRASS_MODE = 'stripes';

/** FÚTBOL SALA (petición del dueño): su superficie es AZUL LISA, no césped. Fuente ÚNICA de los
 *  dos colores del campo azul: los consumen el tablero (`render.ts`), la miniatura de la galería
 *  (`fieldPreviewSvg`), la miniatura de biblioteca y el PNG exportado (todos pasan por
 *  `renderBoardSvg`), así que el diseño no puede divergir entre pantallas. */
export const FUTSAL_SURFACE_COLOR = '#1e3a8a';
/** Áreas de penalti del fútbol sala: el mismo azul, más CLARO. Va relleno detrás de las líneas. */
export const FUTSAL_AREA_COLOR = '#2563eb';

/** Superficie de un campo: color + textura. Fútbol sala = azul LISO (sin franjas, damero ni
 *  césped); el resto = césped oficial de franjas. Fuente única para render y miniaturas. */
export function fieldSurface(field: FieldType): {
  color: string;
  grass: 'stripes' | 'plain' | 'checker';
} {
  if (field === 'futsal') return { color: FUTSAL_SURFACE_COLOR, grass: 'plain' };
  return { color: OFFICIAL_PITCH_COLOR, grass: OFFICIAL_GRASS_MODE };
}

/**
 * FACTOR DE ESCALA APARENTE por campo (encargo de materiales, FASE 2).
 *
 * CONTRATO NUEVO (el anterior ya no vale): el tamaño aparente NO debe ser igual en todos los campos.
 * En un campo más corto (medio, tercio, F7, fútbol sala) los objetos deben verse ALGO MAYORES, porque
 * el campo se ve más «de cerca» y el entrenador trabaja sobre menos terreno.
 *
 * Estos factores están CALIBRADOS POR MEDICIÓN en píxeles con el mismo viewport y el mismo objeto
 * (`e2e/fase-materiales-escala.spec.ts`). Medido ANTES (ancho en px, base = campo completo):
 *   medio 0,74 · tercio 0,64 · fútbol sala 0,71 · F7 0,59 · lienzo 0,80
 * Objetivo del dueño y resultado tras aplicar estos factores:
 *   medio 1,20 (115-125 %) · tercio 1,28 (120-135 %) · fútbol sala 1,18 (110-125 %) ·
 *   F7 1,18 (110-125 %) · lienzo 1,00 (documentado: mismo tamaño aparente que campo completo).
 *
 * Los campos RETIRADOS de la oferta (`box`, `two_halves`) conservan su escala anterior (factor 1)
 * para no cambiar la apariencia de documentos históricos.
 */
export const ESCALA_APARENTE_POR_CAMPO: Record<string, number> = {
  full: 1.0,
  half: 1.62,
  vertical_half: 1.62, // alias histórico del medio campo
  third: 1.99,
  futsal: 1.66,
  f7: 1.99,
  blank: 1.25,
  two_halves: 1.0, // retirado de la oferta: apariencia histórica intacta
  box: 1.0,
};

/** Anchura REGLAMENTARIA (m) de la portería del campo: F11 7,32 · fútbol sala 3. Es la referencia con
 *  la que se dibuja la portería de MATERIAL, de modo que ambas coincidan (criterio medible 0,90-1,10).
 *  En F7 se usa la del F11 a propósito: la plantilla F7 se dibuja SOBRE un medio campo F11 y la única
 *  portería DIBUJADA en ese campo es la del F11 (el diseño F7 dibuja zonas —áreas y línea de fuera de
 *  juego—, no una portería propia), así que la de material tiene que medir lo mismo que la visible.
 *  En «Lienzo» tampoco hay portería dibujada: se usa la del F11 (documentado). */
export function goalWidthMeters(field: FieldType): number {
  if (field === 'futsal') return 3;
  return 7.32;
}

/** Altura reglamentaria (m) de la portería del campo (F11 2,44 · fútbol sala 2). */
export function goalHeightMeters(field: FieldType): number {
  if (field === 'futsal') return 2;
  return 2.44;
}

/** Caja de la portería del campo en UNIDADES de viewBox (misma escala física que el campo): la usa
 *  el render de la portería de MATERIAL para coincidir con la portería dibujada (FASE 3). */
export function goalBoxUnits(field: FieldType): { w: number; h: number } {
  return { w: goalWidthMeters(field) * PX_PER_M, h: goalHeightMeters(field) * PX_PER_M };
}

/** ESCALA VISUAL APARENTE de los objetos por TIPO de campo (FASE 6 del encargo anterior, revisada
 *  por el encargo de materiales FASE 2). Los materiales/jugadores se dibujan con un tamaño fijo en
 *  unidades de viewBox; como cada campo tiene su propia geometría, este factor mantiene la coherencia
 *  y ahora, además, aplica la escala aparente pedida (`ESCALA_APARENTE_POR_CAMPO`).
 *  Se deriva de la longitud física real del campo (fuente: fieldDimensions). */
export function fieldObjectScale(
  field: FieldType,
  orientation: Orientation = 'horizontal',
): number {
  // Relación longitudReal/longitudReferencia(105) — compensación de la dilatación del viewBox.
  const compensacion = fieldDimensions(field).len / 105;
  // Corrección por campo: lo que hace que el tamaño APARENTE siga la política pedida (medida en px).
  const factor = ESCALA_APARENTE_POR_CAMPO[field] ?? 1;
  void orientation; // la dilatación no depende de la orientación (se mantiene la firma histórica)
  return compensacion * factor;
}

/**
 * Mapea coordenadas abstractas (l = fracción de longitud, w = fracción de
 * anchura) a píxeles del rect. En horizontal el largo va en X; en vertical
 * el largo va en Y (porterías arriba/abajo) y el ancho en X.
 */
function at(r: Rect, o: Orientation, l: number, w: number): [number, number] {
  return o === 'vertical' ? [r.x + w * r.w, r.y + l * r.h] : [r.x + l * r.w, r.y + w * r.h];
}

const line = (
  r: Rect,
  o: Orientation,
  l1: number,
  w1: number,
  l2: number,
  w2: number,
  dashed = false,
) => {
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
const rect = (
  r: Rect,
  o: Orientation,
  l0: number,
  w0: number,
  l1: number,
  w1: number,
  fill = 'none',
  // Clase opcional para dar un gancho ESTABLE a las pruebas (p. ej. la portería dibujada en el
  // campo, que se compara con la portería de material en el encargo de materiales, FASE 3).
  cls = '',
) => {
  const [x1, y1] = at(r, o, Math.min(l0, l1), Math.min(w0, w1));
  const [x2, y2] = at(r, o, Math.max(l0, l1), Math.max(w0, w1));
  // La clase va AL FINAL de la etiqueta: varios parsers de pruebas leen `<rect x=… y=… width=…
  // height=… fill=…>` en ese orden exacto, así que insertarla antes de `x` los rompería sin motivo.
  const clase = cls ? ` class="${cls}"` : '';
  return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${fill}" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}"${clase} />`;
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
const penaltyArc = (
  r: Rect,
  o: Orientation,
  left: boolean,
  lenFrac: (m: number) => number,
  widFrac: (m: number) => number = wf,
) => {
  const Rm = 9.15;
  const rxL = lenFrac(Rm); // radio en fracción de longitud
  const ryW = widFrac(Rm); // radio en fracción de anchura
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

/** Esquinas del rect canónico de contenido: `l0`/`l1` son los extremos del eje longitud y
 *  `w0`/`w1` los del eje anchura. Un campo RECORTADO (medio campo, tercio) solo tiene
 *  esquinas de verdad en el extremo de su LÍNEA DE PORTERÍA: en el otro extremo el campo
 *  continúa, así que no hay córner que dibujar (antes el medio campo pintaba los cuatro y el
 *  «dos medios campos» solo los de una mitad). */
type CornerId = 'l0w0' | 'l0w1' | 'l1w0' | 'l1w1';
const ALL_CORNERS: CornerId[] = ['l0w0', 'l0w1', 'l1w0', 'l1w1'];

const CORNER_SPEC: Record<CornerId, [number, number, number, number]> = {
  l0w0: [0, 0, 1, 1],
  l0w1: [0, 1, 1, -1],
  l1w0: [1, 0, -1, 1],
  l1w1: [1, 1, -1, -1],
};

/** Arcos de esquina (radio 1,2 m) por las esquinas indicadas del campo.
 *  `lenFrac`/`widFrac` convierten metros a FRACCIÓN de longitud/anchura del campo
 *  (full usa 105/68; medio campo usa 52,5/68) para que el radio sea idéntico en
 *  metros y el arco conserve su proporción en cada tipo de campo. */
const cornerArcs = (
  r: Rect,
  o: Orientation,
  lenFrac: (m: number) => number = lf,
  widFrac: (m: number) => number = wf,
  which: CornerId[] = ALL_CORNERS,
) => {
  const rl = lenFrac(1.2); // radio en fracción de longitud
  const rw = widFrac(1.2); // radio en fracción de anchura
  const rlx = o === 'vertical' ? rw : rl;
  const rly = o === 'vertical' ? rl : rw;
  let s = '';
  for (const id of which) {
    const [cl, cw, dl, dw] = CORNER_SPEC[id];
    const [x0, y0] = at(r, o, cl, cw);
    // Puntos sobre los dos bordes: a lo largo del eje L y del eje W.
    const [xEdgeL, yEdgeL] = at(r, o, cl + dl * rl, cw);
    const [xEdgeW, yEdgeW] = at(r, o, cl, cw + dw * rw);
    // Sentido del arco. MEDIDO con la conversión de arco SVG: el centro tiene que caer EN LA
    // ESQUINA, y eso ocurre cuando el sentido se decide por AMBAS direcciones (`dl === dw`), no
    // solo por `dw`: con la regla vieja el centro se iba al otro lado de la cuerda (a ~1,5
    // unidades de la esquina) en las dos esquinas del lado derecho —«dos medios campos» salía con
    // el medio derecho de córners planos— y en vertical fallaban las de `w` alto. En vertical se
    // NIEGA, porque `at()` transpone los ejes y una transposición invierte el sentido de giro.
    const sweepBase = dl === dw ? 1 : 0;
    const sweep = o === 'vertical' ? 1 - sweepBase : sweepBase;
    s += `<path class="entrenolab-corner" d="M ${xEdgeL} ${yEdgeL} A ${rlx * r.w} ${rly * r.h} 0 0 ${sweep} ${xEdgeW} ${yEdgeW}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
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
    s += rect(
      r,
      o,
      g0,
      centerW - goalHW,
      g0 + goalL,
      centerW + goalHW,
      'rgba(255,255,255,0.25)',
      'entrenolab-goal-field',
    );
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
  s += rect(
    r,
    o,
    -goalL,
    centerW - goalHW,
    0,
    centerW + goalHW,
    'rgba(255,255,255,0.25)',
    'entrenolab-goal-field',
  ); // portería
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
  // Arcos de esquina (radio 1,2 m, fracción de longitud 52,5) SOLO en las dos esquinas de la
  // LÍNEA DE PORTERÍA (l=0): en el otro extremo el campo continúa (es la línea de medio campo),
  // así que no hay córner. Antes se pintaban los cuatro.
  return s + cornerArcs(r, o, hlf, wf, ['l0w0', 'l0w1']);
}

/** Medio campo con la PORTERÍA a l=1 (línea de medio campo a l=0). Es el espejo X de
 *  `halfField`; se usa para la segunda mitad del campo "dos medios campos". La fracción
 *  de longitud se mide DESDE la línea de medio campo (l=0) hacia la portería (l=1). */
function halfFieldFlipped(r: Rect, o: Orientation): string {
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
  // Áreas/portería junto a l=1 (portería a la derecha en horizontal):
  s += rect(r, o, 1 - boxL, centerW - boxHW, 1, centerW + boxHW);
  s += rect(r, o, 1 - sixL, centerW - sixHW, 1, centerW + sixHW);
  s += rect(
    r,
    o,
    1,
    centerW - goalHW,
    1 + goalL,
    centerW + goalHW,
    'rgba(255,255,255,0.25)',
    'entrenolab-goal-field',
  );
  s += spot(r, o, 1 - spotL, centerW);
  const Rm = 9.15;
  const rxL = hlf(Rm);
  const ryW = wf(Rm);
  const rxP = o === 'vertical' ? ryW * r.w : rxL * r.w;
  const ryP = o === 'vertical' ? rxL * r.h : ryW * r.h;
  // Arco de penalti (fuera del área, hacia el centro). En horizontal sobresale a la
  // izquierda del área; sweep adecuado.
  const [ax1, ay1] = at(
    r,
    o,
    1 - boxL,
    centerW - ryW * Math.sqrt(Math.max(0, 1 - ((boxL - spotL) / rxL) ** 2)),
  );
  const [ax2, ay2] = at(
    r,
    o,
    1 - boxL,
    centerW + ryW * Math.sqrt(Math.max(0, 1 - ((boxL - spotL) / rxL) ** 2)),
  );
  const rsweep = o === 'horizontal' ? 0 : 1;
  s += `<path d="M ${ax1} ${ay1} A ${rxP} ${ryP} 0 0 ${rsweep} ${ax2} ${ay2}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  // Semicírculo central en la línea de medio campo (l=0), hacia el interior.
  const [x1, y1] = at(r, o, 0, centerW - ryW);
  const [x2, y2] = at(r, o, 0, centerW + ryW);
  const sweep = o === 'horizontal' ? 1 : 0;
  s += `<path d="M ${x1} ${y1} A ${rxP} ${ryP} 0 0 ${sweep} ${x2} ${y2}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  // Arcos de esquina SOLO en las dos esquinas de la LÍNEA DE PORTERÍA (l=1 en este medio
  // campo espejado). Antes no tenía ninguno: en «Dos medios campos» los quesitos salían solo
  // en la mitad izquierda.
  return s + cornerArcs(r, o, hlf, wf, ['l1w0', 'l1w1']);
}

/** A2: campo "dos medios campos" (izquierda/derecha en horizontal, arriba/abajo en
 *  vertical). Cada mitad es un medio campo F11 completo que linda con la otra en la
 *  línea de medio campo central. La unión NO produce línea doble: se dibuja el contorno
 *  de cada mitad y la arista central coincide exactamente. */
function twoHalvesField(r: Rect, o: Orientation): string {
  const left: Rect = { ...r, w: r.w / 2 };
  const right: Rect = { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h };
  // Mitad izquierda (portería a la izquierda) + mitad derecha (portería a la derecha).
  // Comparten la arista central (la línea de medio campo); no se añade ninguna línea
  // extra en el centro para no duplicar el trazo.
  const leftStr = halfField(left, o);
  const rightStr = halfFieldFlipped(right, o);
  return leftStr + rightStr;
}

/** Tercio de campo (35×68 m): recorte del F11 que muestra el extremo de la portería
 *  con su área grande (16,5 m), área pequeña (5,5 m), punto de penalti (11 m) y arco.
 *  Las fracciones usan 35 m (largo) y 68 m (ancho). No hay línea de medio campo (el
 *  recorte de 35 m no llega al centro). */
function thirdField(r: Rect, o: Orientation): string {
  const tl = (m: number) => m / 35; // fracción de longitud (35 m)
  const tw = (m: number) => m / 68; // fracción de anchura (68 m)
  const centerW = 0.5;
  const boxL = tl(16.5); // área grande
  const boxHW = tw(40.32) / 2;
  const goalL = tl(2);
  const goalHW = tw(7.32) / 2;
  const sixL = tl(5.5);
  const sixHW = tw(18.32) / 2;
  const spotL = tl(11);
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  s += rect(
    r,
    o,
    -goalL,
    centerW - goalHW,
    0,
    centerW + goalHW,
    'rgba(255,255,255,0.25)',
    'entrenolab-goal-field',
  ); // portería
  s += rect(r, o, 0, centerW - boxHW, boxL, centerW + boxHW); // área grande
  s += rect(r, o, 0, centerW - sixHW, sixL, centerW + sixHW); // área pequeña
  s += spot(r, o, spotL, centerW); // punto de penalti
  s += penaltyArc(r, o, true, tl); // arco de penalti (9,15 m fuera del área)
  // Arcos de esquina (1,2 m) en las dos esquinas de la línea de portería (l=0). Faltaban.
  return s + cornerArcs(r, o, tl, tw, ['l0w0', 'l0w1']);
}

/** Recorte "Área y portería" (22×44 m): crop del F11 centrado en la portería que muestra
 *  el área pequeña (5,5×18,32 m), el área penal (16,5×40,32 m), el punto de penalti
 *  (11 m) y el arco. Las fracciones usan 22 m (largo) y 44 m (ancho); por eso el arco
 *  de penalti se dibuja con la fracción de anchura del propio recorte. */
function boxField(r: Rect, o: Orientation): string {
  const bl = (m: number) => m / 22; // fracción de longitud (22 m)
  const bw = (m: number) => m / 44; // fracción de anchura (44 m)
  const centerW = 0.5;
  const boxL = bl(16.5); // área penal
  const boxHW = bw(40.32) / 2;
  const goalL = bl(2);
  const goalHW = bw(7.32) / 2;
  const sixL = bl(5.5);
  const sixHW = bw(18.32) / 2;
  const spotL = bl(11);
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  s += rect(
    r,
    o,
    -goalL,
    centerW - goalHW,
    0,
    centerW + goalHW,
    'rgba(255,255,255,0.25)',
    'entrenolab-goal-field',
  ); // portería
  s += rect(r, o, 0, centerW - boxHW, boxL, centerW + boxHW); // área penal
  s += rect(r, o, 0, centerW - sixHW, sixL, centerW + sixHW); // área pequeña
  s += spot(r, o, spotL, centerW); // punto de penalti
  s += penaltyArc(r, o, true, bl, bw); // arco de penalti (width-aware)
  return s;
}

/** Arcos de esquina de FÚTBOL SALA (radio 0,25 m, NO los 1,2 m del fútbol once). */
function futsalCornerArcs(r: Rect, o: Orientation): string {
  const flf = (m: number) => m / 40;
  const fwf = (m: number) => m / 20;
  const rl = flf(0.25);
  const rw = fwf(0.25);
  const rx = o === 'vertical' ? rw * r.w : rl * r.w;
  const ry = o === 'vertical' ? rl * r.h : rw * r.h;
  const corners: Array<[number, number, number, number]> = [
    [0, 0, 1, 1],
    [1, 0, -1, 1],
    [0, 1, 1, -1],
    [1, 1, -1, -1],
  ];
  let s = '';
  for (const [cl, cw, dl, dw] of corners) {
    const [xE, yE] = at(r, o, cl + dl * rl, cw);
    const [xW, yW] = at(r, o, cl, cw + dw * rw);
    // Mismo sentido que los córners del fútbol once: el centro del arco tiene que ser la esquina
    // (`dl === dw`, negado en vertical por la transposición de `at()`).
    const sweepBase = dl === dw ? 1 : 0;
    const sweep = o === 'vertical' ? 1 - sweepBase : sweepBase;
    s += `<path d="M ${xE} ${yE} A ${rx} ${ry} 0 0 ${sweep} ${xW} ${yW}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  }
  return s;
}

/** Área de penalti de FÚTBOL SALA reglamentaria: dos arcos de radio 6 m desde cada poste
 *  + el tramo (línea de 6 m) que los une. NO es un rectángulo 6×20 a lo ancho. */
function futsalPenaltyArea(r: Rect, o: Orientation, left: boolean): string {
  const flf = (m: number) => m / 40;
  const fwf = (m: number) => m / 20;
  const rl = flf(6); // radio 6 m en longitud
  const rw = fwf(6); // radio 6 m en anchura
  const centerW = 0.5;
  const goalHW = fwf(3) / 2;
  const postL = centerW - goalHW;
  const postR = centerW + goalHW;
  const gl = left ? 0 : 1; // línea de portería
  const dl = left ? rl : 1 - rl; // línea de 6 m
  const rx = o === 'vertical' ? rw * r.w : rl * r.w;
  const ry = o === 'vertical' ? rl * r.h : rw * r.h;
  let s = '';
  // Cada arco va del punto de la LÍNEA DE PORTERÍA (a 6 m del poste, hacia la banda) al punto de
  // la LÍNEA DE 6 m a la altura del poste, girando ALREDEDOR DEL POSTE. Los dos arcos de una misma
  // portería abren hacia lados OPUESTOS (uno hacia arriba y otro hacia abajo), así que su sentido
  // NO puede ser el mismo: con un `sweep` compartido, dos de los cuatro arcos del campo salían al
  // revés y el área no se veía como una D. Medido en `field.spec.ts` con la conversión SVG: el
  // punto medio del arco mal girado caía a 2,49 m de su poste en vez de a 6 m.
  for (const [post, esPosteBajo] of [
    [postL, true],
    [postR, false],
  ] as Array<[number, boolean]>) {
    const [xs, ys] = at(r, o, gl, post + (esPosteBajo ? -rw : rw)); // en la línea de portería
    const [xe, ye] = at(r, o, dl, post); // en la línea de 6 m, a la altura del poste
    // Sentido con el convenio SVG (`sweep=1` gira en sentido horario sobre la pantalla). OJO: el
    // paso a vertical NO es una rotación, sino una TRANSPOSICIÓN de ejes (`at()` mapea l→Y y w→X
    // sin negar), y una transposición invierte el sentido de giro: por eso en vertical se niega.
    const sweepBase = left === esPosteBajo ? 1 : 0;
    const sweep = o === 'vertical' ? 1 - sweepBase : sweepBase;
    s += `<path class="entrenolab-area-arc" d="M ${xs} ${ys} A ${rx} ${ry} 0 0 ${sweep} ${xe} ${ye}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  }
  const [lx1, ly1] = at(r, o, dl, postL);
  const [lx2, ly2] = at(r, o, dl, postR);
  s += `<line x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly2}" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  return s;
}

/** RELLENO azul claro del área de penalti de fútbol sala, por DEBAJO de sus líneas blancas.
 *  Misma geometría que `futsalPenaltyArea` (arcos de 6 m desde cada poste + el tramo recto de
 *  6 m que los une, cerrado por la línea de portería), pero como UNA sola figura cerrada. */
function futsalPenaltyAreaFill(r: Rect, o: Orientation, left: boolean): string {
  const flf = (m: number) => m / 40;
  const fwf = (m: number) => m / 20;
  const rl = flf(6);
  const rw = fwf(6);
  const centerW = 0.5;
  const goalHW = fwf(3) / 2;
  const postL = centerW - goalHW;
  const postR = centerW + goalHW;
  const gl = left ? 0 : 1;
  const dl = left ? rl : 1 - rl;
  const rx = o === 'vertical' ? rw * r.w : rl * r.w;
  const ry = o === 'vertical' ? rl * r.h : rw * r.h;
  const sweep = (esPosteBajo: boolean): number => {
    const base = left === esPosteBajo ? 1 : 0;
    return o === 'vertical' ? 1 - base : base;
  };
  const [sx, sy] = at(r, o, gl, postL - rw); // primer arco: arranca en la línea de portería
  const [mx, my] = at(r, o, dl, postL); // …y termina en la línea de 6 m
  const [nx, ny] = at(r, o, dl, postR); // tramo recto de 6 m entre los dos arcos
  const [ex, ey] = at(r, o, gl, postR + rw); // segundo arco: vuelve a la línea de portería
  // El segundo arco se recorre AL REVÉS (de la línea de 6 m a la portería); invertir el sentido
  // de avance invierte el `sweep`, igual que en las líneas.
  return (
    `<path class="entrenolab-area-fill" d="M ${sx} ${sy} ` +
    `A ${rx} ${ry} 0 0 ${sweep(true)} ${mx} ${my} ` +
    `L ${nx} ${ny} ` +
    `A ${rx} ${ry} 0 0 ${1 - sweep(false)} ${ex} ${ey} Z" ` +
    `fill="${FUTSAL_AREA_COLOR}" stroke="none" />`
  );
}

/** Campo de FÚTBOL SALA (40×20 m) realmente reglamentario: superficie 2:1, línea de medio
 *  campo, círculo central de 3 m, portería 3×2 m, área de penalti en D (arcos de 6 m desde
 *  cada poste + tramo), punto de penalti a 6 m, segundo punto a 10 m y arcos de esquina de
 *  0,25 m. Las fracciones usan 40 m (largo) y 20 m (ancho). */
function futsalField(r: Rect, o: Orientation): string {
  const flf = (m: number) => m / 40; // fracción de longitud (40 m)
  const fwf = (m: number) => m / 20; // fracción de anchura (20 m)
  const centerW = 0.5;
  const goalL = flf(2);
  const goalHW = fwf(3) / 2;
  const spot1 = flf(6); // punto de penalti a 6 m
  const spot2 = flf(10); // segundo punto a 10 m (doble penalti)
  let s = '';
  s += rect(r, o, 0, 0, 1, 1);
  // Petición del dueño: las dos áreas de penalti van RELLENAS de un azul más claro y ese relleno
  // queda DETRÁS de sus líneas blancas (se emite antes que las líneas del campo).
  s += futsalPenaltyAreaFill(r, o, true);
  s += futsalPenaltyAreaFill(r, o, false);
  s += line(r, o, 0.5, 0, 0.5, 1, false); // línea de medio campo (continua)
  // Círculo central r=3 m (circular en píxeles).
  const [ccx, ccy] = at(r, o, 0.5, centerW);
  const crx = o === 'vertical' ? fwf(3) * r.w : flf(3) * r.w;
  const cry = o === 'vertical' ? flf(3) * r.h : fwf(3) * r.h;
  s += `<ellipse cx="${ccx}" cy="${ccy}" rx="${crx}" ry="${cry}" fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" />`;
  for (const left of [true, false]) {
    const g0 = left ? -goalL : 1;
    s += rect(
      r,
      o,
      g0,
      centerW - goalHW,
      g0 + goalL,
      centerW + goalHW,
      'rgba(255,255,255,0.25)',
      'entrenolab-goal-field',
    ); // portería 3×2
    s += futsalPenaltyArea(r, o, left); // área de penalti en D (no rectángulo 6×20)
    s += spot(r, o, left ? spot1 : 1 - spot1, centerW); // punto de penalti 6 m
    s += spot(r, o, left ? spot2 : 1 - spot2, centerW); // segundo punto 10 m
  }
  return s + futsalCornerArcs(r, o); // arcos de esquina de 0,25 m
}

/** Mapea (fl = fracción de longitud desde la línea de medio campo [0] hasta la
 *  portería [1], fw = fracción de anchura [0=izquierda, 1=derecha]) a píxeles del
 *  rect, con la PORTERÍA ARRIBA (y pequeño) y la LÍNEA DE MEDIO CAMPO ABAJO.
 *  Es el medio campo del F11 dibujado en vertical (eje largo en Y). */
function halfAtTop(r: Rect, fl: number, fw: number): [number, number] {
  return [r.x + fw * r.w, r.y + (1 - fl) * r.h];
}

/** Rectángulo definido por dos esquinas en coordenadas (fl, fw) con portería arriba. */
function halfRectAtTop(
  r: Rect,
  fl0: number,
  fw0: number,
  fl1: number,
  fw1: number,
  fill = 'none',
  // Clase opcional, igual que en `rect()`: gancho estable para las pruebas (la portería dibujada en
  // el campo se compara con la portería de MATERIAL en el encargo de materiales, FASE 3).
  cls = '',
): string {
  const [x1, y1] = halfAtTop(r, fl0, fw0);
  const [x2, y2] = halfAtTop(r, fl1, fw1);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const clase = cls ? ` class="${cls}"` : '';
  return `<rect x="${x}" y="${y}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="${fill}" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}"${clase} />`;
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
  s += halfRectAtTop(
    r,
    1,
    centerW - goalHW,
    1 + goalL,
    centerW + goalHW,
    'rgba(255,255,255,0.25)',
    'entrenolab-goal-field',
  ); // portería
  s += halfSpotAtTop(r, 1 - spotL, centerW); // punto de penalti
  s += halfPenaltyArcAtTop(r); // arco de penalti
  s += halfCenterSemiAtTop(r); // semicírculo de la línea de medio campo
  return s;
}

/** Arcos de esquina del F7 (radio 1,2 m) en las 4 esquinas de la superficie F7.
 *  La superficie F7 (`F7Geom`) ya está en unidades de viewBox del rect canónico; aquí
 *  se dibuja el arco de esquina como una cuarte-partición circular en cada esquina,
 *  en el color de contraste del F7. */
function f7CornerArcs(g: F7Geom): string {
  const rad = 1.2 * PX_PER_M; // radio (1,2 m) en unidades de viewBox
  const { x, y, w, h } = g;
  const rx = rad;
  const ry = rad;
  const edges = [
    // [puntoInicial, puntoFinal, sweep]
    // El `sweep` sale de la misma regla que los córners del once (el centro del arco es la
    // esquina), medida con la conversión de arco SVG: el F7 se dibuja siempre en el sistema
    // canónico (no rota), así que aquí no hay negación. Antes eran 0,1,1,1 y TRES de los cuatro
    // estaban girados (centro al otro lado de la cuerda, arco «plano» y despegado del córner).
    [`${x + rad} ${y}`, `${x} ${y + rad}`, 1], // superior-izquierda
    [`${x + w - rad} ${y}`, `${x + w} ${y + rad}`, 0], // superior-derecha
    [`${x + w} ${y + h - rad}`, `${x + w - rad} ${y + h}`, 0], // inferior-derecha
    [`${x} ${y + h - rad}`, `${x + rad} ${y + h}`, 1], // inferior-izquierda
  ] as const;
  let s = '';
  for (const [a, b, sweep] of edges) {
    s += `<path d="M ${a} A ${rx} ${ry} 0 0 ${sweep} ${b}" fill="none" stroke="${F7_LINE_COLOR}" stroke-width="${FIELD_LINE_WIDTH}" />`;
  }
  return s;
}

/** Campo base "F7 transversal sobre medio campo F11" (plantilla compuesta).
 *  Dibuja el MEDIO CAMPO del F11 (portería arriba) y, PERPENDICULAR a su eje largo
 *  (vertical), el F7 con sus porterías/áreas a IZQUIERDA y DERECHA: el F7 cruza el
 *  ancho del medio campo (mismo origen geométrico f7Geometry) y NO dibuja línea ni
 *  círculo central (solo el punto central r=0.35). En vertical, render board rota
 *  todo el contenido, de modo que áreas/porterías/centro se conservan sin deformar.
 *  FASE 8b: se añaden los cuatro arcos de esquina del F7 (faltaban). */
function f7Field(r: Rect, o: Orientation): string {
  let out = halfPitchAtTop(r);
  const g = f7Geometry(r);
  const stroke = F7_LINE_COLOR;
  const lw = FIELD_LINE_WIDTH;
  out += `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" stroke="${stroke}" stroke-width="${lw}" fill="none"/>`;
  for (const x of g.offsideX)
    out += `<line x1="${x}" y1="${g.y}" x2="${x}" y2="${g.y + g.h}" stroke="${stroke}" stroke-width="${lw}"/>`;
  for (const b of g.big)
    out += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" stroke="${stroke}" stroke-width="${lw}" fill="none"/>`;
  for (const b of g.small)
    out += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" stroke="${stroke}" stroke-width="${lw}" fill="none"/>`;
  out += `<circle cx="${g.center.x}" cy="${g.center.y}" r="0.35" fill="${F7_LINE_COLOR}" stroke="none"/>`;
  out += f7CornerArcs(g);
  return out;
}

export function fieldSvg(
  field: FieldType,
  rect: Rect,
  orientation: Orientation = 'horizontal',
): string {
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
    case 'two_halves':
      return twoHalvesField(rect, orientation);
    case 'blank':
    default:
      return '';
  }
}

export const FIELD_RECT: Rect = { x: 4, y: 10, w: 92, h: 70 };

/**
 * Miniatura SVG de un campo base para la galería (solo las LÍNEAS, sin fichas).
 *
 * Se construye EXACTAMENTE como el tablero (`renderBoardSvg`): el campo se dibuja SIEMPRE en el
 * sistema canónico (horizontal) dentro de un viewBox que encaja el campo en esa orientación y, si
 * la orientación es vertical, TODO el contenido se envuelve en
 * `translate(Tx 0) rotate(90)` con `Tx = vbW/2 + (rect.y + rect.h/2)`.
 *
 * Antes esta miniatura llamaba a `fieldSvg(field, rect, orientation)` Y ADEMÁS envolvía el
 * resultado en `rotate(90)`: la orientación se aplicaba DOS veces. Como el paso a vertical de
 * `at()` ya es una transposición de ejes, la tarjeta salía transpuesta (porterías a los lados en
 * vez de arriba/abajo) y anisotrópica (en «Área y portería» el arco de 9,15 m medía el DOBLE en un
 * eje que en el tablero), así que prometía un campo distinto del que se aplicaba al pulsarla.
 */
export function fieldPreviewSvg(field: FieldType, orientation: Orientation = 'horizontal'): string {
  const geo = fieldGeometry(field, orientation);
  const fieldStr = fieldSvg(field, geo.rect, 'horizontal');
  // Petición del dueño: la miniatura de la galería muestra el MISMO diseño que el tablero, así que
  // el fútbol sala sale con su superficie azul lisa y sus áreas azul claro (no un fondo verde ni
  // transparente). El fondo de superficie va dentro del grupo para que también se oriente.
  const surface = fieldSurface(field);
  const conFondo =
    `<rect x="${geo.rect.x}" y="${geo.rect.y}" width="${geo.rect.w}" height="${geo.rect.h}" fill="${surface.color}"/>` +
    fieldStr;
  const inner =
    orientation === 'vertical'
      ? `<g transform="translate(${geo.vbW / 2 + (geo.rect.y + geo.rect.h / 2)} 0) rotate(90)">${conFondo}</g>`
      : conFondo;
  return (
    `<svg class="field-preview-svg" viewBox="0 0 ${geo.vbW} ${geo.vbH}" xmlns="http://www.w3.org/2000/svg">` +
    `<g fill="none" stroke="#ffffff" stroke-width="${FIELD_LINE_WIDTH}" stroke-linecap="round">${inner}</g>` +
    `</svg>`
  );
}

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
