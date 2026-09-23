# CDMPLab — Estado remoto de Supabase (actualizado 23/09/2026)

> **Estado actual contrastado con el proyecto remoto `vgwfjkhvzprsoixpzruq`:** se aplicaron
> `20260923091218_platform_admin_overview.sql` (registro remoto `version=20260923091218,
name=platform_admin_overview`), `20260923154020_admin_delete_revokes_invitations.sql` y
> `20260923154046_admin_overview_pending_invitations.sql`, ambas registradas en remoto con la misma
> versión y nombre.
> El catálogo confirmó ausencia previa de la RPC y
> existencia de las columnas/tablas requeridas. Después se verificó la función `SECURITY DEFINER`,
> `STABLE`, `search_path` vacío, permiso de ejecución solo para `authenticated` (no para `anon`), y
> una llamada permitida al admin real y rechazada a usuario no admin. `admin_team_overview()` devuelve
> ahora 17 columnas, con invitaciones vigentes y caducadas separadas. La ACL observada es
> `postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres`; `anon` no tiene
> `EXECUTE` (el permiso de `service_role` viene de los privilegios por defecto de PostgreSQL en
> `public`). La matriz completa
> `supabase/tests/entrenolab_rls.sql` también pasó contra PostgreSQL remoto en una transacción con
> `ROLLBACK`; las consultas posteriores confirmaron que no quedaron usuarios, equipos ni
> invitaciones fixture (0/0/0).
>
> Los párrafos de fechas anteriores que siguen debajo son **bitácora histórica** y describen el
> estado conocido en esas rondas; no sustituyen esta verificación actual.

> **Bitácora añadida el 23/09/2026 — migraciones relacionadas con este encargo.**
> El repositorio tiene hoy **25 ficheros** en `supabase/migrations/`; la tabla enumera las siete
> migraciones relacionadas, no su orden cronológico de aplicación:
>
> | Fichero local                                           | Qué hace                                                                                                        |
> | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
> | `20260925000000_team_deletion.sql`                      | borrar un equipo (propietario o administrador), con el **nombre exacto** comprobado en el servidor y auditoría  |
> | `20260926000000_team_deletion_request_history.sql`      | conservar el historial de una solicitud aprobada cuando su equipo se borra (`created_team_id` → NULL)           |
> | `20260927000000_platform_administration.sql`            | administrador de plataforma: entra como editor en cualquier equipo, listar/nombrar administradores, baja propia |
> | `20260928000000_platform_admin_team_members.sql`        | el administrador ve los **miembros de cualquier equipo** (antes esa función era solo del propietario)           |
> | `20260923091218_platform_admin_overview.sql`            | **resumen global del panel**: recuentos de todos los equipos en UNA consulta, sin descargar su contenido        |
> | `20260923154046_admin_overview_pending_invitations.sql` | separa invitaciones **vigentes** de **caducadas** (aplicada en remoto con la misma versión)                     |
> | `20260923154020_admin_delete_revokes_invitations.sql`   | borrar cuenta **cancela sus invitaciones pendientes** (aplicada en remoto con la misma versión)                 |
>
> Las dos últimas ya están **aplicadas y verificadas**; sus versiones asignadas por MCP se indican
> en la tabla. Véase `docs/FASE-10-solicitud-de-equipo.md` §11 para el preflight y el postflight.
>
> **Lo verificado en esta ronda, desde esta máquina:**
>
> - `npm run validate:migration` verde con **171 comprobaciones**: **23** de la migración de
>   administración, **13** de miembros/resumen (autorización dentro de la RPC, `EXECUTE`, `DEFINER`
>   con `search_path` vacío, recuentos acotados por equipo, estados reales del esquema y que la
>   redefinición de `private.list_team_members` **conserva el mismo tipo de retorno** —si no,
>   PostgreSQL la rechaza—) y **16** de los dos arreglos de consistencia (pendientes frente a
>   caducadas; borrado de cuenta que cancela invitaciones).
>   Esas comprobaciones **se probaron rompiendo las migraciones a propósito**: una mutación en el
>   recuento de jugadores activos, otra que añadía una columna al retorno, otra que quitaba el filtro
>   de caducidad, otra que quitaba el `drop function` y otra que dejaba de revocar invitaciones
>   hicieron fallar las comprobaciones correspondientes, y al restaurar los ficheros volvieron a
>   pasar. Una de ellas **destapó que el check era más débil de lo que decía** (bastaba con que
>   `pl.active` apareciera en el fichero, aunque fuera en el recuento de inactivos) y se endureció;
> - la matriz `supabase/tests/entrenolab_rls.sql` **incluye** casos para las siete (alta y baja de
>   administrador, `last_platform_admin`, `cannot_suspend_platform_admin`, correo de confirmación,
>   `target_owns_team`, borrado de equipo con nombre exacto y auditoría, miembros de cualquier equipo
>   para el administrador, resumen global —incluido que NO aparezca un equipo ya borrado y que el
>   recuento de invitaciones use el criterio del límite de plazas— y el borrado de cuenta que revoca
>   su invitación pendiente) y **parsea** sin errores (10 sentencias de nivel superior).
>
> **Estado histórico (antes de la consulta remota del 23/09):** el catálogo del proyecto remoto **no se había podido consultar**
> desde esta máquina —`npx supabase projects list` responde _«Access token not provided»_ y no hay
> `SUPABASE_ACCESS_TOKEN`, ni `~/.supabase/access-token`, ni `config.toml`, ni `.env`—, así que
> este documento **no afirma** qué migraciones están aplicadas en remoto, ni que su contenido
> coincida con el local. La sesión que aplicó las cuatro primeras dejó constancia
> de haberlo hecho; eso es **información de segunda mano** y aquí queda marcado como tal: para
> cerrarlo hace falta ejecutar
> `select version, name from supabase_migrations.schema_migrations order by version;` con un token
> temporal (y revocarlo después). La **matriz SQL tampoco se ha ejecutado** en esta ronda: solo se
> se había comprobado que parseaba. El resumen global llevaba entonces el nombre local provisional
> `20260929000000` y aún no se había aplicado;
> el estado presente figura en la nota actual al principio del documento. El despliegue por MCP
> registró la migración como `20260923091218`, por lo que el nombre local del fichero se ha alineado
> exactamente con esa versión para que una futura `supabase db push` no la reaplique.

