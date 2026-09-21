import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessService } from '../../core/access.service';
import { AuthCardComponent } from './auth-card.component';
import type { TeamRequestInfo } from '../../core/repositories/data-source';

const PALETTE = ['#c8102e', '#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111'];

/**
 * SOLICITUD de equipo.
 *
 * CAMBIO DE CONTRATO (cierre del encargo, 22/09/2026): esta pantalla ANTES creaba el equipo
 * (`AccessService.createTeam` → RPC `create_my_team`). El servidor ya no permite que una
 * cuenta aprobada cree su equipo: se presenta una solicitud y la aprueba un administrador de
 * plataforma, que es quien provoca la creación real dentro de la misma transacción. Aquí se
 * muestra el estado (pendiente / rechazada) y se permite corregir y volver a enviar.
 */
@Component({
  selector: 'app-onboarding-team',
  templateUrl: './onboarding-team.component.html',
  imports: [FormsModule, AuthCardComponent],
})
export class OnboardingTeamComponent {
  private readonly access = inject(AccessService);

  protected readonly palette = PALETTE;
  protected readonly name = signal('');
  protected readonly color = signal(PALETTE[0]);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal<string | null>(null);

  /** Estado actual de la solicitud, según la resolución de acceso ya cargada. */
  protected readonly solicitud = this.access.teamRequest;

  constructor() {
    // Si ya pedía un equipo, el formulario se precarga con lo pedido (y el envío lo actualiza).
    const actual: TeamRequestInfo | null = this.access.teamRequest();
    if (actual) {
      this.name.set(actual.name);
      this.color.set(actual.accentColor);
    }
  }

  protected setColor(c: string): void {
    this.color.set(c);
  }

  protected onNameInput(evt: Event): void {
    this.name.set((evt.target as HTMLInputElement).value);
  }

  /** Etiqueta honesta: enviar, actualizar o volver a solicitar. */
  protected etiquetaEnvio(): string {
    const actual = this.solicitud();
    if (actual?.status === 'pending') return 'Actualizar solicitud';
    if (actual?.status === 'rejected') return 'Volver a solicitar';
    return 'Enviar solicitud';
  }

  protected fecha(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  async enviarSolicitud(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.error.set('El nombre del equipo es obligatorio.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.sent.set(null);
    try {
      await this.access.requestTeamCreation(name, this.color());
      // El equipo NO existe todavía: la creación la provoca el administrador al aprobar.
      this.sent.set(
        'Solicitud enviada. Un administrador la revisará; cuando la apruebe, el equipo se crea y podrás entrar.',
      );
    } catch (e) {
      this.error.set(this.friendly((e as Error)?.message ?? 'No se pudo enviar la solicitud.'));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Vuelve a resolver el acceso para ver el estado más reciente de la solicitud. */
  async refresh(): Promise<void> {
    this.error.set(null);
    this.sent.set(null);
    try {
      await this.access.refresh();
      const actual = this.access.teamRequest();
      if (actual) {
        this.name.set(actual.name);
        this.color.set(actual.accentColor);
      }
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'No se pudo actualizar el estado.');
    }
  }

  private friendly(msg: string): string {
    if (msg.includes('profile_not_approved')) return 'Tu perfil todavía no ha sido aprobado.';
    if (msg.includes('team_name_required')) return 'El nombre del equipo es obligatorio.';
    if (msg.includes('team_name_too_long')) return 'El nombre del equipo es demasiado largo (máx. 80).';
    if (msg.includes('invalid_accent_color')) return 'El color del equipo no es válido.';
    if (msg.includes('already_has_team')) return 'Ya tienes un equipo; no hace falta solicitar otro.';
    if (msg.includes('team_creation_requires_approval'))
      return 'El equipo lo crea el servidor cuando un administrador aprueba la solicitud.';
    return msg;
  }
}
