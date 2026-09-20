# FASE 3 — de la barra inferior al grupo flotante «Herramientas»

Documento de la fase tal como quedó implementada, con las **mediciones** que sostienen cada decisión.
Se apoya en `e2e/fase-ux-herramientas.spec.ts`, `e2e/board-helpers.ts` y
`docs/screenshots/fase-ux-final/INDICE.md`.

## Qué cambió

| Antes                                                                                                                            | Ahora                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `<nav class="studio-tools">` era una fila del layout (`.studio` es una columna: cabecera, área del campo, barra)                 | El grupo FLOTA: `position: absolute` en la esquina inferior **izquierda**; no ocupa layout               |
| El área del campo terminaba por encima de la barra: 57 px perdidos (medido: `.studio-main` = 289 px en 844×390)                  | El campo llega al borde inferior de la pantalla (medido: `.studio-main` = 346 px en 844×390)             |
| Jugadores / Material / Dibujo estaban SIEMPRE visibles en la barra                                                               | Viven en el menú que abre el botón «Herramientas»; **el menú se cierra solo al elegir categoría**        |
| Cursor y Mano en la barra                                                                                                        | Siguen igual: siempre visibles en el grupo (su uso es continuo y desarmar no puede exigir abrir un menú) |
| La leyenda de la herramienta (título + Continuo/Discontinuo + Relleno/Perímetro + muestrarios) ocupaba una fila fija de la barra | Flota ENCIMA del grupo; en compacto sigue oculta salvo en herramientas coloreables                       |

## Mediciones que fijan el diseño

- **Grupo flotante**: 149×54 px en móvil (tres botones de 44 px; la leyenda está oculta por CSS en
  compacto) y 210×88 px en escritorio (leyenda 147×32 + fila 210×50). Medido con un spec de medición
  puntual, no estimado.
- **Esquina inferior IZQUIERDA, no centrada**: «objeto en borde inferior» (FASE I) coloca en
  x = centro del campo e y = borde inferior − 24 px, y «cerca del borde inferior derecho» en x = 0,92.
  Con el grupo a la izquierda (≤ 152 px en 360 px de ancho) esas dos bandas quedan libres.
- **El contenedor no intercepta clics** (`pointer-events: none`; solo los controles lo reactivan), de
  modo que la banda inferior del campo sigue siendo colocable. Verificado con `elementFromPoint` en
  `FASE 3.2`, con el menú cerrado y abierto.
- **Franja reservada `--reserva-grupo-herramientas`** (96 px en escritorio, 62 px en compacto): los
  paneles de la pizarra terminan justo por ENCIMA del grupo. Sin esta reserva, el grupo —que va por
  encima del panel (`z-index` 86 > 40) para seguir operable con el panel abierto— interceptaba los
  clics de las últimas filas del catálogo y de la plantilla; medido en la suite: «Mancuerna / pesa» y
  el primer jugador de la plantilla no se podían pulsar (8 pruebas fallando por `locator.click`
  agotando el tiempo de espera). El contrato de no-solape es el MISMO que había con la barra; solo
  cambia el elemento de referencia.
- **La leyenda no envuelve** (`flex-wrap: nowrap` + scroll interno): el alto del grupo tiene que ser
  previsible porque los paneles reservan su franja.

## Coste real del cambio de contrato en las pruebas

`.tools-cat` tenía **284 usos directos en 74 ficheros**. El codemod insertó
`await abrirHerramientas(page);` (idempotente: mira el DOM, no una variable) antes de cada
interacción directa —**244 preludios en 71 ficheros**— y añadió el import del helper donde faltaba.
Los casos que el código no cubría (selectores guardados en variables o en arrays: bucles
`for (const [, trigger] of openers)`) se corrigieron a mano, con un preludio condicional
`if (trigger.includes('.tools-cat'))` para no abrir el menú cuando el disparador es otra cosa.

El helper `abrirHerramientas` documenta en su propia cabecera que **la app es el lado correcto** y que
lo que cambió es el contrato del DOM, para que la actualización de pruebas no se lea como un ajuste
para pasar.

## Contratos visuales actualizados (y por qué)

| Prueba                                                        | Antes exigía                                       | Ahora exige                                                                   | Motivo                                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fase-ux-herramientas` (1)                                    | La barra NO flotaba y el campo no llegaba abajo    | El grupo flota y el campo termina en el borde inferior                        | Es la fase pedida                                                                                                                                                                              |
| `mobile-toolbar`                                              | 7 controles fijos en una fila                      | 3 persistentes + 3 categorías con el menú abierto, mismo 44×44 y sin overflow | Las categorías dejaron de estar siempre en el DOM                                                                                                                                              |
| `pizarra-usabilidad` F, `fase-ux-paneles`, `fase-shell-movil` | El panel termina por encima de la barra            | El panel termina por encima del grupo (franja reservada)                      | Mismo invariante, otra referencia                                                                                                                                                              |
| `fase1-responsive` (acciones duplicadas, objetivos táctiles)  | Contaba `[aria-label="Jugadores"]` siempre visible | Lo cuenta con el menú abierto                                                 | La categoría vive en el menú                                                                                                                                                                   |
| `features`, `cierre-produccion-visual`, `galerias`            | Dibujaban/colocaban en x≈0,06-0,08                 | Igual con x≈0,16-0,17                                                         | Con el campo 57 px más alto la escala crece y el borde izquierdo del campo cae bajo el panel abierto; el `pointerdown` lo recibía el panel y la figura no se creaba (medido: 7 de 10 y 2 de 5) |

## Estado y pendientes

- Implementado y verificado en la suite: quitar la barra del layout, botón «Herramientas» flotante con
  menú, «Volver a Cursor» en la cabecera (3.3), reserva de la franja para los paneles y capturas de
  FASE 10 regeneradas.
- **Pendiente del dueño**: revisión visual de las capturas y comprobación en dispositivo real de que el
  grupo no molesta al colocar con el dedo en la esquina inferior izquierda (en la suite no se
  intercepta ninguna colocación, pero el pulgar es otra cosa).
- El menú de «Herramientas» **no** se cierra al tocar el campo (solo al elegir categoría, con `Escape`
  o al abrir otro panel): es deliberado, para poder elegir dos categorías seguidas, y no afecta a la
  banda de colocación porque el menú abre hacia arriba.
