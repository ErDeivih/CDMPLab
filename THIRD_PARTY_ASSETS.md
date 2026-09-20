# Third-party assets (CDMPLab)

Este repositorio es un **proyecto personal** del dueño. Los recursos de terceros que usa
se enumeran aquí; **no se reivindican licencias que no se conozcan** y **no se autoriza**
su reutilización por terceros salvo lo indicado explícitamente. La columna **Acción**
indica qué hacer antes de una redistribución pública.

## Inventario de assets como están versionados

### PNG tácticos (material de la pizarra)

Ruta: `public/assets/tactical/*.png` (22 PNG). Referenciados desde
`src/app/core/tactic-assets.ts` y usados en tiempo de ejecución por el render SVG.

| Ruta                                                             | Descripción                | Origen conocido                                                        | Licencia             | Acción                                                                |
| ---------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------- |
| `public/assets/tactical/ball.png`                                | Balón de fútbol            | Del dueño; procede de una referencia de PowerPoint (ver manifiesto).   | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/ball-purple.png`                         | Balón (morado)             | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/cone-{red,yellow,blue,orange,white}.png` | Conos (5 colores)          | Desconocida/informal (posiblemente app de pizarra usada por el dueño). | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/cone-blue-2.png`                         | Cono (azul 2)              | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/disc.png`                                | Disco / marcador           | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/flag.png`                                | Banderín                   | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/hurdle.png`                              | Valla                      | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/ladder.png` / `ladder-yellow.png`        | Escalera (gris / amarilla) | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/mannequin.png` / `mannequin-row.png`     | Maniquí / maniquí en fila  | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/minigoal.png`                            | Miniportería               | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/net.png`                                 | Red / valla                | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/pole.png`                                | Pértiga                    | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/ring.png` / `ring-flat.png`              | Aro / aro plano            | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/target.png`                              | Diana                      | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |
| `public/assets/tactical/trampoline.png`                          | Minitrampolín              | Desconocida/informal.                                                  | Sin licencia formal. | **No apto** para redistribución pública hasta verificar o reemplazar. |

**Conclusión:** los PNG tácticos tienen **origen desconocido/informal** y el dueño los
aprobó **solo para este proyecto personal**. Antes de cualquier **redistribución pública**
hay que **verificar permisos o sustituirlos** por recursos propios (o material con licencia
permitida). No se les atribuye licencia que no se conozca.

### SVG vectoriales ORIGINALES del proyecto (B2)

Estos dibujos son **originales del proyecto CDMPLab**, creados a mano (código SVG) para
sustituir los PNG de origen desconocido/informal de la pizarra. No proceden de ninguna
aplicación de terceros ni de fotografías entregadas; **no hay marca de agua, logo ni fondo
blanco**. Se definen en `src/app/core/material-registry.ts` (`chinoSvg`, `dumbbellSvg`,
`hurdleSvg`) y se usan como miniatura vectorial del panel.

| Función           | Descripción                                       | Origen                                                                                                        | Licencia             |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| `dumbbellSvg()`   | Mancuerna / pesa                                  | Original del proyecto (SVG a mano).                                                                           | Propiedad del dueño. |
| `hurdleSvg()`     | Valla de entrenamiento                            | Original del proyecto (SVG a mano).                                                                           | Propiedad del dueño. |
| `chinoSvg(color)` | Disco plano (Chino), **recoloreable** (6 colores) | Original del proyecto (SVG a mano). Un único SVG admite múltiples colores; no se crean imágenes rasterizadas. | Propiedad del dueño. |

**Cambio de representación (B2):** la **miniatura** del panel de estos materiales ya usa el
SVG original en lugar de un icono genérico de Material Symbols, y **no** incorpora las
fotografías entregadas (que llevaban marca de agua/fondo). El render en el campo de
`target`/Chino y `hurdle`/Valla todavía usa su PNG previo (`target.png`/`hurdle.png`), que
sigue siendo de origen desconocido — queda anotado abajo.

### Imagen de marca (escudo del club)

| Ruta                                                                                    | Descripción                                                                                                                                                | Origen conocido                              | Licencia                                   | Acción                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/assets/brand/cdm-pizarrales-original.jpg`                                          | Escudo original completo del club "CDM Pizarrales". FUENTE del recurso de marca: ya NO se usa directamente en pantalla (servía con fondo blanco cuadrado). | Propiedad del club (el dueño).               | Sin licencia de terceros; marca del dueño. | Archivo original proporcionado por el dueño; no se recorta ni se redibuja a mano. No reutilizable por terceros.                                            |
| `src/assets/brand/cdm-pizarrales-escudo.png`                                            | Escudo servido en pantalla (shell, menú de cuenta, login y pizarra), 512×512, EXTERIOR TRANSPARENTE y margen del 4 %.                                      | Derivado del original anterior (mismo arte). | Sin licencia de terceros; marca del dueño. | FASE 8A: se genera con `GENERAR_ESCUDO=1 npx playwright test e2e/marca-escudo.spec.ts` (recorte circular medido sobre el original, sin retocar el dibujo). |
| `public/favicon-32x32.png`, `public/favicon-192x192.png`, `public/apple-touch-icon.png` | Iconos de pestaña y de iOS, con el mismo recorte transparente.                                                                                             | Derivados del escudo anterior.               | Sin licencia de terceros; marca del dueño. | Se regeneran con el mismo comando de FASE 8A.                                                                                                              |