> **Añadido el 22/09/2026 — borrado de EQUIPO: NUEVA, sin aplicar y sin verificar.**
> `supabase/migrations/20260925000000_team_deletion.sql` (borrar un equipo con confirmación por
> nombre comprobada **en el servidor** y auditoría en `public.team_deletions`) está **escrita,
> validada en estático y NO aplicada**. Antes de aplicarla hay que comprobar la cascada que asume
> (`select conrelid::regclass, confdeltype from pg_constraint where confrelid = 'public.teams'::regclass`,
> esperando `c` en las tablas del equipo) y que la tabla y las dos funciones no existan ya.
> Cumple además lo que exige la regla del proyecto: **no se crea nada sin verificar antes el
> catálogo remoto**, y esa verificación está pendiente.
>
> **Actualización verificada el 22/09/2026 — gestión de cuentas y pertenencia APLICADA.**
> `supabase/migrations/20260924000000_account_and_membership_management.sql` (borrar cuenta con
> auditoría, salir de un equipo y traspasar la propiedad) se aplicó en remoto como
> `20260922101345_account_and_membership_management`. La matriz SQL real pasó dentro de una
> transacción con `ROLLBACK`: borrado de una cuenta ficticia, permisos, salida y traspaso; no
> quedaron usuarios ni registros de auditoría de prueba. Antes de aplicar se verificó que el rol
> `postgres` tiene `DELETE` sobre `auth.users`, que las RPC y tabla eran nuevas y que
> `profiles.user_id` usa `ON DELETE CASCADE`. La concurrencia de dos sesiones no se ejecutó.
> Dos notas de mantenimiento:
>
> - la marca de versión es `20260924000000` porque `20260923000000` ya la ocupa
>   `clear_stale_invitation_email_result`; **dos ficheros con el mismo prefijo son la misma
>   migración para el CLI**;
> - el borrado de cuenta usa `delete from auth.users` dentro de una función `SECURITY DEFINER`;
>   Supabase advierte que un usuario con objetos de Storage no se puede borrar. Este proyecto tenía
>   cero objetos al verificarlo, pero el caso debe tratarse si se incorpora Storage en el futuro.
>
> Detalles y guardas en `docs/FASE-10-solicitud-de-equipo.md` §8.

