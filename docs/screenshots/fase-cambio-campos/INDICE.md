# Evidencia visual — cambio de campo, escala de materiales y siluetas

Generadas por `e2e/fase-cambio-campos.spec.ts` (solo con `CAPTURAS_CAMPOS=1`). Carpeta NUEVA: no
se ha tocado ninguna galería anterior del repositorio. La hoja de contacto compone las imágenes
incrustadas (data URL) y comprueba que NINGUNA queda rota antes de disparar.

| Fichero | Qué muestra |
| --- | --- |
| `cambio-con-objetos-antes.png` | Cuatro objetos sobre Campo completo (antes del cambio) |
| `cambio-con-objetos-despues.png` | Los MISMOS objetos tras un clic en Medio campo |
| `campo-completo.png` | Campo completo con los cuatro objetos reales colocados |
| `chino-junto-a-cono.png` | Chino (platillo) junto al cono: reconocible y más pequeño |
| `escalera-porteria-miniporteria.png` | Escalera (vista desde arriba), miniportería y portería: tres siluetas distintas |
| `f7-transversal.png` | F7 transversal con los mismos objetos |
| `futbol-sala-horizontal.png` | Fútbol sala azul en horizontal (superficie lisa y áreas claras) |
| `futbol-sala-vertical.png` | Fútbol sala azul en vertical |
| `lienzo.png` | Lienzo (sin marcas de campo) con los mismos objetos |
| `materiales-campo-completo.png` | Los ocho materiales en Campo completo (100 %, referencia) |
| `materiales-comparativa-completo-medio.png` | Comparación medida lado a lado: campo completo vs medio campo |
| `materiales-medio-campo.png` | Los mismos materiales en Medio campo: se ven ~120 % |
| `medio-campo.png` | Medio campo con los MISMOS objetos (el cambio es directo, sin diálogo) |
| `movil-cambio-campos.png` | Cambio de campo en móvil 390×844 (fútbol sala azul) |
| `movil-horizontal-campos.png` | Pizarra en móvil horizontal 844×390 |
| `porteria-vs-campo-f11.png` | Portería de material junto a la portería del campo en F11 |
| `porteria-vs-campo-f7.png` | Portería de material junto a la portería visible en F7 |
| `porteria-vs-campo-futsal.png` | Portería de material junto a la portería de fútbol sala |
| `tercio-campo.png` | Tercio de campo con los mismos objetos |
| `contact-sheet.png` | Hoja de contacto compuesta con todas las capturas |

## Estado reflejado

- El cambio de campo es DIRECTO: un clic cambia el campo y los objetos conservan ids y
  coordenadas normalizadas. El diálogo «Cambiar a medio campo» ya no existe.
- La galería ofrece SEIS campos: Campo completo, Medio campo, Tercio de campo, Fútbol sala,
  F7 transversal y Lienzo. `box` y `two_halves` siguen admitidos para documentos antiguos.
- El fútbol sala es azul LISO con las áreas de penalti en azul claro (`#1e3a8a` / `#2563eb`).
- Escala aparente medida (mismo objeto y viewport): medio campo 120 %, tercio 127 %, fútbol sala
  y F7 118 %, lienzo 100 % (documentado).
- La portería de material mide lo mismo que la portería dibujada en el campo (ratio medido
  1,000-1,002 en F11, medio, tercio, F7 y fútbol sala, horizontal y vertical).
