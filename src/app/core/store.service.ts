// =============================================================
// EntrenoLab — Servicio de estado (facade reactivo)
//
// Es la fachada ÚNICA que consumen las pantallas. Tiene dos modos:
//   · LOCAL (dataSource === null): persiste en localStorage con claves
//     heredadas `entrenolab:...`. Es el modo de desarrollo/pruebas.
//   · REMOTO (dataSource !== null): el repositorio Supabase es la fuente de
//     verdad. El store HIDRATA sus signals desde el servidor y las mutaciones
//     aplican ÓPTIMISMO con ROLLBACK visible ante fallo, además de advertir de
//     conflictos de `revision` (concurrencia optimista).
//
// Las claves de localStorage se aislan por usuario+equipo (`entrenolab:{uid}:{tid}:`)
// cuando hay contexto remoto, para que DOS CUENTAS en el mismo navegador jamás
// compartan datos. Las claves heredadas se leen como respaldo de migración.
// =============================================================

import { Injectable, computed, signal } from '@angular/core';
import { Exercise, ExerciseFolder, Player, Session, Team, ELEMENT_TYPES } from './models';
import { environment } from '../../environments/environment';
import type { DataSource } from './repositories/data-source';
import { DataError } from './repositories/data-source';

const KEY_TEAMS = 'teams';
const KEY_PLAYERS = 'players';
const KEY_EXERCISES = 'exercises';
const KEY_FOLDERS = 'folders';
const KEY_SESSIONS = 'sessions';
const KEY_DRAFT_PREFIX = 'draft';
const KEY_AUTO_BACKUP = 'backup-auto';

export const BACKUP_VERSION = 1;

/** Cómo identificar si el StoreService está en modo remoto (Supabase real). */
export function isRemoteMode(): boolean {
  return typeof localStorage !== 'undefined' && !!localStorage.getItem('entrenolab:remote-mode');
}

/** Respaldo completo exportado/importado (JSON versionado). */
export interface BackupBundle {
  version: number;
  exportedAt: string;
  teams: Team[];
  players: Player[];
  folders: ExerciseFolder[];
  exercises: Exercise[];
  sessions: Session[];
}

/** Genera un id opaco único (UUID v4 si el entorno lo permite). */
export function uid(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return g.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Reporter de fallos de almacenamiento (lo asigna el StoreService).
let onStorageError: ((msg: string | null) => void) | null = null;

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function save<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    onStorageError?.(null);
  } catch {
    onStorageError?.('No se pudo guardar en el navegador (localStorage lleno o bloqueado). Revisa el espacio o el modo privado.');
  }
}

@Injectable({ providedIn: 'root' })
export class StoreService {
  // Fuente de datos activa: null → modo local (development/testing). No nula →
  // modo remoto (Supabase), fuente de verdad.
  private dataSource: DataSource | null = null;

  private readonly _teams = signal<Team[]>(load<Team>(this.key(KEY_TEAMS)));
  private readonly _players = signal<Player[]>(load<Player>(this.key(KEY_PLAYERS)));

  readonly teams = this._teams.asReadonly();
  readonly players = this._players.asReadonly();

  private readonly _activeTeamId = signal<string | null>(
    load<{ id: string }>(this.key(KEY_TEAMS)).length ? null : 'team-1'
  );

  readonly activeTeam = computed(() => {
    const id = this._activeTeamId();
    return this._teams().find((t) => t.id === id) ?? null;
  });

  readonly activeTeamPlayers = computed(() => {
    const id = this.activeTeam()?.id;
    if (!id) return [];
    return this._players().filter((p) => p.teamId === id && p.active);
  });

  private readonly _demoSeeded = signal<boolean>(
    typeof localStorage !== 'undefined' && !!localStorage.getItem('entrenolab:seeded')
  );

  private readonly _storageError = signal<string | null>(null);
  readonly storageError = this._storageError.asReadonly();

  // ---------- Estado de escrituras (optimista) ----------
  private readonly _pendingWrites = signal(0);
  readonly pendingWrites = this._pendingWrites.asReadonly();

  private readonly _lastError = signal<string | null>(null);
  readonly lastError = this._lastError.asReadonly();

  /** Conflicto de revisión detectado (otro usuario modificó el ejercicio). */
  private readonly _lastConflict = signal<{ exerciseId: string; latest: Exercise; attempted: Exercise } | null>(null);
  readonly lastConflict = this._lastConflict.asReadonly();

  clearStorageError(): void {
    this._storageError.set(null);
  }

  clearLastError(): void {
    this._lastError.set(null);
    this._lastConflict.set(null);
  }

  constructor() {
    onStorageError = (msg) => this._storageError.set(msg);
    // Si ya hay equipos pero no hay seleccionado, toma el primero.
    if (this._teams().length && !this._activeTeamId()) {
      this._activeTeamId.set(this._teams()[0].id);
    }
    // Solo sembrar demo en builds de desarrollo (nunca en producción).
    if (!environment.production && !this._demoSeeded() && this._teams().length === 0) {
      this.seedDemo();
      localStorage.setItem('entrenolab:seeded', '1');
    }
  }

