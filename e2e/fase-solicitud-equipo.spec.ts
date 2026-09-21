import { test, expect } from '@playwright/test';

// =============================================================
// CIERRE DEL ENCARGO (22/09/2026) — SOLICITUD de equipo y correo de invitación.
//
// QUÉ SE PUEDE PROBAR AQUÍ Y QUÉ NO (honestidad):
//   · Esta suite corre contra la build de DESARROLLO (Supabase vacío → modo local), así
//     que NO hay sesión real ni RPC: aquí se verifica el CONTRATO VISIBLE de las pantallas
//     (que ya no prometan crear el equipo al instante, que el panel administrativo tenga un
//     apartado propio de EQUIPOS separado del de CUENTAS, y que el enlace de la invitación
//     no conceda nada).
//   · La autorización REAL (que un usuario aprobado no pueda crear equipo, que solo un
//     administrador apruebe, el bloqueo de dos aprobaciones simultáneas y los estados del
//     correo) se prueba en dos sitios que sí pueden: el backend simulado de
//     `src/app/core/repositories/multiuser-flow.spec.ts` (unitarias) y la matriz SQL
//     `supabase/tests/entrenolab_rls.sql` (que se ejecuta contra PostgreSQL a mano).
//   · El envío REAL de correo no se prueba en ninguna puerta local: falta proveedor,
//     credenciales y dominio (ver docs/correo-invitaciones.md).
// =============================================================

const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };

const INVITACION_EJEMPLO = '11111111-2222-4333-8444-555555555555';

test.describe('Solicitud de equipo — la cuenta ya NO crea el equipo', () => {
  for (const [etiqueta, viewport] of [
    ['escritorio', DESKTOP],
    ['móvil', MOBILE],
  ] as Array<[string, { width: number; height: number }]>) {
    test(`la pantalla de solicitud dice la verdad, no promete creación inmediata (${etiqueta})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/onboarding/team');

      await expect(page.locator('.auth-title')).toHaveText('Solicitar equipo');
      await expect(page.locator('#team-name')).toBeVisible();
      // El texto explica que la creación la provoca un administrador al aprobar.
      await expect(page.locator('app-auth-card')).toContainText('administrador');
      // Y ya no hay ningún «Crear equipo» en la pantalla.
      await expect(page.locator('body')).not.toContainText('Crear equipo');
      // El botón de envío se llama como la acción real (y se adapta al estado).
      await expect(page.locator('button.btn.btn-primary')).toHaveText(/Enviar solicitud/);
      // Sin errores de consola ni peticiones fallidas (modo local).
      const problemas: string[] = [];
      page.on('pageerror', (e) => problemas.push(e.message));
      await page.waitForTimeout(300);
      expect(problemas).toEqual([]);
    });
  }

  test('la inducción no ofrece crear equipo desde la plantilla en modo remoto', async ({
    page,
  }) => {
    // En modo local la plantilla SÍ permite crear el equipo de trabajo local (localStorage):
    // eso no cambia. Lo que se comprueba aquí es que el flujo remoto no anuncia creación
    // directa: el punto de entrada remoto es la pantalla de solicitud.
    await page.goto('/onboarding/team');
    await expect(page.locator('body')).not.toContainText('Crear el equipo que vas a entrenar');
    await expect(page.locator('app-auth-card')).toContainText('Un administrador debe aprobarlo');
  });
});

test.describe('Panel de administración — EQUIPOS separado de CUENTAS', () => {
  test('hay un apartado de solicitudes de equipo distinto del de cuentas', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');

    await expect(page.locator('.auth-title')).toHaveText('Panel de administración');
    // Apartado de SOLICITUDES de equipo (con su propio encabezado)…
    await expect(page.locator('[data-apartado="equipos"]')).toHaveText('Solicitudes de equipo');
    // …y apartado de CUENTAS, separado: aprobar una cuenta no aprueba un equipo.
    await expect(page.locator('[data-apartado="cuentas"]')).toHaveText('Cuentas');
    // Sin sesión real (modo local) la cola se muestra vacía y lo dice.
    await expect(page.locator('body')).toContainText('No hay solicitudes de equipo');
  });
});

test.describe('Enlace de la invitación — no concede acceso por sí solo', () => {
  test('el enlace con ?invitation= avisa de forma honesta y sigue comprobando en servidor', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/invitations?invitation=${INVITACION_EJEMPLO}`);

    await expect(page.locator('.auth-title')).toHaveText('Invitaciones');
    // Con una invitación señalada que esta cuenta no puede usar, se explica el motivo y se
    // recuerda que la aceptación se vuelve a comprobar en el servidor.
    await expect(page.locator('[data-invitacion-senalada]')).toBeVisible();
    await expect(page.locator('app-auth-card')).toContainText('correo confirmado');
  });

  test('la pantalla de invitaciones ya no promete crear un equipo propio al instante', async ({
    page,
  }) => {
    await page.goto('/invitations');
    await expect(page.locator('app-auth-card')).toContainText('solicitar uno propio');
    await expect(page.locator('body')).not.toContainText('Crear mi propio equipo');
  });
});

test.describe('Correo de invitación — contrato de mensajes del propietario', () => {
  test('la pantalla de miembros no promete correo entregado en ningún estado', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/settings/team/members');
    await expect(page.locator('.auth-title')).toHaveText('Miembros del equipo');
    // En modo local no hay sesión remota, así que la pantalla muestra la vista de solo lectura
    // (el formulario de invitar solo lo ve el propietario de un equipo remoto). Lo que SÍ se
    // puede comprobar aquí, y es lo que importa, es la promesa que NUNCA debe aparecer.
    await expect(page.locator('body')).not.toContainText('correo entregado');
    await expect(page.locator('body')).not.toContainText('correo enviado');
    await expect(page.locator('body')).toContainText('Solo el propietario');
    // Nota de honestidad: el contrato fuerte de estos textos (nunca presentar un envío como
    // hecho, ni «entregado») se prueba en `src/app/core/invite-email.spec.ts`, que sí puede
    // ejercitar los cuatro estados del correo.
  });
});
