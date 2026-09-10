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
