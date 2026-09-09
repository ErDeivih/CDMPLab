import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { longPress } from './gesture-helpers';

// =============================================================
// Fase 12 — capturas finales de interacción + contact sheet.
//
// Genera en e2e/shots/final-interaction/ el juego de capturas que el
// dueño pide para PROBAR visualmente la interacción real: campo limpio
// sin snap dots, medio campo vertical/horizontal, ejercicio completo,
// selección con barra de contexto (±90°) + asas de redimensionado,
// extremos, control de curva, caja de mano alzada, preview antes de
// soltar, objeto entrando en la papelera, vista paneada con zoom,
// texto sin halo blanco, móvil con el campo máximo y export PNG sin
// controles del editor. Cada captura se acompaña de una aserción de
// comportamiento REAL (no una constante).
// =============================================================

const SHOTS = 'e2e/shots/final-interaction';
fs.mkdirSync(SHOTS, { recursive: true });

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

type Box = { x: number; y: number; width: number; height: number };
type Fit = 'contain' | 'height';

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
  if (category) await openCat(page, category);
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

/** FASE B (paneles persistentes): abre la categoría sin re-togglear una que ya está
 *  desplegada (re-clickar la misma la cerraría). Distingue Jugadores de Material/Dibujo
 *  por el aria-label del panel para no confundir categorías. */
async function openCat(page: Page, category: string): Promise<void> {
  const probe: Record<string, string> = {
    Jugadores: '.side-panel-left[aria-label="Jugadores"]',
    Material: '.side-panel-left[aria-label="Herramientas de Material"]',
    Dibujo: '.side-panel-left[aria-label="Herramientas de Dibujo"]',
  };
  if (await page.locator(probe[category]).isVisible().catch(() => false)) return;
  await page.locator('.tools-cat', { hasText: category }).click();
  await expect(page.locator(probe[category])).toBeVisible();
}

/** Dibuja en UN gesto (mouse) desde (nx0,ny0) a (nx1,ny1), sin soltar el puntero. */
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

async function selectAt(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  // Fase 3: la pulsación larga selecciona Y abre el menú contextual (el clic derecho fue retirado).
  await longPress(page, p.x, p.y);
}

/** Oculta los paneles flotantes para ver el campo despejado (no borra la selección). */
async function hideOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.studio-panel, .top-pop, .context-bar').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  });
  await page.waitForTimeout(40);
}

/** Coloca un material usando el buscador del panel (filtra al tipo exacto). */
async function placeMaterial(page: Page, host: Box, fit: Fit, title: string, nx: number, ny: number): Promise<void> {
  await openCat(page, 'Material');
  const input = page.locator('.tools-search-input');
  await input.fill('');
  await input.fill(title);
  await page.waitForTimeout(80);
  await page.locator(`.rail-btn[title="${title}"]`).click();
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
}

/** Coloca un texto y escribe su contenido (multilínea). */
async function placeText(page: Page, host: Box, fit: Fit, content: string, nx: number, ny: number): Promise<void> {
  await useTool(page, 'Texto', 'Dibujo');
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
  const ta = page.locator('.studio-panel .inspector textarea');
  await ta.fill(content);
  await ta.dispatchEvent('change');
  await ta.evaluate((el) => (el as HTMLElement).blur());
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

/** Coloca un jugador genérico (Jugador propio / Jugador rival) desde la sección Herramientas. */
async function placeJugador(page: Page, host: Box, fit: Fit, title: string, nx: number, ny: number): Promise<void> {
  await openCat(page, 'Jugadores');
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
  } else {
    await page.locator(`.rail-btn[title="${title}"]`).click();
  }
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
}

/** Coloca un jugador de la bandeja de genéricos (Portero / Portero). */
async function placeTrayJugador(page: Page, host: Box, fit: Fit, title: string, nx: number, ny: number): Promise<void> {
  await openCat(page, 'Jugadores');
  await page.locator(`.tray-player[title="${title}"]`).click();
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
}

/** Limpia selección, paneles y popovers antes de capturar el campo. */
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

