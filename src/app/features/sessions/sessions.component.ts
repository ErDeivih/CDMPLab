import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService, uid } from '../../core/store.service';
import {
  Exercise,
  Session,
  SessionAttendance,
  SessionSection,
  SessionTask,
} from '../../core/models';
import { ConfirmService } from '../../core/confirm.service';

interface SessionDraft {
  id: string | null;
  title: string;
  date: string;
  durationMinutes: number | null;
  notes: string;
  number: number | null;
  objectives: string;
  material: string;
  attendance: SessionAttendance[];
  tasks: SessionTask[];
}

const SECTIONS: ReadonlyArray<{ id: SessionSection; label: string }> = [
  { id: 'warmup', label: 'Calentamiento' },
  { id: 'main', label: 'Parte principal' },
  { id: 'cooldown', label: 'Vuelta a la calma' },
];

const ATTENDANCE_STATUSES = [
  'Pendiente',
  'Asiste',
  'Tarde',
  'Recupera',
  'Lesión',
  'Enfermo',
  'Estudios',
  'Viaje / Vacaciones',
  'Trabajo',
  'Sanción interna',
  'Castigo de padres',
  'Falta no justificada',
  'Otros',
] as const;

const ATTITUDES = ['', 'Excelente', 'Muy buena', 'Buena', 'Regular', 'Mala', 'Pésima'] as const;

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Component({
  selector: 'app-sessions',
  styleUrl: './sessions.component.scss',
  templateUrl: './sessions.component.html',
  imports: [FormsModule],
})
export class SessionsComponent {
  private readonly store = inject(StoreService);
  private readonly confirmSvc = inject(ConfirmService);

  protected readonly team = this.store.activeTeam;
  protected readonly sections = SECTIONS;
  protected readonly attendanceStatuses = ATTENDANCE_STATUSES;
  protected readonly attitudes = ATTITUDES;
  protected readonly roster = this.store.activeTeamPlayers;

  protected readonly sessions = computed(() => {
    const teamId = this.team()?.id;
    if (!teamId) return [];
    // Orden por la FECHA de la sesión (la más reciente primero) y `savedAt` solo como
    // desempate. Antes ordenaba por fecha de guardado: una sesión de la semana pasada
    // editada hoy aparecía la primera, por delante de la de mañana.
    return this.store
      .getSessionsForTeam(teamId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.savedAt.localeCompare(a.savedAt));
  });

