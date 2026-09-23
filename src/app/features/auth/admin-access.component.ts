import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
import type { AdminOverview } from '../../core/access.service';
import { SupabaseService } from '../../core/supabase.service';
import { ConfirmService } from '../../core/confirm.service';
import { AuthCardComponent } from './auth-card.component';
import type {
  AccountDeletionPreview,
  ProfileInfo,
  ProfileStatus,
  TeamRequestInfo,
} from '../../core/repositories/data-source';
import {
  adminSelfDeletionConsequences,
  canDeleteAccount,
  deletionBlockerMessage,
  deletionConfirmationMatches,
  deletionSummary,
} from '../../core/team-management';

@Component({
  selector: 'app-admin-access',
  templateUrl: './admin-access.component.html',
  imports: [FormsModule, AuthCardComponent],
})
export class AdminAccessComponent {
  private readonly access = inject(AccessService);
  private readonly supabase = inject(SupabaseService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly profiles = signal<ProfileInfo[]>([]);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly administrators = signal<string[]>([]);
  /**
   * Resumen de TODOS los equipos. Lo devuelve el SERVIDOR ya contado (`admin_team_overview`):
   * antes el panel descargaba el contenido completo de cada equipo solo para contar filas.
   */
  protected readonly overview = signal<AdminOverview>({
    equipos: [],
    totals: {
      teams: 0,
      membersActive: 0,
      membersRevoked: 0,
      membersPending: 0,
      invitationsPending: 0,
      playersActive: 0,
      playersInactive: 0,
      folders: 0,
      exercises: 0,
      sessions: 0,
    },
  });
  protected readonly selfEmail = signal('');
  /**
   * ¿El SERVIDOR ha confirmado que soy administrador? (`checkIsPlatformAdmin` → RPC
   * `is_platform_admin`). NO significa «la lista se ha cargado»: antes bastaba con que las dos
   * consultas no fallaran, y en modo local (sin Supabase) devuelven listas vacías, así que el
   * panel pintaba sus acciones —incluida la baja definitiva de la cuenta— a cualquiera que
   * abriera /admin, sin sesión y sin permiso. La barrera real es el servidor; esto evita
   * OFRECER lo que va a rechazar.
   */
  protected readonly adminReady = signal(false);

  protected isAdmin(userId: string): boolean {
    return this.administrators().includes(userId);
  }

  protected async loadAdministration(): Promise<void> {
    this.adminReady.set(false);
    try {
      // El permiso se comprueba CONTRA EL SERVIDOR antes de ofrecer nada (ver `adminReady`).
      const esAdmin = await this.access.checkIsPlatformAdmin();
      const [admins, overview] = await Promise.all([
        this.access.listAdministrators(),
        this.access.adminOverview(),
      ]);
      this.administrators.set(admins);
      this.overview.set(overview);
      this.adminReady.set(esAdmin);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  protected promote(p: ProfileInfo): void {
    this.confirm.ask({
      title: 'Nombrar administrador',
      message: `${p.emailNormalized} tendrá acceso a todos los equipos y podrá aprobar equipos y nombrar administradores. Los administradores no pueden quitarse permisos entre sí.`,
      confirmLabel: 'Nombrar administrador',
      onConfirm: () => {
        this.busyId.set(p.userId);
        this.access
          .grantAdministrator(p.userId)
          .then(() => this.loadAdministration())
          .catch((e) => this.error.set((e as Error).message))
          .finally(() => this.busyId.set(null));
      },
    });
  }

  /** Entra en un equipo (como editor) desde su fila del resumen global. */
  protected async openTeam(teamId: string): Promise<void> {
    this.busyId.set(teamId);
    try {
      await this.access.openAdminTeam(teamId);
      await this.router.navigate(['/library']);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busyId.set(null);
    }
  }

  protected deleteSelf(): void {
    const email = this.selfEmail().trim();
    if (!this.selfDeletionConfirmado()) {
      this.error.set('Escribe tu correo completo para confirmar la baja.');
      return;
    }
    this.confirm.ask({
      title: 'Eliminar mi cuenta',
      message: `¿Eliminar definitivamente tu cuenta de administrador (${this.myEmail()})? ${adminSelfDeletionConsequences()}`,
      confirmLabel: 'Eliminar mi cuenta',
      onConfirm: () => {
        this.busyId.set('self');
        this.access
          .deleteMyAdminAccount(email)
          .then(() => this.router.navigate(['/auth/login']))
          .catch((e) => this.error.set((e as Error).message))
          .finally(() => this.busyId.set(null));
      },
    });
  }

  /** El correo de la SESIÓN: con él confirma el servidor la baja (`profiles.email_normalized`). */
  protected readonly myEmail = computed(() => this.supabase.user()?.email ?? '');

  /**
   * Confirmación REFORZADA de la baja propia: hay que escribir MI correo. Usa la MISMA regla que
   * el borrado de una cuenta ajena (`deletionConfirmationMatches`); el servidor la vuelve a
   * comprobar y además exige que quede otro administrador.
   */
  protected readonly selfDeletionConfirmado = computed(() =>
    deletionConfirmationMatches(this.selfEmail(), this.myEmail()),
  );

  /** Qué implica la baja, contado antes de escribir el correo (no después del error). */
  protected selfBajaConsecuencias(): string {
    return adminSelfDeletionConsequences();
  }

  protected readonly pending = computed(() =>
    this.profiles().filter((p) => p.status === 'pending'),
  );

  /**
   * Cuántas cuentas esperan aprobación. Es el número de la cola de trabajo del administrador y se
   * muestra arriba del panel: el dueño tuvo que deducir dónde se aprobaba, así que ahora lo primero
   * que se ve es lo que le espera.
   */
  protected readonly pendientesCount = computed(() => this.pending().length);

  protected readonly approved = computed(() =>
    this.profiles().filter((p) => p.status === 'approved'),
  );
  protected readonly rejected = computed(() =>
    this.profiles().filter((p) => p.status === 'rejected'),
  );
  protected readonly suspended = computed(() =>
    this.profiles().filter((p) => p.status === 'suspended'),
  );

  // ---- Solicitudes de EQUIPO (separadas de la aprobación de CUENTAS) ----
  // Aprobar una cuenta NO aprueba un equipo: son dos decisiones distintas y así se
  // muestran (dos apartados con su propio encabezado).
  protected readonly requests = signal<TeamRequestInfo[]>([]);
  protected readonly requestsLoading = signal(true);
  protected readonly requestsError = signal<string | null>(null);
  protected readonly busyRequestId = signal<string | null>(null);
  protected readonly rejectNote = signal<Record<string, string>>({});

  protected readonly pendingRequests = computed(() =>
    this.requests().filter((r) => r.status === 'pending'),
  );
  protected readonly decidedRequests = computed(() =>
    this.requests().filter((r) => r.status !== 'pending'),
  );

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadRequests(), this.loadAdministration()]);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.profiles.set(await this.access.listProfiles(this.query().trim()));
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'No se pudieron cargar los perfiles.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadRequests(): Promise<void> {
    this.requestsLoading.set(true);
    this.requestsError.set(null);
    try {
      this.requests.set(await this.access.listTeamRequests(this.query().trim()));
    } catch (e) {
      this.requestsError.set((e as Error)?.message ?? 'No se pudieron cargar las solicitudes.');
    } finally {
      this.requestsLoading.set(false);
    }
  }

