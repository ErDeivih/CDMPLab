import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// =============================================================
// Defecto residual 2 — evidencia visual incompleta + cobertura
// que podía dar un FALSO VERDE.
//
// 1) Cobertura real: cada colocación verifica en el SVG que se creó
//    EXACTAMENTE UN elemento nuevo y que su tipo (`data-el-type`, el
//    `t` real del modelo CanvasElement) es el esperado. Solo después
//    se registra en el manifiesto (`recordPlaced`). Un clic roto que
//    no cree el elemento (o que cree otro tipo) hace fallar el test
//    en vez de dejarlo verde.
// 2) Escenas de catálogo legibles: sin etiquetas solapadas ni
//    cortadas, dividiendo categorías cuando hace falta.
// =============================================================

const SHOTS = 'e2e/shots/final-interaction';
const MANIFEST = path.resolve(SHOTS, '_catalog-manifest.json');
fs.mkdirSync(SHOTS, { recursive: true });

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

type Box = { x: number; y: number; width: number; height: number };
type Fit = 'contain' | 'height';

// ---------- Manifiesto de tipos colocados ----------
interface Manifest {
  materials: string[];
  draw: string[];
  players: string[];
}
function loadManifest(): Manifest {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as Manifest;
    return { materials: m.materials ?? [], draw: m.draw ?? [], players: m.players ?? [] };
  } catch {
    return { materials: [], draw: [], players: [] };
  }
}
function saveManifest(m: Manifest): void {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2), 'utf8');
}
function recordPlaced(kind: keyof Manifest, title: string): void {
  const m = loadManifest();
  if (!m[kind].includes(title)) m[kind].push(title);
  saveManifest(m);
}

// ---------- Tipo de elemento (modelo real) por título de herramienta ----------
const MATERIAL_TYPE: Record<string, string> = {
  'Balón': 'ball', 'Fitball': 'vball', 'Cono': 'cone', 'BOSU': 'marker',
  'Banderín': 'flag', 'Chino': 'target', 'Pica coloreable': 'pica',
  'Pértiga / poste': 'pole', 'Maniquí individual': 'mannequin',
  'Barrera de maniquíes': 'mannequin_row', 'Miniportería': 'minigoal',
  'Portería grande': 'goal', 'Valla': 'hurdle', 'Aro': 'ring',
  'Escalera': 'ladder', 'Minitrampolín': 'trampoline', 'Peto': 'peto',
  'Chaleco lastrado': 'chaleco', 'Mancuerna / pesa': 'dumbbell',
};
const DRAW_TYPE: Record<string, string> = {
  'Línea': 'line', 'Flecha (movimiento)': 'arrow', 'Flecha doble sentido': 'doubleArrow',
  'Curva derecha': 'curve', 'Curva izquierda': 'curve', 'Conducción (zigzag)': 'dribble',
  'Dibujo a mano alzada': 'freehand', 'Rectángulo': 'rect', 'Círculo / elipse': 'ellipse',
  'Texto': 'text',
};

function normToScreen(nx: number, ny: number, host: Box, fit: Fit, panX = 0, panY = 0, zoom = 1) {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  const ox = host.width / 2;
  const oy = host.height / 2;
  return { x: host.x + ox + panX + zoom * (cx - ox), y: host.y + oy + panY + zoom * (cy - oy) };
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
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
}

async function useTool(page: Page, title: string, category?: string): Promise<void> {
  if (category) {
    // FASE B: el catálogo persiste abierto; solo se abre si su herramienta no está
    // visible (un re-toggle la cerraría).
    if (!(await page.locator(`.rail-btn[title="${title}"]`).isVisible().catch(() => false))) {
      await page.locator('.tools-cat', { hasText: category }).click();
    }
  }
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
    await closeCatalogPanel(page);
    return;
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
  // FASE B: minimizar el catálogo para liberar el campo (los puntos izquierdos/quedan
  // bajo el panel persistente).
  await closeCatalogPanel(page);
}

/** Abre un catálogo lateral solo si no está ya abierto (idempotente, FASE B). */
async function openCatalog(page: Page, category: string): Promise<void> {
  const probe = category === 'Jugadores' ? '.side-panel-left[aria-label="Jugadores"]' : '.side-panel-left.tools-panel-side';
  if (await page.locator(probe).isVisible().catch(() => false)) return;
  await page.locator('.tools-cat', { hasText: category }).click();
}

