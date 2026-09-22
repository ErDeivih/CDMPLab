import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
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

  protected readonly pending = computed(() =>
    this.profiles().filter((p) => p.status === 'pending'),
  );
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
    await Promise.all([this.load(), this.loadRequests()]);
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
    await Promise.all([this.load(), this.loadRequests()]);
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
