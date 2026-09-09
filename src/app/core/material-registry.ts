// =============================================================
// EntrenoLab — Registro canónico de materiales (B1).
//
// Fuente ÚNICA de: identificador visible (title), resource, tamaño base
// (recolorable), grupo, si está RETIRADO del catálogo nuevo, y la tabla de
// ALIAS de compatibilidad (ids/elementos antiguos → presentación nueva).
//
// La UI (panel de Material), el render, la IA y los tests consumen este
// registro en lugar de listas duplicadas. Los ids de ELEMENTO (`t`/assetKind)
// NO cambian: un ejercicio antiguo con `vball`/`marker`/`target`/`coachC`/
// `net`/`fitball` sigue abriendo y renderizándose; solo se PRESENTA con el
// nombre canónico nuevo.
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
  /** Si admite cambio de color. */
  colorable?: boolean;
  /** Color inicial si es recoloreable. */
  colorDefault?: string;
  /** true = retirado del catálogo visible (se conserva para compatibilidad). */
  hidden?: boolean;
  /** Tamaño relativo vs el cono (1 = igual; <1 más pequeño; >1 mayor). */
  scale?: number;
}

/** Catálogo visible final (B1). Los `hidden` se ocultan de la UI pero sus
 *  documentos/gestos antiguos siguen siendo válidos. */
export const CANONICAL_MATERIALS: readonly CanonicalMaterial[] = [
  { id: 'ball', title: 'Balón', group: 'Balones' },
  { id: 'vball', title: 'Fitball', group: 'Balones' },
  { id: 'cone', title: 'Cono', group: 'Señalización', scale: 1 },
  { id: 'target', title: 'Chino', group: 'Señalización', colorable: true, colorDefault: '#2c7be5', scale: 0.8 },
  { id: 'flag', title: 'Banderín', group: 'Señalización' },
  { id: 'pica', title: 'Pica coloreable', group: 'Señalización' },
  { id: 'pole', title: 'Pértiga / poste', group: 'Porterías y redes' },
  { id: 'mannequin', title: 'Maniquí individual', group: 'Porterías y redes' },
  { id: 'mannequin_row', title: 'Barrera de maniquíes', group: 'Porterías y redes' },
  { id: 'minigoal', title: 'Mini portería', group: 'Porterías y redes' },
  { id: 'goal', title: 'Portería grande', group: 'Porterías y redes' },
  { id: 'ladder', title: 'Escalera', group: 'Coordinación' },
  { id: 'hurdle', title: 'Valla', group: 'Coordinación' },
  { id: 'ring', title: 'Aro', group: 'Coordinación', colorable: true, colorDefault: '#e8c3c9' },
  { id: 'trampoline', title: 'Minitrampolín', group: 'Coordinación' },
  { id: 'peto', title: 'Peto', group: 'Preparación física' },
  { id: 'chaleco', title: 'Chaleco lastrado', group: 'Preparación física' },
  { id: 'marker', title: 'BOSU', group: 'Preparación física' },
  { id: 'dumbbell', title: 'Mancuerna / pesa', group: 'Preparación física' },
  // Retirados (compatibilidad): se ocultan, pero sus documentos siguen abriendo.
  { id: 'fitball', title: 'Fitball', group: 'Otros', hidden: true },
  { id: 'coachC', title: 'Marcador C', group: 'Otros', hidden: true },
  { id: 'net', title: 'Red', group: 'Otros', hidden: true },
  { id: 'ring_flat', title: 'Aro plano', group: 'Otros', hidden: true },
  { id: 'bosu', title: 'BOSU', group: 'Otros', hidden: true },
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
export const CHINO_COLORS = ['#2c7be5', '#f6c945', '#e74c3c', '#e8edf2', '#a855f7', '#22c55e'];

/** SVG vectorial ORIGINAL del Chino (disco plano), transparente y recoloreable.
 *  Se renderiza con el color activo en `fill`. No usa ninguna fotografía entregada. */
export function chinoSvg(color = '#2c7be5'): string {
  const c = color || '#2c7be5';
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-15 16 16)"><ellipse cx="16" cy="18" rx="12" ry="5" fill="${c}"/><ellipse cx="16" cy="13" rx="12" ry="5" fill="${c}" opacity="0.92"/><rect x="4" y="13" width="24" height="5" fill="${c}"/></g></svg>`;
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
