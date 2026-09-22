# Solicitud de equipo aprobada por el administrador + correo de invitación real

> **Estado vigente 22/09/2026:** gestión de cuentas y equipos aplicada en remoto
> (`20260922101345_account_and_membership_management`) y probada con la matriz SQL en
> `ROLLBACK`. Los pasajes que hablan de «no aplicada» describen el informe local anterior.
> El correo real sigue pendiente de configurar Resend y el SMTP de Auth.

> Encargo del dueño (22/09/2026): _«para crear un equipo, ¿el admin (yo) tiene forma de aceptar
> esa solicitud? debería estar restringido a admin(s)»_ y _«¿hay alguna forma de enviar
> correctamente los correos para las invitaciones?»_.
>
> Este documento describe **lo que hay en el repositorio** y, al final, **lo que NO está
> verificado**. El correo tiene su propio documento (`docs/correo-invitaciones.md`) y la
> configuración del correo de Supabase Auth, otro aparte (`docs/smtp-supabase-auth.md`).

> **Estado posterior al despliegue de base (21/09/2026):** el catálogo remoto se comprobó
> antes de aplicar el cambio. Supabase registra `20260921193229_team_creation_requests` y
> `20260921193506_clear_stale_invitation_email_result`. La matriz
> `supabase/tests/entrenolab_rls.sql` pasó contra PostgreSQL real con `ROLLBACK`; no dejó
> usuarios ni invitaciones de prueba. La Edge Function `invite-team-member` está desplegada
> con verificación de JWT y una petición sin autorización recibió HTTP 401. **No hay proveedor
> de correo configurado ni se ha recibido un email real.** Los resultados locales históricos
> de las tablas siguientes deben leerse junto con esta actualización.

## 0. Respuesta corta a las dos preguntas

1. **Antes de este cambio, NO**: el panel de administración solo aprobaba **cuentas**
   (`admin_set_profile_status`) y, una vez aprobada una cuenta, cualquier usuario sin equipo
   podía crear el suyo (`decideAccess` → `/onboarding/team` → RPC `create_my_team` + política
   `teams_insert_owner` + `GRANT INSERT` sobre `teams`). No existía ninguna «solicitud de equipo»
   que el administrador pudiera aceptar.
2. **`/admin` ya no es solo cuentas**: tiene un apartado propio **Solicitudes de equipo** con
   quién lo pide, el nombre y el color, y botones de aprobar/rechazar. Al aprobar, el
   **servidor** crea el equipo en la misma transacción.
3. **Correo**: la invitación se sigue creando en la base, y ahora además se **pide el envío real**
   a una función de servidor (Supabase Edge Function) con la clave del proveedor como secreto.
   El envío **real todavía no se ha probado**: falta proveedor, credenciales y dominio
   (ver §7).

## 1. Regla de seguridad que gobierna todo esto

| Regla del proyecto                                     | Cómo se cumple aquí                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| La seguridad real es RLS/RPC en el servidor            | El permiso no se decide en la interfaz: `create_my_team` cierra la vía, se retira la política y el GRANT de INSERT sobre `teams`             |
| Nunca autorizar por correo ni por metadata             | El permiso de administrador sale de `private.platform_admins` (sin acceso de tabla para el cliente), nunca de un correo o de `user_metadata` |
| Un usuario = como máximo UN equipo propio              | `teams.owner_user_id` único + índice único parcial de **una** solicitud pendiente por usuario                                                |
| Nada con histórico se borra                            | Las solicitudes rechazadas **no** se borran: quedan como registro de quién pidió y qué se decidió                                            |
| Un pendiente no se cierra sin verificar contra la base | Catálogo contrastado antes de aplicar; permisos y matriz RLS verificados después en el proyecto real                                         |

## 2. Requisito → implementación → prueba → resultado

