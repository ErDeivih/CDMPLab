# Auditoría de `waitForTimeout` — FASE G (corregido, FASE H)

Fecha: 2026-09-09 · Commit base: `fd8f503`. Estado: cambios sin commit.

> Nota de recuento: se cuenta `waitForTimeout(` REAL (llamadas), no menciones en comentarios.
> Hay 4 líneas de comentario que contienen la palabra "sin waitForTimeout" (p. ej. p78) que **no** son esperas.

## Recuento

- **Inicial:** 393 llamadas `waitForTimeout(`.
- **Final:** 264 llamadas reales.
- **Convertidas (SUSTITUIBLE):** **129** → condiciones observables (`expect.poll`, `waitFor`, `toHaveText`, `toHaveClass`, `toBeVisible`, `toHaveCount`, `toHaveValue`). Cada una validada ejecutando su spec en verde.

## Categorías (motivación válida)

| Categoría | Cuándo aplica |
|---|---|
| **TEMPORAL REAL** | Mantener pulsado >500 ms para disparar el long-press; o el intervalo es parte explícita del comportamiento bajo prueba. |
| **ESTABILIZACIÓN VISUAL (captura)** | Espera inmediatamente anterior a `page.screenshot(...)` **para dejar asentar un renderizado/animación real** antes de fijar la imagen. Se conserva solo así; se justifica por la animación/render, no por "no regenerar PNG". |
| **SUSTITUIBLE** | Tras clic / dibujo / undo-redo / selección / apertura / cierre / movimiento / resize / guardado / navegación. Sustituida por condición observable. |
| **VENTANA INTENCIONADA (errores/detección)** | Espera deliberada para dejar que se recojan errores asíncronos (`console.error`, peticiones) o para que una mutación ERRÓNEA aparezca antes de aseverar que no cambió (evita falso verde). |

---

## 1. Conversiones (SUSTITUIBLE → observable) en FASE G/H

### p56-selection (auditoría defecto 2)
- Resize rect/línea/curva/freehand/cono y rect-rotado (100 ms): → `expect.poll` sobre `rectGeom.w`, `lineEnds.x2`, atributo `d`, `polyPoints`, `imageWidth`.
- Post-Escape línea (60 ms): → `expect.poll(lineEnds.x2)` del trazo deseleccionado.

### features (auditoría defecto 2)
- `openProps` (60 ms): retirada (el `toBeVisible()` es el observable).
- `panByDrag` (80 ms): → `toHaveClass(/rail-active/)`.

### H0: resto de funcionales
- `fields` `openProps` (60) → retirada · `f7-persistence` `currentField` (150/120) → `expect.poll(inputValue)` / `toHaveCount(0)`.
- `colores` (120) → `not.toHaveClass(/board-fill/)` · `matrix`/`p2-half-geom` `openProps` (60) → retirada.
- `fase4-formations-idempotente` (100) → retirada (apoya en `toHaveText('1')`).
- `fase5-composicion-completa` (80) → `expect.poll(SVG contiene el texto)`.
- `e1-mobile-props` `drag`/`rotateGesture` (60) → retirada; los llamadores usan `expect.poll(objectNorm/imageNorm)`.
- `p11-persistence` `dragMove`/`dragHandle`/`rotateViaBar` (60) → retirada (el modelo se verifica post-guardado).
- `fase3-material-scale` 2 deselect (80) → `toHaveClass(/rail-active/)`.

---

## 2. Esperas conservadas (motivación concreta)

### 2.1 ESTABILIZACIÓN VISUAL antes de captura
Espera que antecede a `page.screenshot(...)` para dejar asentar el render del SVG/animación. Justificación: **estabilización visual real**, no "evitar regenerar PNG".
- `fase5-captures` (30) · `fase-multiuser-captures` (22) · `capturas-finales` (21) · `final-interaction-captures` (19) · `final-board-gallery` (19) · `cierre-produccion-visual` (15) · `galerias` (13) · `captures` (11) · `fase4-captures` (9) · `fase4-final-captures` (9) · `bloque-capturas-contacto` (7) · `catalog-captures` (6) · `d2-pinch-captures` (6) · `mobile-toolbar` (captura) · `fase7-shots` (varias pre-screenshot) · `p34-stroke-size` (200/223/288) · `p3-text` (200/241/281) · `d3-mobile-hints` (161/208) · `fase2-mobile-field` (252/258) · `fase3-field-discovery` (386/393) · `ai-draft-determinista` (117/122) · `p2-placement` (250) · `fase6-names-export` (136).

### 2.2 TEMPORAL REAL (long-press)
- `gesture-helpers.ts` `longPress` (600 ms) · `features` 1632/1655/1682/1709 (650) · `fase1-color-per-tool` (600) · `matrix` `longPress` (600) · los specs con `longPress` helper.

