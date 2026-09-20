import { CanvasElement, FieldType, F7Overlay } from './models';
import { CANONICAL_MATERIALS } from './material-registry';
import {
  FIELD_RECT,
  fieldSvg,
  FIELD_LINE_WIDTH,
  fieldGeometry,
  fieldObjectScale,
  STRIP_FRAC,
  STRIP_MARGIN_NORM,
  fieldSurface,
  goalBoxUnits,
} from './field';
import { f7Geometry } from './f7';
import { materialBaseSize, materialHitFrac } from './tactic-assets';

// =============================================================
// EntrenoLab — Render de la pizarra a SVG (funciones PURAS).
// La geometría del campo viaja EXPLÍCITAMENTE: no hay estado
// mutable global. Editor, miniaturas, PNG y GIF comparten esto.
// =============================================================

const VB_W = 100;
const VB_H = 80;

/** Margen (en coords normalizadas 0..1) permitido FUERA del rect de contenido para
 *  colocar/arrastrar objetos en la franja exterior de césped (FASE 2). Deriva de la
 *  fuente ÚNICA de la franja (`STRIP_FRAC` en field.ts), igual en ambos ejes y la
 *  misma que usan el render, el clamp del board y el hit-test. */
export const MARGIN_STRIP = STRIP_MARGIN_NORM;

/** Lado de la caja cuadrada de un material en `size=1` (unidades del viewBox canónico).
 *  El `<image>` se dibuja en 5.2×5.2 y el contenido visible (bbox) ocupa una
 *  fracción (TACTICAL_BBOX) que la caja respeta. */
export const MATERIAL_BOX = 5.2;

/** Tamaño efectivo de un material: `el.size` si está fijado; si no, el tamaño
 *  base normalizado del tipo (TACTICAL_SIZE). Así los documentos antiguos sin
 *  `size` también se normalizan y ya no hay materiales diminutos. */
export function materialSize(el: CanvasElement): number {
  return el.size ?? materialBaseSize(el.assetKind ?? el.t);
}

/** Semiejes (normalizados 0..1) de la hit-box de un material, en su espacio LOCAL
 *  (sin rotación). Usa el recuadro de contenido (bbox) escalado por `size` y lo
 *  eleva a un área táctil mínima de ~44 px CSS: los elementos largos/estrechos
 *  escalan con `size`, y nunca quedan por debajo del mínimo táctil. */
export function materialHitHalfExtents(
  el: CanvasElement,
  r: Geometry['rect'] = BOARD_CANON_RECT,
  objectScale = 1,
  pxTol?: { x: number; y: number },
  // `true` si el material se dibuja CONTRARROTADO (-90°) porque el tablero está en vertical:
  // su caja visible queda girada y los semiejes hay que intercambiarlos.
  uprightVertical = false,
  // FASE 3 del encargo de materiales: la PORTERÍA no usa la escala genérica, se dibuja con la
  // anchura reglamentaria del campo activo. Su caja táctil tiene que ser EXACTAMENTE la del dibujo
  // (misma escala en render, hit-test y marco de selección), así que aquí se recibe el campo.
  field?: FieldType,
): { hw: number; hh: number } {
  const s = materialSize(el) * objectScale;
  const frac = materialHitFrac(el.assetKind ?? el.t);
  const esPorteria = (el.assetKind ?? el.t) === 'goal' && !!field;
  const cajaPorteria = esPorteria ? goalBoxUnits(field) : null;
  // Semiejes en UNIDADES del viewBox (sin normalizar todavía). El intercambio del caso vertical
  // se hace AQUÍ, en unidades: norm X y norm Y escalan distinto (92 vs 59,6 unidades), así que
  // intercambiar los valores ya normalizados dejaría el dibujo a medio cubrir (medido: una
  // escalera grande en vertical quedaba con el eje largo en el sitio equivocado).
  let hwU = cajaPorteria ? cajaPorteria.w / 2 : (MATERIAL_BOX * s * frac.w) / 2;
  let hhU = cajaPorteria ? cajaPorteria.h / 2 : (MATERIAL_BOX * s * frac.h) / 2;
  // Hit-box = recuadro de contenido (bbox del material, con su proporción real via `frac`)
  // + margen EN PANTALLA por zoom. D1: la base es la caja REAL del objeto (así un poste
  // alto/estrecho conserva su caja vertical y un cono la suya), y el margen se convierte de
  // px de pantalla a norm según el zoom (screenPxToNormTolerance). Sin `pxTol` se mantiene el
  // mínimo táctil legado (~44 px) para compatibilidad.
  if (pxTol) {
    hwU += pxTol.x * r.w;
    hhU += pxTol.y * r.h;
  } else {
    // Mínimo táctil en norm que garantiza ~44 CSS px sobre un móvil típico
    // (horiz, fit=height en 360×800 → ~10 px por unidad de viewBox): 4,4 unidades de viewBox.
    const minHalfU = 4.4;
    hwU = Math.max(hwU, minHalfU);
    hhU = Math.max(hhU, minHalfU);
  }
  if (uprightVertical) [hwU, hhU] = [hhU, hwU];
  return { hw: hwU / r.w, hh: hhU / r.h };
}

export interface Geometry {
  vbW: number;
  vbH: number;
  rect: { x: number; y: number; w: number; h: number };
  /** true si la orientación es vertical (el contenido se rota 90°). Nunca inferir
   *  de `vbW < vbH`: el medio campo horizontal (52,5×68) es retrato y no es vertical. */
  vertical: boolean;
}

// Proporción real de un campo 105×68 m. En horizontal, el largo va en X.
const HORIZONTAL: Geometry = {
  vbW: VB_W,
  vbH: VB_H,
  rect: { x: 4, y: 10, w: 92, h: 92 / (105 / 68) },
  vertical: false,
};

/** Tipos de MATERIAL: su dibujo tiene un «arriba» propio (un cono con la base hacia abajo, una
 *  portería, una miniportería, una escalera, una pica…). Fuente única: el registro canónico de
 *  materiales, de modo que añadir un material nuevo lo incluye sin tocar el render. */
const UPRIGHT_MATERIAL_TYPES: ReadonlySet<string> = new Set(CANONICAL_MATERIALS.map((c) => c.id));

/**
 * Rect canónico del contenido (largo→X, ancho→Y). Campo + elementos + asas se
 * dibujan SIEMPRE en este espacio y, en vertical, se rotan.
 */
export const BOARD_CANON_RECT = HORIZONTAL.rect;

// =============================================================
// Texto — métricas por defecto y ajuste de línea (funciones PURAS).
// El texto NO usa <foreignObject> (no se rasteriza en SVG→PNG), así que el
// ajuste de línea se estima por el ancho medio de un carácter y se RECORTA con
// un clipPath al cuadro (w/h). El tamaño por defecto es legible y el cuadro
// (w/h) es lo bastante grande para que "Texto" y un par de líneas no desborden.
// =============================================================

/** Tamaño de fuente por defecto de un texto nuevo (unidades del viewBox 100×80).
 *  Fase 4: se redujo al 75 % del antiguo (3 → 2.25) para que los objetos de un
 *  solo toque aparezcan ~75 % de su tamaño anterior. */
export const DEFAULT_TEXT_SIZE = 2.25;
/** Ancho (normalizado 0..1) por defecto del cuadro de texto. */
export const DEFAULT_TEXT_W = 0.3;
/** Alto (normalizado 0..1) por defecto del cuadro de texto. */
export const DEFAULT_TEXT_H = 0.14;

// =============================================================
// FASE 3 — grosor de trazo de las herramientas TÁCTICAS de dibujo.
// El dueño quiere la mitad del grosor anterior:
//   - líneas/flechas/curvas/zigzag/mano alzada: 0.8 → 0.4
//   - contornos de rect/elipse/zona: 0.6 → 0.3
// Estos SON los valores por defecto del MODELO (no CSS): el elemento nuevo
// nace con `strokeWidth` (o cae al default aquí), se persiste, se exporta y
// aparece en las miniaturas. `FIELD_LINE_WIDTH` (0.3) NO se toca: es el campo.
// =============================================================
export const DEFAULT_STROKE_WIDTH = 0.4;
/** Contorno por defecto de rect/elipse/zona (antes 0.6). */
export const DEFAULT_SHAPE_STROKE = 0.3;
/** Mínimo EDITABLE del grosor de trazo (nunca 0 ni negativo). */
export const MIN_STROKE_WIDTH = 0.1;
/** Máximo editable habitual del grosor de trazo (coherente con el inspector). */
export const MAX_STROKE_WIDTH = 2.5;

/**
 * Color por defecto de los elementos de DIBUJO (línea, flecha, curva, zigzag, texto,
 * figuras y mano alzada) cuando el elemento no trae color propio (documentos antiguos
 * sin `c`) o cuando la herramienta no tiene preferencia guardada.
 *
 * Es BLANCO porque es el color con el que el propio campo dibuja sus marcas
 * (`field.ts` usa `#ffffff` en todas las líneas del campo): sobre el césped oficial
 * (`OFFICIAL_PITCH_COLOR`, `#31834a`) el blanco da ~4,7:1 de contraste y el negro
 * anterior (`#1f2933`) solo ~3,1:1, es decir, justo en el mínimo de WCAG para objetos
 * gráficos y por debajo en las franjas oscuras del césped. Además `#1f2933` NO estaba
 * en la paleta de la pizarra, así que el control de color no marcaba ninguna muestra
 * activa. `DEFAULT_ELEMENT_COLOR` es miembro de `PALETTE` (candado en las pruebas).
 */
export const DEFAULT_ELEMENT_COLOR = '#ffffff';

/**
 * Tipos de elemento (de dibujo o material) cuyo color de render sale de `el.c`.
 * Es la fuente ÚNICA para decidir si el inspector ofrece el selector de "Color": si el
 * render no usa `el.c` (p. ej. los materiales con PNG), ofrecer color sería mentir.
 *
 * Antes había TRES listas equivalentes y divergentes en `board.component.ts`
 * (`colorableTools`, `isColorTool()` y `showInspectorColor()`); la del inspector se
 * dejaba fuera el ARO, que el registro canónico declara `colorable` y que el render
 * pinta con `el.c` (ver el caso `ring`).
 */
export const COLORABLE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  // Dibujo (el `t` de la herramienta correspondiente).
  'rect',
  'ellipse',
  'line',
  'arrow',
  'doubleArrow',
  'curve',
  'dribble',
  'freehand',
  'text',
  // Materiales de render vectorial que usan `el.c`.
  'peto',
  'pica',
  'target',
  'ring',
  'ring_flat',
  'marker',
  'ladder',
  'pole',
]);

/** Relación punta-de-flecha ↔ grosor de trazo: con el default (0.4) la punta
 *  mide 1.4 u de viewBox (antes 2.8 con 0.8). Así la punta es proporcional al
 *  trazo y base reduce con él. */
