import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { StoreService } from '../../core/store.service';
import { SupabaseService } from '../../core/supabase.service';
import { ConfirmService } from '../../core/confirm.service';
import { AuthCardComponent } from './auth-card.component';
import type { TeamInvitationInfo, TeamMemberInfo } from '../../core/repositories/data-source';
import {
  EMAIL_ATTEMPT_LIMIT,
  STORED_EMAIL_LABEL,
  canRetryInvitationEmail,
  invitationLink,
  retryWaitSeconds,
  storedEmailMessage,
  inviteEmailMessage,
  type StoredEmailStatus,
} from '../../core/invite-email';
import {
  canDeleteTeam,
  canLeaveTeam,
  canTransferOwnership,
  leaveTeamBlockedReason,
  leaveTeamConsequences,
  teamDeletionConfirmMatches,
  teamDeletionConsequences,
  teamDeletionSummary,
  transferBlockedReason,
  transferConsequences,
  type TeamDeletionPreview,
} from '../../core/team-management';

const SEAT_LIMIT = 7;

@Component({
  selector: 'app-members',
  host: { class: 'members-page' },
  templateUrl: './members.component.html',
  imports: [FormsModule, AuthCardComponent],
})
export class MembersComponent {
  private readonly access = inject(AccessService);
  private readonly store = inject(StoreService);
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
  protected readonly teamName = signal('');
  protected readonly renamingTeam = signal(false);
  /** Invitación cuyo envío de correo está en curso (para deshabilitar su botón). */
  protected readonly enviandoId = signal<string | null>(null);
  /** Salida del equipo en curso. */
  protected readonly busySalir = signal(false);

  protected readonly isOwner = computed(() => this.access.target().role === 'owner');
  protected readonly platformAdmin = this.access.platformAdmin;
  protected readonly canViewMembers = computed(() => this.isOwner() || this.platformAdmin());
  /** Rol propio en el equipo de contexto (para decidir qué acciones se ofrecen). */
  protected readonly myRole = computed(() => this.access.target().role ?? null);
  protected readonly myUserId = computed(() => this.supabase.user()?.id ?? null);
  /**
   * `true` solo cuando NO se puede gestionar y eso se debe a la falta de propiedad en un equipo
   * REMOTO. En modo local/desarrollo `isOwner()` también es falso (no hay sesión ni roles), pero
   * ahí el usuario es el dueño de sus datos: ocultarle la pantalla la dejaba vacía.
   */
  protected readonly sinGestion = computed(() => this.store.isRemote() && !this.canViewMembers());
  protected readonly seatsLimit = SEAT_LIMIT;
  protected readonly ownerCount = computed(
    () => this.members().filter((m) => m.status === 'active' && m.role === 'owner').length,
  );

  /** ¿Puede salir del equipo por su cuenta? (El propietario no: debe traspasarlo.) */
  protected readonly puedeSalir = computed(
    () =>
      this.store.isRemote() &&
      canLeaveTeam(this.myRole(), this.ownerCount()) &&
      (!this.platformAdmin() ||
        this.members().some((m) => m.userId === this.myUserId() && m.status === 'active')),
  );
  /** Motivo por el que no puede salir, cuando corresponde explicarlo. */
  protected readonly motivoNoSalir = computed(() =>
    this.store.isRemote() && this.myRole() === 'owner'
      ? leaveTeamBlockedReason('owner', this.ownerCount())
      : null,
  );

  protected readonly seatsUsed = computed(() => {
    const active = this.members().filter((m) => m.status === 'active').length;
    const now = Date.now();
    const currentInvitations = this.invitations().filter(
      (invitation) => invitation.status === 'pending' && Date.parse(invitation.expiresAt) > now,
    ).length;
    return active + currentInvitations;
  });

  /** Invitaciones vencidas bloquean re-invitar por el índice único, pero no consumen plaza. */
  protected caducada(invitation: TeamInvitationInfo): boolean {
    return Date.parse(invitation.expiresAt) <= Date.now();
  }

  /** Miembros a los que ESTE usuario puede traspasar la propiedad. */
  protected puedeTraspasarA(m: TeamMemberInfo): boolean {
    return canTransferOwnership(
      this.myRole(),
      {
        userId: m.userId,
        displayName: m.displayName,
        emailNormalized: m.emailNormalized,
        role: m.role,
        status: m.status,
      },
      this.myUserId(),
    );
  }

