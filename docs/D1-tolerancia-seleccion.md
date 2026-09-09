# D1 — Área de selección en px de pantalla, convertida por zoom (COMPLETADO)

## Requisito (Bloque D1)
- Ratón ~4 px, táctil ~8–10 px de tolerancia.
- La tolerancia se calcula en px de pantalla y se convierte según zoom (no un `0.045` fijo).
- Dos objetos próximos se seleccionan por separado; pulsar claramente fuera NO selecciona.

## Qué se hizo / cambió
1. **Núcleo** (`src/app/core/render.ts`): `ScreenPxTolerance`, `screenPxToNormTolerance(opts, px)`
   (inversa exacta de `screenToNorm`), `materialHitHalfExtents` acepta `pxTol` opcional (bbox real
   del material vía `frac` + margen en px), y `hitTestElement` acepta `pxScreen` opcional (sin cambio
   si no se pasa).
2. **Fix de geometría (prerrequisito)**: `screenToNorm` en `fit='height'` (Llenar pantalla) era
   contain-height mientras el render usa COVER (`fillScale = max(hostH/dimVert, hostW/dimHor)`); en
   hosts panorámicos daban un error de ~36 px (un objeto se dibujaba a 0.55 pero `toNorm` devolvía
   0.577). Ahora `screenToNorm` usa COVER → pantalla↔norm son inversas exactas. En hosts verticales
   no cambia (COVER == contain-height).
3. **Cableado** (`board.component.ts`): helper `hitTestNorm(p, view, screenPx)` (ratón→4, táctil→9)
   y los ~8 call sites de `hitTestElement` lo usan. El `scale` se calcula igual que el render
   (`fillScale` en Llenar pantalla).

## Tests
- **Unit** (`render.spec.ts`): `screenPxToNormTolerance` (zoom 2 → mitad de norm; ratón < táctil;
  a zoom alto la tolerancia norm baja pero los px de pantalla son los mismos) + round-trip
  norm→pantalla→norm en **host panorámico** con `fit='height'` (fija el fix de geometría).
- **E2E**: `fase3-material-scale` hit-test de la pértiga (se selecciona por el CUERPO, no por el
  hueco vacío: el antiguo punto de selección con el floor de ~44 px ahora NO selecciona), `p78`
  (arrastrar un cono a la papelera con la tolerancia estricta), `d1-gesture-machine` (pinch por
  orientación/modo), `p2-placement`, `pizarra-usabilidad-colocacion-continua` (colocación continua
  y pan/select en varios viewports).

## Verificación
- `npm run test:unit` → **388** (render.spec 96).
- `test:e2e:dev -- --workers=1` → **622/622** (exit 0) con el cableado de D1.
- Subconjunto de selección → **76/76** (exit 0).

**D1 completo.** Queda pendiente el resto del encargo (B1 wiring + hueco de modelo, C1-complete,
C2, A8).
