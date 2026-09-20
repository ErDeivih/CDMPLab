# Evidencia visual — fase UX final

Generadas por `e2e/fase-ux-capturas.spec.ts` (solo con `CAPTURAS_UX=1`). Carpeta NUEVA: no se ha
tocado ninguna galería anterior del repositorio.

| Fichero | Qué muestra | Objetos colocados |
| --- | --- | --- |
| `escritorio-pizarra-completa.png` | Pizarra en escritorio con objetos reales colocados | 6 |
| `escritorio-jugadores-colores.png` | Panel de Jugadores con la paleta por ejercicio abierta | — |
| `escritorio-materiales.png` | Panel de Material con el catálogo | — |
| `escritorio-chino-porteria.png` | Campo con el Chino nuevo y la Portería grande frontal | 2 |
| `escritorio-biblioteca-miniaturas.png` | Biblioteca con las tarjetas y sus miniaturas | — |
| `escritorio-plantilla.png` | Plantilla en escritorio | — |
| `escudo-fondo-claro.png` | Escudo transparente sobre fondo claro | — |
| `escudo-fondo-oscuro.png` | Escudo transparente sobre fondo oscuro | — |
| `movil-horizontal-pizarra.png` | Pizarra en móvil horizontal con objetos | 6 |
| `movil-horizontal-panel-jugadores.png` | Panel de Jugadores en móvil horizontal | — |
| `movil-horizontal-panel-material.png` | Panel de Material en móvil horizontal | — |
| `movil-vertical-pizarra.png` | Pizarra en móvil vertical con objetos | 6 |
| `movil-vertical-panel.png` | Material como hoja inferior en móvil vertical | — |
| `movil-vertical-plantilla.png` | Plantilla compacta en móvil vertical | — |
| `movil-vertical-plantilla-drawer.png` | Drawer «Más» entrando por la izquierda | — |
| `movil-vertical-biblioteca-dos-columnas.png` | Biblioteca a dos columnas en móvil | — |
| `ejercicio-exportado.png` | PNG exportado por la app (campo con objetos) | — |
| `contact-sheet.png` | Hoja de contacto con todas las capturas | — |

## Estado de las fases reflejadas

- Miniatura autocontenida (FASE 1), colores de jugador por ejercicio (FASE 2), Plantilla compacta y
  drawer «Más» (FASE 6), biblioteca a dos columnas (FASE 7), escudo transparente y Chino/Portería
  nuevos (FASE 8A/8B/8C), pizarra móvil sin navegación global (FASE 4) y grupo flotante
  «Herramientas» SIN barra inferior (FASE 3) están implementados: en las capturas de la pizarra el
  fondo ya NO tiene barra y el campo llega al borde inferior; las categorías viven en el menú del
  botón «Herramientas».
- Los paneles móviles (FASE 5) terminan justo ENCIMA del grupo flotante: su franja inferior está
  reservada (`--reserva-grupo-herramientas`) para que el grupo, que va por encima del panel para
  seguir operable, no intercepte las últimas filas del catálogo ni de la plantilla.
