import { describe, expect, it } from 'vitest';
import { HistoryService } from './history.service';

describe('HistoryService (undo/redo)', () => {
  it('undo restaura la instantánea y habilita redo', () => {
    const h = new HistoryService<string>();
    h.snapshot('A');
    h.commit('B');
    expect(h.getUndo()).toBe('A');
    expect(h.canRedo()).toBe(1);
    expect(h.getRedo()).toBe('B');
  });

  it('registra un cambio instantáneo como UNA acción y limpia redo', () => {
    const h = new HistoryService<string>();
    h.snapshot('A');
    h.commit('B'); // undo: A, latest: B
    h.getUndo(); // volvemos a A, redo: B
    h.record('B', 'C'); // nueva acción: descarta redo
    expect(h.canRedo()).toBe(0);
    expect(h.getUndo()).toBe('B');
    expect(h.canRedo()).toBe(1);
  });

  it('devuelve null cuando no hay histórico', () => {
    const h = new HistoryService<string>();
    expect(h.getUndo()).toBeNull();
    expect(h.getRedo()).toBeNull();
    expect(h.canUndo()).toBe(0);
    expect(h.canRedo()).toBe(0);
  });

  it('snapshot antes de un gesto y commit después genera un único paso', () => {
    const h = new HistoryService<string>();
    h.snapshot('P0');
    h.commit('P1'); // gesto: una acción
    h.snapshot('P1');
    h.commit('P2'); // segundo gesto: otra acción
    expect(h.getUndo()).toBe('P1');
    expect(h.getUndo()).toBe('P0');
    expect(h.getUndo()).toBeNull();
  });

  it('clear reinicia past/future', () => {
    const h = new HistoryService<string>();
    h.snapshot('A');
    h.commit('B');
    h.clear();
    expect(h.canUndo()).toBe(0);
    expect(h.canRedo()).toBe(0);
    expect(h.getUndo()).toBeNull();
  });

  it('undo→redo→undo restaura el estado previo (sin historial fantasma, transición de gesto)', () => {
    // Escenario FASE 3: una acción (p. ej. colocar un jugador) entra en el historial;
    // tras un round-trip undo→redo (como hace la UI con Ctrl+Z/Ctrl+Y) un SOLO undo
    // posterior debe volver al estado ANTERIOR a la acción, no repetir el mismo estado.
    const h = new HistoryService<{ n: number }>();
    h.snapshot({ n: 0 }); // estado previo (vacío)
    h.commit({ n: 1 }); // acción: ahora n=1
    expect(h.canUndo()).toBe(1);

    // undo → {n:0}, redo → {n:1}. Tras el round-trip, undoStack debe ser [ {n:0} ].
    expect(h.getUndo()).toEqual({ n: 0 });
    expect(h.getRedo()).toEqual({ n: 1 });
    // Un único undo deshace la acción (vuelve a {n:0}); no queda una entrada fantasma.
    expect(h.getUndo()).toEqual({ n: 0 });
    expect(h.getUndo()).toBeNull();
  });

  it('clona en profundidad (no comparte referencias)', () => {
    const h = new HistoryService<{ n: number[] }>();
    h.snapshot({ n: [1, 2] });
    h.commit({ n: [3, 4] });
    const restored = h.getUndo();
    restored!.n.push(99); // mutar lo restaurado no afecta al histórico
    expect(h.getRedo()).toEqual({ n: [3, 4] });
  });
});