| Requisito del encargo                                                                   | Implementación (fichero)                                                                                                                                                                | Prueba                                                                                                                                                                                               | Resultado                                              |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Una cuenta aprobada **solicita** un equipo; **no lo crea**                              | `request_team_creation` (migración `20260922000000`), `decideAccess` → `request-team`, pantalla `/onboarding/team`                                                                      | `src/app/core/invite-email.spec.ts` (n/a), `access.spec.ts` (request-team), unit `multiuser-flow.spec.ts` (solicitud), E2E `fase-solicitud-equipo.spec.ts`                                           | ✅ verde                                               |
| Solo un **administrador de plataforma** ve/aprueba/rechaza                              | `admin_list_team_requests`, `admin_decide_team_request` (DEFINER + `private.is_platform_admin()`), apartado propio en `/admin`                                                          | unit `multiuser-flow.spec.ts` («solo el administrador…»), E2E E2E apartado `[data-apartado="equipos"]`                                                                                               | ✅ verde                                               |
| Al aprobar, **el servidor crea el equipo en la misma transacción**                      | `admin_decide_team_request` inserta en `public.teams` dentro de la misma función/transacción                                                                                            | unit `multiuser-flow.spec.ts` (equipo creado al aprobar), matriz SQL `supabase/tests/entrenolab_rls.sql`                                                                                             | ✅ unit; SQL **sin ejecutar** (ver §7)                 |
| La operación es **idempotente** y resiste **dos aprobaciones simultáneas**              | `select … for update` sobre la solicitud + `if status='approved' then return created_team_id` + `teams_owner_unique`                                                                    | unit (repetir devuelve el mismo equipo), validador de migración (exige `for update` e idempotencia)                                                                                                  | ✅ estático + unit; concurrencia real **no ejecutada** |
| El solicitante ve **pendiente / rechazado / aprobado**                                  | `resolveAccess().teamRequest`, pantalla con aviso `[data-estado-solicitud]`                                                                                                             | unit `access.spec.ts`, E2E `fase-solicitud-equipo.spec.ts`, unit `multiuser-flow.spec.ts` (motivo visible)                                                                                           | ✅ verde                                               |
| Tras un **rechazo** se puede volver a solicitar de forma comprensible                   | El rechazo guarda `note` y la fila queda `rejected`; una nueva solicitud crea fila nueva (índice parcial solo para pendientes)                                                          | unit «el rechazo deja motivo… y permite VOLVER a solicitar»                                                                                                                                          | ✅ verde                                               |
| **Aprobar una cuenta ≠ aprobar un equipo**                                              | Dos RPC distintas (`admin_set_profile_status` / `admin_decide_team_request`) y dos apartados en el panel                                                                                | E2E apartados separados; unit `decideAccess` (una cuenta aprobada sin solicitud no tiene equipo)                                                                                                     | ✅ verde                                               |
| Los equipos existentes y aceptar invitación siguen funcionando                          | No se toca ni `teams`, ni `team_members`, ni `accept_team_invitation`                                                                                                                   | unit `multiuser-flow.spec.ts` (recorrido completo), E2E de biblioteca/pizarra de la suite completa                                                                                                   | ✅ verde (ver §6)                                      |
| **Bypass por RPC**: `create_my_team` no debe crear equipos a un no administrador        | La RPC se redefine: `if not private.is_platform_admin() then raise 'team_creation_requires_approval'`                                                                                   | unit `multiuser-flow.spec.ts` (llamada directa al servidor simulado), matriz SQL, validador                                                                                                          | ✅ unit + estático                                     |
| **Bypass por INSERT directo** en `teams`                                                | `drop policy teams_insert_owner` + `revoke insert on table public.teams from authenticated`                                                                                             | unit (INSERT directo rechazado), matriz SQL, validador (estado final = REVOKE)                                                                                                                       | ✅ unit + estático; RLS real **sin ejecutar**          |
| No basar el permiso en metadata editable por el usuario                                 | Solo `private.platform_admins`                                                                                                                                                          | validador de migración (prohíbe `user_metadata`), matriz SQL                                                                                                                                         | ✅ estático                                            |
| **Correo de invitación real** desde el servidor, con el secreto fuera del navegador     | Edge Function `invite-team-member` + módulo puro `_shared/invite-email.ts`                                                                                                              | `npm run validate:invite-email` (35 comprobaciones, importa el módulo real)                                                                                                                          | ✅ puerta verde; **envío real pendiente** (§7)         |
| Autoriza al remitente (propietario) y respeta el límite de 6 plazas contando pendientes | `prepare_invitation_email` valida propiedad; el límite ya lo aplica `invite_team_member` → `enforce_collaborator_limit`                                                                 | unit `multiuser-flow.spec.ts` (límite), puerta del correo (la función llama a la RPC de preparación)                                                                                                 | ✅ estático + unit                                     |
| Sirve para quien ya tiene cuenta y para quien debe registrarse                          | La invitación guarda `email_normalized` y `invited_user_id` si existe; el enlace lleva a `/invitations`                                                                                 | unit (invitado sin equipo ve su invitación), E2E del enlace                                                                                                                                          | ✅ verde                                               |
| El enlace **no concede acceso** por sí solo                                             | `accept_team_invitation` vuelve a comprobar el correo confirmado del que entra                                                                                                          | unit `multiuser-flow.spec.ts`, E2E `fase-solicitud-equipo.spec.ts` (aviso honesto)                                                                                                                   | ✅ verde                                               |
| Estados **distinguibles** del envío                                                     | Columnas `email_status` (`created`/`send_pending`/`provider_accepted`/`send_error`), `email_attempts`, `last_email_at`, `last_email_error`, `email_attempt_id`                          | unit `invite-email.spec.ts` (20 pruebas) + puerta del correo                                                                                                                                         | ✅ unit + estático                                     |
| **El resultado del proveedor solo lo registra el servidor** (no el navegador)           | `record_invitation_email_result` con `revoke execute … from public, anon, authenticated` + `grant execute … to service_role`; la Edge Function lo llama con `SUPABASE_SERVICE_ROLE_KEY` | unit `multiuser-flow.spec.ts` («el propietario NO puede falsificar provider_accepted», «un no propietario tampoco», «el cliente no expone ningún método»), validador de migración, puerta del correo | ✅ unit + estático; **PostgreSQL real pendiente** (§7) |
| Una respuesta **tardía** no sobrescribe el intento nuevo                                | `prepare_invitation_email` abre intento (`email_attempt_id = gen_random_uuid()`) y lo devuelve como `attempt_id`; el registro exige que coincida (`stale_email_attempt`)                | unit «un resultado de un intento ANTIGUO no cambia el estado del intento nuevo», validador (exige el vínculo) y matriz SQL con `set role service_role`                                               | ✅ unit + estático; **PostgreSQL real pendiente** (§7) |
| Reintento **sin duplicar** invitaciones ni enviar ilimitados                            | Índice único parcial de invitación pendiente + cooldown 60 s + tope de 5 intentos, y el propietario sigue siendo quien pide el envío                                                    | unit `invite-email.spec.ts` (política de reintento), validador de migración                                                                                                                          | ✅ unit + estático                                     |
| **Sin poder registrar el resultado, no se envía** (revisión del dueño, 22/09/2026)      | `resolveSendReadiness` (módulo puro) comprueba credencial de servidor + URL + clave publicable + configuración de correo **antes** de abrir el intento y de llamar al proveedor         | puerta del correo: 5 pruebas de comportamiento del módulo puro + «credencial ausente → cero envíos y cero intentos consumidos» (orden en el fichero y mensaje que no afirma nada)                    | ✅ comportamiento real (módulo importado) + estático   |
| No presentar «correo entregado» cuando el proveedor solo aceptó el envío                | `provider_accepted` = «aceptado por el proveedor (entrega no confirmada)»                                                                                                               | unit `invite-email.spec.ts` (el texto NO contiene «entregado»)                                                                                                                                       | ✅ verde                                               |
| Correo con el nombre del equipo y enlace de **producción** bajo `/CDMPLab/`             | `buildInviteLink(linkBase, link_path)`; `INVITE_LINK_BASE` parametrizado                                                                                                                | puerta del correo (acepta `/CDMPLab/`, rechaza localhost), unit del cliente (`invitationLink` con base de Pages)                                                                                     | ✅ estático + unit                                     |
| Escapar el texto introducido por usuarios                                               | `escapeHtml` en asunto y HTML del correo                                                                                                                                                | puerta del correo (prueba con `<img src=x onerror=…>`)                                                                                                                                               | ✅ verde                                               |
| No registrar tokens ni secretos                                                         | `redactError`, logs estructurales sin datos personales, `Deno.env.get` variable a variable                                                                                              | puerta del correo (prohíbe claves en logs y en literales)                                                                                                                                            | ✅ estático                                            |
| Documentar **aparte** el SMTP de Supabase Auth                                          | `docs/smtp-supabase-auth.md`                                                                                                                                                            | Revisión de contenido (documento separado, con pasos manuales)                                                                                                                                       | ✅ documento                                           |

