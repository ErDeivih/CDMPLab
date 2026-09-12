// =============================================================
// CDMPLab — Puerta de TIPOS para las pruebas E2E (`e2e/**`).
//
// Auditoría: ningún proyecto TypeScript cubría `e2e/` —`tsconfig.app.json` excluye los specs y
// `tsconfig.spec.json` solo incluye `src/**`—, así que Playwright transpilaba esos ~100 ficheros
// SIN comprobar tipos: un método inventado o un `await` de menos solo aparecía al ejecutar el test.
//
// Esta puerta los type-checkea de verdad y aplica el MISMO criterio de trinquete que el lint y el
// formato: la deuda que YA existía queda declarada en `typecheck-e2e.baseline.json` (y no puede
// crecer), y cualquier error NUEVO —o cualquier error en un fichero nuevo— falla.
//
//   node scripts/typecheck-e2e.mjs                 # comprueba (falla si hay deuda nueva)
//   node scripts/typecheck-e2e.mjs --update-baseline  # reescribe la base (revisar el diff a mano)
// =============================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, 'scripts', 'typecheck-e2e.baseline.json');
const actualizar = process.argv.includes('--update-baseline');

/** Ejecuta `tsc` y devuelve su salida, aunque salga con código 1 (que es lo normal con errores).
 *  Se llama al `tsc` del propio proyecto con `node`, sin shell: así no depende de cómo esté el PATH
 *  ni aparece el aviso de Node por pasar argumentos a un shell. */
function ejecutarTsc() {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  try {
    return execFileSync(process.execPath, [tsc, '-p', 'tsconfig.e2e.json', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

/** `fichero::TSxxxx` → nº de veces. Un fichero que no compila tampoco puede empeorar en silencio. */
function contar(salida) {
  const mapa = new Map();
  for (const linea of salida.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/.exec(linea.trim());
    if (!m) continue;
    const rel = path.relative(ROOT, path.resolve(ROOT, m[1])).replace(/\\/g, '/');
    const clave = `${rel}::${m[4]}`;
    mapa.set(clave, (mapa.get(clave) ?? 0) + 1);
  }
  return mapa;
}

const ahora = contar(ejecutarTsc());
const base = fs.existsSync(BASELINE)
  ? new Map(Object.entries(JSON.parse(fs.readFileSync(BASELINE, 'utf8'))))
  : new Map();

if (actualizar) {
  const obj = Object.fromEntries([...ahora.entries()].sort());
  fs.writeFileSync(BASELINE, `${JSON.stringify(obj, null, 2)}\n`);
  console.log(`Base de tipos E2E escrita: ${ahora.size} claves (fichero::regla) en ${BASELINE}.`);
  process.exit(0);
}

const nuevos = [];
for (const [clave, n] of [...ahora.entries()].sort()) {
  const antes = base.get(clave) ?? 0;
  if (n > antes) nuevos.push({ clave, antes, ahora: n });
}
const arreglados = [...base.entries()].filter(([clave, n]) => (ahora.get(clave) ?? 0) < n).length;
const totalAhora = [...ahora.values()].reduce((a, b) => a + b, 0);
const totalBase = [...base.values()].reduce((a, b) => a + b, 0);

console.log(
  `Tipos E2E: ${totalAhora} error(es) en ${new Set([...ahora.keys()].map((k) => k.split('::')[0])).size} fichero(s) · deuda previa declarada: ${totalBase} · nuevos: ${nuevos.length}${arreglados ? ` · ${arreglados} clave(s) mejoradas (baja la base cuando quieras)` : ''}.`,
);

if (nuevos.length) {
  console.error(
    `\nTIPOS NUEVOS en ${new Set(nuevos.map((d) => d.clave.split('::')[0])).size} fichero(s):`,
  );
  for (const d of nuevos) {
    const [rel, code] = d.clave.split('::');
    console.error(`  ✗ ${rel}: ${code} (${d.antes} en la base → ${d.ahora} ahora)`);
  }
  console.error(
    '\nArr\u00edglalos (o, si son deuda previa, revisa el diff y actualiza la base a mano).',
  );
  process.exit(1);
}
console.log('Tipos E2E OK (sin deuda nueva).');
