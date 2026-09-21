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
distinguibles y reintento. La clave del proveedor es un **secreto del servidor**. El envío real
sigue **pendiente** (proveedor, credenciales y dominio): ver
[`docs/correo-invitaciones.md`](docs/correo-invitaciones.md) y, para el correo de Auth,
[`docs/smtp-supabase-auth.md`](docs/smtp-supabase-auth.md).

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

- **Unitarias (Vitest)**: `npm run test:unit` → **432 pruebas en 27 ficheros**.
- **E2E (Playwright)**: **97 ficheros** en `e2e/` (73 se ejecutan en la config de desarrollo;
  el resto son opt-in: Supabase real, Pages y la build de producción). La pasada completa
  final de la auditoría con `--workers=1`: **767 pruebas, 0 fallos, 30,6 min**.
- **Auditoría de interacción**: `fase-i-interaccion` (doble clic y papelera, ×50 con un
  worker = 600 pruebas) y `fase-i-barra` (barra contextual en 5 vistas × 5 posiciones y
  sensibilidad al tamaño/número real de botones). Ambas en verde dentro de las 767.
- **CI en cada push** (`.github/workflows/ci.yml`): `format:check` + `lint` + unitarias +
  `validate:migration` + build de producción + un subconjunto **estable** de E2E
  (14 ficheros: núcleo, persistencia, móvil, accesibilidad, galerías y los `fase-i-*`).
- **Suite completo de noche** (`.github/workflows/nightly.yml`, 03:00 UTC y a mano):
  el suite entero, para que una rotura fuera del subconjunto no quede escondida.
- `npm run validate:migration` es **análisis estático**: parsea la sintaxis de las
  migraciones y audita por texto las propiedades de seguridad del fichero de grants.
  **No** consulta el catálogo remoto ni comprueba que los GRANT se apliquen.

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
