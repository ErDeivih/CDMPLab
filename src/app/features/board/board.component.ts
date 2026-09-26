import {
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  ElementRef,
  HostListener,
  ChangeDetectorRef,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { StoreService, uid } from '../../core/store.service';
import {
  CanvasDocument,
  CanvasElement,
  CanvasFrame,
  FieldType,
  Player,
  Position,
  Exercise,
  ExerciseCategory,
  EXERCISE_CATEGORIES,
  F7Overlay,
} from '../../core/models';
import {
  FIELD_RECT,
  FIELD_BASE_SPECS,
  fieldGeometry,
  fieldPreviewSvg,
  fieldObjectScale,
  orientationLabel,
} from '../../core/field';
import {
  tacticAsset,
  materialAsset,
  TacticalKind,
  materialBaseSize,
} from '../../core/tactic-assets';
import {
  renderBoardSvg,
  hitTestElement,
  textColor as textColorFn,
  svgZigzag,
  screenToNorm,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_W,
  DEFAULT_TEXT_H,
  autoTextBoxH,
  normalizedToPct,
  pctToNormalized,
  parseLocalizedNumber,
  clampNorm,
  fitTextToContent,
  Geometry,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_SHAPE_STROKE,
  MIN_STROKE_WIDTH,
  MAX_STROKE_WIDTH,
  arrowHeadSize,
  materialSize,
  MATERIAL_BOX,
  SEL_HANDLE_STROKE,
  MARGIN_STRIP,
  screenPxToNormTolerance,
  DEFAULT_ELEMENT_COLOR,
  COLORABLE_ELEMENT_TYPES,
  FIXED_UPRIGHT_TYPES,
  // Patrón del trazo discontinuo: FUENTE ÚNICA compartida con el render. Estaba copiado a mano aquí
  // (`2.4,0.7`), así que cambiar el del render dejaba la previsualización con otro patrón.
  DASH_PATTERN,
} from '../../core/render';
import { colorName, colorNamePlural } from '../../core/color-name';
import { generateThumbnail } from '../../core/canvas-export';
import { inlineSvgAssets } from '../../core/asset-inline';
import { BoardSessionService } from '../../core/board-session.service';
import {
  FORMATIONS as FORMATIONS_PURE,
  buildFormationPlayers,
  Formation,
  QUICK_GENERIC_COLORS,
} from './formations';
import { ConfirmService } from '../../core/confirm.service';
import { HistoryService, HistorySnapshot } from '../../core/history.service';
import { normalizeCanvas, CANVAS_SCHEMA_VERSION } from '../../core/canvas';
import {
  AVISO_SIN_BLOQUEO,
  debeAdaptarAutomaticamente,
  orientacionDeseada,
  puedeIntentarBloqueo,
  type CapacidadesPantalla,
  type OrientacionCampo,
} from '../../core/screen-orientation';
import {
  PALETA_JUGADOR,
  colorDeJugador,
  conColorDeJugador,
  fichasDeJugador,
  normalizarMapaColores,
  pintarFichasDeJugador,
  type MapaColoresJugador,
} from '../../core/player-colors';
import {
  addElementToFrames,
  removeElementFromFrames,
  moveElementsInFrame,
  updateElementInFrames,
  layerShiftFrames,
  translateElement,
} from './board-doc';
// (CORRECCIÓN URGENTE: se retiran los imports de `field-transform` —
// `transformFramesHalfToFull`, `transformFramesFullToHalf`, `mapFramesToTwoHalves`— porque el
// cambio de campo ya NO transforma coordenadas: conserva las de cada elemento tal cual. Las
// funciones siguen en `core/field-transform.ts`, con sus unitarias, para documentos antiguos.)
import { pngFileName } from '../../core/sanitize-file-name';
import {
  selCenter,
  elementOutline,
  isPointLike as isPointLikeFn,
  isMaterial as isMaterialFn,
  resizeHandles,
  normalizeRotation,
  pointLikeResizeHalf,
} from './board-selection';
import { ExportDialogComponent } from './export-dialog.component';
import { visibleMaterials, CANONICAL_MATERIALS } from '../../core/material-registry';

type Tool =
  | 'select'
  | 'hand'
  | 'player'
  | 'ball'
  | 'cone'
  | 'mannequin'
  | 'minigoal'
  | 'goal'
  | 'pole'
  | 'marker'
  | 'hurdle'
  | 'ring'
  | 'dumbbell'
  | 'mannequin_row'
  | 'ladder_yellow'
  | 'ring_flat'
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
 *  colocarla de inmediato. Dibujo (arrastre) y Erase quedan fuera.
 *  FASE F: los materiales se derivan de los IDs VISIBLES del registro canónico
 *  (no se repiten a mano); solo se añaden aquí las puntuales no materiales
 *  (player/text). */
const PLACEMENT_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'player',
  'text',
  ...visibleMaterials().map((m) => m.id as Tool),
]);

/** Spec de un jugador a colocar (jugador de plantilla o genérico). SIN `side`/`type` en los
 *  genéricos (la diferenciación es por color); los reales de plantilla conservan su
 *  `side`/`type` para compatibilidad de documento. */
interface PlayerPlacement {
  n?: number; // dorsal (si no, se usa nextNumber)
  c: string;
  side?: 'own' | 'rival';
  type?: 'player' | 'goalkeeper' | 'neutral';
  playerId?: string; // jugador de Plantilla (no duplicable)
  label?: string;
}

/** Emplazamiento ARMADO: se muestra "Toca el campo para colocar a X" y el
 *  siguiente clic sobre el campo lo coloca. Sin emplazamiento armado el clic
 *  sobre el campo no crea nada (y Escape vuelve a Seleccionar). */
type ArmedPlacement = {
  tool: Tool; // categoría activa ('player' | material | 'text')
  label: string; // nombre mostrado en la pista
  player?: PlayerPlacement; // solo para colocación de jugadores
};

/** Unidad arrastrable desde un catálogo persistente hasta el campo. */
interface PanelDragSpec {
  tool: Tool;
  label: string;
  player?: PlayerPlacement; // solo jugadores (genéricos o de plantilla)
}

interface ToolDef {
  id: Tool;
  icon: string;
  title: string;
  group?: string; // grupo visual dentro de la categoría Material
}

/** Qué hará el gesto de UN dedo táctil, calculado al bajar el puntero. Se usa
 *  para decidir la acción del TAP (colocar/seleccionar/borrar) vs la del ARRASTRE
 *  (mover/rotar/redimensionar/patear/dibujar) vs la CANCELACIÓN del pinch. */
type TouchPlan =
  | { kind: 'place' }
  | { kind: 'selectMove'; hitId: string } // tocar un objeto: tap=seleccionar, arrastre=mover
  | { kind: 'selectMultiShift'; hitId: string } // shift/objeto no seleccionado: toggle + mover
  | { kind: 'moveGroup' } // objeto ya seleccionado dentro de una multiselección
  | { kind: 'pan' } // campo vacío con Mano: tap=deseleccionar, arrastre=panear
  | { kind: 'deselect' } // campo vacío con Seleccionar: tap=deseleccionar, arrastre NO panea
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
  history: HistorySnapshot<BoardSnapshot>;
}

/** La "gestión pendiente" del primer dedo táctil: guarda todo lo necesario para
 *  confirmar un tap, arrancar un arrastre desde el ORIGEN o descartar sin efectos. */
interface TouchPending {
  pointerId: number;
  /** Posición de PANTALLA (client) del punto de bajada. */
  startClient: { x: number; y: number };
  /** Posición normalizada del punto de bajada. */
  startNorm: { x: number; y: number };
  /** `timeStamp` del EVENTO de bajada (reloj del navegador), para medir gestos por el
   *  tiempo del gesto y no por cuándo llegó a ejecutarse el manejador. */
  stamp: number;
  tool: Tool;
  armed: ArmedPlacement | null;
  shift: boolean;
  plan: TouchPlan;
  /** Instantánea EXACTA para restaurar al cancelar con un segundo dedo. */
  restore: TouchRestore;
  /** Distancia MÁXIMA (px) recorrida desde la bajada (para el umbral de tap). */
  movedDist: number;
  /** El dedo ya superó el umbral y el gesto de UN DEDO ha comenzado (mover/dibujar...). */
  begun: boolean;
}

