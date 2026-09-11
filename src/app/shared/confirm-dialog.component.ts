import { Component, inject } from '@angular/core';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-confirm',
  styleUrl: './confirm-dialog.component.scss',
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  private readonly confirmSvc = inject(ConfirmService);
  protected readonly state = this.confirmSvc.state;

  protected confirm(): void {
    this.confirmSvc.confirm();
  }
  protected cancel(): void {
    this.confirmSvc.cancel();
  }

  /**
   * Atrapa el foco dentro del diálogo: con Tab y Mayús+Tab se recorre en bucle en vez de
   * saltar al contenido de detrás (el diálogo es modal: `aria-modal="true"`). El foco
   * arranca dentro porque el botón «Cancelar» lleva `autofocus`.
   */
  protected trapTab(evt: Event): void {
    const ke = evt as KeyboardEvent;
    const host = ke.currentTarget as HTMLElement | null;
    if (!host) return;
    const focusables = Array.from(host.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && host.contains(active);
    if (ke.shiftKey) {
      if (!inside || active === first) {
        ke.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      ke.preventDefault();
      first.focus();
    }
  }
}
