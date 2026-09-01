# EntrenoLab — Sistema de diseño

> Objetivo: producto profesional, **sin look de "IA generada"**: nada de degradados, nada de
> emojis, nada de tarjetas con sombras enormes ni colores chillones. Todo bordes rectos,
> tipografía limpia, una sola marca de acento usada con criterio.

## Principios

1. **Acento único.** Un solo color de marca (verde pista o azul petróleo) para acciones
   activas, selección y enlaces. El resto es neutro.
2. **Contraste real.** Texto oscuro sobre superficies claras; jerarquía por peso/tamaño,
   no por color.
3. **Bordes rectos.** Radio de esquina pequeño (2–6 px), nunca "pill" ni 999 px. Cero
   degradados.
4. **Elevación sutil.** Bordes de 1 px (hairline) + sombra mínima; no tarjetas flotantes
   con sombra grande.
5. **La pizarra es el escenario.** El campo es verde pista oscuro sobre el lienzo; la
   interfaz alrededor es clara y discreta para que la jugada destaque.
6. **Iconos consistentes.** Set de iconos de línea (Material Symbols) — nunca emojis.
7. **Sin relleno decorativo.** Nada de fondos de color en cabeceras, nada de "hero"

## Paleta

| Token | Valor | Uso |
|---|---|---|
| `bg` | `#F6F7F8` | Fondo general de la app |
| `surface` | `#FFFFFF` | Paneles, tarjetas, menús |
| `surface-2` | `#EEF0F2` | Superficie elevada/alterna, inputs |
| `border` | `#D8DBDE` | Bordes de 1px |
| `text` | `#17191C` | Texto principal |
| `text-muted` | `#6B7076` | Texto secundario |
| `accent` | `#1F7A4D` (verde pista) | Acción activa, selección, foco |
| `accent-hover` | `#176139` | Hover sobre acento |
| `danger` | `#C0392B` | Borrar/errores |
| `pitch` | `#2E7D45` | Fondo del campo en la pizarra |
| `pitch-line` | `#FFFFFF` | Líneas del campo |

Normalizadas como variables CSS (`.es-*`). En Angular, un único archivo
`styles/_tokens.scss` como fuente de verdad.

## Tipografía

- Familia: `"Inter", "Segoe UI", system-ui, sans-serif` (con fallback de sistema; no
  cargar fuente remota en la primera versión).
- Escala: 12 / 13 / 14 / 16 / 20 / 28 px. La base es 14 px.
- Dorsales y números de jugador: figuras tabulares (`font-variant-numeric: tabular-nums`),
  en negrita.
- Jerarquía por peso (400 / 500 / 600 / 700), no por color.

## Componentes base (a implementar como tokens, no librerías)

- **Botón primario**: relleno `accent`, texto blanco, radio 4 px, hover `accent-hover`.
- **Botón secundario**: fondo `surface`, borde 1px `border`, texto `text`.
- **Input**: fondo `surface-2`, borde 1px `border`, radio 4 px, foco borde `accent`.
- **Tarjeta**: fondo `surface`, borde 1px `border`, radio 6 px, sin sombra.
- **Chip/filtro**: píldora con borde; activo = relleno `accent`, texto blanco.
- **Breadcrumb / tabs**: texto con subrayado o píldora; el activo marcado por `accent`.
- **Bandeja de jugador (ficha)**: círculo del color del jugador, dorsal en blanco centrado,
  borde `surface` de 2 px. Sombra mínima.
- **Timeline de frames**: fila de miniaturas, la actual marcada con borde `accent`.
- **Toolbar de pizarra**: columna con botones de icono línea; activo = fondo `accent` suave.

## La pizarra (TacticalBoard)

- Fondo: `pitch` con el campo dibujado en `pitch-line` (blanco), grosor ~2 px.
- "Herramientas" a la izquierda (columna central de la referencia), en una barra vertical:
  Seleccionar, Jugador propio, Jugador rival, Balón, Cono, Flecha (movimiento), Flecha
  (pase), Línea, Zona, Texto, Borrar.
- Elementos seleccionables: marco con 4 esquinas (redimensionar) + círculo superior
  (rotar). Al seleccionar, barra flotante con duplicar / eliminar.
- Barra inferior: línea de tiempo de frames + reproducir / pausa / reiniciar.
- La barra lateral derecha puede contener el inspector de elemento seleccionado
  (dorsal, color, etiqueta, tamaño) y, si no hay selección, el panel de formato de campo
  y la lista de jugadores de la plantilla para "soltar" en el campo.

## Reglas duras de estilo

- Prohibido `linear-gradient` / `radial-gradient`.
- Prohibido emojis en la UI (solo iconos de línea).
- Radio de esquina máximo **6 px** (excepción: fichas de jugador son círculos, y chips
  de filtro son píldoras).
- Prohibido color de fondo en la barra superior (navbar) distinto al neutro.
- Estados de carga/error/vacío siempre con texto claro + acción de reintentar.