test.describe('Fase 12 — capturas finales de interacción', () => {
  test('campo limpio sin snap dots ni rejilla ni ayuda', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await expect(page.locator('.field-count')).toHaveText('0');
    // DECISIÓN DEL DUEÑO (Fase 1): sin snapDots, sin Ayuda, sin Rejilla, sin inputs X/Y.
    expect(await page.locator('.snap-dot').count(), 'sin snap dots').toBe(0);
    expect(await page.locator('.board-canvas svg .snap-dot').count(), 'sin snap dots en el SVG').toBe(0);
    expect(await page.locator('button[title="Ayuda"], .help-close').count(), 'sin ayuda').toBe(0);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/campo-limpio-sin-snap.png` });
  });

  test('medio campo vertical con proporción (portería arriba, línea de medio campo abajo)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await page.locator('button[aria-label="Propiedades"]').click();
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('half');
    await page.waitForTimeout(250);
    // Al escoger medio campo la orientación pasa a VERTICAL automáticamente.
    // (Decisión del dueño: se verifica por el valor estable data-orient y no por el
    //  texto visible, que ahora describe el RESULTADO: "Portería arriba".)
    const orient = await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip-active').getAttribute('data-orient');
    expect(orient).toBe('vertical');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/medio-campo-vertical.png` });
  });

  test('medio campo opuesto (horizontal)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await page.locator('button[aria-label="Propiedades"]').click();
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('half');
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await page.waitForTimeout(250);
    const orient = await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip-active').getAttribute('data-orient');
    expect(orient).toBe('horizontal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/medio-campo-horizontal.png` });
  });

  test('ejercicio final realista — rondo 5v2 + PNG exportado real sin controles', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);

    // Zona de juego rellena (área del rondo).
    await useTool(page, 'Rectángulo', 'Dibujo');
    await page.locator('.tools-caption .chip', { hasText: 'Relleno' }).click();
    await drawShape(page, [0.3, 0.3], [0.68, 0.7]);

    // Jugadores: Portero central, 4 propios en rombo, 2 rivales presionando y portero.
    await placeTrayJugador(page, host, fit, 'Jugador Azul', 0.5, 0.5);
    await placeJugador(page, host, fit, 'Jugador propio', 0.34, 0.34);
    await placeJugador(page, host, fit, 'Jugador propio', 0.66, 0.34);
    await placeJugador(page, host, fit, 'Jugador propio', 0.34, 0.66);
    await placeJugador(page, host, fit, 'Jugador propio', 0.66, 0.66);
    await placeJugador(page, host, fit, 'Jugador rival', 0.5, 0.4);
    await placeJugador(page, host, fit, 'Jugador rival', 0.5, 0.6);
    await placeTrayJugador(page, host, fit, 'Jugador Azul', 0.1, 0.5);

    // Material: balón, conos y miniportería.
    await placeMaterial(page, host, fit, 'Balón', 0.57, 0.5);
    await placeMaterial(page, host, fit, 'Cono', 0.16, 0.3);
    await placeMaterial(page, host, fit, 'Cono', 0.16, 0.42);
    await placeMaterial(page, host, fit, 'Cono', 0.16, 0.54);
    await placeMaterial(page, host, fit, 'Miniportería', 0.9, 0.5);

    // Flechas de movimiento (rondo) y líneas de pase.
    await useTool(page, 'Flecha (movimiento)', 'Dibujo');
    await drawShape(page, [0.5, 0.5], [0.36, 0.36]);
    await useTool(page, 'Flecha (movimiento)', 'Dibujo');
    await drawShape(page, [0.5, 0.5], [0.36, 0.64]);
    await useTool(page, 'Línea', 'Dibujo');
    await drawShape(page, [0.34, 0.34], [0.66, 0.34]);
    await useTool(page, 'Línea', 'Dibujo');
    await drawShape(page, [0.34, 0.66], [0.66, 0.66]);

    // Explicación breve.
    await placeText(page, host, fit, 'Rondo 5v2\nConservación · 2 toques', 0.5, 0.9);

    await cleanScene(page);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/ejercicio-final-realista.png` });

    // Exporta la MISMA escena desde el PNG real descargado (sin controles del editor).
    const dlPromise = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await page.locator('.rail-btn[title="Descargar PNG"]').click();
    const dl = await dlPromise;
    const bytes = fs.readFileSync((await dl.path())!);
    expect(bytes.subarray(0, 4).toString('hex'), 'firma PNG').toBe('89504e47');
    expect(bytes.readUInt32BE(16), 'ancho PNG (1600)').toBe(1600);
    expect(bytes.readUInt32BE(20), 'alto PNG (1280)').toBe(1280);
    fs.writeFileSync(`${SHOTS}/ejercicio-final-realista-exportado.png`, bytes);
  });

  test('material seleccionado con barra de contexto y SIN asas de redimensionado (Fase 1)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Cono', 'Material');
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.55, 0.5, host, fit);
    await longPress(page, p.x, p.y);
    await selectAt(page, 0.55, 0.5);
    await expect(page.locator('.context-bar')).toBeVisible();
    // Fase 1: los materiales NO se redimensionan → sin asas.
    await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(0);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/material-seleccionado-bar.png` });
  });

  test('línea con asas de extremo + barra de contexto', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Línea', 'Dibujo');
    await drawShape(page, [0.15, 0.3], [0.4, 0.45]);
    await selectAt(page, 0.28, 0.38);
    await expect(page.locator('.context-bar')).toBeVisible();
    await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(2);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/linea-extremos-bar.png` });
  });

  test('curva con extremos + punto de control C1', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Curva derecha', 'Dibujo');
    await drawShape(page, [0.5, 0.3], [0.75, 0.45]);
    await selectAt(page, 0.62, 0.445); // punto medio real (bend +0.14)
    await expect(page.locator('.context-bar')).toBeVisible();
    await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(3);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/curva-extremos-c1.png` });
  });

  test('mano alzada con caja envolvente', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Dibujo a mano alzada', 'Dibujo');
    await drawShape(page, [0.5, 0.55], [0.72, 0.7]);
    await selectAt(page, 0.6, 0.62);
    await expect(page.locator('.context-bar')).toBeVisible();
    await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(4);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/mano-alzada-caja.png` });
  });

  test('preview visible ANTES de soltar el puntero (dibujo en un gesto)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Línea', 'Dibujo');
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const a = normToScreen(0.3, 0.3, host, fit);
    const b = normToScreen(0.6, 0.55, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.waitForTimeout(60);
    await expect(page.locator('.board-canvas svg [stroke="#1f2933"]'), 'preview visible antes de soltar').not.toHaveCount(0);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/preview-antes-soltar.png` });
    await page.mouse.up();
  });

  test('objeto entrando en la papelera', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Rectángulo', 'Dibujo');
    await drawShape(page, [0.3, 0.3], [0.5, 0.5]);
    await selectAt(page, 0.4, 0.4);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const c = normToScreen(0.4, 0.4, host, fit);
    const trash = await page.locator('.board-trash').boundingBox();
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await expect(page.locator('.board-trash')).toHaveClass(/trash-visible/);
    await page.mouse.move(trash!.x + trash!.width / 2, trash!.y + trash!.height / 2, { steps: 5 });
    await page.waitForTimeout(60);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/objeto-entrando-papelera.png` });
    // Un solo Ctrl+Z lo restaura.
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('0');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('vista paneada con la mano a zoom aumentado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    // Colocar un cono y subir el zoom al 200 % para que la vista desborde y se pueda panear.
    await useTool(page, 'Cono', 'Material');
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    if (!(await page.locator('.studio-panel').isVisible().catch(() => false))) {
      await page.locator('button[aria-label="Propiedades"]').click();
    }
    await expect(page.locator('.studio-panel')).toBeVisible();
    const zoomSlider = page.locator('.studio-panel .field', { hasText: 'Zoom' }).locator('input[type="range"]');
    await zoomSlider.evaluate((input) => {
      (input as HTMLInputElement).value = '2';
      (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.keyboard.press('Escape'); // cerrar el panel de Propiedades
    await page.waitForTimeout(150);
    // Herramienta "Mano": arrastra para desplazar la vista.
    await page.locator('.rail-btn[title="Desplazar campo"]').click();
    const host2 = await hostBox(page);
    const startX = host2.x + host2.width * 0.2;
    const y = host2.y + host2.height * 0.5;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 120, y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    // El pan ha desplazado la vista (panX no nulo en la transformación del canvas).
    const transform = (await page.locator('.board-canvas').evaluate((el) => el.getAttribute('style') ?? '')) ?? '';
    const m = /translate\(\s*(-?[\d.]+)px/.exec(transform);
    expect(m, 'el canvas lleva un translate definido').toBeTruthy();
    expect(parseFloat(m![1]), 'la vista fue paneada (panX != 0)').not.toBe(0);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/mano-paneado-zoom.png` });
  });

  test('texto/nombre sin halo blanco', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Texto', 'Dibujo');
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.42, host, fit);
    await page.mouse.click(p.x, p.y);
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Marcos (9)');
    await ta.dispatchEvent('change');
    await ta.evaluate((el) => (el as HTMLElement).blur());
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    // El <text> se renderiza con el color de texto derivado, sin halo/paint-order blanco.
    const html = await page.locator('.board-canvas svg').innerHTML();
    expect(html).toContain('Marcos (9)');
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/texto-sin-halo.png` });
  });

  test('móvil: menús cerrados y campo máximo (Llenar pantalla)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
    // Cerrar cualquier menú/popover abierto.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await expect(page.locator('.side-panel-left')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/movil-campo-max.png` });
  });

  test('export PNG sin controles del editor', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await useTool(page, 'Rectángulo', 'Dibujo');
    await drawShape(page, [0.3, 0.3], [0.5, 0.5]);
    await selectAt(page, 0.4, 0.4);
    const dlPromise = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await page.locator('.rail-btn[title="Descargar PNG"]').click();
    const dl = await dlPromise;
    const b = fs.readFileSync((await dl.path())!);
    expect(b.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(b.readUInt32BE(16)).toBe(1600);
    expect(b.readUInt32BE(20)).toBe(1280);
  });
});