### Fuentes (autoalojadas, sin Google Fonts en runtime)

| Ruta                                                   | Descripción                           | Origen / licencia                                 | Licencia    | Acción                                                                  |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `src/assets/fonts/material-symbols-outlined.woff2`     | Iconografía de línea Material Symbols | Google · Material Symbols (Apache License 2.0).   | Apache-2.0  | Distribuible con atribución; ver `LICENSE-MaterialSymbolsOutlined.txt`. |
| `src/assets/fonts/inter-latin.woff2`                   | Fuente tipográfica Inter (UI)         | Google Fonts / Inter (SIL Open Font License 1.1). | SIL OFL 1.1 | Distribuible con atribución; ver `OFL-Inter.txt`.                       |
| `src/assets/fonts/LICENSE-MaterialSymbolsOutlined.txt` | Texto de licencia Material Symbols    | Google · Material Symbols.                        | Apache-2.0  | Conservado junto al `woff2`.                                            |
| `src/assets/fonts/OFL-Inter.txt`                       | Texto de licencia Inter               | Google Fonts / Inter.                             | SIL OFL 1.1 | Conservado junto al `woff2`.                                            |

### Favicon / iconos de la app

| Ruta                          | Descripción           | Origen conocido                             | Licencia                  | Acción                       |
| ----------------------------- | --------------------- | ------------------------------------------- | ------------------------- | ---------------------------- |
| `public/favicon.ico`          | Favicon               | Propiedad del dueño (marca CDM Pizarrales). | Sin licencia de terceros. | Uso autorizado por el dueño. |
| `public/favicon-32x32.png`    | Favicon 32×32         | Propiedad del dueño.                        | Sin licencia de terceros. | Uso autorizado por el dueño. |
| `public/favicon-192x192.png`  | Favicon 192×192 (PWA) | Propiedad del dueño.                        | Sin licencia de terceros. | Uso autorizado por el dueño. |
| `public/apple-touch-icon.png` | Icono Apple touch     | Propiedad del dueño.                        | Sin licencia de terceros. | Uso autorizado por el dueño. |

## Qué NO está en el repositorio (verificado)

- **Ninguna** Secret Key ni Service Role de Supabase (verificado en el escaneo final; solo la
  clave **publishable/anon**, que es pública por diseño, está en `environment.prod.ts`).
- **Ningún** correo real de prueba versionado (los E2E opt-in los leen de variables de
  entorno ignoradas por git).
- **Ningún** archivo temporal/log de build versionado (`*.log`, `dist/`, `node_modules/`,
  `e2e/shots/` están en `.gitignore`).

## Nota

- No se han añadido ni modificado licencias de terceros a ciegas.
- Ningún asset se ha borrado ni sustituido en esta auditoría: solo se ha inventariado.
- Cualquier PNG cuya procedencia sea Bcoach u otra app similar **no** debe distribuirse
  públicamente mientras no se tenga autorización; el dueño lo ha aprobado **solo para este
  proyecto personal**.
