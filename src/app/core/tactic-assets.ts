// =============================================================
// EntrenoLab — Manifiesto tipado de material táctico (PNG).
// Solo referencia assets que EXISTEN en public/assets/tactical/.
// Clasificación VISUAL (auditada):
//   hurdle = valla; minigoal = portería blanca; ring = aro;
//   trampoline = minitrampolín; vball = balón morado.
// 'ball' (balón de fútbol) usa ball.png (procedente de la referencia
// de PowerPoint). 'ball_vec' queda como sentinela vectorial de respaldo
// para los materiales que NO tienen PNG (fitball, coachC, peto, etc.).
//
// TAMAÑOS NORMALIZADOS (Fase 3): cada material tiene un tamaño base
// coherente (TACTICAL_SIZE) medido en unidades del viewBox canónico
// (5.2 por unidad de `size`) para que ninguno se vea diminuto y los
// elementos "de longitud de campo" (pértiga, escalera, portería, valla,
// maniquí-fila) destaquen sobre los compactos (cono, diana, marcador).
// =============================================================

export type TacticalKind =
  | 'cone_red'
  | 'cone_yellow'
  | 'cone_blue'
  | 'cone_orange'
  | 'cone_white'
  | 'cone_blue2'
  | 'mannequin'
  | 'mannequin_row'
  | 'goal'
  | 'flag'
  | 'ladder'
  | 'ladder_yellow'
  | 'hurdle'
  | 'minigoal'
  | 'ring'
  | 'ring_flat'
  | 'trampoline'
  | 'pole'
  | 'disc'
  | 'target'
  | 'net'
  | 'vball'
  | 'dumbbell'
  | 'ball_football'
  | 'ball_vec';

export interface TacticAsset {
  kind: TacticalKind;
  asset: string; // ruta publica del PNG (vacía si es vectorial)
  label: string;
  color: string;
}

// Relativa al <base href>: funciona en local (`/`) y en GitHub Pages
// (`/CDMPLab/`) sin grabar el destino de despliegue dentro del ejercicio.
const P = 'assets/tactical/';

export const TACTIC_ASSETS: TacticAsset[] = [
  { kind: 'cone_red', asset: `${P}cone-red.png`, label: 'Cono (rojo)', color: '#e74c3c' },
  { kind: 'cone_yellow', asset: `${P}cone-yellow.png`, label: 'Cono (amarillo)', color: '#f6c945' },
  { kind: 'cone_blue', asset: `${P}cone-blue.png`, label: 'Cono (azul)', color: '#2c7be5' },
  { kind: 'cone_orange', asset: `${P}cone-orange.png`, label: 'Cono (naranja)', color: '#e67e22' },
  { kind: 'cone_white', asset: `${P}cone-white.png`, label: 'Cono (blanco)', color: '#e8edf2' },
  { kind: 'cone_blue2', asset: `${P}cone-blue-2.png`, label: 'Cono (azul 2)', color: '#3b82c4' },
  { kind: 'mannequin', asset: `${P}mannequin.png`, label: 'Maniquí', color: '#e8edf2' },
  {
    kind: 'mannequin_row',
    asset: `${P}mannequin-row.png`,
    label: 'Maniquí (fila)',
    color: '#f6c945',
  },
  { kind: 'goal', asset: '', label: 'Portería grande', color: '#ffffff' },
  { kind: 'flag', asset: `${P}flag.png`, label: 'Banderín', color: '#f6c945' },
  // FASE 4 del encargo de materiales: estos cuatro se dibujan SIEMPRE en VECTOR (asset vacío) porque
  // el PNG no era reconocible a tamaño pequeño (la escalera y la miniportería se confundían entre sí
  // y con la portería). Los PNG siguen en el repositorio: los documentos antiguos conservan su
  // `asset` guardado, pero el render los pinta vectoriales por la lista `SIEMPRE_VECTOR`.
  { kind: 'ladder', asset: '', label: 'Escalera', color: '#e8edf2' },
  {
    kind: 'ladder_yellow',
    asset: '',
    label: 'Escalera (amarilla)',
    color: '#f6c945',
  },
  { kind: 'hurdle', asset: `${P}hurdle.png`, label: 'Valla', color: '#e8edf2' },
  // FASE 4: miniportería VECTORIAL (ver nota de la escalera).
  { kind: 'minigoal', asset: '', label: 'Miniportería', color: '#e8edf2' },
  { kind: 'ring', asset: `${P}ring.png`, label: 'Aro', color: '#e8c3c9' },
  { kind: 'ring_flat', asset: `${P}ring-flat.png`, label: 'Aro plano', color: '#e67e22' },
  { kind: 'trampoline', asset: `${P}trampoline.png`, label: 'Minitrampolín', color: '#e8edf2' },
  { kind: 'pole', asset: `${P}pole.png`, label: 'Pértiga', color: '#30353b' },
  { kind: 'disc', asset: '', label: 'BOSU', color: '#2c7be5' },
  { kind: 'target', asset: '', label: 'Chino', color: '#2c7be5' },
  { kind: 'net', asset: `${P}net.png`, label: 'Red / valla', color: '#e74c3c' },
  { kind: 'vball', asset: `${P}ball-purple.png`, label: 'Fitball', color: '#c98ab0' },
  { kind: 'dumbbell', asset: '', label: 'Mancuerna / pesa', color: '#20242a' },
  { kind: 'ball_football', asset: `${P}ball.png`, label: 'Balón de fútbol', color: '#ffffff' },
  { kind: 'ball_vec', asset: '', label: 'Balón (vectorial)', color: '#ffffff' },
];