## 3. Ficheros de esta fase

**SQL / base**

- `supabase/migrations/20260922000000_team_creation_requests.sql` — tabla `public.team_requests`
  con RLS de solo lectura, RPC `request_team_creation`, `admin_list_team_requests`,
  `admin_decide_team_request`, cierre de `create_my_team`, retirada del INSERT directo en `teams`
  y columnas de estado del correo + `prepare_invitation_email` / `record_invitation_email_result`.
- `supabase/tests/entrenolab_rls.sql` — matriz RLS/RPC ampliada: solicitud, aprobación por
  administrador, **los dos intentos de bypass**, rechazo + nueva solicitud, `requester_not_approved`,
  idempotencia, los estados del correo y —tras la revisión del dueño— el **registro del resultado**
  (el propietario recibe «permission denied», `service_role` registra, un intento antiguo se
  ignora con `stale_email_attempt`). (Se ejecuta a mano contra PostgreSQL.)
- `scripts/validate-migration.mjs` — comprobaciones estáticas de esta migración y, **cambio de
  contrato**, el estado FINAL de `public.teams` debe ser un REVOKE de `INSERT`; además exige que
  el registro del correo esté revocado a `authenticated` y concedido solo a `service_role`, que
  esté vinculado al intento y que se retire la firma antigua sin `attempt_id`.

