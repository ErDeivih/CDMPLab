import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

// =============================================================
// CIERRE — GESTIÓN de cuentas y pertenencia: salir de un equipo, traspasar la propiedad
// y borrar una cuenta.
//
// QUÉ SE PUEDE PROBAR AQUÍ Y QUÉ NO (honestidad, igual que en las otras specs de esta fase):
//   · Esta suite corre contra la build de DESARROLLO (Supabase vacío → modo local), así que NO
//     hay sesión real ni RPC: se verifica el CONTRATO VISIBLE de las pantallas —que las acciones
//     de permisos no se ofrezcan a quien no puede hacerlas y que las destructivas no aparezcan
//     nunca sin su vista previa y su confirmación— y que los textos de esas confirmaciones están
//     DENTRO del artefacto que se publica.
//   · La autorización REAL (que un editor no pueda traspasar, que el propietario no pueda salir,
//     que un administrador no pueda borrar a otro administrador ni a quien posee un equipo, y que
//     el borrado deje registro) se prueba en dos sitios que sí pueden:
//       – el backend simulado de `src/app/core/repositories/multiuser-flow.spec.ts` (unitarias),
//       – y la matriz SQL `supabase/tests/entrenolab_rls.sql`, que se ejecuta contra PostgreSQL
//         a mano (PENDIENTE de ejecución contra el proyecto real).
// =============================================================

const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };

const DIST = path.resolve('dist/entrenolab/browser');

/** Todo el JavaScript de la build (los chunks diferidos incluidos). */
function bundleJs(): string {
  return fs
    .readdirSync(DIST)
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(DIST, f), 'utf8'))
    .join('\n');
}

test.describe('Miembros del equipo — las acciones de permisos no se ofrecen a quien no puede', () => {
  for (const [etiqueta, viewport] of [
    ['escritorio', DESKTOP],
    ['móvil', MOBILE],
  ] as Array<[string, { width: number; height: number }]>) {
    test(`sin ser propietario no se ofrecen traspaso ni gestión de invitaciones (${etiqueta})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/settings/team/members');

      await expect(page.locator('.auth-title')).toHaveText('Miembros del equipo');
      // Ni traspasar la propiedad ni invitar: son del propietario.
      await expect(page.locator('[data-accion="traspasar-propiedad"]')).toHaveCount(0);
      await expect(page.locator('#invite-email')).toHaveCount(0);
      await expect(page.locator('body')).toContainText('Solo el propietario');
    });
  }

  test('salir del equipo NO se ofrece sin una pertenencia activa comprobada por el servidor', async ({
    page,
  }) => {
    await page.goto('/settings/team/members');
    // En modo local no hay sesión remota ni rol: el servidor no ha dicho «eres editor activo»,
    // así que la acción no se pinta. Ofrecerla sería prometer algo que la RPC rechazaría.
    await expect(page.locator('[data-accion="salir-equipo"]')).toHaveCount(0);
  });
});

test.describe('Panel de administración — borrar cuentas no se ofrece sin vista previa', () => {
  test('no hay ningún botón de borrado sin una cuenta seleccionada', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/admin');

    await expect(page.locator('.auth-title')).toHaveText('Panel de administración');
    // Sin perfiles que mostrar (modo local), no hay ninguna acción de borrado en pantalla y
    // tampoco ningún panel de confirmación abierto: la acción destructiva solo existe dentro de
    // su flujo (vista previa → escribir el correo → confirmar).
    await expect(page.locator('[data-accion="eliminar-cuenta"]')).toHaveCount(0);
    await expect(page.locator('[data-panel-borrado]')).toHaveCount(0);
    await expect(page.locator('[data-accion="confirmar-borrado"]')).toHaveCount(0);
  });
});

test.describe('Artefacto publicado — los textos de las acciones nuevas van dentro', () => {
  test('el bundle contiene las confirmaciones de salir, traspasar y borrar cuenta', () => {
    const js = bundleJs();
    expect(js, 'no se encontró el bundle de la build').toBeTruthy();
    // OJO: la build escapa los acentos (`\xE1`), así que los fragmentos comprobados son ASCII.
    // Confirmación de SALIR: explica qué se pierde.
    expect(js).toContain('Salir del equipo');
    expect(js).toContain('el acceso a los jugadores');
    expect(js).toContain('volver a invitarte');
    // Confirmación de TRASPASO: avisa de que el propietario baja a colaborador.
    expect(js).toContain('Traspasar la propiedad');
    expect(js).toContain('gestionar miembros');
    // Confirmación de BORRADO: dice que no se puede deshacer y exige escribir el correo.
    expect(js).toContain('Eliminar cuenta');
    expect(js).toContain('No se puede deshacer');
    expect(js).toContain('para confirmar');
    // Y el aviso de que el propietario tiene que traspasar antes de irse o de ser borrado.
    expect(js).toContain('antes la propiedad');
  });
});