export function tacticAsset(kind: TacticalKind): TacticAsset | undefined {
  return TACTIC_ASSETS.find((a) => a.kind === kind);
}

/** Asigna un asset a un id de herramienta de material ('ball' → ball_football). */
export function materialAsset(toolId: string): TacticAsset | undefined {
  const map: Record<string, TacticalKind> = {
    cone: 'cone_red',
    marker: 'disc',
    pole: 'pole',
    mannequin: 'mannequin',
    goal: 'goal',
    mannequin_row: 'mannequin_row',
    hurdle: 'hurdle',
    ring: 'ring',
    ladder: 'ladder',
    minigoal: 'minigoal',
    ball: 'ball_football',
    flag: 'flag',
    trampoline: 'trampoline',
    target: 'target',
    net: 'net',
    vball: 'vball',
    dumbbell: 'dumbbell',
  };
  const kind = map[toolId];
  return kind ? tacticAsset(kind) : undefined;
}

// =============================================================
// TAMAÑO BASE NORMALIZADO POR MATERIAL.
//
// El render dibuja el material dentro de una caja square 5.2 × size
// (unidades del viewBox canónico). Para los PNG de 150×150 la caja
// coincide con el lado largo del contenido, así que `size` controla
// directamente el lado visible: size=1 → 5.2u; size=1.6 → 8.32u.
//
// Regla de coherencia sobre un campo 105×68 (rect canónico 92×~59.6):
//   - compacto (cono, disco/diana, balón): size ≈ 0.95–1.0 → 4.9–5.2u
//   - medio (maniquí, banderín, aro, minitrampolín, red): 1.0–1.45
//   - longitud de campo (pértiga, escalera, portería, valla, maniquí-fila): 1.35–1.6
// Las claves son el `assetKind` (TacticalKind) para los PNG y el `t`
// para los materiales vectoriales que no llevan asset.
// =============================================================
export const TACTICAL_SIZE: Record<string, number> = {
  // PNG (por TacticalKind)
  cone_red: 1.0,
  cone_yellow: 1.0,
  cone_blue: 1.0,
  cone_orange: 1.0,
  cone_white: 1.0,
  cone_blue2: 1.0,
  mannequin: 1.35,
  mannequin_row: 1.55,
  goal: 1.6,
  flag: 1.25,
  ladder: 1.6,
  ladder_yellow: 1.6,
  hurdle: 1.35,
  minigoal: 1.45,
  ring: 1.0,
  ring_flat: 1.15,
  trampoline: 1.15,
  pole: 1.6,
  disc: 0.95,
  // FASE 8B: el encargo pide que el chino sea PEQUEÑO respecto al cono (1.0). Antes medía 0.95
  // (casi igual); ahora 0.62, claramente menor. Los elementos ya guardados conservan su `size`
  // persistido, así que ningún documento existente cambia de tamaño.
  target: 0.62,
  net: 1.2,
  vball: 0.95,
  ball_football: 1.5,
  ball_vec: 1.0,
  // Vectoriales (por tipo de elemento)
  coachC: 1.3,
  peto: 1.2,
  chaleco: 1.3,
  bosu: 1.5,
  fitball: 1.4,
  pica: 1.6,
  dumbbell: 1.2,
};

/** Fracción (0..1, sobre el lado LARGO de la imagen) del recuadro de contenido
 *  visible (bbox con alpha>0) respecto a la caja 5.2×size. Se usa para que la
 *  hit-box de un material estrecho (pértiga, escalera, maniquí) no abarque el
 *  hueco transparente a su lado, mientras que en los compactos la caja completa
 *  actúa de área táctil. Los valores provienen del análisis de los PNG
 *  (public/assets/tactical); ver scripts/analyze-material-pngs.mjs. */
