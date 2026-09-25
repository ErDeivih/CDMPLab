// =============================================================
// EntrenoLab — Registro canónico de materiales (B1).
//
// Fuente ÚNICA del CATÁLOGO VISIBLE de materiales. Para cada material define:
//   - id            (clave canónica del elemento/assetKind)
//   - title         (nombre visible)
//   - group         (grupo visual del panel)
//   - icon          (icono del panel, Material Symbols)
//   - help          (texto de ayuda/tooltip)
//   - visibility    (`hidden` = retirado del catálogo nuevo: se oculta, pero el
//                    documento antiguo sigue abriendo y renderizándose)
//   - colorability  (`colorable`/`colorDefault` para los recoloreables)
//   - point         (todos los materiales son puntuales: sin cuadro/asas de resize)
//
// NO es la fuente de los RECURSOS GRÁFICOS (PNG/SVG) ni de los TAMAÑOS de render.
// Esos viven en `tactic-assets.ts` (`materialAsset` / `materialBaseSize`), que es la
// fuente de recursos y tamaños. El producto los referencia por id (la UI del panel,
// el render y la IA ya lo hacen a través de `tactic-assets`/helpers, no duplicando
// listas de materiales en `board.component.ts` o en el menú de la IA).
//
// Los ids de ELEMENTO (`t`/assetKind) NO cambian: un ejercicio antiguo con `vball`/
// `marker`/`target`/`coachC`/`net`/`fitball` sigue abriendo y renderizándose; solo se
// PRESENTA con el nombre canónico nuevo.
//
// Compatibilidad (documentos antiguos → presentación):
//   vball      → Fitball
//   marker     → BOSU
//   target     → Chino (recoloreable)
//   coachC     → retirado (se oculta, pero el documento sigue abriendo)
//   net        → retirado (se oculta, pero el documento sigue abriendo)
//   fitball    → Fitball (duplicado con vball; se oculta el naranja)
//   ring_flat  → retirado (aro naranja duplicado)
// =============================================================

/** Un material del catálogo canónico. */
export interface CanonicalMaterial {
  /** Id canónico del material (nuevo catálogo). */
  id: string;
  /** Nombre visible (catálogo final). */
  title: string;
  /** Grupo visual. */
  group: string;
  /** Icono del panel (Material Symbols). */
  icon: string;
  /** Texto de ayuda (tooltip del panel). */
  help: string;
  /** true = material PUNTUAL (sin cuadro/asas de redimensionado). Todos los materiales lo son. */
  point: boolean;
  /** Si admite cambio de color. */
  colorable?: boolean;
  /** Color inicial si es recoloreable. */
  colorDefault?: string;
  /** true = retirado del catálogo visible (se conserva para compatibilidad). */
  hidden?: boolean;
  /** Tamaño relativo vs el cono (1 = igual; <1 más pequeño; >1 mayor). */
  scale?: number;
}

/** Catálogo canónico (B1). Los `hidden` se ocultan de la UI pero sus
 *  documentos/gestos antiguos siguen siendo válidos. */
