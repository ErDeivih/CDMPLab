import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { AuthCardComponent } from './auth-card.component';
import type { TeamInvitationInfo } from '../../core/repositories/data-source';

@Component({
  selector: 'app-invitations',
  templateUrl: './invitations.component.html',
  imports: [AuthCardComponent, RouterLink],
})
export class InvitationsComponent {
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  protected readonly invitations = signal<TeamInvitationInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  private readonly MIN = 15 * 1000;

  async ngOnInit(): Promise<void> {
    await this.load();
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

  protected async reject(inv: TeamInvitationInfo): Promise<void> {
    this.busyId.set(inv.id);
    this.error.set(null);
    try {
      await this.access.cancelInvitation(inv.id);
      await this.load();
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'No se pudo rechazar la invitación.');
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
    if (msg.includes('invitation_not_available')) return 'La invitación ya no está disponible (caducó, se rechazó o se aceptó).';
    if (msg.includes('profile_not_approved')) return 'Tu perfil todavía no ha sido aprobado.';
    if (msg.includes('email_not_confirmed')) return 'Confirma tu correo antes de aceptar la invitación.';
    return msg;
  }
}
