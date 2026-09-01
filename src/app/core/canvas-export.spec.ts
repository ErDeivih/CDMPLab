import { describe, expect, it } from 'vitest';
import { generateThumbnail } from './canvas-export';
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