  /** Clave de localStorage con namespace usuario+equipo (aislamiento por cuenta). */
  private key(suffix: string): string {
    const ds = this.dataSource;
    const base = ds ? `entrenolab:${ds.userId ?? 'anon'}:${ds.teamId ?? 'none'}:` : 'entrenolab:';
    return base + suffix;
  }

  // ---------- Modo remoto (conexión / hidratación / reset) ----------

  /**
   * Conecta el repositorio como fuente de verdad y HIDRATA los signals con los
   * datos del servidor del equipo indicado.
   */
  async connectDataSource(ds: DataSource, teamId: string): Promise<void> {
    this.dataSource = ds;
    const dataset = await ds.loadTeam(teamId);
    this.hydrate(dataset, teamId);
    try {
      localStorage.setItem('entrenolab:remote-mode', '1');
    } catch {
      /* sin persistencia */
    }
  }

  /** Activa un equipo remoto recién creado (llamado tras crear equipo). */
  activateRemoteTeam(ds: DataSource, team: Team): void {
    this.dataSource = ds;
    this._teams.set([team]);
    this._players.set([]);
    this._folders.set([]);
    this._exercises.set([]);
    this._sessions.set([]);
    this._activeTeamId.set(team.id);
    this.saveAll();
    try {
      localStorage.setItem('entrenolab:remote-mode', '1');
    } catch {
      /* sin persistencia */
    }
  }

  private hydrate(dataset: { team: Team | null; players: Player[]; folders: ExerciseFolder[]; exercises: Exercise[]; sessions: Session[] }, teamId: string): void {
    this._teams.set(dataset.team ? [dataset.team] : []);
    this._players.set(dataset.players);
    this._folders.set(dataset.folders);
    this._exercises.set(dataset.exercises);
    this._sessions.set(dataset.sessions);
    this._activeTeamId.set(dataset.team ? dataset.team.id : teamId);
  }

  /** Vuelve a modo local (sin sesión): desconecta la fuente y recarga las claves
   *  heredadas, para que la app local de desarrollo siga funcionando. */
  resetToLocal(): void {
    this.dataSource = null;
    this._teams.set(load<Team>(this.key(KEY_TEAMS)));
    this._players.set(load<Player>(this.key(KEY_PLAYERS)));
    this._folders.set(load<ExerciseFolder>(this.key(KEY_FOLDERS)));
    this._exercises.set(load<Exercise>(this.key(KEY_EXERCISES)));
    this._sessions.set(load<Session>(this.key(KEY_SESSIONS)));
    this._activeTeamId.set(this._teams().length ? this._teams()[0].id : null);
    this._pendingWrites.set(0);
    this._lastError.set(null);
    this._lastConflict.set(null);
    try {
      localStorage.removeItem('entrenolab:remote-mode');
    } catch {
      /* noop */
    }
  }

  /** ¿Está el store conectado a una fuente de datos remota? */
  isRemote(): boolean {
    return this.dataSource !== null;
  }

  // ---------- Utilidades de escritura optimista ----------

  private beginWrite(): void {
    this._pendingWrites.update((n) => n + 1);
  }

  private endWrite(error?: unknown): void {
    this._pendingWrites.update((n) => Math.max(0, n - 1));
    if (error) {
      this._lastError.set((error as Error)?.message ?? 'No se pudo guardar en el servidor.');
    }
  }

  /** Aplica la mutación local con rollback si el servidor falla acumulando array. */
  private applyRemote<T>(
    optimistic: () => void,
    persist: () => Promise<T>,
    rollback: () => void = () => {
      /* por defecto no hay rollback */
    },
    onDone?: (value: T) => void
  ): void {
    this.beginWrite();
    optimistic();
    persist()
      .then((value) => {
        onDone?.(value);
        this.endWrite();
      })
      .catch((err) => {
        rollback();
        this.endWrite(err);
      });
  }

  // ---------- Equipos ----------

  createTeam(name: string, accentColor: string): Team {
    // En modo remoto la creación de equipo va por AccessService (createTeamAsync).
    const team: Team = {
      id: uid(),
      name,
      accentColor,
      createdAt: new Date().toISOString(),
    };
    this._teams.update((list) => [...list, team]);
    save(this.key(KEY_TEAMS), this._teams());
    this._activeTeamId.set(team.id);
    return team;
  }

  setActiveTeam(id: string): void {
    this._activeTeamId.set(id);
  }

  // ---------- Jugadores ----------

