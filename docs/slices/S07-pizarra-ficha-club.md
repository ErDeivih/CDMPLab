## Qué he construido

La pizarra ofrece acceso directo a Jugadores, Material y Dibujo, variantes listas para colocar y paneles independientes sin minimizar. Se añaden tres balones recortados, chinos fotográficos recoloreables sin retirar los vectoriales, picas por color y los ajustes de tamaños, selección y guías solicitados. La ficha de sesión reproduce la cabecera tabulada y los ejercicios del formato del club, con escudo, asistencia, cinco columnas principales de petos y dibujos en los tres bloques.

## Cómo fluye la información

El registro canónico determina el grupo visible; el manifiesto tipado resuelve variante, recurso, tamaño base y caja visible. Elegir variante/color recuerda la preferencia y arma la herramienta; el toque o arrastre confirmado crea un elemento del modelo existente. Render, hit-test, miniatura y exportación reciben la misma geometría. La elección de color del jugador repinta su documento o lo coloca en el primer hueco libre por orden de lectura de pantalla, sin modificar Plantilla. La sesión guardada aporta organización, asistencia y snapshots; la ficha escapa texto, rasteriza esos snapshots y prepara HTML autocontenido para la impresión A4.

## Patrones aplicados

Registro único y funciones puras compartidas evitan catálogos, tamaños y cajas táctiles contradictorios. Se conserva `t: ball`/`t: target`; las nuevas fotografías se diferencian por `assetKind`, sin nuevos tipos de elemento ni migraciones. Una sola fotografía de chino se recolorea con un filtro SVG que mantiene forma, alfa y sombras; no se generan diez ángulos distintos ni se eliminan los chinos históricos. Los paneles tienen estados independientes; solo los catálogos izquierdos son mutuamente excluyentes.

## Especificidades de Flutter/Dart

No aplica: EntrenoLab usa Angular/TypeScript. David autorizó continuar con la aplicación, sus pruebas y documentación tras señalar la discrepancia del contrato Flutter. No se modifica Supabase, SQL, permisos, secretos ni las puertas de verificación.

## Decisiones tomadas

El balón reduce un 30 % respecto a su dibujo anterior, sin aplicar esa reducción a jugadores, fitballs ni balones medicinales. Los recortes nuevos se normalizan según el diámetro visible del original, no según el tamaño del cuadrado PNG: un recurso con menos margen transparente no debe verse mayor. Las porterías crecen otro 5 %; miniportería conserva el 20 % anterior y multiplica además por 1,05. Las cajas de golpeo/selección usan las mismas dimensiones.

La flecha mantiene el trazo continuo por defecto y recuerda las preferencias personales ya elegidas; sus opciones visibles son Pase / golpeo y Sin balón (discontinuo). Se retira Borrar elemento del catálogo, no la eliminación con teclado/contexto. Se elimina el borde blanco del jugador, tanto el continuo en reposo como el discontinuo al seleccionarlo; se conservan los demás controles de selección.

En móvil vertical los dos paneles comparten el ancho de la hoja inferior; en horizontal y escritorio siguen en sus respectivos lados. La X permite liberar el campo. La colocación automática evita los paneles y las zonas fuera de vista, y avisa si no queda un hueco libre en vez de superponer un jugador arbitrariamente.

La rejilla de datos del inspector permite encoger sus hijos (`min-width: 0`) y usa una columna de mínimo cero en móvil. Las acciones largas del texto envuelven sus etiquetas y aumentan su altura, en vez de quedar recortadas. El fallo real se reprodujo con una hoja de 176 px y contenido de 227 px: las columnas Duración/Jugadores retenían su ancho intrínseco; no se ocultó el fallo cambiando la expectativa de scroll.

Las pruebas que preparan un campo libre cierran el inspector inicial con la X, porque ahora abre por defecto. Las que comprueban coexistencia conservan explícitamente ambos paneles. Elegir Dibujo en un catálogo ya abierto debe ser idempotente en el helper, no alternarlo a cerrado; una paleta de chino se localiza por su grupo accesible para no confundirla con la nueva paleta de pica. Se conservan los recuentos, geometrías, valores persistidos y comprobaciones de no duplicación. Parte del diff de pruebas es el formato mecánico de ficheros anteriores al cambiar sus imports/helpers, no una reescritura de escenarios.

La ficha emplea la habilidad PDF: comparación visual de las seis páginas de referencia y renderizado del resultado. Se conserva paginación automática para textos largos; no se impone un máximo de dos páginas que recorte información. La temporada se deriva de la fecha de la sesión con inicio en julio, no de la fecha actual. No se inventa la fórmula de carga calculada de Coach: la ficha indica que no está disponible. Los minutos previstos y programados se mantienen separados.

