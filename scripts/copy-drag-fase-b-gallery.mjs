// =============================================================
// CDMPLab — Copia la galería del contrato táctil de FASE B a
// `docs/screenshots/drag-fase-b/` y genera:
//   · INDICE.md      (título + explicación de cada captura)
//   · contact-sheet.html  (hoja de contacto con cada imagen + pie)
// Las capturas muestran el arrastre móvil ANTES/DURANTE/DESPUÉS
// (jugador y material) y el panel abierto con la barra visible.
// =============================================================
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'e2e/shots/drag-fase-b';
const DOC = 'docs/screenshots/drag-fase-b';
fs.mkdirSync(DOC, { recursive: true });

const CAPTIONS = [
  ['jugador-antes.png', 'Jugador genérico — ANTES del arrastre: panel Jugadores abierto, barra inferior visible, campo vacío (herramienta Cursor).'],
  ['jugador-durante.png', 'Jugador genérico — DURANTE el arrastre táctil: la pista dice «Suelta en el campo para colocar…» y la preview acompaña al puntero.'],
  ['jugador-despues.png', 'Jugador genérico — DESPUÉS del drop: una sola unidad colocada, la herramienta desarmada vuelve a Cursor y el panel permanece abierto.'],
  ['cono-antes.png', 'Material (Cono) — ANTES del arrastre: panel Material abierto, barra inferior visible, campo vacío.'],
  ['cono-durante.png', 'Material (Cono) — DURANTE el arrastre táctil: pista «Suelta en el campo para colocar…» y preview junto al puntero.'],
  ['cono-despues-panel-barra.png', 'Material (Cono) — DESPUÉS del drop: una sola unidad colocada, la herramienta vuelve a Cursor, el panel sigue abierto y la barra inferior visible.'],
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
const md = `# Galería — Contrato táctil de FASE B (CDMPLab)

Capturas generadas por interacción real (Playwright, PointerEvent táctil) y copiadas a
\`docs/screenshots/drag-fase-b/\`. Muestran el arrastre móvil de una unidad desde el panel
al campo en tres momentos (antes / durante / después), tanto para un jugador genérico
como para un material (Cono).

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
<title>Galería — Contrato táctil de FASE B (CDMPLab)</title>
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
<h1>Galería — Contrato táctil de FASE B (CDMPLab)</h1>
<p>Móvil horizontal (844×390). Un arrastre táctil del panel al campo coloca exactamente UNA
unidad y desarma la herramienta (Cursor). Un toque posterior no coloca otra.</p>
<div class="grid">${rows}</div>
</body>
</html>`;
fs.writeFileSync(path.join(DOC, 'contact-sheet.html'), html);

console.log('[galeria-drag] copiadas ' + copied.length + ' capturas a ' + DOC);
