// =============================================================
// CDMPLab — Build de GitHub Pages (prefijo /CDMPLab/)
//
// Genera `src/environments/environment.pages.ts` a partir de variables de
// entorno, compila con la configuración `pages` (baseHref /CDMPLab/) y, al
// terminar, COPIA `index.html` a `404.html` dentro de `dist/entrenolab/browser`.
//
// Por qué `404.html`:
//   GitHub Pages NO hace fallback SPA automático. Para que una URL directa o
//   una recarga de una ruta Angular (/CDMPLab/auth/login, /CDMPLab/board) no
//   devuelva 404, el artefacto debe incluir un `404.html` que GitHub Pages
//   server en lugar de la página de error. Como `404.html` es una copia de
//   `index.html` (con el mismo <base href="/CDMPLab/">), el navegador carga la
//   app y Angular resuelve la ruta real desde la URL.
//
//   El servidor de prueba `scripts/serve-pages.mjs` reproduce exactamente ese
//   comportamiento (sirve el `404.html` del artefacto, no un fallback propio).
//
// Variables (NUNCA un secreto de servidor; la publishable/anon es pública):
//   SUPABASE_URL             → https://<proyecto>.supabase.co
//   SUPABASE_PUBLISHABLE_KEY → clave publishable/anon del proyecto
//
// Si las variables NO están definidas (p. ej. build local sin backend), se
// reutilizan los valores de `environment.ts` (config de producción por defecto)
// para que la build de Pages funcione igual. La workflow de GitHub Pages inyecta
// estas variables desde GitHub vars/secrets (ver .github/workflows/pages.yml).
//
// La URL y la clave publishable son públicas por diseño (van al frontend); lo
// que NUNCA debe aparecer aquí es la service_role / secret key.
// =============================================================

import { writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src', 'environments', 'environment.pages.ts');
const DIST_BROWSER = resolve(ROOT, 'dist', 'entrenolab', 'browser');
const INDEX = join(DIST_BROWSER, 'index.html');
const NOT_FOUND = join(DIST_BROWSER, '404.html');

const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim();
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();

let content;
if (supabaseUrl && publishableKey) {
  content = `// Generado por scripts/build-pages.mjs (GitHub Pages).
import { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  supabaseUrl: '${supabaseUrl}',
  supabasePublishableKey: '${publishableKey}',
};
`;
} else {
  // Fallback: usa la configuración de producción por defecto.
  content = readFileSync(resolve(ROOT, 'src', 'environments', 'environment.ts'), 'utf8');
  console.warn('[build-pages] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY no definidas; usando environment.ts.');
}

writeFileSync(OUT, content);
console.log(`[build-pages] environment.pages.ts escrito (${supabaseUrl ? 'variables de entorno' : 'fallback'}).

`);

const res = spawnSync('npx', ['ng', 'build', '--configuration', 'pages'], { cwd: ROOT, stdio: 'inherit', shell: true });
if (res.status !== 0) {
  console.error(`[build-pages] ng build --configuration pages falló (código ${res.status}).`);
  process.exit(res.status ?? 1);
}

// Copia index.html → 404.html (mecanismo real de SPA en GitHub Pages).
copyFileSync(INDEX, NOT_FOUND);
if (!existsSync(NOT_FOUND)) {
  console.error('[build-pages] no se pudo crear dist/entrenolab/browser/404.html.');
  process.exit(1);
}
console.log('[build-pages] 404.html generado (copia de index.html) para el fallback SPA de GitHub Pages.\n');

process.exit(0);
