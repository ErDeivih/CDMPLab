// =============================================================
// EntrenoLab — Comprobación de formato (trinquete de deuda PREVIA, calculada desde HEAD).
//
// POR QUÉ NO ES UN `prettier --check .` A SECAS:
//   El repositorio tiene `.prettierrc` desde el principio, pero nunca se aplicó: al añadir
//   esta puerta, ~200 ficheros ya existentes no cumplen el formato. Formatearlos en bloque
//   sería un cambio masivo ajeno a esta auditoría y expresamente fuera de alcance.
//
// QUÉ HACE (trinquete, no barra libre):
//   · EXENTOS = los ficheros que YA incumplían el formato en HEAD. Se calculan aquí mismo
//     leyendo su contenido de HEAD (`git show HEAD:<fichero>`), así que la lista no se queda
//     obsoleta: si un fichero se formatea, deja de estar exento solo.
//   · Todo lo demás tiene que cumplir: en particular cualquier fichero NUEVO, y cualquier
//     fichero que ya cumplía y ha dejado de cumplir.
//   · La deuda solo puede encoger, y se informa de cuánto queda.
//
// Uso:
//   node scripts/format-check.mjs              # comprueba (salida 1 si algo falla)
//   node scripts/format-check.mjs --list-debt  # solo informa de la deuda exenta
// =============================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';

const ROOT = process.cwd();

/** Directorios que no se comprueban nunca (dependencias, artefactos, informes, assets). */
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  '.angular',
  '.git',
  '.npm-cache',
  'playwright-report',
  'test-results',
  'src/assets',
]);

/** Extensiones que sí se comprueban. */
const CHECK_RE = /\.(ts|html|scss|mjs|md|json)$/;
/** Ficheros excluidos aunque casen (generados o de terceros). Las galerías de capturas y
 *  los artefactos de las pruebas son SALIDAS de los tests: no se formatean. */
const IGNORE_FILES = new Set(['package-lock.json']);
const IGNORE_PREFIXES = ['docs/screenshots/', 'e2e/shots/'];

function filesToCheck() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(rel) || IGNORE_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!CHECK_RE.test(entry.name) || IGNORE_FILES.has(rel)) continue;
      if (IGNORE_PREFIXES.some((p) => rel.startsWith(p))) continue;
      out.push(rel);
    }
  };
  walk(ROOT);
  return out.sort();
}

/** ¿Cumple el formato? Un fichero que ni se puede PARSEAR cuenta como que no cumple
 *  (antes el script se caía con una excepción en vez de informar).
 *
 *  Se comprueba con finales de línea LF porque es como los guarda git y como los ve el CI
 *  al hacer checkout: comparar la copia de trabajo (que en Windows puede tener CRLF) con el
 *  blob de git daba falsos positivos. */
async function compliance(rel, source) {
  const abs = path.join(ROOT, rel);
  try {
    const config = (await prettier.resolveConfig(abs)) ?? {};
    return await prettier.check(source.replace(/\r\n/g, '\n'), {
      ...config,
      filepath: abs,
      endOfLine: 'lf',
    });
  } catch {
    return false;
  }
}

/**
 * Referencia contra la que se mide la deuda: por defecto `HEAD`.
 *
 * IMPORTANTE (auditoría): en CI, `HEAD` es el propio commit que se acaba de subir, así que el
 * contenido «de HEAD» es idéntico al del árbol y el trinquete pasaba SIEMPRE —un fichero nuevo sin
 * formatear incluido—. Los workflows definen `RATCHET_BASE` con el SHA ANTERIOR del push
 * (`github.event.before`) para que la comparación tenga sentido. Si la referencia no existe (primer
 * push de una rama, PR, clon superficial), se avisa y se vuelve al comportamiento anterior.
 */
const BASE =
  process.env.RATCHET_BASE && !/^0+$/.test(process.env.RATCHET_BASE)
    ? process.env.RATCHET_BASE
    : 'HEAD';
let avisoBase = null;
if (BASE !== 'HEAD') {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${BASE}^{commit}`], {
      stdio: 'ignore',
    });
  } catch {
    avisoBase = `[aviso] RATCHET_BASE=${BASE} no está en este clon: se compara contra HEAD (la puerta NO puede detectar deuda nueva en este caso).`;
  }
}

/** Contenido del fichero en la referencia, o null si no existía (fichero nuevo de este cambio).
 *  El stderr de git se silencia: para un fichero nuevo `git show` falla y su mensaje
 *  ("exists on disk, but not in 'HEAD'") es la respuesta esperada, no un error de la puerta. */
function fromHead(rel) {
  const ref = avisoBase ? 'HEAD' : BASE;
  try {
    return execFileSync('git', ['show', `${ref}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const files = filesToCheck();
const exempt = new Set();
const pending = [];

for (const rel of files) {
  const head = fromHead(rel);
  if (head === null) {
    pending.push(rel); // fichero NUEVO: tiene que cumplir
    continue;
  }
  if (!(await compliance(rel, head)))
    exempt.add(rel); // deuda PREVIA
  else pending.push(rel); // ya cumplía en HEAD: no puede empeorar
}

const failing = [];
for (const rel of pending) {
  if (!(await compliance(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')))) failing.push(rel);
}

if (process.argv.includes('--list-debt')) {
  console.log(`Deuda previa exenta: ${exempt.size} ficheros`);
  for (const f of [...exempt].sort()) console.log(`  · ${f}`);
  process.exit(0);
}

if (avisoBase) console.warn(avisoBase);
console.log(
  `Formato: ${files.length} ficheros · ${pending.length} exigidos (${BASE === 'HEAD' ? 'nuevos o ya conformes en HEAD' : `nuevos o ya conformes en ${BASE.slice(0, 7)}`}) · ${exempt.size} exentos por deuda previa.`,
);
if (failing.length) {
  console.error(`\nFORMATO INCORRECTO en ${failing.length} fichero(s):`);
  for (const f of failing) console.error(`  ✗ ${f}`);
  console.error('\nFormatea esos ficheros: `npx prettier --write <fichero>`.');
  process.exit(1);
}
console.log('Formato OK.');
