import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StoreService } from './core/store.service';
import { ConfirmService } from './core/confirm.service';
import { SupabaseService } from './core/supabase.service';
import { AccessService } from './core/access.service';
import { ConfirmDialogComponent } from './shared/confirm-dialog.component';

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmDialogComponent],
})
export class App {
  private readonly store = inject(StoreService);
  private readonly confirmSvc = inject(ConfirmService);
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  protected readonly activeTeam = this.store.activeTeam;
  protected readonly storageError = this.store.storageError;
  protected clearStorageError(): void {
    this.store.clearStorageError();
  }

  protected readonly pendingWrites = this.store.pendingWrites;
  protected readonly syncError = this.store.lastError;
  protected clearSyncError(): void {
    this.store.clearLastError();
  }

  // ---------- Autenticación ----------

  /** Estado de la sesión (resolving / unauthenticated / authenticated / disabled). */
  protected readonly authStatus = this.supabase.status;
  protected readonly userEmail = computed(() => this.supabase.user()?.email ?? '');
  protected readonly isAuthenticated = computed(() => this.supabase.status() === 'authenticated');

  /**
   * Muestra la navegación protegida salvo que ya esté claro que NO hay sesión.
   * (Durante `resolving` se muestra igualmente: el app initializer resuelve la
   * sesión antes del primer render; los guards se encargan de la protección real.)
   */
  protected readonly showNav = computed(() => this.supabase.status() !== 'unauthenticated');

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.access.clear();
    await this.router.navigate(['/auth/login']);
  }

  protected readonly settingsOpen = signal(false);
  protected openSettings(): void {
    this.settingsOpen.set(true);
  }
  protected closeSettings(): void {
    this.settingsOpen.set(false);
  }
  protected resetData(): void {
    this.confirmSvc.ask({
      title: 'Restablecer datos',
      message: 'Se borrarán todos los datos locales de CDMPLab (equipos, jugadores, ejercicios, sesiones). Esta acción no se puede deshacer.',
      confirmLabel: 'Borrar',
      onConfirm: () => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
        location.reload();
      },
    });
  }

  // ---------- Respaldo (exportar / importar) ----------

  protected readonly importJson = signal<string | null>(null);
  protected readonly backupError = signal<string | null>(null);

  /** Descarga un JSON versionado con todos los datos locales. */
  protected exportBackup(): void {
    const json = this.store.exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cdmplab-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Lee el archivo elegido, lo valida y deja el JSON listo para importar. */
  protected onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    file.text().then((text) => {
      const v = this.store.validateBackup(text);
      if (!v.ok) {
        this.importJson.set(null);
        this.backupError.set(v.error ?? 'El archivo no es un respaldo válido.');
        return;
      }
      this.backupError.set(null);
      this.importJson.set(text);
    });
  }

  /** Aplica la importación (reemplazar o fusionar). */
  protected doImport(mode: 'replace' | 'merge'): void {
    const json = this.importJson();
    if (!json) return;
    const res = this.store.importBackup(json, mode);
    if (!res.ok) {
      this.backupError.set(res.error ?? 'No se pudo importar el respaldo.');
      return;
    }
    this.importJson.set(null);
    location.reload();
  }

  protected readonly navItems: NavItem[] = [
    { label: 'Plantilla', href: '/team', icon: 'group' },
    { label: 'Pizarra', href: '/board', icon: 'sports_soccer' },
    { label: 'Biblioteca', href: '/library', icon: 'collections_bookmark' },
    { label: 'Sesiones', href: '/sessions', icon: 'calendar_month' },
    { label: 'Miembros', href: '/settings/team/members', icon: 'people' },
  ];
}
