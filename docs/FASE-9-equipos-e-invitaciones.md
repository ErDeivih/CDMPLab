# FASE 9 — Equipos e invitaciones: comportamiento ACTUAL y propuesta futura

> Encargo: _«No cambies la arquitectura ni la base remota en esta ronda. Documenta y prueba el
> funcionamiento actual»_. Este documento **no propone cambios de código** (salvo la sección final,
> marcada como NO IMPLEMENTADA) y describe lo que el repositorio hace hoy, con la evidencia en el
> propio código.

## Alcance: qué está verificado y qué no

| Parte                                                                                                                           | Estado en esta ronda                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Reglas de decisión de acceso (quién ve qué pantalla)                                                                            | **Verificado localmente** con unitarias: `src/app/core/access.spec.ts` (8 casos)                                  |
| Límite de colaboradores (4, sin contar al propietario)                                                                          | **Verificado estáticamente** sobre el SQL versionado: `scripts/validate-migration.mjs`                            |
| Pantallas de registro / pendiente / rechazado / suspendido                                                                      | **Verificado localmente** por E2E (`e2e/fase5-local-smoke.spec.ts`)                                               |
| Registro real, aprobación por un administrador de plataforma, aceptación de una invitación y creación de equipo con sesión real | **PENDIENTE de verificación contra Supabase remoto** (prohibido aplicar migraciones o tocar remoto en esta ronda) |

## 1. Cualquiera puede registrarse

La pantalla de registro es pública (`/auth/register`) y no exige invitación ni aprobación previa para
crear la cuenta: el registro llama al alta de Supabase y el perfil nace en estado **`pending`**.
Evidencia: `src/app/features/auth/` (pantallas de alta) y el enum de estados del perfil
(`pending | approved | rejected | suspended`) en el esquema
(`supabase/migrations/20260827000000_entrenolab_schema.sql`).

## 2. Un administrador de plataforma debe aprobar la cuenta

Mientras el perfil está `pending`, la app NO deja entrar al producto: `decideAccess` devuelve
`{ state: 'pending', route: '/pending-approval' }`
(`src/app/core/access.ts`, comprobado por `access.spec.ts` → «perfil pending → /pending-approval»).
La aprobación la hace un administrador de plataforma: el flag se comprueba con la RPC real
`isPlatformAdmin()` (`src/app/core/access.service.ts`, `checkIsPlatformAdmin`), **nunca** por correo
electrónico. Los estados `rejected` y `suspended` tienen pantalla propia (`/access-rejected`,
`/access-suspended`).

## 3. Una cuenta aprobada puede aceptar invitaciones

Si el perfil está `approved`, no tiene equipo propio ni pertenencia y **sí tiene invitaciones
pendientes**, la app lleva a `/invitations` (`state: 'accept-invitation'`). Evidencia:
`src/app/core/access.ts` líneas 46-50 y el caso «aprobado sin equipo y con invitaciones →
accept-invitation» de `access.spec.ts`.

## 4. Una cuenta aprobada SIN equipo también puede crear uno (comportamiento actual)

Es el comportamiento de HOY, no un descuido: si el perfil está `approved`, no tiene equipo, no
pertenece a ninguno y no tiene invitaciones, `decideAccess` devuelve
`{ state: 'create-team', route: '/onboarding/team' }` (caso «aprobado sin equipo ni invitaciones →
create-team»). Es decir: **cualquier cuenta aprobada puede crear un equipo por su cuenta**. Esto es
justo lo que la propuesta final permitiría restringir con un modo configurable.

## 5. El propietario puede invitar hasta cuatro colaboradores; el propietario no cuenta

El límite vive en el servidor, en `private.enforce_collaborator_limit(uuid)`
(`supabase/migrations/20260827000000_entrenolab_schema.sql`, líneas 287-321) y estas son sus reglas
exactas, comprobadas ahora por el validador (`npm run validate:migration`):

- **Solo el propietario** puede invocar la comprobación (`private.is_team_owner(t)` → si no,
  `raise exception 'forbidden: not team owner'`).
- Bloquea la fila del equipo (`for update`) para que dos invitaciones simultáneas no se cuelen.
- Cuenta como «usados» los **miembros activos con `role <> 'owner'`** MÁS las **invitaciones
  pendientes no caducadas**. El propietario **no** consume plaza.
