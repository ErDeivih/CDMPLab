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
    return this.store.getSessionsForTeam(teamId).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  // ---------- Editor ----------
  protected readonly editorOpen = signal(false);
  protected readonly form = signal<SessionDraft>(this.emptyForm());
  protected readonly saving = signal(false);

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
    this.form.set(this.emptyForm());
    this.editorOpen.set(true);
  }

  protected edit(s: Session): void {
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
    this.editorOpen.set(false);
    this.pickerOpen.set(false);
  }

  // ---------- Tareas ----------

  protected openPicker(): void {
    this.pickerSearch.set('');
    this.pickerOpen.set(true);
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
          snapshot: JSON.parse(JSON.stringify(ex)) as Exercise,
        },
      ],
    }));
    this.pickerOpen.set(false);
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
      tasks: f.tasks.map((t, i) => (i === index ? { ...t, durationMinutes: isNaN(v) ? null : v } : t)),
    }));
  }

  protected save(): void {
    const teamId = this.team()?.id;
    if (!teamId) return;
    const f = this.form();
    if (!f.title.trim()) return;
    this.saving.set(true);
    const existing = f.id ? this.store.sessions().find((s) => s.id === f.id) : undefined;
    const session: Session = {
      id: f.id ?? uid(),
      teamId,
      title: f.title.trim(),
      date: f.date,
      durationMinutes: f.durationMinutes ?? this.totalMinutes(),
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
