import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { signal } from '@angular/core';
import { App } from './app';
import { AccessService } from './core/access.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, RouterModule.forRoot([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the brand and navigation', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('CDMPLab');
    expect(compiled.textContent).toContain('Plantilla');
    expect(compiled.querySelector('nav')?.textContent).not.toContain('Pizarra');
  });
});

/**
 * «Miembros» solo para el PROPIETARIO del equipo.
 *
 * Por qué con un test de componente y no en el E2E: el rol lo resuelve el servidor
 * (`AccessService.resolve()` contra Supabase) y el E2E corre en modo local sin sesión, así que no
 * hay forma de que un colaborador real exista ahí. Aquí se sustituye `AccessService` por un doble y
 * se comprueba el DOM REAL de la app: un `editor` no debe ver «Miembros» ni en la barra lateral ni
 * dentro del menú de cuenta (el servidor devuelve `forbidden: not team owner` para esa RPC), pero
 * debe conservar lo que sí puede usar (Ajustes, cerrar sesión).
 */
/**
 * Monta la app con un rol de acceso dado (el rol lo resuelve el servidor; aquí se sustituye).
 *
 * CAMBIO DE CONTRATO (23/09/2026): el componente consulta TAMBIÉN `pendingInvitations` y
 * `platformAdmin` para decidir qué ofrece la navegación (enlace a la invitación pendiente y
 * «Administración» solo con permiso confirmado por el servidor). El doble tiene que reflejar el
 * contrato real: si faltan esas señales, la app revienta al pintarse.
 */
