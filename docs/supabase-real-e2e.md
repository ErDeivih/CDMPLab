# Suite E2E opt-in contra Supabase real (CDMPLab)

Este documento explica cómo preparar y lanzar la suite Playwright que habla con el
**backend Supabase real**. Es **opt-in**: **no** se ejecuta en `npm run test:e2e`
(local) ni en `npm run test:e2e:prod` (smoke de producción sin credenciales) y **no**
está en CI.

- Fichero: `e2e/supabase-real.spec.ts`.
- Config: `playwright.supabase-real.config.ts`.
- Lanzamiento: `npm run test:e2e:supabase-real`.

## Qué hace y qué NO hace

**SÍ:** se conecta al proyecto Supabase real y recorre el flujo real con **cuentas de
prueba separadas** (admin, propietario, colaborador, 4 cuentas para el límite).
Usa la **build de producción** (`npm run build`) servida estáticamente.

**NO:** **no interpola ni simula** Supabase (ni mocks, ni `page.route` sobre el
backend, ni datos falsos). No incrusta correos, contraseñas, UUID ni tokens: **todo**
viene de variables de entorno. Si falta una variable **requerida**, la suite **se
omite en bloque** con un mensaje explícito (nunca da un falso pase). Los estados
`pending` / `rejected` son **opcionales**; si no se configuran, esos escenarios se
omiten y **no** cuentan como cobertura completa.

## Variables de entorno (obligatorias)

| Variable                                         | Descripción                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `SUPABASE_E2E_ADMIN_EMAIL` / `_ADMIN_PASSWORD`   | Administrador de plataforma.                                       |
| `SUPABASE_E2E_OWNER_EMAIL` / `_OWNER_PASSWORD`   | Propietario de un equipo de prueba (sin equipo antes de ejecutar). |
| `SUPABASE_E2E_COLLAB_EMAIL` / `_COLLAB_PASSWORD` | Colaborador sin equipo propio.                                     |
| `SUPABASE_E2E_LIMIT_EMAILS`                      | **6** correos separados por comas (cuentas para probar el límite). |
| `SUPABASE_E2E_LIMIT_PASSWORD`                    | Contraseña común para esos 6 correos.                              |

Opcionales (estados de acceso):

| Variable                                    | Descripción                   |
| ------------------------------------------- | ----------------------------- |
| `SUPABASE_E2E_PENDING_EMAIL` / `_PASSWORD`  | Cuenta con perfil `pending`.  |
| `SUPABASE_E2E_REJECTED_EMAIL` / `_PASSWORD` | Cuenta con perfil `rejected`. |

## Precondiciones por cuenta (se preparan a mano, una vez)

| Cuenta       | Correo confirmado | Perfil aprobado | En `private.platform_admins` | Sin equipo |
| ------------ | ----------------- | --------------- | ---------------------------- | ---------- |
| Admin        | ✅                | ✅              | ✅                           | —          |
| Propietario  | ✅                | ✅              | ❌                           | ✅         |
| Colaborador  | ✅                | ✅              | ❌                           | ✅         |
| 4 del límite | ✅                | ✅              | ❌                           | ✅         |

> El propietario y el colaborador **no** deben compartir equipo antes de la ejecución.
> Las 4 cuentas del límite deben existir, estar confirmadas y aprobadas, y no ser
> miembros del equipo de prueba antes de la ejecución.

## Flujo real cubierto

1. **Admin** inicia sesión y accede a `/admin`.
2. **Propietario** **solicita** un equipo de prueba inequívoco (prefijo único) y el **Admin lo
   aprueba** en el apartado _Solicitudes de equipo_ de `/admin`; el servidor crea el equipo al
   aprobar. Después el propietario crea jugador, carpeta y ejercicio.
   (CAMBIO DE CONTRATO, 22/09/2026: antes el propietario creaba el equipo con un botón; el
   servidor ya no permite que una cuenta aprobada cree equipos por su cuenta.)
3. **Colaborador** (antes de ser invitado) **no** ve esos datos.
4. El propietario **invita** al colaborador; el colaborador **acepta** y **ve** los datos compartidos.
5. El colaborador **edita** lo permitido y **no** puede gestionar miembros (solo lectura).
6. El propietario **revoca** al colaborador; después deja de acceder.
7. **Límite real:** el propietario activa exactamente 6 colaboradores y una **séptima**
   invitación es **rechazada por el servidor** (`collaborator_limit_exceeded`), sin
   crear una séptima invitación ni membresía. No basta un contador visual.
8. **Recuperación:** el flujo se inicia desde la UI, se comprueba la respuesta visible
   (mensaje genérico, sin revelar si el correo existe) y la petición real a Supabase.
   La **recepción del correo y el enlace final requieren verificación manual** (no hay
   acceso al buzón desde la suite).
9. **Guard:** rutas privadas sin sesión redirigen a `/auth/login`.

## Recuperación de contraseña: alcance limitado

La suite **no** pretende leer el correo automáticamente. Solo verifica que:

- el formulario se rellena y se envía desde la UI;
- la app responde con el mensaje genérico esperado;
- se realiza una petición real a Supabase Auth.

La recepción del correo y el enlace de restablecimiento son **manuales** (requieren
acceso al buzón de la cuenta de prueba). Documentado, no automatizado.

## Prefijo único y limpieza (MANUAL)

Cada ejecución genera un prefijo `e2e-<timestamp>-<rand>` y lo antepone a los nombres
de equipo/jugador/carpeta/ejercicio que crea (`[PREFIJO] Equipo`). Así los datos creados
se identifican y pueden eliminarse **sin** afectar a registros ajenos.

**La limpieza NO es automática** (la app no expone borrado de equipo desde la UI). Para
limpiar lo creado por una ejecución se requiere acción **manual** (fuera de la suite):

- borrar el equipo `[PREFIJO] Equipo` (en cascada su jugador/carpeta/ejercicio) desde la
  consola/administración de Supabase: `DELETE FROM public.teams WHERE name LIKE 'e2e-%'`
  (y revisar `team_members`/`team_invitations` asociadas al prefijo), o usar el panel;
- revocar/cancelar las invitaciones y miembros asociados al prefijo.

> La suite **no** borra nada por sí sola. No afirmamos limpieza automática: es manual y
> queda fuera del alcance de la ejecución automatizada.

## Cómo lanzar

```bash
# 1. Configurar TODAS las variables en el shell (nunca en el repo):
#    SUPABASE_E2E_ADMIN_EMAIL, ..._ADMIN_PASSWORD,
#    SUPABASE_E2E_OWNER_EMAIL, ..._OWNER_PASSWORD,
#    SUPABASE_E2E_COLLAB_EMAIL, ..._COLLAB_PASSWORD,
#    SUPABASE_E2E_LIMIT_EMAILS='c1@...,c2@...,c3@...,c4@...', SUPABASE_E2E_LIMIT_PASSWORD
#    (y las opcionales SUPABASE_E2E_PENDING_* / _REJECTED_*)

# 2. La suite hace `ng build` y luego `playwright test --config=playwright.supabase-real.config.ts`
npm run test:e2e:supabase-real
```

Si falta una variable **obligatoria**, el reporte mostrará `skip` con el motivo
explícito (`Variables de entorno ausentes; se OMITE la suite Supabase-real: ...`).
Si `SUPABASE_E2E_LIMIT_EMAILS` no trae exactamente 6 correos, el escenario de límite
se omite con su propio motivo.

> **Sin credenciales esta suite NO se ejecuta.** En el informe final debe figurar como
> **NO EJECUTADA** (no "passed") cuando no se dispone de las variables.