- Con `used >= 4` lanza `collaborator_limit_exceeded` → **máximo 4 colaboradores**.

La función es `security definer` con `search_path = ''` y, tras el endurecimiento, su EXECUTE está
**revocado a `authenticated`** (`20260827000001_entrenolab_hardening.sql`), así que no es una puerta
trasera: solo se usa desde las RPC públicas de invitación.

## 6. La invitación se guarda en la aplicación; NO se envía un correo automático

La invitación se persiste en `public.team_invitations` con estados
`pending | accepted | revoked | expired` y fecha de caducidad (`expires_at`, que es la que usa el
límite). **No hay ningún envío de correo**: una búsqueda de `sendEmail`, `send_email`, `resend`,
`smtp`, `mailgun`, `inviteUserByEmail` o `functions.invoke` sobre `src/**` y `supabase/**` no
devuelve **ni una coincidencia**. El flujo actual es que el propietario comparte el enlace/código de
invitación por el canal que quiera y la persona invitada lo acepta desde `/invitations`.

---

# PROPUESTA — `teamCreationMode = admin-only | approved-users` (NO IMPLEMENTADA)

> Esta sección es una **propuesta separada**, tal y como pide el encargo. **No está implementada** y
> no se ha tocado ni el código ni la base remota.

## Problema

Hoy (punto 4) cualquier cuenta aprobada puede crear un equipo. Si en el futuro el club quiere que la
creación de equipos sea una decisión del administrador de plataforma, hoy **no hay forma de
configurarlo**: haría falta ocultar el botón… lo que **no sería una barrera real** (la RLS y las RPC
seguirían permitiendo crear equipos a quien llame directamente).

## Diseño propuesto (aplicación en el SERVIDOR)

1. **Ajuste de plataforma**: `public.platform_settings.team_creation_mode`
   (`'admin-only' | 'approved-users'`, por defecto `'approved-users'` = comportamiento actual, para
   no cambiar nada el día que se aplique).
2. **Barrera real en Postgres** (no en la UI):
   - `private.can_create_team(uid uuid) returns boolean`: lee el modo y decide
     (`approved-users` → perfil `approved`; `admin-only` → además `is_platform_admin(uid)`).
   - La RPC de creación de equipo (`create_team_with_owner` o equivalente) empieza con
     `if not private.can_create_team(auth.uid()) then raise exception 'team_creation_forbidden'; end if;`
   - **Política RLS de `INSERT` en `public.teams`** que exija la misma función, porque revocar solo
     la RPC dejaría el `insert` directo como vía alternativa. Regla del proyecto: _la seguridad real
     es RLS en el servidor; la UI nunca es la barrera_ (invariante I5).
3. **Contrato de errores**: `team_creation_forbidden` mapeado a español en la capa de datos, junto a
   los códigos ya existentes (`not_authorized`, `fine_not_found`, …).
4. **UI coherente (no barrera)**: con `admin-only` y sin ser administrador, la pantalla
   `/onboarding/team` explica que hace falta que un administrador cree el equipo, en vez de mostrar
   un botón que fallará.
5. **Migración de datos**: ninguna. El modo por defecto mantiene el comportamiento actual.

## Pruebas que exigiría (cuando se implemente)

- Unitarias: `can_create_team` en las dos combinaciones × {aprobado, pendiente} × {admin, no admin}.
- Contrato SQL: el validador de migraciones comprueba `check (team_creation_mode in (...))`, la
  llamada a la función al principio de la RPC y la política RLS de `INSERT`.
- E2E con Supabase real (o doble del repositorio): crear equipo permitido/denegado y mensaje en
  español; **la comprobación de que la RLS lo bloquea aunque se llame al `insert` directamente**.
- Cuando exista, `teamCreationMode` debe documentarse en `docs/` y el mensaje de la UI no puede
  prometer algo que el servidor vaya a rechazar.

## Qué NO se ha hecho

No se ha creado la tabla de ajustes, ni la función, ni la política, ni el modo en el cliente; no se
ha tocado ninguna migración ni el proyecto remoto. La propuesta queda como diseño para una ronda
futura con acceso al proyecto Supabase.
