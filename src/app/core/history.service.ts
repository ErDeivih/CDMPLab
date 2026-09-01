import { Injectable, signal } from '@angular/core';

/** Estado interno completo del historial (capturado para restaurar un gesto cancelado). */
export interface HistorySnapshot<T> {
  undoStack: T[];
  redoStack: T[];
  latest: T | null;
  past: number;
  future: number;
}

/**
 * Historial de deshacer/rehacer con transacciones.
 * Se hace una SNAPSHOT al comienzo de un gesto y un COMMIT al terminar,
 * de modo que un arrastre completo es UNA acción (no una por píxel).
 * Genérico: guarda cualquier estado serializable.
 */
@Injectable({ providedIn: 'root' })
export class HistoryService<T> {
  private readonly undoStack: T[] = [];
  private readonly redoStack: T[] = [];
  private readonly _past = signal(0);
  private readonly _future = signal(0);

  readonly canUndo = this._past.asReadonly();
  readonly canRedo = this._future.asReadonly();

  private latest: T | null = null;

  /** Guarda el estado actual como punto de referencia del gesto. */
  snapshot(state: T): void {
    this.latest = this.deepClone(state);
    this.redoStack.length = 0;
    this._future.set(0);
  }

  /** Confirma que el gesto terminó: empuja el estado previo al historial. */
  commit(state: T): void {
    if (this.latest != null) {
      this.undoStack.push(this.latest);
      this._past.set(this.undoStack.length);
      this.latest = null;
    }
    // El estado actual pasa a ser referencia para el siguiente gesto si no hay snapshot ya.
    this.latest = this.deepClone(state);
  }

  /** Una instantánea del estado interno completo del historial, para poder
   *  restaurarlo EXACTAMENTE cuando un gesto de un dedo se cancela a mitad (p. ej.
   *  un pinch llega justo después de que el primer dedo empezó a mover un objeto). */
  capture(): HistorySnapshot<T> {
    return {
      undoStack: [...this.undoStack],
      redoStack: [...this.redoStack],
      latest: this.latest,
      past: this._past(),
      future: this._future(),
    };
  }

  /** Restaura el estado interno completo capturado por `capture()`. */
  restore(snap: HistorySnapshot<T>): void {
    this.undoStack.length = 0;
    this.undoStack.push(...snap.undoStack);
    this.redoStack.length = 0;
    this.redoStack.push(...snap.redoStack);
    this.latest = snap.latest;
    this._past.set(snap.past);
    this._future.set(snap.future);
  }

  /** Registra un cambio instantáneo (sin arrastre). */
  record(before: T, after: T): void {
    this.undoStack.push(this.deepClone(before));
    this._past.set(this.undoStack.length);
    this.redoStack.length = 0;
    this._future.set(0);
    this.latest = this.deepClone(after);
  }

  getUndo(): T | null {
    const prev = this.undoStack.pop();
    if (prev == null) {
      this._past.set(0);
      return null;
    }
    this._past.set(this.undoStack.length);
    if (this.latest != null) {
      this.redoStack.push(this.latest);
      this._future.set(this.redoStack.length);
    }
    // Al navegar, `latest` pasa a ser el estado al que se retrocede. Sin esto, un
    // undo→redo→undo dejaría `undoStack` con el estado REDO (en vez del previo) y
    // un solo Undo posterior no retrocedería (historial fantasma tras un gesto).
    this.latest = this.deepClone(prev);
    return prev;
  }

  getRedo(): T | null {
    const next = this.redoStack.pop();
    if (next == null) {
      this._future.set(0);
      return null;
    }
    this._future.set(this.redoStack.length);
    if (this.latest != null) {
      this.undoStack.push(this.latest);
      this._past.set(this.undoStack.length);
    }
    this.latest = this.deepClone(next);
    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.latest = null;
    this._past.set(0);
    this._future.set(0);
  }

  private deepClone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}
