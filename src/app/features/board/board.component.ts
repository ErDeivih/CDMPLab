import { Component, computed, effect, inject, signal, viewChild, ElementRef, HostListener, ChangeDetectorRef } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { StoreService, uid } from '../../core/store.service';
import { CanvasDocument, CanvasElement, CanvasFrame, FieldType, Player, Position, Exercise, ExerciseCategory, F7Overlay } from '../../core/models';
import { FIELD_RECT, FIELD_BASE_SPECS, fieldGeometry, orientationLabel } from '../../core/field';
import { tacticAsset, materialAsset, TacticalKind, materialBaseSize } from '../../core/tactic-assets';
import { renderBoardSvg, hitTestElement, textColor as textColorFn, svgZigzag, screenToNorm, DEFAULT_TEXT_SIZE, DEFAULT_TEXT_W, DEFAULT_TEXT_H, autoTextBoxH, normalizedToPct, pctToNormalized, parseLocalizedNumber, clampNorm, fitTextToContent, Geometry, DEFAULT_STROKE_WIDTH, DEFAULT_SHAPE_STROKE, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH, arrowHeadSize, materialSize, MATERIAL_BOX, SEL_HANDLE_STROKE } from '../../core/render';
import { colorName, colorNamePlural } from '../../core/color-name';
import { generateThumbnail } from '../../core/canvas-export';
import { inlineSvgAssets } from '../../core/asset-inline';
import { BoardSessionService } from '../../core/board-session.service';
import { ConfirmService } from '../../core/confirm.service';
import { HistoryService, HistorySnapshot } from '../../core/history.service';
import { normalizeCanvas, CANVAS_SCHEMA_VERSION } from '../../core/canvas';
import {
  addElementToFrames,
  removeElementFromFrames,
  moveElementsInFrame,
  updateElementInFrames,
  layerShiftFrames,
  translateElement,
} from './board-doc';
import { selCenter, elementOutline, isPointLike as isPointLikeFn, isMaterial as isMaterialFn, resizeHandles, normalizeRotation, pointLikeResizeHalf } from './board-selection';
import { ExportDialogComponent } from './export-dialog.component';

type Tool =
  | 'select'
  | 'hand'
  | 'player'
  | 'player_rival'
  | 'ball'
  | 'cone'
  | 'mannequin'
  | 'minigoal'
  | 'pole'
  | 'marker'
  | 'hurdle'
  | 'ring'
  | 'ladder'
  | 'flag'
  | 'trampoline'
  | 'target'
  | 'net'
  | 'vball'
  | 'coachC'
  | 'peto'
  | 'chaleco'
  | 'bosu'
  | 'fitball'
  | 'pica'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'doubleArrow'
  | 'measure'
  | 'curve'
  | 'curve_left'
  | 'curve_right'
  | 'dribble'
  | 'line'
  | 'freehand'
  | 'zone'
  | 'text'
  | 'erase';

/** Herramientas de colocación de un solo uso: pulsar la herramienta ARMA el
 *  emplazamiento (la posición la decide el clic en el campo) en lugar de
 *  colocarla de inmediato. Dibujo (arrastre) y Erase quedan fuera. */
const PLACEMENT_TOOLS: ReadonlySet<Tool> = new Set([
  'player',
  'player_rival',
  'ball',
  'cone',
  'mannequin',
  'minigoal',
  'pole',
  'marker',
  'hurdle',
  'ring',
  'ladder',
  'flag',
  'trampoline',
  'target',
  'net',
  'vball',
  'coachC',
  'peto',
  'chaleco',
  'bosu',
  'fitball',
  'pica',
  'text',
]);

/** Spec de un jugador a colocar (jugador de plantilla o genérico). */
interface PlayerPlacement {
  n?: number; // dorsal (si no, se usa nextNumber)
  c: string;
  side: 'own' | 'rival';
  type?: 'player' | 'goalkeeper' | 'neutral';
  playerId?: string; // jugador de Plantilla (no duplicable)
  label?: string;
}

/** Emplazamiento ARMADO: se muestra "Toca el campo para colocar a X" y el
 *  siguiente clic sobre el campo lo coloca. Sin emplazamiento armado el clic
 *  sobre el campo no crea nada (y Escape vuelve a Seleccionar). */
type ArmedPlacement = {
  tool: Tool; // categoría activa ('player' | 'player_rival' | material | 'text')
  label: string; // nombre mostrado en la pista
  player?: PlayerPlacement; // solo para colocación de jugadores
};

interface ToolDef {
  id: Tool;
  icon: string;
  title: string;
  group?: string; // grupo visual dentro de la categoría Material
}

/** Qué hará el gesto de UN dedo táctil, calculado al bajar el puntero. Se usa
 *  para decidir la acción del TAP (colocar/seleccionar/borrar) vs la del ARRASTRE
 *  (mover/rotar/redimensionar/patear/dibujar) vs la CANCELACI�"N del pinch. */
type TouchPlan =
  | { kind: 'place' }
  | { kind: 'selectMove'; hitId: string } // tocar un objeto: tap=seleccionar, arrastre=mover
  | { kind: 'selectMultiShift'; hitId: string } // shift/objeto no seleccionado: toggle + mover
  | { kind: 'moveGroup' } // objeto ya seleccionado dentro de una multiselección
  | { kind: 'pan' } // campo vacío: tap=deseleccionar, arrastre=panear
  | { kind: 'rotate'; elId: string }
  | { kind: 'resize'; elId: string; key: string }
  | { kind: 'draw' }
  | { kind: 'erase'; hitId: string }
  | { kind: 'none' };

/** Estado completo del documento/vista/historial JUSTO ANTES del gesto táctil,
 *  para restaurarlo EXACTAMENTE si llega un segundo dedo (pinch) tras haber
 *  comenzado una modificación con el primero (mover/dibujar/rotar/etc.). */
interface TouchRestore {
  frames: CanvasFrame[];
  selectedIds: string[];
  selectedId: string | null;
  panelOpen: boolean;
  tool: Tool;
  armed: ArmedPlacement | null;
  zoom: number;
  panX: number;
  panY: number;
  dirty: boolean;
  saved: boolean;
  history: HistorySnapshot<CanvasFrame[]>;
}

/** La "gestión pendiente" del primer dedo táctil: guarda todo lo necesario para
 *  confirmar un tap, arrancar un arrastre desde el ORIGEN o descartar sin efectos. */
interface TouchPending {
  pointerId: number;
  /** Posición de PANTALLA (client) del punto de bajada. */
  startClient: { x: number; y: number };
  /** Posición normalizada del punto de bajada. */
  startNorm: { x: number; y: number };
  tool: Tool;
  armed: ArmedPlacement | null;
  shift: boolean;
  plan: TouchPlan;
  /** Instantánea EXACTA para restaurar al cancelar con un segundo dedo. */
  restore: TouchRestore;
  /** Distancia MÁXIMA (px) recorrida desde la bajada (para el umbral de tap). */
  movedDist: number;
  /** El dedo ya superó el umbral y el gesto de UN DEDO ha comenzado (mover/dibujar�?�). */
  begun: boolean;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', icon: 'near_me', title: 'Seleccionar y mover' },
  { id: 'hand', icon: 'pan_tool', title: 'Desplazar campo' },
  { id: 'player', icon: 'person', title: 'Jugador propio' },
  { id: 'player_rival', icon: 'sports', title: 'Jugador rival' },
  { id: 'ball', icon: 'sports_soccer', title: 'Balón' },
  { id: 'cone', icon: 'change_history', title: 'Cono' },
  { id: 'mannequin', icon: 'accessibility_new', title: 'Maniquí' },
  { id: 'minigoal', icon: 'sports', title: 'Mini portería' },
  { id: 'pole', icon: 'straighten', title: 'Pértiga / poste' },
  { id: 'marker', icon: 'label', title: 'Marcador' },
  { id: 'hurdle', icon: 'looks_one', title: 'Valla' },
  { id: 'ring', icon: 'radio_button_unchecked', title: 'Aro' },
  { id: 'ladder', icon: 'format_list_numbered', title: 'Escalera' },
  { id: 'flag', icon: 'flag', title: 'Banderín' },
  { id: 'trampoline', icon: 'airline_seat_flat', title: 'Minitrampolín' },
  { id: 'target', icon: 'radio_button_checked', title: 'Diana' },
  { id: 'net', icon: 'grid_on', title: 'Red' },
  { id: 'vball', icon: 'sports_volleyball', title: 'Balón morado' },
  { id: 'coachC', icon: 'pin', title: 'Marcador C' },
  { id: 'peto', icon: 'checkroom', title: 'Peto' },
  { id: 'chaleco', icon: 'checkroom', title: 'Chaleco lastrado' },
  { id: 'bosu', icon: 'landscape', title: 'BOSU' },
  { id: 'fitball', icon: 'sports_soccer', title: 'Fitball' },
  { id: 'pica', icon: 'straighten', title: 'Pica coloreable' },
  { id: 'rect', icon: 'check_box_outline_blank', title: 'Rectángulo' },
  { id: 'ellipse', icon: 'circle', title: 'Círculo / elipse' },
  { id: 'arrow', icon: 'trending_flat', title: 'Flecha (movimiento)' },
  { id: 'doubleArrow', icon: 'swap_horiz', title: 'Flecha doble sentido' },
  { id: 'curve_left', icon: 'near_me', title: 'Curva izquierda' },
  { id: 'curve_right', icon: 'near_me', title: 'Curva derecha' },
  { id: 'dribble', icon: 'show_chart', title: 'Conducción (zigzag)' },
  { id: 'line', icon: 'horizontal_rule', title: 'Línea' },
  { id: 'freehand', icon: 'gesture', title: 'Dibujo a mano alzada' },
  { id: 'text', icon: 'title', title: 'Texto' },
  { id: 'erase', icon: 'backspace', title: 'Borrar elemento' },
];

const VB_W = 100;
const VB_H = 80;

const PALETTE = ['#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111', '#f4f4f4'];

export const MATERIALS: ToolDef[] = [
  { id: 'ball', icon: 'sports_soccer', title: 'Balón', group: 'Balones' },
  { id: 'fitball', icon: 'sports_soccer', title: 'Fitball', group: 'Balones' },
  { id: 'vball', icon: 'sports_volleyball', title: 'Balón morado', group: 'Balones' },
  { id: 'cone', icon: 'change_history', title: 'Cono', group: 'Señalización' },
  { id: 'marker', icon: 'label', title: 'Marcador', group: 'Señalización' },
  { id: 'flag', icon: 'flag', title: 'Banderín', group: 'Señalización' },
  { id: 'target', icon: 'radio_button_checked', title: 'Diana', group: 'Señalización' },
  { id: 'coachC', icon: 'pin', title: 'Marcador C', group: 'Señalización' },
  { id: 'pica', icon: 'straighten', title: 'Pica coloreable', group: 'Señalización' },
  { id: 'pole', icon: 'straighten', title: 'Pértiga', group: 'Porterías y redes' },
  { id: 'mannequin', icon: 'accessibility_new', title: 'Maniquí', group: 'Porterías y redes' },
  { id: 'minigoal', icon: 'sports', title: 'Mini portería', group: 'Porterías y redes' },
  { id: 'net', icon: 'grid_on', title: 'Red', group: 'Porterías y redes' },
  { id: 'hurdle', icon: 'looks_one', title: 'Valla', group: 'Coordinación' },
  { id: 'ring', icon: 'radio_button_unchecked', title: 'Aro', group: 'Coordinación' },
  { id: 'ladder', icon: 'format_list_numbered', title: 'Escalera', group: 'Coordinación' },
  { id: 'trampoline', icon: 'airline_seat_flat', title: 'Minitrampolín', group: 'Coordinación' },
  { id: 'peto', icon: 'checkroom', title: 'Peto', group: 'Preparación física' },
  { id: 'chaleco', icon: 'checkroom', title: 'Chaleco lastrado', group: 'Preparación física' },
  { id: 'bosu', icon: 'landscape', title: 'BOSU', group: 'Preparación física' },
];

const MATERIAL_GROUPS = ['Balones', 'Señalización', 'Porterías y redes', 'Coordinación', 'Preparación física', 'Otros'] as const;

/** id de herramienta �?' grupo al que pertenece (para agrupar el panel de Material). */
const MATERIAL_GROUP_MAP: Record<string, string> = Object.fromEntries(
  MATERIALS.filter((m) => m.group).map((m) => [m.id, m.group as string])
);

/** Formaciones rápidas (Fase 7): posiciones normalizadas 0..1 (espacio canónico) del
 *  equipo PROPIO atacando hacia la derecha. Para el rival se refleja la X (1-x).
 *  Cada formación es de 11 jugadores (portero + 10); se colocan los disponibles y, si
 *  faltan, se informa sin bloquear. */
interface Formation {
  id: string;
  label: string;
  positions: Array<[number, number]>;
}
const FORMATIONS: Formation[] = [
  {
    id: '4-3-3',
    label: '4-3-3',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.5, 0.25], [0.5, 0.5], [0.5, 0.75],
      [0.82, 0.2], [0.82, 0.5], [0.82, 0.8],
    ],
  },
  {
    id: '4-4-2',
    label: '4-4-2',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.5, 0.15], [0.5, 0.38], [0.5, 0.62], [0.5, 0.85],
      [0.8, 0.35], [0.8, 0.65],
    ],
  },
  {
    id: '3-5-2',
    label: '3-5-2',
    positions: [
      [0.06, 0.5],
      [0.26, 0.2], [0.26, 0.5], [0.26, 0.8],
      [0.5, 0.1], [0.5, 0.3], [0.5, 0.5], [0.5, 0.7], [0.5, 0.9],
      [0.8, 0.35], [0.8, 0.65],
    ],
  },
  {
    id: '4-2-3-1',
    label: '4-2-3-1',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.45, 0.4], [0.45, 0.6],
      [0.62, 0.2], [0.62, 0.5], [0.62, 0.8],
      [0.8, 0.5],
    ],
  },
  {
    id: '4-1-4-1',
    label: '4-1-4-1',
    positions: [
      [0.06, 0.5],
      [0.26, 0.12], [0.26, 0.37], [0.26, 0.63], [0.26, 0.88],
      [0.4, 0.5],
      [0.58, 0.15], [0.58, 0.38], [0.58, 0.62], [0.58, 0.85],
      [0.8, 0.5],
    ],
  },
];

@Component({
  selector: 'app-board',
  styleUrl: './board.component.scss',
  templateUrl: './board.component.html',
  imports: [ExportDialogComponent],
})
export class BoardComponent {
  private readonly store = inject(StoreService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly sessionSvc = inject(BoardSessionService);
  private readonly router = inject(Router);
  private readonly confirmSvc = inject(ConfirmService);
  private readonly history = inject(HistoryService<CanvasFrame[]>);
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly canUndo = this.history.canUndo;
  protected readonly canRedo = this.history.canRedo;
  readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  readonly trashEl = viewChild<ElementRef<HTMLElement>>('trash');
  readonly textEditorEl = viewChild<ElementRef<HTMLTextAreaElement>>('textEditor');

  /** La papelera solo se muestra mientras se arrastra/mueve un objeto. */
  /** Método (no computed) porque movingIds/resizing son campos mutables sin señal: un
   *  computed se memoiza con cero dependencias y nunca se actualizaría. Al ser método,
   *  Angular lo reevalúa en cada detección de cambios. */
  protected trashOpen(): boolean {
    return this.movingIds.length > 0 || !!this.resizing;
  }
  protected overTrash = false;
  /** Posición (px relativa a `.board-host`) del CENTRO de la papelera: se ancla al borde
   *  inferior CENTRAL del campo (norm 0.5, ~0.965) para que un objeto que se arrastra
   *  hacia abajo SÍ pueda entrar visualmente en ella (el objeto se clampa al campo, así
   *  que la papelera debe solaparse con la zona inferior alcanzable del campo, en vez de
   *  quedar fuera de su alcance en "Campo completo"). Usamos el mismo mapeo norm�?'pantalla
   *  que el render (normToScreenDisplay), de modo que sigue pegada al campo con pan/zoom. */
  protected readonly trashPos = computed<{ left: number; top: number }>(() => {
    const c = this.normToScreenDisplay(0.5, 0.965);
    return { left: c.x, top: c.y };
  });

  // ---------- Estado "sin guardar" (pérdida de trabajo) ----------
  protected readonly dirty = this.sessionSvc.dirty;
  protected markDirty(): void {
    this.sessionSvc.setDirty(true);
    // Un nuevo cambio invalida el estado "Guardado" (el botón/indicador vuelve a
    // "por guardar") aunque conserve el documento guardado en disco.
    this.saved.set(false);
  }
  protected readonly unsavedOpen = signal(false);
  private canLeaveResolver: ((ok: boolean) => void) | null = null;
  protected closeUnsaved(): void {
    this.unsavedOpen.set(false);
    if (this.canLeaveResolver) {
      const r = this.canLeaveResolver;
      this.canLeaveResolver = null;
      r(false); // permanecer en la pizarra
    }
  }
  protected saveAndExit(): void {
    this.unsavedOpen.set(false);
    if (this.canLeaveResolver) {
      // Navegación pendiente del guard: guardar sin navegar; el router continúa al destino original.
      const resolver = this.canLeaveResolver;
      this.canLeaveResolver = null;
      void this.saveToExercise(false).then((ok) => resolver(ok));
    } else {
      void this.saveToExercise();
    }
  }
  protected exitWithoutSave(): void {
    this.unsavedOpen.set(false);
    if (this.canLeaveResolver) {
      const resolver = this.canLeaveResolver;
      this.canLeaveResolver = null;
      this.sessionSvc.close();
      this.sessionSvc.setDirty(false);
      resolver(true); // continúa al destino original
    } else {
      this.sessionSvc.close();
      this.router.navigate(['/library']);
    }
  }
  protected requestBack(): void {
    if (this.dirty()) this.unsavedOpen.set(true);
    else this.goBack();
  }

  /** Usado por el guard de salida (CanDeactivate): bloquea y pide confirmación (Promise). */
  canLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.unsavedOpen.set(true);
    if (this.canLeaveResolver) return false; // ya mostrando el diálogo
    return new Promise<boolean>((resolve) => {
      this.canLeaveResolver = resolve;
    });
  }

  protected readonly players = this.store.activeTeamPlayers;
  protected readonly tools = TOOLS;
  protected readonly materials = MATERIALS;
  protected readonly fieldBaseSpecs = FIELD_BASE_SPECS;
  protected variantAsset(kind: TacticalKind) {
    return tacticAsset(kind);
  }

  /** Categoría activa del panel lateral izquierdo (Material/Dibujo). Fase 15:
   *  los tres catálogos (Jugadores/Material/Dibujo) se abren desde la IZQUIERDA con el
   *  mismo patrón; ya no existe el flyout anclado a la barra inferior. */
  protected readonly panelCat = signal<'jugadores' | 'material' | 'dibujo' | null>(null);
  /** Texto de búsqueda del panel de Material. */
  protected readonly materialQuery = signal('');
  protected setMaterialQuery(q: string): void {
    this.materialQuery.set(q);
  }
  /** Normaliza un texto para búsqueda insensible a mayúsculas y acentos. */
  private normalizeFx(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  protected readonly materialGroupList = computed<Array<{ label: string; items: ToolDef[] }>>(() => {
    const q = this.normalizeFx(this.materialQuery());
    const matTools = TOOLS.filter((t) => MATERIALS.some((m) => m.id === t.id));
    return MATERIAL_GROUPS.map((g) => ({
      label: g,
      items: matTools.filter((t) => MATERIAL_GROUP_MAP[t.id] === g && (!q || this.normalizeFx(t.title).includes(q))),
    })).filter((g) => g.items.length > 0);
  });

  protected setToolCategory(c: 'jugadores' | 'material' | 'dibujo'): void {
    if (this.panelCat() === c) {
      this.closeToolPanel(); // pulsar de nuevo la categoría abierta la cierra
      return;
    }
    // Un solo panel principal abierto: en móvil el inspector de Propiedades se
    // oculta temporalmente (la selección vive en el modelo), y se cierran los demás.
    if (this.isCompactViewport()) this.panelOpen.set(false);
    this.jugadoresOpen.set(false);
    this.exportMenuOpen.set(false);
    this.masOpen.set(false);
    this.panelCat.set(c);
  }
  protected closeToolPanel(): void {
    this.panelCat.set(null);
    // El panel es un overlay que tapa el campo: al elegir una herramienta hay que
    // retirarlo ANTES del siguiente clic (que coloca el elemento). Forzamos la
    // detección de cambios para que Angular no lo deje en el DOM un tick más.
    this.cdr.detectChanges();
  }
  /** Criterio coherente de "pizarra compacta" (Fase 1). Cubre móvil en VERTICAL
   *  (360�-800, 390�-844, 430�-932) y en HORIZONTAL (teléfono girado: 800�-360, 844�-390,
   *  932�-430), sin perjudicar tabletas ni escritorio. La app (aquí) y el CSS usan
   *  el MISMO criterio: ancho corto (<=700) o altura corta (<=480) con ancho <=1000.
   *  NO es suficiente mirar solo el ancho (un móvil girado mide 844px de ancho). */
  protected isCompactViewport(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 700) return true;               // vertical
    if (h <= 480 && w <= 1000) return true;  // horizontal (girado)
    return false;
  }

