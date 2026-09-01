import { Injectable } from '@angular/core';
import { CanDeactivate } from '@angular/router';
import { BoardSessionService } from '../../core/board-session.service';

/** Comprobable: un componente puede decidir si permite salir (pizarra). */
export interface CanLeave {
  canLeave(): boolean | Promise<boolean>;
}

/** Bloquea la salida de /board si hay cambios sin guardar. */
@Injectable({ providedIn: 'root' })
export class PendingChangesGuard implements CanDeactivate<CanLeave> {
  constructor(private readonly sess: BoardSessionService) {}

  canDeactivate(component: CanLeave): boolean | Promise<boolean> {
    if (!this.sess.dirty()) return true;
    // Deja que el componente pida confirmación (diálogo propio con 3 decisiones).
    return component.canLeave();
  }
}
