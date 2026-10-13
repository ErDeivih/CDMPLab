## Qué he construido

Se amplía el editor de sesiones con organización, indicaciones, descansos, cinco colores de petos y creación de ejercicios sin salir de la sesión. La ficha A4 incluye dibujos de calentamiento, parte principal y vuelta a la calma, con paginación automática. Se conserva el histórico del ejercicio y se espera confirmación del guardado antes de cerrar el editor.

## Cómo fluye la información

El usuario selecciona biblioteca/carpeta o crea un ejercicio mediante StoreService. La tarea copia sus datos y dibujo; sus indicaciones y petos se modifican solo en la sesión. Dibujar conserva el borrador en sessionStorage, aislado por cuenta/equipo, abre BoardSessionService y vuelve a sesiones al guardar. El mapper escribe organización, copias históricas y petos en el plan JSON existente. Ver PDF prepara imágenes PNG autocontenidas y texto escapado; la nueva ventana permite imprimir/guardar PDF mediante el diálogo nativo de Chrome o Brave.

## Patrones aplicados

Snapshot histórico para impedir que una edición o borrado posterior en biblioteca modifique una sesión guardada. Fachada de persistencia única y guardado confirmado con rollback; no se llama a Supabase desde pantallas. Funciones puras para tiempos, agrupación, fechas y HTML seguro. Los petos de sesión repintan una copia del dibujo al exportar sin alterar el original. Los saltos A4 dejan fluir el contenido extenso sin imponer dos páginas ni truncarlo.

## Especificidades de Flutter/Dart

No aplica: EntrenoLab usa Angular/TypeScript. David autorizó expresamente trabajar sin el contrato de slices Flutter para esta tarea. No se han modificado tablas, permisos, funciones remotas ni secretos.

## Decisiones tomadas

El PDF usa la impresión nativa del navegador: la acción visible es Ver PDF → Guardar PDF / Imprimir → Guardar como PDF. No se anuncia una descarga automática. Hay cinco opciones de color por jugador y cinco columnas de ejercicios principales en la tabla general; las distribuciones de TODOS los ejercicios aparecen en sus fichas, incluidos el sexto y siguientes, calentamiento y vuelta a la calma. Se conservan también los colores históricos personalizados.

El tiempo de trabajo se etiqueta Min/rep. El campo persistido `minutesPerSeries` conserva su nombre por compatibilidad, pero con repeticiones explícitas representa el trabajo de cada repetición. Total = series × repeticiones × trabajo + (series × repeticiones − 1) × descanso. No se inventa la fórmula de carga de Coach: los valores «Carga calc.» de los PDF originales no tienen un contrato público en esta tarea.

Se empleó la habilidad PDF para extraer texto, renderizar y revisar las páginas de los tres ejemplos y de la nueva ficha. Se empleó la habilidad Supabase para verificar el catálogo remoto ANTES de plantear cambios de esquema. Resultado real del 13/10/2026, proyecto `vgwfjkhvzprsoixpzruq`: `sessions.plan` existe y es `jsonb`; `public.save_session_with_tasks(p_session jsonb, p_revision integer, p_tasks jsonb)` valida que plan sea objeto, lo guarda en la misma transacción que las tareas, comprueba pertenencia al equipo y revisión. Por eso no se crea migración. Esta verificación es de catálogo/definición; no se han escrito sesiones de prueba en la base real de usuarios.

## Qué se rompe si cambias X

Quitar snapshot del plan devuelve el defecto de histórico cambiante y dibujos perdidos tras borrar biblioteca. No remapear ids de jugadores al importar hace que los petos apunten a jugadores anteriores. Cerrar el editor antes de resolver saveSession oculta un fallo remoto y pierde el borrador. No transportar F7/texturas a la exportación pierde parte del dibujo. Alterar los tiempos sin validar fechas reales, valores no finitos y máximos vuelve a permitir sesiones imposibles de guardar.

## Qué criticaría un revisor senior

La copia del ejercicio aumenta el tamaño de plan; convendría medir volúmenes reales antes de normalizar o introducir almacenamiento adicional. La impresión nativa depende de opciones locales del navegador, aunque el documento fija A4, márgenes, paginación y fondos; no equivale a un generador PDF independiente.

Verificación: 716 pruebas unitarias en verde. Primera pasada completa: 918 aprobadas, 11 omitidas y 3 fallos, código de salida 1, en 31,2 minutos. Los fallos señalaron una cobertura de capturas desactualizada (19 frente a 21 materiales) y un defecto REAL: el SVG compartido de porterías no llevaba la clase que fija su tamaño a 26 px. Se amplían escenas y se corrige el SVG, manteniendo y reforzando el test de geometría/caja. Repetición sobre build nueva: 18/18 pruebas de capturas, miniaturas, sesiones y PDF, código de salida 0. No se afirma haber repetido los 932 casos después de esas correcciones.

Durante el cierre se añaden dos comprobaciones de importación v1 y cuota local: los arrays históricos se normalizan antes de remapear ids, y una escritura de sesión que falla no deja una sesión fantasma en memoria. Una prueba nueva de cuota falló con mi primera corrección porque la había aplicado a otro bloque con un contexto demasiado genérico; se retiró ese cambio ajeno y se aplicó al guardado correcto, y pasó. Se comprueba además que los tiempos fraccionarios se rechazan ANTES de enviarlos a las columnas de minutos enteros del servidor. Lint, formato, tipos E2E y codificación pasan sin deuda nueva (deuda anterior de lint/tipos/formato declarada, no cero absoluto).

La ficha de ejemplo tiene cuatro páginas A4 revisadas visualmente, con pie y número en cada página. La prueba de texto largo tiene 19 y conserva las 630/630 indicaciones completas al extraer y normalizar su texto. El ejemplo utiliza datos ficticios de 14 jugadores, no datos privados extraídos de Supabase ni del PDF del usuario.

Build de producción + E2E: 10/10, exit 0. Build de Pages + E2E: 14/14, exit 0. La revisión de Supabase fue de lectura; el despliegue de esta entrega solo requiere publicar la aplicación, no aplicar SQL.
