# CDMPLab

Pizarra táctica + biblioteca de ejercicios para entrenadores. Una app web (Angular standalone)
con la que un técnico crea y organiza **ejercicios** sobre un **campo táctico a pantalla
completa** (jugadores, materiales, formas, texto) y los guarda en una **biblioteca** por
carpetas, con **duplicación**, **exportación** y acceso **multiusuario seguro** (propietario

- hasta 6 colaboradores).

Proyecto **independiente** (repositorio `CDMPLab`). No incluye ni depende de la app Flutter
`ClubManager` (que vive en `../app` y es otro proyecto).

> **Nota de marca:** la aplicación usó internamente el nombre "EntrenoLab". La marca
> visible/documental es ahora **CDMPLab**. El prefijo `entrenolab:` de `localStorage`,
> las clases CSS `.entrenolab-*` y el atributo `data-entrenolab-mode` se **conservan**
> por compatibilidad con datos y tests existentes; no son texto visible.

## Stack

- **Angular 22** + **TypeScript** (standalone components, `signals`) + **SCSS**.
- **Supabase** (Postgres) como backend de datos, con **RLS** por equipo.
- Datos locales en `localStorage` hasta que hay sesión; al autenticarse se usan datos remotos.
- **Playwright** para E2E · **Vitest/Angular** para tests unitarios.

## Requisitos

- **Node 22.22.3** (o superior en la rama 22). Angular CLI exige `>= 22.22.3`; no usar 20.x.
- Un proyecto **Supabase** (o modo totalmente local sin backend, que es el arranque por defecto).

## Arranque (local)

```bash
npm install
npm run start        # servidor de desarrollo → http://localhost:4200
```

Por defecto (`src/environments/environment.development.ts`) Supabase queda **vacío** y la
app corre en **modo local** (localStorage) sin exigir sesión. Esto es solo para desarrollo
y E2E controlados; **no** es el comportamiento de producción.

## Arranque (producción / real)

La configuración de producción usa `src/environments/environment.prod.ts` (proyecto
Supabase real, autenticación obligatoria). **No** deja pasar los guards sin sesión.

```bash
npm run build        # build de producción (carpeta dist/entrenolab/browser)
```

## Pruebas

### 1. Unitarias

```bash
npm run test:unit    # Vitest/Angular (--watch=false)
```

### 2. E2E local (server de dev con Supabase vacío / modo local)

```bash
npm run test:e2e     # Playwright (server de desarrollo en 4200, --workers=1)
```

### 3. E2E de producción (build real, sin credenciales)

```bash
npm run test:e2e:prod
```

Sirve la build de producción (`dist/entrenolab/browser`) con fallback SPA y comprueba
auth pública, guard de rutas privadas sin sesión (redirige a `/auth/login`) y ausencia de
errores. **No** crea cuentas ni inicia sesión.

### 4. E2E opt-in contra Supabase REAL (NO en CI)

```bash
npm run test:e2e:supabase-real
```

Suite **opt-in** que habla con Supabase real (cuentas de prueba separadas: admin,
propietario, colaborador y 4 cuentas para el límite). Requiere variables de entorno:
`SUPABASE_E2E_ADMIN_EMAIL/PASSWORD`, `SUPABASE_E2E_OWNER_EMAIL/PASSWORD`,
`SUPABASE_E2E_COLLAB_EMAIL/PASSWORD`, `SUPABASE_E2E_LIMIT_EMAILS` (6 correos) y
`SUPABASE_E2E_LIMIT_PASSWORD`; más las opcionales de estado de acceso. Si faltan,
**se omite** con mensaje explícito (nunca finge un pase). Ver `docs/supabase-real-e2e.md`.

> **NO está en CI** y no forma parte de las puertas locales: necesita secretos y
> varias cuentas preparadas a mano.

### 5. Validación de migraciones

```bash
npm run validate:migration      # análisis ESTÁTICO (sintaxis + endurecimiento de grants)
npm run validate:invite-email   # correo de invitación: módulo puro + Edge Function
```