> **Actualización 21/09/2026, posterior al texto histórico siguiente.** Se contrastó el
> catálogo del proyecto EntrenoLab y se aplicaron las migraciones remotas
> `20260921193229_team_creation_requests` y
> `20260921193506_clear_stale_invitation_email_result` (ficheros locales
> `20260922000000_team_creation_requests.sql` y
> `20260923000000_clear_stale_invitation_email_result.sql`). La matriz de permisos
> `supabase/tests/entrenolab_rls.sql` pasó con `ROLLBACK`; confirmó que un usuario
> autenticado no puede crear equipos directamente ni falsificar el resultado del correo.
> Los párrafos anteriores a esta actualización se conservan como auditoría histórica, no
> como descripción vigente del estado remoto. El envío real de correo sigue pendiente de
> proveedor y dominio.

> **Nota histórica de la ronda previa — sustituida por las actualizaciones anteriores.**
> El cierre del encargo «solicitud de equipo aprobada por el administrador + correo de invitación»
> añade `supabase/migrations/20260922000000_team_creation_requests.sql`. Su estado es:
>
> - **NO aplicada** en el proyecto remoto (no se ha ejecutado ninguna migración en esta ronda);
> - **NO verificada contra el catálogo remoto** (`pg_class` / `pg_proc` / `pg_policies` /
>   `pg_indexes`): no ha habido acceso al proyecto, así que sus `create table if not exists`,
>   `drop policy if exists` y `revoke` se escriben contra lo que dice el repositorio;
> - **validada en estático** (`npm run validate:migration`, que además comprueba 28 propiedades de
>   seguridad de este fichero) y cubierta por la matriz manual
>   `supabase/tests/entrenolab_rls.sql` (ampliada con la solicitud, la aprobación, los dos intentos
>   de bypass y los estados del correo).
>
> La cabecera de la propia migración enumera lo que hay que comprobar antes de aplicarla. El diseño
> y las puertas están en `docs/FASE-10-solicitud-de-equipo.md`.
>
> **Actualización verificada el 21/09/2026.** Esta auditoría es una fotografía histórica
> anterior al acceso remoto. Hoy hay **14 ficheros locales** y el historial remoto incluye
> `20260921075702_entrenolab_folders_atomic`, aplicada desde el SQL versionado localmente
> como `20260911000000_entrenolab_folders_atomic.sql`. Las funciones
> `private.folder_team(uuid)`, `public.delete_folder_tree(uuid)` y
> `public.duplicate_folder_tree(uuid)` existen en el catálogo remoto. Las dos RPC públicas
> son ejecutables por `authenticated`, no por `anon` ni `PUBLIC`; la función privada no es
> ejecutable por esos roles. También constan `20260921090333_decline_team_invitation`
> (local `20260910000000_decline_team_invitation.sql`) y
> `20260921090340_increase_team_capacity_to_seven` (local
> `20260921085803_increase_team_capacity_to_seven.sql`). Sus funciones y permisos se
> verificaron contra `pg_proc`; el límite remoto es un propietario + seis colaboradores.
> El resto de este documento conserva las afirmaciones de su auditoría original y no
> debe leerse como un estado actualizado.

> **Alcance de este documento.** Es una auditoría **de documentación y de repositorio**.
> Se ha escrito **sin claves y sin acceso al proyecto remoto**: aquí no se aplica nada, no
> se consulta el catálogo, no se ejecuta SQL y **no se reproduce ningún volcado de
> `supabase_migrations`**.
>
> **Declaración explícita: el estado de las migraciones en la base remota NO está
> verificado contra la base en esta auditoría.** Lo único comprobable en local es la lista
> de ficheros y lo que dicen los documentos del repositorio. Los recuentos y el mapeo de
> identidad de las secciones 2 y 3 son **afirmaciones documentales**, no hechos
> comprobados.

