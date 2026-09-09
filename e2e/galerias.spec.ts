import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { longPress } from './gesture-helpers';

// FASE 3 — galerías SIN nombres automáticos dentro del campo.
// El campo solo contiene objetos tácticos. La identificación se hace con el pie de
// foto EXTERNO (título del recuadro en el contact sheet), nunca con la herramienta
// Texto de la pizarra ni con etiquetas automáticas.
const SHOTS = 'e2e/shots/galerias';
fs.mkdirSync(SHOTS, { recursive: true });

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
type Box = { x: number; y: number; width: number; height: number };
function normToScreen(nx: number, ny: number, b: Box): [number, number] {
  const s = Math.min(b.width / VBW, b.height / VBH);
  const offX = (b.width - VBW * s) / 2;
  const offY = (b.height - VBH * s) / 2;
  const cx = offX + (nx * RECT.w + RECT.x) * s;
  const cy = offY + (ny * RECT.h + RECT.y) * s;
  return [b.x + cx, b.y + cy];
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'pl1', teamId: 't1', name: 'Marcos', number: 9, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(250);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    await page.waitForTimeout(120);
  }
}

async function useTool(page: Page, title: string, category?: string): Promise<void> {
  if (category) {
    // FASE B: el catálogo persiste abierto, así que solo se abre la categoría si su
    // herramienta aún no está visible (un re-toggle la cerraría).
    if (!(await page.locator(`.rail-btn[title="${title}"]`).isVisible().catch(() => false))) {
      await page.locator('.tools-cat', { hasText: category }).click();
    }
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
}
async function drawShape(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const b = (await page.locator('.board-host').boundingBox())!;
  const a = normToScreen(from[0], from[1], b);
  const c = normToScreen(to[0], to[1], b);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(c[0], c[1], { steps: 5 });
  await page.mouse.up();
}
async function clean(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}
async function placeMaterial(page: Page, host: Box, title: string, nx: number, ny: number): Promise<void> {
  const input = page.locator('.tools-search-input');
  // FASE B: el catálogo persiste abierto; solo se abre si no lo está (evitar re-toggle).
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
  }
  await input.fill('');
  await input.fill(title);
  await page.waitForTimeout(80);
  await page.locator(`.rail-btn[title="${title}"]`).click();
  const p = normToScreen(nx, ny, host);
  await page.mouse.click(p[0], p[1], { button: 'right' });
}
async function setColor(page: Page, hex: string): Promise<void> {
  // PALETTE = ['#1a73e8','#c0392b','#1f7a4d','#e67e22','#7d3c98','#b8860b','#111111','#f4f4f4']
  const index = ['#1a73e8', '#c0392b', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b', '#111111', '#f4f4f4'].indexOf(hex);
  await page.locator('.tools-caption .swatch').nth(index).click();
}

const MATERIALS = [
  'Balón', 'Fitball', 'Cono', 'BOSU', 'Banderín', 'Chino',
  'Pica coloreable', 'Pértiga / poste', 'Maniquí individual', 'Barrera de maniquíes',
  'Miniportería', 'Portería grande', 'Valla', 'Aro', 'Escalera',
  'Minitrampolín', 'Peto', 'Chaleco lastrado', 'Mancuerna / pesa',
];

test.describe('Galerías sin nombres en el campo', () => {
  test('materiales en grupos de ≤6, sin etiquetas (contact sheet identifica por título)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = (await page.locator('.board-host').boundingBox())!;
    // Dividir en grupos de máximo 6 (3 columnas × 2 filas) para que no se solapen.
    const chunk = (n: number) => {
      const out: Array<{ items: string[]; name: string }> = [];
      for (let i = 0; i < MATERIALS.length; i += n) out.push({ items: MATERIALS.slice(i, i + n), name: `galeria-materiales-${out.length + 1}` });
      return out;
    };
    const groups = chunk(6);
    for (const { items, name } of groups) {
      const cols = [0.25, 0.5, 0.75];
      const rows = [0.2, 0.5];
      for (let i = 0; i < items.length; i++) {
        await placeMaterial(page, host, items[i], cols[i % 3], rows[Math.floor(i / 3)]);
      }
      await clean(page);
      await page.locator('.board-host').screenshot({ path: `${SHOTS}/${name}.png` });
    }
    // 19 materiales colocados y NO debe existir ningún elemento text automático.
    const total = await page.locator('.board-canvas svg [data-el-type]').count();
    const texts = await page.locator('.board-canvas svg [data-el-type="text"]').count();
    expect(texts, 'sin textos automáticos de material').toBe(0);
    expect(total, 'los 19 materiales son los únicos objetos').toBe(19);
  });

  test('dibujo: líneas y flechas (galeria-lineas-flechas)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const draw = (title: string, from: [number, number], to: [number, number]) => useTool(page, title, 'Dibujo').then(() => drawShape(page, from, to));
    await draw('Línea', [0.06, 0.1], [0.32, 0.1]);
    await draw('Flecha (movimiento)', [0.06, 0.22], [0.32, 0.22]);
    await draw('Flecha doble sentido', [0.06, 0.34], [0.32, 0.34]);
    await draw('Línea', [0.06, 0.46], [0.32, 0.46]);
    await draw('Curva derecha', [0.06, 0.58], [0.3, 0.68]);
    await draw('Conducción (zigzag)', [0.06, 0.7], [0.3, 0.78]);
    await draw('Dibujo a mano alzada', [0.06, 0.82], [0.3, 0.88]);
    await clean(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-lineas-flechas.png` });
  });

  test('dibujo: formas y texto voluntario (galeria-formas y galeria-texto-voluntario)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    // Rect perímetro y relleno.
    await useTool(page, 'Rectángulo', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Perímetro' }).click();
    await drawShape(page, [0.06, 0.08], [0.3, 0.28]);
    await useTool(page, 'Rectángulo', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Relleno' }).click();
    await drawShape(page, [0.58, 0.08], [0.88, 0.28]);
    // Elipse perímetro y relleno.
    await useTool(page, 'Círculo / elipse', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Perímetro' }).click();
    await drawShape(page, [0.06, 0.4], [0.3, 0.62]);
    await useTool(page, 'Círculo / elipse', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Relleno' }).click();
    await drawShape(page, [0.58, 0.4], [0.88, 0.62]);
    // Zona relleno.
    await useTool(page, 'Rectángulo', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Relleno' }).click();
    await drawShape(page, [0.06, 0.72], [0.3, 0.9]);
    await clean(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-formas.png` });
    // Texto VOLUNTARIO (lo que el entrenador quiso escribir).
    await useTool(page, 'Texto', 'Dibujo');
    const host = (await page.locator('.board-host').boundingBox())!;
    const tp = normToScreen(0.5, 0.5, host);
    await page.mouse.click(tp[0], tp[1], { button: 'right' });
    await page.locator('.studio-panel .inspector textarea').fill('Presión tras pérdida');
    await page.locator('.studio-panel .inspector textarea').dispatchEvent('change');
    await page.locator('.studio-panel .inspector textarea').evaluate((el) => (el as HTMLElement).blur());
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-texto-voluntario.png` });
  });

  test('colores: las mismas figuras en varios colores (galeria-colores)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const colors = ['#c0392b', '#1a73e8', '#1f7a4d', '#e67e22', '#7d3c98', '#b8860b'];
    // Líneas horizontales con colores distintos (sin etiquetas).
    for (let i = 0; i < colors.length; i++) {
      await useTool(page, 'Línea', 'Dibujo');
      await setColor(page, colors[i]);
      const y = 0.12 + i * 0.14;
      await drawShape(page, [0.12, y], [0.88, y]);
    }
    await clean(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-colores.png` });
  });

  test('jugadores: real con número (galeria-jugadores)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.roster-item', { hasText: 'Marcos' }).click();
    const p = normToScreen(0.5, 0.5, host);
    await page.mouse.click(p[0], p[1]);
    await expect(page.locator('.field-count')).toHaveText('1');
    await clean(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-jugadores.png` });
  });

  test('transformaciones (galeria-transformaciones)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = (await page.locator('.board-host').boundingBox())!;
    // Cono seleccionado con asas y ±90°.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    let p = normToScreen(0.3, 0.5, host);
    await page.mouse.click(p[0], p[1]);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    // Fase 3: pulsación larga sobre el cono abre la barra de contexto (el clic derecho fue retirado).
    await longPress(page, p[0], p[1]);
    await page.waitForTimeout(150);
    await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
    await page.waitForTimeout(120);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-transf-cono-90.png` });
    // Curva con control.
    await useTool(page, 'Curva derecha', 'Dibujo');
    await drawShape(page, [0.4, 0.3], [0.65, 0.55]);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const cc = normToScreen(0.53, 0.36, host);
    await page.mouse.click(cc[0], cc[1]);
    await page.waitForTimeout(150);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-transf-curva-control.png` });
    // Línea extremos.
    await useTool(page, 'Línea', 'Dibujo');
    await drawShape(page, [0.4, 0.7], [0.68, 0.8]);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const lc = normToScreen(0.54, 0.75, host);
    await page.mouse.click(lc[0], lc[1]);
    await page.waitForTimeout(150);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-transf-linea-extremos.png` });
    // Papelera.
    const cone = normToScreen(0.3, 0.5, host);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.move(cone[0], cone[1]);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await expect(page.locator('.board-trash')).toHaveClass(/trash-visible/);
    const trash = (await page.locator('.board-trash').boundingBox())!;
    await page.mouse.move(trash.x + trash.width / 2, trash.y + trash.height / 2, { steps: 5 });
    await page.waitForTimeout(60);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/galeria-transf-papelera.png` });
    await page.mouse.up();
  });
});

test.describe('Contact sheet de galerías (título = pie de foto externo)', () => {
  test('genera contact-sheet legible con títulos', async ({ page }) => {
    const files = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort();
    const rows = files.map((f) => {
      const b64 = fs.readFileSync(path.resolve(SHOTS, f)).toString('base64');
      const caption = f.replace('galeria-', '').replace('.png', '');
      return `<figure><img src="data:image/png;base64,${b64}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`;
    }).join('\n');
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;margin:12px;background:#111;color:#eee}h1{font-size:16px}figure{display:inline-block;margin:10px;text-align:center;vertical-align:top}figure img{max-width:480px;border:1px solid #555}figcaption{font-size:12px;margin-top:4px;max-width:480px}</style></head><body><h1>CDMPLab · galerías (pie de foto = título externo)</h1>' + rows + '</body></html>';
    const file = path.resolve(SHOTS, 'contact-sheet.html');
    fs.writeFileSync(file, html, 'utf8');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    await page.locator('h1').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.resolve(SHOTS, 'contact-sheet.png'), fullPage: true });
  });
});
