// =============================================================
// EntrenoLab — Puerta de ESLint con trinquete de deuda PREVIA (calculada desde HEAD).
//
// POR QUÉ NO ES UN `eslint .` A SECAS:
//   El repositorio nunca tuvo ESLint. Al añadirlo (Angular 22 + @angular-eslint, sin rebajar
//   ninguna regla del conjunto `recommended`) aparece la deuda acumulada de todo el código ya
//   escrito. Arreglarla entera sería un cambio masivo ajeno a esta auditoría; silenciarla con
//   `eslint-disable` o con `ignores` sería hacer trampas al juez.
//
// QUÉ HACE (trinquete, no barra libre):
//   · Compara el resultado de AHORA con el del MISMO fichero en HEAD, regla por regla.
//   · Falla si aparece una regla nueva en un fichero, o si una regla que ya aparecía aparece
//     MÁS VECES. Es decir: la deuda no puede crecer, ni en los ficheros que ya venían sucios.
//   · Un fichero NUEVO (que no está en HEAD) tiene que estar impecable.
//   · Informa de cuánta deuda previa queda, para que se pueda ir pagando.
//
// Uso:
//   node scripts/lint-check.mjs              # puerta (salida 1 si la deuda crece)
//   node scripts/lint-check.mjs --list-debt  # solo informa de la deuda previa por fichero
// =============================================================
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ESLint } from 'eslint';

const ROOT = process.cwd();

/**
 * Referencia contra la que se mide la deuda: por defecto `HEAD`.
 *
 * IMPORTANTE (auditoría): en CI, `HEAD` es el propio commit que se acaba de subir, así que el
 * contenido «de HEAD» es idéntico al del árbol y el trinquete pasaba SIEMPRE, incluso con reglas
 * nuevas. Los workflows definen `RATCHET_BASE` con el SHA ANTERIOR del push
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
 *  El stderr de git se silencia: para un fichero nuevo `git show` falla y su mensaje es la
 *  respuesta esperada, no un error de la puerta. */
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

/** Mensajes con regla → mapa `fichero::regla` → nº de veces. Sin `ruleId` (errores de
 *  parseo, `no-irregular-whitespace`, etc.) se cuenta con el propio mensaje como clave:
 *  un fichero que no compila tampoco puede empeorar en silencio. */
function counts(results) {
  const map = new Map();
  for (const r of results) {
    const rel = path.relative(ROOT, r.filePath).replace(/\\/g, '/');
    for (const m of r.messages) {
      const key = `${rel}::${m.ruleId ?? `parse:${m.message}`}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return map;
}

const eslint = new ESLint({ cwd: ROOT });
const nowResults = await eslint.lintFiles(['.']);
const now = counts(nowResults);

const filesNow = [...new Set([...now.keys()].map((k) => k.split('::')[0]))].sort();
const head = new Map();
const nuevos = [];
for (const rel of filesNow) {
  const source = fromHead(rel);
  if (source === null) {
    nuevos.push(rel);
    continue;
  }
  const [res] = await eslint.lintText(source, { filePath: path.join(ROOT, rel) });
  for (const [k, v] of counts([res])) head.set(k, v);
}

/** Deuda NUEVA: reglas que no existían en la referencia, o que aparecen más veces que en ella. */
const nuevaDeuda = [];
for (const [key, n] of [...now.entries()].sort()) {
  const antes = head.get(key) ?? 0;
  if (n > antes)
    nuevaDeuda.push({ key, antes, ahora: n, nuevoFichero: nuevos.includes(key.split('::')[0]) });
}

const deudaPrevia = [...now.entries()].filter(([key]) => head.has(key));
const ficherosConDeuda = [...new Set(deudaPrevia.map(([k]) => k.split('::')[0]))].sort();

if (process.argv.includes('--list-debt')) {
  console.log(
    `Deuda previa: ${deudaPrevia.length} reglas en ${ficherosConDeuda.length} ficheros (exentas).`,
  );
  const porFichero = new Map();
  for (const [key, n] of deudaPrevia) {
    const [rel, rule] = key.split('::');
    porFichero.set(rel, [...(porFichero.get(rel) ?? []), `${rule}×${n}`]);
  }
  for (const rel of ficherosConDeuda) console.log(`  · ${rel}: ${porFichero.get(rel).join(', ')}`);
  process.exit(0);
}

if (avisoBase) console.warn(avisoBase);
console.log(
  `ESLint: ${nowResults.length} ficheros analizados · deuda previa exenta: ${deudaPrevia.length} reglas en ${ficherosConDeuda.length} ficheros · deuda nueva: ${nuevaDeuda.length} (base: ${BASE === 'HEAD' ? 'HEAD' : BASE.slice(0, 7)}).`,
);

if (nuevaDeuda.length) {
  console.error(
    `\nDEUDA NUEVA en ${new Set(nuevaDeuda.map((d) => d.key.split('::')[0])).size} fichero(s):`,
  );
  for (const d of nuevaDeuda) {
    const [rel, rule] = d.key.split('::');
    console.error(
      `  ✗ ${rel}: ${rule} (${d.antes} en HEAD → ${d.ahora} ahora)${d.nuevoFichero ? ' [fichero nuevo]' : ''}`,
    );
  }
  console.error(
    '\nArregla el código: `npx eslint <fichero>`. No se admiten reglas rebajadas ni ignores.',
  );
  process.exit(1);
}
console.log('ESLint OK (sin deuda nueva).');