  protected cambiarPropiedad(m: TeamMemberInfo): void {
    const promote = m.role !== 'owner';
    const name = m.displayName || m.emailNormalized;
    this.confirm.ask({
      title: promote ? 'Añadir copropietario' : 'Cambiar a editor',
      message: promote
        ? `${name} podrá gestionar miembros y propietarios, y eliminar el equipo sin pedir aprobación a otro propietario. Tú conservarás tus permisos.`
        : `${name} conservará el acceso al contenido, pero perderá la gestión del equipo y sus miembros. Debe quedar otro propietario aprobado.`,
      confirmLabel: promote ? 'Hacer copropietario' : 'Cambiar a editor',
      onConfirm: () => {
        this.busyId.set(m.userId);
        this.error.set(null);
        this.access
          .setMemberRole(m.userId, promote ? 'owner' : 'editor')
          .then(() => this.load())
          .then(() => this.success.set(`Permisos de ${name} actualizados.`))
          .catch((error) => this.error.set((error as Error).message))
          .finally(() => this.busyId.set(null));
      },
    });
  }

  /** Salir del equipo: pérdida de acceso, así que se confirma explicando qué se pierde. */
  protected salir(): void {
    const teamName = this.store.activeTeam()?.name ?? 'este equipo';
    this.confirm.ask({
      title: 'Salir del equipo',
      message: `¿Salir de «${teamName}»? ${leaveTeamConsequences()}`,
      confirmLabel: 'Salir del equipo',
      onConfirm: () => {
        this.busySalir.set(true);
        this.error.set(null);
        this.success.set(null);
        this.access
          .leaveTeam(this.teamId())
          .then(() => {
            // Al salir se deja de pertenecer a un equipo: se va a donde el servidor diga que
            // corresponde AHORA (invitaciones si tiene alguna pendiente, o la pantalla de
            // solicitud) en vez de fijar una ruta a mano que podría no aplicarle.
            const destino = this.access.target().route || '/invitations';
            return this.router.navigate([destino]);
          })
          .catch((e) => this.error.set((e as Error)?.message ?? 'No se pudo salir del equipo.'))
          .finally(() => this.busySalir.set(false));
      },
    });
  }

  /**
   * Traspaso de propiedad: cambia QUIÉN manda en el equipo, así que la confirmación dice las
   * consecuencias para las dos partes y el servidor lo hace en una sola transacción.
   */
  protected traspasar(m: TeamMemberInfo): void {
    const nombre = m.displayName || m.emailNormalized;
    const motivo = transferBlockedReason(
      this.myRole(),
      {
        userId: m.userId,
        displayName: m.displayName,
        emailNormalized: m.emailNormalized,
        role: m.role,
        status: m.status,
      },
      this.myUserId(),
    );
    if (motivo) {
      this.error.set(motivo);
      return;
    }
    this.confirm.ask({
      title: 'Traspasar la propiedad',
      message: `¿Dar la propiedad del equipo a ${nombre}? ${transferConsequences(nombre)}`,
      confirmLabel: 'Traspasar',
      onConfirm: () => {
        this.busyId.set(m.userId);
        this.error.set(null);
        this.success.set(null);
        this.access
          .transferTeamOwnership(m.userId)
          .then(() => {
            this.success.set(`${nombre} es ahora el propietario del equipo.`);
            return this.load();
          })
          .catch((e) =>
            this.error.set((e as Error)?.message ?? 'No se pudo traspasar la propiedad.'),
          )
          .finally(() => this.busyId.set(null));
      },
    });
  }

  /** Equipo de contexto (para las RPC de pertenencia). */
  private teamId(): string {
    const id = this.access.target().teamId;
    if (!id) throw new Error('No hay equipo de contexto.');
    return id;
  }

  // ---- ZONA PELIGROSA: eliminar el equipo (propietario, con el nombre escrito) ----
  protected readonly borradoEquipo = signal<TeamDeletionPreview | null>(null);
  protected readonly borradoEquipoTyped = signal('');
  protected readonly borradoEquipoReason = signal('');
  protected readonly borradoEquipoCargando = signal(false);
  protected readonly borradoEquipoError = signal<string | null>(null);
  protected readonly borradoEquipoAbierto = signal(false);

  protected readonly borradoEquipoResumen = computed(() => {
    const preview = this.borradoEquipo();
    return preview ? teamDeletionSummary(preview) : '';
  });
  protected readonly borradoEquipoPermitido = computed(() => canDeleteTeam(this.borradoEquipo()));
  protected readonly borradoEquipoConfirmado = computed(() =>
    teamDeletionConfirmMatches(
      this.borradoEquipoTyped(),
      this.borradoEquipo()?.confirmNameRequired ?? '',
    ),
  );

