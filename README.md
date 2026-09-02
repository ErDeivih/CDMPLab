# CDMPLab

Pizarra táctica + biblioteca de ejercicios para entrenadores. Una app web (Angular standalone)
con la que un técnico crea y organiza **ejercicios** sobre un **campo táctico a pantalla
completa** (jugadores, materiales, formas, texto) y los guarda en una **biblioteca** por
carpetas, con **duplicación**, **exportación** y acceso **multiusuario seguro** (propietario
+ hasta 4 colaboradores).

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
`SUPABASE_E2E_COLLAB_EMAIL/PASSWORD`, `SUPABASE_E2E_LIMIT_EMAILS` (4 correos) y
`SUPABASE_E2E_LIMIT_PASSWORD`; más las opcionales de estado de acceso. Si faltan,
**se omite** con mensaje explícito (nunca finge un pase). Ver `docs/supabase-real-e2e.md`.

> **NO está en CI** y no forma parte de las puertas locales: necesita secretos y
> varias cuentas preparadas a mano.

### 5. Validación de migraciones

```bash
npm run validate:migration   # análisis ESTÁTICO (sintaxis + endurecimiento de grants)
```

Este validador hace **análisis estático** (parseo de sintaxis con `libpg-query` y
comprobaciones de endurecimiento sobre el SQL diseñado). No sustituye una ejecución
real. La migración `harden_grants_and_defaults` fue aplicada al proyecto remoto el
2026-09-02 y verificada después mediante `role_table_grants`, `routine_privileges`,
`pg_default_acl`, historial remoto y asesores de Supabase.

### 6. Build de GitHub Pages (base href `/CDMPLab/`)

```bash
npm run build:pages          # genera environment.pages.ts + ng build --configuration pages
npm run test:e2e:pages       # E2E local de esa build bajo /CDMPLab/
```

La config `pages` usa `baseHref: /CDMPLab/` y un entorno inyectado por variables
(`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`).

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
RLS por equipo). Las once migraciones están versionadas; la última figura remotamente
como `20260902102208_harden_grants_and_defaults`. Tras aplicarla se verificó que `anon`
no conserva permisos de tabla, que `authenticated` solo mantiene el conjunto explícito
y que no existen grants prohibidos de función o acceso a `private.platform_admins`.

Los privilegios por defecto de objetos creados por nuestras migraciones (`postgres`)
también quedaron endurecidos. Supabase no permite que `postgres` modifique los defaults
del rol interno `supabase_admin`; esa limitación de la plataforma está documentada en la
migración. El alta de cuentas, SMTP y la prueba multiusuario real siguen pendientes.

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
- El propietario puede crear **hasta 4 colaboradores** (activos + invitaciones pendientes).
- Las invitaciones se **crean** en base de datos (no se envía un correo personalizado); la
  persona invitada debe **registrarse** con ese correo, ser **aprobada** por el administrador
  y después **aceptar** la invitación.
- Un colaborador puede ver/editar jugadores y ejercicios del equipo, pero **no** gestionar
  miembros ni invitar.
- El admin de plataforma (tabla privada `private.platform_admins`, accedida solo vía
  funciones `SECURITY DEFINER`) aprueba los perfiles.

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
supabase/migrations/ SQL versionado + RLS
```

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
