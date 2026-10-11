## Qué he construido

La paleta ocupa una sola fila junto al nombre, con círculos de 16 píxeles y controles de 22×28. El texto queda horizontal por pantalla salvo giro explícito. Las esquinas escalan caja y letra proporcionalmente, manteniendo fija la esquina contraria.

## Cómo fluye la información

Render, selección y hit-test comparten el ángulo efectivo del texto. Al empezar el gesto se captura el elemento original y cada movimiento calcula una escala desde esa instantánea; el historial y guardado conservan los datos finales. El crecimiento automático usa la altura física del campo actual.

## Patrones aplicados

Geometría pura compartida y snapshot de gesto para evitar acumulación de errores o saltos. CSS de paleta delimitado a las filas de plantilla.

## Especificidades de Flutter/Dart

No aplica: Angular/TypeScript en EntrenoLab, sin cambios en Flutter ni Supabase.

## Decisiones tomadas

Se conservan los giros guardados como giros explícitos relativos a pantalla. Las asas escalan proporcionalmente; los campos Ancho/Alto del inspector siguen permitiendo cambiar la caja independientemente. El contrato visual anterior de paleta en segunda fila y controles de 44 píxeles cambia por petición del dueño.

## Qué se rompe si cambias X

Rotar coordenadas normalizadas sin corregir la proporción física desacopla dibujo y asas. Recalcular desde el elemento vivo en cada movimiento provoca deriva. Usar siempre la altura del campo completo puede recortar texto en otros lienzos.

## Qué criticaría un revisor senior

Los controles compactos sacrifican área táctil frente a la versión anterior, aunque conservan nombre accesible y foco visible. El texto antiguo en vertical pasa a ser legible por pantalla; sus coordenadas, contenido y giro explícito no se modifican.

Verificación: 698 unitarias pasan; 128 E2E del conjunto de regresión del CI pasan; las 17 dirigidas iniciales (texto y colores) pasan y los 2 recorridos nuevos de texto pasan tres repeticiones (6/6). Revisadas visualmente las capturas de paleta móvil y texto. Se corrige explícitamente un contrato obsoleto en `features`: debe conservar el nombre del jugador colocado y comprobar el tooltip «Ya está en el campo», no reemplazar el nombre por el aviso. Lint y tipos E2E no añaden deuda nueva; la deuda previa permanece declarada.

Sobre el código final: 25 E2E de texto/selección y 14 del artefacto Pages pasan, build de producción incluida. Formato y whitespace sin errores. El control numérico del tamaño redondea solo su presentación; la geometría guarda la precisión completa.
