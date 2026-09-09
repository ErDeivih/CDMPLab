// =============================================================
// EntrenoLab — Nombre de archivo seguro (FASE 7).
// Convierte un título de ejercicio en un nombre de PNG compatible con
// Windows: minúsculas, separa palabras con guiones, elimina caracteres
// no permitidos y usa 'cdmplab-pizarra' si no hay título. Función pura
// y comprobable.
// =============================================================

/** Caracteres no permitidos en nombres de archivo de Windows. */
const INVALID = /[<>:"/\\|?*\u0000-\u001f]+/g;
/** Caracteres que se eliminan también por limpieza (paréntesis/espacios redundantes). */
const CLEAN = /[()[\]]/g;

/** Produce el nombre de archivo (sin extensión) a partir del título del ejercicio. */
export function sanitizeFileName(title: string | null | undefined): string {
  const base = (title ?? '').trim();
  if (!base) return 'cdmplab-pizarra';
  const slug = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // sin diacríticos
    .replace(INVALID, '')
    .replace(CLEAN, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  return slug || 'cdmplab-pizarra';
}

/** Nombre de archivo PNG con extensión. */
export function pngFileName(title: string | null | undefined): string {
  return `${sanitizeFileName(title)}.png`;
}
