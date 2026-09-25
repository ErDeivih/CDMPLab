import { inject, Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { BoardSessionService } from '../../core/board-session.service';
import { StoreService } from '../../core/store.service';

/** En la app con cuenta, la pizarra solo se abre al crear o editar un ejercicio en Biblioteca. */
@Injectable({ providedIn: 'root' })
export class ExerciseBoardGuard implements CanActivate {
  private readonly router = inject(Router);
  private readonly session = inject(BoardSessionService);
  private readonly store = inject(StoreService);

  canActivate(): boolean | UrlTree {
    // El modo local conserva la ruta directa usada por las herramientas de prueba y desarrollo.
    if (!this.store.isRemote()) return true;
    return this.session.session()?.exerciseId ? true : this.router.parseUrl('/library');
  }
}