export const CANONICAL_MATERIALS: readonly CanonicalMaterial[] = [
  {
    id: 'ball',
    title: 'Balón',
    group: 'Balones',
    icon: 'sports_soccer',
    help: 'Balón de fútbol',
    point: true,
  },
  {
    id: 'vball',
    title: 'Fitball',
    group: 'Balones',
    icon: 'sports_volleyball',
    help: 'Fitball',
    point: true,
  },
  {
    id: 'cone',
    title: 'Cono',
    group: 'Señalización',
    icon: 'change_history',
    help: 'Cono de señalización',
    point: true,
    scale: 1,
  },
  {
    id: 'target',
    title: 'Chino',
    group: 'Señalización',
    icon: 'radio_button_checked',
    help: 'Chino recoloreable',
    point: true,
    colorable: true,
    colorDefault: '#2c7be5',
    scale: 0.8,
  },
  {
    id: 'flag',
    title: 'Banderín',
    group: 'Señalización',
    icon: 'flag',
    help: 'Banderín',
    point: true,
  },
  // FASE 8D del encargo: el nombre visible es «Pica» (antes «Pica coloreable»). El ID interno
  // sigue siendo `pica` y el `t` de los elementos guardados NO cambia: los documentos antiguos
  // y las copias de seguridad siguen siendo válidos.
  {
    id: 'pica',
    title: 'Pica',
    group: 'Señalización',
    icon: 'straighten',
    help: 'Pica',
    point: true,
    colorable: true,
    colorDefault: '#ffffff',
  },
  {
    id: 'pole',
    title: 'Pértiga / poste',
    group: 'Porterías y redes',
    icon: 'straighten',
    help: 'Pértiga o poste',
    point: true,
  },
  {
    id: 'mannequin',
    title: 'Maniquí individual',
    group: 'Porterías y redes',
    icon: 'accessibility_new',
    help: 'Maniquí individual',
    point: true,
  },
  {
    id: 'mannequin_row',
    title: 'Barrera de maniquíes',
    group: 'Porterías y redes',
    icon: 'accessibility_new',
    help: 'Barrera de maniquíes',
    point: true,
  },
  {
    id: 'minigoal',
    title: 'Miniportería',
    group: 'Porterías y redes',
    icon: 'sports',
    help: 'Miniportería',
    point: true,
  },
  {
    id: 'goal',
    title: 'Portería grande',
    group: 'Porterías y redes',
    icon: 'sports',
    help: 'Portería grande',
    point: true,
  },
  {
    id: 'ladder',
    title: 'Escalera',
    group: 'Coordinación',
    icon: 'format_list_numbered',
    help: 'Escalera de coordinación',
    point: true,
  },
  {
    id: 'hurdle',
    title: 'Valla',
    group: 'Coordinación',
    icon: 'looks_one',
    help: 'Valla de entrenamiento',
    point: true,
  },
  {
    id: 'ring',
    title: 'Aro',
    group: 'Coordinación',
    icon: 'radio_button_unchecked',
    help: 'Aro recoloreable',
    point: true,
    colorable: true,
    colorDefault: '#e8c3c9',
  },
  {
    id: 'trampoline',
    title: 'Minitrampolín',
    group: 'Coordinación',
    icon: 'airline_seat_flat',
    help: 'Minitrampolín',
    point: true,
  },
  {
    id: 'peto',
    title: 'Peto',
    group: 'Preparación física',
    icon: 'checkroom',
    help: 'Peto',
    point: true,
  },
  {
    id: 'chaleco',
    title: 'Chaleco lastrado',
    group: 'Preparación física',
    icon: 'checkroom',
    help: 'Chaleco lastrado',
    point: true,
  },
  {
    id: 'marker',
    title: 'BOSU',
    group: 'Preparación física',
    icon: 'label',
    help: 'BOSU',
    point: true,
  },
  {
    id: 'dumbbell',
    title: 'Mancuerna / pesa',
    group: 'Preparación física',
    icon: 'fitness_center',
    help: 'Mancuerna o pesa',
    point: true,
  },
  // Retirados (compatibilidad): se ocultan, pero sus documentos siguen abriendo.
  {
    id: 'fitball',
    title: 'Fitball',
    group: 'Otros',
    icon: 'sports_soccer',
    help: 'Fitball',
    point: true,
    hidden: true,
  },
  {
    id: 'coachC',
    title: 'Marcador C',
    group: 'Otros',
    icon: 'pin',
    help: 'Marcador C',
    point: true,
    hidden: true,
  },
  {
    id: 'net',
    title: 'Red',
    group: 'Otros',
    icon: 'grid_on',
    help: 'Red',
    point: true,
    hidden: true,
  },
  {
    id: 'ring_flat',
    title: 'Aro plano',
    group: 'Otros',
    icon: 'radio_button_unchecked',
    help: 'Aro plano',
    point: true,
    hidden: true,
  },
  {
    id: 'bosu',
    title: 'BOSU',
    group: 'Otros',
    icon: 'landscape',
    help: 'BOSU',
    point: true,
    hidden: true,
  },
];

