import { test, expect, type Page } from '@playwright/test';
import {
  readEnv,
  missingRequiredVars,
  buildPrefix,
  skipReason,
  limitEmailsValid,
} from '../src/app/core/supabase-e2e-config';

// =============================================================
// CDMPLab — E2E OPT-IN contra el backend Supabase REAL
//
// ⚠️ Este suite NO se ejecuta en `npm run test:e2e` ni en `test:e2e:prod`, y
// NO está en CI. Solo se lanza con `npm run test:e2e:supabase-real` tras
// preparar las cuentas de prueba (ver docs/supabase-real-e2e.md).
//
// REGLAS INQUEBRANTABLES:
//   · No incrusta correos, contraseñas, UUID ni tokens: TODO viene de variables.
//   · Si falta alguna variable REQUERIDA, la suite se OMITE ENTERA con un
//     mensaje explícito (NUNCA da un falso pase).
//   · No interpola ni simula Supabase: usa la build real conectada al proyecto.
//   · Cada ejecución usa un PREFIJO ÚNICO en los datos que crea.
//
// VARIABLES DE ENTORNO (obligatorias para el flujo completo):
//   SUPABASE_E2E_ADMIN_EMAIL      / _ADMIN_PASSWORD       → admin de plataforma
//   SUPABASE_E2E_OWNER_EMAIL      / _OWNER_PASSWORD       → propietario de equipo
//   SUPABASE_E2E_COLLAB_EMAIL     / _COLLAB_PASSWORD      → colaborador SIN equipo propio
//   SUPABASE_E2E_LIMIT_EMAILS                              → 6 correos (coma-separados)
//   SUPABASE_E2E_LIMIT_PASSWORD                            → contraseña común para esos 6
//   (opcionales) SUPABASE_E2E_PENDING_EMAIL/_PASSWORD, SUPABASE_E2E_REJECTED_EMAIL/_PASSWORD
//
// NOTA sobre estados pendiente/rechazado: son OPCIONALES. Si no se configuran,
// esos dos escenarios se omiten y NO cuentan como "cobertura completa". El
// informe debe reflejar que la suite se ejecutó solo con las obligatorias.
// =============================================================

const env = readEnv(process.env);
const PREFIX = buildPrefix();
const missing = missingRequiredVars(process.env);

// Si faltan variables REQUERIDAS → se omite TODA la suite (no falso pase).
test.skip(missing.length > 0, skipReason(missing));

// Precondición del escenario de límite: exactamente 6 correos.
const limitCheck = limitEmailsValid(env, 6);
test.skip(!limitCheck.ok, limitCheck.message ?? 'Límite no configurado');

// Determinar etiquetado de estados opcionales.
const pendingConfigured = Boolean(env.pendingEmail && env.pendingPassword);
const rejectedConfigured = Boolean(env.rejectedEmail && env.rejectedPassword);

// ---------------------------------------------------------------------------
// Helpers de UI (selectores reales de los componentes).
// ---------------------------------------------------------------------------

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForLoadState('networkidle');
}

async function logout(page: Page): Promise<void> {
  const btn = page.locator('button[aria-label="Cerrar sesión"]').first();
  await btn.click();
  await page.waitForURL('**/auth/login');
}

/**
 * Presenta la SOLICITUD de equipo (la cuenta aprobada ya NO crea el equipo: lo aprueba un
 * administrador de plataforma y el servidor lo crea al aprobar).
 * CAMBIO DE CONTRATO (22/09/2026): antes esta suite pulsaba «Crear equipo» en la plantilla.
 */
async function requestTeam(page: Page, name: string): Promise<void> {
  await page.goto('/onboarding/team');
  await page.locator('#team-name').fill(name);
  await page
    .locator('button.btn.btn-primary', { hasText: /Enviar solicitud|Actualizar solicitud|Volver a solicitar/ })
    .click();
  await expect(page.locator('[data-estado-solicitud="pendiente"]')).toBeVisible();
}

