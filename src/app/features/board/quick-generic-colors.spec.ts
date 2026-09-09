import { describe, expect, it } from 'vitest';
import { QUICK_GENERIC_COLORS } from './formations';

describe('Bloque C1 / F #12 — fichas rápidas de jugador genérico por color', () => {
  it('expone al menos cinco fichas de color (azul, rojo, amarillo, verde, morado)', () => {
    const labels = QUICK_GENERIC_COLORS.map((q) => q.label);
    for (const l of ['Azul', 'Rojo', 'Amarillo', 'Verde', 'Morado']) {
      expect(labels, `falta la ficha ${l}`).toContain(l);
    }
    expect(QUICK_GENERIC_COLORS.length, 'al menos 5 colores').toBeGreaterThanOrEqual(5);
  });

  it('todos los colores son distintos (diferenciación por color, no por concepto)', () => {
    const colors = QUICK_GENERIC_COLORS.map((q) => q.c);
    expect(new Set(colors).size, 'sin colores duplicados').toBe(colors.length);
    for (const c of colors) {
      expect(c, 'color hex válido').toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
