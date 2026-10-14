## Qué he construido

La pica permite girar y todos los jugadores del campo se dibujan un 15 % más pequeños que en S07, sin modificar sus datos guardados. La selección admite Ctrl/Cmd, Mayús y un recuadro desde una zona vacía, con movimiento, rotación, tamaño, propiedades compatibles, capas, bloqueo, copia, duplicado y eliminación del grupo. Conos, aros y petos ofrecen diez colores con colocación directa, y el chaleco lastrado usa un dibujo reconocible con cuatro bolsillos de lastre y cierre.

## Cómo fluye la información

El panel recuerda el color de cada material y arma su colocación; `addAt` guarda `c` en el elemento. `render.ts` aplica el color al vector o a la fotografía mediante un filtro SVG que conserva transparencia y sombreado, también en la exportación y la miniatura. La pica conserva `rot` porque deja de pertenecer a `FIXED_UPRIGHT_TYPES`; render, golpeo y controles consultan esa misma política.

Los eventos de puntero actualizan `selectedIds` y el último seleccionado alimenta el inspector. Ctrl/Cmd/Mayús alternan miembros; el recuadro incorpora objetos completamente contenidos y no modifica el documento. Las operaciones de propiedades recorren los seleccionados compatibles y desbloqueados; las transformaciones y las capas pasan por funciones puras de `board-doc.ts`, dentro de una sola transacción de historial.

## Patrones aplicados

Se amplían las señales y operaciones existentes, sin introducir agrupaciones persistidas ni cambiar el esquema del documento. La transformación pura recibe los frames, los identificadores y la geometría física: girar porcentajes X/Y como si el campo fuese cuadrado deformaría las distancias. El chaleco comparte el mismo dibujo vectorial entre el catálogo y el campo para evitar miniaturas divergentes.

## Especificidades de Flutter/Dart

No aplica: esta tarea pertenece a EntrenoLab (Angular/TypeScript), no a la aplicación Flutter del directorio padre. David autorizó expresamente editar sus archivos directamente tras advertir la restricción de contrato. Se mantienen las puertas propias de EntrenoLab; no se modifican configuraciones de tests, Supabase, migraciones ni secretos.

## Decisiones tomadas

La reducción del jugador multiplica su factor histórico 0,9 por 0,85: resultado 0,765. El balón conserva la escala anterior y su reducción de S07. La hit-box comparte el nuevo factor, manteniendo la tolerancia táctil mínima.

El recuadro usa contención completa, como el escritorio, y con Ctrl/Cmd/Mayús añade a la selección anterior. El grupo dispone de cuatro asas para escala proporcional desde la esquina opuesta y de botones ±10 %; la rotación gira posiciones alrededor del centro común, respetando las proporciones reales del campo. Los elementos físicamente verticales conservan su orientación individual, pero su posición acompaña al grupo.

Los bloqueados no se mueven ni editan ni borran. Bloquear/desbloquear actúa sobre todo el grupo: una mezcla pasa a bloqueada y un grupo enteramente bloqueado pasa a desbloqueado. Duplicar o pegar una selección que incluye jugadores de plantilla se rechaza con aviso para conservar su unicidad; los jugadores genéricos sí pueden duplicarse. Las propiedades específicas solo modifican elementos compatibles.

Los tests anteriores que exigían una pica siempre vertical, jugadores de escala 0,54 o la silueta roja del chaleco respondían al contrato visual antiguo. Se actualizan porque David cambió esos requisitos, conservando comprobaciones numéricas y de geometría. La primera prueba nueva del punto de control de curva asumió incorrectamente un centro común Y=0,5; se corrigió la expectativa a partir del centro geométrico existente (Y=0,45), no el algoritmo para acomodar el test.

Verificación local final:

- Pruebas unitarias: 725 aprobadas en 43 archivos, código de salida 0.
- Primer barrido completo de navegador: 936 aprobadas, 11 omisiones preexistentes y 5 fallos; no se declara verde ese proceso. Los fallos fueron dos expectativas de pica no rotatable, un selector de variantes que también coincidía con la nueva paleta, una comparación textual del decimal 0,459 frente a 0,45899999999999996 y una carrera al registrar la descarga después del clic.
- Repetición de los seis archivos afectados en la build final: 162 aprobadas; el único fallo restante fue la etiqueta del nuevo test de color («Color Rojo» frente a «Color rojo»). Corregida la etiqueta, las cinco pruebas completas de selección vuelven a pasar con salida 0, incluidos color, escala por asas, Escape, movimiento, capas, bloqueo, copia/pegado y eliminación.
- Producción real: 10 pruebas aprobadas. Paquete de GitHub Pages bajo `/CDMPLab/`: 14 aprobadas, incluyendo recursos sin 404, rutas directas, refresco y guard en móvil/escritorio.
- Formato, codificación, lint y tipos E2E pasan sus puertas sin deuda nueva. Se informa la deuda previa existente: 79 reglas de lint en 66 archivos y 70 errores de tipos E2E en 16 archivos; no se silencian ni reclasifican.
- Validación estática de migraciones y contrato de correo: salida 0; esta entrega no contiene cambios de base. No se ejecuta PostgreSQL local: su comprobación aislada corresponde al workflow de CI, que se verifica al publicar.

Se mantienen los logs de las tandas fallidas y corregidas en `tmp/s08-*.log`; no se eliminan pruebas ni se modifican puertas, timeouts o expectativas de geometría para ocultar errores. Los artefactos de capturas ya existentes no se incluyen en el commit de esta entrega. La publicación y el CI remoto se comprueban sobre el commit subido antes de informar a David de que está desplegado.

## Qué se rompe si cambias X

Volver a añadir `pica` a los objetos verticales inutiliza su rotación. Usar la misma constante final para jugador y balón cambia un material que David no pidió reducir. Guardar la escala efectiva de balón o miniportería como tamaño base aplica dos veces sus factores al redimensionar grupos; las transformaciones usan el tamaño base del recurso.

Cambiar capas miembro por miembro puede invertir el orden interno del grupo: la partición y los intercambios actuales lo preservan. Confirmar cada `pointermove` como una edición independiente rompe el deshacer único; el gesto de escala parte de una instantánea y Escape restaura la transacción anterior.

## Qué criticaría un revisor senior

- El componente de pizarra sigue siendo grande: esta entrega reutiliza su máquina de gestos en lugar de reestructurarla durante un cambio funcional.
- La selección heterogénea necesita criterios claros: los controles específicos siguen el último seleccionado y solo afectan a los tipos compatibles; no se convierten fotografías sin soporte de color en materiales recoloreables por mostrar una paleta.
