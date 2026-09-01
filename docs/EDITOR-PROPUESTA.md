# Propuesta — Editor visual de ejercicios y jugadas (EntrenoLab)

> Análisis de la implementación **existente** frente al documento de requisitos, para
> decidir qué reutilizar, qué cambiar de modelo y qué riesgos hay. **Antes de programar.**

## 0. Estado actual (ya construido y probado)

- Pizarra táctica **a pantalla completa** (SVG escalable), raíl de herramientas a la izquierda,
  panel derecho (campo + plantilla, **ocultable** con el botón de la barra superior).
- **Campo**: 7 tipos (`full`, `half`, `vertical_half`, `third`, `box`, `futsal`, `blank`),
  franjas de césped, líneas blancas, marcas de punto, rejilla de zonas 3×3 opcional.
- **Objetos**: jugador propio/rival, balón, cono, maniquí, mini portería (con red), pértiga/post,
  marcador, rectángulo, **flecha**, **conducción (zigzag)**, línea, zona, texto.
- **Edición**: mover (arrastrar), **redimensionar** (ancho/alto/tamaño) y **rotar**
  (grados + manija de arrastre), **duplicar** y **eliminar**, inspector contextual.
- **Animación**: fotogramas (añadir/duplicar/eliminar, duración por frame), **reproducir
  con interpolación lineal**, **export GIF** y **export PNG**.
- **Biblioteca** (categorías, carpetas, buscador, autoguardado “borrador recuperado”),
  **Sesiones**, **diálogos de confirmación** propios.
- Verificado: `ng build` sin avisos · **19/19 unitarios** · **12/12 E2E** (Playwright).

## 1. Qué pide el documento vs. qué hay (por módulo)

> Leyenda: ✅ ya hay · ⚠️ parcial · ❌ falta

### Módulo 1 — Interfaz del editor
| Requisito | Estado | Reutilizar / Cambio |
|---|---|---|
| Canvas escalable a pantalla completa | ✅ | `renderBoardSvg`/`fieldSvg` |
| Selector de tipo de campo | ✅ | chips del panel |
| Campo completo / medio / fútbol sala / sin líneas | ✅ (7 tipos) | — |
| **Orientación H/V como propiedad** | ❌ (hoy `vertical_half` es un tipo, no orientación) | añadir `orientation` al canvas |
| **Color de césped y de líneas configurables** | ⚠️ textura fija | añadir `backgroundColor`/`lineColor`/`grass` |
| Ocultar panel lateral | ✅ | toggle existente |

### Módulo 2 — Jugadores
| Requisito | Estado | Reutilizar / Cambio |
|---|---|---|
| Local / visitante | ✅ (`side: own/rival`) | — |
| **Portero / neutral** | ❌ | añadir `type: 'player'|'goalkeeper'|'neutral'` |
| Nº y nombre opcionales | ✅ | inspector |
| Color de equipo | ✅ | paleta |
| **Bandeja inferior con arrastre al campo** | ⚠️ hoy es clic desde panel | bandeja + drag&drop |
| Duplicar / eliminar / cambiar equipo | ⚠️ duplicar/eliminar sí, cambiar equipo no | — |
| Guardar alineaciones reutilizables | ❌ | nuevo (formaciones/plantillas) |

### Módulo 3 — Biblioteca de material
| Requisito | Estado | Reutilizar / Cambio |
|---|---|---|
| Conos, picas, maniquíes, balones, miniporterías | ✅ | ya renderizados |
| **Vallas, aros, escaleras** | ❌ | nuevos tipos + SVG |
| **Paleta/biblioteca visual** | ⚠️ hoy es raíl de herramientas | panel “Material” reutilizando el inspector |
| Mover/rotar/escalar/duplicar/eliminar | ✅ | — |
| **Selección múltiple**, **copiar/pegar**, **bloquear**, **capas** | ❌ | nuevo |

### Módulo 4 — Inspector contextual
| Requisito | Estado |
|---|---|
| Color, tamaño, rotación, estilo, nº/nombre, duplicar/eliminar | ✅ |
| **Opacidad, grosor de línea, tipo de trazo** | ❌ |
| **Bloquear objeto**, **capas** | ❌ |
| **Undo/redo**, **selección múltiple**, **Supr** | ❌ |
| No tapar el objeto + cambios en vivo | ✅ (panel a la derecha, signals) |

### Módulo 5 — Línea de tiempo y animación
| Requisito | Estado |
|---|---|
| Añadir/duplicar/eliminar fotogramas | ✅ |
| **Reordenar fotogramas (drag)** | ❌ |
| Duración por frame → **por transición** | ⚠️ |
| Reproducir/pausar/reiniciar + interpolación lineal | ✅ |
| **Velocidad de reproducción**, **bucle**, **mostrar trayectoria** | ❌ |
| No modificar el estado editable al reproducir | ✅ (editor bloq. al reproducir) |