El primero hace **análisis estático** (parseo de sintaxis con `libpg-query` y
comprobaciones de endurecimiento sobre el SQL diseñado) y, desde el 22/09/2026, también las
propiedades de seguridad de la migración de **solicitud de equipo** (permiso de administrador
comprobado en servidor, bloqueo de fila, idempotencia, estados del correo y permisos mínimos),
incluido el **estado FINAL** de `public.teams`: la última palabra sobre su DML debe ser un
`REVOKE`. Nada de esto sustituye una ejecución real: solo comprueba propiedades **estáticas** del
SQL versionado y **no verifica el estado remoto**. Lo que el repositorio documenta (no lo
comprueba esta puerta) es que la migración `harden_grants_and_defaults` fue aplicada al proyecto
remoto el 2026-09-02 y verificada después mediante `role_table_grants`, `routine_privileges`,
`pg_default_acl`, historial remoto y asesores de Supabase. Estado, recuento y mapeo de identidad de
las migraciones: [`docs/supabase-estado.md`](docs/supabase-estado.md).

El segundo **importa de verdad** el módulo puro del correo
(`supabase/functions/_shared/invite-email.ts`, TypeScript con sintaxis borrable) y comprueba el
comportamiento del enlace, el escapado, la petición a Resend/Postmark y la redacción de errores,
más propiedades estáticas de la Edge Function. El envío real no se prueba: falta proveedor,
credenciales y dominio ([`docs/correo-invitaciones.md`](docs/correo-invitaciones.md)).

### 6. Build de GitHub Pages (base href `/CDMPLab/`)

```bash
npm run build:pages          # genera environment.pages.ts + ng build --configuration pages
npm run test:e2e:pages       # E2E local de esa build bajo /CDMPLab/
```

La config `pages` usa `baseHref: /CDMPLab/` y un entorno inyectado por variables
(`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`).

### 7. Formato y lint

```bash
npm run format:check   # Prettier (trinquete de deuda previa)
npm run lint           # ESLint 10 + angular-eslint 22 (trinquete de deuda previa)
```

Los dos son **trinquetes**: comparan el fichero con su versión en `HEAD` y exigen
impecable todo lo que ya lo estaba (en particular, cualquier fichero **nuevo**). Solo
toleran —informando de cuánto queda— la deuda que ya existía antes de añadir la puerta;
nunca crece. No hay reglas rebajadas ni `eslint-disable` masivos: si una regla salta en
código nuevo, se arregla el código.

- `scripts/format-check.mjs`: Prettier nunca se había aplicado al repositorio entero, así
  que la mayoría de los ficheros ya existentes no cumplen. Reformatearlos en bloque sería
  un cambio masivo ajeno al trabajo en curso.
- `scripts/lint-check.mjs`: ESLint no existía en el proyecto. Compara regla por regla
  contra `HEAD`, así que la deuda no puede crecer **ni siquiera en un fichero que ya venía
  sucio**. `node scripts/lint-check.mjs --list-debt` la lista entera.
- Ambas puertas se ejecutan en `.github/workflows/ci.yml` antes de los tests.

## GitHub Pages

`.github/workflows/pages.yml` despliega en GitHub Pages bajo `/CDMPLab/` usando las
acciones **oficiales** (`upload-pages-artifact` / `deploy-pages`). Solo se dispara
desde `main` (push) o con `workflow_dispatch`; permisos mínimos y concurrencia.

Ver `.github/workflows/pages.yml` y `scripts/build-pages.mjs`. La activación del
repositorio ya está completada y la aplicación pública está disponible en
`https://erdeivih.github.io/CDMPLab/`. El despliegue y la CI se validan en cada
`push` a `main`.

## Configuración de Supabase (nunca secretos)