  protected activeToolTitle(): string {
    return TOOLS.find((t) => t.id === this.tool())?.title ?? '';
  }
  protected readonly toolGroups: Array<{ id: 'jugadores' | 'material' | 'dibujo'; label: string; items: ToolDef[] }> = [
    { id: 'jugadores', label: 'Jugadores', items: TOOLS.filter((t) => t.id === 'player' || t.id === 'player_rival') },
    {
      id: 'material',
      label: 'Material',
      items: TOOLS.filter((t) => MATERIALS.some((m) => m.id === t.id)),
    },
    {
      id: 'dibujo',
      label: 'Dibujo y formas',
      items: TOOLS.filter((t) => ['rect', 'ellipse', 'arrow', 'doubleArrow', 'curve_left', 'curve_right', 'dribble', 'line', 'freehand', 'text'].includes(t.id)),
    },
  ];

  /** Ids de jugadores de Plantilla ya colocados en la pizarra (en cualquier frame). */
  protected readonly placedPlayerIds = computed(() => {
    const s = new Set<string>();
    for (const f of this.frames()) {
      for (const e of f.elements) {
        if (e.t === 'player' && e.playerId) s.add(e.playerId);
      }
    }
    return s;
  });

  protected field = signal<FieldType>('full');
  protected tool = signal<Tool>('select');
  /** Emplazamiento armado (jugador/material/texto pendiente de colocar en el campo). */
  protected readonly armed = signal<ArmedPlacement | null>(null);
  /** Cuadrícula (Rejilla) retirada por el dueño. Se conserva como señal SIEMPRE a `false`
   *  para que `buildDoc` escriba `grid:false` (migración de documentos antiguos) y los
   *  llamadores (render/export) sigan teniendo el campo sin romper sus firmas. El render
   *  ignora `grid` por completo, así que no se dibuja ninguna cuadrícula. */
  protected readonly fieldGrid = signal(false);
  protected readonly guide = signal<'none' | '2x2' | '3x3' | 'thirds' | 'lanes'>('none');
  protected setGuide(g: 'none' | '2x2' | '3x3' | 'thirds' | 'lanes'): void {
    this.guide.set(g);
    this.markDirty();
  }
  /** Overlay F7 transversal parametrizable. Solo compatibilidad con documentos
   *  viejos: se carga del doc y se renderiza, pero ya NO se expone como control. */
  protected readonly f7 = signal<F7Overlay | null>(null);
  protected readonly grass = signal<'stripes' | 'plain' | 'checker'>('stripes');
  protected setGrass(g: 'stripes' | 'plain' | 'checker'): void {
    this.grass.set(g);
    this.markDirty();
  }
  /** Id de texto recién insertado para enfocar su edición. */
  protected readonly textFocusId = signal<string | null>(null);
  protected readonly orientation = signal<'horizontal' | 'vertical'>('horizontal');

  protected setOrientation(o: 'horizontal' | 'vertical'): void {
    this.orientation.set(o);
    this.markDirty();
  }

  /** Etiqueta de orientación basada en el RESULTADO visual (decisión de usabilidad
   *  del dueño: "Horizontal/Vertical" era ambiguo). Depende del tipo de campo, pero
   *  sigue usando los valores internos 'horizontal'/'vertical'. */
  protected orientLabel(o: 'horizontal' | 'vertical'): string {
    return orientationLabel(this.field(), o);
  }

  // ---------- Modo de pantalla: "Campo completo" (fit) vs "Llenar pantalla" ----------
  /** `false` = campo completo (letterbox a todo el host, como antes). `true` =
   *  "Llenar pantalla": el campo se escala para LLENAR la altura usable del host
   *  (puede desbordar el ancho y panearse en horizontal) sin deformar ni cambiar la
   *  orientación guardada. Se persiste por dispositivo; en móvil el default es el
   *  modo que da la mayor área táctil usable (llenar pantalla). */
  protected readonly fillScreen = signal<boolean>(false);
  /** Clave de persistencia bajo el prefijo `entrenolab:` para que el seed de los e2e
   *  la limpie y el default móvil (Llenar pantalla) se aplique realmente. */
  private readonly fillPrefKey = 'entrenolab:board-fill';
  /** Tamaño (px) medido del `.board-host` para dimensionar el canvas en llenar pantalla. */
  private readonly hostSize = signal<{ w: number; h: number } | null>(null);
  private resizeObs: ResizeObserver | null = null;

  /** Alterna entre "Llenar pantalla" y "Campo completo" y persiste la elección. */
  protected toggleFillScreen(): void {
    const next = !this.fillScreen();
    this.fillScreen.set(next);
    try {
      localStorage.setItem(this.fillPrefKey, next ? '1' : '0');
    } catch {
      /* sin persistencia: el modo se mantiene solo en memoria */
    }
    // La pista de recorrido se muestra la primera vez que se actíva el modo Llenar
    // pantalla (por defecto en móvil o al alternar aquí). Solo aparece una vez.
    if (next) this.maybeShowFillHint();
  }

  /** Ancho (px) del canvas en modo llenar pantalla (null �?' usa el CSS 100%).
   *  En llenar pantalla el CAMPO (el rect de contenido) LLENA la altura del host, así
   *  que la escala se deriva de la dimensión vertical del rect de contenido (rect.h en
   *  horizontal; rect.w en vertical porque el contenido se rota) y NO del viewBox (que
   *  lleva márgenes y haría que el césped quedara corto respecto a la altura). */
  protected readonly canvasW = computed<number | null>(() => {
    if (!this.fillScreen()) return null;
    const hs = this.hostSize();
    if (!hs) return null;
    const g = fieldGeometry(this.field(), this.orientation());
    const s = this.fillScale({ width: hs.w, height: hs.h }, g);
    return g.vbW * s;
  });
  /** Alto (px) del canvas en modo llenar pantalla (el viewBox, que puede desbordar la
   *  altura del host para que el rect de contenido la llene; el host lo recorta). */
  protected readonly canvasH = computed<number | null>(() => {
    if (!this.fillScreen()) return null;
    const hs = this.hostSize();
    if (!hs) return null;
    const g = fieldGeometry(this.field(), this.orientation());
    const s = this.fillScale({ width: hs.w, height: hs.h }, g);
    return g.vbH * s;
  });

  /** Escala de LLENADO (cover): el campo se escala para CUBRIR el host (usa el ancho o
   *  la altura, el que dé más tamaño), de modo que en móvil HORIZONTAL el campo llena el
   *  ancho (no una columna estrecha) y el sobrante se puede panea. */
  private fillScale(hs: { width: number; height: number }, g: Geometry): number {
    const dimH = g.vertical ? g.rect.w : g.rect.h;
    const dimW = g.vertical ? g.rect.h : g.rect.w;
    return Math.max(hs.height / dimH, hs.width / dimW);
  }

  // ---------- Descubribilidad del campo oculto en "Llenar pantalla" (Fase 3) ----------
  // En llenar pantalla el campo se escala para LLENAR la altura del host y DESBORDA
  // el ancho (el host lo recorta con overflow:hidden), así que hay contenido oculto
  // a izquierda/derecha que solo se ve paneando. Estos rangos y banderas impulsan
  // dos indicadores discretos (chevrones) en los bordes del host y se desvanecen
  // al alcanzar el extremo correspondiente. En "Campo completo" (contain) el campo
  // cabe entero �?' no hay pan �?' no se muestran indicadores.
  /** Tamaño efectivo (px) del `.board-canvas` que se transforma (pan/zoom). En "Llenar
   *  pantalla" es el campo escalado (puede desbordar el ancho); en "Campo completo" el
   *  canvas ocupa el 100% del host y el exceso de tamaño (y por tanto de paneo) SOLO
   *  aparece cuando el zoom >100%. */
  private effectiveCanvasSize(): { w: number; h: number } | null {
    const hs = this.hostSize();
    if (!hs) return null;
    const cw = this.canvasW();
    const ch = this.canvasH();
    return { w: cw ?? hs.w, h: ch ?? hs.h };
  }
  /** Rango horizontal de paneo permitido: `[min, max]` px de `panX` (en 0,0 sin pan).
   *  No depende del modo de pantalla: solo del tamaño del canvas frente al host, con el
   *  zoom aplicado. Así la herramienta "Mano" puede panea también a zoom >100% en
   *  "Campo completo" (además de en "Llenar pantalla"). */
  protected readonly panRange = computed<{ min: number; max: number }>(() => {
    const c = this.effectiveCanvasSize();
    const hs = this.hostSize();
    if (!c || !hs || !c.w || !c.h) return { min: 0, max: 0 };
    const range = (c.w * this.zoom() - hs.w) / 2;
    return range > 0 ? { min: -range, max: range } : { min: 0, max: 0 };
  });
  /** Rango vertical de paneo permitido (solo positivo si el zoom hace desbordar la altura). */
  protected readonly panRangeY = computed<{ min: number; max: number }>(() => {
    const c = this.effectiveCanvasSize();
    const hs = this.hostSize();
    if (!c || !hs || !c.h) return { min: 0, max: 0 };
    const range = (c.h * this.zoom() - hs.h) / 2;
    return range > 0 ? { min: -range, max: range } : { min: 0, max: 0 };
  });
  /** Hay contenido oculto a la IZQUIERDA (no se ha paneado hasta el extremo izquierdo).
   *  Se panea a DERECHA (+panX) para revelarlo; desaparece al llegar al extremo. */
  protected readonly showLeftHint = computed(() => {
    const r = this.panRange();
    return this.fillScreen() && r.max > 0 && this.panX() < r.max - 0.5;
  });
  /** Hay contenido oculto a la DERECHA (no se ha paneado hasta el extremo derecho).
   *  Se panea a IZQUIERDA (�^'panX) para revelarlo; desaparece al llegar al extremo. */
  protected readonly showRightHint = computed(() => {
    const r = this.panRange();
    return this.fillScreen() && r.min < 0 && this.panX() > r.min + 0.5;
  });

  /** Señal: la herramienta "Mano" está arrastrando (cursor `grabbing` en vez de `grab`). */
  protected readonly handDragging = signal(false);

  // ---------- Barra Espaciadora (escritorio) activa "Mano" de forma temporal ----------
  /** `true` mientras la barra espaciadora mantiene la herramienta "Mano" activa. */
  private spaceHandActive = false;
  /** Herramienta anterior a la barra espaciadora, para restaurar al soltarla. */
  private toolBeforeSpace: Tool | null = null;

  protected readonly bgColor = signal('#31834a');
  protected readonly lineColor = signal('#ffffff');
  protected readonly zoom = signal(1);
  protected readonly panX = signal(0);
  protected readonly panY = signal(0);

  protected setZoom(v: number): void {
    this.zoom.set(Math.max(0.5, Math.min(3, v)));
  }
  protected setPanX(v: number): void {
    this.panX.set(v);
  }
  protected setPanY(v: number): void {
    this.panY.set(v);
  }
  protected resetView(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }
  protected hostWheel(evt: WheelEvent): void {
    evt.preventDefault();
    this.setZoom(this.zoom() * (evt.deltaY < 0 ? 1.1 : 0.9));
  }

  protected setBgColor(c: string): void {
    this.bgColor.set(c);
    this.markDirty();
  }
  protected setLineColor(c: string): void {
    this.lineColor.set(c);
    this.markDirty();
  }

  // El documento de la pizarra se guarda como `frames` (un array de fotogramas).
  // La animación quedó DIFERIDA por decisión del dueño: la pizarra es solo
  // estática. Se conserva `frames` (y la compatibilidad con documentos antiguos
  // de varios fotogramas) pero NO hay UI para editar/reproducir la animación.
  protected readonly frames = signal<CanvasFrame[]>([{ duration: 1000, elements: [] }]);
  protected readonly current = signal(0);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  // Fase 1: el campo es el protagonista. El panel de Propiedades (derecha) empieza
  // CERRADO (incluso en escritorio); se abre desde su disparador o al seleccionar.
  protected readonly panelOpen = signal(false);
  /** Panel de Jugadores (izquierda): plantilla + genéricos + herramientas de jugador. */
  protected readonly jugadoresOpen = signal(false);
  /** Menú "Exportar" (arriba). */
  protected readonly exportMenuOpen = signal(false);
  /** Menú "Más" (arriba): Limpiar pizarra. La opción "Ayuda" fue retirada por el dueño. */
  protected readonly masOpen = signal(false);

  /** Cierra TODOS los paneles laterales/popovers (invariante: un solo panel principal abierto). */
  protected closeAllPanels(): void {
    this.panelOpen.set(false);
    this.jugadoresOpen.set(false);
    this.panelCat.set(null);
    this.exportMenuOpen.set(false);
    this.masOpen.set(false);
    this.cdr.detectChanges();
  }
  /** El panel de Propiedades se muestra SOLO cuando está abierto explícitamente
   *  (`panelOpen`). Antes se mostraba también con solo existir un elemento
   *  seleccionado, lo que hacía que el botón X (que usaba `togglePanel()`) viera
   *  `panelOpen` en `false` y REABRIERA el panel en vez de cerrarlo. Ahora la
   *  auto-apertura al seleccionar/crear la dispara explícitamente
   *  `openPropsPanel()` (ver `setSingleSelection`/`toggleSelect`), y cerrar con X
   *  solo apaga `panelOpen` conservando la selección. En móvil solo puede haber UN
   *  panel principal abierto a la vez: si otro está abierto, Propiedades se oculta
   *  (sin perder la selección, que sigue viva en el modelo). */
  protected showPropsPanel(): boolean {
    const otherOpen =
      this.jugadoresOpen() || this.panelCat() !== null || this.exportMenuOpen() || this.masOpen();
    if (this.isCompactViewport() && otherOpen) return false;
    return this.panelOpen();
  }
  /** Abre el panel de Propiedades (derecha) si no está, cerrando los menús. */
  protected openPropsPanel(): void {
    if (this.panelOpen()) return;
    this.jugadoresOpen.set(false);
    this.panelCat.set(null);
    this.exportMenuOpen.set(false);
    this.masOpen.set(false);
    this.panelOpen.set(true);
    this.cdr.detectChanges();
  }
  /** Cierra el panel de Propiedades SIN perder la selección: el objeto seleccionado
   *  sigue vivo y visible/operable en el campo. Es el que usa el botón X; a diferencia
   *  de `togglePanel()`, no depende de `selectedElement()` ni se reabre. */
  protected closePropsPanel(): void {
    this.panelOpen.set(false);
    this.cdr.detectChanges();
  }
  protected toggleJugadores(): void {
    if (this.jugadoresOpen()) {
      this.jugadoresOpen.set(false);
      this.cdr.detectChanges();
      return;
    }
    this.closeAllPanels();
    this.jugadoresOpen.set(true);
  }
  protected toggleExportMenu(): void {
    if (this.exportMenuOpen()) {
      this.exportMenuOpen.set(false);
      return;
    }
    this.closeAllPanels();
    this.exportMenuOpen.set(true);
  }
  protected toggleMas(): void {
    if (this.masOpen()) {
      this.masOpen.set(false);
      return;
    }
    this.closeAllPanels();
    this.masOpen.set(true);
  }
  protected closeMas(): void {
    this.masOpen.set(false);
  }