  addPlayer(input: Omit<Player, 'id' | 'teamId' | 'active' | 'createdAt'>): void {
    const ds = this.dataSource;
    const teamId = this.activeTeam()?.id;
    if (!teamId) return;
    const player: Player = {
      ...input,
      id: uid(),
      teamId,
      active: true,
      createdAt: new Date().toISOString(),
    };
    if (ds) {
      this.applyRemote(
        () => this._players.update((list) => [...list, player]),
        () => ds.addPlayer(input),
        () => this._players.update((list) => list.filter((p) => p.id !== player.id)),
        (saved) => this._players.update((list) => list.map((p) => (p.id === player.id ? saved : p)))
      );
      return;
    }
    this._players.update((list) => [...list, player]);
    save(this.key(KEY_PLAYERS), this._players());
  }

  updatePlayer(id: string, patch: Partial<Player>): void {
    const ds = this.dataSource;
    const prev = this._players().find((p) => p.id === id);
    if (ds) {
      this.applyRemote(
        () => this._players.update((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p))),
        () => ds.updatePlayer(id, patch),
        () => this._players.update((list) => list.map((p) => (p.id === id && prev ? { ...p, ...prev } : p))),
        (saved) => this._players.update((list) => list.map((p) => (p.id === id ? saved : p)))
      );
      return;
    }
    this._players.update((list) =>
      list.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
    save(this.key(KEY_PLAYERS), this._players());
  }

  removePlayer(id: string): void {
    const ds = this.dataSource;
    const prev = this._players().find((p) => p.id === id);
    if (ds) {
      this.applyRemote(
        () => this._players.update((list) => list.map((p) => (p.id === id ? { ...p, active: false } : p))),
        () => ds.removePlayer(id),
        () => this._players.update((list) => list.map((p) => (p.id === id && prev ? { ...p, ...prev } : p)))
      );
      return;
    }
    // Nunca se borra el histórico: se marca inactivo.
    this.updatePlayer(id, { active: false });
  }

  // ---------- Demo inicial ----------