/** Aprueba (como ADMIN) la solicitud pendiente del nombre indicado. */
async function approveTeamRequestAsAdmin(page: Page, teamName: string): Promise<void> {
  await login(page, env.adminEmail!, env.adminPassword!);
  await page.goto('/admin');
  const fila = page.locator('[data-solicitud="pendiente"]', { hasText: teamName });
  await expect(fila, 'la solicitud aparece en el apartado de EQUIPOS del panel').toHaveCount(1);
  await fila.locator('button', { hasText: 'Aprobar y crear equipo' }).click();
  // Diálogo de confirmación de la app.
  await page.locator('.confirm-dialog button', { hasText: 'Aprobar y crear' }).click();
  await expect(page.locator('[data-solicitud="pendiente"]', { hasText: teamName })).toHaveCount(0);
  await logout(page);
}

/**
 * Deja al propietario con su equipo: si no lo tiene, presenta la solicitud y la aprueba el
 * administrador. Si ya lo tiene, no hace nada (idempotente; la suite es re-ejecutable).
 */
async function ensureTeamApproved(page: Page, name: string): Promise<void> {
  await login(page, env.ownerEmail!, env.ownerPassword!);
  await page.goto('/team');
  await page.waitForLoadState('networkidle');
  // Sin equipo, el guard lleva a la pantalla de SOLICITUD.
  if (page.url().includes('/onboarding/team')) {
    await requestTeam(page, name);
    await logout(page);
    await approveTeamRequestAsAdmin(page, name);
    await login(page, env.ownerEmail!, env.ownerPassword!);
    await page.goto('/team');
  }
  await expect(page.locator('.page-title')).toHaveText('Plantilla');
}

