import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { AuthCardComponent } from './auth-card.component';

interface LegacyData {
  players: unknown[];
  folders: unknown[];
  exercises: unknown[];
  sessions: unknown[];
}

@Component({
  selector: 'app-migration-wizard',
  templateUrl: './migration-wizard.component.html',
  imports: [AuthCardComponent],
})
export class MigrationWizardComponent {
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  protected readonly detected = signal(false);
  protected readonly counts = signal({ players: 0, folders: 0, exercises: 0, sessions: 0 });
  protected readonly importing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);

  protected readonly hasData = computed(() => {
    const c = this.counts();
    return c.players + c.folders + c.exercises + c.sessions > 0;
  });

  async ngOnInit(): Promise<void> {
    const legacy = this.readLegacy();
    this.detected.set(legacy.players.length + legacy.folders.length + legacy.exercises.length + legacy.sessions.length > 0);
    this.counts.set({
      players: legacy.players.length,
      folders: legacy.folders.length,
      exercises: legacy.exercises.length,
      sessions: legacy.sessions.length,
    });
  }

  private readLegacy(): LegacyData {
    const read = <T>(key: string, fallback: T[] = []): unknown[] => {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : fallback;
      } catch {
        return fallback;
      }
    };
    return {
      players: read('entrenolab:players'),
      folders: read('entrenolab:folders'),
      exercises: read('entrenolab:exercises'),
      sessions: read('entrenolab:sessions'),
    };
  }

  /** Descarga un JSON de respaldo de los datos locales (antes de migrar). */
  protected downloadBackup(): void {
    const json = JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        teams: this.readLegacyArray('entrenolab:teams'),
        players: this.readLegacyArray('entrenolab:players'),
        folders: this.readLegacyArray('entrenolab:folders'),
        exercises: this.readLegacyArray('entrenolab:exercises'),
        sessions: this.readLegacyArray('entrenolab:sessions'),
      },
      null,
      2
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cdmplab-local-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private readLegacyArray(key: string): unknown[] {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Importa los datos locales a Supabase de forma idempotente (no duplica). */
  protected async import(): Promise<void> {
    const legacy = this.readLegacy();
    this.importing.set(true);
    this.error.set(null);
    this.success.set(null);
    try {
      const res = await this.access.importLocalData({
        players: legacy.players as never,
        folders: legacy.folders as never,
        exercises: legacy.exercises as never,
        sessions: legacy.sessions as never,
      });
      const c = res.created;
      const sk = res.skipped;
      const e = res.errors;
      const totalError = e.players + e.folders + e.exercises + e.sessions;
      const msg = `Importación completada. Se importaron ${c.players} jugadores, ${c.folders} carpetas, ${c.exercises} ejercicios y ${c.sessions} sesiones.` +
        (sk.players + sk.folders + sk.exercises + sk.sessions > 0 ? ` Se omitieron ${sk.players + sk.folders + sk.exercises + sk.sessions} ya existentes.` : '') +
        (totalError > 0 ? ` Hubo ${totalError} errores; se conservan los datos locales.` : '') +
        ' No se borran los datos locales.';
      this.success.set(msg);
      await this.access.refresh();
      setTimeout(() => this.router.navigate(['/team']), 1200);
    } catch (e) {
      this.error.set((e as Error)?.message ?? 'No se pudieron importar los datos.');
    } finally {
      this.importing.set(false);
    }
  }

  protected skip(): void {
    this.router.navigate(['/team']);
  }
}
