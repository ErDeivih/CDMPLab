## Qué he construido

Se incorporan diez recortes transparentes del material aportado por David. El catálogo añade gomas y balones medicinales, y variantes de pesas, BOSU y vallas. Se estabilizan miniaturas/selectores, se comparte el render de las porterías y se amplían las miniporterías un 20 %; el texto nuevo nace a 1,4.

## Cómo fluye la información

El registro visible incluye los tipos nuevos; el manifiesto de assets aporta variante, ruta, tamaño y caja física. La elección de variante se valida antes de guardar la preferencia y el gesto captura ese recurso al colocar. El mismo modelo alimenta editor, guardado, respaldo, miniatura y PNG; las miniaturas vectoriales de portería llaman al mismo render del elemento, no a un dibujo duplicado.

## Patrones aplicados

Caché de SafeHtml por contenido para evitar reemplazar nodos durante un clic. Recursos versionados por kind: los nuevos no sobreescriben los gráficos históricos. Operaciones puras compartidas para tamaño/hit-test y render; las miniporterías reciben un factor visual 1,2 sin multiplicar su tamaño guardado en cada apertura.

## Especificidades de Flutter/Dart

No aplica: cambios Angular/TypeScript de EntrenoLab, sin Flutter, credenciales ni modificaciones de Supabase.

## Decisiones tomadas

La valla naranja y la clásica sustituyen en el selector a las dos variantes SVG rechazadas; estas siguen abriendo en documentos antiguos. Las pesas y BOSU son variantes de tipos existentes; gomas y balón medicinal son tipos nuevos admitidos por modelo, normalizador, movimiento y catálogo. El tamaño tipográfico 1,4 solo afecta al texto creado: un texto histórico sin tamaño conserva 2,25.

Se usó la habilidad imagegen con la herramienta integrada, una edición por imagen, para extraer el fondo conservando el producto. `prepare-material-cutouts.mjs` normaliza después el encuadre y la resolución de entrega (384×384, alpha conservado), sin rediseñar los objetos. Los originales y las salidas grandes no se borran.

Recursos finales en `public/assets/tactical/`: `hurdle-orange.png`, `kettlebell.png`, `dumbbell-metal.png`, `weight-plate.png`, `band-yellow.png`, `band-red.png`, `medicine-handles.png`, `medicine-ball.png`, `bosu-blue.png`, `bosu-small.png`.

Prompt de extracción empleado: «Use case: background-extraction. Edit target: [producto] in supplied image. Remove ONLY all background including any checkerboard, green/white background, cast shadow and background watermark; clear empty holes and space between loops too. Preserve the exact entire product shape, camera angle, material, proportions and color, do not redesign. Center product with small transparent margin. Genuine transparent alpha PNG, no checkerboard, no added objects, do not add labels. For a football coaching canvas.» Para pesas se pidió igualmente preservar su estilo original y transparencia interior; para la valla se especificó el tubo naranja curvado y su ángulo de cámara. Productos: valla naranja, pesa rusa gris, mancuerna metálica, disco negro con agujero, goma naranja, goma roja, balón negro con asas (10LB/4.5KG), balón naranja/negro (8KG), BOSU azul con base negra y cojín azul pequeño de equilibrio.

## Qué se rompe si cambias X

SafeHtml nuevo en cada detección de cambios vuelve a sustituir el nodo pulsado entre pointerdown y pointerup. Separar el factor de miniportería entre dibujo/hit-test desacopla selección y tamaño visible. Omitir los tipos nuevos del movimiento o normalizador provocaría objetos inmóviles o pérdida de elementos al respaldar.

## Qué criticaría un revisor senior

Las imágenes se reconocen mejor que los SVG rechazados, pero sus texturas pierden detalle a escala de campo completo. El PNG cuadrado incluye margen transparente; las cajas de hit-test usan el bbox medido para no seleccionar todo ese margen.

Verificación del 13/10/2026: 703 pruebas unitarias, matriz y aceptación ampliadas (119 pruebas), y pasada final de materiales/texto/móvil (20 pruebas) en verde. Build de Pages y sus 14 pruebas en verde. Lint, formato y tipos E2E pasan con la deuda previa declarada, sin deuda nueva; `git diff --check` pasa. No se ha ejecutado la suite E2E completa en esta ronda.

La primera pasada amplia detectó tres expectativas de variantes obsoletas y un gesto de prueba que usaba la esquina anterior a rotar el texto; se corrigieron los tests, no las capacidades comprobadas. La matriz completa corregida pasó. Los gestos táctiles nativos detectaron además que el scroll cancelaba el arrastre vertical: la imagen es ahora el agarre explícito y los nombres conservan el scroll de la lista. Se comprueban preferencias `null`, arrays y variantes retiradas, y tamaños de texto históricos en formatos v1/v2.

La revisión de la última ejecución nocturna anterior identificó tres fallos: el gesto antiguo de la matriz de texto, una caja temporalmente ausente del chino y una expectativa de nombre sustituido por aviso. Colocación y gráficos pasan sus 13 pruebas, y gráficos pasa además cinco repeticiones (10/10). Se corrigió la expectativa del jugador: conserva «Marcos», el título informa «Ya está en el campo» y se comprueba que no se duplica. No se afirma que la suite nocturna completa haya pasado. Tras desplegar `2efed6b`, los diez PNG públicos responden HTTP 200 y su SHA256 coincide con el fichero local.
