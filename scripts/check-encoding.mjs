// Comprobación de codificación del árbol (utilidad permanente).
//
// Detecta los dos síntomas de un fichero de texto estropeado por herramientas que no respetan UTF-8:
//  1. U+FFFD (carácter de reemplazo): bytes que no se pudieron decodificar.
//  2. Secuencias de mojibake tipicas de UTF-8 leido como Latin-1/Windows-1252
//     ("\u00c3\u00a1" en vez de "a con tilde", "\u00e2\u0080\u0094" en vez de raya larga...).
//
// Uso:  node scripts/check-encoding.mjs [carpeta ...]
// Sale con codigo 1 si encuentra algo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const raices = process.argv.slice(2);
const carpetas = raices.length ? raices : ['src', 'e2e', 'docs', 'scripts'];
const extensiones = new Set(['.ts', '.html', '.scss', '.css', '.md', '.json', '.mjs', '.sql']);

const MOJIBAKE = /(\u00c3[\u0080-\u00bf]|\u00e2\u0080|\u00c2[\u00a0-\u00bf]|\ufffd)/g;

let ficheros = 0;
const problemas = [];

function recorrer(dir) {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === 'dist' || entrada.startsWith('.')) continue;
    const ruta = join(dir, entrada);
    const st = statSync(ruta);
    if (st.isDirectory()) {
      recorrer(ruta);
      continue;
    }
    if (!extensiones.has(extname(entrada))) continue;
    if (entrada.endsWith('.corrupto.bak')) continue;
    ficheros++;
    const texto = readFileSync(ruta, 'utf8');
    const marcas = [...texto.matchAll(MOJIBAKE)];
    if (marcas.length) {
      const muestra = marcas[0];
      const linea = texto.slice(0, muestra.index).split('\n').length;
      problemas.push({ ruta, cuantos: marcas.length, linea });
    }
  }
}

for (const c of carpetas) {
  try {
    if (statSync(c).isDirectory()) recorrer(c);
  } catch {
    console.log(`(no existe: ${c})`);
  }
}

console.log(`Codificacion: ${ficheros} ficheros revisados`);
if (problemas.length === 0) {
  console.log('Codificacion OK (sin U+FFFD ni mojibake).');
} else {
  console.log(`FICHEROS SOSPECHOSOS: ${problemas.length}`);
  for (const p of problemas.slice(0, 40)) {
    console.log(`  ${p.ruta}: ${p.cuantos} marca(s), primera en la linea ${p.linea}`);
  }
  process.exitCode = 1;
}