### 2.3 VENTANA INTENCIONADA (errores / detección)
- `audit` 150/199 (500/400) · `fase5-local-smoke` 128 (400): recogida de errores asíncronos de consola/red.
- `fase1-responsive` 120/126 (80): ventana para detectar si abrir/cerrar un panel muta el documento (evita falso verde).

### 2.4 Settles de helper/app (sin condición observable al momento del helper)
- `p11-persistence` `resizeSelected` 211/237 (40): ocultar/restaurar overlays antes/después de arrastrar asas; la verificación del resize es post-guardado.
- `p78-gesture-tools` 209 (40) · `p56-selection` 134 (40) · `matrix` 894 (250) · `fields` 60/178 · `fase3-material-scale` 140 (captura) · `e1-mobile-props` (ya convertidas).
- Motivo: el efecto se verifica después (modelo/DOM posterior); en el instante del helper no hay señal.

### 2.5 Hints / montaje de app
- `c1-genericos-color` (200) · `a5-titulo-bloqueo` (200) · `p5-draw-gesture` 46 (200) · `p78-gesture-tools` 56 (200): dejar que los hints flotantes aparezcan para cerrarlos. · `accesibilidad` (500) · `prod-auth` (400): montaje del shell.

### 2.6 Casos concretos sin marcador fiable
- `fase6-names-export` 136 (150): forma real de la contrarrotación −90 (verificada por el bloque `upright` del test, no por un string fijo).

---

## Conclusión
- 393 → **264** llamadas reales (−129). No quedan SUSTITUIBLES en funcionales con observable disponible; las conservadas son ESTABILIZACIÓN_VISUAL, TEMPORAL_REAL, VENTANA_INTENCIONADA, settles de helper/app o casos concretos documentados.
- Puertas: ver informe final (FASE H).

---

## 3. FASE I — intermitencias de gesto, medidas antes de arreglarlas

Ninguna de las dos se arregla con esperas nuevas ni relajando aserciones: primero se mide, y se
dice qué lado estaba mal.

### 3.1 Doble clic que no abría el menú (la causa era el reloj, no las coordenadas)

- **Síntoma:** solo en la suite completa, el segundo clic sobre el mismo objeto no abría el menú.
- **Hipótesis descartada midiendo:** que el inspector recentrara el lienzo entre los dos clics.
  Con el inspector abierto y cerrado, la caja del host y la del cono son **idénticas**
  (`host 1346×563` en ambos casos, misma caja del cono): el panel es una capa superpuesta, no
  provoca reflujo. No se puede afirmar «se recentraba» sin esta medida.
- **Causa real:** la ventana de 350 ms se medía con `performance.now()` **dentro** del manejador.
  Si el hilo principal está ocupado repintando el inspector, el manejador del segundo clic corre
  tarde y **dos clics realmente consecutivos** se veían como dos clics sueltos. Ahora se mide con
  el `timeStamp` del EVENTO, que es el instante real del clic, no el de su procesamiento.
- **Además:** el segundo clic ya no exige que el hit-test acierte. Si el punto cae **dentro de la
  caja actual** del mismo objeto del clic anterior, sigue siendo un doble clic sobre él, aunque
  la disposición haya cambiado entre ambos clics (zoom, «Llenar pantalla», borde del campo). No
  se relaja la condición: el punto debe estar DENTRO de su caja, no «cerca».
- **Verificación:** `e2e/fase-i-interaccion.spec.ts` ×50 con un worker → 50/50 en los 6 escenarios.

### 3.2 Arrastre a la papelera que «no aparecía» (la causa era una pausa del propio test)

Medido con un spec temporal (ya borrado), objeto junto al borde:

| Instante | Papelera | Menú contextual | Objeto movido |
|---|---|---|---|
| Al bajar el botón | **visible** | cerrado | — |
| 900 ms después, sin mover | **oculta** | **abierto** | — |
| Tras mover 20 px | **oculta** | abierto | **0 px** |

Es decir: bajar el botón ya arma el arrastre (la papelera se ve en ese mismo instante) y arma
también la pulsación larga (550 ms). Si el objeto no se ha movido cuando vence el plazo,
`commitLongPress` → `consumeLongPressGesture()` vacía `movingIds` y el arrastre posterior no hace
nada. Latencia medida de una lectura `isVisible` (20 repeticiones): mín 39, mediana 65, p90 93,
máx 138 ms — en una máquina cargada una ida y vuelta puede pasar de 550 ms.

- **Lado equivocado: el TEST.** Ponía una aserción con sondeo entre bajar el botón y arrastrar,
  dentro de una ventana que el producto cierra en 550 ms; cuando esa aserción tardaba más que el
  plazo, el fallo se atribuía a la papelera. Arreglado moviendo la aserción **después** del primer
  movimiento (mismo gesto, antes de soltar): no se pierde cobertura y el primer fallo sigue siendo
  la selección si el hit-test falla. Afectaba a los 3 casos del test, no solo al del borde.
