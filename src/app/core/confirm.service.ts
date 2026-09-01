import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/** Diálogo de confirmación reutilizable (sustituye a window.confirm). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _state = signal<ConfirmRequest | null>(null);
  readonly state = this._state.asReadonly();

  ask(request: {
    title?: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }): void {
    this._state.set({
      title: request.title ?? 'Confirmar',
      message: request.message,
      confirmLabel: request.confirmLabel ?? 'Confirmar',
      onConfirm: request.onConfirm,
    });
  }

  confirm(): void {
    const s = this._state();
    if (!s) return;
    this._state.set(null);
    s.onConfirm();
  }

  cancel(): void {
    this._state.set(null);
  }
}
