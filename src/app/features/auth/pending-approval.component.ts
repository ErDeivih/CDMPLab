import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { SupabaseService } from '../../core/supabase.service';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-pending-approval',
  templateUrl: './pending-approval.component.html',
  imports: [AuthCardComponent],
})
export class PendingApprovalComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  protected readonly email = computed(() => this.supabase.user()?.email ?? '');
  protected readonly displayName = computed(() => this.supabase.profile()?.displayName ?? '');

  protected readonly checking = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * Vuelve a consultar el estado de la cuenta y deja que los guards decidan la ruta
   * (aprobada → equipo; aún pendiente → esta misma pantalla).
   *
   * NO hay sondeo automático cada 30 s: la aprobación es un cambio en la base que NO
   * envía ningún correo, así que el usuario es quien decide cuándo recomprobar. Con un
   * temporizador el usuario podría ser redirigido mientras lee la pantalla, y no hay
   * ningún test que cubra ese caso.
   */
  protected async recheck(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.error.set(null);
    try {
      await this.access.refresh();
      await this.router.navigate(['/']);
    } catch {
      this.error.set('No se pudo comprobar el estado de tu cuenta. Inténtalo de nuevo.');
    } finally {
      this.checking.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.router.navigate(['/auth/login']);
  }
}
