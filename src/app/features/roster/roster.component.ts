import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../../core/store.service';
import { AccessService } from '../../core/access.service';
import { ConfirmService } from '../../core/confirm.service';
import { Player, Position } from '../../core/models';
import { colorName } from '../../core/color-name';

const PALETTE = [
  '#1a73e8',
  '#c0392b',
  '#1f7a4d',
  '#e67e22',
  '#7d3c98',
  '#b8860b',
  '#111111',
  '#f4f4f4',
];
const POSITIONS: Position[] = ['GK', 'DF', 'MF', 'FW'];

interface Draft {
  id: string | null;
  name: string;
  number: number | null;
  position: Position;
  color: string;
}

@Component({
  selector: 'app-roster',
  styleUrl: './roster.component.scss',
  templateUrl: './roster.component.html',
  imports: [FormsModule],
})
export class RosterComponent {
  private readonly store = inject(StoreService);
  private readonly access = inject(AccessService);
  private readonly confirmSvc = inject(ConfirmService);

  protected readonly palette = PALETTE;
  protected readonly positions = POSITIONS;

  /** Nombre legible en español de un color hex (para el aria-label/title de los swatches). */
  protected colorName(c: string): string {
    return colorName(c);
  }

  protected readonly team = this.store.activeTeam;
  protected readonly players = computed(() =>
    [...this.store.activeTeamPlayers()].sort((a, b) => {
      const pa = a.position === 'GK' ? 0 : 1;
      const pb = b.position === 'GK' ? 0 : 1;
      return pa - pb || (a.number ?? 99) - (b.number ?? 99);
    }),
  );

  // ---------- Filtros de la lista ----------
  // Con plantillas de 20+ jugadores no había forma de encontrar a nadie ni de ver solo
  // los de una posición.
  protected readonly filterText = signal('');
  protected readonly filterPos = signal<Position | 'all'>('all');

  protected readonly visiblePlayers = computed(() => {
    const q = this.filterText().trim().toLowerCase();
    const pos = this.filterPos();
    return this.players().filter((p) => {
      if (pos !== 'all' && p.position !== pos) return false;
      if (!q) return true;
      return `${p.name} ${p.number ?? ''}`.toLowerCase().includes(q);
    });
  });

  protected readonly hasPlayerFilters = computed(
    () => this.filterText().trim().length > 0 || this.filterPos() !== 'all',
  );

  protected onPlayerSearch(evt: Event): void {
    this.filterText.set((evt.target as HTMLInputElement).value);
  }

  protected setPositionFilter(evt: Event): void {
    this.filterPos.set((evt.target as HTMLSelectElement).value as Position | 'all');
  }

  protected clearPlayerFilters(): void {
    this.filterText.set('');
    this.filterPos.set('all');
  }

  protected readonly showCreateTeam = signal(false);
  protected readonly newTeamName = signal('');
  protected readonly newTeamColor = signal(PALETTE[0]);

  protected readonly editorOpen = signal(false);
  protected readonly draft = signal<Draft>({
    id: null,
    name: '',
    number: null,
    position: 'MF',
    color: PALETTE[0],
  });
  /** Motivo por el que no se puede guardar (vacío = todo correcto). */
  protected readonly formError = signal('');

  // ---------- Crear equipo ----------

  openCreateTeam(): void {
    this.showCreateTeam.set(true);
  }

  createTeam(): void {
    const name = this.newTeamName().trim();
    if (!name) return;
    // En modo REMOTO la creación del equipo va por `AccessService` (que crea la fila, conecta el
    // repositorio y lo activa): `store.createTeam` es síncrono y solo escribe en localStorage, así
    // que aquí habría creado un equipo fantasma que desaparece al recargar. Misma ruta que el alta.
    if (this.store.isRemote()) {
      void this.access.createTeam(name, this.newTeamColor()).catch(() => {
        this.formError.set('No se pudo crear el equipo. Inténtalo de nuevo.');
      });
    } else {
      this.store.createTeam(name, this.newTeamColor());
    }
    this.showCreateTeam.set(false);
    this.newTeamName.set('');
  }

  // ---------- Añadir / editar jugador ----------

  openAdd(): void {
    const nextNumber = this.nextNumber();
    this.formError.set('');
    this.draft.set({ id: null, name: '', number: nextNumber, position: 'MF', color: PALETTE[0] });
    this.editorOpen.set(true);
  }

  openEdit(p: Player): void {
    this.formError.set('');
    this.draft.set({
      id: p.id,
      name: p.name,
      number: p.number,
      position: p.position,
      color: p.color,
    });
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    this.formError.set('');
    this.editorOpen.set(false);
  }

  /**
   * Valida el borrador ANTES de guardar y explica el motivo. Antes solo se exigía el
   * nombre: se podía guardar un jugador SIN posición (la opción «—» del selector) y con
   * un dorsal repetido (dos jugadores con el 10), y el campo Dorsal admitía 0.
   */
  private validateDraft(d: Draft): string | null {
    if (!d.name.trim()) return 'El nombre es obligatorio.';
    if (!d.position) return 'Elige una posición.';
    const n = d.number;
    if (n !== null) {
      if (!Number.isInteger(n) || n < 1 || n > 99)
        return 'El dorsal tiene que ser un número del 1 al 99.';
      const dup = this.players().find((p) => p.number === n && p.id !== d.id);
      if (dup) return `El dorsal ${n} ya lo lleva ${dup.name}.`;
    }
    return null;
  }

  save(): void {
    const d = this.draft();
    const err = this.validateDraft(d);
    if (err) {
      this.formError.set(err);
      return;
    }
    this.formError.set('');
    const name = d.name.trim();
    if (d.id) {
      this.store.updatePlayer(d.id, {
        name,
        number: d.number,
        position: d.position,
        color: d.color,
      });
    } else {
      this.store.addPlayer({
        name,
        number: d.number,
        position: d.position,
        color: d.color,
      });
    }
    this.closeEditor();
  }

  remove(p: Player): void {
    this.confirmSvc.ask({
      title: 'Quitar jugador',
      message: `¿Quitar a ${p.name} de la plantilla? Puedes volver a añadirlo después.`,
      confirmLabel: 'Quitar',
      onConfirm: () => this.store.removePlayer(p.id),
    });
  }

  protected setDraftColor(c: string): void {
    this.draft.update((d) => ({ ...d, color: c }));
  }

  protected positionLabel(pos: Position): string {
    switch (pos) {
      case 'GK':
        return 'Portero';
      case 'DF':
        return 'Defensa';
      case 'MF':
        return 'Medio';
      case 'FW':
        return 'Delantero';
      default:
        return '—';
    }
  }

  protected isDark(color: string): boolean {
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.5;
  }

  private nextNumber(): number | null {
    const used = new Set(this.players().map((p) => p.number ?? 0));
    for (let i = 1; i <= 99; i++) {
      if (!used.has(i)) return i;
    }
    return null;
  }
}
