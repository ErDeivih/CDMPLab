## Qué he construido

El botón «Crear en CDMPLab» selecciona «Dibujo» en la tarea de Coach antes de abrir la biblioteca y vuelve a identificar el selector si Coach lo reconstruye. Las sesiones admiten número, título opcional, 120 minutos predeterminados, objetivos, material, tres bloques, series y asistencia de la plantilla. La planificación viaja junto con la sesión en el guardado remoto atómico y en el respaldo local.

## Cómo fluye la información

La extensión lee solo la tarea abierta en Coach, abre Biblioteca con los datos reconocidos y recibe un PNG que coloca en el input de esa misma tarea; «Aplicar» y «Guardar» siguen bajo control de la persona. El editor de sesiones construye un `Session` con tareas y asistencia; `StoreService` lo guarda localmente o llama a `SupabaseRepository`, que serializa la planificación en `sessions.plan` y usa `save_session_with_tasks`. Al cargar, el mapeador une `sessions.plan` con `session_exercises`; al importar un respaldo, `import_team_dataset_with_plan` reutiliza la importación transaccional existente y añade el plan sin sobreescribir sesiones existentes.

## Patrones aplicados

Se conserva el mapeador entre modelo y fila SQL para que la UI no conozca columnas de la base. La RPC sigue siendo `SECURITY INVOKER` y mantiene la revisión optimista y las políticas RLS existentes. El plan JSONB agrupa datos de asistencia y planificación ligados a una sola sesión, evitando guardados parciales entre tablas; a cambio, los futuros informes analíticos por jugador necesitarán extraer ese JSON o normalizarlo.

## Especificidades de Flutter/Dart

No aplica: este slice modifica EntrenoLab (Angular/TypeScript), no el proyecto Flutter `app/`. Las puertas pertinentes son build, unitarias, Playwright y validación SQL; no se han modificado ficheros de Flutter.

## Decisiones tomadas

Los jugadores aparecen como «Pendiente» al crear una sesión: no se declara asistencia antes de realizarla. El número se propone como el máximo del equipo más uno, pero se puede editar; el título vacío se muestra como «Sesión N» o la fecha, sin inventar un título persistido. Los bloques son Calentamiento, Parte principal y Vuelta a la calma; cada tarea conserva su ID, duración y copia histórica. Un cliente antiguo que guarde sin `plan` conserva el plan existente en la base.

## Qué se rompe si cambias X

Si se cambia la clave de una tarea al importar sin actualizar el mapa de `plan.tasks`, se pierden su bloque y sus series. Si se retira la cláusula `coalesce(v_plan, v_existing.plan)` de la última definición de `save_session_with_tasks`, una pestaña antigua podría borrar planificación nueva. Si Coach cambia el `name` de su input o el texto de «Dibujo», el puente debe revisarse antes de usarse; rechaza las coincidencias ambiguas.

## Qué criticaría un revisor senior

La asistencia dentro de JSONB simplifica la atomicidad ahora, pero dificulta estadísticas SQL por jugador y validar claves foráneas de participantes. La extensión se prueba contra una página Coach simulada porque no hay un entorno de pruebas autenticado del club; conviene verificar manualmente una tarea real tras actualizarla.

Catálogo remoto comprobado el 2026-10-07: `public.sessions` y `public.session_exercises` existían sin columna `plan`; `public.session_attendance` no existía; `public.save_session_with_tasks(jsonb,integer,jsonb)` existía con `SECURITY INVOKER`. Había 0 sesiones antes de aplicar. Migraciones aplicadas en el proyecto `vgwfjkhvzprsoixpzruq`: `20261007220820_session_planning` y `20261007220919_preserve_session_plan_on_legacy_save`; después, `sessions.plan` es JSONB con `{}` por defecto, ambas RPC son `SECURITY INVOKER`, ejecutables por `authenticated` y no por `anon`, y siguen habiendo 0 sesiones.