**Cliente (Angular)**

- `src/app/core/access.ts` — estados `request-team` y `request-pending` (antes `create-team`).
- `src/app/core/access.service.ts` — `requestTeamCreation`, `myTeamRequest`, `listTeamRequests`,
  `approveTeamRequest`, `rejectTeamRequest`, `sendInvitationEmail`; **retirado** `createTeam`.
- `src/app/core/repositories/data-source.ts` / `supabase-data-source.ts` — contrato nuevo
  (`TeamRequestInfo`), retirada de `createTeam`, estado del correo en las invitaciones.
- `src/app/core/invite-email.ts` (+ `.spec.ts`) — contrato puro del correo en el cliente.
- `src/app/features/auth/onboarding-team.component.*` — pantalla de **solicitud** (estados y
  reenvío).
- `src/app/features/auth/admin-access.component.*` — apartado «Solicitudes de equipo» separado de
  «Cuentas».
- `src/app/features/auth/members.component.*` — estado del correo por invitación, reintento y
  copia del enlace.
- `src/app/features/auth/invitations.component.*` — `?invitation=…` con aviso honesto.
- `src/app/features/roster/roster.component.*` — en modo remoto ya no crea equipos; ofrece la
  importación de datos locales (que antes vivía en la pantalla de alta).

- `supabase/migrations/20260924000000_account_and_membership_management.sql` — borrar cuenta
  (con guardas y auditoría), salir del equipo y traspasar la propiedad. **No aplicada.** (La marca
  `20260923000000` ya la ocupa `clear_stale_invitation_email_result`; dos ficheros con el mismo
  prefijo son la MISMA migración para el CLI, por eso esta lleva `20260924000000`.)
- `src/app/core/team-management.ts` (+ `.spec.ts`) — reglas puras de permisos y confirmaciones
  (qué acción se ofrece, qué se explica y cuándo la confirmación reforzada está completa).
- `e2e/fase-gestion-cuentas-equipos.spec.ts` — contrato visible en modo local + comprobación de que
  los textos de las confirmaciones están dentro del artefacto que se publica.

**Correo (función de servidor)** — ver `docs/correo-invitaciones.md`: módulo puro, Edge Function,
`README.md` de la función y `scripts/validate-invite-email.mjs`.

## 4. Cómo probarlo a mano (cuando exista un proyecto con la migración aplicada)

1. Registra una cuenta nueva y **apruébala** en `/admin` (apartado _Cuentas_).
2. Entra con ella: verás **«Solicitar equipo»**. Escribe un nombre y envía. El aviso dice que
   está **pendiente**; no hay equipo todavía y la plantilla no deja crear jugadores.
3. Vuelve a entrar como administrador: en `/admin`, apartado **Solicitudes de equipo**, aparece
   quién la pide. Pulsa **Aprobar y crear equipo**.
4. Entra otra vez con la cuenta: ahora sí tiene equipo (plantilla, biblioteca, pizarras).
5. **Rechazar** funciona igual y deja un motivo opcional; la cuenta puede volver a solicitarlo.
6. Comprobación de los bypass (en el editor SQL, como ese usuario):
   - `select public.create_my_team('X', '#3056d3');` → `team_creation_requires_approval`;
   - `insert into public.teams (owner_user_id, name) values (auth.uid(), 'X');` → error de RLS.