test.describe('CDMPLab — flujo real en Supabase (opt-in)', () => {
  test.describe.configure({ mode: 'serial' });

  test('ADMIN: login y acceso al panel de administración', async ({ page }) => {
    await login(page, env.adminEmail!, env.adminPassword!);
    await page.goto('/admin');
    await expect(page.locator('.auth-title')).toHaveText('Panel de administración');
    await expect(page.locator('.invite-form')).toBeVisible();
    await logout(page);
  });

  test('OWNER: solicita el equipo de prueba (lo aprueba ADMIN) y crea jugador, carpeta y ejercicio', async ({ page }) => {
    await login(page, env.ownerEmail!, env.ownerPassword!);
    // CAMBIO DE CONTRATO (22/09/2026): la cuenta aprobada SOLICITA el equipo; el equipo lo
    // crea el servidor al aprobarlo un administrador de plataforma.
    await ensureTeamApproved(page, `${PREFIX} Equipo`);

    // Jugador.
    await page.locator('button.btn.btn-primary', { hasText: 'Añadir jugador' }).click();
    await page.locator('.modal input[name="name"]').fill(`${PREFIX} Jugador`);
    await page.locator('.modal input[name="number"]').fill('7');
    await page.locator('.modal select[name="position"]').selectOption({ label: 'Delantero' });
    await page.locator('.modal button.btn.btn-primary', { hasText: 'Guardar' }).click();
    await expect(page.locator('.data-table tbody tr', { hasText: `${PREFIX} Jugador` })).toHaveCount(1);

    // Carpeta.
    await page.goto('/library');
    await page.locator('button.btn.btn-ghost.btn-sm.tree-add', { hasText: 'Nueva carpeta' }).click();
    await page.locator('.tree-inline input.folder-input').fill(`${PREFIX} Carpeta`);
    await page.locator('.tree-inline button.btn.btn-primary.btn-sm', { hasText: 'Crear' }).click();
    await expect(page.locator('.tree-name', { hasText: `${PREFIX} Carpeta` })).toBeVisible();

    // Ejercicio.
    await page.locator('button.btn.btn-primary', { hasText: 'Crear ejercicio' }).click();
    await page.locator('.modal input[name="title"]').fill(`${PREFIX} Ejercicio`);
    await page.locator('.modal button.btn.btn-primary', { hasText: 'Guardar' }).click();
    await expect(page.locator('.ex-card', { hasText: `${PREFIX} Ejercicio` })).toHaveCount(1);

    await logout(page);
  });

  test('COLLAB (antes de ser invitado): NO ve los datos del propietario', async ({ page }) => {
    await login(page, env.collaboratorEmail!, env.collaboratorPassword!);
    // El colaborador no tiene equipo propio → debe estar en onboarding/invitaciones.
    await page.goto('/library');
    await expect(page.locator('.ex-card', { hasText: `${PREFIX} Ejercicio` })).toHaveCount(0);
    await logout(page);
  });

  test('OWNER invita al colaborador; COLLAB acepta y VE los datos compartidos', async ({ page }) => {
    await login(page, env.ownerEmail!, env.ownerPassword!);
    await page.goto('/settings/team/members');
    await page.locator('#invite-email').fill(env.collaboratorEmail!);
    await page.locator('button.btn.btn-primary', { hasText: 'Invitar' }).click();
    await expect(page.locator('.auth-msg.ok')).toBeVisible();
    await logout(page);

    await login(page, env.collaboratorEmail!, env.collaboratorPassword!);
    await page.goto('/invitations');
    await page.locator('button.btn.btn-primary', { hasText: 'Aceptar' }).first().click();
    await page.waitForURL('**/team');
    await expect(page.locator('.page-title')).toHaveText('Plantilla');
    // Ahora ve el jugador del propietario.
    await expect(page.locator('.data-table tbody tr', { hasText: `${PREFIX} Jugador` })).toHaveCount(1);
    // Y la carpeta + el ejercicio.
    await page.goto('/library');
    await expect(page.locator('.tree-name', { hasText: `${PREFIX} Carpeta` })).toBeVisible();
    await expect(page.locator('.ex-card', { hasText: `${PREFIX} Ejercicio` })).toHaveCount(1);
    await logout(page);
  });

  test('COLLAB (aceptado): edita lo permitido y NO puede operar como propietario', async ({ page }) => {
    await login(page, env.collaboratorEmail!, env.collaboratorPassword!);
    // Editar un jugador existente (permitido para editor).
    await page.goto('/team');
    await page.locator('.data-table tr', { hasText: `${PREFIX} Jugador` }).locator('button[aria-label^="Editar"]').click();
    const nameInput = page.locator('.modal input[name="name"]');
    await nameInput.fill(`${PREFIX} Jugador Editado`);
    await page.locator('.modal button.btn.btn-primary', { hasText: 'Guardar' }).click();
    await expect(page.locator('.data-table tbody tr', { hasText: `${PREFIX} Jugador Editado` })).toHaveCount(1);

    // NO puede gestionar miembros (la RPC solo es para propietario): vista de solo lectura.
    await page.goto('/settings/team/members');
    await expect(page.locator('body')).toContainText('Solo el propietario');
    await expect(page.locator('#invite-email')).toHaveCount(0);
    await logout(page);
  });

  test('OWNER revoca al colaborador: deja de acceder a los datos', async ({ page }) => {
    await login(page, env.ownerEmail!, env.ownerPassword!);
    await page.goto('/settings/team/members');
    await page.locator('.invite-row', { hasText: env.collaboratorEmail! }).locator('button', { hasText: 'Revocar' }).click();
    // Confirmar el diálogo.
    await page.locator('.confirm-dialog button', { hasText: 'Revocar' }).click();
    await logout(page);

    await login(page, env.collaboratorEmail!, env.collaboratorPassword!);
    await page.goto('/team');
    await expect(page.locator('.data-table tbody tr', { hasText: `${PREFIX} Jugador Editado` })).toHaveCount(0);
    await logout(page);
  });

  test('LÍMITE real: con 6 colaboradores activos, un séptimo es rechazado por el servidor', async ({ page }) => {
    // El propietario activa exactamente 6 colaboradores usando los correos de prueba.
    await login(page, env.ownerEmail!, env.ownerPassword!);
    await page.goto('/settings/team/members');

    for (const email of env.limitEmails) {
      await page.locator('#invite-email').fill(email);
      await page.locator('button.btn.btn-primary', { hasText: 'Invitar' }).click();
      await expect(page.locator('.auth-msg.ok')).toBeVisible();
      await page.waitForTimeout(200);
    }

    // Aceptar cada invitación con la contraseña común (los 6 se vuelven activos).
    for (const email of env.limitEmails) {
      await logout(page);
      await login(page, email, env.limitPassword!);
      await page.goto('/invitations');
      await page.locator('button.btn.btn-primary', { hasText: 'Aceptar' }).first().click();
      await page.waitForURL('**/team');
    }

    // Volver al propietario e intentar una SÉPTIMA invitación → error funcional del servidor.
    await logout(page);
    await login(page, env.ownerEmail!, env.ownerPassword!);
    await page.goto('/settings/team/members');
    await page.locator('#invite-email').fill(env.collaboratorEmail!); // correo cualquiera (aprobado)
    await page.locator('button.btn.btn-primary', { hasText: 'Invitar' }).click();
    // El servidor responde "collaborator_limit_exceeded" → mensaje de error REAL.
    await expect(page.locator('.auth-msg.err')).toBeVisible();
    await expect(page.locator('.auth-msg.err')).toContainText('máximo de 6 colaboradores');
    // No se creó una séptima invitación visible.
    await expect(page.locator('.invite-row', { hasText: env.collaboratorEmail! })).toHaveCount(0);
    await logout(page);
  });

  test('RECUPERACIÓN: el flujo se inicia desde la UI y responde (correo final = verificación manual)', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await page.locator('#forgot-email').fill(env.ownerEmail!);
    await page.locator('button[type=submit]').click();
    // La UI responde con el mensaje genérico (no revela si existe el correo).
    await expect(page.locator('.auth-msg.ok')).toBeVisible();
    await expect(page.locator('.auth-msg.ok')).toContainText('Si el correo existe');
    // Nota: la recepción del correo y el enlace final requieren verificación manual
    // (no hay acceso al buzón desde esta suite). Documentado en docs/supabase-real-e2e.md.
  });

  test('GUARD: rutas privadas sin sesión redirigen a /auth/login', async ({ page }) => {
    await page.goto('/board');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

// ---------------------------------------------------------------------------
// Estados de acceso (cuentas pendiente / rechazada) — OPCIONALES.
// Si no están configuradas, se omiten y NO cuentan como cobertura completa.
// ---------------------------------------------------------------------------
test.describe('CDMPLab — estados de acceso (opcional)', () => {
  test('perfil PENDIENTE no accede', async ({ page }) => {
    test.skip(!pendingConfigured, 'Cuenta PENDIENTE no configurada; escenario omitido');
    await page.goto('/auth/login');
    await page.locator('#login-email').fill(env.pendingEmail!);
    await page.locator('#login-password').fill(env.pendingPassword!);
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.auth-title')).toHaveText('Aprobación pendiente');
  });

  test('perfil RECHAZADO no accede', async ({ page }) => {
    test.skip(!rejectedConfigured, 'Cuenta RECHAZADA no configurada; escenario omitido');
    await page.goto('/auth/login');
    await page.locator('#login-email').fill(env.rejectedEmail!);
    await page.locator('#login-password').fill(env.rejectedPassword!);
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.auth-title')).toHaveText('Acceso rechazado');
  });
});

// =============================================================
// LIMPIEZA de datos creados por esta ejecución
//
// La suite crea un equipo (con jugador, carpeta y ejercicio) con el PREFIJO único
// `PREFIX`, más 6 colaboradores activos (correos de `SUPABASE_E2E_LIMIT_EMAILS`).
//
// La aplicación NO expone una operación de borrado de equipo desde la UI. Por
// tanto NO se puede limpiar de forma segura y automática solo con la UI. La
// limpieza se documenta como MANUAL (ver docs/supabase-real-e2e.md) y se limita
// al equipo `[PREFIX] Equipo` y los 6 colaboradores del límite, para NO borrar
// registros ajenos:
//   · borrar el equipo `[PREFIX] Equipo` (y en cascada su jugador/carpeta/ejercicio)
//     desde la consola/administración de Supabase (DELETE WHERE teams.name LIKE 'e2e-%');
//   · revocar/cancelar las invitaciones y miembros asociados a `[PREFIX]`.
// Esa limpieza requiere acciones manuales fuera de esta suite; NO se afirma que sea
// automática.
// =============================================================