## 1. Ficheros locales (esto sí es comprobable en local)

`supabase/migrations/` contiene **12 ficheros `.sql`**. Se aplicarían en este orden (el CLI
ordena por nombre de fichero, y el prefijo `YYYYMMDDHHMMSS` **es** la identidad de la
migración):

| #   | Fichero                                         |
| --- | ----------------------------------------------- |
| 1   | `20260827000000_entrenolab_schema.sql`          |
| 2   | `20260827000001_entrenolab_hardening.sql`       |
| 3   | `20260827000002_fix_invitation_acceptance.sql`  |
| 4   | `20260827000003_rpc_security_invoker.sql`       |
| 5   | `20260827000004_fix_team_rpc_returning.sql`     |
| 6   | `20260827000005_entrenolab_rpc.sql`             |
| 7   | `20260828081350_enable_private_admin_rls.sql`   |
| 8   | `20260829000000_entrenolab_session_atomic.sql`  |
| 9   | `20260829000001_fix_session_task_iteration.sql` |
| 10  | `20260829000002_entrenolab_import_atomic.sql`   |
| 11  | `20260901000000_harden_grants.sql`              |
| 12  | `20260910000000_decline_team_invitation.sql`    |

Dos datos locales más, verificables sin acceso remoto:

- `scripts/validate-migration.mjs` identifica el fichero de endurecimiento de permisos con
  la constante `PERMS_FILE = '20260901000000_harden_grants.sql'` (fichero nº 11).
- El fichero nº 12 (`20260910000000_decline_team_invitation.sql`) es el **último por orden
  de nombre**, y este repositorio lo declara **NO aplicado** (ver sección 2).

## 2. Lo que dice cada documento (literal)

Los bloques de `README.md` se citan **tal como están en `HEAD`**: son el texto anterior a la
corrección de esta auditoría. El README actual ya no contiene las dos frases que se señalan
en la sección 3 (el recuento «once» y el nombre remoto del endurecimiento) y remite a este
documento. Las líneas citadas de `README.md` son, por tanto, líneas de `HEAD`.

### `README.md` — «Estado real de Supabase» (HEAD, líneas 160-164)

> La **build de producción** apunta al proyecto Supabase real (autenticación obligatoria,
> RLS por equipo). Las once migraciones están versionadas; la última figura remotamente
> como `20260902102208_harden_grants_and_defaults`. Tras aplicarla se verificó que `anon`
> no conserva permisos de tabla, que `authenticated` solo mantiene el conjunto explícito
> y que no existen grants prohibidos de función o acceso a `private.platform_admins`.

### `README.md` — «Validación de migraciones» (HEAD, líneas 95-99)

> Este validador hace **análisis estático** (parseo de sintaxis con `libpg-query` y
> comprobaciones de endurecimiento sobre el SQL diseñado). No sustituye una ejecución
> real. La migración `harden_grants_and_defaults` fue aplicada al proyecto remoto el
> 2026-09-02 y verificada después mediante `role_table_grants`, `routine_privileges`,
> `pg_default_acl`, historial remoto y asesores de Supabase.

### `README.md` — migración pendiente (HEAD, líneas 173-186)

> `supabase/migrations/20260910000000_decline_team_invitation.sql` (rechazar una invitación
> de equipo) está **escrita y validada en estático, pero NO aplicada**.

> **La migración aún no está aplicada.** Aplicarla en el proyecto remoto es una decisión del
> propietario; `npm run validate:migration` solo hace análisis estático y no la ejecuta.

### `docs/06-supabase-autoritativo.md` (líneas 3-5 y 121)

> La nota de alcance que añade esta auditoría a `docs/06-…` ocupa las líneas 6-11; las citas
> de abajo son texto ya existente, sin tocar.

> Proyecto: `vgwfjkhvzprsoixpzruq`. ChatGPT aplicó y verificó estas 5 migraciones
> contra el remoto. **No modificar migraciones aplicadas (hasta 20260827000004).**
> Cualquier cambio nuevo va en una migración incremental posterior (>= 00005).