/** Título canónico de un id de material (o el id si no se conoce). */
export function canonicalTitle(id: string): string {
  return CANONICAL_MATERIALS.find((c) => c.id === id)?.title ?? id;
}

/** Catálogo visible (sin los retirados). */
export function visibleMaterials(): readonly CanonicalMaterial[] {
  return CANONICAL_MATERIALS.filter((c) => !c.hidden);
}

/** Mapeo de alias: id antiguo → id canónico al presentar. Un ejercicio con el id
 *  antiguo se PRESENTA con el canónico, sin reescribir el documento. */
export const MATERIAL_ALIAS: Record<string, string> = {
  vball: 'vball', // sigue siendo vball en el modelo, se presenta como Fitball
  marker: 'marker',
  target: 'target',
  fitball: 'fitball',
};

/** Id canónico de un material oculto (para saber a qué grupo/nombre corresponde). */
export function isRetiredMaterial(id: string): boolean {
  return CANONICAL_MATERIALS.some((c) => c.id === id && c.hidden);
}

/** Variantes de color admitidas por el Chino (recoloreable). Se usa un ÚNICO recurso
 *  SVG vectorial con 5+ colores; no se crean imágenes rasterizadas. */
export const CHINO_COLORS = [
  '#2c7be5',
  '#f6c945',
  '#e74c3c',
  '#e8edf2',
  '#a855f7',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#111111',
  '#06b6d4',
];

/** SVG vectorial ORIGINAL del Chino (FASE 8B), transparente y recoloreable.
 *
 *  Antes eran dos elipses apiladas con un rectángulo: se leía como un disco plano sin volumen.
 *  Ahora es un platillo deportivo visto LIGERAMENTE DESDE ARRIBA: sombra de apoyo en el suelo,
 *  pared del plato (más oscura abajo, que es lo que da la perspectiva), aro exterior y superficie
 *  interior con un reflejo tenue. Todo deriva del color activo (`c` o `c` con opacidad), así que
 *  sigue siendo recoloreable; sin fotografía y con el fondo transparente. */
export function chinoSvg(color = '#2c7be5'): string {
  const c = color || '#2c7be5';
  return (
    `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-10 16 16)">` +
    `<ellipse cx="16" cy="22.4" rx="12.2" ry="3.4" fill="#000000" opacity="0.18"/>` +
    `<path d="M3.8 16.6 A12.2 5.6 0 0 0 28.2 16.6 L25.4 20.3 A9.2 4 0 0 1 6.6 20.3 Z" fill="${c}" opacity="0.62"/>` +
    `<ellipse cx="16" cy="16.8" rx="12.2" ry="5.6" fill="${c}"/>` +
    `<ellipse cx="16" cy="16.3" rx="8.6" ry="3.6" fill="#ffffff" opacity="0.22"/>` +
    `<ellipse cx="16" cy="16.3" rx="2.2" ry="0.9" fill="${c}" opacity="0.85"/>` +
    `</g></svg>`
  );
}

/** SVG vectorial ORIGINAL de la Mancuerna (pesa), transparente. */
export function dumbbellSvg(): string {
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g fill="#20242a"><rect x="6" y="12" width="3" height="8" rx="1"/><rect x="23" y="12" width="3" height="8" rx="1"/><rect x="9" y="14" width="14" height="4" rx="1.5"/><rect x="4" y="10" width="4" height="12" rx="1.5"/><rect x="24" y="10" width="4" height="12" rx="1.5"/></g></svg>`;
}

/** SVG vectorial ORIGINAL de la Valla de entrenamiento, transparente. */
export function hurdleSvg(color = '#e8edf2'): string {
  const c = color || '#e8edf2';
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g stroke="${c}" stroke-width="2" fill="none"><rect x="6" y="14" width="20" height="4" rx="2"/><line x1="8" y1="18" x2="8" y2="7"/><line x1="24" y1="18" x2="24" y2="7"/></g><rect x="4" y="6" width="24" height="2" fill="${c}"/></svg>`;
}
