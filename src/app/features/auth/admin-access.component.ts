import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { SupabaseService } from '../../core/supabase.service';
import { ConfirmService } from '../../core/confirm.service';
import { AuthCardComponent } from './auth-card.component';
import type { ProfileInfo, ProfileStatus } from '../../core/repositories/data-source';

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

  protected readonly pending = computed(() => this.profiles().filter((p) => p.status === 'pending'));
  protected readonly approved = computed(() => this.profiles().filter((p) => p.status === 'approved'));
  protected readonly rejected = computed(() => this.profiles().filter((p) => p.status === 'rejected'));
  protected readonly suspended = computed(() => this.profiles().filter((p) => p.status === 'suspended'));

  async ngOnInit(): Promise<void> {
    await this.load();
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

  protected onSearch(evt: Event): void {
    this.query.set((evt.target as HTMLInputElement).value);
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

  protected me(userId: string): boolean {
    return this.supabase.user()?.id === userId;
  }

  protected statusLabel(s: ProfileStatus): string {
    return { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', suspended: 'Suspendido' }[s];
  }

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.access.clear();
    await this.router.navigate(['/auth/login']);
  }
}
