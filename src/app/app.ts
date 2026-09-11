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
  /** Equipos del usuario: con más de uno, la cabecera ofrece cambiar de equipo. */
  protected readonly teams = this.store.teams;
  protected readonly activeTeamId = computed(() => this.store.activeTeam()?.id ?? '');
  protected switchTeam(evt: Event): void {
    const id = (evt.target as HTMLSelectElement).value;
    if (id) this.store.setActiveTeam(id);
  }
  protected readonly storageError = this.store.storageError;
  protected clearStorageError(): void {
    this.store.clearStorageError();
  }

  protected readonly pendingWrites = this.store.pendingWrites;
  protected readonly syncError = this.store.lastError;
  /** Si la última escritura falló, el aviso ofrece REINTENTARLA (no solo descartarla). */
  protected readonly canRetry = this.store.canRetry;
  protected retryWrite(): void {
    this.store.retryFailedWrite();
  }
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
    // En modo remoto esto SOLO limpia la caché local (`entrenolab:*`): la sesión de
    // Supabase (`sb-*`) sobrevive y los datos de la cuenta vuelven a hidratarse. El
    // mensaje debe decirlo, o el botón parece borrar datos que en realidad no borra.
    const remote = this.isAuthenticated();
    this.confirmSvc.ask({
      title: 'Restablecer datos',
      message: remote
        ? 'Se borrarán los datos guardados en ESTE navegador (caché local). Los datos de tu cuenta (Supabase) NO se tocan: volverán a cargarse al recargar.'
        : 'Se borrarán todos los datos locales de CDMPLab (equipos, jugadores, ejercicios, sesiones). Esta acción no se puede deshacer.',
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

  /** ¿Hay una copia automática (la que se escribe sola antes de importar)? */
  protected readonly autoBackupAvailable = this.store.autoBackupAvailable;

  /** Restaura la copia automática previa a la última importación. */
  protected restoreAutoBackup(): void {
    this.confirmSvc.ask({
      title: 'Restaurar copia automática',
      message:
        'Se restaurará la copia que se guardó automáticamente justo antes de la última importación. Lo que tienes ahora pasa a ser la nueva copia automática, así que podrás volver atrás otra vez.',
      confirmLabel: 'Restaurar',
      onConfirm: () => {
        if (this.store.restoreAutoBackup()) location.reload();
      },
    });
  }

  // ---------- Conflicto de revisión (otro usuario editó el ejercicio) ----------

  protected readonly lastConflict = this.store.lastConflict;

  protected conflictTitle(): string {
    return this.store.lastConflict()?.latest.title ?? 'un ejercicio';
  }

  /** Guarda MI versión pisando la del servidor. */
  protected keepMyCopy(): void {
    this.store.keepMyCopy();
  }

  /** Se queda la versión del servidor y cierra el aviso. */
  protected discardMyCopy(): void {
    this.store.discardMyCopy();
  }

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

  protected readonly navItems = computed<NavItem[]>(() => {
    const base: NavItem[] = [
      { label: 'Plantilla', href: '/team', icon: 'group' },
      { label: 'Pizarra', href: '/board', icon: 'sports_soccer' },
      { label: 'Biblioteca', href: '/library', icon: 'collections_bookmark' },
      { label: 'Sesiones', href: '/sessions', icon: 'calendar_month' },
    ];
    // "Miembros" SOLO para el propietario del equipo: en el servidor
    // `list_team_members` es owner-only (migración 20260827000005: `forbidden: not team
    // owner`), así que a un colaborador el enlace le devolvía siempre un error. Si el rol
    // todavía no se conoce (modo local o sesión resolviéndose) NO se oculta nada: la RLS
    // es la barrera real y ocultar de más rompería la navegación local.
    const members: NavItem = { label: 'Miembros', href: '/settings/team/members', icon: 'people' };
    return this.access.target().role === 'editor' ? base : [...base, members];
  });
}