  private seedDemo(): void {
    const team = this.createTeam('Primer Equipo', '#1f7a4d');
    const demo: Array<[string, number, Player['position'], string]> = [
      ['Dani Portero', 1, 'GK', '#1a73e8'],
      ['Marcos', 2, 'DF', '#1a73e8'],
      ['Iván', 4, 'DF', '#1a73e8'],
      ['Eric', 5, 'DF', '#1a73e8'],
      ['Sergio', 3, 'DF', '#1a73e8'],
      ['Dani', 6, 'MF', '#1a73e8'],
      ['Álex', 8, 'MF', '#1a73e8'],
      ['Pau', 10, 'MF', '#1a73e8'],
      ['Adrián', 7, 'FW', '#1a73e8'],
      ['Lucas', 9, 'FW', '#1a73e8'],
      ['Javi', 11, 'FW', '#1a73e8'],
      ['Xavi', 14, 'MF', '#c0392b'],
    ];
    for (const [name, number, position, color] of demo) {
      this._players.update((list) => [
        ...list,
        {
          id: uid(),
          teamId: team.id,
          name,
          number,
          position,
          color,
          active: true,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    save(this.key(KEY_PLAYERS), this._players());
    // Asegurar que el equipo de demostración es el activo.
    this._activeTeamId.set(team.id);
  }

  // ---------- Ejercicios ----------

  private readonly _exercises = signal<Exercise[]>(load<Exercise>(this.key(KEY_EXERCISES)));
  readonly exercises = this._exercises.asReadonly();

  getExercisesForTeam(teamId: string): Exercise[] {
    return this._exercises().filter((e) => e.teamId === teamId);
  }

  saveExercise(ex: Exercise): void {
    const ds = this.dataSource;
    if (!ds) {
      this._exercises.update((list) => {
        const idx = list.findIndex((e) => e.id === ex.id);
        const next = idx === -1 ? [...list, ex] : list.map((e) => (e.id === ex.id ? ex : e));
        save(this.key(KEY_EXERCISES), next);
        return next;
      });
      return;
    }
    const existing = this._exercises().find((e) => e.id === ex.id);
    const expectedRevision = existing?.revision;
    const base = existing ? { ...existing, ...ex } : ex;
    this.applyRemote(
      () => {
        this._exercises.update((list) => {
          const idx = list.findIndex((e) => e.id === ex.id);
          return idx === -1 ? [...list, base] : list.map((e) => (e.id === ex.id ? base : e));
        });
      },
      () => ds.saveExercise(base, expectedRevision),
      () => {
        if (existing) this._exercises.update((list) => list.map((e) => (e.id === ex.id ? existing : e)));
        else this._exercises.update((list) => list.filter((e) => e.id !== ex.id));
      },
      (res) => {
        if (res.conflict) {
          // Otro usuario modificó el ejercicio: NO sobrescribir. Refleja lo último
          // y marca el conflicto para que la UI ofrezca recargar o guardar copia.
          this._exercises.update((list) => list.map((e) => (e.id === ex.id ? res.exercise : e)));
          this._lastConflict.set({ exerciseId: ex.id, latest: res.exercise, attempted: base });
          return;
        }
        this._exercises.update((list) => {
          const idx = list.findIndex((e) => e.id === ex.id);
          return idx === -1 ? [...list, res.exercise] : list.map((e) => (e.id === ex.id ? res.exercise : e));
        });
      }
    );
  }

  deleteExercise(id: string): void {
    const ds = this.dataSource;
    const prev = this._exercises().find((e) => e.id === id);
    if (ds) {
      this.applyRemote(
        () => this._exercises.update((list) => list.filter((e) => e.id !== id)),
        () => ds.deleteExercise(id),
        () => {
          if (prev) this._exercises.update((list) => [...list, prev]);
        }
      );
      return;
    }
    this._exercises.update((list) => {
      const next = list.filter((e) => e.id !== id);
      save(this.key(KEY_EXERCISES), next);
      return next;
    });
  }

  duplicateExercise(id: string): void {
    const ds = this.dataSource;
    const ex = this._exercises().find((e) => e.id === id);
    if (!ex) return;
    const copy: Exercise = {
      ...deepClone(ex),
      id: uid(),
      title: `${ex.title} (copia)`,
      savedAt: new Date().toISOString(),
    };
    if (ds) {
      this.applyRemote(
        () => this._exercises.update((list) => [...list, copy]),
        () => ds.saveExercise(copy),
        () => this._exercises.update((list) => list.filter((e) => e.id !== copy.id))
      );
      return;
    }
    this.saveExercise(copy);
  }

  // ---------- Carpetas de ejercicios ----------

  private readonly _folders = signal<ExerciseFolder[]>(load<ExerciseFolder>(this.key(KEY_FOLDERS)));
  readonly folders = this._folders.asReadonly();

  getFoldersForTeam(teamId: string): ExerciseFolder[] {
    return this._folders().filter((f) => f.teamId === teamId);
  }

  createFolder(teamId: string, name: string, parentId: string | null = null): void {
    const ds = this.dataSource;
    // Profundidad limitada a 4 niveles (evita un árbol infinito e inmanejable).
    if (parentId && this.folderDepth(parentId) >= 4) return;
    const folder: ExerciseFolder = { id: uid(), teamId, parentId, name };
    if (ds) {
      this.applyRemote(
        () => this._folders.update((list) => [...list, folder]),
        () => ds.createFolder(teamId, name, parentId),
        () => this._folders.update((list) => list.filter((f) => f.id !== folder.id)),
        (saved) => this._folders.update((list) => list.map((f) => (f.id === folder.id ? saved : f)))
      );
      return;
    }
    this._folders.update((list) => {
      const next = [...list, folder];
      save(this.key(KEY_FOLDERS), next);
      return next;
    });
  }

  private folderDepth(id: string): number {
    let d = 0;
    let cur: ExerciseFolder | undefined = this._folders().find((f) => f.id === id);
    while (cur) {
      d++;
      cur = this._folders().find((f) => f.id === cur!.parentId);
    }
    return d;
  }

  renameFolder(id: string, name: string): void {
    const ds = this.dataSource;
    if (ds) {
      this.applyRemote(
        () => this._folders.update((list) => list.map((f) => (f.id === id ? { ...f, name } : f))),
        () => ds.renameFolder(id, name)
      );
      return;
    }
    this._folders.update((list) => {
      const next = list.map((f) => (f.id === id ? { ...f, name } : f));
      save(this.key(KEY_FOLDERS), next);
      return next;
    });
  }

  deleteFolder(id: string): void {
    const ds = this.dataSource;
    const prevFolders = this._folders();
    const prevExercises = this._exercises();
    const idsToDelete = this.subtreeIds(id);
    if (ds) {
      this.applyRemote(
        () => {
          this._folders.update((list) => list.filter((f) => !idsToDelete.has(f.id)));
          this._exercises.update((list) => list.map((e) => (idsToDelete.has(e.folderId as string) ? { ...e, folderId: null } : e)));
        },
        () => ds.deleteFolder(id),
        () => {
          this._folders.set(prevFolders);
          this._exercises.set(prevExercises);
        }
      );
      return;
    }
    this._folders.update((list) => {
      const next = list.filter((f) => !idsToDelete.has(f.id));
      save(this.key(KEY_FOLDERS), next);
      return next;
    });
    this._exercises.update((list) => {
      const next = list.map((e) => (idsToDelete.has(e.folderId as string) ? { ...e, folderId: null } : e));
      save(this.key(KEY_EXERCISES), next);
      return next;
    });
  }

  moveExerciseToFolder(exerciseId: string, folderId: string | null): void {
    const ds = this.dataSource;
    if (ds) {
      this.applyRemote(
        () => this._exercises.update((list) => list.map((e) => (e.id === exerciseId ? { ...e, folderId } : e))),
        () => ds.moveExerciseToFolder(exerciseId, folderId)
      );
      return;
    }
    this._exercises.update((list) => {
      const next = list.map((e) => (e.id === exerciseId ? { ...e, folderId } : e));
      save(this.key(KEY_EXERCISES), next);
      return next;
    });
  }

  moveExercisesToFolder(ids: string[], folderId: string | null): void {
    const ds = this.dataSource;
    const set = new Set(ids);
    if (ds) {
      this.applyRemote(
        () => this._exercises.update((list) => list.map((e) => (set.has(e.id) ? { ...e, folderId } : e))),
        () => ds.moveExercisesToFolder(ids, folderId)
      );
      return;
    }
    this._exercises.update((list) => {
      const next = list.map((e) => (set.has(e.id) ? { ...e, folderId } : e));
      save(this.key(KEY_EXERCISES), next);
      return next;
    });
  }

  countExercisesInFolder(folderId: string): number {
    return this._exercises().filter((e) => e.folderId === folderId).length;
  }

  /** Duplica la carpeta y su subárbol; copia también sus ejercicios. */
  duplicateFolder(id: string): void {
    const ds = this.dataSource;
    if (ds) {
      // En remoto lo hace el repositorio; se recarga el dataset para reflejar el resultado.
      this.applyRemote(
        () => {
          /* optimista: nada hasta confirmar */
        },
        () => ds.duplicateFolderTree(id).then(() => this.connectDataSource(ds, ds.teamId ?? '')),
        () => {
          /* rollback: recargar desde servidor */
          return this.connectDataSource(ds, ds.teamId ?? '');
        }
      );
      return;
    }
    const all = this._folders();
    const root = all.find((f) => f.id === id);
    if (!root) return;
    const copies: ExerciseFolder[] = [];
    const copyRec = (oldId: string, newParent: string | null): void => {
      const old = all.find((f) => f.id === oldId);
      if (!old) return;
      const newId = uid();
      copies.push({
        id: newId,
        teamId: old.teamId,
        parentId: newParent,
        name: old.id === id ? `${root.name} (copia)` : old.name,
      });
      for (const ex of this.getExercisesForTeam(old.teamId).filter((e) => e.folderId === oldId)) {
        this.saveExercise({
          ...ex,
          id: uid(),
          folderId: newId,
          title: `${ex.title} (copia)`,
          savedAt: new Date().toISOString(),
          canvas: ex.canvas ? deepClone(ex.canvas) : null,
        });
      }
      for (const child of all.filter((f) => f.parentId === oldId)) copyRec(child.id, newId);
    };
    copyRec(id, null);
    this._folders.update((list) => {
      const next = [...list, ...copies];
      save(this.key(KEY_FOLDERS), next);
      return next;
    });
  }

  private subtreeIds(id: string): Set<string> {
    const result = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      result.add(cur);
      this._folders().filter((f) => f.parentId === cur).forEach((f) => stack.push(f.id));
    }
    return result;
  }

  // ---------- Sesiones ----------

  private readonly _sessions = signal<Session[]>(load<Session>(this.key(KEY_SESSIONS)));
  readonly sessions = this._sessions.asReadonly();

  getSessionsForTeam(teamId: string): Session[] {
    return this._sessions().filter((s) => s.teamId === teamId);
  }

  saveSession(session: Session): void {
    const ds = this.dataSource;
    const existing = this._sessions().find((s) => s.id === session.id);
    if (ds) {
      const base = existing ? { ...existing, ...session } : session;
      this.applyRemote(
        () => {
          this._sessions.update((list) => {
            const idx = list.findIndex((s) => s.id === session.id);
            return idx === -1 ? [...list, base] : list.map((s) => (s.id === session.id ? base : s));
          });
        },
        () => ds.saveSession(base),
        () => {
          if (existing) this._sessions.update((list) => list.map((s) => (s.id === session.id ? existing : s)));
          else this._sessions.update((list) => list.filter((s) => s.id !== session.id));
        },
        (saved) => {
          this._sessions.update((list) => {
            const idx = list.findIndex((s) => s.id === session.id);
            return idx === -1 ? [...list, saved] : list.map((s) => (s.id === session.id ? saved : s));
          });
        }
      );
      return;
    }
    this._sessions.update((list) => {
      const idx = list.findIndex((s) => s.id === session.id);
      const next = idx === -1 ? [...list, session] : list.map((s) => (s.id === session.id ? session : s));
      save(this.key(KEY_SESSIONS), next);
      return next;
    });
  }

  deleteSession(id: string): void {
    const ds = this.dataSource;
    const prev = this._sessions().find((s) => s.id === id);
    if (ds) {
      this.applyRemote(
        () => this._sessions.update((list) => list.filter((s) => s.id !== id)),
        () => ds.deleteSession(id),
        () => {
          if (prev) this._sessions.update((list) => [...list, prev]);
        }
      );
      return;
    }
    this._sessions.update((list) => {
      const next = list.filter((s) => s.id !== id);
      save(this.key(KEY_SESSIONS), next);
      return next;
    });
  }

  // ---------- Respaldo (exportar / importar JSON versionado) ----------

  /** Exporta todos los datos a un JSON versionado (para guardar/restaurar). */
  exportBackup(): string {
    const bundle: BackupBundle = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      teams: this._teams(),
      players: this._players(),
      folders: this._folders(),
      exercises: this._exercises(),
      sessions: this._sessions(),
    };
    return JSON.stringify(bundle, null, 2);
  }

  /** Valida esquema, versión y estructura de un respaldo SIN aplicar cambios. */
  validateBackup(json: string): { ok: boolean; error?: string } {
    const MAX_CHARS = 10 * 1024 * 1024; // 10 MB
    const MAX_ITEMS = 10000;
    if (typeof json !== 'string' || json.length > MAX_CHARS) {
      return { ok: false, error: 'El respaldo es demasiado grande o no es texto.' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'El archivo no es JSON válido.' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'El archivo no contiene un respaldo válido.' };
    }
    const b = parsed as any;
    if (b.version !== BACKUP_VERSION) {
      return { ok: false, error: `Versión de respaldo no soportada (${String(b.version)}).` };
    }
    const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
    const isStr = (v: unknown): v is string => typeof v === 'string';
    for (const k of ['teams', 'players', 'folders', 'exercises', 'sessions'] as const) {
      if (!isArr(b[k])) return { ok: false, error: `El campo "${k}" no es una lista.` };
      if (b[k].length > MAX_ITEMS) return { ok: false, error: `El campo "${k}" supera el tamaño máximo.` };
    }

    const teams = b.teams as any[];
    const players = b.players as any[];
    const folders = b.folders as any[];
    const exercises = b.exercises as any[];
    const sessions = b.sessions as any[];

    // IDs no vacíos y únicos por colección.
    const teamIds = new Set<string>();
    for (const t of teams) {
      if (!isStr(t.id) || !t.id.trim()) return { ok: false, error: 'Un equipo no tiene id.' };
      if (teamIds.has(t.id)) return { ok: false, error: `Id de equipo duplicado: ${t.id}.` };
      teamIds.add(t.id);
      if (!isStr(t.name) || !isStr(t.accentColor) || !isStr(t.createdAt)) return { ok: false, error: 'Equipo incompleto.' };
    }

    const playerIds = new Set<string>();
    for (const p of players) {
      if (!isStr(p.id) || !p.id.trim()) return { ok: false, error: 'Un jugador no tiene id.' };
      if (playerIds.has(p.id)) return { ok: false, error: `Id de jugador duplicado: ${p.id}.` };
      playerIds.add(p.id);
      if (!isStr(p.teamId) || !teamIds.has(p.teamId)) return { ok: false, error: 'Jugador con referencia de equipo inválida.' };
      if (!isStr(p.name) || typeof p.number !== 'number') return { ok: false, error: 'Jugador incompleto.' };
    }

    // Carpetas: recogemos TODAS primero para validar de forma independiente del
    // orden del JSON (una carpeta puede referenciar un padre que aparece después).
    const folderIds = new Set<string>();
    const folderTeam = new Map<string, string>();
    for (const f of folders) {
      if (!isStr(f.id) || !f.id.trim()) return { ok: false, error: 'Una carpeta no tiene id.' };
      if (folderIds.has(f.id)) return { ok: false, error: `Id de carpeta duplicado: ${f.id}.` };
      folderIds.add(f.id);
      if (!isStr(f.teamId) || !teamIds.has(f.teamId)) return { ok: false, error: 'Carpeta con referencia de equipo inválida.' };
      if (f.parentId !== null && !isStr(f.parentId)) return { ok: false, error: 'Carpeta con parentId inválido.' };
      if (!isStr(f.name)) return { ok: false, error: 'Carpeta incompleta.' };
      folderTeam.set(f.id, f.teamId);
    }
    // Segunda pasada: el padre debe existir y pertenecer al MISMO equipo.
    for (const f of folders) {
      if (isStr(f.parentId)) {
        if (!folderIds.has(f.parentId)) return { ok: false, error: 'Carpeta con parentId no existente.' };
        if (folderTeam.get(f.parentId) !== f.teamId) return { ok: false, error: 'Carpeta con padre de otro equipo.' };
      }
    }
    // Sin ciclos en la jerarquía de carpetas.
    const done = new Set<string>();
    for (const f of folders) {
      const path = new Set<string>();
      let cur: string | null = f.id as string;
      while (cur && !done.has(cur)) {
        if (path.has(cur)) return { ok: false, error: 'La jerarquía de carpetas tiene un ciclo.' };
        path.add(cur);
        const node = folders.find((x) => x.id === cur) as any;
        cur = isStr(node?.parentId) ? (node.parentId as string) : null;
      }
      for (const p of path) done.add(p);
    }

    // Campos de pizarra admitidos. Incluye 'f7' (F7 transversal sobre medio campo
    // F11), que es un campo de PRIMER nivel del producto. Sin él, un respaldo con un
    // ejercicio F7 se rechazaría como "canvas inválido".
    const KNOWN_FIELD = new Set(['full', 'half', 'third', 'box', 'futsal', 'blank', 'vertical_half', 'f7']);
    const isValidCanvas = (c: unknown): boolean => {
      if (c === null) return true;
      if (!c || typeof c !== 'object') return false;
      const doc = c as any;
      if (typeof doc.field !== 'string' || !KNOWN_FIELD.has(doc.field)) return false;
      if (!isArr(doc.frames) || doc.frames.length === 0) return false;
      for (const fr of doc.frames) {
        if (!fr || !isArr((fr as any).elements)) return false;
        for (const e of (fr as any).elements as any[]) {
          if (!isStr(e.t) || !ELEMENT_TYPES.has(e.t)) return false;
          // Fase 2: relleno/opacidad opcionales deben ser válidos (si están presentes).
          if (e.fillOpacity !== undefined && (typeof e.fillOpacity !== 'number' || e.fillOpacity < 0 || e.fillOpacity > 1)) return false;
          if (e.fillColor !== undefined && !isStr(e.fillColor)) return false;
        }
      }
      return true;
    };

    const exerciseIds = new Set<string>();
    const exerciseTeam = new Map<string, string>();
    for (const ex of exercises) {
      if (!isStr(ex.id) || !ex.id.trim()) return { ok: false, error: 'Un ejercicio no tiene id.' };
      if (exerciseIds.has(ex.id)) return { ok: false, error: `Id de ejercicio duplicado: ${ex.id}.` };
      exerciseIds.add(ex.id);
      if (!isStr(ex.teamId) || !teamIds.has(ex.teamId)) return { ok: false, error: 'Ejercicio con referencia de equipo inválida.' };
      if (ex.folderId !== null) {
        if (typeof ex.folderId !== 'string' || !folderIds.has(ex.folderId)) return { ok: false, error: 'Ejercicio con carpeta inválida.' };
        if (folderTeam.get(ex.folderId) !== ex.teamId) return { ok: false, error: 'Ejercicio con carpeta de otro equipo.' };
      }
      if (!Array.isArray(ex.objectives) || !Array.isArray(ex.materials)) return { ok: false, error: 'Ejercicio incompleto.' };
      if (!isValidCanvas(ex.canvas)) return { ok: false, error: 'Ejercicio con canvas inválido.' };
      exerciseTeam.set(ex.id, ex.teamId);
    }

    const sessionIds = new Set<string>();
    for (const s of sessions) {
      if (!isStr(s.id) || !s.id.trim()) return { ok: false, error: 'Una sesión no tiene id.' };
      if (sessionIds.has(s.id)) return { ok: false, error: `Id de sesión duplicado: ${s.id}.` };
      sessionIds.add(s.id);
      if (!isStr(s.teamId) || !teamIds.has(s.teamId)) return { ok: false, error: 'Sesión con referencia de equipo inválida.' };
      if (!Array.isArray(s.tasks)) return { ok: false, error: 'Sesión incompleta.' };
      for (const tk of s.tasks as any[]) {
        if (tk.exerciseId === null) continue;
        if (typeof tk.exerciseId !== 'string') return { ok: false, error: 'Tarea de sesión con ejercicio inválido.' };
        if (!exerciseIds.has(tk.exerciseId)) return { ok: false, error: 'Tarea de sesión con ejercicio inexistente.' };
        if (exerciseTeam.get(tk.exerciseId) !== s.teamId) return { ok: false, error: 'Tarea de sesión con ejercicio de otro equipo.' };
      }
    }

    return { ok: true };
  }

  /**
   * Importa un respaldo JSON de forma TRANSACCIONAL: valida y construye todo en
   * memoria, escribe en localStorage y, si cualquier escritura falla, restaura el
   * estado anterior y devuelve un error.
   */
  importBackup(json: string, mode: 'replace' | 'merge'): { ok: boolean; error?: string; count?: number } {
    const v = this.validateBackup(json);
    if (!v.ok) return v;
    const b = JSON.parse(json) as BackupBundle;
    // Fusionar por id: los existentes se conservan, se añaden los nuevos.
    const mergeById = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
      const ids = new Set(current.map((x) => x.id));
      return [...current, ...incoming.filter((x) => !ids.has(x.id))];
    };
    const teams = mode === 'replace' ? b.teams : mergeById(this._teams(), b.teams);
    const players = mode === 'replace' ? b.players : mergeById(this._players(), b.players);
    const folders = mode === 'replace' ? b.folders : mergeById(this._folders(), b.folders);
    const exercises = mode === 'replace' ? b.exercises : mergeById(this._exercises(), b.exercises);
    const sessions = mode === 'replace' ? b.sessions : mergeById(this._sessions(), b.sessions);

    // Copia automática recuperable del estado actual ANTES de importar.
    localStorage.setItem(this.key(KEY_AUTO_BACKUP), this.exportBackup());

    // Snapshot para rollback si falla una escritura (cuota de localStorage).
    const prevRaw: Record<string, string | null> = {
      [this.key(KEY_TEAMS)]: localStorage.getItem(this.key(KEY_TEAMS)),
      [this.key(KEY_PLAYERS)]: localStorage.getItem(this.key(KEY_PLAYERS)),
      [this.key(KEY_FOLDERS)]: localStorage.getItem(this.key(KEY_FOLDERS)),
      [this.key(KEY_EXERCISES)]: localStorage.getItem(this.key(KEY_EXERCISES)),
      [this.key(KEY_SESSIONS)]: localStorage.getItem(this.key(KEY_SESSIONS)),
    };
    const prevSig = {
      teams: this._teams(), players: this._players(), folders: this._folders(),
      exercises: this._exercises(), sessions: this._sessions(),
    };

    const write = (key: string, value: unknown[]): boolean => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    };

    if (
      !write(this.key(KEY_TEAMS), teams) || !write(this.key(KEY_PLAYERS), players) || !write(this.key(KEY_FOLDERS), folders) ||
      !write(this.key(KEY_EXERCISES), exercises) || !write(this.key(KEY_SESSIONS), sessions)
    ) {
      // Rollback: restaurar el estado previo y señalar el error.
      for (const [k, raw] of Object.entries(prevRaw)) {
        if (raw === null) localStorage.removeItem(k);
        else localStorage.setItem(k, raw);
      }
      this._teams.set(prevSig.teams);
      this._players.set(prevSig.players);
      this._folders.set(prevSig.folders);
      this._exercises.set(prevSig.exercises);
      this._sessions.set(prevSig.sessions);
      return { ok: false, error: 'No se pudo escribir el respaldo (almacenamiento lleno o bloqueado).' };
    }

    this._teams.set(teams);
    this._players.set(players);
    this._folders.set(folders);
    this._exercises.set(exercises);
    this._sessions.set(sessions);
    if (!this._teams().some((t) => t.id === this._activeTeamId())) {
      this._activeTeamId.set(this._teams()[0]?.id ?? null);
    }
    const count = teams.length + players.length + folders.length + exercises.length + sessions.length;
    return { ok: true, count };
  }