/** Minimiza el catálogo lateral abierto con su X (no desarma la herramienta). */
async function closeCatalogPanel(page: Page): Promise<void> {
  const panel = page.locator('.side-panel');
  if (await panel.isVisible().catch(() => false)) {
    const close = panel.first().locator('.panel-close');
    if (await close.isVisible().catch(() => false)) await close.click();
  }
}

async function drawShape(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], host, fit);
  const b = normToScreen(to[0], to[1], host, fit);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** Limpia selección y paneles antes de capturar el campo. */
async function cleanScene(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    document.querySelectorAll('.context-bar, .top-pop, .side-panel').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  });
  await page.waitForTimeout(60);
}

// ---------- VERIFICACIÓN AUTORITATIVA en el SVG ----------
async function countType(page: Page, type: string): Promise<number> {
  return page.locator(`.board-canvas svg [data-el-type="${type}"]`).count();
}
async function countTotal(page: Page): Promise<number> {
  return page.locator('.board-canvas svg [data-el-type]').count();
}
/** Ejecuta `action` y exige que cree EXACTAMENTE un elemento del `type` dado. */
async function expectNewElement(page: Page, type: string, action: () => Promise<void>): Promise<void> {
  const beforeType = await countType(page, type);
  const beforeTotal = await countTotal(page);
  await action();
  // Esperar la confirmación de Angular (poll): si el tipo no aparece, es un falso verde.
  await expect.poll(
    () => countType(page, type),
    { timeout: 8000, message: `se creó un elemento del tipo ${type}` }
  ).toBe(beforeType + 1);
  const afterType = await countType(page, type);
  const afterTotal = await countTotal(page);
  expect(afterTotal - beforeTotal, `exactamente un elemento nuevo del tipo ${type}`).toBe(1);
  expect(afterType - beforeType, `el nuevo elemento es del tipo ${type}`).toBe(1);
}

interface PlayerPred { side?: string; kind?: string; playerId?: string }
async function countPlayers(page: Page, pred: PlayerPred): Promise<number> {
  const p = pred;
  return page.evaluate((pred) => {
    return Array.from(document.querySelectorAll('.board-canvas svg [data-el-type="player"]'))
      .filter((e) => {
        const side = e.getAttribute('data-side') ?? '';
        const kind = e.getAttribute('data-kind') ?? '';
        const pid = e.getAttribute('data-player-id') ?? '';
        if (pred.side !== undefined && side !== pred.side) return false;
        if (pred.kind !== undefined && kind !== pred.kind) return false;
        if (pred.playerId !== undefined && pid !== pred.playerId) return false;
        return true;
      }).length;
  }, p);
}
async function expectNewPlayer(page: Page, pred: PlayerPred, action: () => Promise<void>): Promise<void> {
  const before = await countPlayers(page, pred);
  const beforeTotal = await countTotal(page);
  await action();
  await expect.poll(
    () => countPlayers(page, pred),
    { timeout: 8000, message: `se creó un jugador del tipo ${JSON.stringify(pred)}` }
  ).toBe(before + 1);
  const after = await countPlayers(page, pred);
  const afterTotal = await countTotal(page);
  expect(afterTotal - beforeTotal, 'exactamente un jugador nuevo').toBe(1);
  expect(after - before, `nuevo jugador del tipo ${JSON.stringify(pred)}`).toBe(1);
}

// ---------- Colocación (con verificación antes de recordPlaced) ----------
async function placeMaterial(page: Page, host: Box, fit: Fit, title: string, nx: number, ny: number): Promise<void> {
  const type = MATERIAL_TYPE[title];
  expect(type, `tipo de material conocido: ${title}`).toBeTruthy();
  const input = page.locator('.tools-search-input');
  // FASE B: abrir Material solo si no está ya abierto (evitar re-toggle).
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
  }
  await input.fill('');
  await input.fill(title);
  await page.waitForTimeout(80);
  await page.locator(`.rail-btn[title="${title}"]`).click();
  await closeCatalogPanel(page);
  const p = normToScreen(nx, ny, host, fit);
  await expectNewElement(page, type, () => page.mouse.click(p.x, p.y));
  recordPlaced('materials', title);
}

