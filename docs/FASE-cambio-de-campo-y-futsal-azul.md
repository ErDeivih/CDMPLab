# Corrección urgente — cambio de campo directo y fútbol sala azul

Documento de la corrección con las **mediciones** que la sostienen. Se apoya en
`e2e/fase-cambio-campos.spec.ts` (prueba de regresión humana), `e2e/fase5-conversion.spec.ts`,
`e2e/fase-h-campos.spec.ts`, `e2e/fase-j-campos-vista.spec.ts` y
`docs/screenshots/fase-cambio-campos/INDICE.md`.

## Causa raíz confirmada

`board.component.ts` tenía un flujo con **estado pendiente**. En `setField`:

1. se detectaba el paso de un campo completo a uno de media extensión **con objetos**;
2. se guardaba `fieldChangePlan`;
3. se abría `fieldDialogOpen` (diálogo «Cambiar a medio campo»);
4. se terminaba con **`return` sin cambiar el campo**.

El diálogo pendiente bloqueaba las interacciones siguientes: el primer cambio podía funcionar y los
demás parecían no hacer nada hasta insistir. La suite **no lo veía** porque el helper de las pruebas
(`fase-j-campos-vista`, `audit`) detectaba el diálogo y pulsaba automáticamente una opción
(«Mantener los objetos», «Encajar todo»), de modo que una suite verde no demostraba nada sobre el
flujo real de una persona.

## Qué se ha hecho

### FASE 1 — cambio directo

- Eliminados `fieldChangePlan`, `fieldDialogOpen`, `decideFieldChange()`, `applyFieldChange()` y el
  diálogo con sus tres opciones («Dos medios campos», «Encajar todo», «Mantener los objetos»).
- `setField` ahora: no-op si el campo ya está activo → **cancela la interacción en curso**
  (`cancelActiveGesture` + borrador de dibujo + arrastre de panel) → `beginHistory` → cambia la señal
  del campo → ajusta orientación si procede (medio campo en escritorio) → `endHistory` → `resetView`
  si no está en «Llenar pantalla» → `markDirty`.
- **Ninguna transformación de coordenadas**: se retiraron también el `wasHalf && f === 'full'` que
  recolocaba la composición y las llamadas a `field-transform` (`mapFramesToTwoHalves`,
  `transformFramesFullToHalf`, `transformFramesHalfToFull`). Esas funciones siguen en
  `core/field-transform.ts` con sus unitarias, por si hacen falta para documentos antiguos.
- El panel de Propiedades **no se cierra**, así que se pueden probar varios campos seguidos.

### FASE 2 — seis campos en la galería

`FIELD_BASE_SPECS` pasa a: Campo completo, Medio campo, Tercio de campo, Fútbol sala, F7 transversal
y Lienzo. `box` («Área y portería») y `two_halves` («Dos medios campos») **siguen en `FieldType` y en
`FIELD_TYPES`**: se abren, se dibujan y se exportan (comprobado con documentos históricos y con
respaldos), solo dejan de ofrecerse.

### FASE 3 — fútbol sala azul

- Fuente única: `FUTSAL_SURFACE_COLOR = '#1e3a8a'` y `FUTSAL_AREA_COLOR = '#2563eb'`, más
  `fieldSurface(field)` (color + textura). El tablero, la miniatura de la galería, la miniatura de
  biblioteca y el PNG exportado pasan por ahí, así que el diseño no puede divergir.
- Superficie **lisa** (sin franjas ni damero), franja exterior también azul, **dos áreas de penalti
  rellenas** de azul claro emitidas **antes** de sus líneas blancas (van detrás), líneas reglamentarias
  blancas. Se conservan proporción 40×20, línea y círculo central, áreas en D, puntos de penalti,
  porterías y arcos de esquina.
- El fondo del lienzo exportado (`canvas-export.ts`) ya no usa el césped verde cuando el campo es de
  fútbol sala: era el que dejaba un **marco verde** alrededor del campo azul en la miniatura de
  biblioteca.

## Mediciones (no supuestas)

| Medida                                              | Valor                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Superficie del campo (fútbol sala)                  | `#1e3a8a` (30,58,138), **75,7 %** de la cuadrícula de muestreo                      |
| Interior del área                                   | `#2563eb` (37,99,235), más claro que la superficie                                  |
| Píxeles verdes de césped en el campo                | **0** (pantalla y PNG exportado)                                                    |
| Figuras del `entrenolab-grass` en fútbol sala       | **1** (una superficie lisa); en campo completo, 10 franjas                          |
| Rellenos de área en el tablero                      | **2** (la tarjeta de la galería dibuja los suyos: 2 más)                            |
| Miniatura de biblioteca                             | **96,5 %** azul, **0** píxeles verdes, dominante (32,56,136)                        |
| Cambio de campo (secuencia de 6 campos × 5 vueltas) | siempre **< 1500 ms**; sin diálogo, sin backdrop, panel abierto                     |
| Escenario rápido                                    | 10 cambios con 120 ms entre clics, ninguno perdido                                  |
| Objetos tras la secuencia completa de campos        | mismos **ids**, misma **geometría** (firma numérica de todos los campos del modelo) |

## Pruebas de regresión humana (`e2e/fase-cambio-campos.spec.ts`)

Escenario sin objetos (5 vueltas de la secuencia completa, `data-field`, `aria-pressed`, panel
abierto, cero `pageerror`/`console.error`), no-op al pulsar el campo activo, escenario rápido de 10
cambios, móvil 390×844 y 844×390 (el clic falla si algo lo intercepta), cambio con objetos
(ids/coordenadas/undo/redo/guardar-recargar-reabrir), compatibilidad histórica de `box` y
`two_halves`, y fútbol sala (estructura, píxeles en pantalla, píxeles del PNG exportado y miniatura de
biblioteca).

## Capturas

`docs/screenshots/fase-cambio-campos/` (carpeta NUEVA, generada solo con `CAPTURAS_CAMPOS=1`): los
seis campos con objetos reales, fútbol sala horizontal y vertical, cambio con objetos antes/después,
móvil, hoja de contacto e índice.
