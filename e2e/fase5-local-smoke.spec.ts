import { test, expect, Page } from '@playwright/test';

// =============================================================
// Fase 5 — SMOKE LOCAL (dev) de pantallas de autenticación.
//
// ⚠️ ESTE SPEC ES UN SMOKE DE DESARROLLO/LOCAL, NO UNA PRUEBA DE PRODUCCIÓN.
// Se ejecuta contra el DEV server (`ng serve`, ver playwright.config.ts), que
// usa la configuración de desarrollo (Supabase vacío → modo local). Aquí los
// guards dejan pasar porque el estado es 'disabled' (FORCE_LOCAL_MODE), por lo
// que se puede navegar directo a cada ruta sin sesión.
//
// Para la verificación honesta de la build REAL de producción (con Supabase y
// guards activos) usa `playwright.prod.config.ts` + `e2e/prod-auth.spec.ts`.
// =============================================================

const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };

interface RouteCheck {
  path: string;
  /** Selector que debe quedar visible tras la navegación. */
  visible: string;
  /** Texto opcional esperado dentro de `visible`. */
  text?: string;
  /** Sembrar un equipo local para que la ruta muestre contenido real. */
  seed?: boolean;
}

const ROUTES: RouteCheck[] = [
  { path: '/auth/login', visible: '#login-email' },
  { path: '/auth/register', visible: '#reg-email' },
  { path: '/auth/forgot-password', visible: '#forgot-email' },
  // En local (status 'disabled') la sesión no se considera «sin sesión» (noSession=false), así que el formulario se muestra.
  { path: '/auth/update-password', visible: '#new-password' },
  { path: '/auth/verify-email', visible: '.auth-title', text: 'Confirma tu correo' },
  { path: '/pending-approval', visible: '.auth-title', text: 'Aprobación pendiente' },
  { path: '/access-rejected', visible: '.auth-title', text: 'Acceso rechazado' },
  { path: '/access-suspended', visible: '.auth-title', text: 'Acceso suspendido' },
  { path: '/invitations', visible: '.auth-title', text: 'Invitaciones' },
  { path: '/onboarding/team', visible: '#team-name' },
  { path: '/onboarding/migrate', visible: '.auth-title', text: 'Migra tus datos' },
  { path: '/settings/team/members', visible: '.auth-title', text: 'Miembros del equipo' },
  { path: '/admin', visible: '.auth-title', text: 'Panel de administración' },
  { path: '/team', visible: '.data-table', seed: true },
];

/** Mensajes de consola de nivel error que son ESPERADOS en modo local (benignos). */
const BENIGN_CONSOLE = [
  // (vacío por ahora: en modo local no debería aparecer ningún error real)
];

/**
 * Siembra un equipo local con jugadores para que /team y /board muestren
 * contenido real (idéntico al resto de specs de la suite).
 */
function seedTeam(page: Page): void {
  page.addInitScript(() => {
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    const players = [
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ];
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Registra errores de consola, pageerror, peticiones fallidas y respuestas >= 400. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (BENIGN_CONSOLE.some((b) => text.includes(b))) return;
    problems.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    // HMR del dev server puede abortar peticiones al recargar: no es un fallo real.
    if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
    problems.push(`requestfailed: ${req.url()} (${req.failure()?.errorText ?? 'sin error'})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`${res.status()} ${res.url()}`);
  });
  return problems;
}

/** Sin desbordamiento horizontal en los contenedores principales. */
async function expectNoHorizontalOverflow(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null;
      return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null;
    }, sel);
    expect(r, `no existe ${sel}`).not.toBeNull();
    expect(r!.scroll, `scroll horizontal en ${sel}`).toBeLessThanOrEqual(r!.client + 1);
  }
}

for (const [label, viewport] of [
  ['escritorio 1366×900', DESKTOP],
  ['móvil 390×844', MOBILE],
] as Array<[string, { width: number; height: number }]>) {
  test.describe(`Fase 5 — SMOKE LOCAL (dev): auth + team sin errores ni overflow (${label})`, () => {
    for (const route of ROUTES) {
      test(`ruta ${route.path}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        if (route.seed) seedTeam(page);
        const problems = collectProblems(page);

        await page.goto(route.path);

        // La ruta debe QUEDARSE en esa URL (los guards pasan en local; sin redirect).
        await page.waitForURL(`**${route.path}`);
        await expect(page.locator(route.visible).first()).toBeVisible();
        if (route.text) await expect(page.locator(route.visible).first()).toContainText(route.text);

        // Contenedores principales sin desbordamiento horizontal.
        await expectNoHorizontalOverflow(page, ['.shell', '.main', '.content']);

        // Dejar asentar errores de red/consola pendientes.
        await page.waitForTimeout(400);
        expect(problems, `problemas en ${route.path}`).toEqual([]);
      });
    }
  });
}
