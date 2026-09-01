# EntrenoLab

Pizarra táctica + biblioteca de ejercicios para entrenadores. Una app web (Angular standalone)
con la que un técnico crea y organiza **ejercicios** sobre un **campo táctico a pantalla
completa** (jugadores, materiales, formas, texto) y los guarda en una **biblioteca** por
carpetas, con **duplicación**, **exportación** y acceso **multiusuario seguro** (propietario
+ hasta 4 colaboradores).

Proyecto **independiente** (repositorio `CDMPLab`). No incluye ni depende de la app Flutter
`ClubManager` (que vive en `../app` y es otro proyecto).

## Stack

- **Angular 22** + **TypeScript** (standalone components, `signals`) + **SCSS**.
- **Supabase** (Postgres) como backend de datos, con **RLS** por equipo.
- Datos locales en `localStorage` hasta que hay sesión; al autenticarse se usan datos remotos.
- **Playwright** para E2E · **Vitest/Angular** para tests unitarios.

## Requisitos

- Node 20+ y npm.
- Un proyecto **Supabase** (o modo totalmente local sin backend, que es el arranque por defecto).

## Arranque

```bash
npm install
npm run start        # servidor de desarrollo → http://localhost:4200
```

## Pruebas y build

```bash
npm run test         # unitarios (Vitest/Angular)
npm run test:e2e     # E2E Playwright (server de dev en 4200, --workers=1)
npm run build        # build de producción
npm run validate:migration   # valida el SQL de las migraciones
```

## Configuración de Supabase (nunca secretos)

Copia `.env.example` a `.env` y rellena únicamente datos no secretos:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` → es la **Publishable / anon key**; puede viajar en el frontend.

**Nunca** pongas en el frontend, en el repo, en logs ni en artefactos la **Secret Key** ni el
**Service Role**. Esas llaves solo pueden usarse en el servidor (Edge Functions) y no deben
versionarse. `.env`, `.env.local` y `*.env.*.local` están en `.gitignore`.

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
scripts/             validación de migraciones
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
