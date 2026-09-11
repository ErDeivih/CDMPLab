# CDMPLab — Sistema de diseño

> Objetivo: producto profesional, **sin look de "IA generada"**: nada de degradados
> decorativos, nada de emojis, nada de tarjetas con sombras enormes ni colores chillones.
> Todo bordes rectos, tipografía limpia, una sola marca de acento usada con criterio.
>
> **Alineado con el código** (lotes A–D, 2026-09-10). Donde antes este documento describía
> una intención que el producto ya no cumple, se ha corregido para describir **lo que hay**;
> lo que sigue siendo intención se marca como tal.

## Principios

1. **Acento único.** Un solo color de marca para acciones activas, selección y foco: el
   **rojo del club** (`--accent: #c8102e`, con nota de contraste en los tokens). El verde
   es del **campo**, no de la marca (antes este documento decía «verde pista»).
2. **Contraste real.** Texto oscuro sobre superficies claras; jerarquía por peso/tamaño, no
   por color. El mínimo se comprueba donde importa: sobre el césped, los trazos por defecto
   son blancos (~4,7:1) y no casi negros (~3,1:1).
3. **Bordes rectos.** Radio de esquina pequeño (4–6 px). **Excepciones vigentes**: fichas de
   jugador y muestras de color (círculos), chips de filtro e insignias de estado (píldoras).
4. **Elevación sutil.** Bordes de 1 px (hairline) + sombra mínima; no tarjetas flotantes con
   sombra grande.
5. **La pizarra es el escenario.** El césped es verde y las marcas del campo, blancas; la
   interfaz alrededor es clara y discreta para que la jugada destaque.
6. **Iconos consistentes.** Set de línea (Material Symbols **autoalojado**) — nunca emojis.
7. **Sin relleno decorativo.** Nada de fondos de color en cabeceras, nada de «hero».

## Paleta (valores REALES de `styles/_tokens.scss`)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#f5f6f7` | Fondo general de la app |
| `--surface` | `#ffffff` | Paneles, tarjetas, menús |
| `--surface-2` | `#eceeef` | Superficie alterna, inputs |
| `--border` / `--border-strong` | `#d7dadd` / `#b9bdc1` | Bordes de 1 px |
| `--text` / `--text-muted` / `--text-faint` | `#17191c` / `#6b7076` / `#9aa0a6` | Jerarquía de texto |
| `--accent` / `--accent-hover` / `--accent-soft` | `#c8102e` / `#9f0c22` / `#f9e7ea` | Marca (rojo CDM Pizarrales). Blanco sobre `#c8102e` ≈ 4,9:1 |
| `--danger` / `--danger-soft` | `#c0392b` / `#fbeae8` | Borrar / errores |
| `--success` / `--success-soft` | `#1f7a4d` / `#e8f3ed` | Mensajes de éxito (antes se pintaban con el rojo de peligro) |
| `--warn` / `--warn-soft` | `#a16207` / `#fdf3e3` | Avisos accionables (conflicto de edición, tarea huérfana) |
| `--pitch` / `--pitch-dark` / `--pitch-line` | `#2e7d45` / `#276c3c` / `#ffffff` | Superficies de campo de la **interfaz** |
| Radios | `--radius: 4px`, `--radius-md: 6px` | Esquinas |
| Espaciado | `--space-1..6` (4/8/12/16/24/32) | Ritmo |
| Medidas | `--sidebar-w: 232px`, `--topbar-h: 56px` | Estructura |

**Dos verdes, a propósito**: el render del campo usa su propio color oficial
(`OFFICIAL_PITCH_COLOR = #31834a`, en `core/field.ts`) con franjas, distinto del token
`--pitch` que se usa en las superficies de la interfaz (miniatura de la Biblioteca, bordes
de campo). Está pendiente decidir si se unifican (es un cambio visual).

Fuente de verdad: `src/styles/_tokens.scss` (variables CSS `--kebab-case`). **No existe**
ningún prefijo `.es-*` (este documento lo mencionaba y nunca se usó).

## Tipografía

- Inter **autoalojada** (`src/assets/fonts/inter-latin.woff2`, licencia OFL) y Material
  Symbols Outlined (Apache 2.0) — **nunca** desde un CDN remoto.
