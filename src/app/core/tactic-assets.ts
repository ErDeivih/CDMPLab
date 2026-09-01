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
  | 'ball_football'
  | 'ball_vec';

export interface TacticAsset {
  kind: TacticalKind;
  asset: string; // ruta publica del PNG (vacía si es vectorial)
  label: string;
  color: string;
}

const P = '/assets/tactical/';

export const TACTIC_ASSETS: TacticAsset[] = [
  { kind: 'cone_red', asset: `${P}cone-red.png`, label: 'Cono (rojo)', color: '#e74c3c' },
  { kind: 'cone_yellow', asset: `${P}cone-yellow.png`, label: 'Cono (amarillo)', color: '#f6c945' },
  { kind: 'cone_blue', asset: `${P}cone-blue.png`, label: 'Cono (azul)', color: '#2c7be5' },
  { kind: 'cone_orange', asset: `${P}cone-orange.png`, label: 'Cono (naranja)', color: '#e67e22' },
  { kind: 'cone_white', asset: `${P}cone-white.png`, label: 'Cono (blanco)', color: '#e8edf2' },
  { kind: 'cone_blue2', asset: `${P}cone-blue-2.png`, label: 'Cono (azul 2)', color: '#3b82c4' },
  { kind: 'mannequin', asset: `${P}mannequin.png`, label: 'Maniquí', color: '#e8edf2' },
  { kind: 'mannequin_row', asset: `${P}mannequin-row.png`, label: 'Maniquí (fila)', color: '#f6c945' },
  { kind: 'flag', asset: `${P}flag.png`, label: 'Banderín', color: '#f6c945' },
  { kind: 'ladder', asset: `${P}ladder.png`, label: 'Escalera', color: '#e8edf2' },
  { kind: 'ladder_yellow', asset: `${P}ladder-yellow.png`, label: 'Escalera (amarilla)', color: '#f6c945' },
  { kind: 'hurdle', asset: `${P}hurdle.png`, label: 'Valla', color: '#e8edf2' },
  { kind: 'minigoal', asset: `${P}minigoal.png`, label: 'Miniportería', color: '#e8edf2' },
  { kind: 'ring', asset: `${P}ring.png`, label: 'Aro', color: '#e8c3c9' },
  { kind: 'ring_flat', asset: `${P}ring-flat.png`, label: 'Aro plano', color: '#e67e22' },
  { kind: 'trampoline', asset: `${P}trampoline.png`, label: 'Minitrampolín', color: '#e8edf2' },
  { kind: 'pole', asset: `${P}pole.png`, label: 'Pértiga', color: '#30353b' },
  { kind: 'disc', asset: `${P}disc.png`, label: 'Disco', color: '#2c7be5' },
  { kind: 'target', asset: `${P}target.png`, label: 'Diana', color: '#e74c3c' },
  { kind: 'net', asset: `${P}net.png`, label: 'Red / valla', color: '#e74c3c' },
  { kind: 'vball', asset: `${P}ball-purple.png`, label: 'Balón (morado)', color: '#c98ab0' },
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
  target: 0.95,
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
  target: { w: 1, h: 1 },
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
export const MATERIAL_SIZE_RATIO = 0.60;

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
