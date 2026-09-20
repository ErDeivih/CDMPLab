# Capturas · fase shell+móvil (despues)

Generadas por `e2e/fase-shell-capturas.spec.ts` (misma spec para el antes y el después).
Viewports del encargo: 1366×768 (escritorio), 1024×768 (tablet), 844×390 (móvil horizontal),
390×844 (móvil vertical).

| Captura | Qué muestra |
| --- | --- |
| `contact-sheet.png` | Hoja de contacto con todas las capturas de esta carpeta |
| `escritorio-biblioteca.png` | Biblioteca en escritorio (panel lateral y rejilla a pantalla completa) |
| `escritorio-cuenta-abierta.png` | Menú de cuenta abierto desde el pie de la barra lateral |
| `escritorio-pizarra-material.png` | Pizarra con el panel de Material abierto (escritorio) |
| `escritorio-pizarra-propiedades.png` | Pizarra con el panel de Propiedades abierto (escritorio) |
| `escritorio-pizarra.png` | Pizarra limpia en escritorio, SIN la franja de estado: el campo arranca pegado a la cabecera (+40 px de campo medidos; comparar con la misma captura en «antes») |
| `escritorio-plantilla.png` | Plantilla en escritorio, sin barra superior y con UNA sola navegación (la lateral) |
| `escritorio-sesiones.png` | Sesiones en escritorio |
| `login-escritorio.png` | Login en escritorio, sin cabecera ni navegación |
| `login-movil.png` | Registro en móvil, sin navegación inferior |
| `movil-horizontal-dibujo.png` | Panel de Dibujo en móvil horizontal |
| `movil-horizontal-jugadores.png` | Panel de Jugadores en móvil horizontal |
| `movil-horizontal-mas.png` | Hoja «Más» sobre la navegación inferior (móvil horizontal), con «Llenar pantalla / Ver campo completo» dentro |
| `movil-horizontal-material.png` | Panel de Material en móvil horizontal, sin tapar la navegación |
| `movil-horizontal-pizarra-limpia.png` | Pizarra limpia en móvil horizontal, sin franja de estado (+50 px de campo, un 29 % más; comparar con la misma captura en «antes») |
| `movil-horizontal-propiedades.png` | Panel de Propiedades en móvil horizontal |
| `movil-vertical-biblioteca.png` | Biblioteca en móvil vertical |
| `movil-vertical-mas.png` | Hoja «Más» en móvil vertical |
| `movil-vertical-miembros.png` | Pantalla de Miembros en móvil vertical |
| `movil-vertical-panel-minimizado.png` | Panel minimizado a pestaña: el campo vuelve a verse entero y un toque restaura el panel |
| `movil-vertical-pizarra-bottom-sheet.png` | Hoja inferior de móvil vertical (el panel ocupa el ancho, como máximo el 58 % del alto y queda anclado por encima de la navegación) |
| `movil-vertical-pizarra-material.png` | Panel de Material en móvil vertical (hoja inferior anclada sobre la navegación) |
| `movil-vertical-pizarra.png` | Pizarra en móvil vertical, sin franja de estado (+50 px de campo medidos) |
| `movil-vertical-plantilla.png` | Plantilla en móvil vertical con la navegación de 5 entradas |
| `movil-vertical-sesiones.png` | Sesiones en móvil vertical |
| `tablet-pizarra-material.png` | Pizarra con Material abierto en tablet |
| `tablet-plantilla.png` | Plantilla en tablet 1024×768 |

## Comparación antes/después de la franja de estado (altura útil del campo)

La carpeta `antes/` es el estado previo (con `.field-status`) y `despues/` el actual. Las
capturas tienen los MISMOS nombres a propósito, para poder compararlas una a una.

Altura recuperada MEDIDA (se reinsertó la franja tal cual estaba en HEAD y se midió el lienzo
antes y después de eliminarla, en la misma página; no es un cálculo):

| Vista | Con franja | Sin franja | Recuperado |
| --- | --- | --- | --- |
| Escritorio 1366×768 | lienzo 563 px | lienzo 603 px | **+40 px** |
| Móvil horizontal 844×390 | lienzo 175 px | lienzo 225 px | **+50 px** (un 29 % más de campo) |
| Móvil vertical 390×844 | lienzo 629 px | lienzo 679 px | **+50 px** |

En los tres casos el hueco entre `.studio-top` y el lienzo pasa de 50/54 px a 10/4 px (solo el
relleno del campo): ya no queda ninguna banda. La franja `.field-status` no existe en el DOM.