  /** ¿Existe una copia de seguridad automática? (se genera antes de importar). */
  hasAutoBackup(): boolean {
    return !!(typeof localStorage !== 'undefined' && localStorage.getItem(this.key(KEY_AUTO_BACKUP)));
  }

  /** Restaura la copia automática creada antes de la última importación. */
  restoreAutoBackup(): boolean {
    const raw = localStorage.getItem(this.key(KEY_AUTO_BACKUP));
    if (!raw) return false;
    const res = this.importBackup(raw, 'replace');
    return res.ok;
  }

  // ---------- Borrador (autoguardado / retomar) ----------

  loadDraft(teamId: string, exerciseId: string | null): ExerciseDraftData | null {
    const key = this.draftKey(teamId, exerciseId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as ExerciseDraftData;
      if (typeof data.savedAt !== 'string') return null;
      return data;
    } catch {
      return null;
    }
  }

  saveDraft(teamId: string, exerciseId: string | null, patch: Partial<ExerciseDraftData>): void {
    const key = this.draftKey(teamId, exerciseId);
    const prev = this.loadDraft(teamId, exerciseId);
    const data: ExerciseDraftData = {
      ...(prev ?? { title: '', category: 'Técnica', durationMinutes: null, description: '', explanation: '' }),
      ...patch,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  }

  clearDraft(teamId: string, exerciseId: string | null): void {
    localStorage.removeItem(this.draftKey(teamId, exerciseId));
  }

  private draftKey(teamId: string, exerciseId: string | null): string {
    return this.key(`${KEY_DRAFT_PREFIX}:${teamId}:${exerciseId ?? 'new'}`);
  }

  /** Escribe todas las colecciones bajo el namespace activo. */
  private saveAll(): void {
    save(this.key(KEY_TEAMS), this._teams());
    save(this.key(KEY_PLAYERS), this._players());
    save(this.key(KEY_FOLDERS), this._folders());
    save(this.key(KEY_EXERCISES), this._exercises());
    save(this.key(KEY_SESSIONS), this._sessions());
  }
}

export interface ExerciseDraftData {
  title: string;
  category: string;
  durationMinutes: number | null;
  description: string;
  explanation: string;
  materials?: string[];
  objectives?: string[];
  minPlayers?: number | null;
  maxPlayers?: number | null;
  savedAt: string;
}