> - 5 migraciones aplicadas; 220 sentencias SQL válidas.

### `docs/05-supabase-fase6.md` (líneas 3-6, 17-18 y 122)

> Verificación externa ejecutada el 27/08/2026 contra el proyecto
> `vgwfjkhvzprsoixpzruq`. El esquema y cuatro correcciones incrementales están
> aplicados.

> Los cinco ficheros correspondientes viven en `supabase/migrations/` y
> `npm run validate:migration` valida todos ellos, no solo el primero.

> - [x] Cinco migraciones aplicadas y registradas en el remoto.

### `docs/auth-bootstrap.md` (líneas 3-4)

> **Estado:** el esquema y la migración remota de endurecimiento están aplicados y
> verificados.

## 3. La contradicción, señalada explícitamente

| Fuente                         | Afirmación                                            | Cifra / identidad   | ¿Casa con el listado local (12 ficheros)?                                            |
| ------------------------------ | ----------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `README.md` (HEAD 161)         | «Las once migraciones están versionadas»              | 11                  | **No** como recuento de ficheros versionados: hay **12** en `supabase/migrations/`   |
| `README.md` (HEAD 161-162)     | «la última figura remotamente como `20260902102208…`» | identidad remota    | **No**: no coincide con **ningún** nombre de fichero local                           |
| `README.md` (173-186)          | el rechazo de invitaciones NO está aplicado           | 1 de 12 sin aplicar | Compatible con el listado local, pero no está verificado contra la base              |
| `docs/06-…` (3 y 121)          | «estas 5 migraciones» / «5 migraciones aplicadas»     | 5                   | **No** como total (hay 12 ficheros); sí como el lote `20260827000000…20260827000004` |
| `docs/05-…` (17 y 122)         | «Los cinco ficheros» / «Cinco migraciones aplicadas»  | 5                   | **No** como total; coherente como lote de la fase 6 (27/08/2026)                     |
| `docs/auth-bootstrap.md` (3-4) | esquema + migración de endurecimiento «aplicados»     | sin cifra           | No aporta recuento; no es contrastable                                               |

Detalles que conviene no perder de vista:

1. **El «11» del README es ambiguo y no se puede resolver desde el repo.** Decía «están
   versionadas», y de ficheros versionados hay 12. Leído como «aplicadas», 11 encajaría
   aritméticamente con 12 ficheros menos el nº 12, que el propio README declara no aplicado;
   pero el README no lo dice así y **ninguna de las dos lecturas es verificable aquí**.
2. **El «5» de `docs/05` y `docs/06` está fechado y acotado a un lote**, no al total: ambos
   describen la aplicación del 27/08/2026 de las cinco primeras migraciones
   (`20260827000000_entrenolab_schema.sql` … `20260827000004_fix_team_rpc_returning.sql`).
   El propio `docs/06` lo delimita con «No modificar migraciones aplicadas (hasta
   20260827000004)». Aun así, `docs/06` lo escribe como «5 migraciones aplicadas» sin
   acotar, y esa frase se lee como total.
3. **Ninguno de los documentos menciona los 12 ficheros locales.** Entre los dos recuentos
   documentados (5 y 11) y los 12 ficheros no hay ninguna conciliación escrita en el repo.
4. **El mapeo de identidad está roto en la documentación.** El README citaba como nombre
   remoto `20260902102208_harden_grants_and_defaults`, mientras el fichero local del mismo
   endurecimiento se llama `20260901000000_harden_grants.sql` (el nº 11, el que usa
   `scripts/validate-migration.mjs`). Las dos cadenas de versión difieren
   (`20260901000000` frente a `20260902102208`), y el **repositorio no contiene ninguna
   explicación de esa diferencia**. Que se trate de la **misma** migración registrada con
   otra versión, o de **dos** cosas distintas, es una hipótesis: **no está verificado**.
5. **El «último por nombre» no es el de grants.** Por orden de fichero, el último es el nº
   12 (`20260910000000_decline_team_invitation.sql`), que el README declara **no aplicado**.
   La frase «la última figura remotamente como…» del README solo es sostenible si «última»
   significa «última de las aplicadas», extremo que no está verificado.