export const ARROW_HEAD_FACTOR = 3.5;

/** Longitud (unidades del viewBox) de la punta de una flecha según el grosor. */
export function arrowHeadSize(strokeWidth: number): number {
  return strokeWidth * ARROW_HEAD_FACTOR;
}

// Fase 2 — los trazos AUXILIARES de selección se afinan al 25% del grosor que
// tenían (0.8→0.2, 0.7→0.175, 0.4→0.1). No afecta al grosor real del elemento ni
// al área táctil: la selección se ve fina y discreta pero sigue siendo manipulable.
export const SEL_STROKE = 0.2; // contornos punteados de líneas/figuras/curvas/mano alzada
export const SEL_STROKE_POINT = 0.175; // círculo de selección de jugadores/materiales
export const SEL_HANDLE_STROKE = 0.1; // borde de las asas cuadradas de redimensionado

/** Ancho estimado de un carácter como fracción del tamaño de fuente (proporcional). */
const TEXT_CHAR_W = 0.58;
/** Interlineado (paso vertical entre líneas) como fracción del tamaño de fuente. */
const TEXT_LINE_H = 1.15;
/** Fracción de la fuente que ocupa el descensor (margen bajo un glifo). */
const TEXT_DESCENDER = 0.25;
/** Línea base de la línea `i` respecto a la parte superior del cuadro (unidades). */
function lineBaseline(i: number, size: number): number {
  return size * 0.8 + i * size * TEXT_LINE_H;
}

/** Resultado del ajuste de un texto a su cuadro: qué líneas se pintan y si hay recorte. */
export interface TextLayout {
  /** Líneas a pintar (con “…” añadido a la última si hay contenido oculto). */
  lines: string[];
  /** Líneas envueltas totales (todo el contenido). */
  totalLines: number;
  /** Cuántas líneas caben Enteras dentro de la altura del cuadro. */
  visibleCount: number;
  /** Hay contenido (líneas) oculto porque el cuadro es más bajo que el texto. */
  overflow: boolean;
}

/**
 * Decide qué líneas de un texto envuelto se pintan dentro de un cuadro de altura
 * `boxH` unidades. NUNCA pinta una línea a medio cortar: las líneas que no caben
 * enteras se omiten y, si hay contenido oculto, se añade “…” a la última línea
 * visible como indicador. Esto evita el corte silencioso del clipPath.
 */
export function textLayoutForBox(lines: string[], size: number, boxH: number): TextLayout {
  let visibleCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lineBaseline(i, size) + size * TEXT_DESCENDER > boxH) break;
    visibleCount = i + 1;
  }
  const overflow = lines.length > visibleCount;
  const out = overflow ? [...lines.slice(0, visibleCount)] : [...lines];
  if (overflow && out.length) {
    const last = out[out.length - 1];
    out[out.length - 1] = last.length ? `${last} …` : '…';
  }
  return { lines: out, totalLines: lines.length, visibleCount, overflow };
}

/**
 * Alto (normalizado 0..1) mínimo para que un texto con cuadro muestre TODAS sus
 * líneas envueltas (auto-crecimiento). Se usa al editar el texto en vivo para que
 * ninguna línea quede recortada por la altura del cuadro.
 */
export function autoTextBoxH(text: string, size: number, boxW: number): number {
  const lines = wrapTextForBox(text, boxW, size);
  const n = Math.max(1, lines.length);
  const contentH = size + (n - 1) * size * TEXT_LINE_H + 0.4;
  return contentH / BOARD_CANON_RECT.h;
}

/**
 * Distribuye un texto en líneas que caben en un cuadro de `boxW` unidades de
 * ancho con un tamaño de fuente `size`. Preserva los saltos `\n` explícitos y
 * rompe palabras que solas desbordan. La anchura se ESTIMA (fuente variable),
 * por lo que el clipPath del render sigue siendo la garantía de no desbordar.
 */