  protected onSearch(evt: Event): void {
    this.query.set((evt.target as HTMLInputElement).value);
  }

  protected onRejectNote(evt: Event, requestId: string): void {
    const value = (evt.target as HTMLInputElement).value;
    this.rejectNote.update((m) => ({ ...m, [requestId]: value }));
  }

  protected noteFor(requestId: string): string {
    return this.rejectNote()[requestId] ?? '';
  }

  /** Aprobar: el SERVIDOR crea el equipo y devuelve su id (idempotente). */
  protected approveRequest(r: TeamRequestInfo): void {
    this.confirm.ask({
      title: 'Aprobar solicitud de equipo',
      message: `¿Crear el equipo «${r.name}» para ${r.displayName || r.emailNormalized}?`,
      confirmLabel: 'Aprobar y crear',
      onConfirm: () => {
        this.busyRequestId.set(r.id);
        this.requestsError.set(null);
        this.access
          .approveTeamRequest(r.id)
          .then(() => this.loadRequests())
          .catch((e) =>
            this.requestsError.set((e as Error)?.message ?? 'No se pudo aprobar la solicitud.'),
          )
          .finally(() => this.busyRequestId.set(null));
      },
    });
  }

  protected rejectRequest(r: TeamRequestInfo): void {
    const note = this.noteFor(r.id).trim();
    this.confirm.ask({
      title: 'Rechazar solicitud de equipo',
      message: note
        ? `¿Rechazar la solicitud de «${r.name}» con el motivo «${note}»?`
        : `¿Rechazar la solicitud de «${r.name}»? El solicitante podrá volver a pedirlo.`,
      confirmLabel: 'Rechazar',
      onConfirm: () => {
        this.busyRequestId.set(r.id);
        this.requestsError.set(null);
        this.access
          .rejectTeamRequest(r.id, note === '' ? null : note)
          .then(() => this.loadRequests())
          .catch((e) =>
            this.requestsError.set((e as Error)?.message ?? 'No se pudo rechazar la solicitud.'),
          )
          .finally(() => this.busyRequestId.set(null));
      },
    });
  }

  protected requestBusy(id: string): boolean {
    return this.busyRequestId() === id;
  }

