// Contact sheet de los PNGs de material táctico: miniatura + nombre de fichero +
// tool/kind al que están asignados (según src/app/core/tactic-assets.ts).
// Uso: node scripts/contact-sheet.mjs
// Sale en e2e/shots/fase7-assets/contact-sheet.png (y deja el HTML fuente al lado).
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const OUT_DIR = path.join(root, 'e2e', 'shots', 'fase7-assets');
const ASSETS = path.join(root, 'public', 'assets', 'tactical');

// filename → { kind, label } (espejo de tactic-assets.ts).
const MAP = {
  'ball.png': { kind: 'ball_football', label: 'Balón de fútbol' },
  'ball-purple.png': { kind: 'vball', label: 'Balón (morado)' },
  'cone-blue.png': { kind: 'cone_blue', label: 'Cono (azul)' },
  'cone-blue-2.png': { kind: 'cone_blue2', label: 'Cono (azul 2)' },
  'cone-orange.png': { kind: 'cone_orange', label: 'Cono (naranja)' },
  'cone-red.png': { kind: 'cone_red', label: 'Cono (rojo)' },
  'cone-white.png': { kind: 'cone_white', label: 'Cono (blanco)' },
  'cone-yellow.png': { kind: 'cone_yellow', label: 'Cono (amarillo)' },
  'disc.png': { kind: 'disc', label: 'Disco / Marcador' },
  'flag.png': { kind: 'flag', label: 'Banderín' },
  'hurdle.png': { kind: 'hurdle', label: 'Valla' },
  'ladder.png': { kind: 'ladder', label: 'Escalera' },
  'ladder-yellow.png': { kind: 'ladder_yellow', label: 'Escalera (amarilla)' },
  'mannequin.png': { kind: 'mannequin', label: 'Maniquí' },
  'mannequin-row.png': { kind: 'mannequin_row', label: 'Maniquí (fila)' },
  'minigoal.png': { kind: 'minigoal', label: 'Miniportería' },
  'net.png': { kind: 'net', label: 'Red / valla' },
  'pole.png': { kind: 'pole', label: 'Pértiga' },
  'ring.png': { kind: 'ring', label: 'Aro' },
  'ring-flat.png': { kind: 'ring_flat', label: 'Aro plano' },
  'target.png': { kind: 'target', label: 'Diana' },
  'trampoline.png': { kind: 'trampoline', label: 'Minitrampolín' },
};

const cell = (file, meta) => `
  <div class="cell">
    <div class="thumb"><img src="../../../public/assets/tactical/${file}" alt="${file}"></div>
    <div class="file">${file}</div>
    <div class="meta"><b>${meta.kind}</b> — ${meta.label}</div>
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:16px; background:#f4f4f4; font-family:Inter, system-ui, sans-serif; }
  h1 { font-size:16px; margin:0 0 12px; }
  .grid { display:grid; grid-template-columns:repeat(6, 190px); gap:12px; }
  .cell { background:#fff; border:1px solid #ddd; border-radius:8px; padding:8px; box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .thumb { height:120px; display:flex; align-items:center; justify-content:center; background:
    repeating-conic-gradient(#fff 0 90deg, #e6e6e6 0 180deg) 0 0/24px 24px; border-radius:6px; }
  .thumb img { max-width:120px; max-height:120px; object-fit:contain; }
  .file { font-size:11px; color:#333; margin-top:8px; font-weight:600; word-break:break-all; }
  .meta { font-size:11px; color:#555; margin-top:2px; }
</style></head><body>
  <h1>Contact sheet — public/assets/tactical/ ({count} PNG)</h1>
  <div class="grid">${Object.entries(MAP).sort(([a],[b]) => a.localeCompare(b)).map(([f,m]) => cell(f,m)).join('')}</div>
</body></html>`.replace('{count}', String(Object.keys(MAP).length));

const htmlPath = path.join(OUT_DIR, 'contact-sheet.html');
const shotPath = path.join(OUT_DIR, 'contact-sheet.png');

import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(htmlPath, html, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 190 * 6 + 80, height: 1400 }, deviceScaleFactor: 2 });
await page.goto('file://' + htmlPath.replace(/\\/g, '/'));
await page.waitForTimeout(1200);
await page.screenshot({ path: shotPath, fullPage: true });
await browser.close();
console.log('OK ->', shotPath);
