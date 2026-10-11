## Qué he construido

«Enviar al fondo» lleva el objeto a la primera capa en una pulsación. «Traer al frente» lo lleva a la última, sin tener que recorrer las capas intermedias. Se conserva el orden relativo de los demás objetos y el cambio es una sola acción de deshacer/rehacer.

## Cómo fluye la información

El inspector llama a `sendBack` o `bringForward`; ambos reutilizan `layerShiftFrames` con dirección -1/1. La función pura reordena cada fotograma donde aparece el ID, sin modificar elementos ni coordenadas. El render pinta en orden de array, y el guardado existente persiste ese mismo orden.

## Patrones aplicados

Se conserva el ayudante puro y el historial transaccional existentes. Un extremo ya alcanzado devuelve la referencia original: el componente no abre historial, no marca cambios ni vacía la pila de rehacer en una acción sin efecto.

## Especificidades de Flutter/Dart

No aplica: modificación Angular/TypeScript de EntrenoLab, sin cambios en Flutter ni Supabase.

## Decisiones tomadas

Se cambia el contrato de los dos controles existentes, sin añadir más botones: el dueño quiere saltar al extremo, no subir o bajar un escalón. Sus etiquetas se hacen explícitas y los tests de navegación/inspector se actualizan declarando ese cambio. Se mantiene el comportamiento previo de aplicar capas en todos los fotogramas donde exista el elemento.

Ampliación solicitada después: se añaden «Adelantar una capa» y «Atrasar una capa», separados de los dos extremos. Reutilizan la operación pura con un modo paso explícito y los mismos límites, historial y persistencia; las pruebas comprueban que solo intercambian con el vecino.

Verificación de la ampliación: 690 unitarias y 15 E2E dirigidas pasan sobre el código final, incluidos ambos tipos de movimiento y las mejoras anteriores de colores, vallas y escala. El dueño autoriza publicar todo el conjunto funcional; las capturas regeneradas de otras rondas se conservan fuera del commit.

## Qué se rompe si cambias X

Volver a `idx + dir` recupera el defecto de mover una sola capa. Reordenar también los otros elementos altera sus solapamientos sin petición del usuario. Abrir una transacción para un no-op destruye innecesariamente la posibilidad de rehacer.

## Qué criticaría un revisor senior

La operación conserva el alcance actual de un objeto seleccionado, no introduce reordenación de grupos multiseleccionados. La API histórica se llama `layerShiftFrames`, aunque su contrato documentado ahora mueve al extremo.

Verificación ejecutada: 689 unitarias y 17 E2E dirigidas pasan, incluida persistencia al reabrir, figuras/materiales y deshacer/rehacer. Build de producción, formato de los ficheros del cambio y `git diff --check` terminan con código 0. Lint y tipos E2E no añaden deuda nueva; mantienen las exenciones previas (79 reglas y 70 errores respectivamente). Sin commit ni despliegue en esta ronda.
