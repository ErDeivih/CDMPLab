// =============================================================
// EntrenoLab — Servidor estático de la build de PRODUCCIÓN (E2E honesto)
//
// Sirve `dist/entrenolab/browser` (la salida de `ng build` con la
// configuración `production`) en http://127.0.0.1:4300 con fallback SPA a
// `index.html` para que las rutas de Angular (/team, /board, …) resuelvan en
// el cliente en lugar de devolver 404.
//
// Con esto la prueba de producción NO usa `ng serve` (eso es el servidor de
// desarrollo con Supabase vacío): se sirve exactamente el bundle que se
// subiría a un host real.
//
// Uso (lo invoca `playwright.prod.config.ts` como webServer):
//   node scripts/serve-prod.mjs
//
// No requiere dependencias extra: solo `node:http` + `node:fs`.
// =============================================================

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'entrenolab', 'browser');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4300);

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

/** Mapea la URL a una ruta segura bajo ROOT (evita path traversal). */
function resolveFilePath(pathname) {
  const cleaned = pathname.replace(/^([/\\])+/, '');
  return join(ROOT, cleaned);
}

function okText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function serveIndex(res) {
  readFile(join(ROOT, 'index.html'))
    .then((buf) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    })
    .catch(() => okText(res, 404, 'index.html no encontrado'));
}

function serveFile(res, filePath) {
  readFile(filePath)
    .then((buf) => {
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
      res.end(buf);
    })
    .catch(() => okText(res, 404, 'No encontrado'));
}

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', `http://${HOST}:${PORT}`).pathname);
  const pathname = urlPath === '/' ? '/index.html' : urlPath;

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
    // SPA fallback: si la ruta no parece un fichero con extensión, se sirve
    // index.html para que Angular resuelva la ruta en el cliente.
    if (!extname(pathname) && !pathname.endsWith('index.html')) {
      serveIndex(res);
      return;
    }
    okText(res, 404, 'No encontrado');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[serve-prod] ${ROOT} -> http://${HOST}:${PORT}`);
});