7. Invitaciones: invita a un correo y mira el estado del envío en la fila.

## 5. Secuencia de despliegue segura (por etapas; nada de esto lo hace el repositorio solo)

**Etapas 0–3: completadas en la base remota.** Ya existe `team_requests`, se retiró el INSERT
directo sobre `teams` y la matriz de permisos/RPC pasó con `ROLLBACK`. La función de correo
está desplegada, pero sin proveedor configurado no envía emails. La interfaz nueva requiere
todavía publicar la versión correspondiente de GitHub Pages.

**Etapa 1 — comprobar el catálogo remoto ANTES de tocar nada.** Con la migración en la mano,
verificar que lo que asume sigue siendo cierto:

```sql
-- a) ¿existe ya la tabla o la función (aplicación previa a medias)?
select to_regclass('public.team_requests');
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname in ('create_my_team','prepare_invitation_email','record_invitation_email_result');
-- b) ¿sigue la política de INSERT en teams que esta migración retira?
select polname, polcmd from pg_policy where polrelid = 'public.teams'::regclass;
-- c) ¿qué columnas tiene ya team_invitations (email_*)?
select column_name from information_schema.columns
 where table_schema='public' and table_name='team_invitations';
-- d) privilegios actuales sobre teams y sobre la RPC del correo
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name='teams';
select grantee, privilege_type from information_schema.routine_privileges
 where routine_name in ('create_my_team','prepare_invitation_email','record_invitation_email_result');
```

**Etapa 2 — aplicar la migración** (`supabase migration new` + `migrate`, o MCP `apply_migration`),
en una ventana de mantenimiento corta y **con copia de seguridad previa**. Después, comprobar el
resultado con las consultas del apartado 9 de la propia migración (políticas de `teams`, índice
parcial, `has_function_privilege` de la RPC del correo y ausencia de la firma antigua).

**Etapa 3 — probar la seguridad en el servidor real** (esto es lo que sustituye a la inspección del
texto SQL, y es lo que **está pendiente**):

1. Ejecutar `supabase/tests/entrenolab_rls.sql` contra el proyecto real (dentro de una transacción
   con `rollback`, como está escrito).
2. Los dos bypass de creación de equipos, con la sesión de una cuenta aprobada normal:
   `select public.create_my_team('X', '#3056d3');` → `team_creation_requires_approval`;
   `insert into public.teams (owner_user_id, name) values (auth.uid(), 'X');` → permiso/RLS.
3. El agujero corregido, con la sesión del PROPIETARIO de un equipo:
   `select public.record_invitation_email_result('<invitación>', '<intento>', 'provider_accepted', 'x', null);`
   → **`permission denied for function record_invitation_email_result`** (y el estado no cambia).
   Lo mismo con la sesión de otro usuario.
4. Solicitud → aprobación por el administrador → equipo creado; y dos aprobaciones seguidas
   devuelven el **mismo** equipo.

**Etapa 4 — correo: proveedor y secretos.** Crear la cuenta del proveedor transaccional, verificar
el dominio remitente (SPF/DKIM/DMARC) y definir los secretos de la función:

```bash
supabase secrets set EMAIL_PROVIDER=resend EMAIL_API_KEY=… EMAIL_FROM=… \
  EMAIL_FROM_NAME='CDMPLab' INVITE_LINK_BASE='https://<usuario>.github.io/CDMPLab/'
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta la plataforma en las
Edge Functions alojadas; **no hay que definirlos a mano** (y la credencial de servicio nunca sale
del servidor).

**Etapa 5 — desplegar la Edge Function** (`supabase functions deploy invite-team-member`). El
repositorio **no tiene `config.toml`**: hay que enlazar el proyecto (`supabase link`).

**Etapa 6 — verificar con un correo recibido** (no vale «la función respondió 200»): invitar un
buzón real, recibir el correo, comprobar el asunto y el enlace bajo `/CDMPLab/`, abrirlo, iniciar
sesión con esa cuenta y aceptar la invitación. Después, en la base:
`select email_status, provider_message_id, last_email_error from public.team_invitations where id = '…';`
→ `provider_accepted` con identificador del proveedor.

**Etapa 7 — SMTP de Supabase Auth** para confirmación de registro y recuperación de contraseña:
`docs/smtp-supabase-auth.md` (es otra cosa distinta del correo de invitación).

## 6. Estado de las puertas en esta ronda (medido, con códigos de salida)

| Puerta                                                                 | Resultado                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run test:unit`                                                    | **612 pruebas / 34 ficheros en verde** (antes de esta fase: 545) — exit 0 |
| `npm run validate:migration`                                           | verde, con las 22 comprobaciones de la migración de gestión — exit 0      |
| `npm run validate:invite-email`                                        | verde, **42 comprobaciones** — exit 0                                     |
| `e2e/fase-solicitud-equipo.spec.ts` (dirigida)                         | 7 pruebas en verde — exit 0                                               |
| `e2e/fase-gestion-cuentas-equipos.spec.ts` (nueva, dirigida)           | 5 pruebas en verde — exit 0                                               |
| E2E dirigidas del conjunto (las dos anteriores + smoke + multiusuario) | 47 pruebas en verde — exit 0                                              |
| **Suite E2E completa** (`playwright.dev.config.ts --workers=1`)        | **883 en verde, 11 omitidas, exit 0** (28,8 min)                          |
| `npm run lint` / `format:check` / `typecheck:e2e` / codificación       | sin deuda nueva — exit 0                                                  |
| `npm run build`                                                        | compila sin avisos de presupuesto — exit 0                                |
| `npm run build:pages` + E2E del artefacto de Pages                     | build exit 0; **14 pruebas** en verde — exit 0                            |
| `git diff --check`                                                     | sin errores de espacio — exit 0                                           |

Las 11 omitidas de la suite completa son las capturas que solo corren con su variable
(`CAPTURAS_*`): en esta ronda no se han pedido para no reescribir galerías ajenas al encargo.

**Alcance de estos números (honestidad).** La suite completa se ejecutó **antes** de los dos
últimos retoques de la pantalla de miembros (navegar al destino que decide el servidor al salir de
un equipo, y mostrar al propietario el motivo por el que no puede salir): son cambios de
comportamiento de esa pantalla, así que se repitieron las pruebas **dirigidas** (47 en verde) y los
builds con el árbol final. Ninguna otra spec toca esa pantalla, así que el resultado de la suite
completa sigue siendo representativo del resto de la aplicación.

**Alcance de estos números (honestidad).** La suite E2E completa se ejecutó **antes** de la
corrección del registro del correo. Esa corrección no tocó **ni una línea de código de la
aplicación** (solo la migración, la matriz SQL, la Edge Function, los dos validadores, las pruebas
unitarias y la documentación), así que el resultado sigue siendo válido; aun así se repitieron las
pruebas **dirigidas** (42 en verde), `build`, `build:pages` y el E2E del artefacto de Pages
(14 en verde) con el árbol corregido. La suite completa **no** se ha vuelto a ejecutar en esta
corrección.

## 7. Qué NO está verificado (honestidad)

- **Permisos y RLS verificados en PostgreSQL real.** La matriz `entrenolab_rls.sql` pasó dentro
  de una transacción con `ROLLBACK`: cubre solicitud, aprobación, intentos de bypass y registro
  del correo solo por `service_role`. La migración y la corrección incremental constan en el
  historial remoto. El test dejó cero usuarios e invitaciones de prueba.
- **La concurrencia real no se ha ejecutado.** El `for update` y los índices únicos están escritos y
  el validador los exige, pero dos transacciones simultáneas solo se pueden demostrar contra
  PostgreSQL.
- **El correo no se ha enviado nunca**: la función está desplegada, pero no hay proveedor,
  credenciales ni dominio verificado. La entrega, los rebotes y el spam solo los puede confirmar
  una prueba con el proveedor y el buzón: eso sigue pendiente.
- **`SUPABASE_SERVICE_ROLE_KEY` no se ha probado con un envío real.** Si falta, la función
  responde `not_configured` **antes** de abrir el intento y de contactar al proveedor (el
  comportamiento del módulo puro está probado importándolo de verdad, y el orden de la llamada
  está comprobado de forma estática): cero envíos y cero intentos consumidos. Lo que no se ha
  ejecutado es la función en Deno con esa variable ausente.
