import { describe, expect, it } from 'vitest';
import { generateThumbnail, imageCargada } from './canvas-export';
import { CanvasDocument } from './models';

// La animación quedó DIFERIDA por decisión del dueño: la pizarra es solo estática.
// `generateThumbnail` sigue vivo porque se usa al guardar el ejercicio (miniatura).
// Aquí se cubren sus guardas puras (sin DOM); los flujos de PNG se cubren en e2e.
describe('canvas-export (miniatura al guardar)', () => {
  it('generateThumbnail devuelve null para un documento null', async () => {
    await expect(generateThumbnail(null)).resolves.toBeNull();
  });

  it('generateThumbnail devuelve null cuando el documento no tiene fotogramas', async () => {
    const doc: CanvasDocument = { version: 2, field: 'full', frames: [] };
    await expect(generateThumbnail(doc)).resolves.toBeNull();
  });

  it('generateThumbnail devuelve null cuando el primer fotograma está vacío', async () => {
    const doc: CanvasDocument = {
      version: 2,
      field: 'full',
      frames: [{ duration: 1000, elements: [] }],
    };
    await expect(generateThumbnail(doc)).resolves.toBeNull();
  });
});

/**
 * FASE 1 del encargo — nunca una miniatura "de campo vacío".
 *
 * Antes, si el SVG no llegaba a cargarse como imagen, `exportPng` pintaba igualmente el canvas:
 * el resultado era una miniatura con el campo y SIN los objetos, imposible de distinguir de una
 * buena. Ahora se lanza un error (`generateThumbnail` → null → la tarjeta dibuja el SVG en vivo).
 */
describe('canvas-export — la imagen del SVG debe estar cargada de verdad', () => {
  it('imagen completa y con tamaño cuenta como cargada', () => {
    expect(imageCargada({ complete: true, naturalWidth: 480 })).toBe(true);
  });

  it('imagen no completa o sin tamaño NO cuenta como cargada', () => {
    expect(imageCargada({ complete: false, naturalWidth: 480 })).toBe(false);
    expect(imageCargada({ complete: true, naturalWidth: 0 })).toBe(false);
    expect(imageCargada({ complete: false, naturalWidth: 0 })).toBe(false);
  });
});
