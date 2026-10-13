import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { StoreService, uid } from '../../core/store.service';
import {
  Exercise,
  Session,
  SessionAttendance,
  SessionSection,
  SessionTask,
  SessionSheet,
  EXERCISE_CATEGORIES,
} from '../../core/models';
import { ConfirmService } from '../../core/confirm.service';
import { BoardSessionService } from '../../core/board-session.service';
import { SessionDesignService } from '../../core/session-design.service';
import { EMPTY_SESSION_SHEET, taskMinutes, validSessionDate } from '../../core/session-plan';
import { PALETA_JUGADOR } from '../../core/player-colors';
import { fillSessionSheetWindow } from '../../core/session-sheet';

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
  sheet: SessionSheet;
  revision?: number;
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
  private readonly boardSession = inject(BoardSessionService);
  private readonly designBridge = inject(SessionDesignService);
  private readonly router = inject(Router);
  protected readonly colors = PALETA_JUGADOR;
  protected readonly categories = EXERCISE_CATEGORIES;
  protected readonly pdfError = signal('');
  protected readonly exporting = signal(false);
  protected readonly newExerciseOpen = signal(false);
  protected readonly newExerciseTitle = signal('');
  protected readonly newExerciseCategory = signal<Exercise['category']>('Técnica');
  protected readonly newExerciseFolder = signal<string | null>(null);
  protected readonly newExerciseDescription = signal('');
  protected readonly newExerciseDevelopment = signal('');
  private restoredContext = '';
  private baseline = '';
  private designInProgress = false;

  private hasChanges(): boolean {
    return (
      this.editorOpen() &&
      (JSON.stringify(this.form()) !== this.baseline ||
        (this.newExerciseOpen() && !!this.newExerciseTitle().trim()))
    );
  }

  canLeaveSession(): boolean {
    if (this.saving()) return false;
    return (
      this.designInProgress ||
      !this.hasChanges() ||
      window.confirm('Hay cambios sin guardar en esta sesión. ¿Descartarlos y salir?')
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasChanges() && !this.designInProgress) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  constructor() {
    effect(() => {
      if (!this.team()) return;
      const context = this.store.sessionDesignContext();
      if (context === this.restoredContext) return;
      this.restoredContext = context;
      try {
        const handoff = this.designBridge.take(context);
        if (!handoff || handoff.session.teamId !== this.team()?.id) return;
        const ex = this.store.exercises().find((e) => e.id === handoff.exerciseId);
        const restored = structuredClone(handoff.session);
        if (ex)
          restored.tasks = restored.tasks.map((t) =>
            t.id === handoff.taskId ? { ...t, snapshot: structuredClone(ex) } : t,
          );
        this.edit(restored);
        if (!this.store.sessions().some((s) => s.id === restored.id))
          this.form.update((f) => ({ ...f, id: null }));
        this.baseline = handoff.baseline;
      } catch (error) {
        this.pdfError.set(`No se pudo recuperar el borrador: ${(error as Error).message}`);
      }
    });
  }

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
        if (rows.some((row) => row.id === f.id)) continue;
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
      sheet: { ...EMPTY_SESSION_SHEET },
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
        position: p.position,
        status: 'Pendiente',
        group: '',
        attitude: '',
        minutes: null,
        notes: '',
      })),
    });
    this.editorOpen.set(true);
    this.baseline = JSON.stringify(this.form());
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
      sheet: { ...EMPTY_SESSION_SHEET, ...s.sheet },
      revision: s.revision,
      attendance: [
        ...(s.attendance ?? []).map((a) => ({
          ...a,
          position:
            a.position || this.roster().find((p) => p.id === a.playerId)?.position || ('' as const),
        })),
        ...this.roster()
          .filter((p) => !(s.attendance ?? []).some((a) => a.playerId === p.id))
          .map((p) => ({
            playerId: p.id,
            playerName: p.name,
            position: p.position,
            status: 'Pendiente',
            group: '',
            attitude: '',
            minutes: null,
            notes: '',
          })),
      ],
      tasks: structuredClone(s.tasks).map((t) => ({
        ...t,
        section: t.section ?? 'main',
        seriesCount: t.seriesCount ?? 1,
        minutesPerSeries: t.minutesPerSeries ?? t.durationMinutes,
      })),
    });
    this.editorOpen.set(true);
    this.baseline = JSON.stringify(this.form());
  }

  protected closeEditor(): void {
    if (!this.canLeaveSession()) return;
    this.formError.set('');
    this.editorOpen.set(false);
    this.pickerOpen.set(false);
    this.newExerciseOpen.set(false);
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
          material: ex.materials.join(', '),
          section: this.pickerSection(),
          seriesCount: 1,
          minutesPerSeries: ex.durationMinutes,
          sortOrder: f.tasks.length,
          snapshot: structuredClone(ex),
          repetitions: 1,
          restMinutes: 0,
          development: ex.explanation,
          aspects: ex.description,
          progression: '',
          playerColors: { ...ex.canvas?.playerColors },
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
        if (
          'seriesCount' in patch ||
          'minutesPerSeries' in patch ||
          'repetitions' in patch ||
          'restMinutes' in patch
        ) {
          next.durationMinutes = taskMinutes(next);
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
    if (!validSessionDate(f.date)) return 'La fecha no es válida.';
    if (f.sheet.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.sheet.time))
      return 'La hora no es válida.';
    const dur = f.durationMinutes;
    if (dur !== null && (!Number.isInteger(dur) || dur < 0 || dur > 600)) {
      return 'La duración de la sesión tiene que estar entre 0 y 600 minutos.';
    }
    for (const t of f.tasks) {
      if (!t.title.trim()) return 'Cada ejercicio necesita un título.';
      if (
        t.repetitions != null &&
        (!Number.isInteger(t.repetitions) || t.repetitions < 1 || t.repetitions > 50)
      )
        return 'Las repeticiones deben estar entre 1 y 50.';
      if (
        t.restMinutes != null &&
        (!Number.isInteger(t.restMinutes) || t.restMinutes < 0 || t.restMinutes > 600)
      )
        return 'El descanso debe ser un número entero entre 0 y 600 minutos.';
      const d = t.durationMinutes;
      if (d !== null && (!Number.isInteger(d) || d < 0 || d > 600)) {
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

  protected async save(): Promise<void> {
    if (this.saving()) return;
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
    if (!Number.isInteger(duracionEfectiva) || duracionEfectiva < 0 || duracionEfectiva > 600) {
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
      sheet: { ...f.sheet },
      revision: f.revision,
      attendance: f.attendance.map((a) => ({ ...a })),
      tasks: f.tasks.map((t, i) => ({ ...t, sortOrder: i })),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      savedAt: new Date().toISOString(),
    };
    try {
      if (await this.store.saveSession(session)) {
        this.editorOpen.set(false);
        this.pickerOpen.set(false);
      } else {
        this.formError.set(
          'No se confirmó el guardado. Tu borrador sigue abierto; revisa el aviso y reintenta.',
        );
      }
    } catch (error) {
      this.formError.set(`No se pudo guardar: ${(error as Error).message}`);
    } finally {
      this.saving.set(false);
    }
  }

  protected jumpTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  protected setBib(task: SessionTask, playerId: string, color: string): void {
    const playerColors = { ...task.playerColors };
    if (playerColors[playerId] === color) delete playerColors[playerId];
    else playerColors[playerId] = color;
    this.updateTask(task.id, { playerColors });
  }

  protected startNewExercise(section: SessionSection): void {
    this.pickerSection.set(section);
    this.newExerciseTitle.set('');
    this.newExerciseCategory.set(
      section === 'warmup' ? 'Calentamiento' : section === 'cooldown' ? 'Recuperación' : 'Técnica',
    );
    this.newExerciseFolder.set(null);
    this.newExerciseDescription.set('');
    this.newExerciseDevelopment.set('');
    this.newExerciseOpen.set(true);
  }

  protected async createExercise(): Promise<void> {
    if (this.saving()) return;
    const teamId = this.team()?.id;
    const title = this.newExerciseTitle().trim();
    if (!teamId || !title) {
      this.formError.set('Pon un título al nuevo ejercicio.');
      return;
    }
    const ex: Exercise = {
      id: uid(),
      teamId,
      title,
      folderId: this.newExerciseFolder(),
      category: this.newExerciseCategory(),
      description: this.newExerciseDescription(),
      explanation: this.newExerciseDevelopment(),
      objectives: [],
      materials: [],
      durationMinutes: null,
      minPlayers: null,
      maxPlayers: null,
      loadMode: 'fixed',
      seriesCount: null,
      repetitionsCount: null,
      workSeconds: null,
      restSeconds: null,
      isTemplate: false,
      canvas: null,
      thumbnail: null,
      savedAt: new Date().toISOString(),
    };
    this.saving.set(true);
    this.formError.set('');
    try {
      if (!(await this.store.saveExercise(ex))) {
        this.formError.set('No se pudo crear el ejercicio. Reintenta.');
        return;
      }
      this.addExercise(ex);
      this.newExerciseOpen.set(false);
    } catch (error) {
      this.formError.set(`No se pudo crear: ${(error as Error).message}`);
    } finally {
      this.saving.set(false);
    }
  }

  protected designTask(task: SessionTask): void {
    const ex = this.store
      .exercises()
      .find((e) => e.id === task.exerciseId && e.teamId === this.team()?.id);
    if (!ex) {
      this.formError.set(
        'El ejercicio ya no está en la biblioteca. Su copia permanece en esta sesión.',
      );
      return;
    }
    const f = this.form();
    try {
      this.designBridge.put(this.store.sessionDesignContext(), {
        session: {
          ...structuredClone(f),
          id: f.id ?? uid(),
          teamId: this.team()!.id,
          createdAt: new Date().toISOString(),
          savedAt: new Date().toISOString(),
        },
        taskId: task.id,
        exerciseId: ex.id,
        baseline: this.baseline,
      });
      this.boardSession.open(ex.id, ex.canvas, null, '/sessions');
      this.designInProgress = true;
      void this.router
        .navigate(['/board'])
        .then((ok) => {
          if (!ok) this.designInProgress = false;
        })
        .catch((error: Error) => {
          this.designInProgress = false;
          this.formError.set(error.message);
        });
    } catch (error) {
      this.formError.set(
        `No se pudo conservar el borrador para dibujar: ${(error as Error).message}`,
      );
    }
  }

  protected async viewPdf(session: Session): Promise<void> {
    if (this.exporting()) return;
    this.pdfError.set('');
    const view = window.open('', '_blank');
    if (!view) {
      this.pdfError.set('Permite ventanas emergentes para abrir la ficha PDF.');
      return;
    }
    view.opener = null;
    view.document.body.textContent = 'Preparando ficha e imágenes…';
    this.exporting.set(true);
    try {
      const printable = {
        ...session,
        attendance: (session.attendance ?? []).map((a) => ({
          ...a,
          position:
            a.position || this.roster().find((p) => p.id === a.playerId)?.position || ('' as const),
        })),
      };
      await fillSessionSheetWindow(
        view,
        printable,
        this.team()?.name ?? '',
        this.store.getExercisesForTeam(session.teamId),
      );
    } catch (error) {
      if (!view.closed) view.close();
      this.pdfError.set(`No se pudo preparar el PDF: ${(error as Error).message}`);
    } finally {
      this.exporting.set(false);
    }
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