async function placeText(page: Page, host: Box, fit: Fit, content: string, nx: number, ny: number): Promise<void> {
  await useTool(page, 'Texto', 'Dibujo');
  const p = normToScreen(nx, ny, host, fit);
  await expectNewElement(page, 'text', () => page.mouse.click(p.x, p.y));
  const ta = page.locator('.studio-panel .inspector textarea');
  await ta.fill(content);
  await ta.dispatchEvent('change');
  await ta.evaluate((el) => (el as HTMLElement).blur());
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  recordPlaced('draw', 'Texto');
}

async function placeRealPlayer(page: Page, host: Box, fit: Fit, name: string, pid: string, nx: number, ny: number): Promise<void> {
  await openCatalog(page, 'Jugadores');
  await page.locator('.roster-item', { hasText: name }).click();
  await closeCatalogPanel(page);
  const p = normToScreen(nx, ny, host, fit);
  await expectNewPlayer(page, { playerId: pid }, () => page.mouse.click(p.x, p.y));
  recordPlaced('players', name);
}

async function placeGenericByTitle(page: Page, host: Box, fit: Fit, title: string, nx: number, ny: number): Promise<void> {
  await openCatalog(page, 'Jugadores');
  // FASE C: sin botones "Jugador propio/rival"; la diferenciación de equipos es por COLOR,
  // así que ambos genéricos son side:'own' y se distinguen por su color.
  const chip = title === 'Jugador rival' ? 'Rojo' : 'Azul';
  await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
  await closeCatalogPanel(page);
  const p = normToScreen(nx, ny, host, fit);
  const pred: PlayerPred = { side: 'own', kind: '', playerId: '' };
  await expectNewPlayer(page, pred, () => page.mouse.click(p.x, p.y));
  recordPlaced('players', title);
}

async function placeTrayPlayer(page: Page, host: Box, fit: Fit, title: string, nx: number, ny: number): Promise<void> {
  await openCatalog(page, 'Jugadores');
  await page.locator(`.tray-player[title="${title}"]`).click();
  await closeCatalogPanel(page);
  const p = normToScreen(nx, ny, host, fit);
  // Las fichas de color colocan un jugador genérico SIN rol especial (kind vacío).
  const pred: PlayerPred = { side: 'own', kind: '', playerId: '' };
  await expectNewPlayer(page, pred, () => page.mouse.click(p.x, p.y));
  recordPlaced('players', title);
}

async function placeDraw(page: Page, title: string, from: [number, number], to: [number, number]): Promise<void> {
  const type = DRAW_TYPE[title];
  expect(type, `tipo de dibujo conocido: ${title}`).toBeTruthy();
  await useTool(page, title, 'Dibujo');
  await expectNewElement(page, type, () => drawShape(page, from, to));
  recordPlaced('draw', title);
}

