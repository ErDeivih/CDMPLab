import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService, uid } from '../../core/store.service';
import { Exercise, Session, SessionTask } from '../../core/models';
import { ConfirmService } from '../../core/confirm.service';

interface SessionDraft {
  id: string | null;
  title: string;
  date: string;
  durationMinutes: number | null;
  notes: string;
  tasks: SessionTask[];
}

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
  protected readonly pickerExercises = computed(() => {
    const teamId = this.team()?.id;
    if (!teamId) return [];
    const q = this.pickerSearch().trim().toLowerCase();
    return this.store
      .getExercisesForTeam(teamId)
      .filter((e) => (q ? e.title.toLowerCase().includes(q) : true))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  private emptyForm(): SessionDraft {
    return { id: null, title: '', date: todayIso(), durationMinutes: null, notes: '', tasks: [] };
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
    this.form.set(this.emptyForm());
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
      tasks: s.tasks.map((t) => ({ ...t })),
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

  /**
   * Valida el borrador ANTES de guardar y explica el motivo. Antes solo se exigía el
   * título: se podía guardar una sesión con fecha vacía o mal formada (que luego ordena
   * mal y no se puede filtrar) y con duraciones negativas.
   */
  private validateForm(f: SessionDraft): string | null {
    if (!f.title.trim()) return 'El título de la sesión es obligatorio.';
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
      message: `¿Eliminar la sesión “${s.title}”?`,
      confirmLabel: 'Eliminar',
      onConfirm: () => this.store.deleteSession(s.id),
    });
  }
}
