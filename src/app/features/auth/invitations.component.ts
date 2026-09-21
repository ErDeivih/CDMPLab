import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { ConfirmService } from '../../core/confirm.service';
import { AuthCardComponent } from './auth-card.component';
import { normalizeInvitationId } from '../../core/invite-email';
import type { TeamInvitationInfo } from '../../core/repositories/data-source';

@Component({
  selector: 'app-invitations',
  templateUrl: './invitations.component.html',
  imports: [AuthCardComponent, RouterLink],
})
export class InvitationsComponent {
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);

  protected readonly invitations = signal<TeamInvitationInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /**
   * Invitación señalada por el enlace del correo (`?invitation=…`). El enlace NO concede
   * acceso: solo sirve para destacar la invitación. Aceptar sigue comprobando en el
   * servidor la identidad y el correo confirmado de quien entra.
   */
  protected readonly senalada = signal<string | null>(null);

  private readonly MIN = 15 * 1000;

  async ngOnInit(): Promise<void> {
    // Se lee el parámetro CON `get('invitation')` y no con `queryParamMap.toString()`: en
    // Angular 22 `ParamMap` no garantiza un `toString()` propio, así que serializarlo devuelve
    // el genérico de `Object` («[object Object]») y el identificador se perdía en silencio
    // (medido en la E2E: el aviso del enlace no aparecía nunca).
    this.senalada.set(normalizeInvitationId(this.route.snapshot.queryParamMap.get('invitation')));
    await this.load();
  }

  /** Mensaje cuando el enlace apunta a una invitación que esta cuenta no puede usar. */
  protected senaladaNoDisponible(): boolean {
    const id = this.senalada();
    if (!id) return false;
    return !this.invitations().some((inv) => inv.id === id);
  }

  protected esSenalada(inv: TeamInvitationInfo): boolean {
    return this.senalada() === inv.id;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.invitations.set(await this.access.listInvitations());
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'No se pudieron cargar las invitaciones.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async accept(inv: TeamInvitationInfo): Promise<void> {
    this.busyId.set(inv.id);
    this.error.set(null);
    try {
      await this.access.acceptInvitation(inv.id);
      await this.router.navigate(['/team']);
    } catch (e) {
      this.error.set(this.friendly((e as Error)?.message ?? 'No se pudo aceptar la invitación.'));
      await this.load();
    } finally {
      this.busyId.set(null);
    }
  }

  protected reject(inv: TeamInvitationInfo): void {
    // Se pregunta antes: rechazar destruye la invitación y, si te arrepientes, solo el propietario
    // del equipo puede volver a invitarte. El resto de acciones destructivas de la app ya
    // preguntaban (cancelar invitación, revocar miembro); esta se ejecutaba con un clic.
    this.confirm.ask({
      title: 'Rechazar invitación',
      message: `¿Rechazar la invitación a ${inv.teamName}? Desaparecerá de tu lista y para volver a entrar tendrías que pedirle al propietario que te invite otra vez.`,
      confirmLabel: 'Rechazar invitación',
      onConfirm: () => void this.doReject(inv),
    });
  }

  private async doReject(inv: TeamInvitationInfo): Promise<void> {
    this.busyId.set(inv.id);
    this.error.set(null);
    try {
      // RPC del INVITADO: `cancel_team_invitation` exige ser propietario del equipo y
      // devolvía siempre 'forbidden: not team owner' (el botón no hacía nada).
      await this.access.declineInvitation(inv.id);
      await this.load();
    } catch (e) {
      this.error.set(this.friendly((e as Error)?.message ?? 'No se pudo rechazar la invitación.'));
    } finally {
      this.busyId.set(null);
    }
  }

  protected expired(inv: TeamInvitationInfo): boolean {
    return new Date(inv.expiresAt).getTime() < Date.now() - this.MIN;
  }

  protected busy(inv: TeamInvitationInfo): boolean {
    return this.busyId() === inv.id;
  }

  private friendly(msg: string): string {
    if (msg.includes('invitation_not_available'))
      return 'La invitación ya no está disponible (caducó, se rechazó o se aceptó).';
    if (msg.includes('invitation_email_mismatch'))
      return 'Esta invitación pertenece a otra cuenta.';
    if (msg.includes('owner_cannot_be_collaborator'))
      return 'Eres el propietario de ese equipo: esa invitación no es tuya.';
    if (msg.includes('profile_not_approved')) return 'Tu perfil todavía no ha sido aprobado.';
    if (msg.includes('email_not_confirmed'))
      return 'Confirma tu correo antes de aceptar la invitación.';
    return msg;
  }
}