- **La suite E2E real de Supabase** (`e2e/supabase-real.spec.ts`, opt-in por variables de
  entorno) se ha **actualizado** al flujo nuevo (solicitar + aprobar) pero **no se ha ejecutado**
  en esta ronda: no hay credenciales en el entorno.
- **El estado visual** de las pantallas nuevas no se ha revisado con ojos (el modelo no puede leer
  imágenes): el contrato está medido con E2E (textos, apartados y avisos), pero la revisión
  estética es del dueño.

## 8. Gestión de cuentas y equipos: qué se puede hacer hoy

> **Actualizado el 22/09/2026.** Las tres operaciones ya están implementadas y la migración
> `20260924000000_account_and_membership_management.sql` se aplicó en remoto como
> `20260922101345_account_and_membership_management`. Se verificó el catálogo previo y pasó
> la matriz SQL real con `ROLLBACK`. Todo lo que decide quién puede hacer qué está en el servidor;
> la interfaz solo evita ofrecer lo que el servidor rechazaría.

| Operación                  | ¿Se puede?                        | Cómo funciona                                                                                                                                                                                                                                             | Confirmación                                                                                                                                               |
| -------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eliminar una cuenta**    | **Sí** (solo el administrador)    | RPC `admin_delete_account`: borra el usuario de Auth (perfil y membresías caen por cascada) y deja registro en `public.account_deletions` (sin clave foránea: sobrevive al borrado). Antes se consulta la vista previa `admin_deletion_preview`.          | **Doble**: vista previa con lo que se lleva por delante + **escribir el correo exacto** + diálogo de confirmación. El texto dice que no se puede deshacer. |
| **Quitar colaboradores**   | **Sí** (el propietario)           | `revoke_team_member` (editor activo → `revoked`) y `cancel_team_invitation` (invitación pendiente). El invitado puede rechazar la suya (`decline_team_invitation`).                                                                                       | Diálogo de confirmación (ya existía).                                                                                                                      |
| **Salir de un equipo**     | **Sí** (el propio miembro activo) | RPC `leave_team`: la membresía pasa a `revoked` (no se borra: se conserva el histórico) y se revocan sus invitaciones pendientes de ese equipo. El **propietario no puede**: `owner_cannot_leave`.                                                        | Diálogo que enumera lo que se pierde y avisa de que habrá que volver a invitarle.                                                                          |
| **Traspasar la propiedad** | **Sí** (solo el propietario)      | RPC `transfer_team_ownership`: el destinatario debe ser **editor activo**, con perfil aprobado y **sin equipo propio**; cambia `teams.owner_user_id` y los **dos roles de membresía en la misma transacción**. El número de cuentas del equipo no cambia. | Diálogo con las consecuencias para las dos partes (el actual baja a colaborador y pierde la gestión de miembros).                                          |
| **Borrar un equipo**       | **No**                            | No existe ninguna operación que borre un equipo (ni RPC ni `DELETE` concedido al cliente). Por eso, para borrar la cuenta de quien POSEE un equipo hay que **traspasarlo primero**: el bloqueo `target_owns_team` lo impide y lo explica.                 | —                                                                                                                                                          |

Guardas que **no** dependen de la interfaz (las comprueba el servidor y están en la matriz
`supabase/tests/entrenolab_rls.sql`):

- borrar: no a **uno mismo** (`cannot_delete_self`), no a otro **administrador**
  (`cannot_delete_platform_admin`), no a quien **posee un equipo** (`target_owns_team`);
- traspasar: solo el propietario, solo a miembro **activo** y **aprobado**, y no a quien ya posee
  otro equipo (`new_owner_already_has_team`);
- salir: solo un miembro **activo** que no sea el propietario;
- la auditoría de bajas **solo la lee el administrador** y **nadie la escribe desde el cliente**
  (un `insert` directo falla: sin política de escritura y sin GRANT).

**Límites restantes**: no se ha probado una carrera real entre dos sesiones ni el borrado de una
cuenta que posea objetos de Storage (la base tenía cero objetos al verificarla). El rol ejecutor
sí tiene `DELETE` sobre `auth.users` y la matriz PostgreSQL real pasó con `ROLLBACK`. Si el
propietario está **solo** y quiere borrar su cuenta, queda bloqueado a propósito: primero debe
traspasar el equipo a alguien que se registre y acepte, porque no existe borrado de equipos.
