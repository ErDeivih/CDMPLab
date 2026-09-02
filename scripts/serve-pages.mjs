// =============================================================
// CDMPLab — Servidor de prueba del artefacto de GitHub Pages (prefijo /CDMPLab/)
//
// Sirve `dist/entrenolab/browser` (la salida de `node scripts/build-pages.mjs`,
// configuración `pages` con baseHref /CDMPLab/) en http://127.0.0.1:4500,
// MAÑEANDO el prefijo `/CDMPLab/` como si la app estuviera publicada en
// `https://<org>.github.io/CDMPLab/`.
//
// IMPORTANTE — este servidor NO inventa un fallback SPA. Reproduce el
// comportamiento REAL de GitHub Pages sobre el artefacto publicado:
//   · Un asset con extensión (JS/CSS/fuentes/favicon/escudo, en /CDMPLab/<asset>)
//     se sirve si existe en disco; si no, 404.
//   · Una RUTA de Angular sin extensión (/CDMPLab/team, /CDMPLab/board,
//     /CDMPLab/auth/login) NO existe en disco: GitHub Pages sirve entonces el
//     `404.html` del artefacto (copiado de `index.html` por build-pages.mjs).
//     Ese es el mecanismo real de SPA fallback en GitHub Pages: el navegador
//     carga la app desde ese HTML y Angular resuelve la ruta desde la URL.
//
// Si el artefacto NO contiene `404.html`, estas rutas devuelven un 404 REAL
// (la prueba falla), porque el test no debe simular nada que el artefacto no
// proporcione.
//
// Uso (lo invoca `playwright.pages.config.ts` como webServer):
//   node scripts/serve-pages.mjs
// =============================================================

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'entrenolab', 'browser');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4500);
const BASE = '/CDMPLab'; // prefijo base de GitHub Pages

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Recorta el prefijo /CDMPLab de la URL y devuelve la ruta interna. */
function normalizePathname(pathname) {
  if (pathname === BASE || pathname === BASE + '/') return '/index.html';
  if (pathname.startsWith(BASE + '/')) {
    const rest = pathname.slice(BASE.length);
    return rest === '' || rest === '/' ? '/index.html' : rest;
  }
  return pathname;
}

/** Mapea la URL a una ruta segura bajo ROOT (evita path traversal). */
function resolveFilePath(pathname) {
  const cleaned = pathname.replace(/^([/\\])+/, '');
  return join(ROOT, cleaned);
}

function okText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function serveFile(res, filePath, status = 200) {
  readFile(filePath)
    .then((buf) => {
      res.writeHead(status, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
      res.end(buf);
    })
    .catch(() => okText(res, 404, 'No encontrado'));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const rawPath = decodeURIComponent(url.pathname);
  const pathname = normalizePathname(rawPath);

  const rootWithSep = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
  let filePath = resolveFilePath(pathname);
  if (filePath !== ROOT && !filePath.startsWith(rootWithSep)) {
    okText(res, 403, 'Forbidden');
    return;
  }

  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = join(filePath, 'index.html');
    serveFile(res, filePath);
  } catch {
    // Ruta sin extensión (una ruta de Angular): GitHub Pages serviría el
    // `404.html` del artefacto. Se sirve ese fichero SI existe; si no, 404 real.
    if (!extname(pathname) && !pathname.endsWith('index.html')) {
      const notFound = join(ROOT, '404.html');
      try {
        await stat(notFound);
        serveFile(res, notFound);
        return;
      } catch {
        okText(res, 404, 'No encontrado');
        return;
      }
    }
    okText(res, 404, 'No encontrado');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[serve-pages] ${ROOT} + base ${BASE} -> http://${HOST}:${PORT}${BASE}`);
});
