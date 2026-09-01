import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { AuthCardComponent } from './auth-card.component';

const PALETTE = ['#c8102e', '#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111'];

@Component({
  selector: 'app-onboarding-team',
  templateUrl: './onboarding-team.component.html',
  imports: [FormsModule, AuthCardComponent],
})
export class OnboardingTeamComponent {
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  protected readonly palette = PALETTE;
  protected readonly name = signal('');
  protected readonly color = signal(PALETTE[0]);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected setColor(c: string): void {
    this.color.set(c);
  }

  protected onNameInput(evt: Event): void {
    this.name.set((evt.target as HTMLInputElement).value);
  }

  /** Detecta datos locales antiguos para ofrecer la migración al nuevo equipo. */
  protected get hasLocalLegacyData(): boolean {
    return this.detectLocalLegacyData();
  }

  private detectLocalLegacyData(): boolean {
    for (const k of ['entrenolab:teams', 'entrenolab:players', 'entrenolab:exercises', 'entrenolab:sessions']) {
      try {
        const raw = localStorage.getItem(k);
        if (raw && JSON.parse(raw).length > 0) return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.error.set('El nombre del equipo es obligatorio.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      await this.access.createTeam(name, this.color());
      // AccessService ya conecta el repositorio y activa el equipo en el store.
      if (this.detectLocalLegacyData()) {
        await this.router.navigate(['/onboarding/migrate']);
      } else {
        await this.router.navigate(['/team']);
      }
    } catch (e) {
      this.error.set(this.friendly((e as Error)?.message ?? 'No se pudo crear el equipo.'));
    } finally {
      this.submitting.set(false);
    }
  }

  private friendly(msg: string): string {
    if (msg.includes('profile_not_approved')) return 'Tu perfil todavía no ha sido aprobado.';
    if (msg.includes('team_name_required')) return 'El nombre del equipo es obligatorio.';
    if (msg.includes('invalid_accent_color')) return 'El color del equipo no es válido.';
    if (msg.includes('teams_owner_unique') || msg.includes('already has')) return 'Ya tienes un equipo creado.';
    return msg;
  }
}
