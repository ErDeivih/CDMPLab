import { describe, it, expect } from 'vitest';
import { FORMATIONS, buildFormationPlayers } from './formations';

describe('formations (módulo puro — formaciones rápidas independientes de la plantilla)', () => {
  it('genera EXACTAMENTE 11 jugadores para una formación 4-3-3 sin espejo', () => {
    const specs = buildFormationPlayers('#1a73e8', '4-3-3');
    expect(specs).toHaveLength(11);
  });

  it('todos los jugadores usan el color recibido y NO exponen side/n/dorsal/playerId/label', () => {
    const specs = buildFormationPlayers('#c0392b', '4-3-3')!;
    for (const s of specs) {
      expect(s.c).toBe('#c0392b');
      // FASE C: la diferenciación es por color, las formaciones NO asignan side ni dorsal.
      expect((s as unknown as { side?: string }).side).toBeUndefined();
      expect((s as unknown as { n?: number }).n).toBeUndefined();
      expect((s as unknown as { playerId?: string }).playerId).toBeUndefined();
      expect((s as unknown as { label?: string }).label).toBeUndefined();
    }
  });

  it('ningún jugador lleva rol especial visible (sin type/goalkeeper ni POR)', () => {
    const specs = buildFormationPlayers('#1a73e8', '4-3-3')!;
    for (const s of specs) {
      expect((s as unknown as { type?: string }).type).toBeUndefined();
    }
  });

  it('con reflectRival=true refleja en X la GEOMETRÍA (sin asignar side ni dorsal)', () => {
    const specs = buildFormationPlayers('#e6b800', '4-4-2', true)!;
    expect(specs).toHaveLength(11);
    // La diferenciación es por color; el espejo solo cambia las posiciones, no el côté.
    expect(specs.every((s) => (s as unknown as { side?: string }).side === undefined)).toBe(true);
    expect(specs.every((s) => s.c === '#e6b800')).toBe(true);
    // Reflejada en X: la posición 0 (x=0.06) pasa a 1-0.06=0.94.
    expect(specs[0].x).toBeCloseTo(0.94, 5);
  });

  it('cada formación tiene 11 posiciones y el primer círculo no es portero especial', () => {
    for (const f of FORMATIONS) {
      const specs = buildFormationPlayers('#1a73e8', f.id)!;
      expect(specs, `${f.id}`).toHaveLength(11);
      // Sin rol de portero: no hay type.
      expect((specs[0] as unknown as { type?: string }).type).toBeUndefined();
    }
  });

  it('buildFormationPlayers devuelve null para una formación desconocida', () => {
    expect(buildFormationPlayers('#1a73e8', 'no-existe')).toBeNull();
  });

  it('cubre todas las formaciones ofrecidas (4-3-3, 4-4-2, 3-5-2, 4-2-3-1, 4-1-4-1)', () => {
    const ids = FORMATIONS.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '4-1-4-1']));
  });
});