test.describe('Defecto 2 — escenas de catálogo (materiales / jugadores / dibujo)', () => {
  test.beforeAll(() => {
    fs.writeFileSync(MANIFEST, JSON.stringify({ materials: [], draw: [], players: [] }), 'utf8');
  });

  test('catálogo de materiales (1/2) — 10 tipos ordenados con etiqueta', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const items = [
      'Balón', 'Fitball', 'Cono', 'BOSU', 'Banderín',
      'Chino', 'Pica coloreable', 'Pértiga / poste', 'Maniquí individual', 'Barrera de maniquíes',
    ];
    const cols = [0.2, 0.5, 0.8];
    const rows = [0.15, 0.33, 0.51, 0.69];
    for (let i = 0; i < items.length; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      await placeMaterial(page, host, fit, items[i], cols[col], rows[row]);
      await placeText(page, host, fit, items[i], cols[col], rows[row] + 0.08);
    }
    expect(loadManifest().materials.length, 'se colocaron los 10 materiales (1/2)').toBeGreaterThanOrEqual(10);
    await cleanScene(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/catalogo-materiales-1.png` });
  });

  test('catálogo de materiales (2/2) — 9 tipos restantes en 2 columnas, sin solapamiento', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const items = ['Miniportería', 'Portería grande', 'Valla', 'Aro', 'Escalera', 'Minitrampolín', 'Peto', 'Chaleco lastrado', 'Mancuerna / pesa'];
    // 2 columnas anchas + 5 filas → etiquetas largas ("Chaleco lastrado", "Mancuerna / pesa") sin solaparse.
    const cols = [0.28, 0.72];
    const rows = [0.1, 0.26, 0.42, 0.58, 0.74];
    for (let i = 0; i < items.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      await placeMaterial(page, host, fit, items[i], cols[col], rows[row]);
      await placeText(page, host, fit, items[i], cols[col], rows[row] + 0.08);
    }
    expect(loadManifest().materials.length, 'se colocaron los 9 materiales (2/2)').toBeGreaterThanOrEqual(9);
    await cleanScene(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/catalogo-materiales-2.png` });
  });

  test('catálogo de jugadores — familias etiquetadas (reales, propio, rival, portero)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const spots: Array<[number, number]> = [
      [0.2, 0.28], [0.5, 0.28], [0.8, 0.28],
      [0.2, 0.6], [0.5, 0.6], [0.8, 0.6],
    ];
    await placeRealPlayer(page, host, fit, 'Marcos', 'p1', spots[0][0], spots[0][1]);
    await placeRealPlayer(page, host, fit, 'Pau', 'p2', spots[1][0], spots[1][1]);
    await placeGenericByTitle(page, host, fit, 'Jugador propio', spots[2][0], spots[2][1]);
    await placeGenericByTitle(page, host, fit, 'Jugador rival', spots[3][0], spots[3][1]);
    await placeTrayPlayer(page, host, fit, 'Jugador Azul', spots[4][0], spots[4][1]);
    await placeTrayPlayer(page, host, fit, 'Jugador Rojo', spots[5][0], spots[5][1]);
    // Etiquetas de familia bajo cada jugador (sin taparse entre sí ni el objeto).
    const labels: Array<[string, number, number]> = [
      ['Marcos (real)', spots[0][0], spots[0][1] + 0.11],
      ['Pau (real)', spots[1][0], spots[1][1] + 0.11],
      ['Propio', spots[2][0], spots[2][1] + 0.11],
      ['Rival', spots[3][0], spots[3][1] + 0.11],
      ['Azul', spots[4][0], spots[4][1] + 0.11],
      ['Rojo', spots[5][0], spots[5][1] + 0.11],
    ];
    for (const [text, lx, ly] of labels) await placeText(page, host, fit, text, lx, ly);
    expect(loadManifest().players.length, 'se colocaron los tipos de jugador').toBeGreaterThanOrEqual(5);

    // Nombres visibles sin halo blanco (fase 10): ningún <text> lleva paint-order/stroke blanco.
    const html = await page.locator('.board-canvas svg').innerHTML();
    expect(html).not.toContain('paint-order:stroke');
    expect(html).not.toContain('stroke:#ffffff');
    await cleanScene(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/catalogo-jugadores.png` });
  });

  test('catálogo de líneas y flechas — 7 tipos con etiqueta/leyenda', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    // Formas en la columna izquierda; etiquetas a la derecha de cada una.
    const defs: Array<[string, [number, number], [number, number], [number, number]]> = [
      ['Línea', [0.06, 0.1], [0.3, 0.1], [0.42, 0.1]],
      ['Flecha (movimiento)', [0.06, 0.22], [0.3, 0.22], [0.42, 0.22]],
      ['Flecha doble sentido', [0.06, 0.34], [0.3, 0.34], [0.42, 0.34]],
      ['Curva izquierda', [0.06, 0.46], [0.28, 0.56], [0.42, 0.46]],
      ['Curva derecha', [0.06, 0.58], [0.28, 0.68], [0.42, 0.58]],
      ['Conducción (zigzag)', [0.06, 0.7], [0.28, 0.8], [0.42, 0.7]],
      ['Dibujo a mano alzada', [0.06, 0.82], [0.28, 0.9], [0.42, 0.82]],
    ];
    for (const [title, from, to, labelAt] of defs) await placeDraw(page, title, from, to);
    const shortLabels: Array<[string, number, number]> = [
      ['Línea', 0.6, 0.1], ['Flecha', 0.6, 0.22], ['Doble', 0.6, 0.34], ['Curva izq', 0.6, 0.46],
      ['Curva', 0.6, 0.58], ['Zigzag', 0.6, 0.7], ['Mano alzada', 0.6, 0.82],
    ];
    for (const [text, lx, ly] of shortLabels) await placeText(page, host, fit, text, lx, ly);
    expect(loadManifest().draw.length, 'se dibujaron las líneas/flechas').toBeGreaterThanOrEqual(6);
    await cleanScene(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/catalogo-lineas-flechas.png` });
  });

  test('catálogo de figuras y texto — rect perímetro, rect rellena, elipse y texto multilínea', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    // Rectángulo SIN relleno (Perímetro).
    await useTool(page, 'Rectángulo', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Perímetro' }).click();
    await expectNewElement(page, 'rect', () => drawShape(page, [0.06, 0.64], [0.3, 0.8]));
    recordPlaced('draw', 'Rectángulo');
    // Rectángulo CON relleno translúcido (Relleno).
    await useTool(page, 'Rectángulo', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Relleno' }).click();
    await expectNewElement(page, 'rect', () => drawShape(page, [0.6, 0.08], [0.9, 0.28]));
    recordPlaced('draw', 'Rectángulo');
    await placeDraw(page, 'Rectángulo', [0.06, 0.08], [0.3, 0.26]);
    await placeDraw(page, 'Círculo / elipse', [0.06, 0.36], [0.32, 0.56]);
    // Texto multilínea.
    await placeText(page, host, fit, 'Línea 1\nLínea 2\nLínea 3', 0.6, 0.5);
    // Etiquetas claras de cada figura (a la derecha o debajo, sin solaparse).
    const labels: Array<[string, number, number]> = [
      ['Rectángulo', 0.38, 0.14],
      ['Círculo / elipse', 0.38, 0.42],
      ['Zona (perímetro)', 0.42, 0.68],
      ['Zona (relleno)', 0.62, 0.32],
      ['Texto multilínea', 0.42, 0.9],
    ];
    for (const [text, lx, ly] of labels) await placeText(page, host, fit, text, lx, ly);
    await cleanScene(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/catalogo-figuras-texto.png` });
  });

  test('cobertura por tipos: cada material y cada herramienta de dibujo aparece en alguna escena', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);

    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const materialTitles = await page.locator('.side-panel-left .rail-btn').evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getAttribute('title') ?? '').filter(Boolean)
    );
    await page.keyboard.press('Escape');

    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const drawTitles = await page.locator('.side-panel-left .rail-btn').evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).getAttribute('title') ?? '').filter(Boolean)
    );

    const placed = loadManifest();
    const missingMaterials = materialTitles.filter((t) => !placed.materials.includes(t));
    const missingDraw = drawTitles.filter((t) => !placed.draw.includes(t));

    expect(missingMaterials, 'materiales del catálogo no cubiertos en las capturas').toEqual([]);
    expect(missingDraw, 'herramientas de dibujo del catálogo no cubiertas en las capturas').toEqual([]);
    expect(materialTitles.length, 'catálogo de materiales no vacío').toBeGreaterThanOrEqual(19);
    expect(drawTitles.length, 'catálogo de dibujo no vacío').toBeGreaterThanOrEqual(9);
    expect(new Set(materialTitles).size, 'sin títulos de material duplicados').toBe(materialTitles.length);
    expect(new Set(drawTitles).size, 'sin títulos de dibujo duplicados').toBe(drawTitles.length);
    expect(placed.materials.length, 'manifiesto cubre todos los materiales').toBe(materialTitles.length);
    expect(placed.draw.length, 'manifiesto cubre todas las herramientas de dibujo').toBe(drawTitles.length);
  });

  test('NEGATIVO: un tipo incorrecto NO satisface la cobertura (balón ≠ cono)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    // Aislar: empezar con un manifiesto vacío para no depender del orden de tests.
    fs.writeFileSync(MANIFEST, JSON.stringify({ materials: [], draw: [], players: [] }), 'utf8');
    const coneBefore = await countType(page, 'cone');
    const ballBefore = await countType(page, 'ball');
    const totalBefore = await countTotal(page);
    // Colocar un BALÓN. La verificación exige el tipo 'ball' y fallaría si se creara otro.
    await placeMaterial(page, host, fit, 'Balón', 0.5, 0.5);
    expect(await countType(page, 'ball') - ballBefore, 'el balón fue creado como tipo ball').toBe(1);
    // Un balón NO es un cono: la cobertura de 'cone' no puede satisfacerse con este elemento.
    expect(await countType(page, 'cone') - coneBefore, 'el balón NO creó un cono').toBe(0);
    expect(await countTotal(page) - totalBefore, 'se creó exactamente UN elemento').toBe(1);
    // Y el manifiesto NO debe registrar 'Cono' por esta colocación (solo 'Balón').
    const m = loadManifest();
    expect(m.materials, 'el manifiesto solo registra el balón').toEqual(['Balón']);
    expect(m.materials.includes('Cono'), 'el balón no se registra como cono').toBe(false);
  });
});