- **Comportamiento del producto que queda fijado con test propio** (no es un defecto de la prueba,
  y cambiarlo sería una decisión de producto, no del codificador): «sostener más de la pulsación
  larga abre el menú contextual y consume el arrastre».
- **El test no se rebaja:** siguen exigiéndose los 6 botones del menú, la papelera visible, el
  resaltado al llegar a ella, borrado exacto, Deshacer y Rehacer.

### 3.3 El gesto de doble clic estaba pegado al umbral (segunda causa, medida después)

Tras arreglar 3.1, una repetición ×50 volvió a fallar 2 veces (498/500) en el escenario
«normal (centro, panel cerrado)»: el objeto quedaba seleccionado pero sin menú. Traza temporal
del componente (×50 y ×100 repeticiones) y medida del hueco REAL entre los dos `pointerdown`,
con el mismo `event.timeStamp` que usa la app:

| Gesto de la prueba | Hueco entre los dos clics (100 repeticiones) | Menús abiertos |
|---|---|---|
| `mouse.dblclick(x, y, { delay: 40 })` | mín 104 · media 143 · **máx 350,7 ms** | 100/100 en reposo; 2 fallos bajo carga |
| `mouse.dblclick(x, y)` (sin retardo) | mín 0 · media 0,3 · máx 7,2 ms | **100/100** |

La ventana del producto es `DBL_CLICK_MS = 350` ms. Con el retardo artificial de 40 ms que
llevaba la prueba, el margen era prácticamente cero: **cualquier carga de la máquina empujaba
el hueco por encima de 350 ms y la app veía dos clics sueltos, que es exactamente lo correcto**
(para un usuario real los dos clics se sellan con la hora del hardware, no con la latencia de
una herramienta de automatización, así que esto no le afecta).

- **Lado equivocado: el TEST, otra vez, y por partida doble:** (1) el `delay: 40` artificial,
  retirado; (2) nada comprobaba que el gesto cayera dentro de la ventana del producto. Ahora el
  helper `doubleClick()` mide los `timeStamp` de los dos `pointerdown` y **falla con el hueco en
  el mensaje** si el gesto se sale de la ventana, en vez de dejar un «el menú no se abre» sin
  causa. La aserción del menú no se toca.
- **Riesgo residual declarado:** en una máquina extremadamente cargada, el doble clic sintético
  puede volver a superar los 350 ms. Por eso la repetición ×50 de la auditoría se ejecuta sin
  procesos pesados en paralelo (las dos veces que falló, esta máquina estaba además instalando
  dependencias y ejecutando ESLint y `tsc` a la vez).

### 3.4 Cuarta intermitencia (esta vez en el PRODUCTO): la pulsación larga rompía el arrastre

La suite completa (767 pruebas) falló una vez en `features.spec.ts` —«la selección múltiple se
mueve como un GRUPO»— con `movedA = 0`: A no se movió nada. Antes de tocar nada se descartaron
las hipótesis fáciles, por código y por medida:

- **No era un resize:** `resizeHandles()` devuelve `[]` para los materiales (`isMaterial`), así
  que un cono no tiene asas que puedan capturar el gesto.
- **No era un fallo del hit-test ni de la selección:** una repetición instrumentada del escenario
  exacto (12 veces, con traza de `hitTestNorm`, `selectedIds` y las cajas normalizadas) mostró el
  camino sano en las 12: la bajada acierta A (`hit=A`, `sel=0`), el shift-clic acierta B
  (`sel=1`) y el arrastre del grupo mueve A y B con el MISMO delta (`dx=0,0626 dy=0,0773`),
  dejando C quieto.

El único sitio que vacía el arrastre a mitad de gesto es `commitLongPress` →
`consumeLongPressGesture()`, y su disparador es una carrera: el plazo de 550 ms puede vencer
**antes** de que el primer `pointermove` llegue al navegador (en la prueba, el `down` y el `move`
son dos llamadas distintas y con la máquina cargada se separan). Cuando eso pasa, el usuario
arrastra y no ocurre nada. Es el mismo origen que 3.2, pero aquí el lado equivocado es el
**producto**, no la prueba:

- **Arreglo (producto):** en `commitLongPress`, para ratón/lápiz se abre el menú pero **no se
  desarma el arrastre** (`movingIds`/`moveStart` se conservan). En táctil se mantiene el consumo
  (si no, el `pointerup` volvería a ejecutar el tap).
- **Prueba reescrita** (`fase-i-interaccion`, «sostener más de la pulsación larga abre el menú SIN
  romper el arrastre»): la versión anterior exigía el comportamiento accidental —«el objeto no se
  mueve»—; ahora exige que el menú se abra, que sostener no borre y que el arrastre posterior SÍ
  mueva el objeto.