// Herramientas PROPIAS de la aplicación (no materiales). Los materiales se derivan del
// registro canónico (material-registry.ts → `MATERIALS`); aquí NO se vuelve a enumerar
// ningún material para no duplicar la fuente (FASE F).
export const TOOLS: ToolDef[] = [
  { id: 'select', icon: 'near_me', title: 'Seleccionar y mover' },
  { id: 'hand', icon: 'pan_tool', title: 'Desplazar campo' },
  { id: 'player', icon: 'person', title: 'Jugador' },
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

/** Paleta de la pizarra. `#ffffff` (blanco) se añadió al FINAL para que el color por
 *  defecto (`DEFAULT_ELEMENT_COLOR`) sea una muestra seleccionable y el control de color
 *  marque la activa. Añadir al final, nunca reordenar: hay pruebas E2E que eligen la
 *  muestra por ÍNDICE, y reordenar cambiaría el color que eligen sin avisar. */
export const PALETTE = [
  '#1a73e8',
  '#c0392b',
  '#1f7a4d',
  '#e67e22',
  '#7d3c98',
  '#b8860b',
  '#111111',
  '#f4f4f4',
  '#facc15',
  '#f97316',
  '#ef4444',
  '#22c55e',
  '#06b6d4',
  '#a855f7',
  '#ec4899',
  '#d1d5db',
  '#ffffff',
];

/** Margen (px) que se deja entre la barra de contexto y los bordes del host. */
const CONTEXT_BAR_MARGIN = 8;

/** Hueco (px) entre la barra de contexto y el objeto seleccionado. */
const CONTEXT_BAR_GAP = 8;

/** Catálogo de Material del panel, DERIVADO del registro canónico (material-registry.ts,
 *  `visibleMaterials`). Fuente única (FASE F): id/título/grupo/icono; NO se mantiene una
 *  lista MATERIALS manual duplicada. Los retirados (`hidden`) no aparecen. */
export const MATERIALS: ToolDef[] = visibleMaterials().map((m) => ({
  id: m.id as Tool,
  icon: m.icon ?? 'category',
  title: m.title,
  group: m.group,
}));

/** Título visible de una herramienta. Para los materiales consulta el catálogo canónico
 *  (`MATERIALS`, derivado del registro); para el resto (selección/mano/jugador/dibujo)
 *  consulta `TOOLS`. Fuente única: un material SIEMPRE se resuelve desde el registro. */
function toolTitle(id: Tool): string {
  return MATERIALS.find((m) => m.id === id)?.title ?? TOOLS.find((t) => t.id === id)?.title ?? '';
}

/** Ayuda de las herramientas propias de la app (no materiales): selección, mano, jugador
 *  y el dibujo. Los MATERIALES NO se listan aquí (ver `toolHintFor`). */
const APP_TOOL_HINTS: Partial<Record<Tool, string>> = {
  select:
    'Selecciona y mueve elementos (arrastra para mover; la rueda hace zoom; la rotación ±90° desde la barra de contexto)',
  hand: 'Arrastra para desplazar el campo (pellizca con dos dedos para acercar)',
  player: 'Clic para colocar un jugador',
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

/** Texto de ayuda de una herramienta.
 *
 *  Los MATERIALES lo toman del REGISTRO canónico (`help`): así un material nuevo tiene
 *  ayuda sin tocar ninguna lista. Antes había aquí un mapa con los 22 materiales escritos
 *  a mano, de modo que un material añadido al registro se quedaba SIN ayuda (y el texto
 *  podía divergir del registrado). Se incluyen también los RETIRADOS (`hidden`), porque
 *  sus documentos antiguos siguen abriéndose.
 *
 *  Función PURA y exportada: la prueba unitaria comprueba que toda herramienta tiene
 *  texto sin necesidad de instanciar el componente. */
export function toolHintFor(id: Tool): string {
  const material = CANONICAL_MATERIALS.find((m) => m.id === id);
  if (material) return `Clic para colocar: ${material.help}`;
  return APP_TOOL_HINTS[id] ?? '';
}

const MATERIAL_GROUPS = [
  'Balones',
  'Señalización',
  'Porterías y redes',
  'Coordinación',
  'Preparación física',
  'Otros',
] as const;

/** id de herramienta → grupo al que pertenece (para agrupar el panel de Material).
 *  Se deriva del REGISTRO CANÓNICO (`visibleMaterials`) para no mantener el grupo a mano
 *  (fuente ÚNICA). El orden de grupos lo define MATERIAL_GROUPS. */
const MATERIAL_GROUP_MAP: Record<string, string> = Object.fromEntries(
  visibleMaterials().map((m) => [m.id, m.group]),
);

/** Formaciones rápidas (Fase 7): posiciones normalizadas 0..1 (espacio canónico) del
 *  equipo PROPIO atacando hacia la derecha. Para el rival se refleja la X (1-x).
 *  Cada formación es de 11 jugadores (portero + 10); se colocan los disponibles y, si
 *  faltan, se informa sin bloquear. */
// Formaciones tácticas: la data y la geometría viven en el módulo PURO `formations.ts`
// (probable unitariamente). Aquí solo se referencia para mantener la API del componente.
const FORMATIONS: Formation[] = FORMATIONS_PURE as Formation[];

/** A3: snapshot de documento para el historial. Incluye campo, orientación y frames para
 *  que un Undo/Redo de un cambio de campo restaure conjuntamente todo el estado visible. */
interface BoardSnapshot {
  field: FieldType;
  orientation: 'horizontal' | 'vertical';
  frames: CanvasFrame[];
}

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
  // A3: el historial guarda un SNAPSHOT de documento (campo + orientación + frames) para
  // que un Undo/Redo de un cambio de campo restaure conjuntamente campo y elementos.
  private readonly history = inject(HistoryService<BoardSnapshot>);
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
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
  protected readonly materialGroupList = computed<Array<{ label: string; items: ToolDef[] }>>(
    () => {
      const q = this.normalizeFx(this.materialQuery());
      const matTools = MATERIALS; // FASE F: catálogo del panel derivado del registro, sin duplicar TOOLS.
      return MATERIAL_GROUPS.map((g) => ({
        label: g,
        items: matTools.filter(
          (t) => MATERIAL_GROUP_MAP[t.id] === g && (!q || this.normalizeFx(t.title).includes(q)),
        ),
      })).filter((g) => g.items.length > 0);
    },
  );

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
    // FASE 3: elegir categoría cierra el menú «Herramientas». El menú flota sobre la
    // banda inferior del campo; si siguiera abierto, taparía la colocación de objetos
    // cerca del borde inferior (lo midió la prueba «objeto en borde inferior»).
    this.herramientasOpen.set(false);
    this.panelCat.set(c);
  }
  protected closeToolPanel(): void {
    this.panelCat.set(null);
    this.olvidarMinimizado();
    // El panel es un overlay que tapa el campo: al elegir una herramienta hay que
    // retirarlo ANTES del siguiente clic (que coloca el elemento). Forzamos la
    // detección de cambios para que Angular no lo deje en el DOM un tick más.
    this.cdr.detectChanges();
  }
  /** Criterio coherente de "pizarra compacta" (Fase 1). Cubre móvil en VERTICAL
   *  (360×800, 390×844, 430×932) y en HORIZONTAL (teléfono girado: 800×360, 844×390,
   *  932×430), sin perjudicar tabletas ni escritorio. La app (aquí) y el CSS usan
   *  el MISMO criterio: ancho corto (<=700) o altura corta (<=480) con ancho <=1000.
   *  NO es suficiente mirar solo el ancho (un móvil girado mide 844px de ancho). */
  protected isCompactViewport(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 700) return true; // vertical
    if (h <= 480 && w <= 1000) return true; // horizontal (girado)
    return false;
  }

  protected activeToolTitle(): string {
    return toolTitle(this.tool());
  }
  protected readonly toolGroups: Array<{
    id: 'jugadores' | 'material' | 'dibujo';
    label: string;
    items: ToolDef[];
  }> = [
    { id: 'jugadores', label: 'Jugadores', items: [] },
    {
      id: 'material',
      label: 'Material',
      items: MATERIALS, // FASE F: derivado del registro canónico (visibleMaterials), no de TOOLS.
    },
    {
      id: 'dibujo',
      label: 'Dibujo y formas',
      // Derivado de `TOOLS` por EXCLUSIÓN (fuente única): así una herramienta nueva
      // aparece sola en el panel. Antes era una lista de 10 ids escrita a mano, y por eso
      // "Borrar elemento" (`erase`) existía en TOOLS pero NO se ofrecía en ninguna parte.
      items: TOOLS.filter((t) => !['select', 'hand', 'player'].includes(t.id)),
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
  /** Fase 4 (previsulización junto al cursor): posición de pantalla (client) del puntero
   *  cuando hay un emplazamiento armado de jugador genérico o material. `null` = ocultar. */
  protected readonly cursorScreen = signal<{ x: number; y: number } | null>(null);

  /** Posición del cursor RELATIVA al host (px), o null si no hay preview. */
  protected readonly previewPos = computed<{ x: number; y: number } | null>(() => {
    const c = this.cursorScreen();
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!c || !hostEl) return null;
    const r = hostEl.getBoundingClientRect();
    return { x: c.x - r.left, y: c.y - r.top };
  });

  /** Previsualización del objeto armado (SVG de un jugador o un material) para mostrar
   *  junto al cursor. NO forma parte del documento: no se guarda ni se exporta. */
  protected readonly armedPreviewHtml = computed<SafeHtml>(() => {
    const a = this.armed();
    const c = this.cursorScreen();
    if (!a || a.tool === 'text' || !c) return this.sanitizer.bypassSecurityTrustHtml('');
    const size = 44; // px aproximado del tamaño real con que aparecerá en el campo
    let html: string;
    if (a.player) {
      const col = a.player.c ?? (a.player.side === 'rival' ? '#c0392b' : '#1a73e8');
      const isGk = a.player.type === 'goalkeeper';
      const label = isGk ? 'POR' : a.player.n != null && a.player.n > 0 ? String(a.player.n) : '';
      const ring = isGk ? ' stroke="#fff" stroke-width="1" stroke-dasharray="2,1.4"' : '';
      html = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" fill="${col}"${ring}></circle>
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="700" fill="#fff">${label || ''}</text>
      </svg>`;
    } else {
      // Material: imagen PNG real o fallback SVG circular.
      const kind = this.materialVariant()[a.tool] ?? this.defaultKindFor(a.tool);
      const asset = kind ? tacticAsset(kind) : undefined;
      if (asset?.asset) {
        html = `<img src="${asset.asset}" style="width:${size}px;height:${size}px;object-fit:contain" alt="">`;
      } else {
        const col = asset?.color ?? '#e8edf2';
        html = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
          <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" fill="${col}"></circle>
        </svg>`;
      }
    }
    // Contenido 100 % generado por el estado de la app (colores/assets constantes, dorsal
    // numérico/POR): no hay HTML de usuario, así que se marca como seguro para que Angular
    // NO lo sancione (evita el aviso "sanitizing HTML stripped some content").
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });
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
  // CORRECCIÓN URGENTE (dueño): el cambio de campo es DIRECTO y no deja estado pendiente.
  //
  // Antes aquí vivían `fieldChangePlan`, `fieldDialogOpen`, `decideFieldChange()` y
  // `applyFieldChange()`: al pasar de un campo completo a uno de media extensión CON objetos,
  // `setField` guardaba un plan, abría el diálogo «Cambiar a medio campo» y TERMINABA con
  // `return` SIN cambiar el campo. Ese diálogo pendiente era el que dejaba la pizarra bloqueada:
  // el primer cambio podía funcionar y los siguientes parecían no hacer nada hasta insistir.
  // Se retiran el plan, el diálogo, sus tres opciones («Dos medios campos», «Encajar todo»,
  // «Mantener los objetos») y las transformaciones de coordenadas asociadas.
  /** Id de texto recién insertado para enfocar su edición. */
  protected readonly textFocusId = signal<string | null>(null);
  protected readonly orientation = signal<'horizontal' | 'vertical'>('horizontal');

  protected setOrientation(o: 'horizontal' | 'vertical'): void {
    this.orientation.set(o);
    // Igual que al cambiar de campo: girar la orientación cambia la forma del campo (una mitad
    // vertical es mucho más ancha que alta), así que en «ver campo completo» se vuelve al
    // encuadre neutro para que el campo siga viéndose entero.
    if (!this.fillScreen()) this.resetView();
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
    // Pedido del dueño: «Ver campo completo» (el modo llenar se apaga) tiene que mostrar el
    // campo ENTERO de verdad. Antes solo cambiaba el modo, así que un zoom de rueda >100 %
    // seguía recortando el campo — y en un medio campo VERTICAL (más ancho que alto) no había
    // forma de verlo completo. Al pasar a ver-completo se restablece también zoom y paneo.
    if (!next) this.resetView();
    // La pista de recorrido se muestra la primera vez que se actíva el modo Llenar
    // pantalla (por defecto en móvil o al alternar aquí). Solo aparece una vez.
    if (next) this.maybeShowFillHint();
  }

  /** Ancho (px) del canvas en modo llenar pantalla (null → usa el CSS 100%).
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
  // En llenar pantalla el campo se escala con `fillScale` = COVER (max(hostH/dimVert,
  // hostW/dimHor)): cubre el host usando la dimensión que más tamaño da, así que desborda
  // por el otro eje (el host lo recorta con overflow:hidden) y hay contenido oculto que solo
  // se ve paneando. `screenToNorm` usa la MISMA escala COVER (fix D1), así que pantalla↔norm
  // son inversas exactas. Estos rangos y banderas impulsan dos indicadores discretos
  // (chevrones) en los bordes del host y se desvanecen al alcanzar el extremo correspondiente.
  // En "Campo completo" (contain) el campo cabe entero; no hay pan y no se muestran
  // indicadores.
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
   *  Se panea a IZQUIERDA (-panX) para revelarlo; desaparece al llegar al extremo. */
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
  /** La vista tiene zoom o paneo aplicados (ya no es el encuadre neutro). Sirve para ofrecer
   *  el botón «Volver al encuadre» SOLO cuando hace falta: el dueño pidió poder hacer zoom y
   *  poder deshacerlo, y con la rueda el zoom podía dejarse puesto sin forma evidente de
   *  volver a ver el campo entero (sobre todo en un medio campo vertical). */
  protected readonly vistaAlterada = computed(
    () =>
      Math.abs(this.zoom() - 1) > 0.001 ||
      Math.abs(this.panX()) > 0.5 ||
      Math.abs(this.panY()) > 0.5,
  );
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
  /**
   * Etiqueta única del botón Guardar (icono + `aria-label` + región viva). El dueño pidió
   * retirar la franja `.field-status` que comía altura del campo, así que el estado de guardado
   * se comunica desde el botón que ya existía en vez de en una fila propia.
   */
  protected readonly estadoGuardado = computed(() =>
    this.saving() ? 'Guardando…' : this.saved() ? 'Guardado' : 'Guardar',
  );
  // Fase 1: el campo es el protagonista. El panel de Propiedades (derecha) empieza
  // CERRADO (incluso en escritorio); se abre desde su disparador o al seleccionar.
  protected readonly panelOpen = signal(false);
  /** Panel de Jugadores (izquierda): plantilla + genéricos + herramientas de jugador. */
  protected readonly jugadoresOpen = signal(false);
  /** Menú "Exportar" (arriba). */
  protected readonly exportMenuOpen = signal(false);
  /** Menú "Más" (arriba): Limpiar pizarra. La opción "Ayuda" fue retirada por el dueño. */
  protected readonly masOpen = signal(false);
  /** FASE 3 — menú «Herramientas» del grupo flotante.
   *
   *  La barra inferior ocupaba 57 px de LAYOUT (medido: `.studio-main` 289 px en 844×390).
   *  Se sustituye por un grupo flotante anclado a la esquina inferior izquierda que NO
   *  ocupa layout, de modo que el campo llega al borde inferior. Las tres categorías
   *  (Jugadores/Material/Dibujo) viven en este menú, cerrado por defecto para no tapar el
   *  campo: al elegir categoría se cierra solo, así que la banda inferior queda libre para
   *  colocar objetos (la prueba «objeto en borde inferior» de FASE I coloca en x=centro,
   *  y=borde inferior − 24 px). */
  protected readonly herramientasOpen = signal(false);

  /** Cierra TODOS los paneles laterales/popovers (invariante: un solo panel principal abierto). */
  protected closeAllPanels(): void {
    this.panelOpen.set(false);
    this.jugadoresOpen.set(false);
    this.panelCat.set(null);
    this.exportMenuOpen.set(false);
    this.masOpen.set(false);
    this.herramientasOpen.set(false);
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
  /** Enfoca el input de título en el panel de Propiedades (validación de guardado). */
  protected focusTitleField(): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[aria-label="Título del ejercicio"]',
      );
      el?.focus();
      el?.select();
    }, 0);
  }
  /** Cierra el panel de Propiedades SIN perder la selección: el objeto seleccionado
   *  sigue vivo y visible/operable en el campo. Es el que usa el botón X; a diferencia
   *  de `togglePanel()`, no depende de `selectedElement()` ni se reabre. */
  protected closePropsPanel(): void {
    this.panelOpen.set(false);
    this.olvidarMinimizado();
    this.cdr.detectChanges();
  }
  protected toggleJugadores(): void {
    if (this.jugadoresOpen()) {
      this.jugadoresOpen.set(false);
      this.olvidarMinimizado();
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

  // ---------- FASE 3: botón flotante «Herramientas» ----------
  /** Abre/cierra el menú de categorías del grupo flotante. Es el sustituto del tramo de
   *  categorías de la barra inferior: en vez de estar siempre ocupando 57 px de alto, las
   *  categorías aparecen a demanda y el campo se queda con ese alto. */
  protected toggleHerramientas(): void {
    this.herramientasOpen.update((abierto) => !abierto);
  }
  /** Cierra el menú de herramientas. Se llama al elegir categoría (para que no tape la
   *  banda inferior del campo mientras se coloca) y al abrir otros menús/popovers. */
  protected closeHerramientas(): void {
    this.herramientasOpen.set(false);
  }

  // ---------- Pista única de "Llenar pantalla" (Fase 3) ----------
  // Toast breve y descartable que indica cómo recorrer el campo oculto. Solo aparece
  // la primera vez que se muestra la pizarra en "Llenar pantalla", se auto-oculta a
  // los pocos segundos y se persiste en localStorage para no reaparecer nunca más.
  private readonly fillHintKey = 'entrenolab:fill-hint';
  protected readonly fillHint = signal(false);
  /**
   * ¿Hay algún panel del tablero abierto? Sirve para no dejar avisos flotantes a medias detrás de
   * un panel: el aviso «Desliza para recorrer el campo · pellizca para acercar» vive en el centro
   * del lienzo y, con el panel de Material abierto en móvil horizontal, quedaba parcialmente
   * oculto detrás (el panel tiene `z-index` mayor y menos ancho útil).
   */
  protected readonly panelAbierto = computed(
    () => this.panelCat() !== null || this.jugadoresOpen() || this.panelOpen(),
  );

  // ---------- Paneles: minimizar/restaurar (Fase 3) ----------
  //
  // El dueño ya decidió que los paneles NO se cierran al tocar fuera (solo con un control
  // explícito). En móvil eso dejaba el campo muy justo, así que ahora se pueden MINIMIZAR a una
  // pestaña estrecha (icono + nombre) sin perder el estado del panel: el campo vuelve a verse y
  // operarse, y la pestaña lo devuelve tal cual estaba.
  protected readonly panelMinimizado = signal(false);

  /** Panel visible en este momento (solo puede haber uno de los cuatro en vista compacta). */
  protected readonly panelActivo = computed<
    'jugadores' | 'material' | 'dibujo' | 'propiedades' | null
  >(() => {
    if (this.jugadoresOpen()) return 'jugadores';
    const cat = this.panelCat();
    if (cat === 'material') return 'material';
    if (cat === 'dibujo') return 'dibujo';
    if (this.showPropsPanel()) return 'propiedades';
    return null;
  });

  /** Etiqueta e icono de la pestaña minimizada de cada panel. */
  protected readonly PANELES: Record<string, { label: string; icon: string }> = {
    jugadores: { label: 'Jugadores', icon: 'groups' },
    material: { label: 'Material', icon: 'sports_soccer' },
    dibujo: { label: 'Dibujo', icon: 'draw' },
    propiedades: { label: 'Propiedades', icon: 'tune' },
  };

  /** Metadatos del panel minimizado (null si no hay ninguno abierto). */
  protected readonly panelTab = computed(() => {
    const id = this.panelActivo();
    return id ? this.PANELES[id] : null;
  });

  /** Qué panel se minimizó: hay que recordarlo para poder reabrirlo tal cual. */
  private panelMinimizadoId: 'jugadores' | 'material' | 'dibujo' | 'propiedades' | null = null;

  protected minimizarPanel(): void {
    this.panelMinimizadoId = this.panelActivo();
    this.panelMinimizado.set(true);
  }

  /**
   * Reabre el panel minimizado. No basta con quitar la bandera: el clic en la pestaña cae FUERA
   * del panel y los manejadores del lienzo cierran el panel de Propiedades al tocar fuera, así que
   * se vuelve a abrir explícitamente el que estaba minimizado.
   */
  protected restaurarPanel(evt?: Event): void {
    // El manejador de «clic fuera» del lienzo corre DESPUÉS de este (mismo clic, el ancestro va
    // después del objetivo) y volvía a cerrar el panel de Propiedades: se corta la propagación.
    evt?.stopPropagation();
    const id = this.panelMinimizadoId ?? this.panelActivo();
    this.panelMinimizado.set(false);
    if (id === 'jugadores') this.jugadoresOpen.set(true);
    else if (id === 'material' || id === 'dibujo') this.panelCat.set(id);
    else if (id === 'propiedades') this.panelOpen.set(true);
  }

  /** Al cerrar un panel se olvida el estado minimizado: el siguiente se abre entero. */
  private olvidarMinimizado(): void {
    this.panelMinimizado.set(false);
  }
  /** La pista de "Llenar pantalla" se muestra un único hint flotante: ya no depende
   *  de la ayuda inicial (retirada por el dueño), así que solo mira su propia señal. */
  protected readonly fillHintVisible = computed(
    () => this.fillHint() && !this.orientHintVisible() && !this.panelAbierto(),
  );
  private fillHintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Marca la pista como "primera vez" (persistida) pero NO arma el auto-ocultado: ese
   *  temporizador se programa en cuanto la pista se hace VISIBLE (ver el effect del
   *  constructor), de modo que nunca pierde tiempo mientras la ayuda general la tapa. */
  private maybeShowFillHint(): void {
    if (!this.fillScreen()) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(this.fillHintKey) === '1')
      return;
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
    if (typeof localStorage !== 'undefined' && localStorage.getItem(this.orientHintKey) === '1')
      return;
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
    // FASE 4.8: al cambiar de verdad la orientación, un ejercicio NUEVO se adapta solo; uno
    // guardado solo OFRECE adaptarse (nunca se reescribe en silencio).
    this.ajustarOrientacion();
  }

  protected readonly notice = signal<string | null>(null);
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  protected notify(msg: string): void {
    this.notice.set(msg);
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => this.notice.set(null), 4000);
  }
  // FASE 7/A5: el título real vive en `metaTitle` (inicialmente vacío). `title` es un
  // DERIVADO de presentación: muestra "Nueva pizarra" como texto de cabecera SOLO cuando
  // no hay título; nunca es el valor guardado.
  protected readonly title = computed(() => this.metaTitle() || 'Nueva pizarra');

  // ---------- Metadatos del ejercicio (editables desde el panel) ----------
  protected readonly metaTitle = signal('');
  protected readonly metaCategory = signal<ExerciseCategory>('Técnica');
  /** Lista ÚNICA de categorías (FASE 7): fuente central, sin duplicar en el template. */
  protected readonly exerciseCategories = EXERCISE_CATEGORIES;
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
  protected setMetaTitle(v: string): void {
    this.metaTitle.set(v);
    this.markDirty();
  }
  protected setMetaCategory(v: string): void {
    this.metaCategory.set(v as ExerciseCategory);
    this.markDirty();
  }
  protected setMetaDuration(v: string): void {
    this.metaDuration.set(this.numOrNull(v));
    this.markDirty();
  }
  protected setMetaMin(v: string): void {
    this.metaMinPlayers.set(this.numOrNull(v));
    this.markDirty();
  }
  protected setMetaMax(v: string): void {
    this.metaMaxPlayers.set(this.numOrNull(v));
    this.markDirty();
  }
  protected setMetaFolder(v: string): void {
    this.metaFolder.set(v || null);
    this.markDirty();
  }
  protected numOrNull(v: string): number | null {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  protected readonly exportOpen = signal(false);

  protected readonly view = computed<CanvasElement[]>(
    () => this.frames()[this.current()]?.elements ?? [],
  );

  /** Borrador de dibujo en curso. Es una SEÑAL para que `boardSafe` (computed) se
   *  re-evalúe con cada pointerdown/move y la preview se muestre EN VIVO durante el
   *  gesto (sin esto, `boardSafe` quedaría cacheado y la preview se vería obsoleta:
   *  el defecto del "doble clic" que arregla la Fase 5). Solo llega a `null` al
   *  confirmar (pointerup) o al cancelar el borrador (Escape/cancel/pinch). */
  private readonly drag = signal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** Herramienta con la que se EMPEZÓ el borrador, capturada al iniciarlo. La usan el
   *  CONFIRMAR (`commitDrag`) y la PREVISUALIZACIÓN (`previewStr`), en vez de leer `tool()` en
   *  vivo: con «Línea», mantener ESPACIO a mitad de trazo (pasa a Mano) hacía que al soltar no
   *  casara ninguna rama y el trazo DESAPARECIERA (con otra herramienta de dibujo creaba OTRO
   *  tipo), mientras la previsualización ya mostraba la forma nueva: mentía. `null` cuando no
   *  hay borrador en curso. */
  private dragTool: Tool | null = null;
  private freehandPts: [number, number][] = [];
  private movingIds: string[] = [];
  private moveStart: { x: number; y: number } | null = null;
  private moveGestureBegun = false;
  private resizing = false;
  private resizeKey: string | null = null;
  /** Elemento que se está redimensionando, CAPTURADO al empezar el gesto. No se usa
   *  `selectedId` en vivo durante el arrastre: si entre medias el usuario deshace (Ctrl+Z), pega
   *  (Ctrl+V) o cualquier acción cambia la selección, el gesto se congelaba (el elemento dejaba de
   *  seguir al puntero) o pasaba a redimensionar OTRO elemento, y al soltar se registraba una
   *  entrada de historial que no correspondía a ningún cambio real. */
  private resizeId: string | null = null;
  /** `size` inicial al empezar a redimensionar un material/jugador (escala uniforme). */
  private resizeStartSize: number | null = null;
  /** `points` iniciales al redimensionar un trazo a mano alzada (bbox proporcional). */
  private resizeStartPoints: [number, number][] | null = null;
  private gestureBase: BoardSnapshot | null = null;
  /** Copia EXACTA del historial justo ANTES de abrir la transacción del gesto (`snapshot()`
   *  deja vacía la pila de rehacer). La lee SOLO la cancelación de un gesto con Escape: al
   *  cancelar, el deshacer/rehacer tienen que quedar como estaban antes del gesto (igual que
   *  hace el camino táctil en `restoreTouchState`). En un gesto confirmado no se lee nunca:
   *  `endHistory` se limita a olvidarla. */
  private historyBase: HistorySnapshot<BoardSnapshot> | null = null;
  /** Inicio de un gesto de PANEO (solo con la herramienta "Mano"; Seleccionar ya NO panea,
   *  ni sobre vacío ni sobre un objeto). `null` cuando no hay paneo activo. Distingue
   *  pantalla‑objeto: con Seleccionar, si el puntero baja sobre un elemento se MUEVE el
   *  elemento; sobre vacío solo deselecciona. Con "Mano", el arrastre (sobre objeto o no)
   *  PANEA la vista sin seleccionar ni mover. */
  private panGestureStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private panMoved = false;
  /** Punteros activos tocando el campo (id → posición de pantalla + tipo). Se registra CADA
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

  // ---------- Gestión táctil (dedo único ↔ pinch) ----------
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
  private lp: {
    pointerId: number;
    start: { x: number; y: number };
    targetId: string | null;
    fired: boolean;
  } | null = null;
  private lpTimer: ReturnType<typeof setTimeout> | null = null;
  /** BLOQUE D2: detección de DOBLE CLIC a nivel de puntero (ratón, herramienta
   *  Seleccionar). Dos taps de ratón sobre el MISMO elemento dentro de ~350 ms abren el
   *  menú contextual (igual que la pulsación larga táctil). */
  private dblClick: { id: string; time: number } | null = null;
  private static readonly DBL_CLICK_MS = 350;

  private editExerciseId: string | null = null;
  /** Relleno translúcido (true) vs solo contorno (false) para figuras. */
  protected readonly shapeFill = signal(true);
  /** Color del RELLENO de figuras (rect/elipse/zona). null → se deriva del perímetro. */
  protected readonly fillColor = signal<string | null>(null);
  /** Opacidad del relleno (0..1) de figuras. */
  protected readonly fillOpacity = signal<number>(0.15);
  protected setFillColor(c: string): void {
    this.fillColor.set(c);
  }
  protected setFillOpacity(o: number): void {
    this.fillOpacity.set(Math.max(0, Math.min(1, o)));
  }
  /** Color activo de las herramientas de dibujo (el de la herramienta actual).
   *  Por defecto es BLANCO (`DEFAULT_ELEMENT_COLOR`): es el color con el que el campo
   *  dibuja sus marcas y el que mejor contrasta sobre el césped (~4,7:1 frente a ~3,1:1
   *  del negro anterior). Además el negro antiguo (`#1f2933`) no estaba en `PALETTE`,
   *  así que el control de color no marcaba ninguna muestra como activa. */
  protected readonly drawColor = signal(DEFAULT_ELEMENT_COLOR);
  /** Herramientas que admiten color de trazo/texto (para la paleta por pulsación larga). */
  protected readonly colorableTools: ReadonlySet<Tool> = new Set([
    'line',
    'arrow',
    'doubleArrow',
    'curve_left',
    'curve_right',
    'dribble',
    'freehand',
    'rect',
    'ellipse',
    'text',
  ]);
  /** Memoria INDEPENDIENTE de color por herramienta (Fase 1): cambiar el color de
   *  Línea no debe cambiar el de Flecha ni de Rectángulo. Se persiste por dispositivo
   *  (preferencia local), nunca dentro de los ejercicios. */
  protected readonly toolColor = signal<Record<string, string>>(this.loadToolColors());
  /** BLOQUE E: clave versionada CDMPLab para la memoria de color por herramienta. Se
   *  migra una única vez la clave antigua (`entrenolab:tool-colors`) para no perder la
   *  preferencia de un usuario que ya la tuviera guardada, y a partir de ahí se escribe
   *  siempre bajo la clave nueva. */
  private static readonly toolColorKey = 'cdmplab:tool-colors:v1';
  private static readonly legacyToolColorKey = 'entrenolab:tool-colors';
  private loadToolColors(): Record<string, string> {
    try {
      const raw =
        localStorage.getItem(BoardComponent.toolColorKey) ??
        localStorage.getItem(BoardComponent.legacyToolColorKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, string>;
      // Solo en la primera lectura: vuelca la preferencia antigua a la clave nueva.
      if (
        !localStorage.getItem(BoardComponent.toolColorKey) &&
        localStorage.getItem(BoardComponent.legacyToolColorKey)
      ) {
        localStorage.setItem(BoardComponent.toolColorKey, JSON.stringify(parsed));
        localStorage.removeItem(BoardComponent.legacyToolColorKey);
      }
      return parsed;
    } catch {
      return {};
    }
  }
  protected colorFor(tool: Tool): string {
    return this.toolColor()[tool] ?? DEFAULT_ELEMENT_COLOR;
  }
  /** E/Bloque E — preferencia de trazo (continuo/discontinuo) POR HERRAMIENTA de dibujo
   *  (Línea y Flecha independientes). Se persiste localmente bajo una clave CDMPLab
   *  versionada; el modelo guarda `lineStyle` en el elemento, no el documento entero. */
  protected readonly toolLineStyle = signal<Record<string, string>>(this.loadToolLineStyle());
  private static readonly toolLineStyleKey = 'cdmplab:tool-line-style:v1';
  private loadToolLineStyle(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(BoardComponent.toolLineStyleKey) ?? '{}') as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  }
  protected lineStyleFor(tool: Tool): 'solid' | 'dashed' {
    return this.toolLineStyle()[tool] === 'dashed' ? 'dashed' : 'solid';
  }
  protected setToolLineStyle(tool: Tool, style: 'solid' | 'dashed'): void {
    const next = { ...this.toolLineStyle(), [tool]: style };
    this.toolLineStyle.set(next);
    try {
      localStorage.setItem(BoardComponent.toolLineStyleKey, JSON.stringify(next));
    } catch {
      /* sin persistencia: se mantiene en memoria */
    }
  }
  /** Color del trazo discontinuo activo (para el selector visible). */
  protected lineStyleCurrent(): 'solid' | 'dashed' {
    return this.lineStyleFor(this.tool());
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
      }),
    );
  });

  // ---------- Menú contextual (±90°, duplicar, eliminar, deshacer/rehacer) ----------
  /** El menú contextual solo se abre por PULSACIÓN LARGA o clic derecho (Fase 3);
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
  /**
   * Tamaño REAL de la barra de contexto, MEDIDO en el DOM. No se calcula desde constantes:
   * antes había una copia en TypeScript de la geometría del CSS (`CTX_GEOM`: 8 botones de
   * 40, huecos, separador…) que se quedaba obsoleta en cuanto cambiaba la barra.
   * `null` mientras no se ha medido (primer fotograma tras abrirse).
   */
  private readonly ctxBarBox = signal<{ w: number; h: number } | null>(null);

  /** La barra de contexto del DOM (para medirla de verdad, no para suponerla). */
  private readonly ctxBarRef = viewChild<ElementRef<HTMLElement>>('ctxBar');

  /**
   * Mide la barra con `ResizeObserver`: cualquier cambio real de tamaño (envolver en dos
   * filas en móvil, más botones, otra tipografía, cambio de ancho del host) llega aquí solo.
   */
  private readonly ctxBarMeasurer = effect((onCleanup) => {
    const el = this.ctxBarRef()?.nativeElement;
    if (!el) {
      this.ctxBarBox.set(null);
      return;
    }
    const measure = () => {
      const b = el.getBoundingClientRect();
      const prev = this.ctxBarBox();
      // Solo se escribe si cambia de verdad (evita bucles de render).
      if (!prev || Math.abs(prev.w - b.width) > 0.5 || Math.abs(prev.h - b.height) > 0.5) {
        this.ctxBarBox.set({ w: b.width, h: b.height });
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    onCleanup(() => ro.disconnect());
  });

  /** Posición (px relativos al `.board-host`) de la barra de contexto, centrada sobre el
   *  objeto y por ENCIMA de él; si no cabe arriba, pasa DEBAJO; siempre dentro del host.
   *
   *  Se ancla por el borde que TOCA al objeto (`bottom` si va encima, `top` si va debajo),
   *  así la separación es siempre el hueco exacto sin necesitar la altura. La altura MEDIDA
   *  solo decide si cabe encima, y el ancho medido evita salirse del host. */
  protected readonly contextBarPos = computed<{
    left: number;
    top: number | null;
    bottom: number | null;
    below: boolean;
  }>(() => {
    const el = this.selectedElement();
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!el || !hostEl) return { left: 0, top: 0, bottom: null, below: false };
    const r = hostEl.getBoundingClientRect();
    const bb = this.elNormBBox(el);
    const tl = this.normToScreenDisplay(bb.x0, bb.y0);
    const br = this.normToScreenDisplay(bb.x1, bb.y1);
    const centerX = (tl.x + br.x) / 2;
    const top = Math.min(tl.y, br.y);
    const bottom = Math.max(tl.y, br.y);
    const box = this.ctxBarBox();
    const margin = CONTEXT_BAR_MARGIN;
    const gap = CONTEXT_BAR_GAP;

    let left = centerX - (box ? box.w / 2 : 0);
    if (box) left = Math.max(margin, Math.min(left, Math.max(margin, r.width - box.w - margin)));

    // Sin medir todavía se asume que cabe encima: al llegar la medición (mismo fotograma o
    // el siguiente) la posición se corrige sola.
    const fitsAbove = box ? top - box.h - gap >= margin : true;
    let below = !fitsAbove;
    // Si tampoco cabe debajo, se queda encima pegado al borde superior (nunca fuera).
    if (below && box && bottom + gap + box.h > r.height - margin) below = false;

    if (below) return { left, top: bottom + gap, bottom: null, below };
    // Anclada por ABAJO: deja el borde inferior de la barra a `gap` del objeto sin usar su
    // altura (por eso un cambio de tamaño de la barra no puede taparlo).
    return { left, top: null, bottom: r.height - top + gap, below };
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

  /** Herramientas que usan color de trazo/figura (para mostrar el control de color).
   *  Deriva de `colorableTools`: antes era una lista paralela con los mismos 10 ids. */
  protected isColorTool(): boolean {
    return this.colorableTools.has(this.tool());
  }
  /** El inspector muestra el selector de Color solo para elementos cuyo `c` se renderiza
   *  (no para materiales PNG, cuya imagen no cambia con `c`, ni para jugadores, que tienen
   *  el suyo). Fuente única: `render.COLORABLE_ELEMENT_TYPES` (antes era una tercera lista
   *  escrita a mano que se dejaba fuera el Aro, coloreable según el registro canónico). */
  protected showInspectorColor(): boolean {
    const el = this.selectedElement();
    return !!el && COLORABLE_ELEMENT_TYPES.has(el.t);
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
    () => this.view().find((e) => e.id === this.lastSelectedId()) ?? null,
  );

  private lastSelectedId(): string | null {
    const ids = this.selectedIds();
    return ids.length ? ids[ids.length - 1] : null;
  }

  private setSingleSelection(id: string): void {
    this.selectedIds.set([id]);
    this.selectedId.set(id);
    // En móvil (≤700px) la auto-apertura del panel de Propiedades tapa el objeto que
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
        // FASE 2: cada ejercicio recupera SUS colores de jugador (vacío = colores por defecto).
        this.playerColors.set(normalizarMapaColores(doc.playerColors));
      }
    }
    const ex = this.editExerciseId
      ? this.store.exercises().find((e) => e.id === this.editExerciseId)
      : undefined;
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
      this.metaTitle.set(m.title);
      this.metaDescription.set(m.description);
      this.metaExplanation.set(m.explanation);
      this.metaDuration.set(m.durationMinutes);
      this.metaMinPlayers.set(m.minPlayers);
      this.metaMaxPlayers.set(m.maxPlayers);
      this.metaMaterials.set(
        m.materials
          ? m.materials
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
          : [],
      );
    }
    // Modo de pantalla: usa la preferencia guardada; si no existe, en móvil el
    // default es "Llenar pantalla" (la mayor área táctil usable del campo).
    const fillStored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(this.fillPrefKey) : null;
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
    // FASE 4: en móvil se intenta pantalla completa + bloqueo horizontal y, si el navegador no lo
    // permite, se degrada con un aviso descartable. Al CARGAR solo se OFRECE adaptar el campo (no se
    // cambia solo: 32 ficheros de pruebas asumen la orientación del documento al abrir, y cambiar el
    // campo bajo los pies del usuario al entrar tampoco es deseable). La adaptación AUTOMÁTICA se
    // reserva para un giro real de la pantalla (FASE 4.8) y solo en ejercicios nuevos.
    this.avisarSiNoSePuedeBloquear();
    this.ofrecerAdaptacion();
  }

  // =============================================================
  // FASE 4 — pantalla completa, bloqueo de orientación y «Adaptar a la pantalla».
  //
  // Politica: TODO es progresivo. `requestFullscreen()` y `screen.orientation.lock()` pueden no
  // existir, requerir un gesto del usuario o ser rechazados; en ese caso NO se bloquea la app: se
  // muestra un aviso corto y descartable y el campo se adapta a la orientación real de la pantalla
  // (móvil vertical → campo vertical; móvil horizontal → campo horizontal).
  //
  // Un ejercicio NUEVO se adapta solo al girar. Uno YA GUARDADO no se reescribe nunca en silencio:
  // su orientación forma parte del contenido y se ofrece «Adaptar a la pantalla».
  // =============================================================

  /** Aviso descartable: el navegador no permite girar/bloquear la pantalla. */
  protected readonly avisoOrientacion = signal(false);
  /** Texto del aviso (constante del módulo puro, para no duplicar el mensaje en la plantilla). */
  protected readonly avisoSinBloqueo = AVISO_SIN_BLOQUEO;
  /** El ejercicio guardado no cuadra con la pantalla: se ofrece adaptarlo a mano. */
  protected readonly puedeAdaptarPantalla = signal(false);
  /** ¿La pantalla completa la inició CDMLab? Solo entonces se sale de ella al salir. */
  /**
   * «Pantalla completa» del menú «Más»: acción EXPLÍCITA del usuario.
   *
   * DECISIÓN MEDIDA (sustituye a abrirlo automáticamente al entrar o al primer toque): intentarlo
   * sin una acción explícita dejaba la ventana en un modo pantalla completa del que el navegador no
   * dejaba salir al cambiar el tamaño («To resize minimized/maximized/fullscreen window…»), rompía
   * la app en ese escenario y además secuestraba la pantalla sin permiso. Aquí el usuario lo pide y
   * los navegadores lo conceden porque hay gesto. Si el bloqueo de orientación falla, se avisa y se
   * deshace la pantalla completa.
   */
  protected pantallaCompleta(): void {
    this.intentarPantallaCompleta();
    this.closeMas();
  }

  private pantallaCompletaIniciada = false;
  private oyenteOrientacion: (() => void) | null = null;

  /**
   * Avisa (una vez) si el navegador no puede bloquear la orientación y deja el intento de pantalla
   * completa + bloqueo para el PRIMER TOQUE del usuario.
   *
   * MEDIDO Y CORREGIDO: pedir pantalla completa al ENTRAR (sin gesto) dejaba la ventana en un modo
   * del que el navegador ya no dejaba salir al redimensionar —«To resize minimized/maximized/
   * fullscreen window, restore it to normal state first»—, rompiendo la propia app y las pruebas que
   * cambian el tamaño de la ventana. Los navegadores exigen además un gesto del usuario para
   * `requestFullscreen()`, así que el momento correcto es el primer toque sobre el campo, que es
   * justo cuando el usuario empieza a trabajar. Si el bloqueo no está disponible, se avisa ya y no
   * se intenta nada.
   */
  private avisarSiNoSePuedeBloquear(): void {
    if (!this.isCompactViewport()) return;
    if (!puedeIntentarBloqueo(this.capacidadesPantalla())) this.avisoOrientacion.set(true);
  }

  private capacidadesPantalla(): CapacidadesPantalla {
    const doc = document as Document & { fullscreenEnabled?: boolean };
    const orientation = (
      screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }
    ).orientation;
    return {
      pantallaCompletaSoportada: !!doc.fullscreenEnabled,
      bloqueoOrientacion: typeof orientation?.lock === 'function',
    };
  }

  private intentarPantallaCompleta(): void {
    if (!this.isCompactViewport()) return;
    const orientation = (
      screen as Screen & {
        orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void };
      }
    ).orientation;
    const cap = this.capacidadesPantalla();
    if (!puedeIntentarBloqueo(cap)) {
      // Degradación limpia: no se intenta nada y se explica qué hacer.
      this.avisoOrientacion.set(true);
    } else {
      void (async () => {
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            this.pantallaCompletaIniciada = true;
          }
          await orientation!.lock!('landscape');
        } catch {
          // Rechazado (permiso, navegador sin soporte real): NO se bloquea la app, se avisa… y se
          // DESHACE la pantalla completa que hayamos iniciado, para no dejar la ventana en un modo
          // que no aporta nada sin el bloqueo.
          this.avisoOrientacion.set(true);
          if (this.pantallaCompletaIniciada && document.fullscreenElement) {
            void document.exitFullscreen().catch(() => undefined);
            this.pantallaCompletaIniciada = false;
          }
        }
      })();
    }
    // Se escuchan los cambios REALES de orientación (además del resize).
    const mq =
      typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: portrait)') : null;
    if (mq) {
      this.oyenteOrientacion = () => this.ajustarOrientacion();
      mq.addEventListener('change', this.oyenteOrientacion);
    }
  }

  /**
   * Orientación REAL de la pantalla.
   *
   * MEDIDO (prueba intermitente): leer solo `window.innerWidth/innerHeight` dentro del manejador de
   * `resize` no es fiable — el evento puede llegar con el tamaño ANTERIOR, así que a veces la
   * adaptación no se aplicaba y el campo se quedaba como estaba. `matchMedia('(orientation: …)')`
   * es autoritativo y no depende del instante del evento; el tamaño se usa solo como último recurso.
   */
  private orientacionDePantalla(): OrientacionCampo {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(orientation: landscape)').matches) return 'horizontal';
      if (window.matchMedia('(orientation: portrait)').matches) return 'vertical';
    }
    return orientacionDeseada(window.innerWidth, window.innerHeight);
  }

  /** Al CARGAR: si el campo no cuadra con la pantalla, se ofrece adaptarlo (no se cambia solo). */
  private ofrecerAdaptacion(): void {
    if (typeof window === 'undefined') return;
    this.puedeAdaptarPantalla.set(this.orientacionDePantalla() !== this.orientation());
  }

  /** Ajusta el campo a la orientación de la pantalla (o pide permiso si el ejercicio está guardado). */
  private ajustarOrientacion(): void {
    if (typeof window === 'undefined') return;
    const deseada = this.orientacionDePantalla();
    if (deseada === this.orientation()) {
      this.puedeAdaptarPantalla.set(false);
      return;
    }
    if (debeAdaptarAutomaticamente(!!this.editExerciseId)) {
      this.orientation.set(deseada);
      this.puedeAdaptarPantalla.set(false);
    } else {
      this.puedeAdaptarPantalla.set(true);
    }
  }

  /** «Adaptar a la pantalla»: aplica la orientación de la pantalla al ejercicio abierto. */
  protected adaptarAlaPantalla(): void {
    this.orientation.set(this.orientacionDePantalla());
    this.puedeAdaptarPantalla.set(false);
    this.markDirty();
    this.notify('Ejercicio adaptado a la pantalla.');
  }

  protected descartarAvisoOrientacion(): void {
    this.avisoOrientacion.set(false);
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
    // Clic dentro de un panel/popover → no cerrar (el propio contenido gestiona su cierre).
    if (t.closest('.tools-panel')) return;
    if (t.closest('.side-panel')) return;
    if (t.closest('.top-pop')) return;
    // Clic sobre un disparador → lo gestiona su toggle.
    if (t.closest('.tools-cat')) return;
    if (t.closest('.edge-btn')) return;
    // La PESTAÑA del panel minimizado es un control explícito (no un «clic fuera»): si se tratara
    // como tal, el manejador cerraría el panel de Propiedades en el mismo gesto y al restaurarlo
    // no volvía a aparecer (medido: desaparecían panel y pestaña).
    if (t.closest('.panel-tab')) return;
    // Clic sobre el campo → lo gestiona onPointerDown (selección/inspector, o cierre al crear).
    // NO usamos `t.closest('.board-host')` aquí: al colocar/seleccionar un elemento,
    // onPointerDown re-renderiza el SVG ([innerHTML]) y el nodo objetivo queda
    // DESENGAÑADO, así que `closest`/`contains` fallarían y este listener cerraría el
    // panel que se acaba de abrir (el bug del doble toque era latente; lo tapaba el
    // fallback `selectedElement()` de showPropsPanel). Comprobamos si el puntero cae
    // dentro del rectángulo de .board-host.
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (hostEl) {
      const r = hostEl.getBoundingClientRect();
      if (
        evt.clientX >= r.left &&
        evt.clientX <= r.right &&
        evt.clientY >= r.top &&
        evt.clientY <= r.bottom
      )
        return;
    }
    const anyOpen =
      this.panelOpen() ||
      this.jugadoresOpen() ||
      this.panelCat() !== null ||
      this.exportMenuOpen() ||
      this.masOpen();
    if (!anyOpen) return;
    // FASE B (paneles persistentes): tocar FUERA de un panel NO cierra los catálogos
    // laterales (Jugadores/Material/Dibujo): solo se cierran con su control explícito
    // (botón X / volver a tocar la categoría). Aquí únicamente se cierran los popovers
    // transitorios (Propiedades y los menús superior Exportar/Más), que sí son de tipo
    // "desplegable" y no deben tapar el campo.
    this.panelOpen.set(false);
    this.exportMenuOpen.set(false);
    this.masOpen.set(false);
    this.cdr.detectChanges();
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
    // FASE 4: al salir de la pizarra se libera el bloqueo de orientación y se sale de pantalla
    // completa SOLO si la inició CDMLab (nunca se cierra algo que abrió el usuario por su cuenta).
    const orientation = (screen as Screen & { orientation?: { unlock?: () => void } }).orientation;
    try {
      orientation?.unlock?.();
    } catch {
      /* el navegador no lo permite: no es un error para la app */
    }
    if (this.pantallaCompletaIniciada && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      this.pantallaCompletaIniciada = false;
    }
    this.oyenteOrientacion = null;
  }

  // ---------- Coordenadas ----------

  private unlockedView(): CanvasElement[] {
    return this.view().filter((e) => !e.locked);
  }

  private clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  /** FASE 6: factor de escala visual de los objetos según el campo actual (1 en campo
   *  completo; <1 en medio campo/F7). Se usa en render y hit-test para que el tamaño
   *  aparente sea consistente y el área de agarre coincida con lo dibujado. */
  private objectScale(): number {
    return fieldObjectScale(this.field(), this.orientation());
  }

  /** Clamp que permite la franja exterior de césped (FASE 2): una pequeña proporción
   *  FUERA de [0,1] para colocar/mover jugadores y materiales en la franja lisa.
   *  No altera los ejercicios antiguos (todos en [0,1]) ni el render (que ya incluye
   *  la franja como dominio válido en screenToNorm). */
  private clampStrip(v: number): number {
    return Math.max(-MARGIN_STRIP, Math.min(1 + MARGIN_STRIP, v));
  }

  private geo(): Geometry {
    // Geometría del tipo de campo + orientación actuales (el medio campo no se
    // estira a la caja 105×68 del campo completo).
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

  /** pantalla → norm (la inversa exacta del render). Replica screenToNorm de render.ts. */
  private normForClient(clientX: number, clientY: number): { x: number; y: number } {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return { x: 0, y: 0 };
    const r = hostEl.getBoundingClientRect();
    const g = this.geo();
    // El fit ('height' en llenar pantalla) cambia el letterboxing del SVG y debe
    // coincidir con cómo se dimensiona el canvas: así las coordenadas siguen siendo
    // correctas en AMBOS modos (ver round-trip en render.spec).
    return screenToNorm(
      clientX,
      clientY,
      r,
      g,
      this.panX(),
      this.panY(),
      this.zoom(),
      this.fillScreen() ? 'height' : 'contain',
    );
  }

  /** norm → pantalla RELATIVA al host (inversa exacta de `normForClient`): devuelve
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

  /** hit-test con tolerancia EN PANTALLA convertida por zoom (D1). `screenPx` es la
   *  tolerancia en px CSS: ratón ~4, táctil ~8–10. Sustituye el 0.045 normalizado fijo que
   *  hacía crecer la zona de selección con la magnificación. Replica el cálculo de `scale`
   *  de `normToScreenDisplay` (COVER en llenar pantalla) para coincidir con el render. */
  private hitTestNorm(
    p: { x: number; y: number },
    view: CanvasElement[],
    screenPx: number,
  ): string | null {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return null;
    const r = hostEl.getBoundingClientRect();
    const g = this.geo();
    const fit = this.fillScreen() ? 'height' : 'contain';
    const s = fit === 'height' ? this.fillScale(r, g) : Math.min(r.width / g.vbW, r.height / g.vbH);
    return hitTestElement(
      p,
      view,
      g.rect,
      this.objectScale(),
      {
        screenPx,
        zoom: this.zoom(),
        scale: s,
      },
      g.vertical,
      // FASE 3 del encargo de materiales: la portería se dibuja con la anchura reglamentaria del
      // campo, así que su caja táctil se calcula con el MISMO campo que el dibujo (si no, tocar los
      // extremos visibles de la portería no la seleccionaría).
      this.field(),
    );
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
    if (
      t === 'line' ||
      t === 'arrow' ||
      t === 'doubleArrow' ||
      t === 'measure' ||
      t === 'dribble'
    ) {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      return {
        x0: Math.min(x1, x2),
        y0: Math.min(y1, y2),
        x1: Math.max(x1, x2),
        y1: Math.max(y1, y2),
      };
    }
    if (t === 'curve') {
      const x1 = el.x1 ?? 0;
      const y1 = el.y1 ?? 0;
      const x2 = el.x2 ?? 0;
      const y2 = el.y2 ?? 0;
      const cx = el.c1x ?? (x1 + x2) / 2;
      const cy = el.c1y ?? (y1 + y2) / 2;
      return {
        x0: Math.min(x1, x2, cx),
        y0: Math.min(y1, y2, cy),
        x1: Math.max(x1, x2, cx),
        y1: Math.max(y1, y2, cy),
      };
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
    const hw = (MATERIAL_BOX * size) / 2 / r.w;
    const hh = (MATERIAL_BOX * size) / 2 / r.h;
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

  /** TOTAL de punteros TÁCTILES activos: los del CAMPO (`activePointers`) más los que
   *  nacieron en el PANEL (`panelPointers`). Así el segundo dedo se detecta aunque el
   *  primero haya empezado en el panel (ese no entra en `activePointers`). */
  private totalActiveTouch(): number {
    return this.activeTouchCount() + this.panelPointers.size;
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
    this.dragTool = null;
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
    this.dragTool = null;
    this.freehandPts = [];
    this.endHistory();
  }

  /** Cancela el gesto de un puntero EN CURSO (mover/redimensionar con ratón o pluma, o el
   *  gesto de un dedo ya empezado) devolviendo el estado EXACTO previo al gesto. Se usa al
   *  pulsar Escape.
   *
   *  Por qué hacía falta: sin esto, Escape solo limpiaba la selección y el objeto seguía
   *  pegado al puntero hasta soltar; si se soltaba sobre la papelera, se BORRABA un objeto que
   *  el usuario creía haber cancelado.
   *
   *  Cómo queda el historial: se restaura el documento desde `gestureBase` ANTES de limpiar el
   *  gesto, así el `endHistory` de la limpieza compara dos estados idénticos y no confirma NADA
   *  (ni entrada de undo ni marca de sucio); y se devuelve la copia de `historyBase` para que el
   *  deshacer/rehacer queden como estaban (el `snapshot()` del inicio del gesto vacía el rehacer).
   *
   *  Devuelve true si había un gesto que cancelar (y por tanto Escape ya se ha consumido). */
  private cancelActiveGesture(): boolean {
    // Camino TÁCTIL: la gestión del dedo guarda su propia instantánea completa (documento,
    // vista, selección, historial y sucio). Se descarta entera —también si aún estaba
    // PENDIENTE, porque al levantar el dedo confirmaría un tap que Escape debe anular.
    if (this.touchPending) {
      this.cancelLongPress(); // la pulsación larga armada por este dedo muere con el gesto
      this.cancelTouchGesture();
      return true;
    }
    // Camino de UN PUNTERO: solo hay gesto con estado que limpiar si está moviendo o
    // redimensionando (un paneo no toca el documento y Escape lo sigue dejando en paz).
    if (!this.movingIds.length && !this.resizing) return false;
    // Bajar sobre un objeto ARMA la pulsación larga: si Escape cancela el gesto, el
    // temporizador no puede seguir vivo y abrir la barra contextual medio segundo después.
    this.cancelLongPress();
    const base = this.gestureBase;
    const hist = this.historyBase;
    if (base) this.restoreSnapshot(base);
    this.cancelSinglePointerGestures(); // limpia el gesto; su endHistory no confirma nada
    if (hist) this.history.restore(hist);
    return true;
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
   *  el punto medio siga ahí. SOLO usa los DOS participantes fijos — el movimiento de un
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
    // Pinch limitado al rango del requisito: 100%–300%.
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
   *  norm→pantalla→norm es la identidad), teniendo en cuenta letterboxing y orientación. */
  private panToKeepAnchor(
    anchor: { x: number; y: number },
    screenX: number,
    screenY: number,
    zoom: number,
  ): { panX: number; panY: number } {
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

  /** A4: un campo de media extensión física (52,5×68) incluye el medio campo y el F7.
   *  `two_halves` (105×68) NO es media extensión. */
  private isHalfGeometry(field: FieldType): boolean {
    return field === 'half' || field === 'vertical_half' || field === 'f7';
  }

  /** Orientación que se aplicará al ELEGIR `f`, en un único sitio: la usan la acción
   *  (`setField`) y la miniatura de la tarjeta (`fieldPreviewSafe`), de modo que la tarjeta no
   *  puede prometer una orientación distinta de la que aplica. Regla vigente: un campo de media
   *  extensión se pone VERTICAL («portería arriba») en escritorio/tablet; en móvil un ejercicio
   *  NUEVO conserva la orientación actual (decisión de usabilidad del dueño) y al editar un
   *  documento existente se respeta la que traía. `f7` es una plantilla compuesta y no la fuerza. */
  private orientationForField(f: FieldType): 'horizontal' | 'vertical' {
    if (
      this.isHalfGeometry(f) &&
      f !== 'f7' &&
      (!this.isCompactViewport() || this.editExerciseId)
    ) {
      return 'vertical';
    }
    return this.orientation();
  }

  /** Cancela la interacción en curso (FASE 1.6 del encargo: drag, resize, dibujo, arrastre de
   *  panel) ANTES de aplicar un cambio de campo, para que no quede un gesto a medias apuntando a
   *  coordenadas del campo anterior. Se reutiliza el mismo camino que Escape: el gesto de puntero
   *  se revierte a su estado EXACTO previo y no confirma entrada de historial. */
  private cancelarInteraccionEnCurso(): void {
    if (!this.cancelActiveGesture() && this.drag()) this.cancelDraft();
    // Solo si hay un ARRASTRE DE PANEL en curso: `cancelPanelGesture` devuelve la herramienta a
    // Cursor (comportamiento correcto al abortar un arrastre de material), pero al cancelar un trazo
    // de dibujo eso desarmaba la herramienta que el usuario había elegido. Medido en
    // `fase-cambio-campos` (FASE 1.6): tras el cambio de campo la herramienta quedaba en «Seleccionar
    // y mover» y el siguiente trazo no dibujaba nada.
    if (this.panelDrag()) this.cancelPanelGesture();
    // Y se deja LIMPIO el registro de punteros: si el cambio de campo llega con el dedo/ratón
    // todavía abajo, ese puntero ya no pertenece a ningún gesto y, si siguiera registrado, el
    // siguiente `pointerdown` (mismo pointerId) se interpretaría como un SEGUNDO dedo.
    this.activePointers.clear();
    this.panelPointers.clear();
  }

  /** Cambio de campo DIRECTO: un clic cambia el campo, siempre, con o sin objetos.
   *
   *  Garantías que exige el encargo (y que se comprueban en `e2e/fase-cambio-campos`):
   *   · no hay diálogo, ni plan pendiente, ni ningún overlay: no puede quedar la pizarra bloqueada;
   *   · los elementos se CONSERVAN tal cual: mismos ids, mismas coordenadas normalizadas, sin
   *     transformar, duplicar, recortar ni eliminar nada;
   *   · `aria-pressed` y `data-field` se actualizan en el mismo clic (son señales);
   *   · el panel de Propiedades NO se cierra, para poder probar varios campos seguidos;
   *   · el encuadre vuelve a ser neutro en «ver campo completo» (el campo nuevo puede ser más alto
   *     o más ancho) y en «Llenar pantalla» no se toca, porque ahí el recorte es intencionado;
   *   · pulsar el campo YA activo es un no-op seguro. */
  protected setField(f: FieldType): void {
    if (this.field() === f) return;
    this.cancelarInteraccionEnCurso();
    this.beginHistory();
    this.field.set(f);
    // El medio campo por defecto se muestra VERTICAL (portería arriba) en escritorio/tablet. En
    // móvil un ejercicio NUEVO conserva la orientación actual (decisión de usabilidad del dueño) y
    // al editar un documento existente se respeta la que traía. `f7` es plantilla compuesta y no la
    // fuerza.
    if (this.isHalfGeometry(f) && f !== 'f7') {
      const o = this.orientationForField(f);
      if (o !== this.orientation()) this.orientation.set(o);
    }
    // NADA de transformaciones de coordenadas: cambiar de campo es cambiar el FONDO.
    this.endHistory();
    if (!this.fillScreen()) this.resetView();
    // El historial ya marca sucio cuando el documento cambia; se marca también aquí para que el
    // cambio de campo cuente como modificación aunque solo cambiara el tipo de campo.
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

  /** Variantes (color/tipo) de cada material; la elegida se usa en la próxima colocación.
   *  BLOQUE E: se persiste localmente bajo una clave CDMPLab versionada para que la
   *  preferencia de variante sobreviva a recargas/cambios de sesión. */
  protected readonly materialVariant = signal<Record<string, TacticalKind>>(
    this.loadMaterialVariants(),
  );
  private static readonly materialVariantKey = 'cdmplab:material-variant:v1';
  private loadMaterialVariants(): Record<string, TacticalKind> {
    try {
      return JSON.parse(localStorage.getItem(BoardComponent.materialVariantKey) ?? '{}') as Record<
        string,
        TacticalKind
      >;
    } catch {
      return {};
    }
  }
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
    const id = this.barColor();
    return id ? toolTitle(id) : '';
  }
  protected barToolClick(id: Tool): void {
    this.endBarPress();
    if (this.panelDragClickConsumed()) {
      this.panelTapTouch = false;
      return;
    } // fue un arrastre al campo (ya colocó)
    const tapTouch = this.consumePanelTapTouch();
    if (this.barLongPressed) {
      this.barLongPressed = false;
      return; // fue long-press: no colocar
    }
    // Defecto 1: en TÁCTIL un toque corto sobre una herramienta de COLOCACIÓN NO la arma
    // (solo un arrastre completo por el panel coloca). Sí ajusta las herramientas de dibujo
    // (gesto único) y la activación por teclado no pasa por pointerdown → tapTouch=false.
    if (tapTouch && PLACEMENT_TOOLS.has(id)) return;
    // Fase 3: pulsar de nuevo la herramienta YA armada NO cancela el emplazamiento;
    // mantiene el modo de colocación continua activo (conserva la variante/color).
    this.setTool(id);
    if (id !== 'select' && PLACEMENT_TOOLS.has(id)) this.armForTool(id);
    else this.armed.set(null); // dibujo / erase / select: sin emplazamiento
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
      default:
        // FASE 7: una única escalera, un único aro y un maniquí independiente de la
        // barrera. Se eliminan las variantes ring_flat/ladder_yellow/mannequin_row del
        // selector (sus documentos antiguos siguen siendo válidos y renderizándose).
        return [this.defaultKindFor(id)];
    }
  }
  /** Fase 14 — ruta de la miniatura REAL de un material (variante activa o por defecto).
   *  Devuelve null para los materiales vectoriales sin PNG (se renderiza como SVG).
   *  La ruta es RELATIVA (sin `/` inicial) para ser compatible con el baseHref `/CDMPLab/`
   *  de GitHub Pages, sin tocar el render ni el inlining (que usa rutas absolutas). */
  protected materialThumbSrc(id: string): string | null {
    const kind = this.materialVariant()[id] ?? this.defaultKindFor(id);
    const asset = tacticAsset(kind)?.asset;
    return asset ? asset.replace(/^\//, '') : null;
  }
  protected setMaterialVariant(id: string, kind: TacticalKind): void {
    this.materialVariant.update((m) => {
      const next = { ...m, [id]: kind };
      try {
        localStorage.setItem(BoardComponent.materialVariantKey, JSON.stringify(next));
      } catch {
        /* preferencia local no crítica */
      }
      return next;
    });
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
      marker: '#3056d3',
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
      case 'marker':
        inner = `<path d="M-1.6 0 A1.6 1.6 0 0 1 1.6 0 Z" fill="${c}" stroke="#20242a" stroke-width="0.2"/><ellipse cx="0" cy="0" rx="1.6" ry="0.5" fill="#10151a" opacity="0.55"/>`;
        break;
      case 'pica':
        inner = `<rect x="-0.25" y="-2.4" width="0.5" height="4.8" rx="0.25" fill="${c}" stroke="#20242a" stroke-width="0.2"/>`;
        break;
      case 'dumbbell':
        inner = `<g fill="#20242a"><rect x="-1.3" y="-0.45" width="2.6" height="0.9" rx="0.3"/><rect x="-1.9" y="-0.7" width="0.6" height="1.4" rx="0.25"/><rect x="1.3" y="-0.7" width="0.6" height="1.4" rx="0.25"/></g>`;
        break;
      // B2: Chino (disco plano recoloreable) y Valla con SVG vectorial ORIGINAL y
      // transparente (mismo trazo que el render del campo), en vez de una foto.
      // FASE 4 del encargo de materiales: la miniatura del CHINO se actualiza a la forma nueva del
      // tablero (platillo con aro, superficie y abertura central) para que la lista y el objeto
      // colocado representen LO MISMO.
      case 'target':
        inner =
          `<ellipse cx="0.06" cy="0.42" rx="1.05" ry="0.45" fill="#00000055"/>` +
          `<ellipse cx="0" cy="0" rx="1.0" ry="0.68" fill="${c}" stroke="#20242a" stroke-width="0.14"/>` +
          `<ellipse cx="0" cy="-0.06" rx="0.66" ry="0.42" fill="#ffffff" opacity="0.3"/>` +
          `<ellipse cx="0" cy="-0.06" rx="0.22" ry="0.14" fill="#20242a" opacity="0.55"/>` +
          `<path d="M-0.72 -0.36 A 1.0 0.68 0 0 1 0.72 -0.36" fill="none" stroke="#ffffff" stroke-width="0.12" opacity="0.6"/>`;
        break;
      // FASE 4: la ESCALERA y la MINIPORTERÍA ahora se dibujan en vector, así que la lista de
      // materiales necesita su miniatura vectorial (antes caían al icono de fuente, y una fuente no
      // representa el objeto).
      case 'ladder': {
        let peldaños = '';
        for (let i = 0; i < 7; i++) {
          peldaños += `<rect x="${(-1.8 + i * 0.6).toFixed(2)}" y="-0.9" width="0.26" height="1.8" rx="0.13"/>`;
        }
        inner =
          `<g fill="#f6c945" stroke="#20242a" stroke-width="0.1">` +
          `<rect x="-2.4" y="-1.05" width="4.8" height="0.24" rx="0.12" fill="#252b32"/>` +
          `<rect x="-2.4" y="0.81" width="4.8" height="0.24" rx="0.12" fill="#252b32"/>` +
          peldaños +
          `</g>`;
        break;
      }
      case 'minigoal':
        inner =
          `<rect x="-1.15" y="-0.62" width="2.3" height="1.15" fill="#ffffff22"/>` +
          `<rect x="-1.15" y="-0.62" width="2.3" height="0.2" fill="${c}" stroke="#20242a" stroke-width="0.08"/>` +
          `<rect x="-1.15" y="-0.62" width="0.2" height="1.15" fill="${c}" stroke="#20242a" stroke-width="0.08"/>` +
          `<rect x="0.95" y="-0.62" width="0.2" height="1.15" fill="${c}" stroke="#20242a" stroke-width="0.08"/>` +
          `<rect x="-1.4" y="0.53" width="2.8" height="0.18" rx="0.09" fill="${c}"/>`;
        break;
      case 'hurdle':
        inner = `<g stroke="${c}" stroke-width="0.28" fill="none"><rect x="-1.7" y="-0.35" width="3.4" height="0.68" rx="0.34"/><line x1="-1.6" y1="0.33" x2="-1.6" y2="2.0"/><line x1="1.6" y1="0.33" x2="1.6" y2="2.0"/></g><rect x="-2.0" y="1.95" width="4.0" height="0.3" fill="${c}"/>`;
        break;
      case 'goal':
        inner = `<rect x="-2.4" y="-2.0" width="4.8" height="4.0" fill="none" stroke="#ffffff" stroke-width="0.5"/><rect x="2.2" y="-2.0" width="0.4" height="4.0" fill="#ffffff" stroke="#20242a" stroke-width="0.2"/><rect x="-2.6" y="-2.0" width="0.4" height="4.0" fill="#ffffff" stroke="#20242a" stroke-width="0.2"/><path d="M-2.4 -2 L2.4 2 M-2.4 2 L2.4 -2" stroke="#ffffff88" stroke-width="0.2"/>`;
        break;
      case 'mannequin_row':
        inner = `<circle cx="-1.5" cy="-1.6" r="0.8" fill="${c}" stroke="#20242a" stroke-width="0.2"/><rect x="-2.2" y="-0.75" width="1.4" height="2.6" rx="0.6" fill="${c}" stroke="#20242a" stroke-width="0.2"/><circle cx="1.5" cy="-1.6" r="0.8" fill="${c}" stroke="#20242a" stroke-width="0.2"/><rect x="0.8" y="-0.75" width="1.4" height="2.6" rx="0.6" fill="${c}" stroke="#20242a" stroke-width="0.2"/>`;
        break;
      default:
        return '';
    }
    return `<svg viewBox="-2.6 -2.6 5.2 5.2" preserveAspectRatio="xMidYMid meet" class="mat-thumb-svg" aria-hidden="true" focusable="false">${inner}</svg>`;
  }

  /** HTML seguro de la miniatura vectorial (usa el mismo sanitizador que el campo). */
  protected materialVectorThumbSafe(id: string): SafeHtml {
    const svg = this.materialVectorThumb(id);
    return this.sanitizer.bypassSecurityTrustHtml(
      svg || `<span class="msi">${this.materialIcon(id)}</span>`,
    );
  }

  /** Miniatura SVG de un campo base (solo las líneas, sin fichas) con la geometría REAL.
   *  Usa el mismo renderizador y la misma geometría que el campo activo, de modo que la
   *  miniatura no puede quedar desactualizada respecto al campo (FASE 3).
   *
   *  La orientación de la miniatura es la que se APLICARÍA al elegir esa tarjeta
   *  (`orientationForField`), no la actual sin más: antes el «Medio campo» se dibujaba con la
   *  orientación de ese momento y, al pulsarlo, el campo se ponía en vertical, así que en
   *  escritorio la tarjeta prometía algo distinto de lo que hacía. */
  protected fieldPreviewSafe(field: FieldType): SafeHtml {
    // CORRECCIÓN URGENTE (robustez): la miniatura se calcula UNA vez por combinación
    // campo + orientación que se aplicaría. Antes se recalculaba en CADA ciclo de detección de
    // cambios y, como el valor enlazado con `[innerHTML]` era un objeto nuevo cada vez, Angular
    // REEMPLAZABA los nodos internos de la tarjeta continuamente: coste innecesario y, en un equipo
    // lento, la causa de que un clic se pudiera perder (el nodo pulsado desaparecía entre
    // `pointerdown` y `pointerup`). La clave incluye la orientación, así que un cambio de viewport
    // (que cambia `orientationForField`) sigue refrescando la miniatura.
    const clave = `${field}|${this.orientationForField(field)}`;
    const enCache = this.fieldPreviewCache.get(clave);
    if (enCache) return enCache;
    const html = this.sanitizer.bypassSecurityTrustHtml(
      fieldPreviewSvg(field, this.orientationForField(field)),
    );
    this.fieldPreviewCache.set(clave, html);
    return html;
  }
  private readonly fieldPreviewCache = new Map<string, SafeHtml>();

  /** Estado seleccionado de una tarjeta de la galería de campos. */
  protected fieldSelected(f: FieldType): boolean {
    return this.field() === f;
  }

  /** Icono de respaldo (solo si la miniatura vectorial no tiene forma conocida). */
  private materialIcon(id: string): string {
    return MATERIALS.find((m) => m.id === id)?.icon ?? 'category';
  }

  // Fase 5 — se elimina el selector Propio/Rival: la diferenciación entre
  // equipos es SOLO por color. `genericColor` es el color de la última ficha de
  // color pulsada (lo usan las formaciones); `formationMirror` controla el
  // espejo en X de la formación (geometría "rival"), no el lado.

  /** Color genérico seleccionado (última ficha de color pulsada). */
  protected readonly genericColor = signal<string>(QUICK_GENERIC_COLORS[0]?.c ?? '#1a73e8');
  /** Espejo en X de la formación (true = geometría rival; el color ya distingue). */
  protected readonly formationMirror = signal<boolean>(false);
  protected setFormationMirror(b: boolean): void {
    this.formationMirror.set(b);
  }

  // Colocación de jugadores de la bandeja/genéricos: ahora ARRMAN el emplazamiento
  // (armRosterPlayer / armGenericColor) en lugar de auto-colocar en una fila. La
  // posición la decide el clic sobre el campo (ver armRosterPlayer/armGenericColor).

  // ---------- Historial (undo/redo) ----------

  private beginHistory(): void {
    this.gestureBase = this.docSnapshot();
    // Copia del historial ANTES de abrir la transacción: `snapshot()` vacía la pila de rehacer,
    // y una cancelación (Escape) tiene que poder devolverla a como estaba.
    this.historyBase = this.history.capture();
    this.history.snapshot(this.gestureBase);
  }
  private endHistory(): void {
    // Solo registrar en el historial si el gesto realmente modificó el documento.
    // Un clic para seleccionar (sin arrastrar) no debe crear una entrada de undo.
    const current = this.docSnapshot();
    const changed = !!(
      this.gestureBase && JSON.stringify(this.gestureBase) !== JSON.stringify(current)
    );
    if (changed) {
      this.history.commit(current);
      this.markDirty();
    }
    this.gestureBase = null;
    this.historyBase = null;
  }
  /** Snapshot de documento (campo + orientación + frames) usado por el historial. */
  private docSnapshot(): BoardSnapshot {
    return { field: this.field(), orientation: this.orientation(), frames: this.frames() };
  }
  private restoreSnapshot(s: BoardSnapshot): void {
    this.field.set(s.field);
    this.orientation.set(s.orientation);
    this.frames.set(s.frames);
  }

  protected undo(): void {
    const prev = this.history.getUndo();
    if (prev) this.restoreSnapshot(prev);
    this.clearSelection();
  }

  protected redo(): void {
    const next = this.history.getRedo();
    if (next) this.restoreSnapshot(next);
    this.clearSelection();
  }

  // ---------- Atajos de teclado ----------

  @HostListener('window:keydown', ['$event'])
  onKeydown(evt: KeyboardEvent): void {
    const t = evt.target as HTMLElement | null;
    const editing =
      !!t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable);
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
      // Si hay un gesto de UN puntero EN CURSO (mover/redimensionar con ratón o pluma, o el
      // gesto de un dedo), Escape lo CANCELA restaurando el estado previo al gesto: no basta
      // con limpiar la selección, porque el objeto seguiría al puntero hasta soltar y, si se
      // soltara sobre la papelera, se borraría.
      if (this.cancelActiveGesture()) return;
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
    if (t !== 'select') {
      // La selección se limpia ENTERA. Antes solo se anulaba `selectedId`, pero el inspector y las
      // asas del campo se pintan desde `selectedIds`: tras cambiar de herramienta y volver a
      // «Seleccionar» aparecían las asas y el contorno de un elemento que ya no se podía ni
      // redimensionar ni editar (el asa se movía en balde y todo el inspector era un no-op
      // silencioso). Una sola verdad: sin elemento seleccionado, sin asas ni inspector.
      this.selectedId.set(null);
      this.selectedIds.set([]);
    }
    if (t !== 'hand') this.handDragging.set(false);
    // Fase 3: cambiar a Seleccionar o a Desplazar campo FINALIZA la colocación
    // continua (armed se limpia: ya no se crean más elementos al tocar el campo).
    if (t === 'select' || t === 'hand') this.armed.set(null);
    // Fase 4: cambiar de herramienta oculta la previsualización del cursor.
    this.cursorScreen.set(null);
    // Cambiar de herramienta aborta cualquier pulsación larga pendiente.
    this.cancelLongPress();
  }

  // ---------- Emplazamiento armado (jugadores / materiales / genéricos) ----------

  /** Texto de la pista mostrada mientras hay un emplazamiento armado. Durante un arrastre
   *  activo desde el panel la pista cambia a "Suelta en el campo…" (aún no se ha colocado
   *  nada hasta el drop); con la herramienta armada por ratón en escritorio se mantiene
   *  "Toca el campo…" (colocación continuada). */
  protected armedLabel(): string {
    const a = this.armed();
    if (!a) return '';
    if (this.panelDrag()) return `Suelta en el campo para colocar ${a.label}`;
    return `Toca el campo para colocar a ${a.label}`;
  }

  /** Cancela el emplazamiento armado (Escape o re-tocar la herramienta): no crea nada. */
  protected cancelArm(): void {
    if (!this.armed()) return;
    this.armed.set(null);
    this.cursorScreen.set(null);
    this.setTool('select');
    this.notify('Colocación cancelada.');
    this.cdr.detectChanges();
  }

  /** Arma la colocación al elegir una herramienta de un solo uso desde un panel. */
  protected armForTool(id: Tool): void {
    if (id === 'player') {
      this.armed.set({ tool: 'player', label: 'Jugador', player: { c: '#1a73e8' } });
    } else if (id === 'text') {
      this.armed.set({ tool: 'text', label: 'Texto' });
    } else {
      this.armed.set({ tool: id, label: toolTitle(id) });
    }
  }

  // ---------- FASE B: arrastrar una unidad desde el panel al campo ----------
  // Los catálogos persistentes permiten ARRASTRAR una ficha/material desde el panel
  // hasta el campo: cada arrastre que suelta sobre el campo coloca EXACTAMENTE UNA
  // unidad en el punto de soltado. El panel permanece abierto.
  // Regla por tipo de puntero:
  //   - TÁCTIL ("móvil"): un arrastre coloca UNA unidad y DESARMA la herramienta y pasa
  //     a Cursor/Seleccionar (un toque posterior sobre el campo no coloca otra; para la
  //     siguiente unidad hay que volver a arrastrarla desde el panel).
  //   - RATÓN/LÁPIZ ("escritorio"): se conserva la colocación CONTINUADA (la herramienta
  //     sigue armada; el siguiente arrastre/click coloca otra).
  // `pointerType` se conserva en el estado del arrastre para decidir la regla al soltar.
  protected readonly panelDrag = signal<{
    spec: PanelDragSpec;
    pointerId: number;
    overHost: boolean;
    pointerType: string;
  } | null>(null);
  /** Gestión PENDIENTE del puntero bajado sobre un elemento del panel: todavía NO se
   *  arrastra (ni se arma la herramienta ni se captura el puntero). Solo al superar el
   *  umbral de movimiento se convierte en un arrastre real; mientras tanto la pulsación
   *  larga (variantes/color) y el scroll del panel siguen funcionando. */
  private panelDragPending: {
    spec: PanelDragSpec;
    pointerId: number;
    startClient: { x: number; y: number };
    pointerType: string;
  } | null = null;
  /** Elemento del panel que inició el gesto (destino de `setPointerCapture`). Se captura
   *  desde la BAJADA para que el arrastre siga aunque salga del panel; el estado sigue
   *  PENDIENTE (no arma ni coloca nada) hasta superar el umbral de movimiento. */
  private panelDragSourceEl: Element | null = null;
  /** Bandera: el click que sigue a un arrastre REAL desde el panel no debe re-armar. */
  private suppressClickAfterDrag = false;
  /** El último toque PENDIENTE del panel fue TÁCTIL: un toque corto en móvil NO debe armar
   *  una colocación (solo un arrastre completo coloca); en escritorio el click sí arma la
   *  colocación continuada. La activación por teclado no pasa por pointerdown → es false. */
  private panelTapTouch = false;
  /** Punteros TÁCTILES nacidos en el PANEL (separados de `activePointers`, que solo ve el
   *  campo). Permiten detectar un SEGUNDO dedo durante un arrastre desde el panel y evitar
   *  mezclar un puntero del panel con uno del campo en un pinch. */
  private panelPointers = new Map<number, { x: number; y: number }>();

  /** Arranca el gesto al bajar sobre un elemento del panel: crea un estado PENDIENTE y
   *  NO ejecuta la colocación todavía (no arma la herramienta, no muestra preview). El
   *  puntero se captura para que el arrastre siga aunque salga del panel, pero se respeta
   *  la pulsación larga (variantes/color), el scroll del panel y el tap que arma la
   *  colocación. El arrastre real (armar + colocar) empieza al superar el umbral de
   *  movimiento (ver `beginActivePanelDrag`). */
  protected beginPanelDrag(spec: PanelDragSpec, evt: PointerEvent): void {
    if (evt.button !== 0 && evt.pointerType !== 'touch') return;
    if (spec.tool === 'text') return; // el texto es de un solo uso: no se arrastra
    // Cada nuevo gesto del panel descarta la marca de "toque anterior táctil" (solo debe
    // reflejar el tap inmediatamente anterior que el click va a consumir).
    this.panelTapTouch = false;
    if (evt.pointerType === 'touch') {
      // SEGUNDO dedo táctil: si ya hay otro puntero táctil activo (en el campo o en el
      // panel), NO se inicia un arrastre fantasma. Se cancela el gesto de panel existente
      // y se vuelve a Cursor, sin colocar (Defecto 2).
      if (this.totalActiveTouch() >= 1) {
        this.cancelPanelGesture();
        return;
      }
      this.panelPointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    }
    this.panelDragPending = {
      spec,
      pointerId: evt.pointerId,
      startClient: { x: evt.clientX, y: evt.clientY },
      pointerType: evt.pointerType,
    };
    this.panelDragSourceEl = evt.currentTarget as Element | null;
    // Capturar el puntero desde la BAJADA para que el arrastre siga aunque salga del
    // panel (el gesto sigue PENDIENTE: aún no arma ni coloca nada hasta superar el umbral).
    try {
      this.panelDragSourceEl?.setPointerCapture?.(evt.pointerId);
    } catch {
      /* setPointerCapture no disponible/no válido: no bloquea el gesto */
    }
    // En ratón/lápiz se impide la selección de texto del panel; en táctil NO se previene
    // la acción por defecto para no bloquear el scroll nativo del panel (el arrastre se
    // gestiona solo al superar el umbral).
    if (evt.pointerType !== 'touch') evt.preventDefault();
  }
  /** Convierte la gestión pendiente en un arrastre REAL: arma la colocación (para la
   *  previsualización y el tap sobre el campo), captura el puntero para seguir el
   *  movimiento aunque salga del panel y cancela cualquier pulsación larga en curso. */
  private beginActivePanelDrag(
    pend: {
      spec: PanelDragSpec;
      pointerId: number;
      startClient: { x: number; y: number };
      pointerType: string;
    },
    evt: PointerEvent,
  ): void {
    const { spec, pointerId } = pend;
    this.panelDragPending = null;
    // Un arrastre real cancela cualquier pulsación larga pendiente (variantes/color).
    this.endBarPress();
    this.armed.set(
      spec.player
        ? { tool: spec.tool, label: spec.label, player: spec.player }
        : { tool: spec.tool, label: spec.label },
    );
    this.setTool(spec.tool);
    this.panelDrag.set({ spec, pointerId, overHost: false, pointerType: pend.pointerType });
    this.cursorScreen.set({ x: pend.startClient.x, y: pend.startClient.y });
    // Con pointerId sintético (e2e que despachan PointerEvents a mano) setPointerCapture
    // puede lanzar; sin captura el gesto sigue siendo usable.
    try {
      (this.panelDragSourceEl ?? (evt.currentTarget as Element | null))?.setPointerCapture?.(
        pointerId,
      );
    } catch {
      /* setPointerCapture no disponible/no válido: no bloquea el arrastre */
    }
    this.cdr.detectChanges();
  }
  /** Sigue el gesto: si aún está PENDIENTE y supera el umbral, lo convierte en arrastre
   *  real; si ya arrastra, actualiza la previsualización junto al cursor y detecta si se
   *  está sobre el campo (suelta = colocar). */
  protected trackPanelDrag(evt: PointerEvent): void {
    const pend = this.panelDragPending;
    if (pend && pend.pointerId === evt.pointerId) {
      const d = Math.hypot(evt.clientX - pend.startClient.x, evt.clientY - pend.startClient.y);
      if (d > this.TOUCH_TAP_SLOP) {
        this.beginActivePanelDrag(pend, evt);
      } else {
        return; // aún pendiente: no colocar/seleccionar/mover nada
      }
    }
    const d = this.panelDrag();
    if (!d || d.pointerId !== evt.pointerId) return;
    this.cursorScreen.set({ x: evt.clientX, y: evt.clientY });
    const over = this.isOverField(evt.clientX, evt.clientY);
    if (over !== d.overHost) this.panelDrag.set({ ...d, overHost: over });
    this.cdr.detectChanges();
  }
  /** Suelta el arrastre: si el gesto seguía PENDIENTE no hubo arrastre (deja que el click
   *  posterior arme la colocación); si fue un arrastre real, coloca UNA unidad al soltar
   *  sobre el campo. */
  protected endPanelDrag(evt: PointerEvent): void {
    const pend = this.panelDragPending;
    if (pend && pend.pointerId === evt.pointerId) {
      // Sin arrastre (toque corto): no colocamos nada. El click posterior (barToolClick /
      // armRosterPlayer / armGenericColor) conserva la acción de selección; en TÁCTIL ese
      // click NO debe armar una colocación (Defecto 1), por eso se marca `panelTapTouch`.
      this.panelTapTouch = pend.pointerType === 'touch';
      this.panelDragPending = null;
      this.panelDragSourceEl = null;
      this.panelPointers.delete(pend.pointerId);
      return;
    }
    const d = this.panelDrag();
    if (!d || d.pointerId !== evt.pointerId) return;
    this.panelDrag.set(null);
    this.cursorScreen.set(null);
    this.panelDragSourceEl = null;
    this.panelPointers.delete(d.pointerId);
    // Un segundo dedo táctil mientras se suelta no debe crear una colocación fantasma:
    // se cancela el drop (sin colocar) y se pasa a Cursor; el pinch sigue gobernando.
    if (evt.pointerType === 'touch' && this.activeTouchCount() >= 2) {
      this.setTool('select');
      this.cdr.detectChanges();
      return;
    }
    const droppedOnHost = this.isOverField(evt.clientX, evt.clientY);
    // El click posterior (que la app ya no usa para catálogos persistentes) no debe
    // re-armar la colocación tras un arrastre real: lo anulamos con esta bandera.
    this.suppressClickAfterDrag = droppedOnHost;
    if (droppedOnHost) {
      const p = this.normForClient(evt.clientX, evt.clientY);
      this.beginHistory();
      if (d.spec.player) this.placePlayerElement(p, d.spec.player);
      else this.addAt(p);
      this.endHistory();
      // FASE B (táctil): un arrastre coloca EXACTAMENTE UNA unidad y DESARMA la
      // herramienta, pasando a Cursor/Seleccionar (un toque posterior sobre el campo no
      // coloca otra; para la siguiente unidad hay que volver a arrastrarla desde el panel).
      // En ratón/lápiz (escritorio) se conserva la colocación CONTINUADA (sigue armado).
      // EXCEPCIÓN (invariante): un jugador REAL de plantilla (con playerId) es de
      // instancia única y se desarma con cualquier puntero tras soltarlo.
      if (evt.pointerType === 'touch' || d.spec.player?.playerId) {
        this.armed.set(null);
        this.setTool('select');
      }
      this.cdr.detectChanges();
    }
  }
  /** ¿Está el punto de pantalla sobre el campo VISIBLE (dentro del host pero NO sobre un
   *  panel/menú solapado)? El host va por detrás de los paneles, así que comprobar solo
   *  su rectangulo daría falsos "sobre el campo" al interactuar con el propio panel. */
  private isOverField(x: number, y: number): boolean {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return false;
    const r = hostEl.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    const overlays = document.querySelectorAll<HTMLElement>(
      '.side-panel, .top-pop, .tools-panel-side',
    );
    for (const el of Array.from(overlays)) {
      const rr = el.getBoundingClientRect();
      if (x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom) return false;
    }
    return true;
  }
  /** Libera el puntero cancelando el gesto (sin colocar), tanto si estaba pendiente como
   *  si ya había empezado a arrastrar. Limpia también el registro de punteros del panel.
   *  En TÁCTIL un gesto cancelado DESARMA y vuelve a Cursor (no debe poder colocar con un
   *  toque posterior); en ratón/lápiz se conserva el estado de escritorio. */
  protected cancelPanelDrag(evt: PointerEvent): void {
    const pend = this.panelDragPending;
    const matchedPending = pend && pend.pointerId === evt.pointerId;
    if (matchedPending) {
      this.panelDragPending = null;
      this.panelPointers.delete(pend!.pointerId);
    }
    const d = this.panelDrag();
    const matchedDrag = d && d.pointerId === evt.pointerId;
    if (matchedDrag) {
      this.panelDrag.set(null);
      this.cursorScreen.set(null);
      this.panelPointers.delete(d!.pointerId);
    }
    this.panelDragSourceEl = null;
    if (evt.pointerType === 'touch' && (matchedPending || matchedDrag)) {
      this.armed.set(null);
      this.setTool('select');
    }
    this.cdr.detectChanges();
  }
  /** Consume la bandera de "click tras arrastre" (devuelve true y la resetea). */
  protected panelDragClickConsumed(): boolean {
    const s = this.suppressClickAfterDrag;
    this.suppressClickAfterDrag = false;
    return s;
  }
  /** Consume la bandera "el último toque del panel fue táctil" (devuelve true y la resetea). */
  private consumePanelTapTouch(): boolean {
    const v = this.panelTapTouch;
    this.panelTapTouch = false;
    return v;
  }
  /** Cancela por completo un gesto de panel (p. ej. llega un SEGUNDO dedo): limpia el
   *  estado pendiente/activo, la preview y los punteros del panel, DESARMA y vuelve a
   *  Cursor. Al no haber drop no se crea historial (sin historial fantasma). NO toca el
   *  pinch del campo: dos dedos iniciados íntegramente en el campo siguen gobernando. */
  private cancelPanelGesture(): void {
    this.panelDragPending = null;
    this.panelDrag.set(null);
    this.cursorScreen.set(null);
    this.panelDragSourceEl = null;
    this.panelPointers.clear();
    this.armed.set(null);
    this.setTool('select');
    this.cdr.detectChanges();
  }

  /** Tocar un jugador de plantilla: ARMA la colocación (aún no coloca) sin cerrar el
   *  panel Jugadores (FASE B: paneles persistentes). Conserva la regla de UNA instancia
   *  por playerId y el color/rol reales del jugador. */
  protected armRosterPlayer(p: Player): void {
    if (this.panelDragClickConsumed()) {
      this.panelTapTouch = false;
      return;
    } // fue un arrastre al campo
    if (this.placedPlayerIds().has(p.id)) return; // un jugador de plantilla, una sola instancia
    // Defecto 1: un toque corto TÁCTIL sobre un jugador de plantilla NO arma la colocación
    // (solo un arrastre completo lo coloca); en escritorio (ratón/teclado) sí arma.
    if (this.consumePanelTapTouch()) return;
    this.armed.set({
      tool: 'player',
      label: p.name,
      player: {
        n: p.number ?? 0,
        // FASE 2: el color de la ficha sale del mapa del EJERCICIO, no de la plantilla.
        c: this.colorDeJugadorDe(p),
        side: 'own',
        type: p.position === 'GK' ? 'goalkeeper' : undefined,
        playerId: p.id,
        label: p.name.slice(0, 10),
      },
    });
    this.setTool('player');
    // FASE B (paneles persistentes): tocar un jugador de plantilla arma la colocación
    // pero NO cierra el panel Jugadores; queda desplegado. El cierre lo decide el
    // usuario con el control explícito del panel.
    this.cdr.detectChanges();
  }

  /** Fase 12 — color rápido por jugador. Id del jugador cuya mini-paleta está abierta. */
  protected readonly rosterColorOpen = signal<string | null>(null);
  /**
   * FASE 2 del encargo — color de cada jugador de plantilla DENTRO de este ejercicio.
   *
   * El color elegido en la pizarra ya NO se escribe en la plantilla (`store.updatePlayer`): vive
   * en el documento del ejercicio. Cada ejercicio nuevo arranca con el mapa vacío, así que todos
   * los jugadores empiezan con su color por defecto y no heredan nada del ejercicio anterior.
   */
  protected readonly playerColors = signal<MapaColoresJugador>({});

  /** Paleta de la fila de un jugador de plantilla (azul, rojo, amarillo, naranja, morado). */
  protected readonly paletaJugador = PALETA_JUGADOR;

  /** Color con el que se pinta/coloca un jugador de plantilla en ESTE ejercicio. */
  protected colorDeJugadorDe(p: Pick<Player, 'id' | 'color'>): string {
    return colorDeJugador(this.playerColors(), p);
  }

  /** Abre/cierra la mini-paleta de color de un jugador de plantilla. */
  protected toggleRosterColor(id: string, evt: Event): void {
    evt.stopPropagation();
    this.rosterColorOpen.set(this.rosterColorOpen() === id ? null : id);
  }

  /**
   * Aplica un color a la ficha del jugador DENTRO DE ESTE EJERCICIO y a las fichas ya colocadas
   * con ese `playerId`.
   *
   * CONTRATO CORREGIDO (defecto del encargo): antes llamaba a `store.updatePlayer(id, { color })`,
   * de modo que elegir un color en la pizarra modificaba PERMANENTEMENTE al jugador de la
   * plantilla y, con él, todos los ejercicios. Ahora la plantilla no se toca nunca: el color se
   * guarda en el documento (`playerColors`) y se marca el documento como modificado para que se
   * persista al guardar.
   */
  protected setRosterColor(id: string, c: string, evt: Event): void {
    evt.stopPropagation();
    this.playerColors.set(conColorDeJugador(this.playerColors(), id, c));
    // Un jugador de plantilla colocado debe actualizar su color visible en el ejercicio.
    const repintadas = fichasDeJugador(this.frames(), id);
    if (repintadas > 0) this.frames.set(pintarFichasDeJugador(this.frames(), id, c));
    this.markDirty();
    this.rosterColorOpen.set(null);
  }

  /** C1: fichas rápidas de jugador GENERICO por color (azul/rojo/amarillo/verde/morado).
   *  Arma la colocación de un jugador genérico (sin nombre, sin dorsal fijo, sin playerId)
   *  cuyo color es el elegido. La diferenciación es por color, no por concepto comodín. */
  protected readonly quickGenericColors = QUICK_GENERIC_COLORS;

  /** Spec de arrastre de una ficha rápida genérica (sin nombre, dorsal, side ni type). */
  protected genericDragSpec(c: string, label: string): PanelDragSpec {
    return { tool: 'player', label: `Jugador ${label.toLowerCase()}`, player: { c } };
  }
  /** Spec de arrastre de un jugador de plantilla (no duplicable). */
  protected rosterDragSpec(p: Player): PanelDragSpec {
    return {
      tool: 'player',
      label: p.name,
      player: {
        n: p.number ?? 0,
        // FASE 2: el arrastre al campo también usa el color del EJERCICIO.
        c: this.colorDeJugadorDe(p),
        side: 'own',
        type: p.position === 'GK' ? 'goalkeeper' : undefined,
        playerId: p.id,
        label: p.name.slice(0, 10),
      },
    };
  }
  /** Spec de arrastre de un material (usa la variante/color recordados). */
  protected materialDragSpec(id: Tool): PanelDragSpec {
    return { tool: id, label: toolTitle(id) };
  }
  protected armGenericColor(c: string, label: string): void {
    // El color elegido se RECUERDA: lo usan las formaciones (genericColor) y la
    // colocación continua del genérico.
    if (this.panelDragClickConsumed()) {
      this.genericColor.set(c);
      this.panelTapTouch = false;
      return; // fue un arrastre al campo (ya colocó): no re-arma
    }
    const tapTouch = this.consumePanelTapTouch();
    this.genericColor.set(c);
    // Defecto 1: un toque corto TÁCTIL sobre un color genérico actualiza el color empleado
    // por las formaciones pero NO deja un jugador armado (solo un arrastre coloca).
    if (tapTouch) return;
    this.armed.set({ tool: 'player', label: `Jugador ${label.toLowerCase()}`, player: { c } });
    this.setTool('player');
    // FASE B (paneles persistentes): elegir un jugador genérico NO cierra el panel
    // Jugadores; queda desplegado para poder seguir eligiendo colores/materiales o
    // minimizarlo con su control explícito. El cierre lo decide el usuario.
    this.cdr.detectChanges();
  }

  /** Fase 7 — coloca una formación rápida como UNA única transacción de historial.
   *  Usa jugadores de plantilla disponibles (sin duplicar instancias ya colocadas) para
   *  el equipo propio, o genéricos rivales; si faltan, coloca los disponibles e informa. */
  /** ¿Es un portero (posición/role GK)? */
  private isGoalkeeper(p: { position?: string; type?: string }): boolean {
    return p.position === 'GK' || p.type === 'goalkeeper';
  }

  /** Fase 4 — coloca/reorganiza una formación como UNA única transacción de historial.
   *  Idempotente: aplicar la misma formación varias veces deja el mismo resultado.
   *  - Formaciones RÁPIDAS INDEPENDIENTES DE LA PLANTILLA (Fase 1): siempre 11 jugadores
   *    genéricos (portero + 10 de campo), SIN `playerId` ni `label`, sin consumir la
   *    plantilla. Funcionan incluso con `players()` vacío.
   *  - PROPIO: color propio configurado (accentColor del equipo, o azul por defecto).
   *  - RIVAL: color rival y posiciones reflejadas.
   *  - El portero ocupa la posición de portería (primera posición) y usa `goalkeeper`.
   *  - Idempotente/recoloca: reutiliza los jugadores GENÉRICOS de ese lado (los recoloca),
   *    nunca duplica; elimina el exceso de genéricos de ese lado.
   *  - NO elimina ni duplica jugadores REALES de plantilla (con `playerId`), sea cual sea
   *    su lado: quedan intactos y se conservan.
   *  - Una única transacción: un solo Deshacer revierte la formación completa. */
  protected applyFormation(formationId: string): void {
    // El color es el de la última ficha rápida pulsada (genericColor): la
    // diferenciación entre equipos es SOLO por color, sin selector Propio/Rival.
    const color = this.genericColor();
    const mirror = this.formationMirror();
    const specs = buildFormationPlayers(color, formationId, mirror);
    if (!specs) return;

    // Jugadores GENÉRICOS ya colocados del color de la formación (sin playerId):
    // se recolocan (idempotencia), nunca se duplican. Los reales de plantilla
    // (con playerId) se IGNORAN por completo.
    const genericsOfColor = this.view().filter(
      (e) => e.t === 'player' && !e.playerId && (e.c ?? '') === color,
    );
    // BLOQUEADO = intocable: los genéricos bloqueados del color no se recolocan, no se
    // borran como sobrantes y su hueco NO lo ocupa otro jugador (si no, aplicar una
    // formación movería justo lo que el usuario bloqueó a propósito).
    const locked = genericsOfColor.filter((e) => e.locked);
    const existing = genericsOfColor.filter((e) => !e.locked);
    const specsToFill = Math.max(0, specs.length - locked.length);

    this.beginHistory();
    const keptIds = new Set<string>();
    for (let i = 0; i < specsToFill; i++) {
      const { x, y, c } = specs[i];
      const rex = existing[i];
      if (rex) {
        // Recoloca el genérico existente del color (idempotencia) y limpia SOLO los campos
        // del modelo antiguo (rol/lado). El DORSAL (`n`) y la ETIQUETA que haya escrito el
        // usuario NO se tocan: son suyos, y la formación no asigna ninguno (antes se
        // borraba el dorsal al reaplicar).
        this.updateElement(rex.id, { x, y, c, side: undefined, type: undefined });
        keptIds.add(rex.id);
      } else {
        // Crea el genérico (sin playerId ni label, sin dorsal ni side): CÍRCULO del color.
        const spec: PlayerPlacement = { c };
        const elId = this.placePlayerElement({ x, y }, spec);
        keptIds.add(elId!);
      }
    }
    // Eliminar los genéricos del color que quedaron FUERA de la formación (exceso).
    const excess = existing.filter((e) => !keptIds.has(e.id));
    if (excess.length) this.removeElements(excess.map((e) => e.id));
    this.endHistory();

    // La formación es genérica y no depende de la plantilla: no hay mensaje de
    // "faltan en plantilla". Tras aplicarla se pasa a Seleccionar.
    this.setTool('select');
  }

  protected readonly formations = FORMATIONS;

  private buildPlayerElement(p: { x: number; y: number }, spec: PlayerPlacement): CanvasElement {
    return {
      id: uid(),
      t: 'player',
      x: this.clampStrip(p.x),
      y: this.clampStrip(p.y),
      n: spec.n,
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
      patch.h = Math.max(
        el.h ?? DEFAULT_TEXT_H,
        this.autoHForText(v, el.size ?? DEFAULT_TEXT_SIZE, el.w),
      );
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
      // Fase 10: el relleno usa EXACTAMENTE el mismo color que el perímetro → se
      // sincroniza al cambiar el color, para que el modelo guardado coincida.
      this.editSelected({ c, fillColor: c });
    } else {
      this.editSelected({ c });
    }
  }

  protected setSelFill(fill: boolean): void {
    // fill:false → solo perímetro; fill:true → relleno (mantiene fillColor/fillOpacity).
    this.editSelected({ fill });
  }
  protected setSelFillColor(c: string): void {
    this.editSelected({ fillColor: c });
  }
  protected setSelFillOpacity(o: number): void {
    this.editSelected({ fillOpacity: Math.max(0, Math.min(1, o)) });
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

  /** Ancho normalizado → porcentaje con UNA decimal (0.3 → 30, 0.28868… → 28.9).
   *  Solo redondea la PRESENTACIÓN; el modelo conserva el valor preciso. */
  protected selWPct(): number {
    return Math.min(100, Math.max(2, normalizedToPct(this.selectedElement()?.w ?? 0)));
  }
  /** Alto normalizado → porcentaje con UNA decimal. */
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
    this.editSelected({
      strokeWidth: Number.isNaN(v)
        ? DEFAULT_STROKE_WIDTH
        : Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, v)),
    });
  }

  protected setSelLineStyle(style: 'solid' | 'dashed' | 'dotted'): void {
    this.editSelected({ lineStyle: style });
  }

  protected duplicateSelected(): void {
    const el = this.selectedElement();
    if (!el) return;
    // Un jugador de Plantilla nunca se duplica visualmente: se bloquea con aviso.
    if (el.t === 'player' && el.playerId) {
      this.notify('No se puede duplicar un jugador de la plantilla: ya está en el campo.');
      return;
    }
    // Un elemento BLOQUEADO tampoco: el clon se copia entero (incluido `locked`) y nacería
    // inmóvil, así que «Duplicar» solo añadiría un objeto que no se puede mover ni editar. La
    // intención ya estaba escrita en `duplicateElementEl`, pero este camino —el único real— no la
    // cumplía; ahora se comparte el candado `canDuplicateElement`.
    if (!this.canDuplicateElement(el)) {
      this.notify('El elemento está bloqueado: desbloquéalo para poder duplicarlo.');
      return;
    }
    this.beginHistory();
    this.addElement({ ...translateElement(el, 0.04, 0.04), id: uid() });
    this.endHistory();
  }

  /** Gira el elemento seleccionado EXACTAMENTE ±90° (un paso) como UNA acción de
   *  historial. Se usa desde la barra de contexto (botones ±90°). */
  protected rotateSelected(deg: 90 | -90 | 45 | -45): void {
    const el = this.selectedElement();
    if (!el || el.locked || FIXED_UPRIGHT_TYPES.has(el.t)) return;
    // BLOQUE D2: se admite ±45° además de ±90°. `normalizeRotation` normaliza a [0,360)
    // (un giro de -45 queda en 315, -90 en 270, etc.), de modo que el PNG y el modelo
    // reabierto coinciden con lo que el usuario ve (rotación exacta, no acumulación).
    this.editSelected({ rot: normalizeRotation((el.rot ?? 0) + deg) });
  }

  protected canRotateSelected(): boolean {
    const el = this.selectedElement();
    return !!el && !el.locked && !FIXED_UPRIGHT_TYPES.has(el.t);
  }

  private selCenter(el: CanvasElement): { x: number; y: number } {
    return selCenter(el);
  }

  /** Asas/nasas de selección (SVG) del elemento seleccionado. Fase 6: se RETIRA la manija
   *  de rotación continua (la rotación pasa a la barra de contexto, ±90°) y las asas de
   *  redimensionado se dibujan MÁS PEQUEÑAS (1.2×1.2 u de viewBox) manteniendo un área
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

  private resizeHandleAt(
    el: CanvasElement,
    p: { x: number; y: number },
    screenPx = 10,
  ): string | null {
    // FASE 9: la tolerancia del asa se define EN PANTALLA (px) y se convierte según zoom,
    // con un área táctil CONSTANTE en px (ratón ~10, táctil ~16) en vez del 0.045 norm,
    // que crecía con la magnificación y hacía que asas próximas se solaparan entre sí.
    const tol = this.resizeTolNorm(screenPx);
    for (const h of resizeHandles(el, this.geo().rect)) {
      if (Math.hypot(p.x - h.x, p.y - h.y) < tol) return h.key;
    }
    return null;
  }

  /** Tolerancia en NORM para `screenPx` px de pantalla, según zoom/escala del host. */
  private resizeTolNorm(screenPx: number): number {
    const hostEl = this.host()?.nativeElement as HTMLElement | undefined;
    if (!hostEl) return 0.045;
    const r = hostEl.getBoundingClientRect();
    const g = this.geo();
    const fit = this.fillScreen() ? 'height' : 'contain';
    const s = fit === 'height' ? this.fillScale(r, g) : Math.min(r.width / g.vbW, r.height / g.vbH);
    const t = screenPxToNormTolerance({ zoom: this.zoom(), scale: s, rect: g.rect }, screenPx);
    return Math.max(t.x, t.y);
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
      if (anyLocked)
        this.notify('Elemento bloqueado: desbloquéalo desde Propiedades para eliminarlo.');
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
        // FASE 7: limpiar la pizarra deja el título vacío (el placeholder "Nueva pizarra"
        // se vuelve a mostrar; no se conserva ningún título literal).
        this.metaTitle.set('');
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
      // FASE 2: los colores de jugador de ESTE ejercicio viajan dentro del documento.
      playerColors: this.playerColors(),
    };
  }

  protected async saveToExercise(navigate = true): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    this.saved.set(false);
    // A5: guardar SIN título queda BLOQUEADO. Se avisa, se abre Propiedades, se enfoca el
    // campo de título y se permanece en la pizarra (no se crea ningún ejercicio con el
    // título vacío y no se marca como guardado). El placeholder "Nueva pizarra" sigue
    // siendo solo texto de presentación, nunca el valor guardado.
    const t = (this.metaTitle() ?? '').trim();
    if (!t) {
      this.notify('Pon un título al ejercicio para identificarlo mejor.');
      this.openPropsPanel();
      this.focusTitleField();
      this.saving.set(false);
      return false;
    }
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
      let persisted: boolean;
      if (this.editExerciseId) {
        const existing = this.store.exercises().find((e) => e.id === this.editExerciseId);
        if (!existing) {
          this.notify(
            'No se encontró el ejercicio a actualizar. Reintenta o vuelve a la biblioteca.',
          );
          this.saving.set(false);
          return false; // no navegar, no limpiar dirty
        }
        persisted = await this.store.saveExercise({
          ...existing,
          title: t,
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
          title: t,
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
        persisted = await this.store.saveExercise(ex);
      }
      if (!persisted) {
        this.notify(
          'No se confirmó el guardado en tu cuenta. Revisa el aviso y vuelve a intentarlo.',
        );
        this.saving.set(false);
        return false;
      }
    } catch (err) {
      // No abandonar ni limpiar el estado sucio si falla la persistencia.
      this.notify(
        'No se pudo guardar el ejercicio. Revisa el almacenamiento del navegador e inténtalo de nuevo.',
      );
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
      }).replace('class="entrenolab-board"', `width="${w}" height="${h}" class="entrenolab-board"`),
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
    // FASE 7: nombre del PNG derivado del título REAL del ejercicio (limpio para Windows);
    // si no hay título, `metaTitle()` es '' → `pngFileName('')` = 'cdmplab-pizarra.png'
    // (NUNCA 'nueva-pizarra.png': ese texto es solo el placeholder de la cabecera).
    a.download = pngFileName(this.metaTitle() ?? '');
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
    this.activePointers.set(evt.pointerId, {
      x: evt.clientX,
      y: evt.clientY,
      type: evt.pointerType,
    });

    // SEGUNDO DEDO durante un gesto de PANEL (Defecto 2): se cancela el gesto del panel
    // (sin colocar, sin armar, a Cursor) y NO se mezcla en un pinch. Un puntero del panel +
    // uno del campo no forman un pinch (no entran juntos en `activePointers`); dos dedos
    // iniciados íntegramente en el campo sí mantienen su pinch.
    if (
      evt.pointerType === 'touch' &&
      (this.panelDragPending || this.panelDrag()) &&
      this.totalActiveTouch() >= 2
    ) {
      this.cancelPanelGesture();
      return;
    }

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

    // TÁCTIL: el primer dedo crea una GESTIÓN PENDIENTE y NO ejecuta la acción
    // (colocar/seleccionar/mover). Se confirma al levantar (tap) o al superar el
    // umbral (arrastre), y se DESCARTAla si llega un segundo dedo.
    if (evt.pointerType === 'touch') {
      this.beginTouchPending(evt);
      return;
    }

    // Mouse / lápiz: comportamiento inmediato (se ejecuta en el propio pointerdown).
    this.beginSinglePointerDown(
      evt.clientX,
      evt.clientY,
      this.toNorm(evt),
      evt.shiftKey,
      evt.pointerId,
      evt.timeStamp,
    );
  }

  /** Ejecuta la acción de UN puntero al BAJAR (colocar/seleccionar/empezar a mover/
   *  dibujar/rotar/redimensionar/patear). `clientX/clientY` son las de PANTALLA y `p`
   *  la normalizada del MISMO punto: así un gesto táctil diferido puede arrancar desde
   *  el punto ORIGINAL de bajada en vez del punto al que ya se movió. */
  private beginSinglePointerDown(
    clientX: number,
    clientY: number,
    p: { x: number; y: number },
    shift: boolean,
    pointerId: number,
    eventStamp: number,
    // Cuando el gesto viene de un DEDO, el plan se decidió con tolerancias táctiles (16 px en las
    // asas, 9 px al objeto) y aquí hay que usar LAS MISMAS: si se re-decide con las de ratón (10 y
    // 4), un dedo que empieza el arrastre en esa franja obtiene plan de mover/redimensionar pero la
    // ejecución no encuentra ni asa ni objeto, así que se DESELECCIONA y no se mueve nada.
    fromTouch = false,
  ): void {
    const tolAsa = fromTouch ? 16 : 10;
    const tolHit = fromTouch ? 9 : 4;
    // Fase 3: cualquier interacción sobre el campo cierra el menú contextual (tocar fuera).
    this.closeCtxMenu();

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
        const rKey = selEl ? this.resizeHandleAt(selEl, p, tolAsa) : null;
        if (selEl && rKey && !selEl.locked) {
          this.beginHistory();
          this.resizing = true;
          this.resizeKey = rKey;
          this.resizeId = selEl.id;
          this.moveStart = { x: p.x, y: p.y };
          this.resizeStartSize =
            selEl.t !== 'text' && this.isPointLike(selEl.t)
              ? (selEl.size ?? materialSize(selEl))
              : null;
          this.resizeStartPoints =
            selEl.t === 'freehand' ? ((selEl.points ?? []) as [number, number][]) : null;
          break;
        }
        // Los elementos bloqueados siguen siendo SELECCIONABLES (para poder
        // desbloquearlos desde el inspector), pero no se mueven/editan/borran.
        const hit = this.hitTestNorm(p, this.view(), tolHit);
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
            // BLOQUE D2: DOBLE CLIC con ratón/pluma → abrir el menú contextual del elemento.
            // Dos clics sobre el MISMO elemento dentro del umbral abren el menú (en vez de
            // solo seleccionar). Un clic lento/simple no dispara nada adicional.
            //
            // El instante se toma del EVENTO (`timeStamp`), no del momento en que corre el
            // manejador: si el hilo principal está ocupado (el primer clic abre el inspector
            // y repinta), medir `performance.now()` aquí hacía que dos clics REALMENTE
            // seguidos se vieran como dos clics sueltos y el menú no se abría. Era la
            // intermitencia que aparecía solo en la suite completa.
            const now = eventStamp;
            if (
              this.dblClick &&
              this.dblClick.id === hit &&
              now - this.dblClick.time <= BoardComponent.DBL_CLICK_MS
            ) {
              this.dblClick = null;
              this.openCtxMenu();
            } else {
              this.dblClick = { id: hit, time: now };
            }
          }
          this.moveGestureBegun = false;
          // Fase 7: pulsación larga sobre un objeto → DUPLICAR (si se mantiene sin
          // moverse). Se arma en el pointerdown para medir el tiempo desde la bajada.
          this.startLongPress(pointerId, clientX, clientY, hit);
        } else if (!shift) {
          // Fase 5: vacío (ni objeto ni asa) en Seleccionar → DESELECCIONAR. NUNCA se
          // inicia paneo (panGestureStart NO se fija): arrastrar desde vacío no mueve
          // la vista, aunque el campo sea mayor que la pantalla o el zoom >100 %.
          //
          // Doble clic ROBUSTO: si este segundo clic no acierta ningún objeto (el hit-test
          // de materiales es fino) pero cae DENTRO de la caja actual del MISMO objeto del
          // clic anterior, sigue siendo un doble clic SOBRE ESE objeto —aunque la
          // disposición haya cambiado entre ambos clics—. No se relaja la condición: el
          // punto tiene que estar DENTRO de su caja, no «cerca».
          const pend = this.dblClick;
          const pendEl = pend ? this.view().find((e) => e.id === pend.id) : undefined;
          const bb = pendEl ? this.elNormBBox(pendEl) : null;
          const inside = !!bb && p.x >= bb.x0 && p.x <= bb.x1 && p.y >= bb.y0 && p.y <= bb.y1;
          if (pend && pendEl && inside && eventStamp - pend.time <= BoardComponent.DBL_CLICK_MS) {
            this.dblClick = null;
            this.setSingleSelection(pend.id);
            this.openCtxMenu();
          } else {
            this.clearSelection();
          }
        }
        break;
      }
      case 'player':
      case 'ball':
      case 'cone':
      case 'mannequin':
      case 'mannequin_row':
      case 'minigoal':
      case 'goal':
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
      case 'dumbbell':
        this.beginHistory();
        const armedBefore = this.armed();
        const id = armedBefore?.player
          ? this.placePlayerElement(p, armedBefore.player)
          : this.addAt(p);
        this.endHistory();
        // Fase 3 (COLOCACIÓN CONTINUA): tras emplazar, el material/jugador genérico
        // SIGUE armado y NO se pasa a Seleccionar, NI se auto-selecciona (no abre
        // Propiedades, no muestra asas). Cada colocación ya registró su propia
        // operación de Deshacer (beginHistory/endHistory por clic). El modo termina
        // solo cuando el usuario pulsa Seleccionar/Desplazar/otra herramienta/Escape.
        // EXCEPCIÓN (invariante): un jugador REAL de plantilla (con playerId) NO es
        // duplicable → tras colocarlo se desarma y vuelve a Seleccionar (una instancia).
        if (armedBefore?.player?.playerId) {
          this.armed.set(null);
          this.setTool('select');
        }
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
        // La herramienta del borrador se CAPTURA aquí (antes de mostrarlo) y es la que decide
        // qué se crea al soltar y qué pinta la previsualización: la activa puede cambiar a
        // mitad del trazo (p. ej. mantener ESPACIO pasa a Mano).
        this.dragTool = this.tool();
        this.drag.set({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        this.freehandPts = [[p.x, p.y]];
        break;
      case 'erase': {
        this.beginHistory();
        const hit = this.hitTestNorm(p, this.unlockedView(), 4);
        if (hit) this.removeElement(hit);
        this.endHistory();
        break;
      }
    }
  }

  // ---------- Gestión táctil (dedo único ↔ pinch) ----------

  /** Cablea el toque táctil inicial: en vez de ejecutar la acción, guarda la "gestión
   *  pendiente" con todo lo necesario para confirmar un tap, arrancar el arrastre o
   *  descartarla. El documento NO se modifica todavía. */
  private beginTouchPending(evt: PointerEvent): void {
    const p = this.toNorm(evt);
    const tool = this.tool();
    const armed = this.armed();
    const shift = evt.shiftKey;

    // Como en el comportamiento inmediato, tocar el campo con una herramienta (no
    // Seleccionar) cierra el menú contextual. Es un efecto de vista, no de modelo.
    this.closeCtxMenu();

    this.touchPending = {
      pointerId: evt.pointerId,
      startClient: { x: evt.clientX, y: evt.clientY },
      startNorm: p,
      stamp: evt.timeStamp,
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
    if (
      gp.plan.kind !== 'selectMove' &&
      gp.plan.kind !== 'selectMultiShift' &&
      gp.plan.kind !== 'moveGroup'
    )
      return;
    const hit =
      gp.plan.kind === 'moveGroup' ? this.hitTestNorm(gp.startNorm, this.view(), 9) : gp.plan.hitId;
    if (hit) this.startLongPress(gp.pointerId, gp.startClient.x, gp.startClient.y, hit);
  }

  /** Decide QUÉ hará el gesto de un dedo, sin ejecutarlo aún (solo lo clasifica). */
  private computeTouchPlan(
    p: { x: number; y: number },
    tool: Tool,
    armed: ArmedPlacement | null,
    shift: boolean,
  ): TouchPlan {
    switch (tool) {
      case 'select': {
        const selEl = this.selectedElement();
        const rKey = selEl ? this.resizeHandleAt(selEl, p, 16) : null;
        if (selEl && rKey && !selEl.locked) {
          return { kind: 'resize', elId: selEl.id, key: rKey };
        }
        const hit = this.hitTestNorm(p, this.view(), 9);
        if (hit) {
          // Con shift SIEMPRE es un toggle (añade/quita de la selección); en el arrastre
          // el comportamiento de `beginSinglePointerDown` decide si además se mueve.
          if (shift) return { kind: 'selectMultiShift', hitId: hit };
          if (this.isSelected(hit) && this.selectedIds().length > 1) return { kind: 'moveGroup' };
          return { kind: 'selectMove', hitId: hit };
        }
        // Fase 5: en Seleccionar, tocar vacío DESELECCIONA pero NUNCA panea la vista
        // (aunque el campo sea mayor que la pantalla o el zoom >100 %). Panear solo
        // con la herramienta "Desplazar campo".
        return shift ? { kind: 'none' } : { kind: 'deselect' };
      }
      case 'erase': {
        const hit = this.hitTestNorm(p, this.unlockedView(), 9);
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

  // ---------- Pulsación larga → DUPLICAR (Fase 7) ----------

  /** Empieza la cuenta atrás de una pulsación larga sobre el objeto `targetId`. Un solo
   *  temporizador a la vez; cancelar uno anterior no afecta a nada (solo lo reemplaza). */
  private startLongPress(
    pointerId: number,
    clientX: number,
    clientY: number,
    targetId: string | null,
  ): void {
    this.cancelLongPress(pointerId);
    if (targetId == null) return;
    this.lp = { pointerId, start: { x: clientX, y: clientY }, targetId, fired: false };
    this.lpTimer = setTimeout(() => this.commitLongPress(), this.LONG_PRESS_MS);
  }

  /** Cancela la pulsación larga (por movimiento, levantamiento, segundo dedo, cancel...).
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

  /** Temporizador cumplido: la pulsación larga abre el MENÚ CONTEXTUAL del objeto
   *  (Fase 3) — ya NO duplica. Selecciona el elemento y muestra el menú compacto. */
  private commitLongPress(): void {
    this.lpTimer = null;
    const lp = this.lp;
    if (!lp || lp.fired) return;
    // El puntero ya se levantó/canceló: no abrir el menú.
    const ap = this.activePointers.get(lp.pointerId);
    if (!ap) {
      this.lp = null;
      return;
    }
    // TÁCTIL: la pulsación larga solo procede si el gesto sigue SIENDO un "tap
    // pendiente" sin confirmar. Se ata a `touchPending` (la máquina de estados
    // del dedo único) en vez de solo a `activePointers`: así se elimina la
    // carrera entre ambos sistemas —si el dedo ya empezó un arrastre (gp.begun)
    // o el gesto se consumió (segundo dedo / pointerup / pointercancel, gp null
    // o de otra pointerId), el menú NO se abre. Para mouse/lápiz (sin
    // touchPending) se conserva la comprobación de `activePointers`.
    if (ap.type === 'touch') {
      const gp = this.touchPending;
      if (!gp || gp.pointerId !== lp.pointerId || gp.begun) {
        this.lp = null;
        return;
      }
    }
    const el = this.view().find((e) => e.id === lp.targetId);
    if (!el) {
      this.lp = null;
      return;
    }
    lp.fired = true;
    // RATÓN/LÁPIZ: se abre el menú pero NO se DESARMA el arrastre. Antes se llamaba aquí a
    // `consumeLongPressGesture` (que vacía `movingIds` y `moveStart`) y eso convertía una
    // carrera del temporizador en un fallo funcional: si los 550 ms vencían antes de que el
    // primer `pointermove` llegara al navegador —máquina cargada: el `down` y el `move` son
    // dos llamadas distintas—, el arrastre que el usuario ya estaba haciendo no movía NADA.
    // De ahí salieron dos intermitencias de la suite completa: la papelera que no aparecía y
    // «la selección múltiple se mueve como un GRUPO» con `movedA = 0`. Con el arrastre armado,
    // el gesto funciona igual tanto si el menú llega a abrirse como si no.
    // TÁCTIL: se conserva el consumo (si no, el `pointerup` volvería a ejecutar el tap).
    if (ap.type === 'touch') {
      this.consumeLongPressGesture(lp.pointerId);
    } else {
      this.panGestureStart = null;
      this.panMoved = false;
      this.handDragging.set(false);
    }
    // Seleccionar el objeto y abrir el menú contextual (sin duplicar ni mover). Si el elemento ya
    // forma parte de una SELECCIÓN MÚLTIPLE no se colapsa: el arrastre ya está armado con todo el
    // grupo (`movingIds`) y la papelera borraría el grupo entero, así que la interfaz debe seguir
    // mostrando lo mismo que se va a mover/borrar. Colapsar aquí dejaba dos verdades divergentes.
    if (this.selectedIds().length <= 1) this.setSingleSelection(el.id);
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
    this.beginSinglePointerDown(
      gp.startClient.x,
      gp.startClient.y,
      gp.startNorm,
      gp.shift,
      gp.pointerId,
      gp.stamp,
      true, // gesto de DEDO: tolerancias táctiles, las mismas con las que se decidió el plan
    );
  }

  /** Confirma un TAP táctil (se levantó sin superar el umbral y con un solo dedo):
   *  ejecuta la acción de UN toque — colocar/crear texto, seleccionar, deseleccionar
   *  o borrar — igual que hacía el pointerdown inmediato, pero en el pointerup. */
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
        // Texto sigue siendo de UN solo uso.
        this.armed.set(null);
        this.setTool('select');
      } else {
        this.beginHistory();
        const armedBefore = gp.armed;
        const id = armedBefore?.player
          ? this.placePlayerElement(p, armedBefore.player)
          : this.addAt(p);
        this.endHistory();
        // Fase 3 (COLOCACIÓN CONTINUA): el material/jugador genérico sigue armado y
        // NO se auto-selecciona (no abre Propiedades ni muestra asas). Cada toque ya
        // registró su propia operación de Deshacer.
        // EXCEPCIÓN (invariante): jugador REAL de plantilla → una instancia, se desarma.
        if (armedBefore?.player?.playerId) {
          this.armed.set(null);
          this.setTool('select');
        }
        void id;
      }
    } else if (plan.kind === 'selectMove') {
      const id = this.hitTestNorm(p, this.view(), 9);
      if (id) this.setSingleSelection(id);
    } else if (plan.kind === 'selectMultiShift') {
      const id = this.hitTestNorm(p, this.view(), 9);
      if (id) this.toggleSelect(id);
    } else if (plan.kind === 'pan') {
      this.clearSelection();
    } else if (plan.kind === 'deselect') {
      // Fase 5: Seleccionar sobre vacío → deseleccionar. NO panea.
      this.clearSelection();
    } else if (plan.kind === 'erase') {
      const id = this.hitTestNorm(p, this.unlockedView(), 9);
      if (id) {
        this.beginHistory();
        this.removeElement(id);
        this.endHistory();
      }
    }
    // moveGroup / rotate / resize / draw → un tap NO hace nada (son gestos de arrastre).
  }

  onPointerMove(evt: PointerEvent): void {
    // Actualizar la posición del puntero activo (base del cálculo del pinch).
    if (this.activePointers.has(evt.pointerId)) {
      this.activePointers.set(evt.pointerId, {
        x: evt.clientX,
        y: evt.clientY,
        type: evt.pointerType,
      });
    }
    // Fase 4: previsualización junto al cursor. Solo para jugadores genéricos/materiales
    // armados (el texto es de un solo uso y no muestra preview); nunca en tool==select/hand.
    if (this.armed() && this.armed()!.tool !== 'text') {
      this.cursorScreen.set({ x: evt.clientX, y: evt.clientY });
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
    // Al superar el umbral se CONVIERTE en el gesto real de un dedo (panear/mover/dibujar...)
    // y deja que el bloque de abajo aplique el movimiento desde el ORIGEN de la bajada.
    const gp = this.touchPending;
    if (evt.pointerType === 'touch' && gp && gp.pointerId === evt.pointerId) {
      gp.movedDist = Math.max(
        gp.movedDist,
        Math.hypot(evt.clientX - gp.startClient.x, evt.clientY - gp.startClient.y),
      );
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
    // PANEO: si empezó un gesto de paneo (solo la herramienta "Mano"; Seleccionar ya NO
    // panea) y el puntero se mueve, se aplica el desplazamiento (clamp al rango del
    // contenido). No interfiere con el movimiento de elementos: panGestureStart solo se
    // fija con la herramienta "Mano", ya sea sobre un objeto o sobre vacío.
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
      // La herramienta CAPTURADA al empezar el borrador decide si se acumulan puntos (no la
      // activa: si a mitad del trazo cambia, el dibujo a mano alzada se cortaba y al soltar no
      // se creaba nada aunque la previsualización siguiera mostrando el trazo).
      if ((this.dragTool ?? this.tool()) === 'freehand') this.freehandPts.push([p.x, p.y]);
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
      // El elemento se toma del CAPTURADO al empezar el gesto (`resizeId`), no de la selección
      // viva: si el usuario deshace o pega a mitad de arrastre, la selección cambia y el
      // redimensionado se congelaba o se aplicaba a otro elemento.
      const id = this.resizeId;
      const el = id ? this.view().find((e) => e.id === id) : undefined;
      if (el) this.applyResize(el, this.resizeKey, p);
    }
    this.overTrash = this.isOverTrash(evt);
  }

  private isOverTrash(evt: PointerEvent): boolean {
    const el = this.trashEl()?.nativeElement;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return (
      evt.clientX >= r.left &&
      evt.clientX <= r.right &&
      evt.clientY >= r.top &&
      evt.clientY <= r.bottom
    );
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
    } else if (
      t === 'line' ||
      t === 'arrow' ||
      t === 'curve' ||
      t === 'doubleArrow' ||
      t === 'measure' ||
      t === 'dribble'
    ) {
      if (key === 'x1') this.updateElement(el.id, { x1: this.clamp01(p.x), y1: this.clamp01(p.y) });
      else if (key === 'x2')
        this.updateElement(el.id, { x2: this.clamp01(p.x), y2: this.clamp01(p.y) });
      else if (key === 'c1')
        this.updateElement(el.id, { c1x: this.clamp01(p.x), c1y: this.clamp01(p.y) });
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
        const scaled = pts0.map(
          ([px2, py2]) =>
            [
              Math.max(0, Math.min(1, cx + (px2 - cx) * s)),
              Math.max(0, Math.min(1, cy + (py2 - cy) * s)),
            ] as [number, number],
        );
        this.updateElement(el.id, { points: scaled });
      }
    } else if (this.isPointLike(t)) {
      // Escala UNIFORME de un material/jugador desde sus esquinas (persistida en `size`).
      const size0 = this.resizeStartSize ?? el.size ?? materialSize(el);
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
      // gp.begun → caer a la finalización estándar (commitDrag / endHistory).
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
    // Soltar sobre la papelera elimina el/los objetos movidos. Se exige además que el gesto
    // HAYA MOVIDO algo (`moveGestureBegun`, que solo se pone cuando un pointermove cambia de
    // verdad la posición): sin esa condición, un CLIC sin arrastre sobre un objeto que cae
    // dentro de la caja de la papelera la borraba de golpe. La papelera existe SIEMPRE en el
    // DOM (oculta con `opacity: 0`) y su caja está en norm (0.5, 0.965): medido con un clic
    // simple sobre un objeto en (0.5, 0.92), el contador pasaba de 1 a 0 sin que el usuario
    // arrastrara nada. Un clic es una SELECCIÓN; borrar exige arrastrar hasta la papelera.
    if (
      this.movingIds.length &&
      this.moveGestureBegun &&
      this.isOverTrash(evt ?? ({} as PointerEvent))
    ) {
      if (!this.moveGestureBegun) {
        this.beginHistory();
        this.moveGestureBegun = true;
      }
      this.removeElements(this.movingIds);
    }
    if (dragVal || this.moveGestureBegun || this.rotating || this.resizing) this.endHistory();
    this.drag.set(null);
    this.dragTool = null;
    this.movingIds = [];
    this.moveGestureBegun = false;
    this.moveStart = null;
    this.resizing = false;
    this.resizeKey = null;
    this.resizeId = null;
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
    this.cursorScreen.set(null);
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
    this.cursorScreen.set(null);
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
    this.cursorScreen.set(null);
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
    const materialKind = (tool: string): TacticalKind =>
      this.materialVariant()[tool] ?? this.defaultKindFor(tool);
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
        el = { id: uid(), t: 'player', x: p.x, y: p.y, c: this.armed()?.player?.c ?? '#1a73e8' };
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
      case 'mannequin_row':
        el = withMaterial(
          { id: uid(), t: 'mannequin_row', x: p.x, y: p.y, c: '#f6c945' },
          'mannequin_row',
        );
        break;
      case 'minigoal':
        el = withMaterial({ id: uid(), t: 'minigoal', x: p.x, y: p.y, c: '#ffffff' }, 'minigoal');
        break;
      case 'goal':
        el = withMaterial({ id: uid(), t: 'goal', x: p.x, y: p.y, c: '#ffffff' }, 'goal');
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
        el = withMaterial(
          { id: uid(), t: 'trampoline', x: p.x, y: p.y, c: '#e8edf2' },
          'trampoline',
        );
        break;
      case 'dumbbell':
        el = withMaterial({ id: uid(), t: 'dumbbell', x: p.x, y: p.y, c: '#20242a' }, 'dumbbell');
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
        el = {
          id: uid(),
          t: 'coachC',
          x: p.x,
          y: p.y,
          c: '#e6b800',
          size: materialBaseSize('coachC'),
        };
        break;
      case 'peto':
        el = { id: uid(), t: 'peto', x: p.x, y: p.y, c: '#f6c945', size: materialBaseSize('peto') };
        break;
      case 'chaleco':
        el = {
          id: uid(),
          t: 'chaleco',
          x: p.x,
          y: p.y,
          c: '#e74c3c',
          size: materialBaseSize('chaleco'),
        };
        break;
      case 'bosu':
        el = { id: uid(), t: 'bosu', x: p.x, y: p.y, c: '#3056d3', size: materialBaseSize('bosu') };
        break;
      case 'fitball':
        el = {
          id: uid(),
          t: 'fitball',
          x: p.x,
          y: p.y,
          c: '#e67e22',
          size: materialBaseSize('fitball'),
        };
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
        el = {
          id: uid(),
          t: 'text',
          x,
          y,
          v: 'Texto',
          size: DEFAULT_TEXT_SIZE,
          w: DEFAULT_TEXT_W,
          h: DEFAULT_TEXT_H,
        };
        break;
      }
      default:
        return null;
    }
    this.addElement(el as CanvasElement);
    return (el as CanvasElement).id;
  }

  private commitDrag(d: { x0: number; y0: number; x1: number; y1: number }): void {
    // El tipo se toma de la herramienta CAPTURADA al empezar el borrador (`dragTool`), no de la
    // activa en este instante: si cambia a mitad del trazo (p. ej. mantener ESPACIO pasa a Mano)
    // leer `tool()` no casaba con ninguna rama y el trazo DESAPARECÍA —después de que la
    // previsualización ya hubiera mostrado la forma nueva—, o creaba OTRO tipo si la nueva
    // herramienta era de dibujo. El `?? this.tool()` solo cubre un commit sin borrador capturado.
    const t = this.dragTool ?? this.tool();
    // Fase 5 — un clic SIN movimiento NO debe crear una línea/shape invisible:
    // si los dos extremos están prácticamente juntos, el borrador se descarta.
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 0.004) return;
    const col = this.drawColor();
    // Bloque E: preferencia de trazo (continuo/discontinuo) de la herramienta actual.
    const style = this.lineStyleFor(t);
    if (t === 'arrow') {
      this.addElement({
        id: uid(),
        t: 'arrow',
        x1: d.x0,
        y1: d.y0,
        x2: d.x1,
        y2: d.y1,
        style,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'doubleArrow') {
      this.addElement({
        id: uid(),
        t: 'doubleArrow',
        x1: d.x0,
        y1: d.y0,
        x2: d.x1,
        y2: d.y1,
        style,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'measure') {
      // NO ALCANZABLE desde la interfaz: 'measure' no está en TOOLS ni en ningún panel
      // (decisión: se retira de la UI y se conserva el RENDER para los documentos
      // antiguos). Si algún día se expone, `v` NO puede ser el literal '15 m': hay que
      // calcular la longitud real con la escala del campo, o la etiqueta miente.
      this.addElement({
        id: uid(),
        t: 'measure',
        x1: d.x0,
        y1: d.y0,
        x2: d.x1,
        y2: d.y1,
        v: '15 m',
        style,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'dribble') {
      this.addElement({
        id: uid(),
        t: 'dribble',
        x1: d.x0,
        y1: d.y0,
        x2: d.x1,
        y2: d.y1,
        // Igual que la curva: la conducción también admite trazo discontinuo, pero no lo guardaba al
        // crearse, así que se dibujaba siempre continua aunque la barra dijera «Discontinuo».
        style,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'line') {
      this.addElement({
        id: uid(),
        t: 'line',
        x1: d.x0,
        y1: d.y0,
        x2: d.x1,
        y2: d.y1,
        style,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'rect' || t === 'ellipse') {
      const fill = this.shapeFill();
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      if (w < 0.004 || h < 0.004) return; // no crear una figura de grosor/caída cero
      this.addElement({
        id: uid(),
        t,
        x,
        y,
        w,
        h,
        c: col,
        fill,
        fillColor: col,
        fillOpacity: this.fillOpacity(),
      });
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
        // `style`: la curva nace con el trazo elegido en la barra (continuo/discontinuo). Faltaba, así
        // que una curva dibujada con «Discontinuo» salía continua y había que seleccionarla y
        // cambiarla después (encargo del dueño, 23/09/2026).
        style,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'freehand') {
      // Un borrador de mano alzada necesita al menos 2 puntos distintos.
      if (this.freehandPts.length < 2) return;
      const pts = this.freehandPts;
      this.addElement({
        id: uid(),
        t: 'freehand',
        points: pts,
        c: col,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      });
    } else if (t === 'zone') {
      // NO ALCANZABLE desde la interfaz (misma decisión que 'measure': fuera de la UI,
      // render conservado). La zona era en la práctica un rectángulo relleno.
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
    // Misma herramienta capturada que usará `commitDrag`: la previsualización no puede mostrar
    // una forma que al soltar no se cree (o se cree de otro tipo).
    const t = this.dragTool ?? this.tool();
    const g = this.geo().rect;
    // Antes de mover, el borrador es un PUNTO: se dibuja un pequeño ancla para que el
    // inicio del trazo sea visible desde el pointerdown (Fase 5). En cuanto hay
    // desplazamiento, la preview pasa a ser la forma real = la que se confirmará.
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 0.004) {
      const ax = d.x0 * g.w + g.x;
      const ay = d.y0 * g.h + g.y;
      return `<circle cx="${ax}" cy="${ay}" r="1.1" fill="${this.drawColor()}"/>`;
    }
    if (t === 'arrow')
      return this.svgLine(
        d.x0,
        d.y0,
        d.x1,
        d.y1,
        'end',
        this.drawColor(),
        false,
        DEFAULT_STROKE_WIDTH,
        this.lineStyleFor('arrow'),
        g,
      );
    if (t === 'doubleArrow')
      return this.svgLine(
        d.x0,
        d.y0,
        d.x1,
        d.y1,
        'both',
        this.drawColor(),
        false,
        DEFAULT_STROKE_WIDTH,
        this.lineStyleFor('doubleArrow'),
        g,
      );
    if (t === 'dribble')
      return svgZigzag(
        d.x0,
        d.y0,
        d.x1,
        d.y1,
        this.drawColor(),
        false,
        DEFAULT_STROKE_WIDTH,
        'solid',
        g,
      );
    if (t === 'line')
      return this.svgLine(
        d.x0,
        d.y0,
        d.x1,
        d.y1,
        'none',
        this.drawColor(),
        false,
        DEFAULT_STROKE_WIDTH,
        this.lineStyleFor('line'),
        g,
      );
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
      const pts = this.freehandPts.length
        ? this.freehandPts
        : [
            [d.x0, d.y0],
            [d.x1, d.y1],
          ];
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
      const fillOpacity = this.fillOpacity();
      const fill = this.shapeFill() ? this.withAlpha(fillColor, fillOpacity) : 'none';
      const stroke = col;
      return t === 'ellipse'
        ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${DEFAULT_SHAPE_STROKE}"/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${DEFAULT_SHAPE_STROKE}"/>`;
    }
    return '';
  }

  private svgLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    arrow: 'none' | 'end' | 'both',
    color: string,
    _sel = false,
    width = DEFAULT_STROKE_WIDTH,
    lineStyle: 'solid' | 'dashed' = 'solid',
    _r?: unknown,
  ): string {
    const g = this.geo().rect;
    const ax1 = x1 * g.w + g.x;
    const ay1 = y1 * g.h + g.y;
    const ax2 = x2 * g.w + g.x;
    const ay2 = y2 * g.h + g.y;
    const dash = lineStyle === 'dashed' ? ` stroke-dasharray="${DASH_PATTERN}"` : '';
    let s = `<line x1="${ax1}" y1="${ay1}" x2="${ax2}" y2="${ay2}" stroke="${color}" stroke-width="${width}"${dash}/>`;
    const size = arrowHeadSize(width);
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
    const used = new Set(
      this.view()
        .filter((e) => e.t === 'player')
        .map((e) => e.n ?? 0),
    );
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