  /** Abre la zona peligrosa con la vista previa del servidor (qué se borraría). */
  protected async abrirBorradoEquipo(): Promise<void> {
    this.borradoEquipoAbierto.set(true);
    this.borradoEquipo.set(null);
    this.borradoEquipoTyped.set('');
    this.borradoEquipoReason.set('');
    this.borradoEquipoError.set(null);
    this.borradoEquipoCargando.set(true);
    try {
      this.borradoEquipo.set(await this.access.teamDeletionPreview());
    } catch (e) {
      this.borradoEquipoError.set(
        (e as Error)?.message ?? 'No se pudo comprobar qué se borraría con el equipo.',
      );
    } finally {
      this.borradoEquipoCargando.set(false);
    }
  }

  protected cancelarBorradoEquipo(): void {
    this.borradoEquipoAbierto.set(false);
    this.borradoEquipo.set(null);
    this.borradoEquipoTyped.set('');
    this.borradoEquipoReason.set('');
    this.borradoEquipoError.set(null);
  }

  protected onBorradoEquipoTyped(evt: Event): void {
    this.borradoEquipoTyped.set((evt.target as HTMLInputElement).value);
  }

  protected onBorradoEquipoReason(evt: Event): void {
    this.borradoEquipoReason.set((evt.target as HTMLInputElement).value);
  }

  /**
   * Borra el equipo: además de escribir el nombre (que el SERVIDOR vuelve a comprobar), se pide
   * la confirmación del diálogo. Después el usuario se queda sin equipo y se le lleva a donde el
   * servidor diga (solicitar otro).
   */
  protected confirmarBorradoEquipo(): void {
    const preview = this.borradoEquipo();
    if (!preview || !this.borradoEquipoPermitido() || !this.borradoEquipoConfirmado()) return;
    this.confirm.ask({
      title: 'Eliminar el equipo',
      message: `¿Eliminar «${preview.name}»? ${this.borradoEquipoResumen()} ${teamDeletionConsequences()}`,
      confirmLabel: 'Eliminar el equipo',
      onConfirm: () => {
        this.busySalir.set(true);
        this.borradoEquipoError.set(null);
        const motivo = this.borradoEquipoReason().trim();
        this.access
          .deleteTeam(preview.confirmNameRequired, motivo === '' ? null : motivo)
          .then(() => {
            const destino = this.access.target().route || '/onboarding/team';
            return this.router.navigate([destino]);
          })
          .catch((e) =>
            this.borradoEquipoError.set((e as Error)?.message ?? 'No se pudo eliminar el equipo.'),
          )
          .finally(() => this.busySalir.set(false));
      },
    });
  }

  async ngOnInit(): Promise<void> {
    this.teamName.set(this.store.activeTeam()?.name ?? '');
    await this.load();
  }

  protected onTeamNameInput(evt: Event): void {
    this.teamName.set((evt.target as HTMLInputElement).value);
  }