### Módulo 6 — Exportación
| Requisito | Estado |
|---|---|
| PNG estático | ✅ (botón directo) |
| GIF animado | ✅ (botón directo) |
| **Diálogo con preview + nombre + formato + orientación + calidad/resolución + velocidad + fondo** | ❌ |
| **Indicador de progreso + cancelar** | ❌ |
| MP4 / WebM | ❌ (fase futura; GIF+PNG “de momento” según decisión previa) |

## 2. Cambios de modelo propuestos (con compatibilidad)

Añadir **campos opcionales** a `CanvasElement` y `CanvasDocument` (retrocompatible, con
valores por defecto al cargar):

```ts
// CanvasElement (nuevos, todos opcionales)
opacity?: number;        // 0..1, por defecto 1
strokeWidth?: number;    // grosor de línea
lineStyle?: 'solid'|'dashed'|'dotted';
type?: 'player'|'goalkeeper'|'neutral';
teamId?: string;         // local/visitante/neutral
locked?: boolean;
zIndex?: number;         // capas
scaleX?: number;         // ya hay size; se unifica
```

```ts
// CanvasDocument (nuevos, opcionales + defaults)
schemaVersion: 3;        // versión semántica (se preserva la carga de versiones previas)
orientation?: 'horizontal'|'vertical';
backgroundColor?: string;   // hex césped
lineColor?: string;         // hex líneas
grass?: 'stripes'|'plain'|'checker';
```

- Elemento **con id persistente** (ya existe) → la animación relaciona estados entre frames.
- El cambio de campo **no borra** jugadores/material/dibujos (ya se conserva; se mantiene).
- Coordenadas **normalizadas 0..1** (ya); el zoom/pan será transformación de **vista**, no de datos.

## 3. Riesgos de compatibilidad

1. **`canvas_data` v2 (frames[])**: los ejercicios/biblioteca y tests ya usan este formato.
   Los campos nuevos son opcionales → la carga de documentos antiguos debe seguir funcionando
   (defaults al leer). Se añade `schemaVersion` y un **migrator** al vuelo.
2. **Tests existentes**: `render.spec` espera `viewBox="0 0 100 80"` y elementos básicos;
   añadir objetos/campos no debe romperlos (se correrá el gate completo tras cada fase).
3. **Undo congestión**: no registrar cada píxel de arrastre — una **transacción por gesto**
   (comenzar/confirmar al soltar). Igual para rotación/escalado.
4. **Zoom/pan vs. normalización**: el pan/zoom se aplica como transform del contenedor (no a los
   datos), para que los elementos sigan en 0..1 y el export sea consistente.
5. **Tamaño de `board.component.ts`** (~600 líneas): al añadir undo/multiselección/capas/zoom
   conviene **extraer** estado → `CanvasState` (service/facade) y un `HistoryService`.
6. No tocar la app Flutter `ClubManager` ni el esquema Supabase (se queda en local).

## 4. Plan por fases (mapeado a lo que ya hay)

- **Fase 1 — Editor estático** (mucho hecho): reforzar → **orientación, color de césped/líneas**,
  material nuevo (vallas/aros/escaleras), **opacidad/grosor/trazo**, **bloquear**, **capas**,
  **undo/redo**, **selección múltiple**, **supr**. Base: extraer `CanvasState` + `HistoryService`.
- **Fase 2 — Herramientas tácticas** (casi todo hecho): falta **flecha/curva**, y **formaciones
  y plantillas reutilizables** (guardar/cargar alineación).
- **Fase 3 — Animación**: falta **reordenar frames**, **velocidad**, **bucle**,
  **trayectoria/dirección** y duración por transición.
- **Fase 4 — Exportación avanzada**: falta el **diálogo de exportación** (preview, nombre,
  formato, orientación, calidad/resolución, velocidad, fondo, progreso, cancelar). GIF ya;
  MP4/WebM **más adelante** (recomendado diferir).

## 5. Prioridades y decisiones a confirmar

Mi recomendación de orden (porque lo transversal sostiene todo lo demás):

1. **Base transversal**: `CanvasState`/`HistoryService` (undo/redo + transacciones), `schemaVersion`
   + migrador, **selección múltiple**, **supr**, **copiar/pegar/duplicar**, **capas**, **bloquear**.
2. **Campo**: orientación + color de césped/líneas + panel "Material" con la biblioteca visual.
3. **Inspector ampliado**: opacidad, grosor, trazo, type (portero/neutral), tamaño.
4. **Animación**: reordenar frames, velocidad, bucle, trayectoria.
5. **Export**: diálogo con opciones + progreso/cancelar. (MP4/WebM: diferir.)

Preguntas para ti:

1. ¿Empiezo por la **base transversal** (undo/redo, selección múltiple, capas, atajos) o por un
   módulo concreto (p. ej. campo/orientación/colores) que veas antes?
2. En **exportación**, ¿incluyo ya **MP4/WebM** o lo dejo para después y entrego primero el
   **diálogo PNG/GIF** con progreso? (Recomiendo esto último.)
3. La **bandeja de jugadores** ¿la quieres **abajo** (como la captura) o vale el panel derecho
   actual? (Recomiendo bandeja inferior para no tapar el campo.)
