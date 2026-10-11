## Qué he construido

Los chinos permiten elegir diez colores antes de colocarlos, igual que las variantes de los conos. Las vallas ofrecen el modelo original, una valla baja y una alta, y el F7 transversal utiliza la misma escala física de objetos que el medio campo. La plantilla muestra cinco colores por jugador: elegir uno lo coloca si falta, o recolorea su ficha sin duplicarla ni moverla, con deshacer y rehacer.

## Cómo fluye la información

El panel guarda la preferencia de color del chino en `toolColor` y la variante de valla en `materialVariant`; `addAt` escribe color y variante en el elemento. El render y las miniaturas comparten el SVG de las nuevas vallas. Los colores de jugadores se guardan en `CanvasDocument.playerColors`, nunca en la plantilla; asignar color actualiza las fichas de todos los fotogramas y coloca una ficha en el actual si falta. El historial incluye tanto los fotogramas como el mapa de colores, y el guardado existente serializa el documento completo.

## Patrones aplicados

Se reutilizan catálogo de recursos, renderizador, historial y persistencia existentes, sin introducir una segunda vía de guardado. Los dibujos de las vallas son vectores compartidos para evitar diferencias entre selector, campo y exportación. La escala F7 usa la fuente única `fieldObjectScale`, compartida por dibujo y hit-test.

## Especificidades de Flutter/Dart

No aplica: es un cambio de EntrenoLab (Angular/TypeScript). No se modifica el proyecto Flutter ni Supabase; no hay migración SQL.

## Decisiones tomadas

El primer color elegido coloca al jugador, incluidos azul y los colores predeterminados; no hay selección explícita inicial ni colocación al abrir la lista. Se busca un hueco entre puntos normalizados para no apilar las fichas; el entrenador puede moverlas después. Al cambiar color no se cambia posición ni se añade otra ficha si ya existe. Se conservan documentos con la valla original y los campos retirados. El F7 comparte factor físico con medio campo; no se promete igualdad de píxeles cuando el encuadre y la orientación difieren.

## Qué se rompe si cambias X

Si el historial excluye `playerColors`, deshacer quitaría el jugador pero dejaría el color marcado. Si se elimina la comprobación de `placedPlayerIds`, cada elección podría duplicar al jugador. Si se vuelve a 1,99 en F7, los objetos se inflan un 23 % frente al contrato actual. Las pruebas anteriores que exigían un popover de color o el tamaño antiguo de F7 se actualizan explícitamente porque el dueño ha cambiado esos contratos, no porque fallara la implementación.

## Qué criticaría un revisor senior

La colocación automática busca separación entre centros, no evita geométricamente todas las zonas y trazos del ejercicio; sigue siendo necesario recolocar para describir una táctica concreta. Las variantes nuevas representan vallas genéricas baja/alta, no un modelo comercial ni una altura reglamentaria.

Verificación: 117 E2E de regresión aprobadas (2 capturas opt-in omitidas por su configuración previa), más 36 ejecuciones específicas sobre el código final (`repeat-each=3`). Incluyen selección táctil en 844×390 y 390×844, ausencia de fichas detrás del panel, asignación/repetición de colores, deshacer/rehacer, plantilla intacta, guardado/reapertura de chinos y nuevas vallas, y tamaños F7/medio campo iguales con el mismo encuadre físico. Se revisaron visualmente las capturas de materiales y de las dos orientaciones móviles. No se ejecutó la suite E2E completa ni se modificó configuración para ocultar fallos.

Puertas adicionales: 686 unitarias/40 ficheros, compilación de producción y `build:pages`, formato y `git diff --check` con salida 0. Lint y tipos E2E no añaden deuda a la ya declarada por el proyecto. Cambios preparados localmente, sin commit, push ni despliegue; las capturas previas ajenas al slice no se incluyen como entrega de código.