export interface BBoxFrac {
  w: number;
  h: number;
}

export const TACTICAL_BBOX: Record<string, BBoxFrac> = {
  // PNG
  cone_red: { w: 0.56, h: 1 },
  cone_yellow: { w: 0.56, h: 1 },
  cone_blue: { w: 0.56, h: 1 },
  cone_orange: { w: 0.56, h: 1 },
  cone_white: { w: 0.56, h: 1 },
  cone_blue2: { w: 0.56, h: 1 },
  mannequin: { w: 0.28, h: 1 },
  mannequin_row: { w: 1, h: 0.733 },
  // FASE 8C: la portería grande se dibuja FRONTAL con proporción real (7,32 × 2,44 ≈ 3:1), así que
  // su caja visible es mucho más plana que antes (0.573 → 0.34). Sin este ajuste el área táctil
  // seleccionaba césped vacío por encima y por debajo del marco.
  goal: { w: 1, h: 0.34 },
  flag: { w: 0.367, h: 1 },
  ladder: { w: 1, h: 0.28 },
  ladder_yellow: { w: 0.293, h: 1 },
  hurdle: { w: 0.78, h: 1 },
  minigoal: { w: 1, h: 0.573 },
  ring: { w: 1, h: 1 },
  ring_flat: { w: 1, h: 0.36 },
  trampoline: { w: 1, h: 0.507 },
  pole: { w: 0.347, h: 1 },
  disc: { w: 1, h: 0.84 },
  // FASE 8B: el chino es un platillo PLANO (más ancho que alto): su caja visible sigue la figura y
  // no un cuadrado. Nació en 1 × 0,5 y pasó por 0,6 × 0,62.
  // Cierre del encargo de materiales: la CAJA TÁCTIL del chino se ajusta al dibujo AGRANDADO. El
  // cuerpo mide 2,0 de semiancho (+0,07 de trazo) y la sombra baja hasta 1,94 de semialto sobre una
  // caja de 5,2 unidades × size: 0,8077 → 0,81 de ancho y 0,7462 → 0,75 de alto de la MITAD de la
  // caja (antes 0,6 × 0,62 con el dibujo pequeño). El marco de selección y el hit-test usan esto,
  // así que caja y figura siguen coincidiendo.
  target: { w: 0.81, h: 0.75 },
  net: { w: 1, h: 0.96 },
  vball: { w: 1, h: 1 },
  ball_football: { w: 0.649, h: 0.635 },
  ball_vec: { w: 0.5, h: 0.5 },
  // Vectoriales
  coachC: { w: 0.654, h: 0.654 },
  peto: { w: 0.923, h: 0.731 },
  chaleco: { w: 0.615, h: 0.731 },
  bosu: { w: 0.615, h: 0.404 },
  fitball: { w: 0.692, h: 0.692 },
  pica: { w: 0.096, h: 0.923 },
};

/** Factor de reducción del tamaño INICIAL de los objetos colocados con un toque
 *  (Fase 4 → Fase 3): el dueño pide que aparezcan un 20 % más pequeños que el estado
 *  anterior, 0.75 → 0.60 · (Antes: 0.75 → ~75 %.) Aplica a materiales, jugadores y
 *  resto de objetos puntuales, y a la base de los que no llevan `size`. Es un valor
 *  del MODELO (no CSS): se persiste, se exporta y aparece en miniaturas. Para los
 *  documentos preexistentes se aplica UNA sola vez vía `normalizeCanvas` (migración
 *  por `schemaVersion`, versionada e idempotente); nunca se re-encoge en cada apertura. */
export const MATERIAL_SIZE_RATIO = 0.6;

/** Tamaño base de un material a partir de su clave (`assetKind` o `t`), ya reducido
 *  por `MATERIAL_SIZE_RATIO`: es la base que nace por defecto al colocar el objeto
 *  y la que usa el render para los elementos antiguos sin `size`. */
export function materialBaseSize(key: string | undefined): number {
  if (!key) return 1 * MATERIAL_SIZE_RATIO;
  return (TACTICAL_SIZE[key] ?? 1) * MATERIAL_SIZE_RATIO;
}

/** Fracción de recuadro de contenido de un material (bbox), o la caja completa. */
export function materialHitFrac(key: string | undefined): BBoxFrac {
  return (key && TACTICAL_BBOX[key]) || { w: 1, h: 1 };
}