export function wrapTextForBox(text: string, boxW: number, size: number): string[] {
  if (!text) return [];
  const usefulW = Math.max(size * 0.5, boxW); // nunca un ancho absurdamente pequeño
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw === '') {
      out.push('');
      continue;
    }
    let cur = '';
    for (const word of raw.split(' ')) {
      const cand = cur ? cur + ' ' + word : word;
      if (cand.length * size * TEXT_CHAR_W <= usefulW) {
        cur = cand;
        continue;
      }
      if (cur) out.push(cur);
      // Palabra que sola no cabe: se parte por caracteres.
      if (word.length * size * TEXT_CHAR_W > usefulW) {
        let rest = word;
        while (rest.length > 1 && rest.length * size * TEXT_CHAR_W > usefulW) {
          const take = Math.max(1, Math.floor(usefulW / (size * TEXT_CHAR_W)));
          out.push(rest.slice(0, take));
          rest = rest.slice(take);
        }
        cur = rest;
      } else {
        cur = word;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

// =============================================================
// FASE 2 — Unidades humanas en el inspector (funciones PURAS).
// El modelo GUARDA el valor normalizado 0..1 (preciso) y la UI lo
// presenta en porcentaje con UNA sola decimal (30 / 28,9). Estas
// funciones convierten, redondean y recortan SIN tocar el documento:
// a) mostrar = norma→% (1 decimal)  b) editar = %→norma con clamp.
// =============================================================

/** Redondea a UNA decimal (28.9). La UI nunca muestra más de una. */
export function roundToOne(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Normalizado 0..1 → porcentaje con UNA decimal (0.3 → 30, 0.28868… → 28.9). */
export function normalizedToPct(n: number): number {
  return roundToOne(n * 100);
}

/** Porcentaje 0..100 → normalizado 0..1 (28.9 → 0.289). */
export function pctToNormalized(pct: number): number {
  return pct / 100;
}

/** Acepta coma o punto decimal ("28,9" / "28.9") y devuelve el número; NaN si no es válido. */
export function parseLocalizedNumber(raw: string): number {
  const s = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (s === '') return NaN; // campo vacío → no editar (no un 0 destructivo)
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Recorta un normalizado a [min, 1] (por defecto [0, 1]). */
export function clampNorm(v: number, min = 0): number {
  return Math.max(min, Math.min(1, v));
}

/** Ancho natural (unidades del viewBox) de la línea más larga del texto, sin envolver. */
function naturalTextWidthUnits(v: string, size: number): number {
  let mx = 0;
  for (const ln of (v ?? '').split('\n')) {
    mx = Math.max(mx, ln.length * size * TEXT_CHAR_W);
  }
  return mx;
}

/**
 * Ajusta el cuadro EXACTAMENTE al contenido del texto: el ancho es el mínimo
 * para que cada línea quepa sin envolver de más y el alto el que necesitan
 * TODAS las líneas resultantes. Puede ENCOGER si el texto se acortó (el ancho
 * se reduce y el alto baja hasta lo mínimo necesario).
 *
 * `maxWNorm` es el ancho normalizado máximo que puede ocupar (para no desbordar
 * el campo por la derecha). Devuelve `w`/`h` normalizados 0..1.
 */
export function fitTextToContent(
  v: string,
  size: number,
  maxWNorm: number,
  r: Geometry['rect'] = BOARD_CANON_RECT,
): { w: number; h: number } {
  const safeSize = size > 0 ? size : DEFAULT_TEXT_SIZE;
  const maxWUnits = Math.max(safeSize * 0.5, maxWNorm * r.w);
  const naturalWUnits = naturalTextWidthUnits(v, safeSize);
  const boxWUnits = Math.min(Math.max(naturalWUnits, safeSize * 0.5), maxWUnits);
  const lines = wrapTextForBox(v, boxWUnits, safeSize);
  const n = Math.max(1, lines.length);
  const contentHUnits = safeSize + (n - 1) * safeSize * TEXT_LINE_H + 0.4;
  return {
    w: clampNorm(boxWUnits / r.w, 0.02),
    h: clampNorm(contentHUnits / r.h, 0.02),
  };
}

export function boardGeometry(orientation: 'horizontal' | 'vertical'): Geometry {
  // Geometría del campo COMPLETO (105×68) por orientación. Para la geometría del
  // tipo de campo actual (p. ej. medio campo 52,5×68) usa fieldGeometry(field, orientation).
  return fieldGeometry('full', orientation);
}

export interface HostRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Cómo encaja el SVG (viewBox con `preserveAspectRatio="xMidYMid meet"`) dentro del
 *  host. `contain` es el comportamiento clásico de letterboxing (ajusta al tamaño
 *  que cabe ENTERO dentro del host). `height` escala el campo para LLENAR la altura
 *  del host (la medida del modo "Llenar pantalla"): el campo puede entonces
 *  desbordar el ancho (se recorta y puede panearse en horizontal) manteniendo la
 *  proporción, sin deformar ni cambiar la orientación guardada. */
export type FitMode = 'contain' | 'height';

/** Convierte un punto de pantalla a coords normalizadas 0..1, teniendo en cuenta el
 *  letterboxing (preserveAspectRatio meet), el zoom y el pan.
 *
 *  La inversa debe coincidir EXACTAMENTE con el render real:
 *   1) El `.board-canvas` tiene en CSS
 *      `transform: translate(panX,panY) scale(zoom)` con `transform-origin: 50% 50%`
 *      (el ORIGEN es el CENTRO del host). Un punto local (cx,cy) del canvas se ve en
 *      pantalla como  host.left + O.x + panX + zoom*(cx - O.x)  (O = centro del host).
 *   2) El SVG (letterboxed con preserveAspectRatio meet) mapea un punto del viewBox
 *      (vbX,vbY) a local (cx,cy) = (offX + vbX*s, offY + vbY*s).
 *      - En `contain`, s = min(hostW/vbW, hostH/vbH) y offX/offY centran.
 *      - En `height` (llenar pantalla), s = COVER = max(hostH/dimVert, hostW/dimHor) donde
 *        dimVert = rect.h (horizontal) / rect.w (vertical) y dimHor = rect.w / rect.h. Es la
 *        MISMA escala que `fillScale` del componente: el host se cubre (la dimensión que da
 *        más tamaño), por lo que puede desbordar y panearse. En hosts verticales coincide
 *        con contain-height; en panorámicos difiere y ANTES no cuadraba con el render.
 *  Así el round-trip norm→pantalla→norm es la identidad para cualquier zoom/pan. */
export function screenToNorm(
  clientX: number,
  clientY: number,
  host: HostRect,
  g: Geometry,
  panX: number,
  panY: number,
  zoom: number,
  fit: FitMode = 'contain',
): { x: number; y: number } {
  const fillExtent = g.vertical ? g.rect.w : g.rect.h;
  // D1/fix: en `height` (llenar pantalla) la escala es COVER (igual que `fillScale` del
  // componente): se cubre el host usando la dimensión que más tamaño da. Antes era
  // `host.height/fillExtent` (contain-height) y NO coincidía con el render en hosts
  // panorámicos (error de ~36 px, que la tolerancia de selección estricta destapaba).
  const s =
    fit === 'height'
      ? Math.max(host.height / fillExtent, host.width / (g.vertical ? g.rect.h : g.rect.w))
      : Math.min(host.width / g.vbW, host.height / g.vbH);
  const offX = (host.width - g.vbW * s) / 2;
  const offY = (host.height - g.vbH * s) / 2;
  // Inverse del transform `translate(pan) scale(zoom)` con origen en el centro del host.
  const ox = host.width / 2;
  const oy = host.height / 2;
  const cx = ox + (clientX - host.left - panX - ox) / zoom;
  const cy = oy + (clientY - host.top - panY - oy) / zoom;
  const vbX = (cx - offX) / s;
  const vbY = (cy - offY) / s;
  const clamp01 = (v: number) => Math.max(-MARGIN_STRIP, Math.min(1 + MARGIN_STRIP, v));
  const r = g.rect; // rect canónico del contenido (largo→X, ancho→Y) del tipo de campo actual
  if (g.vertical) {
    // Invertir la rotación (x,y) → (Tx - y, x): xh = vbY, yh = Tx - vbX.
    const Tx = g.vbW / 2 + (r.y + r.h / 2);
    return {
      x: clamp01((vbY - r.x) / r.w),
      y: clamp01((Tx - vbX - r.y) / r.h),
    };
  }
  return {
    x: clamp01((vbX - r.x) / r.w),
    y: clamp01((vbY - r.y) / r.h),
  };
}

export function px(nx: number, r: Geometry['rect']): number {
  return nx * r.w + r.x;
}
export function py(ny: number, r: Geometry['rect']): number {
  return ny * r.h + r.y;
}

function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(h.slice(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(h.slice(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(h.slice(4, 6), 16) + amt));
  return `rgb(${r},${g},${b})`;
}

/** Convierte un color hex a rgba con alpha (para rellenos translúcidos del color elegido). */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function grassBg(
  base: string,
  vbW: number,
  vbH: number,
  mode: 'stripes' | 'plain' | 'checker' = 'stripes',
): string {
  if (mode === 'plain') {
    return `<rect x="0" y="0" width="${vbW}" height="${vbH}" fill="${base}"/>`;
  }
  if (mode === 'checker') {
    let s = '';
    const n = 8;
    const cw = vbW / n;
    const ch = vbH / n;
    const alt = shade(base, -14);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        s += `<rect x="${(i * cw).toFixed(2)}" y="${(j * ch).toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" fill="${(i + j) % 2 ? alt : base}"/>`;
      }
    }
    return s;
  }
  let s = '';
  const bands = 10;
  const bw = vbW / bands;
  const dark = shade(base, -14);
  for (let i = 0; i < bands; i++) {
    s += `<rect x="${(i * bw).toFixed(2)}" y="0" width="${bw.toFixed(2)}" height="${vbH}" fill="${i % 2 ? dark : base}"/>`;
  }
  return s;
}

function distToSegment(
  pxx: number,
  pyy: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((pxx - x1) * dx + (pyy - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pxx - (x1 + t * dx), pyy - (y1 + t * dy));
}

function nearQuad(
  p: { x: number; y: number },
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  tol: number,
): boolean {
  let prev: [number, number] = [x1, y1];
  const N = 24;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const x = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const y = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    if (distToSegment(p.x, p.y, prev[0], prev[1], x, y) < tol) return true;
    prev = [x, y];
  }
  return false;
}

/** Opciones para convertir una tolerancia de PANTALLA (px) a unidades NORMALIZADAS.
 *  D1: el área de selección se define en px de pantalla y se convierte según ZOOM, en
 *  vez de usar un 0.045 normalizado fijo que crece con la magnificación y selecciona
 *  objetos próximos de más. `scale` es la escala de ajuste (px por unidad de viewBox).
 */
export interface ScreenPxTolerance {
  zoom: number;
  /** Escala de ajuste del SVG: viewBox → px del host (px por unidad de viewBox). */
  scale: number;
  rect: Geometry['rect'];
}

/** Tolerancia en NORM para `screenPx` px de pantalla, en el zoom actual. Inversa exacta
 *  de screenToNorm: d(norm) = d(client) / (zoom * scale * r.w|r.h). */
export function screenPxToNormTolerance(
  opts: ScreenPxTolerance,
  screenPx: number,
): { x: number; y: number } {
  const denomX = opts.zoom * opts.scale * opts.rect.w;
  const denomY = opts.zoom * opts.scale * opts.rect.h;
  return { x: screenPx / denomX, y: screenPx / denomY };
}

export function hitTestElement(
  p: { x: number; y: number },
  elements: CanvasElement[],
  r: Geometry['rect'] = BOARD_CANON_RECT,
  objectScale = 1,
  pxScreen?: { screenPx: number; zoom: number; scale: number },
  // `true` cuando el tablero se dibuja en VERTICAL: en esa orientación los materiales se
  // contrarrotan -90° para quedar derechos por pantalla (ver `renderBoardSvg`), así que su caja
  // visible en el espacio canónico va girada y hay que intercambiar los semiejes.
  vertical = false,
  // Tipo de campo activo: la portería de material se dibuja a la anchura reglamentaria del campo
  // (FASE 3 del encargo de materiales) y su caja táctil debe ser la MISMA que la del dibujo.
  field: FieldType = 'full',
): string | null {
  // D1: tolerancia en px de pantalla (ratón ~4, táctil ~8–10) convertida a norm según
  // el zoom, en vez de un 0.045 normalizado fijo. Si no se pasa, se usa el mínimo táctil legado.
  const pxTol = pxScreen
    ? screenPxToNormTolerance(
        { zoom: pxScreen.zoom, scale: pxScreen.scale, rect: r },
        pxScreen.screenPx,
      )
    : undefined;
  // Fase 9: texto/línea/curva/mano alzada también usan tolerancia EN PANTALLA (por zoom),
  // no un 0.03/0.09 normalizado fijo. Valor por eje (el mayor) para que el radio táctil sea
  // constante en px de pantalla; sin pxScreen se conserva el legado.
  const lineTol = pxTol ? Math.max(pxTol.x, pxTol.y) : 0.03;
  const textTol = pxTol ? Math.max(pxTol.x, pxTol.y) : 0.09;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    // Rotación: prueba en el espacio local del elemento (punto rotado por -rot alrededor de su centro).
    const c = el.rot ? elementCenter(el) : null;
    const lp = el.rot && c ? rotatePoint(p, c, -el.rot) : p;
    if (
      el.t === 'player' ||
      el.t === 'ball' ||
      el.t === 'cone' ||
      el.t === 'mannequin' ||
      el.t === 'mannequin_row' ||
      el.t === 'minigoal' ||
      el.t === 'goal' ||
      el.t === 'pole' ||
      el.t === 'marker' ||
      el.t === 'hurdle' ||
      el.t === 'ring' ||
      el.t === 'ladder' ||
      el.t === 'flag' ||
      el.t === 'trampoline' ||
      el.t === 'target' ||
      el.t === 'net' ||
      el.t === 'vball' ||
      el.t === 'dumbbell' ||
      el.t === 'coachC' ||
      el.t === 'peto' ||
      el.t === 'chaleco' ||
      el.t === 'bosu' ||
      el.t === 'fitball' ||
      el.t === 'pica'
    ) {
      // Hit-box del material/objeto puntual: caja del contenido visible (bbox),
      // escalada por `size` y con un área táctil mínima. El punto ya está en el
      // espacio LOCAL del elemento (rotado por -rot), así que la caja es
      // axis-aligned: respeta `size` y `rot` y cubre las partes transparentes.
      // En vertical estos materiales se dibujan CONTRARROTADOS para quedar derechos por pantalla,
      // así que su caja visible va girada: los semiejes se intercambian (en unidades del viewBox,
      // ver `materialHitHalfExtents`). Sin esto, un material GRANDE (mayor que el mínimo táctil)
      // tenía la caja perpendicular al dibujo: tocar sus extremos visibles no lo seleccionaba y
      // sí seleccionaba césped vacío al lado.
      const { hw, hh } = materialHitHalfExtents(
        el,
        r,
        objectScale,
        pxTol,
        vertical && (UPRIGHT_MATERIAL_TYPES.has(el.t) || !!el.asset),
        field,
      );
      if (Math.abs(lp.x - (el.x ?? 0)) <= hw && Math.abs(lp.y - (el.y ?? 0)) <= hh) return el.id;
    } else if (el.t === 'text') {
      if (Math.hypot(lp.x - (el.x ?? 0), lp.y - (el.y ?? 0)) < textTol) return el.id;
      if (
        el.w &&
        el.h &&
        lp.x >= (el.x ?? 0) &&
        lp.x <= (el.x ?? 0) + el.w &&
        lp.y >= (el.y ?? 0) &&
        lp.y <= (el.y ?? 0) + el.h
      )
        return el.id;
    } else if (
      el.t === 'arrow' ||
      el.t === 'line' ||
      el.t === 'dribble' ||
      el.t === 'doubleArrow' ||
      el.t === 'measure'
    ) {
      if (distToSegment(lp.x, lp.y, el.x1 ?? 0, el.y1 ?? 0, el.x2 ?? 0, el.y2 ?? 0) < lineTol)
        return el.id;
    } else if (el.t === 'curve') {
      const cx = el.c1x ?? ((el.x1 ?? 0) + (el.x2 ?? 0)) / 2;
      const cy = el.c1y ?? ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2;
      if (nearQuad(lp, el.x1 ?? 0, el.y1 ?? 0, cx, cy, el.x2 ?? 0, el.y2 ?? 0, lineTol))
        return el.id;
    } else if (el.t === 'freehand') {
      const pts = el.points ?? [];
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(lp.x, lp.y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < lineTol)
          return el.id;
      }
      if (pts.length === 1 && Math.hypot(lp.x - pts[0][0], lp.y - pts[0][1]) < lineTol)
        return el.id;
    } else if (el.t === 'ellipse') {
      const ex = (el.x ?? 0) + (el.w ?? 0) / 2;
      const ey = (el.y ?? 0) + (el.h ?? 0) / 2;
      const w2 = Math.max(0.001, (el.w ?? 0) / 2);
      const h2 = Math.max(0.001, (el.h ?? 0) / 2);
      const dx = (lp.x - ex) / w2;
      const dy = (lp.y - ey) / h2;
      if (dx * dx + dy * dy <= 1) return el.id;
    } else if (el.t === 'zone' || el.t === 'rect') {
      if (
        lp.x >= (el.x ?? 0) &&
        lp.x <= (el.x ?? 0) + (el.w ?? 0) &&
        lp.y >= (el.y ?? 0) &&
        lp.y <= (el.y ?? 0) + (el.h ?? 0)
      )
        return el.id;
    }
  }
  return null;
}

function rotatePoint(
  p: { x: number; y: number },
  c: { x: number; y: number },
  deg: number,
): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function textColor(bg: string): string {
  const hex = bg.replace('#', '');
  if (hex.length < 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5 ? '#ffffff' : '#111111';
}

/** Centro geométrico (normalizado 0..1) de un elemento según su tipo. */
export function elementCenter(el: CanvasElement): { x: number; y: number } {
  const t = el.t;
  if (t === 'rect' || t === 'ellipse' || t === 'zone' || t === 'text') {
    return { x: (el.x ?? 0) + (el.w ?? 0) / 2, y: (el.y ?? 0) + (el.h ?? 0) / 2 };
  }
  if (t === 'arrow' || t === 'line' || t === 'dribble' || t === 'doubleArrow' || t === 'measure') {
    return { x: ((el.x1 ?? 0) + (el.x2 ?? 0)) / 2, y: ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2 };
  }
  if (t === 'curve') {
    return {
      x: ((el.x1 ?? 0) + (el.c1x ?? el.x2 ?? 0) + (el.x2 ?? 0)) / 3,
      y: ((el.y1 ?? 0) + (el.c1y ?? el.y2 ?? 0) + (el.y2 ?? 0)) / 3,
    };
  }
  if (t === 'freehand') {
    const pts = el.points ?? [];
    if (!pts.length) return { x: el.x ?? 0, y: el.y ?? 0 };
    return {
      x: pts.reduce((a, p) => a + p[0], 0) / pts.length,
      y: pts.reduce((a, p) => a + p[1], 0) / pts.length,
    };
  }
  return { x: el.x ?? 0, y: el.y ?? 0 };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rotWrap(inner: string, rot: number | undefined, cx: number, cy: number): string {
  return rot ? `<g transform="rotate(${rot} ${cx} ${cy})">${inner}</g>` : inner;
}

/**
 * Materiales que se dibujan SIEMPRE en vector, aunque el documento traiga un PNG (FASE 4 del encargo
 * de materiales). Motivo medido por el dueño: con el PNG el CHINO parecía una raya y la ESCALERA y
 * la MINIPORTERÍA se confundían entre sí y con la portería grande. Sus datos NO se tocan (el `asset`
 * sigue guardado por compatibilidad); simplemente no se usa para pintarlos.
 * Se comprueba por TIPO de elemento y por `assetKind`, porque la variante amarilla de la escalera es
 * el mismo `t` (`ladder`) con otro `assetKind`.
 */
const SIEMPRE_VECTOR = new Set(['ladder', 'ladder_yellow', 'minigoal', 'target', 'goal']);

function elStr(
  el: CanvasElement,
  selected: boolean,
  r: Geometry['rect'],
  isVertical = false,
  objectScale = 1,
  // Tipo de campo activo: la portería de MATERIAL necesita la anchura reglamentaria del campo
  // (FASE 3 del encargo de materiales) y aquí es donde se decide qué se dibuja.
  field: FieldType = 'full',
): string {
  const gx = (nx: number) => px(nx, r);
  const gy = (ny: number) => py(ny, r);
  // Material en PNG: se renderiza como imagen. El `size` escala la caja (5.2×size)
  // y, en documentos sin `size`, se usa el tamaño base normalizado del tipo.
  // EXCEPCIÓN (FASE 4 del encargo de materiales): los materiales de `SIEMPRE_VECTOR` ignoran su PNG
  // y usan el dibujo vectorial, que es reconocible a cualquier tamaño.
  if (el.asset && !SIEMPRE_VECTOR.has(el.t) && !SIEMPRE_VECTOR.has(el.assetKind ?? '')) {
    // FASE 6: escala visual por campo (tamaño aparente constante). Se aplica SOLO en el
    // render; el `size` del documento no se re-escribe. `objectScale` es 1 en campo completo.
    const s = materialSize(el) * objectScale;
    const x = gx(el.x ?? 0);
    const y = gy(el.y ?? 0);
    const w = MATERIAL_BOX * s;
    const h = MATERIAL_BOX * s;
    // Compatibilidad con ejercicios antiguos que guardaron `/assets/...`:
    // se elimina la barra inicial para que el <base href> del despliegue mande.
    const assetHref = el.asset.replace(/^\/assets\//, 'assets/');
    const img = `<image href="${assetHref}" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" />`;
    return rotWrap(img, el.rot, x, y);
  }
  switch (el.t) {
    case 'player': {
      const c = el.c ?? '#1a73e8';
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const ring = selected
        ? ' stroke="#fff" stroke-width="0.5" stroke-dasharray="0.8,0.6"'
        : ' stroke="#ffffff" stroke-width="0.6"';
      // Fase 8: el nombre y el número se CONTRARROTAN para permanecer derechos y
      // legibles aunque el jugador esté girado (±90°). El círculo (invariante bajo
      // rotación) conserva la transformación del elemento; el texto se compensa con
      // -rot alrededor del centro para que la rotación de la marca no lo tumbe.
      const nText = `<text text-anchor="middle" dominant-baseline="central" font-size="2" font-weight="700" fill="${textColor(c)}">${el.n ?? ''}</text>`;
      const gkText =
        el.type === 'goalkeeper'
          ? `<text y="4.2" text-anchor="middle" font-size="1.5" fill="#ffffff" font-weight="700" font-family="Inter, system-ui, sans-serif">POR</text>`
          : '';
      // Fase 1 (usabilidad): el NOMBRE va en BLANCO (alto contraste sobre el césped verde),
      // un poco más grande y en negrita para ser legible; SIN caja, fondo ni borde alrededor
      // del texto. Se contrarrota (textGroup) para quedar derecho POR PANTALLA: compensa
      // tanto la rotación del jugador (±90) como la rotación de la ORIENTACIÓN vertical del
      // campo (+90). Así en campo vertical el dorsal/nombre se leen de izquierda a derecha.
      const labelText = el.label
        ? `<text y="-4" text-anchor="middle" font-size="1.8" fill="#ffffff" font-weight="700" font-family="Inter, system-ui, sans-serif">${esc(el.label)}</text>`
        : '';
      const text = nText + gkText + labelText;
      const orientAngle = isVertical ? 90 : 0;
      const textAngle = orientAngle + (el.rot ?? 0);
      const textGroup =
        textAngle !== 0 ? `<g transform="rotate(${-textAngle} 0 0)">${text}</g>` : text;
      const g =
        `<g transform="translate(${x} ${y}) scale(${s})">` +
        `<circle r="2.5" fill="${c}"${ring}/>` +
        textGroup +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'ball': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><circle r="1.3" fill="#ffffff" stroke="#111111" stroke-width="0.4"/><circle cx="-0.4" cy="0.4" r="0.35" fill="#111111"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'cone': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-1.4 1.7 L0 -1.7 L1.4 1.7 Z" fill="${el.c ?? '#f9ab00'}" stroke="#00000033" stroke-width="0.2"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'coachC': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><circle r="1.7" fill="${el.c ?? '#e6b800'}" stroke="#20242a" stroke-width="0.25"/><text text-anchor="middle" dominant-baseline="central" font-size="1.8" font-weight="800" fill="#111111">C</text></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'peto': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-2 1.6 L-2.4 -1.4 L-1.2 -2.2 L-0.4 -1.2 L0.4 -1.2 L1.2 -2.2 L2.4 -1.4 L2 1.6 Z" fill="${el.c ?? '#f6c945'}" stroke="#20242a" stroke-width="0.2"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'chaleco': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-1.6 2 L-1.2 -1.8 L-0.2 -1.2 L0.2 -1.2 L1.2 -1.8 L1.6 2 Z" fill="${el.c ?? '#e74c3c'}" stroke="#20242a" stroke-width="0.2"/><rect x="-0.7" y="-0.4" width="1.4" height="1" fill="#ffffff" opacity="0.3"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'bosu': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-1.6 0 A1.6 1.6 0 0 1 1.6 0 Z" fill="${el.c ?? '#3056d3'}" stroke="#20242a" stroke-width="0.2"/><ellipse cx="0" cy="0" rx="1.6" ry="0.5" fill="#10151a" opacity="0.55"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'fitball': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><circle r="1.8" fill="${el.c ?? '#e67e22'}" stroke="#20242a" stroke-width="0.2"/><path d="M-1.27 -1.27 A1.8 1.8 0 0 1 1.27 -1.27" fill="none" stroke="#ffffff" stroke-width="0.4" opacity="0.5"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'pica': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const g = `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-0.25" y="-2.4" width="0.5" height="4.8" rx="0.25" fill="${el.c ?? '#ffffff'}" stroke="#20242a" stroke-width="0.2"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'marker': {
      // BOSU: cúpula (hemisferio) reconocible sobre una base, RECOLOREABLE (usa `el.c`).
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const c = el.c ?? '#3056d3';
      const g =
        `<g transform="translate(${x} ${y}) scale(${s})" stroke="#20242a" stroke-width="0.2">` +
        `<path d="M-1.6 0 A1.6 1.6 0 0 1 1.6 0 Z" fill="${c}"/>` +
        `<ellipse cx="0" cy="0" rx="1.6" ry="0.5" fill="#10151a" opacity="0.55"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'target': {
      // CHINO (FASE 4 del encargo de materiales). Antes eran dos elipses y un rectángulo: una
      // «raya» plana de 4,4 × 1,8 unidades que no recordaba a un chino. Ahora es un platillo visto
      // ligeramente desde arriba: disco con BORDE (aro), superficie interior más clara, ABERTURA
      // central y sombra de apoyo (volumen ligero). Sigue siendo MÁS BAJO y más estrecho que el cono
      // (2,58 × 3,30 unidades dibujadas frente a su caja de 5,2) y RECOLOREABLE con `el.c`.
      // El dibujo se ha AGRANDADO (cierre del encargo de materiales): antes medía 2,3 unidades de
      // ancho y en pantalla salía a ~30 % del cono (el dueño lo veía «como un punto»: 10×8 px frente
      // a los 32×32 px del cono). Ahora mide 4,14 unidades con el trazo —2 × rx = 4,0 más el aro— y
      // en pantalla queda en el 45-55 % pedido, conservando aro exterior, abertura central, volumen
      // y color seleccionable.
      // La medida se hace igual que la del dueño y que la de las pruebas: caja visible del chino
      // frente a caja visible del cono (su PNG mide 5,2 × size; con size 0,6 son 3,12 unidades =
      // 32 px, y el chino sale a 16 px = 50 %). No se toca `TACTICAL_SIZE.target` a propósito: los
      // documentos ya guardan su `size`, así que el tamaño hay que subirlo en el DIBUJO para que los
      // ejercicios existentes también mejoren.
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const c = el.c ?? '#2c7be5';
      const claro = shade(c, 26);
      const oscuro = shade(c, -22);
      const g =
        `<g transform="translate(${x} ${y}) scale(${s})">` +
        // Sombra de apoyo: da volumen y separa el chino del césped. Más estrecha que el cuerpo para
        // que la caja visible la mande el platillo y no la sombra (medido: 16 px de ancho total).
        `<ellipse cx="0.10" cy="1.06" rx="1.95" ry="0.88" fill="#00000038"/>` +
        // Cuerpo del platillo (disco aplastado) con su aro.
        `<ellipse cx="0" cy="0" rx="2.0" ry="1.29" fill="${oscuro}" stroke="#20242a" stroke-width="0.14"/>` +
        // Superficie interior (más clara) y abertura central.
        `<ellipse cx="0" cy="-0.13" rx="1.70" ry="1.05" fill="${c}"/>` +
        `<ellipse cx="0" cy="-0.13" rx="0.75" ry="0.44" fill="${claro}" stroke="${oscuro}" stroke-width="0.1"/>` +
        `<ellipse cx="0" cy="-0.13" rx="0.36" ry="0.21" fill="${oscuro}"/>` +
        // Brillo del borde superior (lectura de «platillo» y no de mancha).
        `<path d="M-1.50 -0.70 A 2.0 1.29 0 0 1 1.50 -0.70" fill="none" stroke="#ffffffaa" stroke-width="0.14"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'minigoal': {
      // MINIPORTERÍA (FASE 4): portería pequeña vista de frente, CLARAMENTE distinta de la portería
      // grande: baja y compacta (2,3 × 1,1 unidades frente a las ~6,4 × 2,1 reglamentarias), marco
      // grueso respecto a su tamaño, pocas líneas de red (para que no parezca una escalera) y una
      // barra de base que la ancla al suelo.
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const c = el.c ?? '#e8edf2';
      const W = 2.3;
      // Más BAJA y compacta que antes (1,0 → 0,85) y con una profundidad DISTINTA de la portería
      // grande (aquí la cara superior se ve desde arriba, dentro de la caja).
      const H = 0.85;
      const gs = 0.16;
      const x0 = -W / 2;
      const y0 = -H / 2;
      const g =
        `<g transform="translate(${x} ${y}) scale(${s})">` +
        `<ellipse cx="0" cy="${(H / 2 + gs * 1.6).toFixed(2)}" rx="${(W * 0.5).toFixed(2)}" ry="0.18" fill="#00000033"/>` +
        `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#ffffff22"/>` +
        // Cara superior (profundidad de caja vista desde arriba), DENTRO de la caja para no alterar
        // la anchura medida.
        `<path d="M${x0} ${y0} L${(x0 + 0.18).toFixed(2)} ${(y0 + 0.16).toFixed(2)} L${(x0 + W - 0.18).toFixed(2)} ${(y0 + 0.16).toFixed(2)} L${(x0 + W).toFixed(2)} ${y0} Z" fill="${c}" opacity="0.45"/>` +
        `<path d="M${(x0 + W / 3).toFixed(2)} ${y0} L${(x0 + W / 3).toFixed(2)} ${(y0 + H).toFixed(2)} M${(x0 + (2 * W) / 3).toFixed(2)} ${y0} L${(x0 + (2 * W) / 3).toFixed(2)} ${(y0 + H).toFixed(2)} M${x0} ${(y0 + H / 2).toFixed(2)} L${(x0 + W).toFixed(2)} ${(y0 + H / 2).toFixed(2)}" stroke="#ffffff66" stroke-width="0.07"/>` +
        `<rect x="${x0 - gs}" y="${y0 - gs}" width="${(W + gs * 2).toFixed(2)}" height="${gs}" fill="${c}" stroke="#20242a" stroke-width="0.08"/>` +
        `<rect x="${x0 - gs}" y="${y0}" width="${gs}" height="${(H + gs).toFixed(2)}" fill="${c}" stroke="#20242a" stroke-width="0.08"/>` +
        `<rect x="${(x0 + W).toFixed(2)}" y="${y0}" width="${gs}" height="${(H + gs).toFixed(2)}" fill="${c}" stroke="#20242a" stroke-width="0.08"/>` +
        `<rect x="${(x0 - gs * 1.6).toFixed(2)}" y="${(y0 + H).toFixed(2)}" width="${(W + gs * 3.2).toFixed(2)}" height="${(gs * 0.7).toFixed(2)}" rx="${(gs * 0.35).toFixed(2)}" fill="${c}" stroke="#20242a" stroke-width="0.08"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'dumbbell': {
      // B2: Mancuerna / pesa — SVG vectorial ORIGINAL, transparente.
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const c = el.c ?? '#20242a';
      const g =
        `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}">` +
        `<rect x="-2.6" y="-0.5" width="3" height="1" rx="0.5"/>` +
        `<rect x="-0.4" y="-0.2" width="0.8" height="0.4" rx="0.2" transform="rotate(-45)"/>` +
        `<rect x="5.2" y="-0.5" width="3" height="1" rx="0.5"/>` +
        `<rect x="1.4" y="-0.2" width="0.8" height="0.4" rx="0.2" transform="rotate(-45)"/>` +
        `<rect x="-4" y="-0.9" width="1" height="1.8" rx="0.4"/>` +
        `<rect x="-4" y="3.1" width="1" height="1.8" rx="0.4" transform="rotate(90) translate(-4 4)"/>` +
        `<rect x="10" y="-0.9" width="1" height="1.8" rx="0.4"/>` +
        `<rect x="10" y="3.1" width="1" height="1.8" rx="0.4" transform="rotate(90) translate(-10 4)"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'hurdle': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const g =
        `<g transform="translate(${x} ${y}) scale(${materialSize(el) * objectScale})" fill="${el.c ?? '#ffffff'}" stroke="#20242a" stroke-width="0.2">` +
        `<rect x="-2.4" y="-1.9" width="4.8" height="0.55"/>` +
        `<rect x="-2.2" y="-1.4" width="0.5" height="2.6"/>` +
        `<rect x="1.7" y="-1.4" width="0.5" height="2.6"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'ring': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const g =
        `<g transform="translate(${x} ${y}) scale(${materialSize(el) * objectScale})" fill="none" stroke="${el.c ?? '#ffffff'}" stroke-width="0.5">` +
        `<ellipse cx="0" cy="0" rx="1.8" ry="0.9"/>` +
        `<ellipse cx="0" cy="0.6" rx="1.1" ry="0.45"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'ladder': {
      // ESCALERA (FASE 4 del encargo de materiales): vista DESDE ARRIBA, con DOS RAÍLES
      // longitudinales y SIETE PELDAÑOS, y una forma claramente ALARGADA (6,2 × 2,0 unidades ≈ 3:1)
      // para que no se confunda con una portería (ancha y baja) ni con una valla (más alta y con
      // huecos grandes). Antes tenía 5 peldaños y el PNG no ayudaba: con la escalera pequeña no se
      // distinguía. RECOLOREABLE con `el.c` (existe la variante amarilla).
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const c = el.c ?? '#e8edf2';
      const L = 3.1; // media longitud (eje largo, HORIZONTAL en pantalla: como el PNG anterior)
      const aw = 1.0; // media anchura
      const rail = 0.24; // grosor del raíl
      const peldaño = 0.2; // grosor del peldaño
      let peldaños = '';
      const n = 7;
      for (let i = 0; i < n; i++) {
        const xx = (-L + ((2 * L) / (n + 1)) * (i + 1)).toFixed(2);
        peldaños += `<rect x="${xx}" y="${(-aw).toFixed(2)}" width="${peldaño}" height="${(2 * aw).toFixed(2)}" rx="${(peldaño / 2).toFixed(2)}"/>`;
      }
      const g =
        `<g transform="translate(${x} ${y}) scale(${s})">` +
        `<ellipse cx="0" cy="${(aw + 0.25).toFixed(2)}" rx="${(L * 0.6).toFixed(2)}" ry="0.16" fill="#00000038"/>` +
        `<g fill="${c}" stroke="#20242a" stroke-width="0.1">` +
        `<rect x="${(-L).toFixed(2)}" y="${(-aw - rail / 2).toFixed(2)}" width="${(2 * L).toFixed(2)}" height="${rail}" rx="${(rail / 2).toFixed(2)}"/>` +
        `<rect x="${(-L).toFixed(2)}" y="${(aw - rail / 2).toFixed(2)}" width="${(2 * L).toFixed(2)}" height="${rail}" rx="${(rail / 2).toFixed(2)}"/>` +
        peldaños +
        `</g>` +
        // Tope del extremo: refuerza la lectura «escalera vista desde arriba».
        `<rect x="${(-L - rail).toFixed(2)}" y="${(-aw - rail / 2).toFixed(2)}" width="${rail}" height="${(2 * aw + rail).toFixed(2)}" rx="${(rail / 2).toFixed(2)}" fill="${c}" stroke="#20242a" stroke-width="0.1"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'pole': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const g = `<g transform="translate(${x} ${y}) scale(${materialSize(el) * objectScale})"><rect x="-0.3" y="-3" width="0.6" height="5.4" rx="0.3" fill="${el.c ?? '#ffffff'}" stroke="#20242a" stroke-width="0.2"/><ellipse cx="0" cy="2.7" rx="0.5" ry="0.22" fill="${el.c ?? '#ffffff'}" stroke="#20242a" stroke-width="0.2"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'mannequin': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const body = el.c ?? '#e8edf2';
      const g = `<g transform="translate(${x} ${y}) scale(${materialSize(el) * objectScale})"><circle cx="0" cy="-2" r="1.1" fill="${body}" stroke="#20242a" stroke-width="0.2"/><rect x="-1.1" y="-0.8" width="2.2" height="3.4" rx="0.9" fill="${body}" stroke="#20242a" stroke-width="0.2"/></g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'mannequin_row': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const body = el.c ?? '#e8edf2';
      let m = '';
      for (let i = -1; i <= 1; i++) {
        m +=
          `<circle cx="${i * 2.4}" cy="-1.8" r="0.95" fill="${body}" stroke="#20242a" stroke-width="0.18"/>` +
          `<rect x="${i * 2.4 - 0.95}" y="-0.7" width="1.9" height="3" rx="0.8" fill="${body}" stroke="#20242a" stroke-width="0.18"/>`;
      }
      const g = `<g transform="translate(${x} ${y}) scale(${materialSize(el) * objectScale})">${m}</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'goal': {
      // FASE 8C: portería FRONTAL reconocible (larguero y postes gruesos, red, fondo tenue).
      // FASE 3 del encargo de materiales: además, su anchura es la REGLAMENTARIA DEL CAMPO activo
      // (F11 7,32 m · fútbol sala 3 m × `PX_PER_M` unidades), así que coincide con la
      // portería dibujada en el campo: criterio medible anchura-material / anchura-campo = 0,90-1,10
      // (comprobado en `e2e/fase-materiales-escala.spec.ts`). Antes la portería de material se
      // reducía al cambiar de campo mientras la del campo mantenía su tamaño reglamentario, y por eso
      // NO coincidían.
      // OJO con F7: la plantilla F7 se dibuja SOBRE un medio campo F11 y la única portería DIBUJADA
      // en ese campo es la del F11 (el diseño F7 dibuja zonas, no una portería propia), así que la de
      // material usa la MISMA anchura que la visible (7,32 m), no una portería F7 de 6 m.
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const s = materialSize(el) * objectScale;
      const caja = goalBoxUnits(field); // unidades del viewBox, misma escala física que el campo
      const W = caja.w / s;
      const H = caja.h / s;
      const grosor = Math.max(0.26, W * 0.055); // marco grueso en cualquier tamaño
      const x0 = -W / 2;
      const x1 = W / 2;
      const y0 = -H / 2;
      const y1 = H / 2;
      // Red ADAPTATIVA: menos líneas (y algo más gruesas) cuando la portería es pequeña, para que no
      // se convierta en una masa gris que parece una escalera.
      const nV = W >= 5 ? 8 : 4;
      const nH = W >= 5 ? 3 : 2;
      const trazoRed = Math.max(0.09, W * 0.018);
      const verticales: string[] = [];
      for (let i = 1; i <= nV; i++) {
        const xi = (x0 + (W * i) / (nV + 1)).toFixed(2);
        verticales.push(`M${xi} ${y0.toFixed(2)} L${xi} ${y1.toFixed(2)}`);
      }
      const horizontales: string[] = [];
      for (let i = 1; i <= nH; i++) {
        const yi = (y0 + (H * i) / (nH + 1)).toFixed(2);
        horizontales.push(`M${x0.toFixed(2)} ${yi} L${x1.toFixed(2)} ${yi}`);
      }
      const g =
        `<g transform="translate(${x} ${y}) scale(${s})">` +
        `<ellipse cx="0" cy="${(y1 + grosor * 0.7).toFixed(2)}" rx="${(W * 0.46).toFixed(2)}" ry="${(grosor * 0.45).toFixed(2)}" fill="#00000033"/>` +
        `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#ffffff1f"/>` +
        // PROFUNDIDAD LATERAL (cierre del encargo): dos cuñas oscuras hacia dentro en cada extremo
        // sugieren la red lateral metida hacia atrás, para que no parezca una rejilla plana (o una
        // escalera). Se dibujan DENTRO de la caja reglamentaria, así que la anchura medida no cambia.
        `<path d="M${(x0 + grosor).toFixed(2)} ${(y0 + grosor).toFixed(2)} L${(x0 + W * 0.11).toFixed(2)} ${y1.toFixed(2)} L${(x0 + grosor).toFixed(2)} ${y1.toFixed(2)} Z" fill="#0000003d"/>` +
        `<path d="M${(x1 - grosor).toFixed(2)} ${(y0 + grosor).toFixed(2)} L${(x1 - W * 0.11).toFixed(2)} ${y1.toFixed(2)} L${(x1 - grosor).toFixed(2)} ${y1.toFixed(2)} Z" fill="#0000003d"/>` +
        `<path d="${verticales.join(' ')}" stroke="#ffffff77" stroke-width="${trazoRed.toFixed(3)}"/>` +
        `<path d="${horizontales.join(' ')}" stroke="#ffffff77" stroke-width="${trazoRed.toFixed(3)}"/>` +
        // El marco va DENTRO de la caja reglamentaria: así la anchura EXTERIOR de la portería de
        // material es exactamente `goalWidthUnits(field)` (el larguero y los postes no sobresalen) y
        // la comparación con la portería del campo sale 1,00 sin correcciones en la medición.
        `<rect x="${x0}" y="${y0}" width="${W}" height="${grosor}" fill="#ffffff"/>` +
        `<rect x="${x0}" y="${y0}" width="${grosor}" height="${H}" fill="#ffffff"/>` +
        `<rect x="${(x1 - grosor).toFixed(2)}" y="${y0}" width="${grosor}" height="${H}" fill="#ffffff"/>` +
        // Barra de base: ancla la portería al suelo y refuerza la lectura de profundidad.
        `<path d="M${x0} ${(y1 - grosor * 0.5).toFixed(2)} L${x1} ${(y1 - grosor * 0.5).toFixed(2)}" stroke="#ffffff" stroke-width="${(grosor * 0.8).toFixed(3)}"/>` +
        `</g>`;
      return rotWrap(g, el.rot, x, y);
    }
    case 'text': {
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const size = el.size ?? DEFAULT_TEXT_SIZE;
      const hasBox = !!(el.w && el.h);
      // El ancho del cuadro NO desborda el campo: como mucho hasta su borde derecho.
      const maxW = Math.max(size * 0.5, r.w - (el.x ?? 0) * r.w);
      const boxW = Math.min((el.w ?? 1) * r.w, maxW);
      const boxH = (el.h ?? 1) * r.h;
      // Con cuadro: se ajusta el texto a su ancho y SOLO se pinta cada línea que
      // cabe entera (nunca una a medio cortar); si hay sobrante se añade “…”.
      // Sin cuadro (documentos antiguos): cada `\n` es una línea, sin recorte.
      const allLines = hasBox ? wrapTextForBox(el.v ?? '', boxW, size) : (el.v ?? '').split('\n');
      const layout = hasBox
        ? textLayoutForBox(allLines, size, boxH)
        : {
            lines: allLines,
            totalLines: allLines.length,
            visibleCount: allLines.length,
            overflow: false,
          };
      const ts = layout.lines
        .map((ln, i) => {
          const yPos =
            i === 0 ? `y="${y + size * 0.8}"` : `dy="${(size * TEXT_LINE_H).toFixed(3)}"`;
          // x ligeramente dentro del cuadro para que la primera letra no roce el borde.
          return `<tspan x="${x + Math.min(1.2, size * 0.15)}" ${yPos}>${esc(ln)}</tspan>`;
        })
        .join('');
      const t = `<text font-size="${size}" fill="${el.c ?? DEFAULT_ELEMENT_COLOR}" font-weight="700" font-family="Inter, system-ui, sans-serif">${ts}</text>`;
      let body = t;
      if (hasBox) {
        // El clip es una red de seguridad (el layout ya no deja líneas cortadas).
        const cid = 'txtclip-' + String(el.id).replace(/[^a-zA-Z0-9]/g, '');
        body =
          `<defs><clipPath id="${cid}"><rect x="${x}" y="${y}" width="${boxW}" height="${boxH}"/></clipPath></defs>` +
          `<g class="board-text" clip-path="url(#${cid})">${t}</g>`;
        // El cuadro punteado es SOLO una ayuda de edición: aparece únicamente con el
        // texto seleccionado. En una pizarra limpia/miniatura/PNG no se dibuja.
        if (selected) {
          body += `<rect class="text-edit-rect" x="${x}" y="${y}" width="${boxW}" height="${boxH}" fill="rgba(255,255,255,0.06)" stroke="#ffffff44" stroke-width="0.6" stroke-dasharray="1,0.7"/>`;
        }
      }
      const cc = elementCenter(el);
      return rotWrap(body, el.rot, gx(cc.x), gy(cc.y));
    }
    case 'arrow': {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      const cx = gx((x1 + x2) / 2);
      const cy = gy((y1 + y2) / 2);
      const ls = el.lineStyle ?? el.style ?? 'solid';
      return rotWrap(
        svgLine(
          x1,
          y1,
          x2,
          y2,
          'end',
          el.c ?? DEFAULT_ELEMENT_COLOR,
          selected,
          el.strokeWidth ?? DEFAULT_STROKE_WIDTH,
          ls,
          r,
        ),
        el.rot,
        cx,
        cy,
      );
    }
    case 'line': {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      const cx = gx((x1 + x2) / 2);
      const cy = gy((y1 + y2) / 2);
      const ls = el.lineStyle ?? el.style ?? 'solid';
      return rotWrap(
        svgLine(
          x1,
          y1,
          x2,
          y2,
          'none',
          el.c ?? DEFAULT_ELEMENT_COLOR,
          selected,
          el.strokeWidth ?? DEFAULT_STROKE_WIDTH,
          ls,
          r,
        ),
        el.rot,
        cx,
        cy,
      );
    }
    case 'doubleArrow': {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      const cx = gx((x1 + x2) / 2);
      const cy = gy((y1 + y2) / 2);
      const ls = el.lineStyle ?? el.style ?? 'solid';
      const col = el.c ?? DEFAULT_ELEMENT_COLOR;
      const w = el.strokeWidth ?? DEFAULT_STROKE_WIDTH;
      // Doble sentido: una punta en CADA extremo (svgLine con 'both'), simétricas y
      // proporcionales al grosor. Ya no se superpone una segunda línea sin punta.
      const s = svgLine(x1, y1, x2, y2, 'both', col, selected, w, ls, r);
      return rotWrap(s, el.rot, cx, cy);
    }
    case 'measure': {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      const cx = gx((x1 + x2) / 2);
      const cy = gy((y1 + y2) / 2);
      const ls = el.lineStyle ?? el.style ?? 'solid';
      const col = el.c ?? DEFAULT_ELEMENT_COLOR;
      const s = svgLine(
        x1,
        y1,
        x2,
        y2,
        'none',
        col,
        selected,
        el.strokeWidth ?? DEFAULT_STROKE_WIDTH,
        ls,
        r,
      );
      const label = el.v ?? '15 m';
      const mx = gx((x1 + x2) / 2);
      const my = gy((y1 + y2) / 2);
      const txt = `<g transform="translate(${mx} ${my - 0.4})"><rect x="-2" y="-0.8" width="4" height="1.6" rx="0.3" fill="#ffffff" stroke="${col}" stroke-width="0.2"/><text text-anchor="middle" dominant-baseline="central" font-size="1.1" fill="#111111" font-weight="600">${esc(label)}</text></g>`;
      return rotWrap(s + txt, el.rot, cx, cy);
    }
    case 'dribble': {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      const cx = gx((x1 + x2) / 2);
      const cy = gy((y1 + y2) / 2);
      return rotWrap(
        svgZigzag(
          x1,
          y1,
          x2,
          y2,
          el.c ?? DEFAULT_ELEMENT_COLOR,
          selected,
          el.strokeWidth ?? DEFAULT_STROKE_WIDTH,
          el.lineStyle ?? 'solid',
          r,
        ),
        el.rot,
        cx,
        cy,
      );
    }
    case 'zone':
    case 'rect':
    case 'ellipse': {
      // Dimensiones en la geometría ACTIVA (horizontal o vertical).
      const x = gx(el.x ?? 0);
      const y = gy(el.y ?? 0);
      const w = (el.w ?? 0) * r.w;
      const h = (el.h ?? 0) * r.h;
      const cxx = x + w / 2;
      const cyy = y + h / 2;
      const contour = el.fill === false;
      const stroke = el.c ?? '#ffffff';
      // Fase 2: perímetro (c) y relleno (fillColor + fillOpacity) independientes.
      // Compatibilidad: fill:true sin fillColor/fillOpacity → c con opacidad 0.16.
      // Fase 10: el relleno usa EXACTAMENTE el mismo color que el perímetro (se ignora
      // un posible fillColor previo de forma compatible, sin romper documentos antiguos).
      let fill = 'none';
      if (!contour) {
        const fc = stroke;
        const fo = el.fillOpacity ?? 0.16;
        fill = withAlpha(fc, fo);
      }
      const body =
        el.t === 'ellipse'
          ? `<ellipse cx="${cxx}" cy="${cyy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${DEFAULT_SHAPE_STROKE}"/>`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${DEFAULT_SHAPE_STROKE}"/>`;
      return rotWrap(body, el.rot, cxx, cyy);
    }
    case 'freehand': {
      const pts = (el.points ?? []).map(([px, py]) => `${gx(px)},${gy(py)}`).join(' ');
      const c = el.c ?? DEFAULT_ELEMENT_COLOR;
      const poly = `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="${el.strokeWidth ?? DEFAULT_STROKE_WIDTH}" stroke-linejoin="round" stroke-linecap="round" opacity="${el.opacity ?? 1}"/>`;
      const cc = elementCenter(el);
      return rotWrap(poly, el.rot, gx(cc.x), gy(cc.y));
    }
    case 'curve': {
      const x1 = gx(el.x1 ?? 0);
      const y1 = gy(el.y1 ?? 0);
      const cxd = ((el.x1 ?? 0) + (el.x2 ?? 0)) / 2;
      const cyd = ((el.y1 ?? 0) + (el.y2 ?? 0)) / 2;
      const cx = gx(el.c1x ?? cxd);
      const cy = gy(el.c1y ?? cyd);
      const x2 = gx(el.x2 ?? 0);
      const y2 = gy(el.y2 ?? 0);
      const c = el.c ?? DEFAULT_ELEMENT_COLOR;
      const width = el.strokeWidth ?? DEFAULT_STROKE_WIDTH;
      let s = `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="${width}" stroke-linecap="round"/>`;
      const ang = Math.atan2(y2 - cy, x2 - cx);
      const size = arrowHeadSize(width);
      s += `<polygon points="${x2},${y2} ${x2 - size * Math.cos(ang - 0.5)},${y2 - size * Math.sin(ang - 0.5)} ${x2 - size * Math.cos(ang + 0.5)},${y2 - size * Math.sin(ang + 0.5)}" fill="${c}"/>`;
      const cc = elementCenter(el);
      return rotWrap(s, el.rot, gx(cc.x), gy(cc.y));
    }
    default:
      return '';
  }
}

/** Polígono SVG de una punta de flecha en (x,y), apuntando en la dirección `ang`,
 *  con longitud `size` (proporcional al grosor del trazo). Las dos alas retroceden
 *  `size` desde la punta formando ±0.5 rad. Se usa para flechas normales (una punta)
 *  y dobles (dos puntas), y para el zigzag (punta orientada a su último tramo). */
function arrowHeadPoly(x: number, y: number, ang: number, size: number, c: string): string {
  const p1 = `${x - size * Math.cos(ang - 0.5)},${y - size * Math.sin(ang - 0.5)}`;
  const p2 = `${x - size * Math.cos(ang + 0.5)},${y - size * Math.sin(ang + 0.5)}`;
  return `<polygon points="${x},${y} ${p1} ${p2}" fill="${c}"/>`;
}

function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  arrow: 'none' | 'end' | 'both',
  color: string,
  sel = false,
  width = DEFAULT_STROKE_WIDTH,
  lineStyle: string = 'solid',
  r: Geometry['rect'],
): string {
  const ax1 = px(x1, r);
  const ay1 = py(y1, r);
  const ax2 = px(x2, r);
  const ay2 = py(y2, r);
  const c = sel ? '#2563eb' : color;
  const dash =
    lineStyle === 'dashed'
      ? ' stroke-dasharray="2,1.3"'
      : lineStyle === 'dotted'
        ? ' stroke-dasharray="0.6,1.4"'
        : '';
  let s = `<line x1="${ax1}" y1="${ay1}" x2="${ax2}" y2="${ay2}" stroke="${c}" stroke-width="${width}"${dash}/>`;
  const size = arrowHeadSize(width);
  if (arrow === 'end' || arrow === 'both') {
    s += arrowHeadPoly(ax2, ay2, Math.atan2(ay2 - ay1, ax2 - ax1), size, c);
  }
  if (arrow === 'both') {
    s += arrowHeadPoly(ax1, ay1, Math.atan2(ay1 - ay2, ax1 - ax2), size, c);
  }
  return s;
}

export function svgZigzag(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  sel = false,
  width = DEFAULT_STROKE_WIDTH,
  lineStyle: string = 'solid',
  r: Geometry['rect'],
): string {
  const ax1 = px(x1, r);
  const ay1 = py(y1, r);
  const ax2 = px(x2, r);
  const ay2 = py(y2, r);
  const c = sel ? '#2563eb' : color;
  const dx = ax2 - ax1;
  const dy = ay2 - ay1;
  const len = Math.hypot(dx, dy) || 1;
  const pxp = -dy / len;
  const pyp = dx / len;
  // Fase 6: zigzag COMPACTO — ~el doble de frecuencia (dientes ~la mitad) y amplitud
  // reducida a la mitad de antes, para que resulte legible y no exagerado. Sigue
  // escalando con la longitud (trazos cortos reducen picos y amplitud).
  const amp = Math.min(1.5, len * 0.04);
  const n = Math.max(2, Math.min(16, Math.round(len / 3)));
  const dash =
    lineStyle === 'dashed'
      ? ' stroke-dasharray="2,1.3"'
      : lineStyle === 'dotted'
        ? ' stroke-dasharray="0.6,1.4"'
        : '';
  // Picos intermedios (i = 1..n-1); el path termina EXACTAMENTE en (ax2,ay2).
  let d = `M ${ax1} ${ay1}`;
  let lx = ax1;
  let ly = ay1;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const off = (i % 2 === 0 ? -1 : 1) * amp;
    lx = ax1 + dx * t + pxp * off;
    ly = ay1 + dy * t + pyp * off;
    d += ` L ${lx} ${ly}`;
  }
  d += ` L ${ax2} ${ay2}`;
  // La punta se orienta por la tangente del ÚLTIMO segmento real (pico previo → x2/y2),
  // no por el ángulo general inicio→fin. Así queda unida y mirando en la dirección del final.
  const ang = Math.atan2(ay2 - ly, ax2 - lx);
  const size = arrowHeadSize(width);
  const p1 = `${ax2 - size * Math.cos(ang - 0.5)},${ay2 - size * Math.sin(ang - 0.5)}`;
  const p2 = `${ax2 - size * Math.cos(ang + 0.5)},${ay2 - size * Math.sin(ang + 0.5)}`;
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${width}"${dash} stroke-linejoin="round"/><polygon points="${ax2},${ay2} ${p1} ${p2}" fill="${c}"/>`;
}

export interface RenderOptions {
  selectedId?: string | null;
  preview?: string;
  /** [Deprecado] La cuadrícula (Rejilla) fue retirada por el dueño: se IGNORA.
   *  Se conserva en la interfaz para no romper a los llamadores (board/export),
   *  pero ya no dibuja nada. Los documentos con `grid=true` se migran a `false`
   *  al cargar (ver normalizeCanvas / BoardComponent). */
  grid?: boolean;
  backgroundColor?: string;
  lineColor?: string;
  orientation?: 'horizontal' | 'vertical';
  guide?: 'none' | '2x2' | '3x3' | 'thirds' | 'lanes';
  grass?: 'stripes' | 'plain' | 'checker';
  /** Sin fondo (transparente): no se pinta la textura de césped. */
  transparent?: boolean;
  /** Manijas de selección/rotación/asas (fragmentos SVG) DENTRO del <svg>. */
  handles?: string;
  /** Overlay de Fútbol 7 transversal parametrizable. */
  f7?: F7Overlay | null;
}

/** Overlay de Fútbol 7 transversal (parametrizable y calibrable por preset). Se dibuja en el
 *  rect canónico de contenido, de modo que rota con el campo en vertical. Las
 *  proporciones vienen de f7Geometry (única fuente); este wrapper aporta el color/
 *  grosor/opacidad editables, el clip al campo y el punto central. */
function f7Svg(f7: F7Overlay, r: Geometry['rect']): string {
  const g = f7Geometry(r);
  const stroke = `stroke="${f7.color}" stroke-width="${f7.thickness}" stroke-opacity="${f7.opacity}" fill="none"`;
  let s = '';
  s += `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" ${stroke}/>`;
  for (const x of g.offsideX)
    s += `<line x1="${x}" y1="${g.y}" x2="${x}" y2="${g.y + g.h}" ${stroke}/>`;
  s += `<circle cx="${g.center.x}" cy="${g.center.y}" r="0.35" fill="${f7.color}" fill-opacity="${f7.opacity}" stroke="none"/>`;
  for (const b of g.big)
    s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" ${stroke}/>`;
  for (const b of g.small)
    s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" ${stroke}/>`;
  const clip = `<clipPath id="f7clip-${f7.color.replace('#', '')}"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}"/></clipPath>`;
  return `<defs>${clip}</defs><g clip-path="url(#f7clip-${f7.color.replace('#', '')})">${s}</g>`;
}

function guideSvg(
  guide: NonNullable<RenderOptions['guide']>,
  lc: string,
  r: Geometry['rect'],
): string {
  const lines: string[] = [];
  const push = (a: [number, number], b: [number, number]) =>
    lines.push(
      `<line x1="${px(a[0], r)}" y1="${py(a[1], r)}" x2="${px(b[0], r)}" y2="${py(b[1], r)}"/>`,
    );
  if (guide === '2x2') {
    push([0.5, 0], [0.5, 1]);
    push([0, 0.5], [1, 0.5]);
  } else if (guide === '3x3') {
    for (const f of [1 / 3, 2 / 3]) {
      push([f, 0], [f, 1]);
      push([0, f], [1, f]);
    }
  } else if (guide === 'thirds') {
    for (const f of [1 / 3, 2 / 3]) push([0, f], [1, f]);
  } else if (guide === 'lanes') {
    for (const f of [0.5]) push([f, 0], [f, 1]);
  }
  return `<g class="zone-guide" stroke="${lc}" stroke-width="0.5" stroke-dasharray="1.4,1.1" opacity="0.55">${lines.join('')}</g>`;
}

/** SVG completo de un frame (función pura: la geometría viaja explícita). */
export function renderBoardSvg(
  field: FieldType,
  elements: CanvasElement[],
  opts: RenderOptions = {},
): string {
  const orientation = opts.orientation ?? 'horizontal';
  const geo = fieldGeometry(field, orientation);
  const vbW = geo.vbW;
  const vbH = geo.vbH;
  // A7: césped OFICIAL único para el fútbol. Se ignora el backgroundColor del documento: los
  // documentos antiguos con otro color se ven con el césped oficial (no se rompe el dato, no se
  // sobrescribe al abrir).
  // CORRECCIÓN URGENTE (dueño): el FÚTBOL SALA no es césped. Su superficie es azul LISA y sus
  // áreas van rellenas de un azul más claro; `fieldSurface` es la fuente única de ambos colores,
  // compartida con la miniatura de la galería, la de biblioteca y el PNG exportado.
  const surface = fieldSurface(field);
  const bg = surface.color;
  // Fase 11: las marcas reglamentarias del campo son SIEMPRE blancas. Se ignora el
  // lineColor del documento (un antiguo con lineColor negro se ve en blanco, sin
  // romper el dato). El F7 transversal conserva su color de contraste (f7Svg).
  const lc = '#ffffff';
  // Un SOLO sistema de coordenadas para campo + elementos + asas:
  // se dibuja siempre en el espacio canónico horizontal y, en vertical, se ROTA
  // TODO el contenido. El rect canónico depende del TIPO de campo: así el medio
  // campo (52,5×68) no se estira a la caja 105×68 del campo completo.
  const contentRect = geo.rect; // rect canónico (largo→X, ancho→Y) del tipo + orientación
  // FASE 6: escala visual por campo para mantener el tamaño aparente de materiales y
  // jugadores (1 en campo completo; <1 en medio campo/F7). Solo afecta al render.
  const objectScale = fieldObjectScale(field, orientation);
  // El césped cubre EXACTAMENTE el rect de contenido (el "área usable" real), para que
  // medir `.entrenolab-grass` en los e2e dé el rectángulo del campo con SUS proporciones.
  const contentW = contentRect.w;
  const contentH = contentRect.h;
  // Transformación de orientación: en vertical, (x,y) → (Tx - y, x) con Tx para
  // centrar el campo en el viewBox. En horizontal no hay transformación.
  const isVertical = orientation === 'vertical';
  const Tx = vbW / 2 + (contentRect.y + contentRect.h / 2);
  const wrap = isVertical ? `<g transform="translate(${Tx} 0) rotate(90)">` : '<g>';

  // A7: un único césped, el de FRANJAS oficial, para el fútbol; el fútbol sala, liso y azul.
  // Se ignora la textura del documento.
  const bgStr = `<g transform="translate(${contentRect.x} ${contentRect.y})">${grassBg(bg, contentW, contentH, surface.grass)}</g>`;
  // A6/A7: franja exterior de césped LISO alrededor del campo. El grosor usa la fuente
  // ÚNICA `STRIP_FRAC` (mismo límite por eje que coord. permitidas y hit-test). Esta
  // franja se renderiza ANTES del césped (ver orden en el return), así que NO tapa el
  // césped de franjas interior: solo queda el borde liso alrededor.
  const stripPx = (STRIP_FRAC * Math.min(contentW, contentH)).toFixed(2);
  const stripStr =
    `<g class="entrenolab-strip" transform="translate(${contentRect.x} ${contentRect.y})">` +
    `<rect x="${-stripPx}" y="${-stripPx}" width="${(contentW + 2 * parseFloat(stripPx)).toFixed(2)}" height="${(contentH + 2 * parseFloat(stripPx)).toFixed(2)}" fill="${bg}" stroke="none"/>` +
    `</g>`;
  const fieldStr = fieldSvg(field, contentRect, 'horizontal').replace(
    /stroke="#ffffff"/g,
    `stroke="${lc}"`,
  );
  const els = elements
    .map((el) => {
      const s = elStr(el, el.id === opts.selectedId, contentRect, isVertical, objectScale, field);
      const inner =
        el.opacity != null && el.opacity < 1 ? `<g opacity="${el.opacity}">${s}</g>` : s;
      // Identificadores ESTABLES para las pruebas de cobertura E2E (no cambian la
      // representación): tipo de elemento (modelo real `el.t`), y para jugadores
      // lado/rol/plantilla; para materiales, el recurso PNG (`assetKind`).
      const attrs =
        `data-el-type="${el.t}"` +
        ` data-color="${el.c ?? ''}"` +
        (el.fillColor ? ` data-fill-color="${el.fillColor}"` : '') +
        (el.fillOpacity != null ? ` data-fill-opacity="${el.fillOpacity}"` : '') +
        (el.t === 'player'
          ? ` data-side="${el.side ?? ''}" data-kind="${el.type ?? ''}" data-player-id="${el.playerId ?? ''}"`
          : '') +
        (el.assetKind ? ` data-asset-kind="${el.assetKind}"` : '');
      // Pedido del dueño: los MATERIALES se ven SIEMPRE derechos por pantalla, sea cual sea el
      // tipo y la orientación del campo (un cono siempre con la base hacia abajo; portería,
      // miniportería, escalera y pica siempre con la misma orientación). El grupo exterior rota
      // 90° cuando el campo es vertical, así que el material se contrarrota -90° sobre SU punto:
      // la POSICIÓN sigue al campo, el DIBUJO no. Líneas, flechas, figuras, zonas y textos NO se
      // contrarrotan: forman parte del dibujo táctico y deben girar con el campo.
      // Se aplica al envoltorio `[data-el-type]`, sin añadir ni tocar ningún grupo interno: el
      // primer `translate(...)` del elemento sigue siendo el suyo (las pruebas que lo leen, y el
      // hit-test, no cambian).
      const upright =
        isVertical && (UPRIGHT_MATERIAL_TYPES.has(el.t) || !!el.asset)
          ? ` transform="rotate(-90 ${px(el.x ?? 0, contentRect)} ${py(el.y ?? 0, contentRect)})"`
          : '';
      return `<g ${attrs}${upright}>${inner}</g>`;
    })
    .join('');
  const guide = opts.guide && opts.guide !== 'none' ? guideSvg(opts.guide, lc, contentRect) : '';
  const f7Overlay = opts.f7?.enabled ? f7Svg(opts.f7, contentRect) : '';
  const sel = opts.selectedId ? selectionStr(elements, opts.selectedId, contentRect) : '';
  return (
    `<svg class="entrenolab-board" viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg">` +
    wrap +
    // FASE 2/A6: franja exterior de césped LISO alrededor del campo (~5 % del lado
    // corto). Se dibuja ANTES del césped (detrás), de modo que el césped de franjas
    // cubra el interior y la franja quede solo alrededor, lisa y sin rayas. Su rect es
    // más grande que el de contenido (sobresale por los cuatro lados).
    (opts.transparent ? '' : stripStr) +
    // El césped se agrupa con una clase estable para poder MEDIR en los e2e el
    // rectángulo real del campo renderizado (el "área usable") frente al host.
    (opts.transparent ? '' : `<g class="entrenolab-grass">${bgStr}</g>`) +
    `<g fill="none" stroke="${lc}" stroke-width="${FIELD_LINE_WIDTH}" stroke-linecap="round">${fieldStr}</g>` +
    f7Overlay +
    guide +
    `<g>${els}</g>` +
    sel +
    (opts.handles ?? '') +
    // La preview del gesto de dibujo va en un grupo con clase ESTABLE: antes se insertaba
    // suelta y las pruebas tenían que localizarla por su color de trazo (`stroke="#1f2933"`),
    // es decir, quedaban acopladas al color por defecto (al cambiarlo a blanco dejaron de
    // encontrar la preview). Se emite solo si hay preview, para no añadir un grupo vacío.
    (opts.preview ? `<g class="board-preview">${opts.preview}</g>` : '') +
    `</g>` +
    `</svg>`
  );
}

function selectionStr(elements: CanvasElement[], id: string, r: Geometry['rect']): string {
  const el = elements.find((e) => e.id === id);
  if (!el) return '';
  if (
    el.t === 'player' ||
    el.t === 'ball' ||
    el.t === 'cone' ||
    el.t === 'marker' ||
    el.t === 'hurdle' ||
    el.t === 'ring' ||
    el.t === 'ladder' ||
    el.t === 'mannequin' ||
    el.t === 'mannequin_row' ||
    el.t === 'minigoal' ||
    el.t === 'goal' ||
    el.t === 'pole' ||
    el.t === 'flag' ||
    el.t === 'trampoline' ||
    el.t === 'target' ||
    el.t === 'net' ||
    el.t === 'vball' ||
    el.t === 'coachC' ||
    el.t === 'peto' ||
    el.t === 'chaleco' ||
    el.t === 'bosu' ||
    el.t === 'fitball' ||
    el.t === 'pica'
  ) {
    const x = px(el.x ?? 0, r);
    const y = py(el.y ?? 0, r);
    return `<circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="#2563eb" stroke-width="${SEL_STROKE_POINT}" stroke-dasharray="1,0.7"/>`;
  }
  if (el.t === 'text') {
    // La selección del texto la representan el cuadro punteado (.text-edit-rect),
    // las manijas de redimensionado y la manija de rotación. Un círculo centrado
    // en el origen taparía los primeros glifos, así que aquí no se pinta nada.
    return '';
  }
  if (
    el.t === 'arrow' ||
    el.t === 'line' ||
    el.t === 'dribble' ||
    el.t === 'doubleArrow' ||
    el.t === 'measure'
  ) {
    return svgLine(
      el.x1 ?? 0,
      el.y1 ?? 0,
      el.x2 ?? 0,
      el.y2 ?? 0,
      el.t === 'line' ? 'none' : el.t === 'doubleArrow' ? 'both' : 'end',
      '#2563eb',
      true,
      0.8,
      'solid',
      r,
    );
  }
  if (el.t === 'zone' || el.t === 'rect') {
    const x = px(el.x ?? 0, r);
    const y = py(el.y ?? 0, r);
    return `<rect x="${x}" y="${y}" width="${(el.w ?? 0) * r.w}" height="${(el.h ?? 0) * r.h}" fill="none" stroke="#2563eb" stroke-width="${SEL_STROKE}" stroke-dasharray="1,0.7"/>`;
  }
  return '';
}