  /** Fecha de la sesión en formato español (dd/mm/aaaa). */
  protected formatDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '');
  }

  protected sessionLabel(s: Session): string {
    return (
      s.title.trim() || (s.number ? `Sesión ${s.number}` : `Sesión del ${this.formatDate(s.date)}`)
    );
  }

  /** ¿La tarea se quedó atrás respecto al ejercicio de la biblioteca? Se compara el
   *  `savedAt` del snapshot (la copia que se guardó al añadirla) con el del ejercicio
   *  vivo. Sin snapshot (p. ej. tras recargar en modo remoto, donde no se persiste) NO
   *  se avisa de nada: preferimos no decir nada a decirlo mal. */
  protected isTaskOutdated(t: SessionTask): boolean {
    if (!t.exerciseId || !t.snapshot) return false;
    const live = this.store
      .getExercisesForTeam(this.team()?.id ?? '')
      .find((e) => e.id === t.exerciseId);
    return !!live && live.savedAt !== t.snapshot.savedAt;
  }

  // ---------- Editor ----------
  protected readonly editorOpen = signal(false);
  protected readonly form = signal<SessionDraft>(this.emptyForm());
  protected readonly saving = signal(false);
  /** Motivo por el que no se puede guardar la sesión (vacío = todo correcto). */
  protected readonly formError = signal('');

  // ---------- Picker de ejercicios ----------
  protected readonly pickerOpen = signal(false);
  protected readonly pickerSearch = signal('');
  protected readonly pickerFolder = signal('all');
  protected readonly pickerSection = signal<SessionSection>('main');
  protected readonly folders = computed(() =>
    this.team() ? this.store.getFoldersForTeam(this.team()!.id) : [],
  );
  protected readonly folderOptions = computed(() => {
    const folders = this.folders();
    const rows: Array<{ id: string; label: string }> = [];
    const walk = (parentId: string | null, depth: number): void => {
      for (const f of folders.filter((item) => item.parentId === parentId)) {
        rows.push({ id: f.id, label: `${'— '.repeat(depth)}${f.name}` });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  });
  private folderAndDescendants(id: string): Set<string> {
    const ids = new Set([id]);
    const folders = this.folders();
    for (const parent of ids) {
      for (const child of folders.filter((f) => f.parentId === parent)) ids.add(child.id);
    }
    return ids;
  }
  protected readonly pickerExercises = computed(() => {
    const teamId = this.team()?.id;
    if (!teamId) return [];
    const q = this.pickerSearch().trim().toLowerCase();
    const folder = this.pickerFolder();
    const folderIds =
      folder !== 'all' && folder !== 'none' ? this.folderAndDescendants(folder) : null;
    return this.store
      .getExercisesForTeam(teamId)
      .filter(
        (e) =>
          (!q || e.title.toLowerCase().includes(q)) &&
          (folder === 'all' ||
            (folder === 'none' ? e.folderId === null : folderIds!.has(e.folderId ?? ''))),
      )
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  private emptyForm(): SessionDraft {
    return {
      id: null,
      title: '',
      date: todayIso(),
      durationMinutes: 120,
      notes: '',
      number: null,
      objectives: '',
      material: '',
      attendance: [],
      tasks: [],
    };
  }

  protected tasksInSection(section: SessionSection): SessionTask[] {
    return this.form().tasks.filter((t) => (t.section ?? 'main') === section);
  }

  protected sectionLabel(section: SessionSection): string {
    return SECTIONS.find((item) => item.id === section)?.label ?? 'Parte principal';
  }

  protected moveTaskInSection(id: string, dir: -1 | 1): void {
    const task = this.form().tasks.find((item) => item.id === id);
    if (!task) return;
    const siblings = this.tasksInSection(task.section ?? 'main');
    const siblingIndex = siblings.findIndex((item) => item.id === id);
    const other = siblings[siblingIndex + dir];
    if (!other) return;
    this.form.update((f) => {
      const tasks = [...f.tasks];
      const a = tasks.findIndex((item) => item.id === id);
      const b = tasks.findIndex((item) => item.id === other.id);
      [tasks[a], tasks[b]] = [tasks[b], tasks[a]];
      return { ...f, tasks };
    });
  }

  protected attendanceCount(): number {
    return this.form().attendance.filter((a) => a.status === 'Asiste' || a.status === 'Tarde')
      .length;
  }

  protected totalMinutes(): number {
    return this.form().tasks.reduce((acc, t) => acc + (t.durationMinutes ?? 0), 0);
  }

  protected sessionTotal(s: Session): number {
    if (s.durationMinutes != null) return s.durationMinutes;
    return s.tasks.reduce((acc, t) => acc + (t.durationMinutes ?? 0), 0);
  }

  protected onSearchInput(evt: Event): string {
    return (evt.target as HTMLInputElement).value;
  }

  protected createNew(): void {
    this.formError.set('');
    const nextNumber = Math.max(0, ...this.sessions().map((s) => s.number ?? 0)) + 1;
    this.form.set({
      ...this.emptyForm(),
      number: nextNumber,
      attendance: this.roster().map((p) => ({
        playerId: p.id,
        playerName: p.name,
        status: 'Pendiente',
        group: '',
        attitude: '',
        minutes: null,
        notes: '',
      })),
    });
    this.editorOpen.set(true);
  }

  protected edit(s: Session): void {
    this.formError.set('');
    this.form.set({
      id: s.id,
      title: s.title,
      date: s.date,
      durationMinutes: s.durationMinutes,
      notes: s.notes,
      number: s.number ?? null,
      objectives: s.objectives ?? '',
      material: s.material ?? '',
      attendance: [
        ...(s.attendance ?? []),
        ...this.roster()
          .filter((p) => !(s.attendance ?? []).some((a) => a.playerId === p.id))
          .map((p) => ({
            playerId: p.id,
            playerName: p.name,
            status: 'Pendiente',
            group: '',
            attitude: '',
            minutes: null,
            notes: '',
          })),
      ],
      tasks: s.tasks.map((t) => ({
        ...t,
        section: t.section ?? 'main',
        seriesCount: t.seriesCount ?? 1,
        minutesPerSeries: t.minutesPerSeries ?? t.durationMinutes,
      })),
    });
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.formError.set('');
    this.editorOpen.set(false);
    this.pickerOpen.set(false);
  }

  // ---------- Tareas ----------

  protected openPicker(): void {
    this.pickerSearch.set('');
    this.pickerFolder.set('all');
    this.pickerOpen.set(true);
  }

  /** Cierra el picker en línea (botón «Listo»). */
  protected closePicker(): void {
    this.pickerOpen.set(false);
  }

  /** Cuántas veces está ya ese ejercicio en la sesión (una sesión puede repetirlo). */
  protected timesInSession(exerciseId: string): number {
    return this.form().tasks.filter((t) => t.exerciseId === exerciseId).length;
  }

  protected addExercise(ex: Exercise): void {
    this.form.update((f) => ({
      ...f,
      tasks: [
        ...f.tasks,
        {
          id: uid(),
          exerciseId: ex.id,
          title: ex.title,
          durationMinutes: ex.durationMinutes,
          material: '',
          section: this.pickerSection(),
          seriesCount: 1,
          minutesPerSeries: ex.durationMinutes,
          sortOrder: f.tasks.length,
          snapshot: structuredClone(ex),
        },
      ],
    }));
    // NO se cierra el picker: añadir 8 ejercicios a una sesión eran 8 aperturas y cierres
    // del diálogo. Se cierra con «Listo» (o al cerrar el editor).
  }

  protected moveTask(index: number, dir: -1 | 1): void {
    this.form.update((f) => {
      const tasks = [...f.tasks];
      const to = index + dir;
      if (to < 0 || to >= tasks.length) return f;
      const swap = tasks[index];
      tasks[index] = tasks[to];
      tasks[to] = swap;
      return { ...f, tasks };
    });
  }

  protected removeTask(index: number): void {
    this.form.update((f) => ({ ...f, tasks: f.tasks.filter((_, i) => i !== index) }));
  }

  protected setTaskDuration(index: number, evt: Event): void {
    const v = parseInt((evt.target as HTMLInputElement).value, 10);
    this.form.update((f) => ({
      ...f,
      tasks: f.tasks.map((t, i) =>
        i === index ? { ...t, durationMinutes: isNaN(v) ? null : v } : t,
      ),
    }));
  }

  protected updateTask(id: string, patch: Partial<SessionTask>): void {
    this.form.update((f) => ({
      ...f,
      tasks: f.tasks.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if ('seriesCount' in patch || 'minutesPerSeries' in patch) {
          next.durationMinutes =
            next.seriesCount != null && next.minutesPerSeries != null
              ? next.seriesCount * next.minutesPerSeries
              : null;
        }
        return next;
      }),
    }));
  }

  protected updateAttendance(playerId: string, patch: Partial<SessionAttendance>): void {
    this.form.update((f) => ({
      ...f,
      attendance: f.attendance.map((a) => (a.playerId === playerId ? { ...a, ...patch } : a)),
    }));
  }

  /**
   * Valida el borrador ANTES de guardar y explica el motivo. Antes solo se exigía el
   * título: se podía guardar una sesión con fecha vacía o mal formada (que luego ordena
   * mal y no se puede filtrar) y con duraciones negativas.
   */
  private validateForm(f: SessionDraft): string | null {
    if (f.number !== null && (!Number.isInteger(f.number) || f.number < 1 || f.number > 9999)) {
      return 'El número de sesión debe estar entre 1 y 9999.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'La fecha no es válida.';
    const dur = f.durationMinutes;
    if (dur !== null && (!Number.isFinite(dur) || dur < 0 || dur > 600)) {
      return 'La duración de la sesión tiene que estar entre 0 y 600 minutos.';
    }
    for (const t of f.tasks) {
      const d = t.durationMinutes;
      if (d !== null && (!Number.isFinite(d) || d < 0 || d > 600)) {
        return 'La duración de una tarea no puede ser negativa ni superar 600 minutos.';
      }
      if (
        t.seriesCount != null &&
        (!Number.isInteger(t.seriesCount) || t.seriesCount < 1 || t.seriesCount > 50)
      ) {
        return 'Las series deben estar entre 1 y 50.';
      }
      if (
        t.minutesPerSeries != null &&
        (!Number.isInteger(t.minutesPerSeries) ||
          t.minutesPerSeries < 0 ||
          t.minutesPerSeries > 600)
      ) {
        return 'Los minutos por serie deben estar entre 0 y 600.';
      }
    }
    for (const a of f.attendance) {
      if (a.minutes != null && (!Number.isInteger(a.minutes) || a.minutes < 0 || a.minutes > 600)) {
        return 'Los minutos de asistencia deben estar entre 0 y 600.';
      }
    }
    return null;
  }

  protected save(): void {
    const teamId = this.team()?.id;
    if (!teamId) return;
    const f = this.form();
    const err = this.validateForm(f);
    if (err) {
      this.formError.set(err);
      return;
    }
    // La duración EFECTIVA es la que se guarda: si el campo va vacío se usa la suma de las tareas,
    // y esa suma podía pasarse del máximo que este mismo formulario exige (3 tareas de 250 → 750).
    // Se guardaba 750 y, al reabrir la sesión, no se podía volver a guardar por un número que el
    // usuario nunca escribió.
    const duracionEfectiva = f.durationMinutes ?? this.totalMinutes();
    if (!Number.isFinite(duracionEfectiva) || duracionEfectiva < 0 || duracionEfectiva > 600) {
      this.formError.set(
        'La duración de la sesión (la suma de sus tareas) no puede superar 600 minutos. Ajusta las tareas o escribe una duración menor.',
      );
      return;
    }
    this.formError.set('');
    this.saving.set(true);
    const existing = f.id ? this.store.sessions().find((s) => s.id === f.id) : undefined;
    const session: Session = {
      id: f.id ?? uid(),
      teamId,
      title: f.title.trim(),
      date: f.date,
      durationMinutes: duracionEfectiva,
      notes: f.notes,
      number: f.number,
      objectives: f.objectives.trim(),
      material: f.material.trim(),
      attendance: f.attendance.map((a) => ({ ...a })),
      tasks: f.tasks.map((t, i) => ({ ...t, sortOrder: i })),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      savedAt: new Date().toISOString(),
    };
    this.store.saveSession(session);
    this.saving.set(false);
    this.editorOpen.set(false);
  }

  protected remove(s: Session): void {
    this.confirmSvc.ask({
      title: 'Eliminar sesión',
      message: `¿Eliminar la sesión “${this.sessionLabel(s)}”?`,
      confirmLabel: 'Eliminar',
      onConfirm: () => this.store.deleteSession(s.id),
    });
  }
}
