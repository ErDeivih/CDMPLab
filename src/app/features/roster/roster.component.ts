import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../../core/store.service';
import { ConfirmService } from '../../core/confirm.service';
import { Player, Position } from '../../core/models';
import { colorName } from '../../core/color-name';

const PALETTE = ['#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111', '#f4f4f4'];
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
    })
  );

  protected readonly showCreateTeam = signal(false);
  protected readonly newTeamName = signal('');
  protected readonly newTeamColor = signal(PALETTE[0]);

  protected readonly editorOpen = signal(false);
  protected readonly draft = signal<Draft>({ id: null, name: '', number: null, position: 'MF', color: PALETTE[0] });

  // ---------- Crear equipo ----------

  openCreateTeam(): void {
    this.showCreateTeam.set(true);
  }

  createTeam(): void {
    const name = this.newTeamName().trim();
    if (!name) return;
    this.store.createTeam(name, this.newTeamColor());
    this.showCreateTeam.set(false);
    this.newTeamName.set('');
  }

  // ---------- Añadir / editar jugador ----------

  openAdd(): void {
    const nextNumber = this.nextNumber();
    this.draft.set({ id: null, name: '', number: nextNumber, position: 'MF', color: PALETTE[0] });
    this.editorOpen.set(true);
  }

  openEdit(p: Player): void {
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
    this.editorOpen.set(false);
  }

  save(): void {
    const d = this.draft();
    const name = d.name.trim();
    if (!name) return;
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
