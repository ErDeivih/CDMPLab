import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { SupabaseService } from '../../core/supabase.service';
import { ConfirmService } from '../../core/confirm.service';
import { AuthCardComponent } from './auth-card.component';
import type { TeamInvitationInfo, TeamMemberInfo } from '../../core/repositories/data-source';

const SEAT_LIMIT = 4;

@Component({
  selector: 'app-members',
  templateUrl: './members.component.html',
  imports: [FormsModule, AuthCardComponent],
})
export class MembersComponent {
  private readonly access = inject(AccessService);
  private readonly supabase = inject(SupabaseService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  protected readonly members = signal<TeamMemberInfo[]>([]);
  protected readonly invitations = signal<TeamInvitationInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly inviteEmail = signal('');
  protected readonly submitting = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);

  protected readonly isOwner = computed(() => this.access.target().role === 'owner');
  protected readonly seatsLimit = SEAT_LIMIT;

  protected readonly seatsUsed = computed(() => {
    const active = this.members().filter((m) => m.role !== 'owner').length;
    return active + this.invitations().length;
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      if (this.isOwner()) {
        const current = await this.access.listMembers();
        const invites = await this.access.listTeamInvitations();
        this.members.set(current);
        this.invitations.set(invites);
      } else {
        // Un editor NO gestiona miembros (RPC solo para propietario): vista de solo lectura.
        this.members.set([]);
        this.invitations.set([]);
      }
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'No se pudieron cargar los miembros.');
    } finally {
      this.loading.set(false);
    }
  }

  protected onInviteEmailInput(evt: Event): void {
    this.inviteEmail.set((evt.target as HTMLInputElement).value);
  }

  protected async invite(): Promise<void> {
    const email = this.inviteEmail().trim();
    if (!email) {
      this.error.set('Introduce un correo para invitar.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.success.set(null);
    try {
      await this.access.inviteMember(email);
      this.inviteEmail.set('');
      // Decisión de usabilidad (dueño): NO se envía correo personalizado, solo se
      // crea el registro de invitación. El mensaje debe ser veraz.
      this.success.set(`Invitación creada para ${email}. La persona debe registrarse en CDMPLab con esa misma dirección.`);
      await this.load();
    } catch (e) {
      this.error.set(this.friendly((e as Error)?.message ?? 'No se pudo invitar.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected cancel(inv: TeamInvitationInfo): void {
    this.confirm.ask({
      title: 'Cancelar invitación',
      message: `¿Cancelar la invitación a ${inv.emailNormalized}?`,
      confirmLabel: 'Cancelar invitación',
      onConfirm: () => {
        this.busyId.set(inv.id);
        this.error.set(null);
        this.access
          .cancelInvitation(inv.id)
          .then(() => this.load())
          .catch((e) => this.error.set((e as Error)?.message ?? 'No se pudo cancelar la invitación.'))
          .finally(() => this.busyId.set(null));
      },
    });
  }

  protected revoke(m: TeamMemberInfo): void {
    this.confirm.ask({
      title: 'Revocar editor',
      message: `¿Revocar el acceso de ${m.displayName || m.emailNormalized}? Perderá el acceso al equipo.`,
      confirmLabel: 'Revocar',
      onConfirm: () => {
        this.busyId.set(m.userId);
        this.error.set(null);
        this.access
          .revokeMember(m.userId)
          .then(() => this.load())
          .catch((e) => this.error.set((e as Error)?.message ?? 'No se pudo revocar el acceso.'))
          .finally(() => this.busyId.set(null));
      },
    });
  }

  protected busy(id: string): boolean {
    return this.busyId() === id;
  }

  protected me(userId: string): boolean {
    return this.supabase.user()?.id === userId;
  }

  private friendly(msg: string): string {
    if (msg.includes('collaborator_limit_exceeded')) return 'Se alcanzó el máximo de 4 colaboradores (activos + invitaciones pendientes).';
    if (msg.includes('invalid_invitation_email')) return 'El correo introducido no es válido.';
    if (msg.includes('collaborator_not_approved')) return 'Solo puedes invitar a personas con el perfil aprobado.';
    if (msg.includes('duplicate_invitation')) return 'Ya existe una invitación pendiente para este correo.';
    if (msg.includes('forbidden') || msg.includes('not_team_owner')) return 'Solo el propietario puede gestionar los colaboradores.';
    return msg;
  }

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.access.clear();
    await this.router.navigate(['/auth/login']);
  }
}