async function montar(
  role: 'owner' | 'editor' | null,
  opciones: { invitacionesPendientes?: number; plataformaAdmin?: boolean } = {},
): Promise<ComponentFixture<App>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [App, RouterModule.forRoot([])],
    providers: [
      {
        provide: AccessService,
        useValue: {
          target: signal({ role, state: 'ready', route: '/team', teamId: 't1' }),
          switchingTeam: signal(false),
          accessibleTeams: signal([]),
          pendingInvitations: signal(
            Array.from({ length: opciones.invitacionesPendientes ?? 0 }, (_, i) => ({
              id: `inv-${i}`,
            })),
          ),
          platformAdmin: signal(opciones.plataformaAdmin ?? false),
          clear: async () => undefined,
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  return fixture;
}

describe('App — permisos de «Miembros» (propietario vs colaborador)', () => {
  /** Abre el menú de cuenta como lo haría el usuario y devuelve su DOM. */
  function abrirCuenta(fixture: ComponentFixture<App>): HTMLElement | null {
    const el = fixture.nativeElement as HTMLElement;
    const boton = el.querySelector<HTMLButtonElement>('.cuenta-btn');
    expect(boton, 'existe el botón de cuenta').toBeTruthy();
    boton!.click();
    fixture.detectChanges();
    return el.querySelector<HTMLElement>('.cuenta-panel');
  }

  it('el colaborador «editor» no ve «Miembros» ni en la barra lateral ni dentro de cuenta', async () => {
    const fixture = await montar('editor');
    const el = fixture.nativeElement as HTMLElement;
    const barra = el.querySelector('.nav-escritorio');
    // La barra SÍ se pinta (si no, la comprobación negativa sería vacua): se ve el resto.
    expect(barra?.textContent ?? '', 'la navegación se pinta').toContain('Plantilla');
    expect(barra?.textContent ?? '').not.toContain('Miembros');

    const panel = abrirCuenta(fixture);
    expect(panel, 'el menú de cuenta se abre').toBeTruthy();
    expect(panel!.textContent ?? '').not.toContain('Miembros');
    // Lo que SÍ puede usar sigue ahí: no se le quita nada de más.
    expect(panel!.textContent ?? '').toContain('Ajustes');
  });

  it('el propietario ve «Miembros» en la barra lateral y en el menú de cuenta', async () => {
    const fixture = await montar('owner');
    const el = fixture.nativeElement as HTMLElement;
    const barra = el.querySelector('.nav-escritorio');
    expect(barra?.textContent ?? '').toContain('Miembros');
    expect(barra!.querySelector('a[href="/settings/team/members"]')).toBeTruthy();

    const panel = abrirCuenta(fixture);
    expect(panel!.textContent ?? '').toContain('Miembros');
  });

  it('sin rol resuelto (modo local) NO se oculta «Miembros»: la RLS es la barrera real', async () => {
    const fixture = await montar(null);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.nav-escritorio')?.textContent ?? '').toContain('Miembros');
  });
});

/**
 * «Administración» y las INVITACIONES en la navegación.
 *
 * Los dos defectos que fijan estas pruebas (encontrados al auditar los flujos el 23/09/2026):
 *   · «Administración» se ofrecía a CUALQUIER propietario de equipo (bastaba con no ser
 *     colaborador) y el `AdminGuard` lo devolvía a `/team`: un enlace que solo podía acabar en
 *     rechazo. Ahora se ofrece solo si el SERVIDOR confirmó `is_platform_admin()`.
 *   · `/invitations` no estaba en ninguna navegación: quien ya pertenecía a un equipo no tenía
 *     forma de ver ni aceptar su invitación, que el propietario ya había creado (y podía haber
 *     enviado por correo).
 */
describe('App — «Administración» solo con permiso y la invitación pendiente siempre visible', () => {
  function panelCuenta(fixture: ComponentFixture<App>): HTMLElement {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.cuenta-btn')!.click();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.cuenta-panel')!;
  }

  it('un propietario que NO es administrador de plataforma no ve «Administración»', async () => {
    const fixture = await montar('owner', { plataformaAdmin: false });
    const panel = panelCuenta(fixture);
    expect(panel.querySelector('a[href="/admin"]')).toBeNull();
    // Lo que sí puede usar sigue ahí: no se le quita nada de más.
    expect(panel.textContent ?? '').toContain('Ajustes');
  });

  it('el administrador de plataforma SÍ ve «Administración»', async () => {
    const fixture = await montar('owner', { plataformaAdmin: true });
    const panel = panelCuenta(fixture);
    expect(panel.querySelector('a[href="/admin"]')).toBeTruthy();
  });

  it('con una invitación pendiente se ofrece el enlace, aunque ya tenga equipo', async () => {
    // El caso real: perfil aprobado CON equipo y una invitación de OTRO equipo. `decideAccess`
    // manda a `/team`, así que sin esta entrada la invitación era invisible.
    const fixture = await montar('owner', { invitacionesPendientes: 1 });
    const panel = panelCuenta(fixture);
    const enlace = panel.querySelector<HTMLAnchorElement>('a[href="/invitations"]');
    expect(enlace, 'el enlace a la invitación pendiente existe').toBeTruthy();
    expect(enlace!.textContent ?? '').toContain('Invitación pendiente');
    expect(fixture.nativeElement.querySelector('[data-accion="ver-invitaciones"]')).toBeTruthy();
  });

  it('sin invitaciones pendientes no se ofrece nada de más', async () => {
    const fixture = await montar('owner', { invitacionesPendientes: 0 });
    const panel = panelCuenta(fixture);
    expect(panel.querySelector('a[href="/invitations"]')).toBeNull();
  });
});

/**
 * INVARIANTE DE LA CAPA MODAL: mientras el menú de cuenta o Ajustes están abiertos, el fondo
 * (`.shell`) queda `inert` para que el foco no llegue a los controles tapados; y NUNCA puede
 * quedarse inerte al cerrarse, porque entonces la app dejaría de responder a clics y teclado.
 *
 * Esta prueba existe porque al escribirlo apareció precisamente ese fallo: la ruta de «Cerrar
 * sesión» cerraba el menú sin retirar el `inert`, así que la pantalla de login (dentro de `.shell`)
 * habría quedado muerta.
 */
describe('App — la capa modal nunca deja el fondo inerte al cerrarse', () => {
  const shell = (fixture: ComponentFixture<App>) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.shell')!;
  const abrirMenu = (fixture: ComponentFixture<App>) => {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.cuenta-btn')!.click();
    fixture.detectChanges();
  };

  it('al abrir el menú el fondo queda inerte y al cerrarlo (capa o ajustes) se recupera', async () => {
    const fixture = await montar('owner');

    abrirMenu(fixture);
    expect(shell(fixture).hasAttribute('inert'), 'abierto: el fondo está inerte').toBe(true);

    // Cerrar pulsando la capa (como hace el usuario al tocar fuera).
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.cuenta-capa')!.click();
    fixture.detectChanges();
    expect(shell(fixture).hasAttribute('inert'), 'cerrado: el fondo vuelve a responder').toBe(
      false,
    );

    // Y por la ruta de Ajustes: abrir cuenta → Ajustes → cerrar Ajustes.
    abrirMenu(fixture);
    fixture.componentInstance['ajustesDesdeCuenta']();
    fixture.detectChanges();
    expect(
      shell(fixture).hasAttribute('inert'),
      'Ajustes abierto: el fondo sigue inerte (es otra capa modal)',
    ).toBe(true);
    fixture.componentInstance['closeSettings']();
    fixture.detectChanges();
    expect(shell(fixture).hasAttribute('inert'), 'Ajustes cerrado: el fondo responde').toBe(false);
  });

  it('cerrar sesión desde el menú NO deja el fondo inerte (la pantalla siguiente sería inusable)', async () => {
    const fixture = await montar('owner');
    // El cierre de sesión real necesita Supabase: se sustituye SOLO esa llamada.
    const salir = vi
      .spyOn(fixture.componentInstance as unknown as { logout: () => Promise<void> }, 'logout')
      .mockResolvedValue(undefined);

    abrirMenu(fixture);
    expect(shell(fixture).hasAttribute('inert'), 'menú abierto: fondo inerte').toBe(true);
    await fixture.componentInstance['logoutDesdeCuenta']();
    fixture.detectChanges();

    expect(salir, 'se ha llamado al cierre de sesión').toHaveBeenCalled();
    expect(
      shell(fixture).hasAttribute('inert'),
      'tras cerrar sesión el fondo NO queda inerte',
    ).toBe(false);
  });
});