  protected async renameCurrentTeam(): Promise<void> {
    const name = this.teamName().trim();
    if (name.length < 2 || name.length > 80) {
      this.error.set('El nombre debe tener entre 2 y 80 caracteres.');
      return;
    }
    this.renamingTeam.set(true);
    this.error.set(null);
    this.success.set(null);
    try {
      await this.access.renameTeam(name);
      this.teamName.set(this.store.activeTeam()?.name ?? name);
      this.success.set('Nombre del equipo actualizado.');
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'No se pudo cambiar el nombre del equipo.');
    } finally {
      this.renamingTeam.set(false);
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      if (this.canViewMembers()) {
        const current = await this.access.listMembers();
        this.members.set(current);
        this.invitations.set(this.isOwner() ? await this.access.listTeamInvitations() : []);
      } else {
        // Un editor normal no consulta ni gestiona miembros. Un administrador de plataforma
        // sí puede consultar la lista, pero no recibe acciones de propietario.
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
      const invitation = await this.access.inviteMember(email);
      this.inviteEmail.set('');
      // CAMBIO DE CONTRATO (22/09/2026): ya no se dice «solo se crea el registro». Se CREA
      // la invitación y se PIDE el envío a la función de servidor; el mensaje refleja lo que
      // haya respondido de verdad (aceptado por el proveedor, no configurado o error).
      await this.load();
      await this.enviarCorreo(invitation, email);
    } catch (e) {
      this.error.set(this.friendly((e as Error)?.message ?? 'No se pudo invitar.'));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Pide el envío (o el reenvío) del correo de una invitación concreta. */
  protected async reintentarEnvio(inv: TeamInvitationInfo): Promise<void> {
    this.enviandoId.set(inv.id);
    this.error.set(null);
    this.success.set(null);
    try {
      await this.enviarCorreo(inv, inv.emailNormalized);
    } finally {
      this.enviandoId.set(null);
    }
  }

  private async enviarCorreo(inv: TeamInvitationInfo, email: string): Promise<void> {
    const result = await this.access.sendInvitationEmail(inv.id);
    // La recarga borra `error`; hacerla antes de mostrar el resultado para no ocultar un fallo.
    await this.load();
    if (result.ok) {
      this.success.set(`${email}: ${inviteEmailMessage(result)}`);
    } else {
      // La función no devuelve el detalle técnico del proveedor; queda en la invitación.
      const updated = this.invitations().find((current) => current.id === inv.id);
      const message =
        result.status === 'send_error' && updated?.emailStatus === 'send_error'
          ? storedEmailMessage('send_error', updated.lastEmailError)
          : inviteEmailMessage(result);
      this.error.set(`${email}: ${message}`);
    }
  }

  /** Etiqueta del estado del correo (nunca promete entrega). */
  protected emailLabel(inv: TeamInvitationInfo): string {
    const status = inv.emailStatus as StoredEmailStatus;
    if (status === 'send_error') return storedEmailMessage('send_error', inv.lastEmailError);
    return STORED_EMAIL_LABEL[status] ?? STORED_EMAIL_LABEL.created;
  }

  /** Segundos que faltan para poder reintentar (0 = ya se puede). */
  protected esperaReintento(inv: TeamInvitationInfo): number {
    return retryWaitSeconds(inv);
  }

  protected puedeReintentar(inv: TeamInvitationInfo): boolean {
    return canRetryInvitationEmail(inv);
  }

  protected readonly intentosMaximos = EMAIL_ATTEMPT_LIMIT;

  /**
   * Enlace de la invitación para copiar/pegar, derivado del `base href` real. Devuelve null
   * si la base es local (nunca se ofrece un enlace a localhost desde una build publicada).
   */
  protected enlaceInvitacion(inv: TeamInvitationInfo): string | null {
    return invitationLink(document.baseURI, inv.id);
  }

  protected async copiarEnlace(inv: TeamInvitationInfo): Promise<void> {
    const link = this.enlaceInvitacion(inv);
    if (!link) {
      this.error.set('No se pudo construir el enlace de la invitación en este entorno.');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.success.set(`Enlace copiado: ${link}`);
    } catch {
      this.success.set(`Enlace de la invitación: ${link}`);
    }
  }

  protected cancel(inv: TeamInvitationInfo): void {
    // Para una invitación CADUCADA se dice tal cual: el propietario tiene que entender que no ocupa
    // plaza pero que debe cancelarla para poder volver a invitar a ese correo (el índice único la
    // sigue considerando pendiente).
    const detalle = this.caducada(inv)
      ? ' Está caducada: no ocupa plaza, pero mientras siga pendiente no puedes invitar otra vez a este correo.'
      : '';
    this.confirm.ask({
      title: 'Cancelar invitación',
      message: `¿Cancelar la invitación a ${inv.emailNormalized}?${detalle}`,
      confirmLabel: 'Cancelar invitación',
      onConfirm: () => {
        this.busyId.set(inv.id);
        this.error.set(null);
        this.access
          .cancelInvitation(inv.id)
          .then(() => this.load())
          .catch((e) =>
            this.error.set((e as Error)?.message ?? 'No se pudo cancelar la invitación.'),
          )
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
    if (msg.includes('collaborator_limit_exceeded'))
      return 'Se alcanzó el máximo de 6 colaboradores (activos + invitaciones pendientes).';
    if (msg.includes('invalid_invitation_email')) return 'El correo introducido no es válido.';
    if (msg.includes('collaborator_not_approved'))
      return 'Solo puedes invitar a personas con el perfil aprobado.';
    if (msg.includes('duplicate_invitation'))
      return 'Ya existe una invitación pendiente para este correo.';
    if (msg.includes('forbidden') || msg.includes('not_team_owner'))
      return 'Solo el propietario puede gestionar los colaboradores.';
    return msg;
  }

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.access.clear();
    await this.router.navigate(['/auth/login']);
  }
}