Copia `.env.example` a `.env` y rellena únicamente datos no secretos:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` → es la **Publishable / anon key**; puede viajar en el frontend.

**Nunca** pongas en el frontend, en el repo, en logs ni en artefactos la **Secret Key** ni el
**Service Role**. Esas llaves solo pueden usarse en el servidor (Edge Functions) y no deben
versionarse. `.env`, `.env.local` y `*.env.*.local` están en `.gitignore`.

> ⚠️ La Service Role / secret key se compartió fuera del gestor de secretos durante el
> desarrollo. Debe **rotarse** antes de cualquier despliegue público. Ver
> `docs/auth-bootstrap.md`.

## Estado real de Supabase

La **build de producción** apunta al proyecto Supabase real (autenticación obligatoria,
RLS por equipo). Hay **15 ficheros** versionados en `supabase/migrations/`: los 14 que el
historial remoto incluía el 21/09/2026 más `20260922000000_team_creation_requests.sql`
(solicitud de equipo y estado del correo de invitación), que está **escrito y validado en
estático pero NO aplicado ni verificado contra el catálogo remoto**. El mapeo y las
limitaciones de la verificación están en [`docs/supabase-estado.md`](docs/supabase-estado.md).

Lo que este repositorio **documenta** (afirmación de sus propios documentos, no comprobada
en esta auditoría): que el endurecimiento de grants se aplicó al proyecto remoto el
2026-09-02 y se verificó con `role_table_grants`, `routine_privileges`, `pg_default_acl`,
historial remoto y asesores de Supabase; de ahí que `anon` no conserve permisos de tabla,
que `authenticated` solo mantenga el conjunto explícito y que no existan grants prohibidos
de función o acceso a `private.platform_admins`.

Los privilegios por defecto de objetos creados por nuestras migraciones (`postgres`)
también quedaron endurecidos. Supabase no permite que `postgres` modifique los defaults
del rol interno `supabase_admin`; esa limitación de la plataforma está documentada en la
migración. El SMTP propio (confirmación de registro y recuperación de contraseña) y la
prueba multiusuario real siguen pendientes.

### Solicitud de equipo (creación aprobada por el administrador)

`supabase/migrations/20260922000000_team_creation_requests.sql` y la corrección incremental
`20260923000000_clear_stale_invitation_email_result.sql` están **aplicadas en Supabase** y la
matriz RLS pasó contra la base real con `ROLLBACK`. Cambian un contrato de seguridad: una cuenta aprobada ya **no crea**
su equipo (`create_my_team` responde `team_creation_requires_approval`, se retira la política
`teams_insert_owner` y se revoca el `INSERT` sobre `public.teams`); en su lugar **solicita** el
equipo y lo aprueba un administrador de plataforma, que provoca la creación real en la misma
transacción. Diseño, puertas y pasos manuales: [`docs/FASE-10-solicitud-de-equipo.md`](docs/FASE-10-solicitud-de-equipo.md).

### Correo de invitación

Las invitaciones se crean igual en `public.team_invitations` y ahora además se puede **pedir el
envío real** desde una Edge Function (`supabase/functions/invite-team-member`), con estados
distinguibles y reintento. La clave del proveedor es un **secreto del servidor**, y el registro del
resultado solo lo puede escribir esa función (con la credencial de servicio: el navegador no puede
falsificar un «aceptado por el proveedor»). El envío real sigue **pendiente** (proveedor,
credenciales y dominio): ver [`docs/correo-invitaciones.md`](docs/correo-invitaciones.md) y, para el
correo de Auth, [`docs/smtp-auth`](docs/smtp-supabase-auth.md).

### Gestión de cuentas y pertenencia

`supabase/migrations/20260924000000_account_and_membership_management.sql` está **aplicada y
verificada en la base remota** (matriz SQL con `ROLLBACK`). Añade tres operaciones que
antes no existían, todas decididas en el servidor y con confirmación en la interfaz cuando son
destructivas o de permisos:

- **eliminar una cuenta** (solo el administrador de plataforma; no a sí mismo, no a otro
  administrador, no a quien posee un equipo; con vista previa, escribiendo el correo para confirmar
  y con registro en `public.account_deletions`);
- **salir de un equipo** (el propio miembro activo; el propietario no puede, debe traspasarlo);
- **traspasar la propiedad** (solo el propietario, solo a un colaborador activo, aprobado y sin
  equipo propio; los dos roles cambian en la misma transacción);
- **eliminar un equipo** (`supabase/migrations/20260925000000_team_deletion.sql`): el propietario
  (o el administrador) escribe el **nombre exacto** del equipo —lo comprueba el servidor— y se
  borra todo lo suyo, con registro en `public.team_deletions`
  (`20260926000000_team_deletion_request_history.sql` conserva el historial de la solicitud
  aprobada cuando su equipo ya no existe). Así el propietario que está solo ya puede irse:
  elimina su equipo y después el administrador da de baja su cuenta.

Detalles, guardas y limitaciones declaradas: [`docs/FASE-10-solicitud-de-equipo.md`](docs/FASE-10-solicitud-de-equipo.md) §8.

### Administración de plataforma

`supabase/migrations/20260927000000_platform_administration.sql` da al administrador lo que le
faltaba para trabajar sin SQL a mano, todo decidido en el servidor contra `private.platform_admins`
(nunca por correo ni por metadatos del token):

- **entra como editor en cualquier equipo** sin ocupar plaza de colaborador, y sin poder desbancar
  al propietario (la propiedad se comprueba antes que el permiso de administrador);
- **nombra administradores** (`admin_grant_platform_admin`, solo perfiles aprobados e idempotente) y
  **ve quién administra** (`admin_list_administrators`);
- **se da de baja** (`delete_my_admin_account`) escribiendo su correo exacto, y solo si **queda otro
  administrador** (`last_platform_admin`) y **no posee ningún equipo** (`target_owns_team`); la baja
  se audita en `public.account_deletions` antes de borrar la identidad y se serializa con
  `lock table`, así que dos bajas simultáneas no pueden dejar la plataforma sin nadie;
- **suspender o rechazar a un administrador está prohibido** (disparador
  `cannot_suspend_platform_admin`): no se expulsa a un administrador por la puerta de atrás;
- **ve los miembros de cualquier equipo** (`20260928000000_platform_admin_team_members.sql`): la
  función que lista miembros era solo del propietario, así que el panel global no podía mostrarlos;
- **tiene un resumen global** (`20260923091218_platform_admin_overview.sql`): una sola consulta
  agregada (`admin_team_overview`) devuelve, por equipo, el propietario, las fechas y los recuentos
  de miembros activos/revocados/pendientes, invitaciones pendientes, jugadores activos e inactivos,
  carpetas, ejercicios y sesiones — **sin descargar el contenido de ningún equipo**. Antes el panel
  bajaba el dataset completo de cada equipo solo para contar filas, y la tarjeta decía
  «Propietarios» mientras contaba miembros.

El panel `/admin` no ofrece ninguna de estas acciones hasta que el **servidor** confirma que quien
mira es administrador, y el enlace del menú tampoco se muestra sin esa confirmación (antes lo veía
cualquier propietario de equipo y el guard lo devolvía a `/team`). Estado en remoto: **no verificado
desde esta máquina** (sin token del CLI) — ver [`docs/supabase-estado.md`](docs/supabase-estado.md).

### Invitaciones: cómo se recorre el flujo completo

1. El **propietario** invita por correo desde **Miembros** (la invitación se crea en la base) y
   pulsa **Enviar por correo** (Edge Function `invite-team-member`).
2. La persona **se registra con ese mismo correo**; su cuenta queda **pendiente de aprobación**.
3. Un **administrador de plataforma** la aprueba en **Cuenta → Administración → Cuentas**.
4. La persona abre el enlace del correo —o entra en **Cuenta → Invitación pendiente**— y **acepta**.
   El enlace **no concede acceso por sí solo**: el servidor comprueba identidad, correo confirmado y
   que el perfil esté aprobado.
5. A partir de ahí aparece como miembro del equipo.

La entrada **Invitación pendiente** y el `?returnUrl=` del login existen porque faltaban (auditoría
de flujos del 23/09/2026): `/invitations` no estaba en **ninguna** navegación —así que quien ya
pertenecía a un equipo no podía ver ni aceptar la suya— y el enlace del correo perdía el destino al
pasar por el login. Detalle en [`docs/FASE-10-solicitud-de-equipo.md`](docs/FASE-10-solicitud-de-equipo.md) §10.

### Rechazo de invitaciones

`supabase/migrations/20260910000000_decline_team_invitation.sql` (rechazar una invitación
de equipo) se aplicó el 21/09/2026 y figura remotamente como
`20260921090333_decline_team_invitation`. El catálogo confirma la función privada y la
envoltura pública: `authenticated` puede ejecutarlas; `anon` y `PUBLIC`, no. Las pruebas
de abuso con sesiones reales siguen pendientes.

### Operaciones atómicas de carpetas

La migración `20260911000000_entrenolab_folders_atomic.sql` se aplicó al proyecto remoto
EntrenoLab el 21/09/2026; Supabase la registró como
`20260921075702_entrenolab_folders_atomic`. Se verificaron la existencia de sus tres
funciones y los permisos de ejecución: las dos RPC públicas admiten `authenticated`, pero
no `anon` ni `PUBLIC`. El cliente ya usa las dos RPC en vez de encadenar escrituras.

### Capacidad del equipo

`20260921085803_increase_team_capacity_to_seven.sql` se aplicó remotamente como
`20260921090340_increase_team_capacity_to_seven`. Cada equipo admite un propietario
y **seis colaboradores**; los activos y las invitaciones pendientes no caducadas consumen
plaza. La función privada mantiene bloqueo de fila y no es ejecutable directamente por
`anon`, `authenticated` ni `PUBLIC`.

## Plantillas de campo

El pizarra ofrece, con la misma fuente de proporciones reales:

1. **Campo completo** — 105×68 m.
2. **Medio campo** — 52,5×68 m (no se estira para aparentar un completo).
3. **F7 transversal** — composición personalizada sobre el medio campo F11 (bandas del F7 que
   coinciden con los laterales del F11; líneas F11 blancas, líneas F7 azules).
4. **Lienzo sin líneas**.

Orientación por resultado visual: "Porterías izquierda y derecha / arriba y abajo"
(campo completo y F7), "Portería arriba / izquierda" (medio campo), "Apaisado / Vertical"
(lienzo). Grosor común de todas las marcas: `FIELD_LINE_WIDTH`.

Los tipos legacy (`third`, `box`, `futsal`, `vertical_half`) **no** se exponen en la interfaz;
solo se conservan en el modelo para no romper respaldos/documentos antiguos.

## Respaldos

El sistema de respaldo (Ajustes → Exportar/Importar) valida y exporta/importa el conjunto
completo (equipos, jugadores, carpetas, ejercicios con su `canvas`, sesiones) de forma
**transaccional** (todo-o-nada). El importador rechaza valores realmente desconocidos
(incluidos campos de terreno inexistentes).

## Flujo multiusuario

- **Un propietario** por equipo.
- El propietario puede crear **hasta 6 colaboradores** (activos + invitaciones pendientes):
  siete cuentas por equipo contando al propietario.
- **Un equipo lo crea el servidor cuando un administrador aprueba la SOLICITUD** de una cuenta
  aprobada: la cuenta no puede crearlo por su cuenta (el intento por RPC o por `INSERT` directo
  se rechaza en el servidor). El solicitante ve el estado (pendiente / rechazado) y puede volver
  a solicitarlo.
- **El propietario puede traspasar el equipo** a un colaborador activo; **un colaborador puede
  salir** por su cuenta; y el **administrador puede eliminar una cuenta** con guardas y
  confirmación reforzada (ver «Gestión de cuentas y pertenencia»).
- Las invitaciones se **crean** en base de datos y se puede **pedir el envío real** del correo
  desde una función de servidor; la persona invitada debe **registrarse** con ese correo, ser
  **aprobada** por el administrador y después **aceptar** la invitación (el enlace no concede
  acceso por sí solo).
- Un colaborador puede ver/editar jugadores y ejercicios del equipo, pero **no** gestionar
  miembros ni invitar.
- El admin de plataforma (tabla privada `private.platform_admins`, accedida solo vía
  funciones `SECURITY DEFINER`) aprueba los perfiles **y** las solicitudes de equipo: son dos
  decisiones distintas.

## Estructura

```
src/
  app/
    core/            modelos + store + campo/geometría + render SVG + migrador canvas + supabase
    features/
      roster/        plantilla: equipos y jugadores
      board/         pizarra táctica a pantalla completa (herramientas, selección, papelera)
      library/       biblioteca de ejercicios (carpetas, duplicar, mover, exportar)
      sessions/      sesiones: encadenar ejercicios
      auth/          registro, login, aprobación, invitaciones, miembros
