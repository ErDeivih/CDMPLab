// =============================================================
// EntrenoLab — Guard de la ruta de previsualización de un borrador
// generado por IA (`/board/draft`).
//
// Lee un `AiExerciseDraftV1` serializado en sessionStorage (aislado por
// pestaña; un borrador nunca persiste de forma global entre cuentas o
// pestañas), lo valida y lo compila, y abre la pizarra con el documento
// como BORRADOR editable (sessionSvc.open con `exerciseId = null`). El
// borrador se CONSUME y se elimina al leerlo, de modo que recargar no
// reabre accidentalmente el último borrador: el usuario debe generar uno
// nuevo (o navegar con uno pendiente) para volver a verlo.
//
// NUNCA guarda automáticamente: el entrenador edita, deshace, descarta
// o guarda bajo su confirmación.
// =============================================================
import { Injectable, inject } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { loadAiDraft } from '../../core/ai/ai-draft-entry';
import { BoardSessionService } from '../../core/board-session.service';

export const AI_DRAFT_STORAGE_KEY = 'entrenolab:ai-draft';

@Injectable({ providedIn: 'root' })
export class AiDraftGuard implements CanActivate {
  private readonly router = inject(Router);
  private readonly sessionSvc = inject(BoardSessionService);

  canActivate(): boolean | UrlTree {
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : localStorage;
    const raw = storage.getItem(AI_DRAFT_STORAGE_KEY);
    if (!raw) return this.router.parseUrl('/board');
    const result = loadAiDraft(raw);
    // Consumir el borrador: no debe reabrirse al recargar ni persistir entre cuentas.
    storage.removeItem(AI_DRAFT_STORAGE_KEY);
    if (!result.ok) return this.router.parseUrl('/board');
    this.sessionSvc.open(null, result.doc, result.meta);
    return true;
  }
}