Se emplea la habilidad imagegen en modo integrado para extraer cuatro objetos sobre fondo realmente transparente; después `scripts/prepare-material-cutouts.mjs` normaliza tamaño/margen sin volver a extraer el fondo. Recursos finales: `public/assets/tactical/ball-tiro-red.png`, `ball-tiro-black.png`, `ball-tango.png` y `chino-photo-green.png`. Prompt aplicado a cada referencia: «background-extraction; recorte preciso del objeto; conservar silueta, perspectiva, colores, texturas y marcas; fondo alfa real, incluidos huecos; quitar suelo y sombra exterior; centrar con margen transparente; sin rediseño». Los colores adicionales del chino se aplican en el render, conservando una única fotografía.

## Qué se rompe si cambias X

Comparar cuadrados de imágenes en lugar de sus cajas alfa vuelve a inflar los balones nuevos. Reaplicar el factor de tamaño al modelo en cada carga encogería ejercicios sucesivamente; aquí solo se aplica en render. Quitar la excepción `chino_photo` de los materiales siempre vectoriales hace desaparecer su fotografía. Quitar el filtro de la exportación devuelve todos los chinos fotográficos al verde. Ordenar posiciones normalizadas en lugar de posiciones de pantalla invierte las filas al girar el campo. Volver a cerrar el inspector al abrir un catálogo rompe la coexistencia.

## Qué criticaría un revisor senior

El HTML/CSS de impresión sigue siendo una plantilla grande y la impresión nativa depende de la configuración del navegador; merece una extracción posterior de estilos y más muestras reales de sesiones extensas. Dos paneles simultáneos en un teléfono estrecho dejan poco espacio central y exigen usar sus X; se conserva esa posibilidad explícita solicitada por David, sin afirmar que resuelve todas las necesidades móviles.

Verificación local final: 720 pruebas unitarias en 42 ficheros; batería completa de navegador con 937 aprobadas y 11 omisiones preexistentes, sin añadir nuevas omisiones; 10 pruebas del artefacto de producción y 14 del artefacto de Pages, todos los procesos con salida 0. Formato, codificación, lint y tipos E2E pasan sus puertas existentes: se conserva declarada la deuda previa de 79 reglas de lint y 70 errores de tipos de pruebas, sin deuda nueva. Validación estática de las 29 migraciones y contrato de correo aprobados; no equivalen a verificar el estado de la base remota.

La muestra compacta tiene dos páginas A4 y siete dibujos repartidos en los tres bloques. Se revisaron visualmente las dos páginas finales. La muestra extensa conserva las 630 indicaciones y la vuelta a la calma en diez páginas; la extracción de palabras no detecta ninguna fuera de los límites de página. La producción y Pages se comprobaron después de la batería de desarrollo, sin reconstruir el directorio servido mientras las pruebas lo estaban utilizando.

Las primeras pasadas fallaron: detectaron el solapamiento real de paneles en vertical, una ficha estándar de tres páginas y el ancho intrínseco incorrecto del inspector móvil. También exigían contratos anteriores (minimizar, desplegar Herramientas, panel inicialmente cerrado o balón igual de grande que jugador). Se corrigieron el código y las preparaciones de escenario correspondientes, sin relajar guardado, modelo, alfa, geometría o ausencia de colocación fantasma. Un intento paralelo de dos comandos Playwright compartió el servidor y uno lo cerró; los errores `ERR_CONNECTION_REFUSED` no se dieron por aprobados: la pasada final se ejecutó en un solo comando.

El intento local de PostgreSQL aislado no pasó: Docker quedó bloqueado al arrancar el contenedor de prueba. Se detuvo únicamente ese cliente; no se tocaron otros contenedores ni datos reales. La comprobación equivalente de PostgreSQL, migraciones, RLS y concurrencia sí pasó en CI (ejecución 38587857268); no se etiqueta el intento local como verde ni se confunde una base aislada con verificar la base remota.

El primer push (573c166) desplegó Pages correctamente, pero su CI estable falló en un caso de F7 después de reabrir desde Biblioteca (127 aprobados, uno fallido). La URL cambiaba antes de montar la nueva vista y el helper consultaba el DOM anterior: esperaba «Propiedades» cuando la vista nueva ya mostraba «Cerrar propiedades». Se corrigió esperando observables reales (host, SVG y botón) y manteniendo la apertura idempotente, sin aumentar timeouts ni relajar las comprobaciones de geometría/persistencia. La misma batería estable de CI, con `ng serve` y un worker, se repitió localmente: 128 aprobados, salida 0.
