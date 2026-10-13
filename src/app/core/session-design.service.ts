import { Injectable } from '@angular/core';
import { Session } from './models';

interface SessionDesign {
  session: Session;
  taskId: string;
  exerciseId: string;
  baseline: string;
}

/** Borrador de retorno de pizarra, aislado por equipo y por usuario, solo en esta pestaña. */
@Injectable({ providedIn: 'root' })
export class SessionDesignService {
  private key(context: string): string {
    return `cdmplab:session-design:v1:${context}`;
  }
  put(context: string, value: SessionDesign): void {
    sessionStorage.setItem(this.key(context), JSON.stringify(value));
  }
  take(context: string): SessionDesign | null {
    const key = this.key(context);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as SessionDesign;
    if (
      !value?.session ||
      !Array.isArray(value.session.tasks) ||
      typeof value.taskId !== 'string' ||
      typeof value.exerciseId !== 'string'
    ) {
      throw new Error('El borrador de sesión no es válido.');
    }
    sessionStorage.removeItem(key);
    return value;
  }
}