e2e/                 tests Playwright (incluye capturas en e2e/shots, ignoradas por git)
scripts/             validación de migraciones, build/serve de Pages, serve de producción
supabase/migrations/ SQL versionado + RLS (FUENTE ÚNICA del esquema)
supabase/schema.sql  esquema inicial histórico: DEPRECADO, con guarda que ABORTA su ejecución
```

## Estado de las pruebas (números reales)

- **Unitarias (Vitest)**: `npm run test:unit` → **642 pruebas en 35 ficheros** (medido el
  23/09/2026 con el árbol de la administración de plataforma y la auditoría de flujos).
- **E2E (Playwright)**: **116 ficheros** en `e2e/`. La pasada completa de la config de
  desarrollo (`playwright.dev.config.ts --workers=1`, sobre una build de **desarrollo**
  regenerada antes) el 23/09/2026: **885 pruebas en verde, 11 omitidas, 28,6 min, exit 0**.
  Las omitidas son las capturas que solo corren con su variable (`CAPTURAS_*`).
  El resto de configuraciones son opt-in: Supabase real, Pages y la build de producción.
- **Auditoría de interacción**: `fase-i-interaccion` (doble clic y papelera, ×50 con un
  worker = 600 pruebas) y `fase-i-barra` (barra contextual en 5 vistas × 5 posiciones y
  sensibilidad al tamaño/número real de botones). Ambas en verde dentro de las 885.
- **CI en cada push** (`.github/workflows/ci.yml`): `format:check` + `lint` + unitarias +
  `validate:migration` + build de producción + un subconjunto **estable** de E2E
  (14 ficheros: núcleo, persistencia, móvil, accesibilidad, galerías y los `fase-i-*`).
- **Suite completo de noche** (`.github/workflows/nightly.yml`, 03:00 UTC y a mano):
  el suite entero, para que una rotura fuera del subconjunto no quede escondida.
- `npm run validate:migration` es **análisis estático**: parsea la sintaxis de las
  migraciones y audita por texto las propiedades de seguridad de cada migración relevante
  (**154 comprobaciones** en la última pasada). **No** consulta el catálogo remoto ni
  comprueba que los GRANT se apliquen.
- **Ojo con `dist/`**: `playwright.dev.config.ts` sirve la build que haya en
  `dist/entrenolab/browser`, así que **hay que regenerar la build de desarrollo**
  (`npx ng build --configuration development`) antes de esa suite si se acaba de hacer
  `npm run build` (producción) o `build:pages`; si no, las pruebas de la config de desarrollo
  corren contra otro artefacto y fallan sin motivo. (Ya pasó: 7 fallos falsos por eso.)
- **No corras otras herramientas pesadas mientras corre el E2E completo**: con `--workers=1` y
  la máquina saturada (eslint, `ng test`, builds en paralelo) aparecen fallos por tiempo de
  espera que no son del código. También pasó y quedó documentado.

## Arquitectura

- Pantalla → `StoreService` → `DataSource` (local o `SupabaseRepository`); las pantallas
  **nunca** hablan con Supabase directamente.
- Geometría del campo centralizada en `core/field.ts`; render SVG puro en `core/render.ts`
  (sin mutar el modelo).
- `normalizeCanvas` migra documentos antiguos (`canvas_data` v1/v2 → v4) de forma idempotente.
- `[data-el-type]`/`data-side`/`data-kind`/`data-field` en el SVG son identificadores estables
  para los tests de cobertura/geometría (no cambian la UI).

## Seguridad / secretos

- RLS en Supabase es la barrera real (la UI solo oculta acciones).
- Ninguna **Secret/Service Role** en el navegador, repo, logs, capturas ni artefactos.
- La validación de respaldos rechaza secretos y datos malformados.
