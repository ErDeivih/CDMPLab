import { Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { StoreService, uid } from '../../core/store.service';
import { Exercise, ExerciseCategory, ExerciseFolder, EXERCISE_CATEGORIES } from '../../core/models';
import { renderBoardSvg } from '../../core/render';
import { BoardSessionService } from '../../core/board-session.service';
import { ConfirmService } from '../../core/confirm.service';

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

  // Fuente ÚNICA de categorías (`models.EXERCISE_CATEGORIES`). Antes había una lista
  // local de 6 categorías frente a las 14 del modelo: los ejercicios creados en la
  // pizarra como "Rondo", "Posesión" o "Finalización" NO se podían filtrar aquí.
  protected readonly categories = EXERCISE_CATEGORIES;

  protected readonly team = this.store.activeTeam;

  /** Lo que el usuario ha escrito (inmediato: el input no se bloquea). */
  protected readonly searchInput = signal('');
  /** Valor EFECTIVO con el que se filtra, con retardo (ver `onSearch`). */
  protected readonly search = signal('');
  /** Retardo de la búsqueda: escribir no re-renderiza la lista ni regenera las
   *  miniaturas en cada pulsación. */
  private static readonly SEARCH_DELAY_MS = 200;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly categoryFilter = signal<ExerciseCategory | 'Todas'>('Todas');

  /** Orden de la lista. `recent` (por defecto) = lo último guardado primero. */
  protected readonly order = signal<'recent' | 'az' | 'duration'>('recent');

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
    const rows: Array<{
      folder: ExerciseFolder;
      depth: number;
      hasChildren: boolean;
      expanded: boolean;
    }> = [];
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

  /**
   * Nº de ejercicios por carpeta (incluye los de sus subcarpetas), calculado en UNA
   * pasada y cacheado. Antes `folderCount(id)` se llamaba una vez por fila del árbol y,
   * en cada ciclo de detección de cambios, recorría el subárbol Y filtraba TODOS los
   * ejercicios del equipo: coste O(carpetas × ejercicios) por render.
   */
  private readonly folderCounts = computed<Map<string, number>>(() => {
    const totals = new Map<string, number>();
    const teamId = this.team()?.id;
    if (!teamId) return totals;
    const direct = new Map<string, number>();
    for (const e of this.store.getExercisesForTeam(teamId)) {
      const id = e.folderId as string | null;
      if (id) direct.set(id, (direct.get(id) ?? 0) + 1);
    }
    const parentOf = new Map(this.folders().map((f) => [f.id, f.parentId]));
    for (const f of this.folders()) {
      // El directo de cada carpeta suma a ella misma y a TODOS sus ancestros.
      let cur: string | null = f.id;
      let guard = 0;
      while (cur && guard++ < 100) {
        totals.set(cur, (totals.get(cur) ?? 0) + (direct.get(f.id) ?? 0));
        cur = parentOf.get(cur) ?? null;
      }
    }
    return totals;
  });

  protected folderCountOf(folderId: string): number {
    return this.folderCounts().get(folderId) ?? 0;
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
    const parent =
      this.newChildParent() === 'root' ? null : (this.newChildParent() as string | null);
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
    const subtree = folder === 'all' || folder === 'none' ? null : this.subtreeFolderIds(folder);
    const list = this.store
      .getExercisesForTeam(teamId)
      .filter((e) => (cat === 'Todas' ? true : e.category === cat))
      .filter((e) =>
        folder === 'all'
          ? true
          : folder === 'none'
            ? !e.folderId
            : (subtree as Set<string>).has(e.folderId as string),
      )
      .filter((e) =>
        q
          ? `${e.title} ${e.description ?? ''} ${e.explanation ?? ''} ${e.category}`
              .toLowerCase()
              .includes(q)
          : true,
      );
    const by = this.order();
    if (by === 'az') return list.sort((a, b) => a.title.localeCompare(b.title, 'es'));
    if (by === 'duration')
      return list.sort((a, b) => (b.durationMinutes ?? 0) - (a.durationMinutes ?? 0));
    // Por defecto, lo último guardado primero.
    return list.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  /** Nº de ejercicios que se están mostrando (contador visible). */
  protected readonly resultCount = computed(() => this.exercises().length);

  /** Total del equipo, sin filtros (para el contador y el botón de limpiar). */
  protected readonly totalCount = computed(() => {
    const teamId = this.team()?.id;
    return teamId ? this.store.getExercisesForTeam(teamId).length : 0;
  });

  /** ¿Hay algún filtro puesto? (búsqueda, categoría o carpeta). */
  protected readonly hasFilters = computed(
    () =>
      this.search().trim().length > 0 ||
      this.categoryFilter() !== 'Todas' ||
      this.folderFilter() !== 'all',
  );

  protected clearFilters(): void {
    this.clearSearch();
    this.categoryFilter.set('Todas');
    this.folderFilter.set('all');
  }

  // ---------- Editor ----------
  protected readonly editorOpen = signal(false);
  /** En móvil, el panel de carpetas es un cajón desplegable. */
  protected readonly sidebarOpen = signal(false);
  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }
  protected readonly form = signal<EditorForm>({
    id: null,
    title: '',
    category: 'Técnica',
    durationMinutes: null,
    description: '',
    explanation: '',
    materials: '',
    minPlayers: null,
    maxPlayers: null,
    folderId: null,
    objectives: '',
  });
  protected readonly formError = signal('');
  protected readonly draftIndicator = signal<null | 'saved' | 'loaded'>(null);
  protected readonly saving = signal(false);

  /**
   * Ejercicios cuya miniatura guardada NO se pudo cargar en el navegador.
   *
   * FASE 1.5 del encargo: una miniatura histórica rota (data URL truncada, formato antiguo,
   * asset perdido) no debe mostrar el icono de imagen rota. Cuando el `<img>` falla se marca
   * aquí y la tarjeta pasa al diagrama SVG en vivo del ejercicio, que es un fallback limpio
   * del campo con sus objetos. El estado es por sesión: si el usuario recarga, se reintenta
   * la miniatura guardada (no se borra nada del ejercicio).
   */
  private readonly miniaturasRotas = signal<ReadonlySet<string>>(new Set());

  protected miniaturaRota(id: string): boolean {
    return this.miniaturasRotas().has(id);
  }

  protected marcarMiniaturaRota(id: string): void {
    if (this.miniaturasRotas().has(id)) return;
    const next = new Set(this.miniaturasRotas());
    next.add(id);
    this.miniaturasRotas.set(next);
  }

  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  /** Caché de miniaturas. La clave guarda lo que cambia el dibujo, así que filtrar,
   *  ordenar o escribir NO vuelve a renderizar: antes `preview(ex)` llamaba a
   *  `renderBoardSvg` para CADA tarjeta y en CADA ciclo de detección de cambios. */
  private readonly previewCache = new Map<string, { key: string; html: SafeHtml | null }>();

  private renderPreview(ex: Exercise): SafeHtml | null {
    const els = ex.canvas?.frames?.[0]?.elements ?? [];
    if (els.length === 0) return null;
    const field = ex.canvas?.field ?? 'full';
    return this.sanitizer.bypassSecurityTrustHtml(renderBoardSvg(field, els, { selectedId: null }));
  }

  protected previewOf(ex: Exercise): SafeHtml | null {
    const key = `${ex.savedAt}|${ex.canvas?.field ?? ''}|${ex.canvas?.orientation ?? ''}|${ex.canvas?.frames?.[0]?.elements?.length ?? 0}`;
    const hit = this.previewCache.get(ex.id);
    if (hit && hit.key === key) return hit.html;
    const html = this.renderPreview(ex);
    this.previewCache.set(ex.id, { key, html });
    // Poda: la caché no debe crecer con ejercicios que ya no existen.
    if (this.previewCache.size > 200) {
      const live = new Set(this.store.getExercisesForTeam(this.team()?.id ?? '').map((e) => e.id));
      for (const id of [...this.previewCache.keys()])
        if (!live.has(id)) this.previewCache.delete(id);
    }
    return html;
  }

  protected onSearch(evt: Event): void {
    const el = evt.target as HTMLInputElement;
    this.setSearch(el.value);
  }

  /** Vacía la búsqueda (botón de la lupa). */
  protected clearSearch(): void {
    this.setSearch('');
  }

  protected setOrder(evt: Event): void {
    const v = (evt.target as HTMLSelectElement).value as 'recent' | 'az' | 'duration';
    this.order.set(v);
  }

  /** Aplica la búsqueda con RETARDO: escribir no re-renderiza la lista en cada tecla. */
  private setSearch(value: string): void {
    this.searchInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.search.set(value);
    }, LibraryComponent.SEARCH_DELAY_MS);
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
    if (min != null && max != null && min > max)
      return 'El número mínimo de jugadores no puede ser mayor que el máximo.';
    // Mismo rango que la restricción de la base (`exercises_duration check between 1 and 240`):
    // antes el formulario dejaba escribir 0 (el `min` del input era 0), negativos o 300 y el
    // guardado fallaba con un «Error al comunicarse con el servidor.» que no decía nada.
    const duracion = this.form().durationMinutes;
    if (duracion != null && (duracion < 1 || duracion > 240))
      return 'La duración tiene que estar entre 1 y 240 minutos.';
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
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }
}
