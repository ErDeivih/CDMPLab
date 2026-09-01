import { Injectable, signal } from '@angular/core';
import { CanvasDocument } from './models';
import { DraftMeta } from './ai/ai-compiler';

export interface BoardSession {
  exerciseId: string | null;
  doc: CanvasDocument | null;
  /** Metadatos del borrador IA (si se abre un borrador nuevo): inicializan el
   *  panel "Datos del ejercicio". Para un ejercicio existente no se usan. */
  meta?: DraftMeta | null;
}

/** Estado compartido entre la biblioteca y la pizarra cuando se está
 *  diseñando un ejercicio concreto. */
@Injectable({ providedIn: 'root' })
export class BoardSessionService {
  private readonly _session = signal<BoardSession | null>(null);
  readonly session = this._session.asReadonly();

  /** Fuente única de "hay cambios sin guardar" en la pizarra. */
  private readonly _dirty = signal(false);
  readonly dirty = this._dirty.asReadonly();
  setDirty(v: boolean): void {
    this._dirty.set(v);
  }

  open(exerciseId: string | null, doc: CanvasDocument | null, meta: DraftMeta | null = null): void {
    this._session.set({ exerciseId, doc, meta });
    this._dirty.set(false);
  }

  close(): void {
    this._session.set(null);
    this._dirty.set(false);
  }
}