- Escala: 12 / 13 / 14 / 16 / 20 / 28 px. Base 14 px.
- Dorsales y números con figuras tabulares (`--tnum` / `.tnum`).
- Jerarquía por peso (400 / 500 / 600 / 700), no por color.

## Componentes base (los que existen hoy)

Todos ellos son **globales** en `src/styles.scss` (una sola definición; los componentes solo
añaden lo suyo):

- **Botón**: `.btn` (+ `.btn-primary`, `.btn-ghost`, `.btn-icon`, `.btn-danger`,
  `.btn-sm`, `.btn-danger-solid`). Altura 36 px; `.btn-sm` global 32 px y **28 px** en las
  tarjetas de la Biblioteca (divergencia a propósito). Cursor de mano y estado `:disabled`.
- **Campos**: `.field` (label + input/select/textarea con foco en acento) y `.field-row`
  (rejilla de dos columnas).
- **Tarjeta** `.card` · **chip** `.chip` · **etiqueta** `.tag` · **estado vacío** `.empty`.
- **Modal**: base global `.modal-backdrop` / `.modal` / `.modal-head` / `.modal-body` /
  `.modal-foot`. Cada pantalla aporta solo su **ancho** (480 Biblioteca y Sesiones, 420
  Plantilla, 640 el editor de sesión) y si su cuerpo scrollea. Ajustes sube el `z-index`;
  la confirmación (80) y el diálogo de exportar (90) van por encima.
- **Ficha de jugador**: círculo del color del jugador con dorsal centrado.
- **Barra de pizarra**: raíl con las herramientas persistentes + las categorías
  (Jugadores / Material / Dibujo) y el panel lateral correspondiente.

## La pizarra (estado actual, no intención)

- **Fondo**: césped oficial `#31834a` con franjas; la franja exterior es lisa. El render
  **ignora** el `backgroundColor`/`lineColor` del documento (los antiguos se ven con el
  césped y las marcas oficiales, sin romper el dato). Las marcas del campo son **siempre
  blancas**.
- **Herramientas del raíl**: Seleccionar y mover, Desplazar campo, y las categorías
  Jugadores / Material / Dibujo.
- **Panel de Dibujo**: Rectángulo, Círculo/elipse, Flecha (movimiento), Flecha doble
  sentido, Curva izquierda, Curva derecha, Conducción (zigzag), Línea, Dibujo a mano
  alzada, Texto y **Borrar elemento**.
- **Panel de Material**: se genera del **registro canónico** (`material-registry.ts`),
  19 materiales visibles en 6 grupos.
- **No se ofrecen**: `Zona` y `Medir`. El render los conserva para los documentos antiguos;
  `Medir` no se expone porque su etiqueta era un valor fijo (mentiría).
- **Rotación**: **no hay asa circular ni línea de conexión**. Se gira ±45° y ±90° desde el
  menú contextual (pulsación larga o doble clic), y hay Ctrl+Z/Ctrl+Y y Deshacer/Rehacer.
- **Redimensionado**: asas de esquina en rectángulo y elipse; asas en los extremos en
  línea, curva y mano alzada. Los **materiales no se redimensionan** (escala por tipo).
- **Barra inferior**: herramientas + color de dibujo (paleta de 9 colores, **blanco por
  defecto**, que es el mismo con el que el campo pinta sus marcas) + estilo de trazo
  continuo/discontinuo.
- **Sin reproductor de frames**: el modelo guarda `frames` con su duración, pero la
  interfaz **no** tiene línea de tiempo ni play/pausa (este documento lo describía: nunca
  se llegó a construir).
- **Barra de contexto**: se coloca sola encima o debajo del objeto y **envuelve en dos
  filas** en pantallas estrechas, creciendo en alto (no se sale del campo).

## Reglas duras de estilo (verificadas)

- **Degradados**: prohibidos como decoración. **Única excepción**: el degradado horizontal
  del **indicador de paneo** en los bordes del campo (`styles.scss`), que existe para
  señalar que hay campo fuera de la pantalla.
- **Sin emojis** en la interfaz (solo iconos de línea).
- **Radio máximo 6 px**, con las excepciones de círculos (fichas, muestras de color) y
  píldoras (chips, insignias de estado).
- La barra superior **no** lleva color de marca.
- Estados de carga / error / vacío siempre con texto claro y, si procede, acción.