**Lo único que este documento puede afirmar:** hay **13 ficheros locales** (12 en la auditoría
original + `20260922000000_team_creation_requests.sql`, añadido el 22/09/2026 y declarado NO
aplicado); el repositorio declara **2** de ellos sin aplicar (el rechazo de invitaciones y el de
solicitud de equipo); **cuántas están aplicadas de verdad en el proyecto remoto queda
indeterminado** con la información del repositorio.

## 4. Por qué NO se renombran migraciones ya aplicadas

Ningún fichero de `supabase/migrations/` se ha renombrado en esta auditoría, y no debe
hacerse para «arreglar» la discrepancia de la sección 3:

- **El nombre es la identidad.** El prefijo `YYYYMMDDHHMMSS` versiona la migración; el
  registro remoto de migraciones aplicadas se lleva por esa versión. Renombrar un fichero
  ya aplicado hace que el historial local y el remoto dejen de casar: la versión antigua
  queda como registro huérfano y la nueva aparece como migración **no aplicada**, con el
  riesgo de reaplicar SQL (incluidos `ALTER`/`GRANT` sobre objetos que ya existen).
- **El repositorio ya lo prohíbe.** `docs/06-supabase-autoritativo.md` fija «**No modificar
  migraciones aplicadas** (hasta 20260827000004)» y «cualquier cambio nuevo va en una
  migración incremental posterior». Renombrar es una forma de modificar.
- **El SQL ya se aplicó con ese contenido.** Corregir el nombre no cambia lo que hay en la
  base: solo falsea el historial. Si hiciera falta una corrección real, va en una migración
  **nueva** (`supabase/migrations/`), nunca reescribiendo una antigua.

Si el desajuste de identidad (`20260901000000_harden_grants.sql` ↔
`20260902102208_harden_grants_and_defaults`) hay que cerrarlo, es una decisión del
propietario con acceso al remoto, no una edición local de nombres.

## 5. Qué haría falta para cerrarlo (NO ejecutado aquí)

Requiere credenciales y acceso al proyecto remoto, de los que esta auditoría **no dispone**.
No se ha ejecutado nada de esto y no se reproduce ningún resultado:

```sql
-- historial de migraciones registradas en el remoto (pendiente de ejecutar)
select version, name from supabase_migrations.schema_migrations order by version;
```

```bash
# alternativa por CLI del CLI de Supabase (pendiente de ejecutar)
supabase migration list --linked
```

Con esa lista se podría: (a) contar las aplicadas, (b) casar el nombre local con la versión
registrada y (c) comprobar si el desajuste del punto 4 de la sección 3 es real.

## 6. Qué NO afirma este documento

- No afirma cuántas migraciones están aplicadas en remoto.
- No afirma que el contenido local coincida con lo aplicado en remoto.
- No afirma que los `GRANT`/RLS descritos en `docs/06-…` sigan en vigor hoy.
- No reproduce ningún volcado de `supabase_migrations` ni del catálogo.
- No aplica, no renombra y no modifica ninguna migración.
- No sustituye a una consulta con credenciales: cuando no hay claves para consultar el
  remoto, lo correcto es declarar **«no verificado contra la base»**, que es lo que hace
  este documento.

## 7. Ficheros relacionados

- `supabase/migrations/*.sql` — **fuente única** del esquema (aplicada en orden por nombre).
- `supabase/schema.sql` — esquema inicial histórico: **DEPRECADO**, con una guarda `do $$ …
raise exception` que **aborta** su ejecución porque añadiría políticas RLS permisivas que
  se suman por OR a las vigentes.
- `scripts/validate-migration.mjs` — análisis **estático** (sintaxis + propiedades de
  seguridad escritas en el SQL). No comprueba el estado remoto.
- `docs/05-supabase-fase6.md`, `docs/06-supabase-autoritativo.md`, `docs/auth-bootstrap.md`,
  `README.md` — documentos con las afirmaciones citadas en la sección 2. En `README.md` y
  `docs/06-supabase-autoritativo.md` esas afirmaciones llevan ya la nota de alcance o la
  corrección de esta auditoría.
