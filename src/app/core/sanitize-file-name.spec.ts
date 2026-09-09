import { describe, expect, it } from 'vitest';
import { sanitizeFileName, pngFileName } from './sanitize-file-name';

describe('sanitize-file-name (FASE 7)', () => {
  it('convierte "Rondo 4x2" en "rondo-4x2" (minúsculas, guiones)', () => {
    expect(sanitizeFileName('Rondo 4x2')).toBe('rondo-4x2');
  });

  it('sin título usa "cdmplab-pizarra"', () => {
    expect(sanitizeFileName('')).toBe('cdmplab-pizarra');
    expect(sanitizeFileName('   ')).toBe('cdmplab-pizarra');
    expect(sanitizeFileName(null)).toBe('cdmplab-pizarra');
    expect(sanitizeFileName(undefined)).toBe('cdmplab-pizarra');
  });

  it('quita caracteres no permitidos en Windows', () => {
    expect(sanitizeFileName('A:B/C\\D*E?F"G<H>I|J')).toBe('abcdefghij');
    expect(sanitizeFileName('Rondo (4x2)')).toBe('rondo-4x2');
  });

  it('elimina diacríticos', () => {
    expect(sanitizeFileName('Posesión')).toBe('posesion');
  });

  it('pngFileName añade la extensión', () => {
    expect(pngFileName('Rondo 4x2')).toBe('rondo-4x2.png');
    expect(pngFileName('')).toBe('cdmplab-pizarra.png');
  });

  it('el placeholder "Nueva pizarra" NO es una base válida: la llamada debe pasar el título REAL (o "")', () => {
    // FASE 7/A5: `title()` devuelve 'Nueva pizarra' cuando no hay título. Si el PNG
    // usara `title()` como base, saldría 'nueva-pizarra.png'. Debe pasar `metaTitle()`('')
    // → 'cdmplab-pizarra.png'. OJO: pasar el placeholder produciría 'nueva-pizarra.png'.
    expect(pngFileName('Nueva pizarra')).toBe('nueva-pizarra.png');
    expect(pngFileName(undefined)).toBe('cdmplab-pizarra.png');
  });
});
