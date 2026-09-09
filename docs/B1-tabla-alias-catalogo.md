# B1 — Tabla de alias del catálogo antiguo → catálogo canónico (CDMPLab)

Fuente: `src/app/core/material-registry.ts` (`CANONICAL_MATERIALS`, `MATERIAL_ALIAS`,
`visibleMaterials`, `isRetiredMaterial`). Los **ids de elemento (`t`/assetKind) NO cambian**
(un documento antiguo sigue abriendo y renderizándose); solo cambia la **presentación**
(nombre visible en el catálogo nuevo).

| Id antiguo (modelo) | Nombre antiguo (panel) | Nombre canónico nuevo | ¿Visible? |
|---|---|---|---|
| `ball` | Balón | Balón | ✅ |
| `vball` | Balón morado | Fitball | ✅ |
| `cone` | Cono | Cono | ✅ |
| `target` | Diana | **Chino** (disco plano, recoloreable) | ✅ |
| `flag` | Banderín | Banderín | ✅ |
| `pica` | Pica coloreable | Pica coloreable | ✅ |
| `pole` | Pértiga | Pértiga / poste | ✅ |
| `mannequin` | Maniquí | Maniquí individual | ✅ |
| `mannequin_row` | — | Barrera de maniquíes | ✅ |
| `minigoal` | Mini portería | Miniportería | ✅ |
| `ladder` | Escalera | Portería grande | ✅ |
| `hurdle` | Valla | Valla | ✅ |
| `ring` | Aro | Aro (rosa inicial, recoloreable) | ✅ |
| `ladder_yellow` | — | Escalera | ✅ |
| `trampoline` | Minitrampolín | Minitrampolín | ✅ |
| `peto` | Peto | Peto | ✅ |
| `chaleco` | Chaleco lastrado | Chaleco lastrado | ✅ |
| `marker` | Marcador | **BOSU** | ✅ |
| `dumbbell` | — | Mancuerna / pesa | ✅ |

### Ocultos (compatibilidad: el documento sigue abriendo, no se muestran en la UI)

| Id (modelo) | Nombre | Motivo |
|---|---|---|
| `fitball` | Fitball (naranja) | duplicado de `vball`→Fitball |
| `coachC` | Marcador C | retirado |
| `net` | Red | retirado |
| `ring_flat` | Aro plano (naranja) | duplicado de `ring` |
| `bosu` | BOSU | duplicado de `marker`→BOSU |

### Verificación unitaria (Bloque F #10)
`npm run test:unit` → el spec `material-registry.spec.ts` comprueba que el **catálogo visible NO
contiene** nombres retirados (Marcador C, Diana, Red, Aro plano, Marcador) y **contiene** el
catálogo final (incl. "Mancuerna / pesa").

### Hallazgo (fase de datos) — catálogo y modelo divergen [RESUELTO en la capa de datos]

Se detectó que el catálogo listaba ítems que **no** eran tipos de elemento colocables:

- El elemento escalera real es `ladder` (se dibuja con travesaños) pero `canonicalTitle('ladder')`
  lo presentaba como "Portería grande"; `ladder_yellow` y `mannequin_row` no eran tipos válidos
  (`ELEMENT_TYPES`); y no existía ningún tipo de "Portería grande".

**Arreglado (aditivo, capa de datos/render):**
- Añadidos los tipos de elemento **`goal`** (Portería grande) y **`mannequin_row`** (Barrera de
  maniquíes) a `models.ts` (`ElementType`/`ELEMENT_TYPES`), a `tactic-assets.ts` (tamaño/bbox/
  asset) y a `render.ts` (casos de render vectorial `case 'goal'`/`case 'mannequin_row'` +
  listas de hit-test/selección).
- Registro corregido: `ladder` → **"Escalera"**, `goal` → **"Portería grande"**,
  `mannequin_row` → **"Barrera de maniquíes"**; eliminado el id fantasma `ladder_yellow`.
- Tests: `render.spec` (goal/mannequin_row renderizan como `<g>` vectorial) y
  `material-registry.spec` (títulos canónicos + `isKnownElementType` de los nuevos tipos).

Los 19 ítems del catálogo visible ahora se corresponden con **tipos de elemento colocables**.
Queda ÚNICAMENTE el wiring de la UI (ver "Limitación" siguiente).

### Estado B1 ahora (r55)
- **Hueco de modelo: RESUELTO.** Tipos colocables `goal` (Portería grande) y `mannequin_row`
  (Barrera de maniquíes) añadidos; `ladder`→"Escalera"; fantasma `ladder_yellow` eliminado.
- **Nuevos tipos cableados en la UI:** aparecen en el panel de Material, se colocan y se
  renderizan como `<g>` vectorial (con miniatura real). Se añadió `b1-catalog-placeable.spec.ts`
  y se actualizaron los specs de catálogo (`bloque-e-trazo`, `bloque-capturas-contacto`,
  `catalog-captures` incluida la cobertura/manifiesto, `fase5-material-thumbs`).
- **Pendiente (migración de nombres canónicos):** el panel aún muestra nombres antiguos para los
  ítems existentes (`Balón morado`, `Diana`, `Marcador`, `Marcador C`, `Red`, `Mini portería`,
  `Pértiga`, `Maniquí`) y aún NO oculta los retirados (`coachC`, `net`, `ring_flat`, `bosu`,
  fitball-naranja). Renombrar/hacer caching requiere actualizar ~14+ specs de catálogo (audit,
  colores, fase1-color-per-tool, etc.) y su verificación E2E conjunta.

### Limitación (migración de nombres canónicos pendiente)
El registro canónico es la fuente de verdad **a nivel de datos**, pero el **panel de Material
de la pizarra todavía usa nombres antiguos** para los ítems preexistentes y aún no oculta los
retirados. Cablear esos nombres/hiders a `visibleMaterials()`/`canonicalTitle` cambia títulos
usados por ~14+ specs de catálogo y helpers `placeMaterial` de decenas de specs; **no** se ha
hecho para no desestabilizar la suite. Evidencia: captura `catalogo-materiales-actual.png`.
