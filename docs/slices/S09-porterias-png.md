## Qué he construido

La portería normal usa `public/assets/tactical/ladder.png` y la miniportería usa `public/assets/tactical/minigoal.png`, sin cambiar los archivos originales. El campo, el catálogo, las miniaturas y la exportación comparten esos recursos también al abrir ejercicios antiguos. La herramienta Escalera conserva su dibujo y no se confunde con el nombre histórico del archivo de la portería.

## Cómo fluye la información

`tactic-assets.ts` asocia cada tipo con el PNG solicitado. `render.ts` resuelve el recurso al dibujar, sin reescribir el documento, y calcula la caja con `goalMaterialImageBox`; el golpeo y la miniatura usan la misma geometría visible. La exportación existente incrusta las imágenes del SVG para entregar un PNG autocontenido.

## Patrones aplicados

Se reutilizan el registro de recursos y el render compartido de la aplicación. Un patrón SVG permite recortar exclusivamente los márgenes transparentes del PNG sin editarlo ni estirarlo, manteniendo una caja visible coherente con la selección. La prueba de exportación mide píxeles de los dos objetos: comprobar solo un `href` no garantiza que la imagen llegue a verse.

## Especificidades de Flutter/Dart

No aplica: el cambio autorizado por David se implementa directamente en EntrenoLab, Angular/TypeScript. No cambia Flutter, Supabase, migraciones, secretos ni configuración de puertas.

## Decisiones tomadas

Los PNG son cuadrados de 150×150 píxeles. La portería normal tiene contenido con alfa en las filas 54–95 (42 píxeles); la miniportería en las filas 32–117 (86 píxeles). Se comprobó el alfa de los archivos originales y no se generan versiones rasterizadas ni se añaden fondos blancos.

Se conservan las anchuras de referencia anteriores y los aumentos solicitados: 5 % para portería normal y factor acumulado 1,26 para miniportería. El alto visible sigue las proporciones de cada recurso, en vez de aplastarlo para imitar los vectores sustituidos. La portería normal mantiene su referencia de anchura por campo; la miniportería mantiene su escala de material.

Las expectativas antiguas que exigían postes y malla vectoriales, o una miniportería de la proporción antigua, dejaron de ser correctas cuando David pidió estos PNG. Se actualizan sus comprobaciones sin borrar ni saltar tests: rutas exactas, proporciones alfa, anchura física, área de golpeo, ausencia de fondo opaco y distinción respecto a Escalera. La primera prueba nueva de píxeles detectó un fallo real en las coordenadas internas del patrón SVG: las imágenes estaban referenciadas pero invisibles; se corrigió el render, sin relajar el umbral de la prueba.

Verificación local: 725 pruebas unitarias aprobadas; 21 pruebas de catálogo, PNG, escala, paneles y grupos; 5 de la matriz de capacidades/persistencia de porterías; 10 de producción y 14 del paquete Pages. Todas las tandas finales concluyen con éxito y se revisó visualmente `test-results/porterias-png.png`. Formato, codificación, lint y tipos E2E pasan sin deuda nueva; la deuda anterior sigue declarada por las puertas (79 reglas de lint y 70 errores de tipos E2E), no silenciada.

El despliegue se verifica sobre el commit publicado antes de informar de que está disponible. Las capturas y artefactos ajenos que ya estaban modificados no se incluyen en el commit.

## Qué se rompe si cambias X

Cambiar la asociación por el nombre literal del archivo haría aparecer una portería en la herramienta Escalera. Usar la caja cuadrada completa como área visible incluiría césped vacío y empeoraría las miniaturas; editar las constantes alfa exige volver a comprobar los PNG. Poner coordenadas absolutas del campo dentro del contenido del patrón vuelve a dejar los objetos invisibles, aunque el recurso cargue con HTTP 200.

## Qué criticaría un revisor senior

- Los límites alfa están medidos y documentados, pero hay que volver a medirlos si se sustituyen los PNG por otros de distinto encuadre.
- El renderer conserva los dibujos vectoriales históricos como respaldo del catálogo; esta entrega cambia la ruta activa sin aprovechar una petición visual para reestructurar todo el módulo.
