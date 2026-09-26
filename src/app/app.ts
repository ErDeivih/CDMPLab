import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
  type Signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StoreService } from './core/store.service';
import { ConfirmService } from './core/confirm.service';
import { SupabaseService } from './core/supabase.service';
import { AccessService } from './core/access.service';
import { ConfirmDialogComponent } from './shared/confirm-dialog.component';

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmDialogComponent],
})
export class App {
  private readonly store = inject(StoreService);
  private readonly confirmSvc = inject(ConfirmService);
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);

  constructor() {
    // `enAuth` tiene que seguir al router: sin esto, entrar en /auth/login desde la app dejaba la
    // navegación del shell pintada encima del formulario. `enPizarra` (FASE 4) sigue al router por
    // el mismo motivo: dentro de /board la navegación global NO se muestra en móvil, y al salir
    // tiene que volver.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.enAuth.set(this.router.url.startsWith('/auth'));
        this.enPizarra.set(this.router.url.startsWith('/board'));
      });
    this.enPizarra.set(this.router.url.startsWith('/board'));
  }

  /**
   * FASE 4.1: dentro de la pizarra la navegación global inferior se oculta por completo en móvil
   * (Plantilla, Biblioteca, Sesiones y Más) para que el campo use toda la pantalla. Las
   * demás pantallas la conservan. La salida de la pizarra es el botón «Volver» del encabezado.
   */
  protected readonly enPizarra = signal(false);

  protected readonly activeTeam = this.store.activeTeam;
  /** Equipos del usuario: con más de uno, la cabecera ofrece cambiar de equipo. */
  protected readonly teams = computed(() =>
    this.store.isRemote() ? this.access.accessibleTeams() : this.store.teams(),
  );
  protected readonly switchingTeam = this.access.switchingTeam;
  protected readonly teamSwitchError = signal<string | null>(null);
  protected readonly activeTeamId = computed(() => this.store.activeTeam()?.id ?? '');
  protected async switchTeam(evt: Event): Promise<void> {
    const id = (evt.target as HTMLSelectElement).value;
    if (!id || id === this.activeTeamId()) return;
    this.teamSwitchError.set(null);
    try {
      // En remoto desmontar las vistas evita conservar datos del equipo anterior.
      // En local las listas son reactivas: conservar la pantalla, salvo la pizarra,
      // cuya salida debe pasar siempre por el guard de borradores.
      if (
        (this.store.isRemote() || /^\/board(?:[/?#]|$)/.test(this.router.url)) &&
        !(await this.router.navigate(['/library']))
      )
        return;
      if (this.store.isRemote()) await this.access.openTeam(id);
      else this.store.setActiveTeam(id);
      this.cerrarCuenta();
    } catch (error) {
      this.teamSwitchError.set((error as Error).message);
    } finally {
      (evt.target as HTMLSelectElement).value = this.activeTeamId();
    }
  }
  protected readonly storageError = this.store.storageError;
  protected clearStorageError(): void {
    this.store.clearStorageError();
  }

  protected readonly pendingWrites = this.store.pendingWrites;
  protected readonly syncError = this.store.lastError;
  /** Si la última escritura falló, el aviso ofrece REINTENTARLA (no solo descartarla). */
  protected readonly canRetry = this.store.canRetry;
  protected retryWrite(): void {
    this.store.retryFailedWrite();
  }
  protected clearSyncError(): void {
    this.store.clearLastError();
  }

  // ---------- Autenticación ----------

  /** Estado de la sesión (resolving / unauthenticated / authenticated / disabled). */
  protected readonly authStatus = this.supabase.status;
  protected readonly userEmail = computed(() => this.supabase.user()?.email ?? '');
  protected readonly isAuthenticated = computed(() => this.supabase.status() === 'authenticated');

  /**
   * ¿Estamos en una ruta de autenticación? Se mantiene al día con los eventos del router.
   * Hace falta porque en modo local `status` NO es 'unauthenticated', así que sin esta comprobación
   * la navegación del shell (barra inferior en móvil y botón de cuenta) aparecía también en las
   * pantallas de acceso, donde no pinta nada.
   */
  protected readonly enAuth = signal(this.router.url.startsWith('/auth'));

  /**
   * Muestra la navegación protegida salvo que ya esté claro que NO hay sesión.
   * (Durante `resolving` se muestra igualmente: el app initializer resuelve la
   * sesión antes del primer render; los guards se encargan de la protección real.)
   */
  protected readonly showNav = computed(
    () => this.supabase.status() !== 'unauthenticated' && !this.enAuth(),
  );

  protected async logout(): Promise<void> {
    await this.supabase.signOut();
    await this.access.clear();
    await this.router.navigate(['/auth/login']);
  }

  protected readonly settingsOpen = signal(false);
  protected openSettings(): void {
    this.settingsOpen.set(true);
    // Ajustes también es una capa modal: el fondo sigue inerte y el foco entra en el diálogo.
    this.marcarInerte(true);
    this.enfocarEnDialogo(this.settingsPanel, 'button[aria-label="Cerrar"]');
  }
  protected closeSettings(): void {
    this.settingsOpen.set(false);
    // El foco vuelve al disparador de Cuenta/Más que abrió la cadena (se conserva en `openSettings`).
    const trigger = this.cuentaTrigger;
    this.cuentaTrigger = null;
    this.marcarInerte(false);
    queueMicrotask(() => trigger?.focus());
  }
  protected resetData(): void {
    // En modo remoto esto SOLO limpia la caché local (`entrenolab:*`): la sesión de
    // Supabase (`sb-*`) sobrevive y los datos de la cuenta vuelven a hidratarse. El
    // mensaje debe decirlo, o el botón parece borrar datos que en realidad no borra.
    const remote = this.isAuthenticated();
    this.confirmSvc.ask({
      title: 'Restablecer datos',
      message: remote
        ? 'Se borrarán los datos guardados en ESTE navegador (caché local). Los datos de tu cuenta (Supabase) NO se tocan: volverán a cargarse al recargar.'
        : 'Se borrarán todos los datos locales de CDMPLab (equipos, jugadores, ejercicios, sesiones). Esta acción no se puede deshacer.',
      confirmLabel: 'Borrar',
      onConfirm: () => {
        for (const k of Object.keys(localStorage))
          if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
        location.reload();
      },
    });
  }

  // ---------- Respaldo (exportar / importar) ----------

  protected readonly importJson = signal<string | null>(null);
  protected readonly backupError = signal<string | null>(null);

  /** ¿Hay una copia automática (la que se escribe sola antes de importar)? */
  protected readonly autoBackupAvailable = this.store.autoBackupAvailable;

  /** Restaura la copia automática previa a la última importación. */
  protected restoreAutoBackup(): void {
    this.confirmSvc.ask({
      title: 'Restaurar copia automática',
      message:
        'Se restaurará la copia que se guardó automáticamente justo antes de la última importación. Lo que tienes ahora pasa a ser la nueva copia automática, así que podrás volver atrás otra vez.',
      confirmLabel: 'Restaurar',
      onConfirm: () => {
        if (this.store.restoreAutoBackup()) location.reload();
      },
    });
  }

  // ---------- Conflicto de revisión (otro usuario editó el ejercicio) ----------

  protected readonly lastConflict = this.store.lastConflict;

  protected conflictTitle(): string {
    return this.store.lastConflict()?.latest.title ?? 'un ejercicio';
  }

  /** Guarda MI versión pisando la del servidor. */
  protected keepMyCopy(): void {
    this.store.keepMyCopy();
  }

  /** Se queda la versión del servidor y cierra el aviso. */
  protected discardMyCopy(): void {
    this.store.discardMyCopy();
  }

  /** Descarga un JSON versionado con todos los datos locales. */
  protected exportBackup(): void {
    const json = this.store.exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cdmplab-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Lee el archivo elegido, lo valida y deja el JSON listo para importar. */
  protected onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // El límite de tamaño se comprueba ANTES de leer: leer el fichero entero (file.text()) y
    // validarlo después cargaba en memoria un fichero de varios GB antes de rechazarlo. El tope
    // es el mismo que el del validador (10 MB de caracteres ≈ 10 MiB de bytes).
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      this.importJson.set(null);
      this.backupError.set('El archivo es demasiado grande (máximo 10 MB).');
      return;
    }
    file
      .text()
      .then((text) => {
        const v = this.store.validateBackup(text);
        if (!v.ok) {
          this.importJson.set(null);
          this.backupError.set(v.error ?? 'El archivo no es un respaldo válido.');
          return;
        }
        this.backupError.set(null);
        this.importJson.set(text);
      })
      // Si la lectura del fichero falla (permiso, fichero movido, disco), antes quedaba un
      // rechazo sin manejar y la pantalla no decía NADA: el usuario veía un botón que no hacía
      // nada. Ahora se informa y se limpia la selección previa.
      .catch(() => {
        this.importJson.set(null);
        this.backupError.set('No se ha podido leer el archivo. Inténtalo de nuevo.');
      });
  }

  /** Aplica la importación (reemplazar o fusionar). */
  protected doImport(mode: 'replace' | 'merge'): void {
    const json = this.importJson();
    if (!json) return;
    const res = this.store.importBackup(json, mode);
    if (!res.ok) {
      this.backupError.set(res.error ?? 'No se pudo importar el respaldo.');
      return;
    }
    this.importJson.set(null);
    location.reload();
  }

  protected readonly navItems = computed<NavItem[]>(() => {
    const base: NavItem[] = [
      { label: 'Plantilla', href: '/team', icon: 'group' },
      { label: 'Biblioteca', href: '/library', icon: 'collections_bookmark' },
      { label: 'Sesiones', href: '/sessions', icon: 'calendar_month' },
    ];
    // "Miembros" para el propietario y el administrador de plataforma. La migración
    // 20260928000000 permite al segundo CONSULTAR cualquier equipo; un editor normal no
    // tiene esa autorización. En modo local no se oculta la pantalla.
    const members: NavItem = { label: 'Miembros', href: '/settings/team/members', icon: 'people' };
    return this.access.target().role === 'editor' && !this.access.platformAdmin()
      ? base
      : [...base, members];
  });

  /** Destinos PRINCIPALES. La pizarra se abre desde un ejercicio de Biblioteca. */
  protected readonly destinosPrincipales = computed<NavItem[]>(() =>
    this.navItems().filter((i) => i.href !== '/settings/team/members'),
  );

  /** «Miembros» solo cuando corresponde por permisos (ver `navItems`). Vive en «Más»/cuenta. */
  protected readonly miembrosItem = computed<NavItem | null>(
    () => this.navItems().find((i) => i.href === '/settings/team/members') ?? null,
  );

  /**
   * Invitaciones PENDIENTES. No estaba en la navegación: la pantalla `/invitations` solo se
   * alcanzaba por el redirect de `decideAccess` (perfil aprobado SIN equipo), así que quien ya
   * pertenecía a un equipo —o quien cerraba el aviso— no tenía manera de ver que le habían
   * invitado, ni de aceptar. Se ofrece mientras el servidor diga que hay alguna pendiente.
   */
  protected readonly invitacionesItem = computed<NavItem | null>(() => {
    const pendientes = this.access.pendingInvitations().length;
    if (pendientes === 0) return null;
    return {
      label: pendientes === 1 ? 'Invitación pendiente' : `Invitaciones pendientes (${pendientes})`,
      href: '/invitations',
      icon: 'mail',
    };
  });

  /**
   * El acceso está protegido además por AdminGuard. Se ofrece SOLO si el servidor ha confirmado
   * que esta cuenta administra la plataforma: antes bastaba con no ser colaborador, así que
   * cualquier propietario de equipo veía «Administración» y al pulsarlo el guard lo devolvía a
   * `/team` (un enlace que solo podía acabar en rechazo).
   */
  protected readonly administracionItem = computed<NavItem | null>(() =>
    this.access.platformAdmin()
      ? { label: 'Administración', href: '/admin', icon: 'admin_panel_settings' }
      : null,
  );

  // ---------- Menú de cuenta (escritorio: bajo la barra lateral; móvil: «Más») ----------

  /** Control que abrió el menú: al cerrarlo el foco vuelve ahí (requisito de accesibilidad). */
  private cuentaTrigger: HTMLElement | null = null;
  protected readonly cuentaAbierta = signal(false);

  /**
   * Contenedor de la app entera (`.shell`). Mientras hay una capa abierta —el menú de cuenta o
   * Ajustes— se marca `inert`: así NINGÚN control que queda detrás de la capa puede recibir foco
   * con Tab (defecto reportado: el foco se colaba a los controles tapados por el menú).
   *
   * Se marca y se desmarca a mano, no con `[attr.inert]`, porque al cerrar hay que RETIRARLO ANTES
   * de devolver el foco al disparador: dentro de un subárbol inerte `focus()` no hace nada y el
   * foco se perdería en silencio.
   */
  private readonly appShell = viewChild<ElementRef<HTMLElement>>('appShell');
  private readonly cuentaPanel = viewChild<ElementRef<HTMLElement>>('cuentaPanel');
  private readonly settingsPanel = viewChild<ElementRef<HTMLElement>>('settingsPanel');
  /** Necesario para poder usar `afterNextRender` fuera del constructor (gestión del foco). */
  private readonly injector = inject(Injector);

  private marcarInerte(inerte: boolean): void {
    const el = this.appShell()?.nativeElement;
    if (!el) return;
    if (inerte) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }

  /**
   * Lleva el foco al primer control del diálogo (en los dos diálogos es el botón Cerrar).
   *
   * Se usa `afterNextRender` y no `queueMicrotask`: cuando se abre la capa (`@if`) el elemento
   * todavía NO existe en el DOM, y un microtask se ejecuta ANTES de que Angular pinte el diálogo
   * (medido: el foco no entraba y la prueba lo detectó). Además el `viewChild` se lee DENTRO del
   * callback, cuando ya está resuelto.
   */
  private enfocarEnDialogo(
    panel: Signal<ElementRef<HTMLElement> | undefined>,
    selector: string,
  ): void {
    afterNextRender(() => panel()?.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  /** Nombre del equipo activo, recortado para el botón compacto. */
  protected readonly equipoCorto = computed(() => {
    const nombre = this.activeTeam()?.name ?? 'Sin equipo';
    return nombre.length > 18 ? `${nombre.slice(0, 17)}…` : nombre;
  });

  protected toggleCuenta(event: Event): void {
    if (this.cuentaAbierta()) {
      this.cerrarCuenta();
      return;
    }
    this.cuentaTrigger = (event.currentTarget as HTMLElement) ?? null;
    this.cuentaAbierta.set(true);
    // El fondo queda inerte y el foco entra en el diálogo (primer control: Cerrar).
    this.marcarInerte(true);
    this.enfocarEnDialogo(this.cuentaPanel, 'button[aria-label="Cerrar el menú de cuenta"]');
  }

  /** Cierra el menú y DEVUELVE EL FOCO al control que lo abrió. */
  protected cerrarCuenta(): void {
    if (!this.cuentaAbierta()) return;
    this.cuentaAbierta.set(false);
    const trigger = this.cuentaTrigger;
    this.cuentaTrigger = null;
    // Quitar `inert` ANTES de enfocar: si no, el disparador sigue inerte y no recibe el foco.
    this.marcarInerte(false);
    queueMicrotask(() => trigger?.focus());
  }

  /**
   * Abre Ajustes desde el menú de cuenta (cerrándolo antes, para no dejar dos capas). El disparador
   * de Cuenta/Más SE CONSERVA: cuando se cierre Ajustes el foco vuelve ahí, que es el control desde
   * el que el usuario empezó la secuencia (antes se descartaba y el foco se quedaba en el vacío).
   */
  protected ajustesDesdeCuenta(): void {
    this.cuentaAbierta.set(false);
    this.openSettings();
  }

  /** Cambiar de equipo desde el menú: se cierra para no dejarlo descolgado del equipo nuevo. */
  protected switchTeamDesdeCuenta(evt: Event): void {
    void this.switchTeam(evt);
  }

  protected async logoutDesdeCuenta(): Promise<void> {
    this.cuentaAbierta.set(false);
    this.cuentaTrigger = null;
    // CRÍTICO: hay que retirar el `inert` del fondo aunque no se devuelva el foco. Si no, la
    // pantalla de login (dentro de `.shell`) quedaría INERTE y sin poder pulsar nada.
    this.marcarInerte(false);
    await this.logout();
  }

  /** Escape cierra el menú (el foco vuelve al botón) sin tocar el resto de atajos. */
  protected onCuentaKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Escape' && this.cuentaAbierta()) {
      evt.stopPropagation();
      this.cerrarCuenta();
      return;
    }
    if (evt.key === 'Tab') this.atraparTab(evt, this.cuentaPanel);
  }

  /** Lo mismo para el diálogo de Ajustes (también es modal). */
  protected onAjustesKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Tab') this.atraparTab(evt, this.settingsPanel);
  }

  /**
   * Mantiene el TECLADO dentro del diálogo: al llegar al último control, Tab vuelve al primero y
   * Shift+Tab al revés.
   *
   * Medido: con solo el fondo `inert`, Tab desde el último control del menú se iba a `body` (fuera
   * de la capa), así que el requisito «Tab/Shift+Tab no salen del diálogo» NO se cumplía. El fondo
   * inerte evita alcanzar los controles tapados; esta función cierra el ciclo.
   */
  private atraparTab(evt: KeyboardEvent, panel: Signal<ElementRef<HTMLElement> | undefined>): void {
    const contenedor = panel()?.nativeElement;
    if (!contenedor) return;
    const focusables = [
      ...contenedor.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.getClientRects().length > 0);
    if (focusables.length === 0) {
      evt.preventDefault();
      return;
    }
    const primero = focusables[0];
    const ultimo = focusables[focusables.length - 1];
    const activo = document.activeElement as HTMLElement | null;
    const dentro = !!activo && contenedor.contains(activo);
    if (evt.shiftKey) {
      if (!dentro || activo === primero) {
        evt.preventDefault();
        ultimo.focus();
      }
    } else if (!dentro || activo === ultimo) {
      evt.preventDefault();
      primero.focus();
    }
  }
}