  // ---------- Pista única de "Llenar pantalla" (Fase 3) ----------
  // Toast breve y descartable que indica cómo recorrer el campo oculto. Solo aparece
  // la primera vez que se muestra la pizarra en "Llenar pantalla", se auto-oculta a
  // los pocos segundos y se persiste en localStorage para no reaparecer nunca más.
  private readonly fillHintKey = 'entrenolab:fill-hint';
  protected readonly fillHint = signal(false);
  /** La pista de "Llenar pantalla" se muestra un único hint flotante: ya no depende
   *  de la ayuda inicial (retirada por el dueño), así que solo mira su propia señal. */
  protected readonly fillHintVisible = computed(() => this.fillHint() && !this.orientHintVisible());
  private fillHintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Marca la pista como "primera vez" (persistida) pero NO arma el auto-ocultado: ese
   *  temporizador se programa en cuanto la pista se hace VISIBLE (ver el effect del
   *  constructor), de modo que nunca pierde tiempo mientras la ayuda general la tapa. */
  private maybeShowFillHint(): void {
    if (!this.fillScreen()) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(this.fillHintKey) === '1') return;
    this.fillHint.set(true);
    try {
      localStorage.setItem(this.fillHintKey, '1'); // solo una vez, en cualquier dispositivo
    } catch {
      /* sin persistencia: se mostraría en cada apertura */
    }
  }
  /** Cierra la pista inmediatamente (botón de descarte). */
  protected dismissFillHint(): void {
    this.fillHint.set(false);
    if (this.fillHintTimer) {
      clearTimeout(this.fillHintTimer);
      this.fillHintTimer = null;
    }
  }

  // ---------- Fase 6: aviso de orientación en móvil (portrait) ----------
  /** En móvil en vertical se anima a girar el dispositivo: la pizarra está pensada para
   *  usarse en horizontal. La señal SOLO aplica a la pizarra (no a login/biblioteca). */
  private readonly orientHintKey = 'entrenolab:orient-hint';
  protected readonly orientHint = signal(false);
  protected readonly orientHintVisible = computed(() => this.orientHint());
  /** Portrait en móvil: alto > ancho y ancho <= 700. */
  private isPortraitMobile(): boolean {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 700 && window.innerHeight > window.innerWidth;
  }
  /** Muestra el aviso de orientación la primera vez que se entra en la pizarra en
   *  móvil/portrait, salvo que el usuario lo haya descartado («Continuar en vertical»). */
  private maybeShowOrientHint(): void {
    if (!this.isPortraitMobile()) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(this.orientHintKey) === '1') return;
    this.orientHint.set(true);
  }
  /** «Continuar en vertical»: descarta el aviso (persistido) y deja usar la pizarra en vertical. */
  protected dismissOrientHint(): void {
    this.orientHint.set(false);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.orientHintKey, '1');
      } catch {
        /* sin persistencia: reaparecería en cada apertura */
      }
    }
  }
  /** Al girar a landscape se oculta el aviso automáticamente. */
  @HostListener('window:resize')
  protected onOrientResize(): void {
    if (this.isPortraitMobile()) {
      this.maybeShowOrientHint();
    } else {
      this.orientHint.set(false);
    }
  }

  protected readonly notice = signal<string | null>(null);
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  protected notify(msg: string): void {
    this.notice.set(msg);
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => this.notice.set(null), 4000);
  }
  protected readonly title = signal('Nueva pizarra');

  // ---------- Metadatos del ejercicio (editables desde el panel) ----------
  protected readonly metaTitle = signal('');
  protected readonly metaCategory = signal<ExerciseCategory>('Técnica');
  protected readonly metaDescription = signal('');
  protected readonly metaExplanation = signal('');
  protected readonly metaDuration = signal<number | null>(null);
  protected readonly metaMinPlayers = signal<number | null>(null);
  protected readonly metaMaxPlayers = signal<number | null>(null);
  protected readonly metaFolder = signal<string | null>(null);
  protected readonly metaMaterials = signal<string[]>([]);
  protected readonly folders = computed(() => {
    const teamId = this.store.activeTeam()?.id;
    return teamId ? this.store.getFoldersForTeam(teamId) : this.store.folders();
  });
  protected setMetaMaterials(v: string): void {
    this.metaMaterials.set(v.split(',').map((m) => m.trim()).filter((m) => m.length > 0));
    this.markDirty();
  }
  protected setMetaTitle(v: string): void { this.metaTitle.set(v); this.markDirty(); }
  protected setMetaCategory(v: string): void { this.metaCategory.set(v as ExerciseCategory); this.markDirty(); }
  protected setMetaDuration(v: string): void { this.metaDuration.set(this.numOrNull(v)); this.markDirty(); }
  protected setMetaMin(v: string): void { this.metaMinPlayers.set(this.numOrNull(v)); this.markDirty(); }
  protected setMetaMax(v: string): void { this.metaMaxPlayers.set(this.numOrNull(v)); this.markDirty(); }
  protected setMetaFolder(v: string): void { this.metaFolder.set(v || null); this.markDirty(); }
  protected numOrNull(v: string): number | null {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  protected readonly exportOpen = signal(false);

  protected readonly view = computed<CanvasElement[]>(() => this.frames()[this.current()]?.elements ?? []);

  /** Borrador de dibujo en curso. Es una SE�'AL para que `boardSafe` (computed) se
   *  re-evalúe con cada pointerdown/move y la preview se muestre EN VIVO durante el
   *  gesto (sin esto, `boardSafe` quedaría cacheado y la preview se vería obsoleta:
   *  el defecto del "doble clic" que arregla la Fase 5). Solo llega a `null` al
   *  confirmar (pointerup) o al cancelar el borrador (Escape/cancel/pinch). */
  private readonly drag = signal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  private freehandPts: [number, number][] = [];
  private movingIds: string[] = [];
  private moveStart: { x: number; y: number } | null = null;
  private moveGestureBegun = false;
  private resizing = false;
  private resizeKey: string | null = null;
  /** `size` inicial al empezar a redimensionar un material/jugador (escala uniforme). */
  private resizeStartSize: number | null = null;
  /** `points` iniciales al redimensionar un trazo a mano alzada (bbox proporcional). */
  private resizeStartPoints: [number, number][] | null = null;
  private gestureBase: CanvasFrame[] | null = null;
  /** Inicio de un gesto de PANEO (arrastre sobre campo vacío en Modo Seleccionar).
   *  `null` cuando no hay paneo activo. Distingue pantalla�?"objeto: si el puntero baja
   *  sobre un elemento se MUEVE el elemento; si baja sobre vacío, el arrastre PANEA. */
  private panGestureStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private panMoved = false;
  /** Punteros activos tocando el campo (id �?' posición de pantalla + tipo). Se registra CADA
   *  puntero (mouse/pen/touch) porque cada tipo conserva su propia gestión; el pinch SOLO
   *  cuenta los punteros táctiles ('touch'). */
  private activePointers = new Map<number, { x: number; y: number; type: string }>();
  /** Hay un pinch activo (los DOS dedos táctiles participantes siguen bajos). Solo entonces el
   *  zoom/pan están "en vivo" por el gesto. */
  private pinching = false;
  /** Id del PRIMER dedo táctil participante en el pinch (fijo desde que empieza; nunca cambia
   *  aunque entre un tercer dedo). `null` cuando no hay pinch. */
  private pinchIdA: number | null = null;
  /** Id del SEGUNDO dedo táctil participante en el pinch (fijo desde que empieza). */
  private pinchIdB: number | null = null;
  /** Distancia (px de pantalla) entre los dos dedos al INICIAR el pinch. */
  private pinchStartDist = 0;
  /** Zoom al INICIAR el pinch (antes de aplicar el ratio de distancia). */
  private pinchStartZoom = 1;
  /** Punto normalizado que debe permanecer anclado bajo el punto medio del pinch. */
  private pinchAnchorNorm: { x: number; y: number } | null = null;

  // ---------- Gestión táctil (dedo único �?" pinch) ----------
  // Un DEDO TÁCTIL no ejecuta su acción al bajar: se crea una "gestión pendiente"
  // que SOLO se confirma al levantar sin moverse (tap: colocar/seleccionar), se
  // convierte en el gesto de arrastre al superar el umbral, o se DESCARTAla si
  // llega el segundo dedo (entonces se empieza un pinch sin placer/seleccionar/
  // mover nada). Mouse y lápiz conservan su comportamiento inmediato.
  /** Umbral (px de pantalla) que separa un tap (tocar sin mover) de un arrastre. */
  private readonly TOUCH_TAP_SLOP = 10;
  /** Gestión pendiente/en curso del PRIMER dedo táctil (null si no hay). */
  private touchPending: TouchPending | null = null;

  // ---------- Long-press para DUPLICAR (Fase 7) ----------
  /** Duración (ms) de la pulsación larga antes de duplicar el objeto tocado. */
  private readonly LONG_PRESS_MS = 550;
  /** Tolerancia (px de pantalla) de movimiento de la pulsación larga: superarla la cancela. */
  private readonly LONG_PRESS_SLOP = 8;
  /** Contexto de la pulsación larga en curso (null si no hay ninguna). */
  private lp: { pointerId: number; start: { x: number; y: number }; targetId: string | null; fired: boolean } | null = null;
  private lpTimer: ReturnType<typeof setTimeout> | null = null;

  private editExerciseId: string | null = null;
  /** Relleno translúcido (true) vs solo contorno (false) para figuras. */
  protected readonly shapeFill = signal(true);
  /** Color del RELLENO de figuras (rect/elipse/zona). null �?' se deriva del perímetro. */
  protected readonly fillColor = signal<string | null>(null);
  /** Opacidad del relleno (0..1) de figuras. undefined �?' default 0.16. */
  protected readonly fillOpacity = signal<number | undefined>(undefined);
  protected setFillColor(c: string): void {
    this.fillColor.set(c);
  }
  protected setFillOpacity(o: number | undefined): void {
    this.fillOpacity.set(o);
  }
  /** Color activo de las herramientas de dibujo (el de la herramienta actual). */
  protected readonly drawColor = signal('#1f2933');
  /** Herramientas que admiten color de trazo/texto (para la paleta por pulsación larga). */
  protected readonly colorableTools: ReadonlySet<Tool> = new Set([
    'line', 'arrow', 'doubleArrow', 'curve_left', 'curve_right', 'dribble', 'freehand',
    'rect', 'ellipse', 'text',
  ]);
  /** Memoria INDEPENDIENTE de color por herramienta (Fase 1): cambiar el color de
   *  Línea no debe cambiar el de Flecha ni de Rectángulo. Se persiste por dispositivo
   *  (preferencia local), nunca dentro de los ejercicios. */
  protected readonly toolColor = signal<Record<string, string>>(this.loadToolColors());
  private static readonly toolColorKey = 'entrenolab:tool-colors';
  private loadToolColors(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(BoardComponent.toolColorKey) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }
  protected colorFor(tool: Tool): string {
    return this.toolColor()[tool] ?? '#1f2933';
  }
  protected setDrawColor(c: string): void {
    this.drawColor.set(c);
    // Guardar por herramienta (la actual) para que cada una recuerde su color.
    this.toolColor.update((m) => {
      const next = { ...m, [this.tool()]: c };
      try {
        localStorage.setItem(BoardComponent.toolColorKey, JSON.stringify(next));
      } catch {
        /* preferencia no crítica */
      }
      return next;
    });
  }

  protected readonly boardSafe = computed(() => {
    const d = this.drag();
    const preview = d ? this.previewStr(d) : '';
    return this.sanitizer.bypassSecurityTrustHtml(
      renderBoardSvg(this.field(), this.view(), {
        selectedId: this.selectedId(),
        preview,
        handles: this.handlesSvg(),
        grid: this.fieldGrid(),
        guide: this.guide(),
        backgroundColor: this.bgColor(),
        lineColor: this.lineColor(),
        orientation: this.orientation(),
        grass: this.grass(),
        f7: this.f7(),
      })
    );
  });

  // ---------- Menú contextual (±90°, duplicar, eliminar, deshacer/rehacer) ----------
  /** El menú contextual solo se abre por PULSACI�"N LARGA o clic derecho (Fase 3);
   *  una selección normal NO lo abre. Se cierra al tocar fuera, con Escape o tras una acción. */
  protected readonly ctxMenuOpen = signal(false);
  protected openCtxMenu(): void {
    if (this.selectedIds().length !== 1) return;
    this.ctxMenuOpen.set(true);
  }
  protected closeCtxMenu(): void {
    this.ctxMenuOpen.set(false);
  }
  /** Fase 3: el clic derecho NO abre el menú contextual (solo la pulsación larga).
   *  Simplemente suprime el menú nativo del navegador. */
  protected onBoardContextMenu(evt: Event): void {
    evt.preventDefault();
  }
  /** Posición (px relativos al `.board-host`) de la barra de contexto, centrada sobre
   *  el objeto y por ENCIMA de él; si no cabe arriba, pasa DEBAJO; siempre dentro del
   *  host y lejos de los bordes (para no tapar menús ni salirse de pantalla). */
  protected readonly contextBarPos = computed<{ left: number; top: number; below: boolean }>(() => {
    const el = this.selectedElement();
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!el || !hostEl) return { left: 0, top: 0, below: false };
    const r = hostEl.getBoundingClientRect();
    const bb = this.elNormBBox(el);
    const tl = this.normToScreenDisplay(bb.x0, bb.y0);
    const br = this.normToScreenDisplay(bb.x1, bb.y1);
    const centerX = (tl.x + br.x) / 2;
    const top = Math.min(tl.y, br.y);
    const bottom = Math.max(tl.y, br.y);
    const barW = 184; // 4 botones compactos + huecos
    const barH = 40;
    const margin = 8;
    let left = centerX - barW / 2;
    let below = false;
    let barTop = top - barH - 8;
    if (barTop < margin) {
      below = true;
      barTop = bottom + 8;
    }
    left = Math.max(margin, Math.min(left, r.width - barW - margin));
    if (barTop + barH > r.height - margin) {
      below = false;
      barTop = Math.max(margin, top - barH - 8);
    }
    return { left, top: barTop, below };
  });

  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly palette = PALETTE;

  /** Nombre legible en español de un color hex (para el aria-label/title de los swatches). */
  protected colorName(c: string): string {
    return colorName(c);
  }
  /** Nombre de un color en femenino plural (para los swatches de "Líneas"). */
  protected colorNamePlural(c: string): string {
    return colorNamePlural(c);
  }

  /** Herramientas que usan color de trazo/figura (para mostrar el control de color). */
  protected isColorTool(): boolean {
    return ['rect', 'ellipse', 'arrow', 'doubleArrow', 'curve_left', 'curve_right', 'line', 'dribble', 'freehand', 'text'].includes(this.tool());
  }
  /** El inspector muestra el selector de Color solo para elementos cuyo `c` se renderiza
   *  (no para materiales PNG, cuya imagen no cambia con `c`, ni para jugadores, que tienen el suyo). */
  protected showInspectorColor(): boolean {
    const t = this.selectedElement()?.t;
    // 'curve' es el TIPO de elemento de las herramientas curve_left/curve_right (se guarda
    // como t:'curve'); las curvas son coloreables, así que deben ofrecer el campo Color.
    return !!t && ['rect', 'ellipse', 'line', 'arrow', 'doubleArrow', 'curve', 'dribble', 'freehand', 'text', 'peto', 'pica'].includes(t);
  }
  protected setShapeFill(v: boolean): void {
    this.shapeFill.set(v);
  }
  /** Convierte un color hex a rgba con la alpha indicada (para rellenos no blancos). */
  protected withAlpha(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  protected readonly selectedElement = computed(
    () => this.view().find((e) => e.id === this.lastSelectedId()) ?? null
  );

  private lastSelectedId(): string | null {
    const ids = this.selectedIds();
    return ids.length ? ids[ids.length - 1] : null;
  }

  private setSingleSelection(id: string): void {
    this.selectedIds.set([id]);
    this.selectedId.set(id);
    // En móvil (�?�700px) la auto-apertura del panel de Propiedades tapa el objeto que
    // se está moviendo y bloquea la manija de rotación: se SUPRIME y solo se abre el
    // inspector cuando el usuario pulsa explícitamente el botón "Propiedades". En
    // escritorio se conserva el comportamiento anterior (auto-apertura al seleccionar).
    if (!this.isCompactViewport()) this.openPropsPanel();
  }
  private toggleSelect(id: string): void {
    const ids = this.selectedIds();
    if (ids.includes(id)) {
      const next = ids.filter((x) => x !== id);
      this.selectedIds.set(next);
      this.selectedId.set(next.length ? next[next.length - 1] : null);
    } else {
      const next = [...ids, id];
      this.selectedIds.set(next);
      this.selectedId.set(id);
      // Igual que en setSingleSelection: en móvil NO se auto-abre Propiedades.
      if (!this.isCompactViewport()) this.openPropsPanel();
    }
  }
  private clearSelection(): void {
    this.selectedIds.set([]);
    this.selectedId.set(null);
  }
  private isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  constructor() {
    const s = this.sessionSvc.session();
    if (s) {
      this.editExerciseId = s.exerciseId;
      if (s.doc) {
        const doc = normalizeCanvas(s.doc);
        this.field.set(doc.field);
        this.frames.set(doc.frames.length ? doc.frames : [{ duration: 1000, elements: [] }]);
        if (doc.backgroundColor) this.bgColor.set(doc.backgroundColor);
        if (doc.lineColor) this.lineColor.set(doc.lineColor);
        this.orientation.set(doc.orientation ?? 'horizontal');
        // La cuadrícula (Rejilla) fue retirada por el dueño: los documentos viejos
        // con `grid=true` se MIGRAN a false (no dibuja nada en el render).
        this.fieldGrid.set(false);
        this.guide.set(doc.guide ?? 'none');
        if (doc.grass) this.grass.set(doc.grass);
        this.f7.set(doc.f7 ?? null);
      }
    }
    const ex = this.editExerciseId ? this.store.exercises().find((e) => e.id === this.editExerciseId) : undefined;
    this.title.set(ex?.title ?? 'Nueva pizarra');
    // Inicializar metadatos desde el ejercicio (si se edita) para que sean editables y se guarden.
    this.metaTitle.set(ex?.title ?? '');
    this.metaCategory.set(ex?.category ?? 'Técnica');
    this.metaDescription.set(ex?.description ?? '');
    this.metaExplanation.set(ex?.explanation ?? '');
    this.metaDuration.set(ex?.durationMinutes ?? null);
    this.metaMinPlayers.set(ex?.minPlayers ?? null);
    this.metaMaxPlayers.set(ex?.maxPlayers ?? null);
    this.metaFolder.set(ex?.folderId ?? null);
    this.metaMaterials.set(ex?.materials ?? []);
    // FASE 1: si es un BORRADOR IA nuevo (sin ejercicio) con metadatos, el panel
    // "Datos del ejercicio" se inicializa con lo que propuso la IA (title ->
    // title, description -> description, objective -> explanation, duration ->
    // durationMinutes, material -> materials, playerCount -> min/max exacto).
    if (!this.editExerciseId && s?.meta) {
      const m = s.meta;
      this.title.set(m.title || 'Nueva pizarra');
      this.metaTitle.set(m.title);
      this.metaDescription.set(m.description);
      this.metaExplanation.set(m.explanation);
      this.metaDuration.set(m.durationMinutes);
      this.metaMinPlayers.set(m.minPlayers);
      this.metaMaxPlayers.set(m.maxPlayers);
      this.metaMaterials.set(m.materials ? (m.materials.split(',')
        .map((x) => x.trim()).filter(Boolean)) : []);
    }
    // Modo de pantalla: usa la preferencia guardada; si no existe, en móvil el
    // default es "Llenar pantalla" (la mayor área táctil usable del campo).
    const fillStored = typeof localStorage !== 'undefined' ? localStorage.getItem(this.fillPrefKey) : null;
    const mobileDefault = this.isCompactViewport();
    this.fillScreen.set(fillStored === null ? mobileDefault : fillStored === '1');
    this.maybeShowFillHint(); // pista única de "Llenar pantalla" (solo la primera vez)
    this.maybeShowOrientHint(); // Fase 6: aviso de girar el móvil en portrait
    // Solo UN hint flotante a la vez: la pista de "Llenar pantalla" se muestra únicamente
    // cuando la ayuda general NO está visible, y se auto-oculta a los pocos segundos de
    // hacerse visible (no de cargarse). El temporizador se arma/comparte aquí para no
    // perder tiempo mientras la ayuda general la tapa.
    effect(() => {
      const visible = this.fillHint();
      if (visible) {
        if (this.fillHintTimer) clearTimeout(this.fillHintTimer);
        this.fillHintTimer = setTimeout(() => this.fillHint.set(false), 6000);
      } else if (this.fillHintTimer) {
        clearTimeout(this.fillHintTimer);
        this.fillHintTimer = null;
      }
    });
    this.sessionSvc.setDirty(false); // al abrir un ejercicio no hay cambios pendientes
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(evt: BeforeUnloadEvent): void {
    if (this.dirty()) {
      evt.preventDefault();
      evt.returnValue = '';
    }
  }

  /** Cierra los paneles solapados al hacer clic FUERA de ellos (pero no al pulsar
   *  dentro de un panel, sobre un disparador ni sobre el campo, cuya lógica
   *  (HostListener de .board-host) gestiona la selección/inspector). */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocPointerDown(evt: PointerEvent): void {
    const t = evt.target as HTMLElement | null;
    if (!t) return;
    // Clic dentro de un panel/popover �?' no cerrar (el propio contenido gestiona su cierre).
    if (t.closest('.tools-panel')) return;
    if (t.closest('.side-panel')) return;
    if (t.closest('.top-pop')) return;
    // Clic sobre un disparador �?' lo gestiona su toggle.
    if (t.closest('.tools-cat')) return;
    if (t.closest('.edge-btn')) return;
    // Clic sobre un fondo de panel �?' lo gestiona su propio (click).
    if (t.closest('.tools-panel-backdrop')) return;
    if (t.closest('.top-panel-backdrop')) return;
    if (t.closest('.side-panel-backdrop')) return;
    // Clic sobre el campo �?' lo gestiona onPointerDown (selección/inspector, o cierre al crear).
    // NO usamos `t.closest('.board-host')` aquí: al colocar/seleccionar un elemento,
    // onPointerDown re-renderiza el SVG ([innerHTML]) y el nodo objetivo queda
    // DESENGA�'ADO, así que `closest`/`contains` fallarían y este listener cerraría el
    // panel que se acaba de abrir (el bug del doble toque era latente; lo tapaba el
    // fallback `selectedElement()` de showPropsPanel). Comprobamos si el puntero cae
    // dentro del rectángulo de .board-host.
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (hostEl) {
      const r = hostEl.getBoundingClientRect();
      if (evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom) return;
    }
    const anyOpen =
      this.panelOpen() ||
      this.jugadoresOpen() ||
      this.panelCat() !== null ||
      this.exportMenuOpen() ||
      this.masOpen();
    if (!anyOpen) return;
    this.closeAllPanels();
  }

  ngAfterViewInit(): void {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return;
    const measure = () => {
      const r = hostEl.getBoundingClientRect();
      this.hostSize.set({ w: r.width, h: r.height });
    };
    // Medir de inmediato para que el canvas se dimensione en el primer render
    // (y no espere al primer callback del ResizeObserver, que es asíncrono).
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(measure);
      this.resizeObs.observe(hostEl);
    }
  }

  ngOnDestroy(): void {
    this.endBarPress(); // limpieza del temporizador de long-press
    this.cancelLongPress(); // limpieza del temporizador de long-press-duplicar
    if (this.fillHintTimer) clearTimeout(this.fillHintTimer); // pista de "Llenar pantalla"
    this.fillHintTimer = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
  }

  // ---------- Coordenadas ----------

  private unlockedView(): CanvasElement[] {
    return this.view().filter((e) => !e.locked);
  }

  private clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  private geo(): Geometry {
    // Geometría del tipo de campo + orientación actuales (el medio campo no se
    // estira a la caja 105�-68 del campo completo).
    return fieldGeometry(this.field(), this.orientation());
  }

  private px(nx: number): number {
    const r = this.geo().rect;
    return nx * r.w + r.x;
  }
  private py(ny: number): number {
    const r = this.geo().rect;
    return ny * r.h + r.y;
  }

  private rotating = false;
  private rotCenter: { x: number; y: number } | null = null;

  private toNorm(evt: PointerEvent): { x: number; y: number } {
    return this.normForClient(evt.clientX, evt.clientY);
  }

  /** pantalla �?' norm (la inversa exacta del render). Replica screenToNorm de render.ts. */
  private normForClient(clientX: number, clientY: number): { x: number; y: number } {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return { x: 0, y: 0 };
    const r = hostEl.getBoundingClientRect();
    const g = this.geo();
    // El fit ('height' en llenar pantalla) cambia el letterboxing del SVG y debe
    // coincidir con cómo se dimensiona el canvas: así las coordenadas siguen siendo
    // correctas en AMBOS modos (ver round-trip en render.spec).
    return screenToNorm(clientX, clientY, r, g, this.panX(), this.panY(), this.zoom(), this.fillScreen() ? 'height' : 'contain');
  }

  /** norm �?' pantalla RELATIVA al host (inversa exacta de `normForClient`): devuelve
   *  coordenadas dentro de `.board-host` (ancla del overlay de la barra de contexto). */
  private normToScreenDisplay(nx: number, ny: number): { x: number; y: number } {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return { x: 0, y: 0 };
    const r = hostEl.getBoundingClientRect();
    const g = this.geo();
    const fit = this.fillScreen() ? 'height' : 'contain';
    const s = fit === 'height' ? this.fillScale(r, g) : Math.min(r.width / g.vbW, r.height / g.vbH);
    const offX = (r.width - g.vbW * s) / 2;
    const offY = (r.height - g.vbH * s) / 2;
    let vbX: number;
    let vbY: number;
    if (g.vertical) {
      const Tx = g.vbW / 2 + (g.rect.y + g.rect.h / 2);
      vbX = Tx - (ny * g.rect.h + g.rect.y);
      vbY = nx * g.rect.w + g.rect.x;
    } else {
      vbX = nx * g.rect.w + g.rect.x;
      vbY = ny * g.rect.h + g.rect.y;
    }
    const cx = offX + vbX * s;
    const cy = offY + vbY * s;
    const ox = r.width / 2;
    const oy = r.height / 2;
    return {
      x: ox + this.panX() + this.zoom() * (cx - ox),
      y: oy + this.panY() + this.zoom() * (cy - oy),
    };
  }

  /** Caja envolvente (normalizada 0..1) de un elemento, por familia. Se usa para
   *  posicionar la barra de contexto SIN tapar el objeto. */
  private elNormBBox(el: CanvasElement): { x0: number; y0: number; x1: number; y1: number } {
    const t = el.t;
    if (t === 'rect' || t === 'zone' || t === 'ellipse' || t === 'text') {
      const w = el.w ?? 0;
      const h = el.h ?? 0;
      return { x0: el.x ?? 0, y0: el.y ?? 0, x1: (el.x ?? 0) + w, y1: (el.y ?? 0) + h };
    }
    if (t === 'line' || t === 'arrow' || t === 'doubleArrow' || t === 'measure' || t === 'dribble') {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      return { x0: Math.min(x1, x2), y0: Math.min(y1, y2), x1: Math.max(x1, x2), y1: Math.max(y1, y2) };
    }
    if (t === 'curve') {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      const cx = el.c1x ?? (x1 + x2) / 2;
      const cy = el.c1y ?? (y1 + y2) / 2;
      return { x0: Math.min(x1, x2, cx), y0: Math.min(y1, y2, cy), x1: Math.max(x1, x2, cx), y1: Math.max(y1, y2, cy) };
    }
    if (t === 'freehand') {
      const pts = el.points ?? [];
      if (!pts.length) return { x0: el.x ?? 0, y0: el.y ?? 0, x1: el.x ?? 0, y1: el.y ?? 0 };
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    // Puntual (material/jugador): caja del material alrededor del centro.
    const r = this.geo().rect;
    const size = materialSize(el);
    const hw = (MATERIAL_BOX * size / 2) / r.w;
    const hh = (MATERIAL_BOX * size / 2) / r.h;
    const cx = el.x ?? 0;
    const cy = el.y ?? 0;
    return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  }

  /** LOS DOS punteros TÁCTILES activos (los que definen el pinch), en el orden en que bajaron.
   *  Devuelve `null` si no hay exactamente 2. Si hay 3+ dedos, solo cuentan los dos primeros
   *  táctiles; los demás se ignoran por completo. */
  private firstTwoTouch(): Array<{ id: number; x: number; y: number }> | null {
    const out: Array<{ id: number; x: number; y: number }> = [];
    for (const [id, p] of this.activePointers) {
      if (p.type === 'touch') {
        out.push({ id, x: p.x, y: p.y });
        if (out.length === 2) break;
      }
    }
    return out.length === 2 ? out : null;
  }

  /** Nº de punteros TÁCTILES ('touch') activos. Solo estos pueden iniciar un pinch; un
   *  mouse/pen que esté bajado NO se cuenta hacia el par del pinch. */
  private activeTouchCount(): number {
    let n = 0;
    for (const p of this.activePointers.values()) if (p.type === 'touch') n++;
    return n;
  }

  /** Posiciones ACTUALES de los dos participantes FIJOS del pinch (por sus ids). Devuelve
   *  `null` si alguno de los dos se levantó/canceló: entonces el pinch TERMINA sin transferirse
   *  al tercer dedo (evita el salto de zoom/pan del defecto de los tres dedos). */
  private pinchPoints(): Array<{ x: number; y: number }> | null {
    if (this.pinchIdA === null || this.pinchIdB === null) return null;
    const a = this.activePointers.get(this.pinchIdA);
    const b = this.activePointers.get(this.pinchIdB);
    if (!a || !b) return null;
    return [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
    ];
  }

  /** Cancelar cualquier gesto de UN dedo (pan / mover / rotar / redimensionar / dibujar)
   *  para que el pinch con dos dedos NO mueva nada. `endHistory` es un no-op si el gesto
   *  cancelado no había cambiado el documento (no crea entrada de undo ni marca sucio). */
  private cancelSinglePointerGestures(): void {
    this.panGestureStart = null;
    this.panMoved = false;
    this.movingIds = [];
    this.moveStart = null;
    this.moveGestureBegun = false;
    this.drag.set(null);
    this.freehandPts = [];
    this.rotating = false;
    this.rotCenter = null;
    this.resizing = false;
    this.resizeKey = null;
    this.overTrash = false;
    this.handDragging.set(false);
    this.endHistory();
  }

  /** Cancela un borrador de dibujo en curso SIN confirmarlo: no entra nada al
   *  documento, no se marca sucio y no se crea entrada de historial (endHistory es
   *  un no-op mientras el documento no haya cambiado, que es el caso del borrador). */
  private cancelDraft(): void {
    this.drag.set(null);
    this.freehandPts = [];
    this.endHistory();
  }

  /** Inicia un pinch (llega el SEGUNDO dedo táctil): FIJA los dos participantes y guarda
   *  distancia/zoom y el norm bajo el punto medio que quedará anclado durante todo el gesto.
   *  Un tercer (o cuarto) dedo NO entra en el par y se ignora por completo. */
  private beginPinch(): void {
    const t = this.firstTwoTouch();
    if (!t) return;
    const [a, b] = t;
    this.pinching = true;
    this.pinchIdA = a.id;
    this.pinchIdB = b.id;
    this.pinchStartDist = Math.hypot(b.y - a.y, b.x - a.x);
    this.pinchStartZoom = this.zoom();
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    // El punto de campo bajo el punto medio inicial es el ancla: se mantiene fijo.
    this.pinchAnchorNorm = this.normForClient(midX, midY);
  }

  /** Durante el pinch: zoom por ratio de distancia + pan para que el punto de campo bajo
   *  el punto medio siga ahí. SOLO usa los DOS participantes fijos �?" el movimiento de un
   *  tercer dedo no afecta. Nunca toca objetos, historial ni dirty. */
  private updatePinch(): void {
    const pts = this.pinchPoints();
    if (!pts) {
      // Alguien de los dos participantes se levantó/canceló: el pinch TERMINA aquí.
      this.resetPinch();
      return;
    }
    const [p1, p2] = pts;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const ratio = this.pinchStartDist > 0 ? dist / this.pinchStartDist : 1;
    // Pinch limitado al rango del requisito: 100%�?"300%.
    const newZoom = Math.max(1, Math.min(3, this.pinchStartZoom * ratio));
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    if (this.pinchAnchorNorm) {
      const pan = this.panToKeepAnchor(this.pinchAnchorNorm, midX, midY, newZoom);
      this.zoom.set(newZoom);
      // El pan se ajusta EXACTAMENTE para mantener el punto de campo en el punto medio
      // (sin clamp: recortarlo rompería el ancla, p. ej. en "Campo completo" donde el
      // rango de paneo es {0,0} pero el pinch sí puede desplazar la vista para anclar).
      this.panX.set(pan.panX);
      this.panY.set(pan.panY);
    } else {
      this.zoom.set(newZoom);
    }
  }

  /** Calcula panX/panY para que el punto normalizado `anchor` quede exactamente bajo
   *  (screenX, screenY) con el `zoom` dado. Es la inversa de screenToNorm (el round-trip
   *  norm�?'pantalla�?'norm es la identidad), teniendo en cuenta letterboxing y orientación. */
  private panToKeepAnchor(anchor: { x: number; y: number }, screenX: number, screenY: number, zoom: number): { panX: number; panY: number } {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return { panX: this.panX(), panY: this.panY() };
    const r = hostEl.getBoundingClientRect();
    const g = this.geo();
    const fit = this.fillScreen() ? 'height' : 'contain';
    const s = fit === 'height' ? this.fillScale(r, g) : Math.min(r.width / g.vbW, r.height / g.vbH);
    const offX = (r.width - g.vbW * s) / 2;
    const offY = (r.height - g.vbH * s) / 2;
    const ox = r.width / 2;
    const oy = r.height / 2;
    const cr = g.rect; // rect canónico del tipo de campo + orientación actuales
    let vbX: number;
    let vbY: number;
    if (g.vertical) {
      // Orientación vertical: invertir la rotación (la misma rama que screenToNorm).
      const Tx = g.vbW / 2 + (cr.y + cr.h / 2);
      vbX = Tx - (anchor.y * cr.h + cr.y);
      vbY = anchor.x * cr.w + cr.x;
    } else {
      vbX = anchor.x * cr.w + cr.x;
      vbY = anchor.y * cr.h + cr.y;
    }
    const cx = offX + vbX * s;
    const cy = offY + vbY * s;
    return {
      panX: screenX - r.left - ox - zoom * (cx - ox),
      panY: screenY - r.top - oy - zoom * (cy - oy),
    };
  }

  /** Termina el pinch de forma limpia (sin dejar zoom/pan "en vivo", sin arrastres fantasma
   *  ni transferirlo al tercer dedo). Libera los participantes fijos. */
  private resetPinch(): void {
    this.pinching = false;
    this.pinchIdA = null;
    this.pinchIdB = null;
    this.pinchStartDist = 0;
    this.pinchStartZoom = 1;
    this.pinchAnchorNorm = null;
  }

  // ---------- UI ----------

  protected setField(f: FieldType): void {
    this.field.set(f);
    // El medio campo por defecto se muestra en VERTICAL (portería arriba, línea de
    // medio campo abajo) en escritorio/tablet. Decisión del dueño (usabilidad móvil):
    // en un ejercicio NUEVO desde móvil se mantiene HORIZONTAL/paisaje por defecto
    // (no se fuerza vertical). Al editar un documento existente se respeta su
    // orientación guardada (el constructor la lee de `doc.orientation`).
    if (f === 'half' || f === 'vertical_half') {
      if (!this.isCompactViewport() || this.editExerciseId) this.orientation.set('vertical');
    }
    this.markDirty();
  }

  protected togglePanel(): void {
    // Si el panel está abierto, cerrarlo CONSERVANDO la selección (el inspector
    // vive en él, pero las asas/manija de rotación deben seguir visibles en el
    // campo). Si está cerrado, abrirlo (cerrando los demás paneles en móvil).
    if (this.panelOpen()) {
      this.panelOpen.set(false);
      this.cdr.detectChanges();
      return;
    }
    this.openPropsPanel();
  }

  protected openExport(): void {
    this.exportOpen.set(true);
  }
  protected closeExport(): void {
    this.exportOpen.set(false);
  }

  /** Variantes (color/tipo) de cada material; la elegida se usa en la próxima colocación. */
  protected readonly materialVariant = signal<Record<string, TacticalKind>>({});
  /** Variante abierta desde la barra inferior (long-press / clic derecho). */
  protected readonly barVariant = signal<Tool | null>(null);
  /** Paleta de COLOR abierta para una herramienta coloreable (long-press / clic derecho). */
  protected readonly barColor = signal<Tool | null>(null);
  protected barLongPressed = false;
  private barVariantTimer: ReturnType<typeof setTimeout> | null = null;
  private barColorTimer: ReturnType<typeof setTimeout> | null = null;
  private barPressStart: { x: number; y: number } | null = null;

  protected beginBarPress(id: Tool, evt?: PointerEvent): void {
    const hasVariants = this.variantKindsFor(id).length > 1;
    const isColorable = this.colorableTools.has(id);
    if (!hasVariants && !isColorable) return;
    this.barPressStart = evt ? { x: evt.clientX, y: evt.clientY } : null;
    this.barLongPressed = false;
    if (this.barVariantTimer) clearTimeout(this.barVariantTimer);
    if (this.barColorTimer) clearTimeout(this.barColorTimer);
    this.barColorTimer = setTimeout(() => {
      if (hasVariants) {
        this.barVariant.set(id);
      } else {
        this.barColor.set(id); // paleta de color para herramienta coloreable
      }
      this.barLongPressed = true; // anula la colocación por el clic posterior
    }, 500);
  }
  protected cancelBarPress(evt: PointerEvent): void {
    if (this.barPressStart) {
      const dx = evt.clientX - this.barPressStart.x;
      const dy = evt.clientY - this.barPressStart.y;
      if (Math.hypot(dx, dy) > 10) this.endBarPress(); // cancelación por movimiento
    }
  }
  protected endBarPress(): void {
    if (this.barVariantTimer) clearTimeout(this.barVariantTimer);
    this.barVariantTimer = null;
    if (this.barColorTimer) clearTimeout(this.barColorTimer);
    this.barColorTimer = null;
    this.barPressStart = null;
  }
  /** Cierra la paleta de color y DEJA la herramienta armada con el color elegido. */
  protected pickBarColor(c: string): void {
    const id = this.barColor();
    if (id) {
      this.toolColor.update((m) => {
        const next = { ...m, [id]: c };
        try {
          localStorage.setItem(BoardComponent.toolColorKey, JSON.stringify(next));
        } catch {
          /* preferencia no crítica */
        }
        return next;
      });
      this.drawColor.set(c);
      this.setTool(id); // arma la herramienta con su nuevo color (sin dibujar)
      this.cdr.detectChanges();
    }
    this.barColor.set(null);
  }
  protected closeBarColor(): void {
    this.barColor.set(null);
  }
  /** Título de la paleta de color: la herramienta PULSADA (no la activa). */
  protected barColorTitle(): string {
    return TOOLS.find((t) => t.id === this.barColor())?.title ?? '';
  }
  protected barToolClick(id: Tool): void {
    this.endBarPress();
    if (this.barLongPressed) {
      this.barLongPressed = false;
      return; // fue long-press: no colocar
    }
    // Pulsar de nuevo la herramienta YA armada cancela el emplazamiento.
    if (id !== 'select' && PLACEMENT_TOOLS.has(id) && this.armed() && this.tool() === id) {
      this.cancelArm();
      this.closeToolPanel();
      return;
    }
    this.setTool(id);
    if (id !== 'select' && PLACEMENT_TOOLS.has(id)) this.armForTool(id);
    else this.armed.set(null); // dibujo / erase: sin emplazamiento
    this.closeToolPanel(); // elegir una herramienta cierra el panel desplegable inferior
    this.jugadoresOpen.set(false); // y el panel izquierdo de Jugadores (campo libre para colocar)
    this.cdr.detectChanges();
  }
  protected openBarVariant(evt: Event, id: Tool): void {
    evt.preventDefault();
    evt.stopPropagation();
    // Clic derecho: para herramientas coloreables abre la PALETA DE COLOR (Fase 1),
    // para materiales con variantes abre las variantes; suprime el menú del navegador.
    if (this.colorableTools.has(id)) {
      this.barColor.set(this.barColor() === id ? null : id);
      return;
    }
    this.barVariant.set(this.barVariant() === id ? null : id);
  }
  protected closeBarVariant(): void {
    this.barVariant.set(null);
  }
  protected pickBarVariant(id: Tool, kind: TacticalKind): void {
    this.setMaterialVariant(id, kind);
    this.closeBarVariant();
  }
  protected defaultKindFor(id: string): TacticalKind {
    const kind = materialAsset(id);
    return kind?.kind ?? 'ball_vec';
  }
  protected variantKindsFor(id: string): TacticalKind[] {
    switch (id) {
      case 'cone':
        return ['cone_red', 'cone_yellow', 'cone_blue', 'cone_orange', 'cone_white', 'cone_blue2'];
      case 'mannequin':
        return ['mannequin', 'mannequin_row'];
      case 'ladder':
        return ['ladder', 'ladder_yellow'];
      case 'ring':
        return ['ring', 'ring_flat'];
      default:
        return [this.defaultKindFor(id)];
    }
  }
  /** Fase 14 �?" ruta de la miniatura REAL de un material (variante activa o por defecto).
   *  Devuelve null para los materiales vectoriales sin PNG (se renderiza como SVG).
   *  La ruta es RELATIVA (sin `/` inicial) para ser compatible con el baseHref `/CDMPLab/`
   *  de GitHub Pages, sin tocar el render ni el inlining (que usa rutas absolutas). */
  protected materialThumbSrc(id: string): string | null {
    const kind = this.materialVariant()[id] ?? this.defaultKindFor(id);
    const asset = tacticAsset(kind)?.asset;
    return asset ? asset.replace(/^\//, '') : null;
  }
  protected setMaterialVariant(id: string, kind: TacticalKind): void {
    this.materialVariant.update((m) => ({ ...m, [id]: kind }));
  }

  /** Miniatura SVG REAL de un material VECTORIAL (sin PNG), dibujada con los MISMOS
   *  trazos/colores que el render del campo (render.ts), centrada en un viewBox
   *  cuadrado. Sustituye el icono genérico de Material Symbols. Devuelve '' si el
   *  material tiene PNG (no debe llegar aquí). Los colores por defecto coinciden con
   *  los que usa el render cuando el elemento no lleva color explícito. */
  protected materialVectorThumb(id: string): string {
    const DEF: Record<string, string> = {
      fitball: '#e67e22',
      coachC: '#e6b800',
      peto: '#f6c945',
      chaleco: '#e74c3c',
      bosu: '#3056d3',
      pica: '#ffffff',
    };
    const c = DEF[id] ?? '#e8edf2';
    let inner = '';
    switch (id) {
      case 'fitball':
        inner = `<circle r="1.8" fill="${c}" stroke="#20242a" stroke-width="0.2"/><path d="M-1.27 -1.27 A1.8 1.8 0 0 1 1.27 -1.27" fill="none" stroke="#ffffff" stroke-width="0.4" opacity="0.5"/>`;
        break;
      case 'coachC':
        inner = `<circle r="1.7" fill="${c}" stroke="#20242a" stroke-width="0.25"/><text text-anchor="middle" dominant-baseline="central" y="0.05" font-size="1.8" font-weight="800" fill="#111111">C</text>`;
        break;
      case 'peto':
        inner = `<path d="M-2 1.6 L-2.4 -1.4 L-1.2 -2.2 L-0.4 -1.2 L0.4 -1.2 L1.2 -2.2 L2.4 -1.4 L2 1.6 Z" fill="${c}" stroke="#20242a" stroke-width="0.2"/>`;
        break;
      case 'chaleco':
        inner = `<path d="M-1.6 2 L-1.2 -1.8 L-0.2 -1.2 L0.2 -1.2 L1.2 -1.8 L1.6 2 Z" fill="${c}" stroke="#20242a" stroke-width="0.2"/><rect x="-0.7" y="-0.4" width="1.4" height="1" fill="#ffffff" opacity="0.3"/>`;
        break;
      case 'bosu':
        inner = `<path d="M-1.6 0 A1.6 1.6 0 0 1 1.6 0 Z" fill="${c}" stroke="#20242a" stroke-width="0.2"/><ellipse cx="0" cy="0" rx="1.6" ry="0.5" fill="#10151a" opacity="0.55"/>`;
        break;
      case 'pica':
        inner = `<rect x="-0.25" y="-2.4" width="0.5" height="4.8" rx="0.25" fill="${c}" stroke="#20242a" stroke-width="0.2"/>`;
        break;
      default:
        return '';
    }
    return `<svg viewBox="-2.6 -2.6 5.2 5.2" preserveAspectRatio="xMidYMid meet" class="mat-thumb-svg" aria-hidden="true" focusable="false">${inner}</svg>`;
  }

  /** HTML seguro de la miniatura vectorial (usa el mismo sanitizador que el campo). */
  protected materialVectorThumbSafe(id: string): SafeHtml {
    const svg = this.materialVectorThumb(id);
    return this.sanitizer.bypassSecurityTrustHtml(svg || `<span class="msi">${this.materialIcon(id)}</span>`);
  }

  /** Icono de respaldo (solo si la miniatura vectorial no tiene forma conocida). */
  private materialIcon(id: string): string {
    return MATERIALS.find((m) => m.id === id)?.icon ?? 'category';
  }


  /** Lado del equipo que se coloca con la bandeja de genéricos (Propio/Rival). */
  protected readonly traySide = signal<'own' | 'rival'>('own');
  protected setTraySide(s: 'own' | 'rival'): void {
    this.traySide.set(s);
  }

  // Colocación de jugadores de la bandeja/genéricos: ahora ARRMAN el emplazamiento
  // (armRosterPlayer / armGeneric) en lugar de auto-colocar en una fila. La
  // posición la decide el clic sobre el campo (ver armRosterPlayer/armGeneric).

  // ---------- Historial (undo/redo) ----------

  private beginHistory(): void {
    this.gestureBase = this.frames();
    this.history.snapshot(this.frames());
  }
  private endHistory(): void {
    // Solo registrar en el historial si el gesto realmente modificó el documento.
    // Un clic para seleccionar (sin arrastrar) no debe crear una entrada de undo.
    const changed = !!(this.gestureBase && JSON.stringify(this.gestureBase) !== JSON.stringify(this.frames()));
    if (changed) {
      this.history.commit(this.frames());
      this.markDirty();
    }
    this.gestureBase = null;
  }

  protected undo(): void {
    const prev = this.history.getUndo();
    if (prev) this.frames.set(prev);
    this.clearSelection();
  }

  protected redo(): void {
    const next = this.history.getRedo();
    if (next) this.frames.set(next);
    this.clearSelection();
  }

  // ---------- Atajos de teclado ----------

  @HostListener('window:keydown', ['$event'])
  onKeydown(evt: KeyboardEvent): void {
    const t = evt.target as HTMLElement | null;
    const editing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const ctrl = evt.ctrlKey || evt.metaKey;
    // Atajos globales de la pizarra que también funcionan mientras se edita texto:
    // Ctrl+Z/Y deshacen/rehacen la pizarra (la edición del texto no crea entradas
    // propias de historial). El resto de teclas se dejan al editor nativo.
    if (ctrl && evt.key.toLowerCase() === 'z') {
      evt.preventDefault();
      if (evt.shiftKey) this.redo();
      else this.undo();
    } else if (ctrl && evt.key.toLowerCase() === 'y') {
      evt.preventDefault();
      this.redo();
    } else if (ctrl && evt.key.toLowerCase() === 'c' && !editing) {
      evt.preventDefault();
      this.copySelected();
    } else if (ctrl && evt.key.toLowerCase() === 'v' && !editing) {
      evt.preventDefault();
      this.paste();
    } else if (ctrl && evt.key.toLowerCase() === 'd' && !editing) {
      evt.preventDefault();
      this.duplicateSelected();
    } else if (editing) {
      return; // no robar Delete/Backspace/Escape del editor de texto
    } else if (evt.key === ' ' && t?.tagName !== 'BUTTON') {
      // Barra espaciadora (escritorio): activa "Mano" temporalmente para paneo rápido.
      // Se evita cuando un botón del raíl tiene el foco (ahí, espacio = activar el botón).
      evt.preventDefault();
      this.tempSpaceHand();
    } else if (evt.key === 'Delete' || evt.key === 'Backspace') {
      evt.preventDefault();
      this.removeSelected();
    } else if (evt.key === 'Escape') {
      // Si hay un borrador de dibujo en curso, Escape lo cancela (no crea nada).
      if (this.drag()) {
        this.cancelDraft();
        return;
      }
      // Si hay un emplazamiento armado, Escape lo cancela (no crea nada).
      if (this.armed()) {
        this.cancelArm();
        return;
      }
      // Fase 3: Escape cierra el menú contextual.
      this.closeCtxMenu();
      // Primero limpiar la selección y después cerrar los paneles: closeAllPanels
      // fuerza change-detection, de modo que el panel (que se muestra mientras hay
      // selección) desaparece de verdad.
      this.clearSelection();
      this.closeAllPanels();
    }
  }

  /** Activa "Mano" mientras se mantiene la barra espaciadora (recordando la herramienta
   *  anterior para restaurarla al soltarla). Si ya es "Mano", no hace nada. */
  private tempSpaceHand(): void {
    if (this.tool() === 'hand' || this.spaceHandActive) return;
    this.spaceHandActive = true;
    this.toolBeforeSpace = this.tool();
    this.setTool('hand');
  }

  /** Al soltar la barra espaciadora, vuelve a la herramienta que estaba activa. */
  @HostListener('window:keyup', ['$event'])
  onKeyup(evt: KeyboardEvent): void {
    if (evt.key !== ' ' || !this.spaceHandActive) return;
    this.spaceHandActive = false;
    if (this.tool() === 'hand' && this.toolBeforeSpace) this.setTool(this.toolBeforeSpace);
    this.toolBeforeSpace = null;
  }

  // ---------- Copiar / pegar ----------

  private clipboard: CanvasElement | null = null;

  protected copySelected(): void {
    const el = this.selectedElement();
    if (el) this.clipboard = { ...el };
  }

  protected paste(): void {
    if (!this.clipboard) return;
    const el = this.clipboard;
    // Un jugador de Plantilla no puede duplicarse (ni como propio ni rival): se bloquea.
    if (el.t === 'player' && el.playerId) {
      this.notify('No se puede pegar un jugador de la plantilla: ya está en el campo.');
      return;
    }
    this.beginHistory();
    this.addElement({ ...translateElement(el, 0.06, 0.06), id: uid() });
    this.endHistory();
    this.selectedId.set(this.frames()[this.current()]?.elements.at(-1)?.id ?? null);
  }

  // ---------- Bloquear y capas ----------

  protected toggleLock(): void {
    const id = this.selectedId();
    if (!id) return;
    const el = this.selectedElement();
    this.beginHistory();
    this.updateElement(id, { locked: !el?.locked });
    this.endHistory();
  }

  protected bringForward(): void {
    this.layerShift(1);
  }
  protected sendBack(): void {
    this.layerShift(-1);
  }
  private layerShift(dir: 1 | -1): void {
    const id = this.selectedId();
    if (!id) return;
    this.beginHistory();
    this.frames.set(layerShiftFrames(this.frames(), id, dir));
    this.endHistory();
  }

  protected goBack(): void {
    this.sessionSvc.close();
    this.router.navigate(['/library']);
  }

  protected setTool(t: Tool): void {
    this.tool.set(t);
    // Cada herramienta coloreable usa SU color recordado (Fase 1) al armarse.
    if (this.colorableTools.has(t)) this.drawColor.set(this.colorFor(t));
    if (t !== 'select') this.selectedId.set(null);
    if (t !== 'hand') this.handDragging.set(false);
    // Cambiar de herramienta aborta cualquier pulsación larga pendiente.
    this.cancelLongPress();
  }

  // ---------- Emplazamiento armado (jugadores / materiales / genéricos) ----------

  /** Texto de la pista mostrada mientras hay un emplazamiento armado. */
  protected armedLabel(): string {
    const a = this.armed();
    return a ? `Toca el campo para colocar a ${a.label}` : '';
  }

  /** Cancela el emplazamiento armado (Escape o re-tocar la herramienta): no crea nada. */
  protected cancelArm(): void {
    if (!this.armed()) return;
    this.armed.set(null);
    this.setTool('select');
    this.notify('Colocación cancelada.');
    this.cdr.detectChanges();
  }

  /** Arma la colocación al elegir una herramienta de un solo uso desde un panel. */
  protected armForTool(id: Tool): void {
    if (id === 'player') {
      this.armed.set({ tool: 'player', label: 'Jugador propio', player: { c: '#1a73e8', side: 'own' } });
    } else if (id === 'player_rival') {
      this.armed.set({ tool: 'player_rival', label: 'Jugador rival', player: { n: 0, c: '#c0392b', side: 'rival' } });
    } else if (id === 'text') {
      this.armed.set({ tool: 'text', label: 'Texto' });
    } else {
      this.armed.set({ tool: id, label: TOOLS.find((t) => t.id === id)?.title ?? '' });
    }
  }

  /** Tocar un jugador de plantilla: cierra el panel y ARMA la colocación (aún no coloca). */
  protected armRosterPlayer(p: Player): void {
    if (this.placedPlayerIds().has(p.id)) return; // un jugador de plantilla, una sola instancia
    const rival = this.traySide() !== 'own';
    this.armed.set({
      tool: rival ? 'player_rival' : 'player',
      label: p.name,
      player: {
        n: p.number ?? 0,
        c: rival ? '#c0392b' : p.color,
        side: rival ? 'rival' : 'own',
        type: p.position === 'GK' ? 'goalkeeper' : undefined,
        playerId: p.id,
        label: p.name.slice(0, 10),
      },
    });
    this.setTool(rival ? 'player_rival' : 'player');
    this.closeAllPanels(); // Tocar un jugador cierra el panel y ARMA la colocación
    this.cdr.detectChanges();
  }

  /** Fase 12 �?" color rápido por jugador. Id del jugador cuya mini-paleta está abierta. */
  protected readonly rosterColorOpen = signal<string | null>(null);
  /** Abre/cierra la mini-paleta de color de un jugador de plantilla. */
  protected toggleRosterColor(id: string, evt: Event): void {
    evt.stopPropagation();
    this.rosterColorOpen.set(this.rosterColorOpen() === id ? null : id);
  }
  /** Aplica un color a la ficha del jugador y a las fichas YA colocadas con ese playerId. */
  protected setRosterColor(id: string, c: string, evt: Event): void {
    evt.stopPropagation();
    const p = this.players().find((x) => x.id === id);
    if (p) this.store.updatePlayer(id, { color: c });
    // Un jugador de plantilla colocado debe actualizar su color visible en el ejercicio.
    this.frames.set(
      this.frames().map((f) => ({
        ...f,
        elements: f.elements.map((e) => (e.t === 'player' && e.playerId === id ? { ...e, c } : e)),
      }))
    );
    this.rosterColorOpen.set(null);
  }

  /** Tocar un jugador genérico (comodín / portero / rival): cierra el panel y ARMA la colocación. */
  protected armGeneric(kind: 'portero' | 'rival'): void {
    // Fase 13: se retira el Comodín (el entrenador asigna otro color a un jugador).
    if (kind === 'rival') {
      this.armed.set({ tool: 'player_rival', label: 'Rival', player: { n: 0, c: '#c0392b', side: 'rival' } });
      this.setTool('player_rival');
    } else {
      this.armed.set({ tool: 'player', label: 'Portero', player: { n: 1, c: '#1f7a4d', side: 'own', type: 'goalkeeper' } });
      this.setTool('player');
    }
    this.closeAllPanels();
    this.cdr.detectChanges();
  }

  /** Fase 7 �?" coloca una formación rápida como UNA única transacción de historial.
   *  Usa jugadores de plantilla disponibles (sin duplicar instancias ya colocadas) para
   *  el equipo propio, o genéricos rivales; si faltan, coloca los disponibles e informa. */
  /** ¿Es un portero (posición/role GK)? */
  private isGoalkeeper(p: { position?: string; type?: string }): boolean {
    return p.position === 'GK' || p.type === 'goalkeeper';
  }

  /** Fase 4 — coloca/reorganiza una formación como UNA única transacción de historial.
   *  Idempotente: aplicar la misma formación varias veces deja el mismo resultado.
   *  - Reutiliza jugadores ya colocados (los RECOLOCA; nunca duplica una instancia).
   *  - Prioriza el portero real a la portería (independiente del orden de la plantilla).
   *  - PROPIO: jugadores de plantilla; RIVAL: rivales genéricos que reutiliza.
   *  - Si faltan jugadores coloca los disponibles e informa sin bloquear. */
  protected applyFormation(side: 'own' | 'rival', formationId: string): void {
    const f = FORMATIONS.find((x) => x.id === formationId);
    if (!f) return;
    const positions = side === 'rival' ? f.positions.map(([x, y]) => [1 - x, y] as [number, number]) : f.positions;

    // Elementos de jugador YA colocados de este lado (para recolocarlos, sin duplicar).
    const existing = this.view().filter((e) => e.t === 'player' && (e.side ?? 'own') === side);
    const existingByPlayerId = new Map(existing.filter((e) => e.playerId).map((e) => [e.playerId!, e]));

    // Plantilla ordenada: porteros primero, luego el resto (independiente del orden).
    const roster = [...this.players()].sort((a, b) => Number(this.isGoalkeeper(b)) - Number(this.isGoalkeeper(a)));

    this.beginHistory();
    let placed = 0;
    const keptIds = new Set<string>();
    for (let i = 0; i < positions.length; i++) {
      const [px, py] = positions[i];
      let elId: string | null = null;
      if (side === 'own') {
        const p = roster[i];
        if (!p) break;
        const ex = existingByPlayerId.get(p.id);
        if (ex) {
          elId = ex.id;
          this.updateElement(ex.id, { x: px, y: py });
        } else {
          const spec: PlayerPlacement = {
            n: p.number ?? this.nextNumber(),
            c: p.color,
            side: 'own',
            type: this.isGoalkeeper(p) ? 'goalkeeper' : undefined,
            playerId: p.id,
            label: p.name.slice(0, 10),
          };
          elId = this.placePlayerElement({ x: px, y: py }, spec);
        }
        keptIds.add(elId!);
      } else {
        const rex = existing[i];
        if (rex) {
          elId = rex.id;
          this.updateElement(rex.id, { x: px, y: py });
        } else {
          elId = this.placePlayerElement({ x: px, y: py }, { n: i + 1, c: '#c0392b', side: 'rival' });
        }
        keptIds.add(elId!);
      }
      placed++;
    }
    // Eliminar los elementos de este lado que quedaron FUERA de la formación (exceso).
    const excess = existing.filter((e) => !keptIds.has(e.id));
    if (excess.length) this.removeElements(excess.map((e) => e.id));
    this.endHistory();

    if (placed < positions.length) {
      this.notify(`Solo se pudieron colocar ${placed} de ${positions.length} jugadores (faltan en plantilla).`);
    }
    this.setTool('select');
  }

  protected readonly formations = FORMATIONS;

  private buildPlayerElement(p: { x: number; y: number }, spec: PlayerPlacement): CanvasElement {
    return {
      id: uid(),
      t: 'player',
      x: this.clamp01(p.x),
      y: this.clamp01(p.y),
      n: spec.n ?? this.nextNumber(),
      c: spec.c,
      side: spec.side,
      type: spec.type,
      playerId: spec.playerId,
      label: spec.label,
    };
  }

  private placePlayerElement(p: { x: number; y: number }, spec: PlayerPlacement): string | null {
    const el = this.buildPlayerElement(p, spec);
    this.addElement(el);
    return el.id;
  }

  protected toolHint(): string {
    const map: Partial<Record<Tool, string>> = {
      select: 'Selecciona y mueve elementos (arrastra para mover; la rueda hace zoom; la rotación ±90° desde la barra de contexto)',
      hand: 'Arrastra para desplazar el campo (pellizca con dos dedos para acercar)',
      player: 'Clic para colocar un jugador propio',
      player_rival: 'Clic para colocar un jugador rival',
      ball: 'Clic para colocar el balón',
      cone: 'Clic para colocar un cono',
      mannequin: 'Clic para colocar un maniquí',
      minigoal: 'Clic para colocar una mini portería',
      pole: 'Clic para colocar una pértiga / poste',
      marker: 'Clic para colocar un marcador',
      hurdle: 'Clic para colocar una valla',
      ring: 'Clic para colocar un aro',
      ladder: 'Clic para colocar una escalera',
      flag: 'Clic para colocar un banderín',
      trampoline: 'Clic para colocar un minitrampolín',
      target: 'Clic para colocar una diana',
      net: 'Clic para colocar una red',
      vball: 'Clic para colocar un balón morado',
      coachC: 'Clic para colocar un marcador C',
      peto: 'Clic para colocar un peto',
      chaleco: 'Clic para colocar un chaleco lastrado',
      bosu: 'Clic para colocar un BOSU',
      fitball: 'Clic para colocar un fitball',
      pica: 'Clic para colocar una pica coloreable',
      rect: 'Arrastra para dibujar un rectángulo',
      ellipse: 'Arrastra para dibujar un círculo / elipse',
      arrow: 'Arrastra para dibujar una flecha',
      doubleArrow: 'Arrastra para dibujar una flecha de doble sentido',
      curve_left: 'Arrastra para dibujar una curva a la izquierda',
      curve_right: 'Arrastra para dibujar una curva a la derecha',
      dribble: 'Arrastra para dibujar una conducción (zigzag)',
      line: 'Arrastra para dibujar una línea',
      freehand: 'Arrastra para dibujar a mano alzada',
      text: 'Clic para colocar un texto',
      erase: 'Clic sobre un elemento para borrarlo',
    };
    return map[this.tool()] ?? '';
  }

  protected positionLabel(pos: Position): string {
    switch (pos) {
      case 'GK':
        return 'POR';
      case 'DF':
        return 'DEF';
      case 'MF':
        return 'MED';
      case 'FW':
        return 'DEL';
      default:
        return '';
    }
  }

  protected textColor(bg: string): string {
    return textColorFn(bg);
  }

  // ---------- Inspector del elemento seleccionado ----------

  protected updateElement(id: string, patch: Partial<CanvasElement>): void {
    this.frames.set(updateElementInFrames(this.frames(), id, patch));
  }

  /** Edita el elemento seleccionado como UNA acción de historial (deshacer/rehacer). */
  private editSelected(patch: Partial<CanvasElement>): void {
    const id = this.selectedId();
    if (!id) return;
    this.beginHistory();
    this.updateElement(id, patch);
    this.endHistory();
  }

  protected setSelNumber(evt: Event): void {
    const v = parseInt((evt.target as HTMLInputElement).value, 10);
    this.editSelected({ n: Number.isNaN(v) ? 0 : v });
  }

  protected setSelLabel(evt: Event): void {
    this.editSelected({ label: (evt.target as HTMLInputElement).value });
  }

  protected setSelText(evt: Event): void {
    const id = this.selectedId();
    if (!id) return;
    const v = (evt.target as HTMLInputElement).value;
    const patch: Partial<CanvasElement> = { v };
    const el = this.view().find((e) => e.id === id);
    // Auto-crece el alto del cuadro (solo crece, nunca encoge) para que ninguna
    // línea quede recortada, SIEMPRE que el usuario no haya fijado el cuadro a mano.
    if (el && el.t === 'text' && el.w && el.autoH !== false) {
      patch.h = Math.max(el.h ?? DEFAULT_TEXT_H, this.autoHForText(v, el.size ?? DEFAULT_TEXT_SIZE, el.w));
    }
    // Edición EN VIVO (con cada tecla) para que el texto se refleje al instante
    // en el campo. No crea una entrada de historial por tecla: la edición se
    // registra como parte del gesto/colocación.
    this.updateElement(id, patch);
  }

  /** Alto normalizado necesario para que el texto (v) quepa entero en su cuadro. */
  private autoHForText(v: string, size: number, w: number): number {
    const boxW = w * this.geo().rect.w;
    return autoTextBoxH(v, size, boxW);
  }

  protected setSelColor(c: string): void {
    const t = this.selectedElement()?.t;
    if (t === 'rect' || t === 'ellipse' || t === 'zone') {
      // Fase 10: el relleno usa EXACTAMENTE el mismo color que el perímetro �?' se
      // sincroniza al cambiar el color, para que el modelo guardado coincida.
      this.editSelected({ c, fillColor: c });
    } else {
      this.editSelected({ c });
    }
  }

  protected setSelFill(fill: boolean): void {
    // fill:false �?' solo perímetro; fill:true �?' relleno (mantiene fillColor/fillOpacity).
    this.editSelected({ fill });
  }
  protected setSelFillColor(c: string): void {
    this.editSelected({ fillColor: c });
  }
  protected setSelFillOpacity(o: number | undefined): void {
    // Auto (undefined) �?' elimina la opacidad explícita para usar el default 0.16.
    this.editSelected({ fillOpacity: o });
  }

  protected setSelArrowStyle(style: 'solid' | 'dashed'): void {
    this.editSelected({ style });
  }

  protected setSelSize(evt: Event): void {
    const v = parseFloat((evt.target as HTMLInputElement).value);
    const size = Number.isNaN(v) ? 1 : Math.max(0.4, Math.min(6, v));
    const el = this.selectedElement();
    const patch: Partial<CanvasElement> = { size };
    // Si cambia el tamaño de fuente puede cambiar el número de líneas: auto-crece.
    if (el && el.t === 'text' && el.w && el.autoH !== false) {
      patch.h = Math.max(el.h ?? DEFAULT_TEXT_H, this.autoHForText(el.v ?? '', size, el.w));
    }
    this.editSelected(patch);
  }

  protected setSelW(evt: Event): void {
    const pct = parseLocalizedNumber((evt.target as HTMLInputElement).value);
    const el = this.selectedElement();
    if (Number.isNaN(pct)) return; // entrada no numérica: no tocar el modelo
    // La UI usa % (0..100); el modelo guarda el normalizado 0..1 (preciso).
    const patch: Partial<CanvasElement> = { w: clampNorm(pctToNormalized(pct), 0.02) };
    if (el?.t === 'text') patch.autoH = false; // fijar el ancho a mano desactiva el auto-crecimiento
    this.editSelected(patch);
  }

  protected setSelH(evt: Event): void {
    const pct = parseLocalizedNumber((evt.target as HTMLInputElement).value);
    const el = this.selectedElement();
    if (Number.isNaN(pct)) return;
    const patch: Partial<CanvasElement> = { h: clampNorm(pctToNormalized(pct), 0.02) };
    if (el?.t === 'text') patch.autoH = false; // fijar el alto a mano desactiva el auto-crecimiento
    this.editSelected(patch);
  }

  /** Ancho normalizado �?' porcentaje con UNA decimal (0.3 �?' 30, 0.28868�?� �?' 28.9).
   *  Solo redondea la PRESENTACI�"N; el modelo conserva el valor preciso. */
  protected selWPct(): number {
    return Math.min(100, Math.max(2, normalizedToPct(this.selectedElement()?.w ?? 0)));
  }
  /** Alto normalizado �?' porcentaje con UNA decimal. */
  protected selHPct(): number {
    return Math.min(100, Math.max(2, normalizedToPct(this.selectedElement()?.h ?? 0)));
  }

  /** "Ajustar al contenido": recalcula w/h para que el texto quepa EXACTAMENTE
   *  (puede ENCOGER si se acortó) y vuelve a activar el auto-crecimiento. */
  protected fitTextToContentSelected(): void {
    const el = this.selectedElement();
    if (!el || el.t !== 'text') return;
    // El cuadro no desborda el campo por la derecha (como el render): como mucho
    // hasta el borde derecho desde la posición actual del cuadro.
    const maxW = Math.max(0.02, 1 - (el.x ?? 0));
    const fit = fitTextToContent(el.v ?? '', el.size ?? DEFAULT_TEXT_SIZE, maxW, this.geo().rect);
    this.editSelected({ w: fit.w, h: fit.h, autoH: true });
  }

  protected setSelOpacity(evt: Event): void {
    const v = parseFloat((evt.target as HTMLInputElement).value);
    this.editSelected({ opacity: Number.isNaN(v) ? 1 : Math.max(0.05, Math.min(1, v)) });
  }

  protected opacityPct(): number {
    return Math.round((this.selectedElement()?.opacity ?? 1) * 100);
  }

  protected setSelStrokeWidth(evt: Event): void {
    const v = parseFloat((evt.target as HTMLInputElement).value);
    this.editSelected({ strokeWidth: Number.isNaN(v) ? DEFAULT_STROKE_WIDTH : Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, v)) });
  }

  protected setSelLineStyle(style: 'solid' | 'dashed' | 'dotted'): void {
    this.editSelected({ lineStyle: style });
  }

  protected setSelType(type: 'player' | 'goalkeeper'): void {
    this.editSelected({ type });
  }

  protected toggleSelSide(): void {
    const el = this.selectedElement();
    if (!el) return;
    const rival = el.side !== 'own';
    this.editSelected({ side: rival ? 'own' : 'rival', c: rival ? '#1a73e8' : '#c0392b' });
  }

  protected duplicateSelected(): void {
    const el = this.selectedElement();
    if (!el) return;
    // Un jugador de Plantilla nunca se duplica visualmente: se bloquea con aviso.
    if (el.t === 'player' && el.playerId) {
      this.notify('No se puede duplicar un jugador de la plantilla: ya está en el campo.');
      return;
    }
    this.beginHistory();
    this.addElement({ ...translateElement(el, 0.04, 0.04), id: uid() });
    this.endHistory();
  }

  /** Gira el elemento seleccionado EXACTAMENTE ±90° (un paso) como UNA acción de
   *  historial. Se usa desde la barra de contexto (botones ±90°). */
  protected rotateSelected(deg: 90 | -90): void {
    const el = this.selectedElement();
    if (!el || el.locked) return;
    this.editSelected({ rot: normalizeRotation((el.rot ?? 0) + deg) });
  }

  private selCenter(el: CanvasElement): { x: number; y: number } {
    return selCenter(el);
  }

  /** Asas/nasas de selección (SVG) del elemento seleccionado. Fase 6: se RETIRA la manija
   *  de rotación continua (la rotación pasa a la barra de contexto, ±90°) y las asas de
   *  redimensionado se dibujan MÁS PEQUE�'AS (1.2�-1.2 u de viewBox) manteniendo un área
   *  táctil mayor en el gesto (`resizeHandleAt` usa una tolerancia de 0.045 norm). Solo
   *  se dibujan en el campo en vivo: export/miniatura no pasan `handles`. */
  private handlesSvg(): string {
    if (this.tool() !== 'select') return '';
    const ids = this.selectedIds();
    if (ids.length === 0) return '';
    let s = '';
    for (const id of ids) {
      const el = this.view().find((e) => e.id === id);
      if (el) s += this.outlineSvg(el);
    }
    const last = this.selectedElement();
    if (last) {
      for (const rh of resizeHandles(last, this.geo().rect)) {
        s += `<rect class="reshandle" x="${this.px(rh.x) - 0.6}" y="${this.py(rh.y) - 0.6}" width="1.2" height="1.2" fill="#ffffff" stroke="#2563eb" stroke-width="${SEL_HANDLE_STROKE}"/>`;
      }
    }
    return `<g>${s}</g>`;
  }

  private resizeHandleAt(el: CanvasElement, p: { x: number; y: number }): string | null {
    const tol = 0.045;
    for (const h of resizeHandles(el, this.geo().rect)) {
      if (Math.hypot(p.x - h.x, p.y - h.y) < tol) return h.key;
    }
    return null;
  }

  private outlineSvg(el: CanvasElement): string {
    return elementOutline(el, this.geo().rect);
  }

  protected removeSelected(): void {
    const ids = this.selectedIds().filter((id) => {
      const el = this.view().find((e) => e.id === id);
      return !!el && !el.locked;
    });
    if (ids.length === 0) {
      // Si había elementos seleccionados pero todos bloqueados, informar del porqué
      // (de lo contrario el botón "Eliminar" parecería no hacer nada).
      const anyLocked = this.selectedIds().some((id) => {
        const el = this.view().find((e) => e.id === id);
        return !!el && el.locked;
      });
      if (anyLocked) this.notify('Elemento bloqueado: desbloquéalo desde Propiedades para eliminarlo.');
      return;
    }
    this.beginHistory();
    for (const id of ids) this.removeElement(id);
    this.endHistory();
    this.clearSelection();
  }

  protected clearAll(): void {
    this.confirmSvc.ask({
      title: 'Vaciar pizarra',
      message: 'Se eliminarán todos los elementos del campo.',
      confirmLabel: 'Vaciar',
      onConfirm: () => {
        this.beginHistory();
        this.frames.set(this.frames().map((f) => ({ ...f, elements: [] })));
        this.endHistory();
        this.selectedId.set(null);
      },
    });
  }

  // ---------- Guardar / exportar ----------

  protected buildDoc(): CanvasDocument {
    return {
      version: 2,
      schemaVersion: CANVAS_SCHEMA_VERSION,
      field: this.field(),
      frames: this.frames(),
      orientation: this.orientation(),
      backgroundColor: this.bgColor(),
      lineColor: this.lineColor(),
      grass: this.grass(),
      grid: this.fieldGrid(),
      guide: this.guide(),
      f7: this.f7(),
    };
  }

  protected async saveToExercise(navigate = true): Promise<boolean> {
    this.saving.set(true);
    this.saved.set(false);
    const teamId = this.store.activeTeam()?.id;
    if (!teamId) {
      this.notify('Crea un equipo antes de guardar ejercicios.');
      this.saving.set(false);
      return false;
    }
    const min = this.metaMinPlayers();
    const max = this.metaMaxPlayers();
    if (min != null && max != null && min > max) {
      this.notify('El número mínimo de jugadores no puede ser mayor que el máximo.');
      this.saving.set(false);
      return false;
    }
    const doc = this.buildDoc();
    let thumbnail: string | null = null;
    try {
      thumbnail = await generateThumbnail(doc);
    } catch {
      thumbnail = null; // la miniatura no debe bloquear el guardado
    }
    try {
      if (this.editExerciseId) {
        const existing = this.store.exercises().find((e) => e.id === this.editExerciseId);
        if (!existing) {
          this.notify('No se encontró el ejercicio a actualizar. Reintenta o vuelve a la biblioteca.');
          this.saving.set(false);
          return false; // no navegar, no limpiar dirty
        }
        this.store.saveExercise({
          ...existing,
          title: this.metaTitle() || this.title(),
          description: this.metaDescription(),
          explanation: this.metaExplanation(),
          category: this.metaCategory(),
          objectives: existing?.objectives ?? [],
          materials: this.metaMaterials(),
          durationMinutes: this.metaDuration(),
          minPlayers: this.metaMinPlayers(),
          maxPlayers: this.metaMaxPlayers(),
          folderId: this.metaFolder(),
          canvas: doc,
          thumbnail: thumbnail ?? existing.thumbnail,
          savedAt: new Date().toISOString(),
        });
      } else {
        const ex: Exercise = {
          id: uid(),
          teamId,
          folderId: this.metaFolder(),
          title: this.metaTitle() || this.title(),
          description: this.metaDescription(),
          explanation: this.metaExplanation(),
          category: this.metaCategory(),
          objectives: [],
          materials: this.metaMaterials(),
          durationMinutes: this.metaDuration(),
          minPlayers: this.metaMinPlayers(),
          maxPlayers: this.metaMaxPlayers(),
          loadMode: 'fixed',
          seriesCount: null,
          repetitionsCount: null,
          workSeconds: null,
          restSeconds: null,
          isTemplate: false,
          canvas: doc,
          thumbnail,
          savedAt: new Date().toISOString(),
        };
        this.store.saveExercise(ex);
      }
    } catch (err) {
      // No abandonar ni limpiar el estado sucio si falla la persistencia.
      this.notify('No se pudo guardar el ejercicio. Revisa el almacenamiento del navegador e inténtalo de nuevo.');
      this.saving.set(false);
      return false;
    }
    this.saving.set(false);
    this.saved.set(true);
    this.sessionSvc.setDirty(false);
    this.sessionSvc.close();
    if (navigate) setTimeout(() => this.router.navigate(['/library']), 250);
    return true;
  }

  protected async exportPng(): Promise<void> {
    const g = this.geo();
    const w = g.vbW >= g.vbH ? 1600 : 1280;
    const h = g.vbW >= g.vbH ? 1280 : 1600;
    const svg = await inlineSvgAssets(
      renderBoardSvg(this.field(), this.view(), {
        backgroundColor: this.bgColor(),
        lineColor: this.lineColor(),
        orientation: this.orientation(),
        grid: this.fieldGrid(),
        guide: this.guide(),
        grass: this.grass(),
      }).replace(
        'class="entrenolab-board"',
        `width="${w}" height="${h}" class="entrenolab-board"`
      )
    );
    const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    img.src = svgUrl;
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      setTimeout(() => resolve(img.naturalWidth > 0), 3000);
    });
    if (!loaded) {
      this.notify('No se pudo generar la imagen PNG. Reintenta.');
      return; // nunca descargar una imagen vacía
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'cdmplab-pizarra.png';
    a.click();
  }

  // ---------- Interacción ----------

  onPointerDown(evt: PointerEvent): void {
    evt.preventDefault();
    // Captura el puntero para que los movimientos sigan llegando aunque el dedo/ratón
    // salga del host. Con un pointerId sintético (e2e que despachan PointerEvents a
    // mano) setPointerCapture puede lanzar; sin captura el gesto sigue siendo usable.
    try {
      (evt.currentTarget as HTMLElement).setPointerCapture?.(evt.pointerId);
    } catch {
      /* setPointerCapture no disponible/no válido: no bloquea el gesto */
    }
    // Registrar el puntero activo (independientemente de la herramienta).
    this.activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, type: evt.pointerType });

    // SEGUNDO DEDO táctil: descartar la gestión pendiente/en curso del primer dedo
    // (sin colocar/seleccionar/mover nada) y empezar el PINCH. SOLO dos punteros
    // táctiles inician un pinch: un mouse/pen acompañando a un dedo NO cuenta.
    if (evt.pointerType === 'touch' && this.activeTouchCount() === 2) {
      this.cancelLongPress(); // un segundo dedo cancela la pulsación larga (sin duplicar)
      this.cancelTouchGesture();
      this.cancelSinglePointerGestures();
      this.beginPinch();
      return;
    }
    // 3+ dedos TÁCTILES: solo registrar. El pinch usa los dos primeros fijos y se ignoran
    // el resto (no colocar, no editar, no transferir el pinch al tercer dedo).
    if (evt.pointerType === 'touch' && this.activeTouchCount() > 2) return;

    // TÁCTIL: el primer dedo crea una GESTI�"N PENDIENTE y NO ejecuta la acción
    // (colocar/seleccionar/mover). Se confirma al levantar (tap) o al superar el
    // umbral (arrastre), y se DESCARTAla si llega un segundo dedo.
    if (evt.pointerType === 'touch') {
      this.beginTouchPending(evt);
      return;
    }

    // Mouse / lápiz: comportamiento inmediato (se ejecuta en el propio pointerdown).
    this.beginSinglePointerDown(evt.clientX, evt.clientY, this.toNorm(evt), evt.shiftKey, evt.pointerId);
  }

  /** Ejecuta la acción de UN puntero al BAJAR (colocar/seleccionar/empezar a mover/
   *  dibujar/rotar/redimensionar/patear). `clientX/clientY` son las de PANTALLA y `p`
   *  la normalizada del MISMO punto: así un gesto táctil diferido puede arrancar desde
   *  el punto ORIGINAL de bajada en vez del punto al que ya se movió. */
  private beginSinglePointerDown(clientX: number, clientY: number, p: { x: number; y: number }, shift: boolean, pointerId: number): void {
    // Fase 3: cualquier interacción sobre el campo cierra el menú contextual (tocar fuera).
    this.closeCtxMenu();
    // Fase 1: al colocar/dibujar sobre el campo se cierran los menús solapados.
    if (this.tool() !== 'select' && this.tool() !== 'hand') this.closeAllPanels();

    switch (this.tool()) {
      case 'hand': {
        // La herramienta "Mano" PANEA la vista al arrastrar EN CUALQUIER punto, incluso
        // si el puntero baja sobre un objeto: nunca selecciona/mueve/redimensiona/
        // duplica/elimina nada. Un tap (sin arrastrar) solo limpia la selección.
        this.clearSelection();
        this.panGestureStart = { x: clientX, y: clientY, panX: this.panX(), panY: this.panY() };
        this.panMoved = false;
        this.handDragging.set(false);
        break;
      }
      case 'select': {
        const selEl = this.selectedElement();
        // Asas de redimensionado del elemento seleccionado (la rotación continua se
        // retira en la Fase 6: ahora es ±90° desde la barra de contexto).
        const rKey = selEl ? this.resizeHandleAt(selEl, p) : null;
        if (selEl && rKey && !selEl.locked) {
          this.beginHistory();
          this.resizing = true;
          this.resizeKey = rKey;
          this.moveStart = { x: p.x, y: p.y };
          this.resizeStartSize = selEl.t !== 'text' && this.isPointLike(selEl.t) ? (selEl.size ?? materialSize(selEl)) : null;
          this.resizeStartPoints = selEl.t === 'freehand' ? ((selEl.points ?? []) as [number, number][]) : null;
          break;
        }
        // Los elementos bloqueados siguen siendo SELECCIONABLES (para poder
        // desbloquearlos desde el inspector), pero no se mueven/editan/borran.
        const hit = hitTestElement(p, this.view(), this.geo().rect);
        if (hit) {
          if (shift) {
            this.toggleSelect(hit);
            // Sólo arma un posible arrastre si el elemento sigue seleccionado.
            if (this.isSelected(hit)) {
              this.movingIds = this.unlockedSelectedIds();
              this.moveStart = { x: p.x, y: p.y };
            } else {
              this.movingIds = [];
              this.moveStart = null;
            }
          } else if (this.isSelected(hit) && this.selectedIds().length > 1) {
            // Parte de una multiselección: NO colapsar; mover todo el grupo.
            this.movingIds = this.unlockedSelectedIds();
            this.moveStart = { x: p.x, y: p.y };
          } else {
            this.setSingleSelection(hit);
            this.movingIds = this.unlockedSelectedIds();
            this.moveStart = { x: p.x, y: p.y };
          }
          this.moveGestureBegun = false;
          // Fase 7: pulsación larga sobre un objeto �?' DUPLICAR (si se mantiene sin
          // moverse). Se arma en el pointerdown para medir el tiempo desde la bajada.
          this.startLongPress(pointerId, clientX, clientY, hit);
        } else if (!shift) {
          // Vacío (ni objeto ni asa): limpiar selección, y registrar el inicio de un
          // posible PANEO. Si el puntero se mueve (onPointerMove), se panea la vista
          // (descubrir campo oculto); si suelta sin moverse, fue solo un click (nada más).
          this.clearSelection();
          this.panGestureStart = { x: clientX, y: clientY, panX: this.panX(), panY: this.panY() };
          this.panMoved = false;
        }
        break;
      }
      case 'player':
      case 'player_rival':
      case 'ball':
      case 'cone':
      case 'mannequin':
      case 'minigoal':
      case 'pole':
      case 'marker':
      case 'hurdle':
      case 'ring':
      case 'ladder':
      case 'flag':
      case 'trampoline':
      case 'target':
      case 'net':
      case 'vball':
      case 'coachC':
      case 'peto':
      case 'chaleco':
      case 'bosu':
      case 'fitball':
      case 'pica':
        this.beginHistory();
        const armedBefore = this.armed();
        const id = armedBefore?.player ? this.placePlayerElement(p, armedBefore.player) : this.addAt(p);
        this.endHistory();
        if (id && !armedBefore?.player) this.setSingleSelection(id);
        // Colocación única: tras emplazar se DESARMA y pasa a Seleccionar.
        this.armed.set(null);
        this.setTool('select');
        break;
      case 'text':
        this.beginHistory();
        const rid = this.addAt(p);
        this.endHistory();
        if (rid) {
          this.setSingleSelection(rid);
          this.textFocusId.set(rid); // enfoca la edición del texto recién creado
          setTimeout(() => this.textEditorEl()?.nativeElement.focus(), 0);
        }
        this.armed.set(null);
        this.setTool('select');
        break;
      case 'arrow':
      case 'doubleArrow':
      case 'measure':
      case 'line':
      case 'rect':
      case 'ellipse':
      case 'curve_left':
      case 'curve_right':
      case 'zone':
      case 'dribble':
      case 'freehand':
        this.beginHistory();
        this.drag.set({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        this.freehandPts = [[p.x, p.y]];
        break;
      case 'erase': {
        this.beginHistory();
        const hit = hitTestElement(p, this.unlockedView(), this.geo().rect);
        if (hit) this.removeElement(hit);
        this.endHistory();
        break;
      }
    }
  }

  // ---------- Gestión táctil (dedo único �?" pinch) ----------

  /** Cablea el toque táctil inicial: en vez de ejecutar la acción, guarda la "gestión
   *  pendiente" con todo lo necesario para confirmar un tap, arrancar el arrastre o
   *  descartarla. El documento NO se modifica todavía. */
  private beginTouchPending(evt: PointerEvent): void {
    const p = this.toNorm(evt);
    const tool = this.tool();
    const armed = this.armed();
    const shift = evt.shiftKey;

    // Como en el comportamiento inmediato, tocar el campo con una herramienta (no
    // Seleccionar) cierra los menús solapados. Es un efecto de vista, no de modelo.
    if (tool !== 'select') this.closeAllPanels();

    this.touchPending = {
      pointerId: evt.pointerId,
      startClient: { x: evt.clientX, y: evt.clientY },
      startNorm: p,
      tool,
      armed,
      shift,
      plan: this.computeTouchPlan(p, tool, armed, shift),
      restore: this.captureTouchRestore(),
      movedDist: 0,
      begun: false,
    };
    this.maybeStartTouchLongPress(this.touchPending);
  }

  /** Arma una pulsación larga (Fase 7) de un dedo táctil que baja SOBRE un objeto con la
   *  herramienta "Seleccionar": el temporizador se mide desde la BAJADA (no desde que se
   *  empieza a mover). Si el dedo se mueve, se levanta, llega un segundo dedo o se
   *  cancela el gesto, se aborta. Solo aplica a los planes que tocan un objeto. */
  private maybeStartTouchLongPress(gp: TouchPending): void {
    if (gp.tool !== 'select') return;
    if (gp.plan.kind !== 'selectMove' && gp.plan.kind !== 'selectMultiShift' && gp.plan.kind !== 'moveGroup') return;
    const hit = gp.plan.kind === 'moveGroup' ? hitTestElement(gp.startNorm, this.view(), this.geo().rect) : gp.plan.hitId;
    if (hit) this.startLongPress(gp.pointerId, gp.startClient.x, gp.startClient.y, hit);
  }

  /** Decide QU�? hará el gesto de un dedo, sin ejecutarlo aún (solo lo clasifica). */
  private computeTouchPlan(p: { x: number; y: number }, tool: Tool, armed: ArmedPlacement | null, shift: boolean): TouchPlan {
    switch (tool) {
      case 'select': {
        const selEl = this.selectedElement();
        const rKey = selEl ? this.resizeHandleAt(selEl, p) : null;
        if (selEl && rKey && !selEl.locked) {
          return { kind: 'resize', elId: selEl.id, key: rKey };
        }
        const hit = hitTestElement(p, this.view(), this.geo().rect);
        if (hit) {
          // Con shift SIEMPRE es un toggle (añade/quita de la selección); en el arrastre
          // el comportamiento de `beginSinglePointerDown` decide si además se mueve.
          if (shift) return { kind: 'selectMultiShift', hitId: hit };
          if (this.isSelected(hit) && this.selectedIds().length > 1) return { kind: 'moveGroup' };
          return { kind: 'selectMove', hitId: hit };
        }
        return shift ? { kind: 'none' } : { kind: 'pan' };
      }
      case 'erase': {
        const hit = hitTestElement(p, this.unlockedView(), this.geo().rect);
        return hit ? { kind: 'erase', hitId: hit } : { kind: 'none' };
      }
      case 'hand':
        // "Mano": cualquier toque (sobre objeto o vacío) PANEA; nunca selecciona/mueve.
        return { kind: 'pan' };
      default:
        return PLACEMENT_TOOLS.has(tool) ? { kind: 'place' } : { kind: 'draw' };
    }
  }

  /** Captura el estado EXACTO (documento/vista/selección/historial/sucio) previo al gesto. */
  private captureTouchRestore(): TouchRestore {
    return {
      frames: JSON.parse(JSON.stringify(this.frames())) as CanvasFrame[],
      selectedIds: this.selectedIds(),
      selectedId: this.selectedId(),
      panelOpen: this.panelOpen(),
      tool: this.tool(),
      armed: this.armed(),
      zoom: this.zoom(),
      panX: this.panX(),
      panY: this.panY(),
      dirty: this.dirty(),
      saved: this.saved(),
      history: this.history.capture(),
    };
  }

  /** Restaura el documento, la vista, la selección y el historial EXACTAMENTE como
   *  estaban antes del gesto táctil, sin confirmar (endHistory) ninguna modificación. */
  private restoreTouchState(r: TouchRestore): void {
    this.frames.set(r.frames);
    this.selectedIds.set(r.selectedIds);
    this.selectedId.set(r.selectedId);
    this.panelOpen.set(r.panelOpen);
    this.tool.set(r.tool);
    this.armed.set(r.armed);
    this.zoom.set(r.zoom);
    this.panX.set(r.panX);
    this.panY.set(r.panY);
    this.sessionSvc.setDirty(r.dirty);
    this.saved.set(r.saved);
    // Limpiar cualquier gesto de un dedo a medio hacer (sin commit: tras restaurar el
    // documento, gestureBase == frames y endHistory es un no-op).
    this.cancelSinglePointerGestures();
    // Devolver el historial a su estado previo (deshacer/rehacer como antes del gesto).
    this.history.restore(r.history);
  }

  /** Descarta la gestión táctil (llega un segundo dedo, se cancela el gesto o se sale
   *  del host). Si el dedo YA HABÍA comenzado una modificación, se restaura el modelo
   *  exacto; si solo estaba pendiente (aún sin ejecutar), no hay nada que restaurar. */
  private cancelTouchGesture(): void {
    const gp = this.touchPending;
    if (!gp) return;
    this.touchPending = null;
    if (gp.begun) this.restoreTouchState(gp.restore);
  }

  // ---------- Pulsación larga �?' DUPLICAR (Fase 7) ----------

  /** Empieza la cuenta atrás de una pulsación larga sobre el objeto `targetId`. Un solo
   *  temporizador a la vez; cancelar uno anterior no afecta a nada (solo lo reemplaza). */
  private startLongPress(pointerId: number, clientX: number, clientY: number, targetId: string | null): void {
    this.cancelLongPress(pointerId);
    if (targetId == null) return;
    this.lp = { pointerId, start: { x: clientX, y: clientY }, targetId, fired: false };
    this.lpTimer = setTimeout(() => this.commitLongPress(), this.LONG_PRESS_MS);
  }

  /** Cancela la pulsación larga (por movimiento, levantamiento, segundo dedo, cancel�?�).
   *  `pointerId` null cancela LAQUE SEA; si se pasa, solo la de ese puntero. */
  private cancelLongPress(pointerId?: number | null): void {
    if (this.lp && (pointerId == null || this.lp.pointerId === pointerId)) {
      if (this.lpTimer) {
        clearTimeout(this.lpTimer);
        this.lpTimer = null;
      }
      this.lp = null;
    }
  }

  /** Temporizador cumplido: la pulsación larga abre el MEN�s CONTEXTUAL del objeto
   *  (Fase 3) �?" ya NO duplica. Selecciona el elemento y muestra el menú compacto. */
  private commitLongPress(): void {
    this.lpTimer = null;
    const lp = this.lp;
    if (!lp || lp.fired) return;
    // El puntero ya se levantó/canceló: no abrir el menú.
    if (!this.activePointers.has(lp.pointerId)) {
      this.lp = null;
      return;
    }
    const el = this.view().find((e) => e.id === lp.targetId);
    if (!el) {
      this.lp = null;
      return;
    }
    lp.fired = true;
    this.consumeLongPressGesture(lp.pointerId);
    // Seleccionar el objeto y abrir el menú contextual (sin duplicar ni mover).
    this.setSingleSelection(el.id);
    this.ctxMenuOpen.set(true);
    this.lp = null;
  }

  /** Consume la gestión pendiente del gesto (para que el pointerup NO re-ejecute un tap ni
   *  un arrastre sobre el original) y limpia cualquier estado de un dedo a medio hacer. */
  private consumeLongPressGesture(pointerId: number): void {
    const gp = this.touchPending;
    if (gp && gp.pointerId === pointerId) this.touchPending = null;
    this.movingIds = [];
    this.moveStart = null;
    this.moveGestureBegun = false;
    this.panGestureStart = null;
    this.panMoved = false;
    this.overTrash = false;
    this.handDragging.set(false);
  }

  /** ¿Puede duplicarse un elemento? Genéricos, materiales, textos, líneas y figuras SÍ;
   *  un jugador de plantilla (`playerId`) NO (invariante de instancia única). */
  private canDuplicateElement(el: CanvasElement): boolean {
    return !!el && !el.locked && !(el.t === 'player' && !!el.playerId);
  }

  /** Duplica un elemento (quien llama ya debe haber enviado el aviso del roster/no-duplicable).
   *  Devuelve la id de la copia (independiente, con id nueva y desplazada) o null. Crea UNA
   *  única entrada de undo y marca sucio. */
  private duplicateElementEl(el: CanvasElement): string | null {
    if (!this.canDuplicateElement(el)) return null;
    const dup = { ...translateElement(el, 0.05, 0.05), id: uid() };
    this.beginHistory();
    this.addElement(dup);
    this.endHistory();
    return dup.id;
  }

  /** Al superar el umbral de movimiento, convierte la gestión pendiente en el gesto
   *  real de UN dedo (panear/mover/rotar/redimensionar/dibujar), arrancando desde el
   *  punto ORIGINAL de bajada. Colocación/borrado (acciones de TAP) se cancelan. */
  private beginTouchGesture(gp: TouchPending): void {
    const k = gp.plan.kind;
    if (k === 'place' || k === 'erase' || k === 'none') return; // el arrastre cancela: no coloca/borra
    this.beginSinglePointerDown(gp.startClient.x, gp.startClient.y, gp.startNorm, gp.shift, gp.pointerId);
  }

  /** Confirma un TAP táctil (se levantó sin superar el umbral y con un solo dedo):
   *  ejecuta la acción de UN toque �?" colocar/crear texto, seleccionar, deseleccionar
   *  o borrar �?" igual que hacía el pointerdown inmediato, pero en el pointerup. */
  private commitTouchTap(gp: TouchPending, upEvt: PointerEvent): void {
    if (gp.plan.kind === 'none') return;
    const p = this.toNorm(upEvt);
    const plan = gp.plan;
    if (plan.kind === 'place') {
      if (gp.tool === 'text') {
        this.beginHistory();
        const rid = this.addAt(p);
        this.endHistory();
        if (rid) {
          this.setSingleSelection(rid);
          this.textFocusId.set(rid); // enfoca la edición del texto recién creado
          setTimeout(() => this.textEditorEl()?.nativeElement.focus(), 0);
        }
        this.armed.set(null);
        this.setTool('select');
      } else {
        this.beginHistory();
        const armedBefore = gp.armed;
        const id = armedBefore?.player ? this.placePlayerElement(p, armedBefore.player) : this.addAt(p);
        this.endHistory();
        if (id && !armedBefore?.player) this.setSingleSelection(id);
        // Colocación única: tras emplazar se DESARMA y pasa a Seleccionar.
        this.armed.set(null);
        this.setTool('select');
      }
    } else if (plan.kind === 'selectMove') {
      const id = hitTestElement(p, this.view(), this.geo().rect);
      if (id) this.setSingleSelection(id);
    } else if (plan.kind === 'selectMultiShift') {
      const id = hitTestElement(p, this.view(), this.geo().rect);
      if (id) this.toggleSelect(id);
    } else if (plan.kind === 'pan') {
      this.clearSelection();
    } else if (plan.kind === 'erase') {
      const id = hitTestElement(p, this.unlockedView(), this.geo().rect);
      if (id) {
        this.beginHistory();
        this.removeElement(id);
        this.endHistory();
      }
    }
    // moveGroup / rotate / resize / draw �?' un tap NO hace nada (son gestos de arrastre).
  }


  onPointerMove(evt: PointerEvent): void {
    // Actualizar la posición del puntero activo (base del cálculo del pinch).
    if (this.activePointers.has(evt.pointerId)) {
      this.activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, type: evt.pointerType });
    }
    // PINCH (los dos participantes fijos): SOLO zoom anclado al punto medio. No mover/
    // rotar/redimensionar objetos, no panear más allá de mantener el ancla, no crear nada.
    // El movimiento de un TERCER dedo no afecta: updatePinch solo usa los participantes.
    if (this.pinching) {
      this.updatePinch();
      return;
    }
    const p = this.toNorm(evt);
    // Fase 7: si el puntero de la pulsación larga se mueve más de la tolerancia, se cancela
    // (un arrastre antes del tiempo NO duplica; pasa a mover/panear con normalidad).
    if (this.lp && evt.pointerId === this.lp.pointerId) {
      const d = Math.hypot(evt.clientX - this.lp.start.x, evt.clientY - this.lp.start.y);
      if (d > this.LONG_PRESS_SLOP) this.cancelLongPress(evt.pointerId);
    }
    // TÁCTIL: mientras el dedo esté PENDIENTE (aún sin superar el umbral) NO ejecuta nada.
    // Al superar el umbral se CONVIERTE en el gesto real de un dedo (panear/mover/dibujar�?�)
    // y deja que el bloque de abajo aplique el movimiento desde el ORIGEN de la bajada.
    const gp = this.touchPending;
    if (evt.pointerType === 'touch' && gp && gp.pointerId === evt.pointerId) {
      gp.movedDist = Math.max(gp.movedDist, Math.hypot(evt.clientX - gp.startClient.x, evt.clientY - gp.startClient.y));
      if (!gp.begun) {
        if (gp.movedDist > this.TOUCH_TAP_SLOP) {
          gp.begun = true;
          this.beginTouchGesture(gp);
          // caer al bloque de gesto de un puntero de abajo para aplicar el desplazamiento actual
        } else {
          return; // aún pendiente: no colocar/seleccionar/mover nada
        }
      }
    }
    // PANEO: si empezó un gesto de paneo (campo vacío en Modo Seleccionar) y el puntero
    // se mueve, se aplica el desplazamiento (clamp al rango del contenido). No interfiere
    // con el movimiento de elementos: panGestureStart solo se fija si NO se tocó un objeto.
    if (this.panGestureStart) {
      const dx = evt.clientX - this.panGestureStart.x;
      const dy = evt.clientY - this.panGestureStart.y;
      if (!this.panMoved && Math.hypot(dx, dy) > 4) this.panMoved = true;
      this.handDragging.set(this.panMoved);
      if (this.panMoved) {
        const xr = this.panRange();
        const yr = this.panRangeY();
        this.panX.set(Math.max(xr.min, Math.min(xr.max, this.panGestureStart.panX + dx)));
        this.panY.set(Math.max(yr.min, Math.min(yr.max, this.panGestureStart.panY + dy)));
      }
      return;
    }
    if (this.drag()) {
      const d = this.drag()!;
      this.drag.set({ ...d, x1: p.x, y1: p.y });
      if (this.tool() === 'freehand') this.freehandPts.push([p.x, p.y]);
      return;
    }
    if (this.movingIds.length && this.moveStart) {
      const dx = p.x - this.moveStart.x;
      const dy = p.y - this.moveStart.y;
      // Un clic y soltar sin desplazar es solo selección: NO crea entrada de undo.
      if (dx !== 0 || dy !== 0) {
        if (!this.moveGestureBegun) {
          this.beginHistory();
          this.moveGestureBegun = true;
        }
        this.moveElements(this.movingIds, dx, dy);
        this.moveStart = { x: p.x, y: p.y };
      }
      // Actualizar el estado "sobre la papelera" durante el ARRASTRE (antes no se
      // actualizaba porque el bloque devolvía antes de llegar a la línea final).
      this.overTrash = this.isOverTrash(evt);
      return;
    }
    if (this.resizing && this.resizeKey) {
      const id = this.selectedId();
      const el = id ? this.view().find((e) => e.id === id) : undefined;
      if (el) this.applyResize(el, this.resizeKey, p);
    }
    this.overTrash = this.isOverTrash(evt);
  }

  private isOverTrash(evt: PointerEvent): boolean {
    const el = this.trashEl()?.nativeElement;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return evt.clientX >= r.left && evt.clientX <= r.right && evt.clientY >= r.top && evt.clientY <= r.bottom;
  }

  private applyResize(el: CanvasElement, key: string, p: { x: number; y: number }): void {
    const t = el.t;
    if (t === 'rect' || t === 'zone' || t === 'ellipse' || t === 'text') {
      let x = el.x ?? 0;
      let y = el.y ?? 0;
      let w = el.w ?? 0.05;
      let h = el.h ?? 0.05;
      if (key === 'tl' || key === 'bl') w = Math.max(0.02, (el.x ?? 0) + (el.w ?? 0) - p.x);
      if (key === 'tr' || key === 'br') w = Math.max(0.02, p.x - (el.x ?? 0));
      if (key === 'tl' || key === 'tr') h = Math.max(0.02, (el.y ?? 0) + (el.h ?? 0) - p.y);
      if (key === 'bl' || key === 'br') h = Math.max(0.02, p.y - (el.y ?? 0));
      if (key === 'tl') {
        x = p.x;
        y = p.y;
      }
      if (key === 'bl') {
        x = p.x;
        y = el.y ?? 0;
      }
      if (key === 'tr') y = p.y;
      if (key === 'tl' || key === 'bl') x = this.clamp01(x);
      if (key === 'tr' || key === 'br') x = el.x ?? 0;
      if (key === 'tl') y = this.clamp01(y);
      let patch: Partial<CanvasElement> = { x, y, w, h };
      if (t === 'text') {
        // Redimensionar con el asa fija el cuadro (ya no auto-crece).
        patch.autoH = false;
        // Mantener el cuadro dentro del campo (sin desbordar por la derecha/abajo).
        const fx = Math.max(0, Math.min(1 - w, x));
        const fy = Math.max(0, Math.min(1 - h, y));
        patch = { x: fx, y: fy, w, h, autoH: false };
      }
      this.updateElement(el.id, patch);
    } else if (t === 'line' || t === 'arrow' || t === 'curve' || t === 'doubleArrow' || t === 'measure' || t === 'dribble') {
      if (key === 'x1') this.updateElement(el.id, { x1: this.clamp01(p.x), y1: this.clamp01(p.y) });
      else if (key === 'x2') this.updateElement(el.id, { x2: this.clamp01(p.x), y2: this.clamp01(p.y) });
      else if (key === 'c1') this.updateElement(el.id, { c1x: this.clamp01(p.x), c1y: this.clamp01(p.y) });
    } else if (t === 'freehand') {
      // Escala PROPORCIONAL del trazo desde sus esquinas: se reescala la nube de
      // puntos alrededor del centro del bbox original guardado al empezar.
      const pts0 = this.resizeStartPoints;
      if (pts0 && pts0.length) {
        const xs = pts0.map((pt) => pt[0]);
        const ys = pts0.map((pt) => pt[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const d0 = Math.hypot(maxX - cx, maxY - cy) || 1;
        const d = Math.hypot(p.x - cx, p.y - cy);
        const s = Math.max(0.15, Math.min(8, d / d0));
        const scaled = pts0.map(([px2, py2]) => [
          Math.max(0, Math.min(1, cx + (px2 - cx) * s)),
          Math.max(0, Math.min(1, cy + (py2 - cy) * s)),
        ] as [number, number]);
        this.updateElement(el.id, { points: scaled });
      }
    } else if (this.isPointLike(t)) {
      // Escala UNIFORME de un material/jugador desde sus esquinas (persistida en `size`).
      const size0 = this.resizeStartSize ?? (el.size ?? materialSize(el));
      const r = this.geo().rect;
      const cx = el.x ?? 0;
      const cy = el.y ?? 0;
      const { hw, hh } = pointLikeResizeHalf(size0, r);
      const d0 = Math.hypot(hw, hh) || 1;
      const d = Math.hypot(p.x - cx, p.y - cy);
      const size = Math.max(0.4, Math.min(6, size0 * (d / d0)));
      this.updateElement(el.id, { size });
    }
  }

  onPointerUp(evt?: PointerEvent): void {
    // Retirar el puntero liberado del mapa de activos.
    if (evt && evt.pointerId != null) {
      this.activePointers.delete(evt.pointerId);
    }
    // Fase 7: soltar el puntero aborta cualquier pulsación larga pendiente (un click
    // normal nunca duplica; el temporizador se descarta).
    this.cancelLongPress(evt?.pointerId ?? null);
    // Si el pinch estaba activo y se levanta UNO de los dos participantes, terminar el
    // pinch SIN transferirlo al tercer dedo: el zoom/pan quedan exactamente como estaban
    // (sin salto de zoom ni de pan). Cubre pointerup / pointercancel / lostpointercapture.
    if (
      this.pinching &&
      evt &&
      evt.pointerId != null &&
      (evt.pointerId === this.pinchIdA || evt.pointerId === this.pinchIdB)
    ) {
      this.resetPinch();
    }
    // Por seguridad, si ya NO quedan 2 dedos táctiles, el pinch no puede seguir vivo.
    if (this.pinching && this.activeTouchCount() < 2) {
      this.resetPinch();
    }
    // Mientras siga el pinch con sus dos participantes, sigue vivo: no finalizar como gesto
    // de un dedo (el dedo restante, o un tercer dedo, no retoma un pan/movimiento de objeto).
    if (this.pinching) return;

    // TÁCTIL: liberar el dedo de su gestión pendiente/en curso.
    const gp = this.touchPending;
    if (evt?.pointerType === 'touch' && gp && gp.pointerId === evt.pointerId) {
      this.touchPending = null;
      if (!gp.begun && gp.movedDist <= this.TOUCH_TAP_SLOP && this.activeTouchCount() === 0) {
        // TAP confirmado (no superó el umbral, un solo dedo): ejecutar la acción de toque.
        this.commitTouchTap(gp, evt);
        return;
      }
      if (!gp.begun) return; // se movió más del umbral sin llegar a empezar: cancelar (nada)
      // gp.begun �?' caer a la finalización estándar (commitDrag / endHistory).
    }

    // Finalizar cualquier gesto de paneo (arrastre sobre campo vacío).
    this.panGestureStart = null;
    this.panMoved = false;
    const dragVal = this.drag();
    if (dragVal) {
      this.commitDrag(dragVal);
      // Herramientas de dibujo de un solo uso: tras crear, volver a Seleccionar.
      this.setTool('select');
    }
    // Soltar sobre la papelera elimina el/los objetos movidos.
    if (this.movingIds.length && this.isOverTrash(evt ?? ({} as PointerEvent))) {
      if (!this.moveGestureBegun) {
        this.beginHistory();
        this.moveGestureBegun = true;
      }
      this.removeElements(this.movingIds);
    }
    if (dragVal || this.moveGestureBegun || this.rotating || this.resizing) this.endHistory();
    this.drag.set(null);
    this.movingIds = [];
    this.moveGestureBegun = false;
    this.moveStart = null;
    this.resizing = false;
    this.resizeKey = null;
    this.resizeStartSize = null;
    this.resizeStartPoints = null;
    this.rotating = false;
    this.rotCenter = null;
    this.overTrash = false;
    this.handDragging.set(false);
  }

  /** El navegador cancela el gesto táctil (p. ej. scroll del sistema): NO confirmar un
   *  tap ni dejar un arrastre fantasma. Si el dedo ya estaba modificando, se restaura. */
  onPointerCancel(evt: PointerEvent): void {
    this.cancelLongPress(evt.pointerId);
    const gp = this.touchPending;
    if (evt?.pointerType === 'touch' && gp && gp.pointerId === evt.pointerId) {
      this.touchPending = null;
      if (gp.begun) this.restoreTouchState(gp.restore);
    }
    // Un BORRADOR de dibujo en curso (mouse/pen/táctil ya convertido, p. ej. el
    // sistema roba el puntero) se CANCELA, no se confirma: no entra nada al documento.
    if (this.drag()) this.cancelDraft();
    this.onPointerUp(evt);
  }

  /** Se pierde la captura del puntero: no confirmar un tap ni dejar estados colgados.
   *  (normalmente llega después del pointerup, que ya resolvió la gestión). */
  onLostPointerCapture(evt: PointerEvent): void {
    this.cancelLongPress(evt.pointerId);
    const gp = this.touchPending;
    if (evt?.pointerType === 'touch' && gp && gp.pointerId === evt.pointerId) {
      this.touchPending = null;
      if (gp.begun) this.restoreTouchState(gp.restore);
    }
    if (this.drag()) this.cancelDraft();
    this.onPointerUp(evt);
  }

  /** Si un dedo táctil sale del host sin haber empezado un gesto, NO confirmamos un
   *  tap (evita colocar un elemento fantasma en el borde); un gesto de arrastre ya
   *  comenzado lo cierra onPointerUp (commit, igual que en mouse/pen). */
  onPointerLeave(evt: PointerEvent): void {
    this.cancelLongPress(evt.pointerId);
    const gp = this.touchPending;
    if (evt.pointerType === 'touch' && gp && gp.pointerId === evt.pointerId && !gp.begun) {
      this.touchPending = null;
    }
    this.onPointerUp(evt);
  }

  // ---------- Estado de elementos ----------

  private addElement(el: CanvasElement): void {
    this.frames.set(addElementToFrames(this.frames(), el));
  }

  private removeElement(id: string): void {
    this.frames.set(removeElementFromFrames(this.frames(), id));
  }

  private removeElements(ids: string[]): void {
    for (const id of ids) this.removeElement(id);
  }

  private moveElements(ids: string[], dx: number, dy: number): void {
    if (!ids.length) return;
    this.frames.set(moveElementsInFrame(this.frames(), this.current(), ids, dx, dy));
  }

  private unlockedSelectedIds(): string[] {
    return this.selectedIds().filter((id) => {
      const el = this.view().find((e) => e.id === id);
      return !!el && !el.locked;
    });
  }

  private addAt(p: { x: number; y: number }): string | null {
    const t = this.tool();
    let el: CanvasElement | null = null;
    const materialKind = (tool: string): TacticalKind => this.materialVariant()[tool] ?? this.defaultKindFor(tool);
    const withMaterial = (e: CanvasElement, tool: string): CanvasElement => {
      const kind = materialKind(tool);
      const a = tacticAsset(kind);
      // size base normalizado del tipo: así cada material nace con un tamaño
      // coherente (pértiga/escalera/portería mayores que cono/diana) y el modelo
      // lo persiste (Save/reabrir/duplicar lo conservan).
      if (a) return { ...e, size: materialBaseSize(kind), asset: a.asset, assetKind: kind };
      return { ...e, size: materialBaseSize(kind) };
    };
    switch (t) {
      case 'player':
        el = { id: uid(), t: 'player', x: p.x, y: p.y, n: this.nextNumber(), c: '#1a73e8', side: 'own' };
        break;
      case 'player_rival':
        el = { id: uid(), t: 'player', x: p.x, y: p.y, n: 0, c: '#c0392b', side: 'rival' };
        break;
      case 'ball':
        el = withMaterial({ id: uid(), t: 'ball', x: p.x, y: p.y, c: '#ffffff' }, 'ball');
        break;
      case 'cone':
        el = withMaterial({ id: uid(), t: 'cone', x: p.x, y: p.y, c: '#f9ab00' }, 'cone');
        break;
      case 'mannequin':
        el = withMaterial({ id: uid(), t: 'mannequin', x: p.x, y: p.y, c: '#e8edf2' }, 'mannequin');
        break;
      case 'minigoal':
        el = withMaterial({ id: uid(), t: 'minigoal', x: p.x, y: p.y, c: '#ffffff' }, 'minigoal');
        break;
      case 'pole':
        el = withMaterial({ id: uid(), t: 'pole', x: p.x, y: p.y, c: '#ffffff' }, 'pole');
        break;
      case 'marker':
        el = withMaterial({ id: uid(), t: 'marker', x: p.x, y: p.y, c: '#ffffff' }, 'marker');
        break;
      case 'hurdle':
        el = withMaterial({ id: uid(), t: 'hurdle', x: p.x, y: p.y, c: '#ffffff' }, 'hurdle');
        break;
      case 'ring':
        el = withMaterial({ id: uid(), t: 'ring', x: p.x, y: p.y, c: '#ffffff' }, 'ring');
        break;
      case 'ladder':
        el = withMaterial({ id: uid(), t: 'ladder', x: p.x, y: p.y, c: '#ffffff' }, 'ladder');
        break;
      case 'flag':
        el = withMaterial({ id: uid(), t: 'flag', x: p.x, y: p.y, c: '#f6c945' }, 'flag');
        break;
      case 'trampoline':
        el = withMaterial({ id: uid(), t: 'trampoline', x: p.x, y: p.y, c: '#e8edf2' }, 'trampoline');
        break;
      case 'target':
        el = withMaterial({ id: uid(), t: 'target', x: p.x, y: p.y, c: '#e74c3c' }, 'target');
        break;
      case 'net':
        el = withMaterial({ id: uid(), t: 'net', x: p.x, y: p.y, c: '#e74c3c' }, 'net');
        break;
      case 'vball':
        el = withMaterial({ id: uid(), t: 'vball', x: p.x, y: p.y, c: '#c98ab0' }, 'vball');
        break;
      case 'coachC':
        el = { id: uid(), t: 'coachC', x: p.x, y: p.y, c: '#e6b800', size: materialBaseSize('coachC') };
        break;
      case 'peto':
        el = { id: uid(), t: 'peto', x: p.x, y: p.y, c: '#f6c945', size: materialBaseSize('peto') };
        break;
      case 'chaleco':
        el = { id: uid(), t: 'chaleco', x: p.x, y: p.y, c: '#e74c3c', size: materialBaseSize('chaleco') };
        break;
      case 'bosu':
        el = { id: uid(), t: 'bosu', x: p.x, y: p.y, c: '#3056d3', size: materialBaseSize('bosu') };
        break;
      case 'fitball':
        el = { id: uid(), t: 'fitball', x: p.x, y: p.y, c: '#e67e22', size: materialBaseSize('fitball') };
        break;
      case 'pica':
        el = { id: uid(), t: 'pica', x: p.x, y: p.y, c: '#ffffff', size: materialBaseSize('pica') };
        break;
      case 'rect':
        el = { id: uid(), t: 'rect', x: p.x, y: p.y, w: 0.12, h: 0.1, c: 'rgba(255,255,255,0.10)' };
        break;
      case 'text': {
        // Colocar el cuadro SIN desbordar el campo: si toca el borde derecho/inferior,
        // se desplaza hacia dentro para que el cuadro por defecto quepa entero.
        let x = this.clamp01(p.x);
        let y = this.clamp01(p.y);
        if (x + DEFAULT_TEXT_W > 1) x = Math.max(0, 1 - DEFAULT_TEXT_W);
        if (y + DEFAULT_TEXT_H > 1) y = Math.max(0, 1 - DEFAULT_TEXT_H);
        el = { id: uid(), t: 'text', x, y, v: 'Texto', size: DEFAULT_TEXT_SIZE, w: DEFAULT_TEXT_W, h: DEFAULT_TEXT_H };
        break;
      }
      default:
        return null;
    }
    this.addElement(el as CanvasElement);
    return (el as CanvasElement).id;
  }

  private commitDrag(d: { x0: number; y0: number; x1: number; y1: number }): void {
    const t = this.tool();
    // Fase 5 �?" un clic SIN movimiento NO debe crear una línea/shape invisible:
    // si los dos extremos están prácticamente juntos, el borrador se descarta.
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 0.004) return;
    const col = this.drawColor();
    if (t === 'arrow') {
      this.addElement({ id: uid(), t: 'arrow', x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, style: 'solid', c: col, strokeWidth: DEFAULT_STROKE_WIDTH });
    } else if (t === 'doubleArrow') {
      this.addElement({ id: uid(), t: 'doubleArrow', x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, style: 'solid', c: col, strokeWidth: DEFAULT_STROKE_WIDTH });
    } else if (t === 'measure') {
      this.addElement({ id: uid(), t: 'measure', x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, v: '15 m', style: 'solid', c: col, strokeWidth: DEFAULT_STROKE_WIDTH });
    } else if (t === 'dribble') {
      this.addElement({ id: uid(), t: 'dribble', x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, c: col, strokeWidth: DEFAULT_STROKE_WIDTH });
    } else if (t === 'line') {
      this.addElement({ id: uid(), t: 'line', x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, c: col, strokeWidth: DEFAULT_STROKE_WIDTH });
    } else if (t === 'rect' || t === 'ellipse') {
      const fill = this.shapeFill();
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      if (w < 0.004 || h < 0.004) return; // no crear una figura de grosor/caída cero
      this.addElement({ id: uid(), t, x, y, w, h, c: col, fill, fillColor: col, fillOpacity: this.fillOpacity() });
    } else if (t === 'curve_left' || t === 'curve_right') {
      // Fase 5: dos curvaturas opuestas, mismo ElementType 'curve' (puntos de control
      // con signo opuesto). curve_left se dobla hacia un lado y curve_right al contrario.
      const bend = t === 'curve_left' ? -0.14 : 0.14;
      this.addElement({
        id: uid(),
        t: 'curve',
        x1: d.x0,
        y1: d.y0,
        x2: d.x1,
        y2: d.y1,
        c1x: (d.x0 + d.x1) / 2,
        c1y: (d.y0 + d.y1) / 2 + bend,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'freehand') {
      // Un borrador de mano alzada necesita al menos 2 puntos distintos.
      if (this.freehandPts.length < 2) return;
      const pts = this.freehandPts;
      this.addElement({ id: uid(), t: 'freehand', points: pts, c: col, strokeWidth: DEFAULT_STROKE_WIDTH });
    } else if (t === 'zone') {
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      if (w < 0.004 || h < 0.004) return; // no crear una zona de grosor cero
      this.addElement({
        id: uid(),
        t: 'zone',
        x: Math.min(d.x0, d.x1),
        y: Math.min(d.y0, d.y1),
        w: Math.abs(d.x1 - d.x0),
        h: Math.abs(d.y1 - d.y0),
        c: col,
        fill: this.shapeFill(),
      });
    }
    this.freehandPts = [];
  }

  private previewStr(d: { x0: number; y0: number; x1: number; y1: number }): string {
    const t = this.tool();
    const g = this.geo().rect;
    // Antes de mover, el borrador es un PUNTO: se dibuja un pequeño ancla para que el
    // inicio del trazo sea visible desde el pointerdown (Fase 5). En cuanto hay
    // desplazamiento, la preview pasa a ser la forma real = la que se confirmará.
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 0.004) {
      const ax = d.x0 * g.w + g.x;
      const ay = d.y0 * g.h + g.y;
      return `<circle cx="${ax}" cy="${ay}" r="1.1" fill="${this.drawColor()}"/>`;
    }
    if (t === 'arrow') return this.svgLine(d.x0, d.y0, d.x1, d.y1, 'end', this.drawColor());
    if (t === 'doubleArrow') return this.svgLine(d.x0, d.y0, d.x1, d.y1, 'both', this.drawColor());
    if (t === 'dribble') return svgZigzag(d.x0, d.y0, d.x1, d.y1, this.drawColor(), false, DEFAULT_STROKE_WIDTH, 'solid', g);
    if (t === 'line') return this.svgLine(d.x0, d.y0, d.x1, d.y1, 'none', this.drawColor());
    if (t === 'curve_left' || t === 'curve_right') {
      const bend = t === 'curve_left' ? -0.14 : 0.14;
      const cxd = (d.x0 + d.x1) / 2;
      const cyd = (d.y0 + d.y1) / 2 + bend;
      const x1 = d.x0 * g.w + g.x;
      const y1 = d.y0 * g.h + g.y;
      const cx = cxd * g.w + g.x;
      const cy = cyd * g.h + g.y;
      const x2 = d.x1 * g.w + g.x;
      const y2 = d.y1 * g.h + g.y;
      const c = this.drawColor();
      const w = DEFAULT_STROKE_WIDTH;
      let s = `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
      const ang = Math.atan2(y2 - cy, x2 - cx);
      const size = arrowHeadSize(w);
      s += `<polygon points="${x2},${y2} ${x2 - size * Math.cos(ang - 0.5)},${y2 - size * Math.sin(ang - 0.5)} ${x2 - size * Math.cos(ang + 0.5)},${y2 - size * Math.sin(ang + 0.5)}" fill="${c}"/>`;
      return s;
    }
    if (t === 'freehand') {
      const pts = this.freehandPts.length ? this.freehandPts : [[d.x0, d.y0], [d.x1, d.y1]];
      const p = pts.map(([pxx, pyy]) => `${pxx * g.w + g.x},${pyy * g.h + g.y}`).join(' ');
      return `<polyline points="${p}" fill="none" stroke="${this.drawColor()}" stroke-width="${DEFAULT_STROKE_WIDTH}"/>`;
    }
    if (t === 'rect' || t === 'ellipse' || t === 'zone') {
      const x = Math.min(d.x0, d.x1) * g.w + g.x;
      const y = Math.min(d.y0, d.y1) * g.h + g.y;
      const w = Math.abs(d.x1 - d.x0) * g.w;
      const h = Math.abs(d.y1 - d.y0) * g.h;
      const col = this.drawColor();
      // Fase 10: relleno del mismo color que el perímetro.
      const fillColor = col;
      const fillOpacity = this.fillOpacity() ?? 0.16;
      const fill = this.shapeFill() ? this.withAlpha(fillColor, fillOpacity) : 'none';
      const stroke = col;
      return t === 'ellipse'
        ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${DEFAULT_SHAPE_STROKE}"/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${DEFAULT_SHAPE_STROKE}"/>`;
    }
    return '';
  }

  private svgLine(x1: number, y1: number, x2: number, y2: number, arrow: 'none' | 'end' | 'both', color: string): string {
    const g = this.geo().rect;
    const ax1 = x1 * g.w + g.x;
    const ay1 = y1 * g.h + g.y;
    const ax2 = x2 * g.w + g.x;
    const ay2 = y2 * g.h + g.y;
    let s = `<line x1="${ax1}" y1="${ay1}" x2="${ax2}" y2="${ay2}" stroke="${color}" stroke-width="${DEFAULT_STROKE_WIDTH}"/>`;
    const size = arrowHeadSize(DEFAULT_STROKE_WIDTH);
    if (arrow === 'end' || arrow === 'both') {
      const ang = Math.atan2(ay2 - ay1, ax2 - ax1);
      const p1 = `${ax2 - size * Math.cos(ang - 0.5)},${ay2 - size * Math.sin(ang - 0.5)}`;
      const p2 = `${ax2 - size * Math.cos(ang + 0.5)},${ay2 - size * Math.sin(ang + 0.5)}`;
      s += `<polygon points="${ax2},${ay2} ${p1} ${p2}" fill="${color}"/>`;
    }
    if (arrow === 'both') {
      const ang = Math.atan2(ay1 - ay2, ax1 - ax2);
      const p1 = `${ax1 - size * Math.cos(ang - 0.5)},${ay1 - size * Math.sin(ang - 0.5)}`;
      const p2 = `${ax1 - size * Math.cos(ang + 0.5)},${ay1 - size * Math.sin(ang + 0.5)}`;
      s += `<polygon points="${ax1},${ay1} ${p1} ${p2}" fill="${color}"/>`;
    }
    return s;
  }

  private nextNumber(): number {
    const used = new Set(this.view().filter((e) => e.t === 'player').map((e) => e.n ?? 0));
    for (let i = 1; i <= 99; i++) {
      if (!used.has(i)) return i;
    }
    return 0;
  }

  private isPointLike(t: string): boolean {
    return isPointLikeFn(t);
  }

  /** true si el tipo pertenece a la categoría Material (Fase 1: sin redimensionado). */
  protected isMaterialType(t: string): boolean {
    return isMaterialFn(t);
  }
}