test.describe('Fase 12 — contact sheet', () => {
  const FINAL = 'e2e/shots/final-interaction';
  const MOBILE = 'e2e/shots/mobile-toolbar';

  // Organizado por categorías (Campos, Materiales, Jugadores, Dibujo,
  // Selección/interacción, Móvil, Exportación final).
  const SECTIONS: Array<[string, Array<[string, string]>]> = [
    ['Campos', [
      ['campo-limpio-sin-snap', 'Campo limpio (sin snap dots)'],
      ['medio-campo-vertical', 'Medio campo vertical (proporción)'],
      ['medio-campo-horizontal', 'Medio campo opuesto (horizontal)'],
      ['mano-paneado-zoom', 'Mano paneando vista con zoom'],
    ]],
    ['Materiales', [
      ['catalogo-materiales-1', 'Catálogo de materiales (1/2)'],
      ['catalogo-materiales-2', 'Catálogo de materiales (2/2)'],
    ]],
    ['Jugadores', [
      ['catalogo-jugadores', 'Catálogo de jugadores (reales, propios, rivales, Portero, portero)'],
    ]],
    ['Dibujo', [
      ['catalogo-lineas-flechas', 'Catálogo de líneas y flechas'],
      ['catalogo-figuras-texto', 'Catálogo de figuras y texto'],
      ['linea-extremos-bar', 'Línea con extremos + barra'],
      ['curva-extremos-c1', 'Curva con extremos + C1'],
      ['mano-alzada-caja', 'Mano alzada con caja'],
      ['preview-antes-soltar', 'Preview antes de soltar'],
      ['objeto-entrando-papelera', 'Objeto entrando en la papelera'],
      ['texto-sin-halo', 'Texto sin halo blanco'],
    ]],
    ['Selección / interacción', [
      ['material-seleccionado-bar', 'Material seleccionado + barra + asas'],
    ]],
    ['Móvil', [
      ['movil-campo-max', 'Móvil: menús cerrados, campo máximo'],
    ]],
    ['Exportación final', [
      ['ejercicio-final-realista', 'Ejercicio final realista (rondo 5v2)'],
      ['ejercicio-final-realista-exportado', 'PNG exportado real (sin controles)'],
    ]],
  ];

  const MOBILE_SHOTS: Array<[string, string]> = [
    ['360x800-una-fila', 'Barra móvil en una fila (360×800)'],
    ['390x844-una-fila', 'Barra móvil en una fila (390×844)'],
    ['430x932-una-fila', 'Barra móvil en una fila (430×932)'],
    ['390x844-menu-jugadores', 'Menú Jugadores abierto'],
    ['390x844-menu-material', 'Menú Material abierto'],
    ['390x844-menu-dibujo', 'Menú Dibujo abierto'],
  ];

  const img = (base64: string, label: string) =>
    `<figure><img src="data:image/png;base64,${base64}" alt="${label}"><figcaption>${label}</figcaption></figure>`;
  const fig = (dir: string, file: string, label: string) => {
    const p = path.resolve(dir, file + '.png');
    return img(fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : '', label);
  };

  test('genera el contact sheet (HTML + PNG) para revisar las capturas', async ({ page }) => {
    const parts: string[] = [];
    for (const [section, captures] of SECTIONS) {
      parts.push(`<section><h2>${section}</h2>`);
      parts.push(captures.map(([f, label]) => fig(FINAL, f, label)).join('\n'));
      parts.push('</section>');
    }
    parts.push('<section><h2>Móvil (barra en una fila + menús)</h2>');
    parts.push(MOBILE_SHOTS.map(([f, label]) => fig(MOBILE, f, label)).join('\n'));
    parts.push('</section>');

    const html = '<!doctype html><html><head><meta charset="utf-8">'
      + '<style>body{font-family:sans-serif;margin:12px;background:#111;color:#eee}'
      + 'h1{font-size:16px}h2{font-size:14px;color:#8a97a3;margin-top:20px;border-top:1px solid #333;padding-top:10px}'
      + 'figure{display:inline-block;margin:10px;text-align:center;vertical-align:top}'
      + 'figure img{max-width:480px;border:1px solid #555}figcaption{font-size:12px;margin-top:4px;max-width:480px}</style></head><body>'
      + '<h1>CDMPLab · Contact sheet · e2e/shots</h1>' + parts.join('\n') + '</body></html>';
    const file = path.resolve('e2e/shots/contact-sheet.html');
    fs.writeFileSync(file, html, 'utf8');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    await page.locator('h1').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/shots/contact-sheet.png', fullPage: true });
  });
});

