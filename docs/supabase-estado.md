# CDMPLab — Estado de las migraciones: lo documentado y lo NO verificado

> **Actualización verificada el 21/09/2026.** Esta auditoría es una fotografía histórica
> anterior al acceso remoto. Hoy hay **13 ficheros locales** y el historial remoto incluye
> `20260921075702_entrenolab_folders_atomic`, aplicada desde el SQL versionado localmente
> como `20260911000000_entrenolab_folders_atomic.sql`. Las funciones
> `private.folder_team(uuid)`, `public.delete_folder_tree(uuid)` y
> `public.duplicate_folder_tree(uuid)` existen en el catálogo remoto. Las dos RPC públicas
> son ejecutables por `authenticated`, no por `anon` ni `PUBLIC`; la función privada no es
> ejecutable por esos roles. La migración de rechazo de invitaciones sigue sin constar en
> el historial remoto. El resto de este documento conserva las afirmaciones de su auditoría
> original y no debe leerse como un estado actualizado.

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

**Lo único que este documento puede afirmar:** hay **12 ficheros locales**; el repositorio
declara **1** de ellos sin aplicar (el rechazo de invitaciones); **cuántas están aplicadas de
verdad en el proyecto remoto queda indeterminado** con la información del repositorio.

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