  protected requestStatusLabel(s: TeamRequestInfo['status']): string {
    return { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' }[s];
  }

  protected fecha(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  /** Búsqueda: perfiles y solicitudes con el mismo criterio. */
  protected async refreshAll(): Promise<void> {
    await Promise.all([this.load(), this.loadRequests(), this.loadAdministration()]);
  }

  // ---- BORRADO de cuentas (destructivo: vista previa + confirmación escribiendo el correo) ----
  protected readonly borrado = signal<AccountDeletionPreview | null>(null);
  protected readonly borradoTyped = signal('');
  protected readonly borradoReason = signal('');
  protected readonly borradoCargando = signal(false);
  protected readonly borradoError = signal<string | null>(null);

  protected readonly borradoResumen = computed(() => {
    const preview = this.borrado();
    return preview ? deletionSummary(preview) : '';
  });
  protected readonly borradoPermitido = computed(() => canDeleteAccount(this.borrado()));
  protected readonly borradoBloqueos = computed(() =>
    (this.borrado()?.blockers ?? []).map((b) => deletionBlockerMessage(b)),
  );
  /** Confirmación REFORZADA: hay que escribir el correo EXACTO de la cuenta. */
  protected readonly borradoConfirmado = computed(() =>
    deletionConfirmationMatches(this.borradoTyped(), this.borrado()?.emailNormalized ?? ''),
  );

  /** Abre el panel de borrado de una cuenta, con su vista previa ya cargada del servidor. */
  protected async pedirBorrado(p: ProfileInfo): Promise<void> {
    this.borrado.set(null);
    this.borradoTyped.set('');
    this.borradoReason.set('');
    this.borradoError.set(null);
    this.borradoCargando.set(true);
    try {
      this.borrado.set(await this.access.accountDeletionPreview(p.userId));
    } catch (e) {
      this.borradoError.set(
        (e as Error)?.message ?? 'No se pudo comprobar si la cuenta se puede borrar.',
      );
    } finally {
      this.borradoCargando.set(false);
    }
  }

  protected cancelarBorrado(): void {
    this.borrado.set(null);
    this.borradoTyped.set('');
    this.borradoReason.set('');
    this.borradoError.set(null);
  }

  protected onBorradoTyped(evt: Event): void {
    this.borradoTyped.set((evt.target as HTMLInputElement).value);
  }

  protected onBorradoReason(evt: Event): void {
    this.borradoReason.set((evt.target as HTMLInputElement).value);
  }

  /**
   * Último paso: diálogo de confirmación ADEMÁS de haber escrito el correo. El servidor vuelve a
   * comprobar todas las guardas (la interfaz no es la barrera de nada de esto).
   */
  protected confirmarBorrado(): void {
    const preview = this.borrado();
    if (!preview || !this.borradoConfirmado() || !this.borradoPermitido()) return;
    const nombre = preview.displayName || preview.emailNormalized;
    this.confirm.ask({
      title: 'Eliminar cuenta',
      message: `¿Eliminar definitivamente la cuenta de ${nombre} (${preview.emailNormalized})? ${this.borradoResumen()} No se puede deshacer.`,
      confirmLabel: 'Eliminar cuenta',
      onConfirm: () => {
        this.busyId.set(preview.userId);
        this.borradoError.set(null);
        const motivo = this.borradoReason().trim();
        this.access
          .deleteAccount(preview.userId, motivo === '' ? null : motivo)
          .then(() => {
            this.cancelarBorrado();
            return this.load();
          })
          .catch((e) =>
            this.borradoError.set((e as Error)?.message ?? 'No se pudo eliminar la cuenta.'),
          )
          .finally(() => this.busyId.set(null));
      },
    });
  }

  protected setStatus(p: ProfileInfo, status: ProfileStatus, label: string): void {
    this.confirm.ask({
      title: label,
      message: `¿${label} a ${p.displayName || p.emailNormalized}?`,
      confirmLabel: label,
      onConfirm: () => {
        this.busyId.set(p.userId);
        this.error.set(null);
        this.access
          .setProfileStatus(p.userId, status)
          .then(() => this.load())
          .catch((e) => this.error.set((e as Error)?.message ?? 'No se pudo actualizar el perfil.'))
          .finally(() => this.busyId.set(null));
      },
    });
  }

  protected approve(p: ProfileInfo): void {
    this.setStatus(p, 'approved', 'Aprobar');
  }
  protected reject(p: ProfileInfo): void {
    this.setStatus(p, 'rejected', 'Rechazar');
  }
  protected suspend(p: ProfileInfo): void {
    this.setStatus(p, 'suspended', 'Suspender');
  }
  protected reactivate(p: ProfileInfo): void {
    this.setStatus(p, 'approved', 'Reactivar');
  }

  protected busy(id: string): boolean {
    return this.busyId() === id;
  }

  /** ¿Está en curso el borrado de esta cuenta? */
  protected borrando(id: string): boolean {
    return this.busyId() === id;
  }

  protected me(userId: string): boolean {
    return this.supabase.user()?.id === userId;
  }

  protected statusLabel(s: ProfileStatus): string {
    return {
      pending: 'Pendiente',
      approved: 'Aprobado',
      rejected: 'Rechazado',
      suspended: 'Suspendido',
    }[s];
  }

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.access.clear();
    await this.router.navigate(['/auth/login']);
  }
}
