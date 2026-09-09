// =============================================================
// CDMPLab — Copia la galería de usabilidad de la pizarra a
// `docs/screenshots/pizarra-usabilidad/` y genera:
//   · INDICE.md      (título + explicación de cada captura)
//   · contact-sheet.html  (hoja de contacto con cada imagen + pie)
// =============================================================
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'e2e/shots/pizarra-usabilidad';
const DOC = 'docs/screenshots/pizarra-usabilidad';
fs.mkdirSync(DOC, { recursive: true });

const CAPTIONS = [
  ['formacion-sin-plantilla-433-propia.png', 'Formación 4-3-3 propia aplicada con plantilla VACÍA: 11 jugadores genéricos (portero + 10) sin nombres, con el color propio del equipo.'],
  ['formaciones-genericas-propio-rival.png', 'Formaciones genéricas propias (4-3-3) y rivales (4-4-2) coexistiendo: 11 propios + 11 rivales, sin nombres.'],
  ['panel-material-barra-visible-390x844.png', 'Panel Material en 390×844: termina justo antes de la barra inferior, que permanece visible y operable.'],
  ['panel-dibujo-barra-visible-844x390.png', 'Panel Dibujo en 844×390 (paisaje): el panel no invade la barra inferior y las herramientas siguen accesibles.'],
  ['material-maniqui-colocacion-continua.png', 'Colocación continua de material: tres maniquíes colocados sin reabrir el panel; la herramienta sigue activa.'],
  ['preview-material-en-cursor.png', 'Previsualización del material armado junto al cursor (imagen real del maniquí, ~55 % de opacidad), fuera del documento.'],
  ['jugadores-genericos-colocacion-continua.png', 'Colocación continua de jugadores genéricos (propio/rival) sin nombres; la herramienta sigue activa.'],
  ['seleccionar-no-panea.png', 'Seleccionar: arrastrar desde zona vacía NO desplaza la vista (panX/panY sin cambios) pese al campo ampliado.'],
  ['mano-panea-campo.png', 'Desplazar campo (Mano): arrastrar desde vacío desplaza la vista; el objeto bajo el puntero no se selecciona ni se mueve.'],
  ['zigzag-compacto-horizontal-vertical-diagonal.png', 'Zigzag compacto (frecuencia x2, amplitud reducida) en horizontal, vertical y diagonal, con la punta orientada al último tramo.'],
];

const copied = [];
for (const [name] of CAPTIONS) {
  const src = path.join(SRC, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DOC, name));
    copied.push(name);
  }
}

// ---- Índice Markdown ----
const md = `# Galería — Usabilidad de la pizarra (CDMPLab)

Capturas generadas por interacción real (Playwright) y copiadas a
\`docs/screenshots/pizarra-usabilidad/\`. Ninguna imagen escribe el documento
directamente: todo se coloca, dibuja, rota o panea desde la UI real.

| Captura | Qué muestra |
|---|---|
${CAPTIONS.map(([name, desc]) => `| \`${name}\` | ${desc} |`).join('\n')}
`;
fs.writeFileSync(path.join(DOC, 'INDICE.md'), md);

// ---- Hoja de contacto HTML ----
const rows = CAPTIONS.map(
  ([name, desc]) => `<figure class="shot">
  <img src="${name}" alt="${desc}" loading="lazy">
  <figcaption><strong>${name}</strong> — ${desc}</figcaption>
</figure>`
).join('\n');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Galería — Usabilidad de la pizarra (CDMPLab)</title>
<style>
  body { font-family: system-ui, sans-serif; background: #10151a; color: #e8edf2; margin: 0; padding: 24px; }
  h1 { font-size: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  figure.shot { margin: 0; background: #171d23; border: 1px solid #262e35; border-radius: 8px; overflow: hidden; }
  figure.shot img { width: 100%; display: block; }
  figcaption { padding: 8px 10px; font-size: 12px; line-height: 1.4; }
  figcaption strong { display: block; margin-bottom: 4px; color: #fff; }
</style>
</head>
<body>
<h1>Galería — Usabilidad de la pizarra (CDMPLab)</h1>
<p>Capturas de la revisión de usabilidad (formaciones sin plantilla, colocación continua,
preview junto al cursor, paneles sin tapar la barra, seleccionar/desplazar y zigzag).</p>
<div class="grid">${rows}</div>
</body>
</html>`;
fs.writeFileSync(path.join(DOC, 'contact-sheet.html'), html);

console.log('[galeria] copiadas ' + copied.length + ' capturas a ' + DOC);
