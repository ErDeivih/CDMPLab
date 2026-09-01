import { Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { StoreService, uid } from '../../core/store.service';
import { Exercise, ExerciseCategory, ExerciseFolder } from '../../core/models';
import { renderBoardSvg } from '../../core/render';
import { BoardSessionService } from '../../core/board-session.service';
import { ConfirmService } from '../../core/confirm.service';

const CATEGORIES: ExerciseCategory[] = ['Técnica', 'Táctica', 'Físico', 'Portero', 'Calentamiento', 'Partido'];

interface EditorForm {
  id: string | null;
  title: string;
  category: ExerciseCategory;
  durationMinutes: number | null;
  description: string;
  explanation: string;
  materials: string;
  minPlayers: number | null;
  maxPlayers: number | null;
  folderId: string | null;
  objectives: string; // lista separada por comas (se guarda como string[])
}

@Component({
  selector: 'app-library',
  styleUrl: './library.component.scss',
  templateUrl: './library.component.html',
  imports: [FormsModule],
})
export class LibraryComponent implements OnDestroy {
  private readonly store = inject(StoreService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly sessionSvc = inject(BoardSessionService);
  private readonly confirmSvc = inject(ConfirmService);

  protected readonly categories = CATEGORIES;

  protected readonly team = this.store.activeTeam;

  protected readonly search = signal('');
  protected readonly categoryFilter = signal<ExerciseCategory | 'Todas'>('Todas');

  protected readonly folders = computed(() => {
    const teamId = this.team()?.id;
    if (!teamId) return [];
    return this.store.getFoldersForTeam(teamId);
  });

  // ---------- Árbol de carpetas ----------
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly folderFilter = signal<string>('all'); // 'all' | 'none' | folderId

  protected childrenOf(parentId: string | null): ExerciseFolder[] {
    return this.folders().filter((f) => f.parentId === parentId);
  }
  protected readonly treeRoots = computed(() => this.childrenOf(null));
  protected isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  protected readonly treeRows = computed(() => {
    const rows: Array<{ folder: ExerciseFolder; depth: number; hasChildren: boolean; expanded: boolean }> = [];
    const walk = (parentId: string | null, depth: number): void => {
      for (const f of this.childrenOf(parentId)) {
        const hasChildren = this.childrenOf(f.id).length > 0;
        const expanded = hasChildren && this.isExpanded(f.id);
        rows.push({ folder: f, depth, hasChildren, expanded });
        if (expanded) walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  });
  protected toggleExpand(id: string): void {
    this.expanded.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected subtreeFolderIds(folderId: string): Set<string> {
    const result = new Set<string>();
    const stack = [folderId];
    while (stack.length) {
      const cur = stack.pop()!;
      result.add(cur);
      this.childrenOf(cur).forEach((f) => stack.push(f.id));
    }
    return result;
  }

  protected readonly breadcrumb = computed(() => {
    const parts: ExerciseFolder[] = [];
    let cur = this.folders().find((f) => f.id === this.folderFilter());
    while (cur) {
      parts.unshift(cur);
      cur = this.folders().find((f) => f.id === cur!.parentId) ?? undefined;
    }
    return parts;
  });

  protected folderCount(folderId: string): number {
    const teamId = this.team()?.id;
    if (!teamId) return 0;
    const ids = this.subtreeFolderIds(folderId);
    return this.store.getExercisesForTeam(teamId).filter((e) => ids.has(e.folderId as string)).length;
  }

  // ---------- Crear / renombrar / borrar / duplicar carpeta ----------
  protected readonly newChildParent = signal<string | null | 'root'>(null);
  protected readonly newChildName = signal('');
  protected readonly renameTarget = signal<string | null>(null);
  protected readonly renameName = signal('');

  protected beginNewChild(parent: string | null): void {
    this.newChildParent.set(parent);
    this.newChildName.set('');
  }
  protected commitNewChild(): void {
    const teamId = this.team()?.id;
    const name = this.newChildName().trim();
    const parent = this.newChildParent() === 'root' ? null : (this.newChildParent() as string | null);
    if (!teamId || !name) return;
    this.store.createFolder(teamId, name, parent);
    this.newChildParent.set(null);
    if (parent) {
      this.expanded.update((s) => new Set(s).add(parent));
    }
  }

  protected beginRename(folder: ExerciseFolder): void {
    this.renameTarget.set(folder.id);
    this.renameName.set(folder.name);
  }
  protected commitRename(): void {
    const id = this.renameTarget();
    if (id && this.renameName().trim()) this.store.renameFolder(id, this.renameName().trim());
    this.renameTarget.set(null);
  }

  protected removeFolder(folder: ExerciseFolder): void {
    this.confirmSvc.ask({
      title: 'Eliminar carpeta',
      message: `¿Eliminar la carpeta “${folder.name}” y sus subcarpetas? Los ejercicios pasarán a "Sin carpeta".`,
      confirmLabel: 'Eliminar',
      onConfirm: () => {
        this.store.deleteFolder(folder.id);
        if (this.folderFilter() === folder.id) this.setFolderFilter('all');
      },
    });
  }

  protected duplicateFolderUI(folder: ExerciseFolder): void {
    this.store.duplicateFolder(folder.id);
  }

  // ---------- Mover ejercicio a carpeta ----------
  protected readonly moveTarget = signal<string | null>(null);
  protected openMovePicker(ex: Exercise): void {
    this.moveTarget.set(ex.id);
  }
  protected closeMovePicker(): void {
    this.moveTarget.set(null);
  }
  protected pickMoveFolder(folderId: string | null): void {
    const id = this.moveTarget();
    if (id) this.store.moveExerciseToFolder(id, folderId);
    this.moveTarget.set(null);
  }

  protected readonly exercises = computed(() => {
    const teamId = this.team()?.id;
    if (!teamId) return [];
    const q = this.search().trim().toLowerCase();
    const cat = this.categoryFilter();
    const folder = this.folderFilter();
    return this.store
      .getExercisesForTeam(teamId)
      .filter((e) => (cat === 'Todas' ? true : e.category === cat))
      .filter((e) =>
        folder === 'all' ? true : folder === 'none' ? !e.folderId : this.subtreeFolderIds(folder).has(e.folderId as string)
      )
      .filter((e) => (q ? `${e.title} ${e.description ?? ''} ${e.explanation ?? ''} ${e.category}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  // ---------- Editor ----------
  protected readonly editorOpen = signal(false);
  /** En móvil, el panel de carpetas es un cajón desplegable. */
  protected readonly sidebarOpen = signal(false);
  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }
  protected readonly form = signal<EditorForm>({ id: null, title: '', category: 'Técnica', durationMinutes: null, description: '', explanation: '', materials: '', minPlayers: null, maxPlayers: null, folderId: null, objectives: '' });
  protected readonly formError = signal('');
  protected readonly draftIndicator = signal<null | 'saved' | 'loaded'>(null);
  protected readonly saving = signal(false);

  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  protected preview(ex: Exercise): SafeHtml | null {
    const field = ex.canvas?.field ?? 'full';
    const els = ex.canvas?.frames?.[0]?.elements ?? [];
    if (els.length === 0) return null;
    return this.sanitizer.bypassSecurityTrustHtml(renderBoardSvg(field, els, { selectedId: null }));
  }

  protected onSearch(evt: Event): void {
    const el = evt.target as HTMLInputElement;
    this.search.set(el.value);
  }

  protected playerCount(ex: Exercise): string {
    const n = ex.maxPlayers ?? ex.minPlayers;
    return n ? `${n} jug.` : '—';
  }

  protected getError(): string {
    const t = this.form().title.trim();
    if (!t) return 'El título es obligatorio.';
    const min = this.form().minPlayers;
    const max = this.form().maxPlayers;
    if (min != null && max != null && min > max) return 'El número mínimo de jugadores no puede ser mayor que el máximo.';
    return '';
  }

  // ---------- Acciones ----------

  protected createNew(): void {
    const teamId = this.team()?.id;
    if (!teamId) return;
    // Retomar el borrador si existe.
    const draft = this.store.loadDraft(teamId, null);
    const base: EditorForm = {
      id: null,
      title: draft?.title ?? '',
      category: (draft?.category as ExerciseCategory) ?? 'Técnica',
      durationMinutes: draft?.durationMinutes ?? null,
      description: draft?.description ?? '',
      explanation: draft?.explanation ?? '',
      materials: draft?.materials?.join(', ') ?? '',
      minPlayers: draft?.minPlayers ?? null,
      maxPlayers: draft?.maxPlayers ?? null,
      folderId: null,
      objectives: draft?.objectives?.join(', ') ?? '',
    };
    this.form.set(base);
    this.draftIndicator.set(draft ? 'loaded' : null);
    this.editorOpen.set(true);
  }

  protected edit(ex: Exercise): void {
    this.form.set({
      id: ex.id,
      title: ex.title,
      category: ex.category,
      durationMinutes: ex.durationMinutes,
      description: ex.description,
      explanation: ex.explanation,
      materials: ex.materials?.join(', ') ?? '',
      minPlayers: ex.minPlayers,
      maxPlayers: ex.maxPlayers,
      folderId: ex.folderId,
      objectives: ex.objectives?.join(', ') ?? '',
    });
    this.draftIndicator.set(null);
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.clearDraftTimer();
    this.editorOpen.set(false);
  }

  protected onFormChange(): void {
    const teamId = this.team()?.id;
    if (!teamId || !this.editorOpen()) return;
    const f = this.form();
    this.formError.set('');
    this.draftIndicator.set('saved');
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.store.saveDraft(teamId, f.id, {
        title: f.title,
        category: f.category,
        durationMinutes: f.durationMinutes,
        description: f.description,
        explanation: f.explanation,
        materials: this.parseMaterials(f.materials),
        objectives: this.parseList(f.objectives),
        minPlayers: f.minPlayers,
        maxPlayers: f.maxPlayers,
      });
    }, 700);
  }

  private parseMaterials(value: string): string[] {
    return this.parseList(value);
  }

  private parseList(value: string): string[] {
    return value
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
  }

  protected save(): void {
    const teamId = this.team()?.id;
    if (!teamId) return;
    const f = this.form();
    const err = this.getError();
    if (err) {
      this.formError.set(err);
      return;
    }
    this.formError.set('');
    this.saving.set(true);
    const existing = f.id ? this.store.exercises().find((e) => e.id === f.id) : undefined;
    const ex: Exercise = {
      id: f.id ?? uid(),
      teamId,
      folderId: f.folderId,
      title: f.title.trim(),
      description: f.description.trim(),
      explanation: f.explanation.trim(),
      category: f.category,
      objectives: this.parseList(f.objectives),
      materials: this.parseMaterials(f.materials),
      durationMinutes: f.durationMinutes,
      minPlayers: f.minPlayers,
      maxPlayers: f.maxPlayers,
      loadMode: existing?.loadMode ?? 'fixed',
      seriesCount: existing?.seriesCount ?? null,
      repetitionsCount: existing?.repetitionsCount ?? null,
      workSeconds: existing?.workSeconds ?? null,
      restSeconds: existing?.restSeconds ?? null,
      isTemplate: existing?.isTemplate ?? false,
      canvas: existing?.canvas ?? null,
      thumbnail: existing?.thumbnail ?? null,
      savedAt: new Date().toISOString(),
    };
    this.store.saveExercise(ex);
    this.store.clearDraft(teamId, f.id);
    this.clearDraftTimer();
    this.saving.set(false);
    this.editorOpen.set(false);
  }

  /** Guardo la metadata y abro la pizarra para diseñar este ejercicio. */
  protected design(): void {
    const teamId = this.team()?.id;
    if (!teamId) return;
    const f = this.form();
    const err = this.getError();
    if (err) {
      this.formError.set(err);
      return;
    }
    this.formError.set('');
    const existing = f.id ? this.store.exercises().find((e) => e.id === f.id) : undefined;
    const ex: Exercise = {
      id: f.id ?? uid(),
      teamId,
      folderId: f.folderId,
      title: f.title.trim(),
      description: f.description.trim(),
      explanation: f.explanation.trim(),
      category: f.category,
      objectives: this.parseList(f.objectives),
      materials: this.parseMaterials(f.materials),
      durationMinutes: f.durationMinutes,
      minPlayers: f.minPlayers,
      maxPlayers: f.maxPlayers,
      loadMode: existing?.loadMode ?? 'fixed',
      seriesCount: existing?.seriesCount ?? null,
      repetitionsCount: existing?.repetitionsCount ?? null,
      workSeconds: existing?.workSeconds ?? null,
      restSeconds: existing?.restSeconds ?? null,
      isTemplate: existing?.isTemplate ?? false,
      canvas: existing?.canvas ?? null,
      thumbnail: existing?.thumbnail ?? null,
      savedAt: new Date().toISOString(),
    };
    this.store.saveExercise(ex);
    this.store.clearDraft(teamId, f.id);
    this.clearDraftTimer();
    this.editorOpen.set(false);
    this.sessionSvc.open(ex.id, ex.canvas);
    this.router.navigate(['/board']);
  }

  protected openForDesign(ex: Exercise): void {
    this.sessionSvc.open(ex.id, ex.canvas);
    this.router.navigate(['/board']);
  }

  protected duplicate(ex: Exercise): void {
    this.store.duplicateExercise(ex.id);
  }

  protected remove(ex: Exercise): void {
    this.confirmSvc.ask({
      title: 'Eliminar tarea',
      message: `¿Eliminar el ejercicio “${ex.title}”? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: () => this.store.deleteExercise(ex.id),
    });
  }

  protected setFilter(cat: ExerciseCategory | 'Todas'): void {
    this.categoryFilter.set(cat);
  }

  protected setFolderFilter(f: string): void {
    this.folderFilter.set(f);
  }

  // ---------- Menús táctiles (no hover) ----------
  /** Id de tarjeta de ejercicio cuyo menú "Más" está abierto. */
  protected readonly moreMenu = signal<string | null>(null);
  protected toggleMore(id: string): void {
    this.moreMenu.update((cur) => (cur === id ? null : id));
    this.folderMenu.set(null);
  }
  /** Id de fila de carpeta cuyo menú contextual está abierto. */
  protected readonly folderMenu = signal<string | null>(null);
  protected toggleFolderMenu(id: string): void {
    this.folderMenu.update((cur) => (cur === id ? null : id));
    this.moreMenu.set(null);
  }
  /** Cierra los menús al hacer clic/taponar fuera de ellos (táctil accesible). */
  @HostListener('document:click', ['$event'])
  onDocClick(evt: Event): void {
    const t = evt.target as HTMLElement | null;
    if (!t) return;
    if (t.closest('.ex-more-menu') || t.closest('.ex-more-btn')) return;
    if (t.closest('.folder-more-menu') || t.closest('.tree-more-btn')) return;
    this.moreMenu.set(null);
    this.folderMenu.set(null);
  }

  protected folderName(id: string): string {
    return this.folders().find((f) => f.id === id)?.name ?? 'Carpeta';
  }

  private clearDraftTimer(): void {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.clearDraftTimer();
  }
}
