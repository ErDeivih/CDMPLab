// =============================================================
// EntrenoLab — Nombres legibles en español de los colores.
//
// Los botones de color (`.swatch`) se pintan con un hex pero no llevan
// texto visible, así que un lector de pantalla no puede nombrarlos.
// `colorName(hex)` devuelve un nombre legible en español (p. ej.
// "#c8102e" → "rojo", "#2e7d45" → "verde oscuro", "#ffffff" → "blanco")
// que se usa para el `aria-label` y el `title` de cada swatch.
//
// Precisión para los colores REALES de la app (paleta de jugadores,
// césped, líneas, materiales) y, para cualquier otro hex válido, un
// nombre genérico por tono/luminosidad/saturación. Si el valor no es un
// hex reconocible se devuelve tal cual (último recurso).
// =============================================================

/** Nombres exactos de los colores usados por la app. */
const EXACT: Record<string, string> = {
  // Paleta de jugadores / herramientas (board y roster) + onboarding.
  '#1a73e8': 'azul',
  '#c0392b': 'rojo',
  '#1f7a4d': 'verde',
  '#e67e22': 'naranja',
  '#7d3c98': 'morado',
  '#b8860b': 'amarillo',
  '#111111': 'negro',
  '#f4f4f4': 'gris claro',
  '#c8102e': 'rojo',
  // Césped (4 tonos distinguibles por lector de pantalla).
  '#31834a': 'verde medio',
  '#2e7d45': 'verde oscuro',
  '#3a9156': 'verde claro',
  '#2b6b3f': 'verde muy oscuro',
  // Líneas del campo (blanco / oscuro).
  '#ffffff': 'blanco',
  '#1f2933': 'negro',
  // Colores de los materiales (tactic-assets).
  '#e74c3c': 'rojo',
  '#f6c945': 'amarillo',
  '#2c7be5': 'azul',
  '#3b82c4': 'azul',
  '#e8edf2': 'gris claro',
  '#30353b': 'gris oscuro',
  '#e8c3c9': 'rosa',
  '#c98ab0': 'morado',
};

/** Normaliza un hex (#rgb, #rrggbb, con o sin '#', mayúsculas) a "#rrggbb". */
function normalizeHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  let h = hex.trim().toLowerCase();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  if (h.length !== 6 || !/^[0-9a-f]{6}$/.test(h)) return null;
  return '#' + h;
}

function toRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }
  return [h * 360, s, l];
}

function hueName(h: number): string {
  if (h < 15 || h >= 345) return 'rojo';
  if (h < 45) return 'naranja';
  if (h < 70) return 'amarillo';
  if (h < 160) return 'verde';
  if (h < 200) return 'cian';
  if (h < 250) return 'azul';
  if (h < 290) return 'morado';
  return 'rosa';
}

/** Nombre genérico por tono/luminosidad/saturación para hex no catalogado. */
function genericName(hex: string): string {
  const { r, g, b } = toRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  // Acromáticos: blanco, negro y escalas de gris.
  if (s < 0.12) {
    if (l >= 0.9) return 'blanco';
    if (l <= 0.14) return 'negro';
    if (l >= 0.62) return 'gris claro';
    if (l <= 0.35) return 'gris oscuro';
    return 'gris';
  }
  const hue = hueName(h);
  if (l >= 0.82 && s <= 0.45) return `${hue} claro`;
  if (l <= 0.28) return `${hue} oscuro`;
  return hue;
}

/**
 * Nombre legible en español de un color hex (o cualquier valor). Para un hex
 * válido devuelve el nombre exacto (si es un color de la app) o un nombre
 * genérico; para valores no reconocibles devuelve el propio valor.
 */
export function colorName(hex: string | null | undefined): string {
  const h = normalizeHex(hex);
  if (!h) return (hex ?? '').trim();
  return EXACT[h] ?? genericName(h);
}

/** Forma femenina plural de un color, para contextos como "Líneas blancas". */
const FEM_PLURAL: Record<string, string> = {
  blanco: 'blancas',
  negro: 'negras',
  rojo: 'rojas',
  azul: 'azules',
  verde: 'verdes',
  naranja: 'naranjas',
  morado: 'moradas',
  amarillo: 'amarillas',
  rosa: 'rosas',
  gris: 'grises',
  cian: 'cianes',
  'gris claro': 'grises claras',
  'gris oscuro': 'grises oscuras',
  'verde oscuro': 'verdes oscuras',
  'verde medio': 'verdes medias',
  'verde claro': 'verdes claras',
  'verde muy oscuro': 'verdes muy oscuras',
  'amarillo oscuro': 'amarillas oscuras',
  'azul oscuro': 'azules oscuras',
  'rojo oscuro': 'rojas oscuras',
};

/** Nombre del color en femenino plural (p. ej. "Líneas blancas" / "negras"). */
export function colorNamePlural(hex: string | null | undefined): string {
  const n = colorName(hex);
  return FEM_PLURAL[n] ?? n;
}
