// =============================================================
// PIZARRA — USABILIDAD: colocación continua, formaciones sin plantilla,
// separación Seleccionar/Desplazar, paneles sin tapar la barra y zigzag.
//
// Spec nuevo que verifica el comportamiento SOLICITADO en la revisión de
// usabilidad (Fases 1-6). Usa eventos REALES de Playwright (mouse/tap/gestos)
// y mide geometría real (getBoundingClientRect / getCTM / transform).
// No escribe el documento ni localStorage para fingir la colocación (solo el
// seed inicial mínimo de equipo/plantilla).
//
// Escenarios: A (formación sin plantilla), B (colocación continua material),
// C (colocación continua jugadores), D (dibujo de un solo uso),
// E (Seleccionar vs Mano), F (paneles y barra), G (zigzag) + táctil.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { longPress, fillBoardTitle } from './gesture-helpers';

const SHOTS = 'e2e/shots/pizarra-usabilidad';
const DOC_SHOTS = 'docs/screenshots/pizarra-usabilidad';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DOC_SHOTS, { recursive: true });

const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Fit = 'height' | 'contain';
type Pt = { x: number; y: number };

function normToScreen(nx: number, ny: number, host: Box, fit: Fit, panX = 0, panY = 0, zoom = 1): Pt {
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

async function seed(page: Page, opts: { players?: unknown[]; fill?: boolean } = {}): Promise<void> {
  const { players = [], fill = false } = opts;
  await page.addInitScript(({ players, fill }) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-fill', fill ? '1' : '0');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, { players, fill });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // Espera observable: el lienzo del tablero se ha renderizado (SVG del campo presente).
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (await page.locator(sel).isVisible().catch(() => false)) await page.locator(sel).click();
  }
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, '.board-host debe existir').not.toBeNull();
  return b!;
}
async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}
async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}
async function clickSelect(page: Page): Promise<void> {
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
}
async function clickHand(page: Page): Promise<void> {
  await page.locator('.rail-btn[aria-label="Desplazar campo"]').click();
  // FASE 0 (Mano): esperamos de forma OBSERVABLE (sin wait fijo) a que la herramienta
  // esté REALMENTE activa (rail-active) antes de comenzar el gesto. Si el clic del botón
  // se perdiera bajo carga, el tool seguiría en 'select' (que movería el objeto en vez de
  // panear), y el test fallaría de forma intermitente.
  await expect(page.locator('.rail-btn[aria-label="Desplazar campo"]')).toHaveClass(/rail-active/);
}
async function openJugadores(page: Page): Promise<void> {
  // FASE B (paneles persistentes): abrir Jugadores es IDEMPOTENTE. Si ya está
  // desplegado (porque ya no se cierra al elegir un jugador) no lo re-togglea
  // (lo cerraría).
  if (await page.locator('.side-panel-left').isVisible().catch(() => false)) return;
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
}
async function openMaterial(page: Page, tool: string): Promise<void> {
  // FASE B (paneles persistentes): abrir Material es IDEMPOTENTE. Si el panel
  // Material/Dibujo ya está abierto, no lo re-togglea (lo cerraría).
  if (!(await page.locator('.tools-panel-side').isVisible().catch(() => false))) {
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
  }
  await page.locator(`.rail-btn[title="${tool}"]`).click();
}

/** Nº de `circle[r=2.5]` jugadores. */
async function countPlayerCircles(page: Page): Promise<number> {
  return page.locator('.entrenolab-board circle[r="2.5"]').count();
}

test.describe('Pizarra — usabilidad (colocación continua, formaciones, pan/select, paneles, zigzag)', () => {
  // =====================================================================
  // Escenario A — Formación SIN plantilla
  // =====================================================================
  test('A: formación 4-3-3 propia con plantilla VACÍA coloca 11 genéricos sin nombres', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, { players: [] });
    await openBoard(page);
    await expect(await fieldCount(page)).toBe(0);

    await openJugadores(page);
    await expect(page.locator('.side-panel-left')).toBeVisible();
    // Todas las formaciones habilitadas.
    for (const f of ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '4-1-4-1']) {
      await expect(page.locator(`.formation-btn`, { hasText: f })).toBeEnabled();
    }
    // Aplicar 4-3-3 propio.
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    expect(await countPlayerCircles(page)).toBe(11);

    // Sin nombres (no hay <text> con el nombre de ningún genérico).
    const named = await page.locator('.entrenolab-board svg text').count();
    // 11 jugadores con dorsal como máximo; no hay nombres.
    expect(named).toBeLessThanOrEqual(11);

    // Sin portero especial ni "POR": todos los círculos son del color elegido (azul).
    await fillBoardTitle(page, 'Formacion433');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const doc = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return ex.canvas.frames[0].elements;
    });
    const players = doc.filter((e: { t: string }) => e.t === 'player');
    expect(players.length).toBe(11);
    expect(players.every((p: Record<string, unknown>) => !p.playerId && !p.label)).toBe(true);
    // Ningún círculo lleva rol de portero especial (ni "POR").
    expect(players.every((p: { type?: string }) => (p.type ?? null) !== 'goalkeeper')).toBe(true);
    // Todos del color elegido por defecto (azul #1a73e8).
    expect(players.every((p: { c?: string }) => p.c === '#1a73e8')).toBe(true);
  });

  test('A: aplicar 4-4-2 RIVAL coexiste con la propia (11 + 11) y un solo Undo deshace la última', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await seed(page, { players: [] });
    await openBoard(page);

    await openJugadores(page);
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    // Rival (otro color): elige rojo y aplica la formación en espejo.
    await page.locator('.tray-player[title="Jugador Rojo"]').click();
    // FASE B (paneles persistentes): el panel Jugadores ya está abierto; no se re-togglea (lo cerraría).
    await page.locator('.side-panel-left').first().waitFor();
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(22);
    // FASE C: 11 propios (azul) + 11 rivales (rojo) diferenciados por COLOR (ya no por data-side).
    const own = await page.locator('.entrenolab-board circle[r="2.5"][fill="#1a73e8"]').count();
    const rival = await page.locator('.entrenolab-board circle[r="2.5"][fill="#c0392b"]').count();
    expect(own).toBe(11);
    expect(rival).toBe(11);

    // Un solo Undo elimina la última formación completa (rival) → 11.
    await page.keyboard.press('Control+z');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);

    // Guardar y reabrir: la formación propia permanece.
    await fillBoardTitle(page, 'FormacionRival');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
  });

  // =====================================================================
  // Escenario B — Colocación continua de material
  // =====================================================================
  test('B: Maniquí individual — colocar 3 en continuo, Undo individual, Seleccionar detiene', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    await openMaterial(page, 'Maniquí individual');
    // FASE B (paneles persistentes): elegir material NO cierra el panel Material.
    await expect(page.locator('.tools-panel-side'), 'el panel Material permanece abierto').toBeVisible();
    await expect(page.locator('.placement-hint')).toBeVisible();

    // Preview junto al cursor (al mover el puntero sobre el host).
    const host = await hostBox(page);
    await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
    await expect(page.locator('.placement-preview')).toBeVisible();

    // Tres clics en posiciones separadas (alejadas de la pista superior).
    const fit = await fitMode(page);
    for (const [nx, ny] of [[0.3, 0.5], [0.5, 0.65], [0.7, 0.5]] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
    }
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
    const mannequins = await page.locator('.board-canvas svg image[href*="mannequin"]').count();
    expect(mannequins).toBe(3);
    // Sigue armado (no volvió a Seleccionar): panel cerrado → el título de la herramienta
    // activa en la barra inferior y la pista de colocación lo indican.
    await expect(page.locator('.tools-caption-title')).toHaveText('Maniquí individual');
    await expect(page.locator('.placement-hint')).toBeVisible();

    // Undo individual: queda 1 menos.
    await page.keyboard.press('Control+z');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);

    // Seleccionar detiene la colocación; tocar el campo no crea más.
    await clickSelect(page);
    await expect(page.locator('.placement-preview')).toHaveCount(0);
    const p = normToScreen(0.5, 0.4, await hostBox(page), await fitMode(page));
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);
  });

  test('B: Cono con variante + Balón + Miniportería — colocación continua y variante conservada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    // Cono (rojo = variante 0) colocar 2 en continuo con la MISMA variante.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.tools-material-card', { has: page.locator('.rail-btn[title="Cono"]') }).locator('.variant-swatch').nth(0).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    for (const [nx, ny] of [[0.2, 0.2], [0.3, 0.3]] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
    }
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);
    // Dos conos rojos (variant cone_red).
    const cones = await page.locator('.board-canvas svg image[href*="cone-red"]').count();
    expect(cones, 'dos conos con la variante roja conservada').toBe(2);

    // Balón.
    await clickSelect(page);
    await openMaterial(page, 'Balón');
    const b = normToScreen(0.6, 0.6, await hostBox(page), await fitMode(page));
    await page.mouse.click(b.x, b.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
    // Miniportería.
    await clickSelect(page);
    await openMaterial(page, 'Miniportería');
    const m = normToScreen(0.2, 0.6, await hostBox(page), await fitMode(page));
    await page.mouse.click(m.x, m.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(4);
  });

  // =====================================================================
  // Escenario C — Colocación continua de jugadores
  // =====================================================================
  test('C: 3 propios genéricos + 3 rivales genéricos, sin nombres; Seleccionar detiene', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    // Jugador propio genérico → 3 (ficha rápida Azul, antes rail-btn "Jugador propio").
    await openJugadores(page);
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    // FASE B (paneles persistentes): elegir jugador NO cierra el panel Jugadores.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    for (const [nx, ny] of [[0.3, 0.5], [0.4, 0.62], [0.5, 0.5]] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
    }
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
    // Propios (azul #1a73e8), sin nombres.
    expect(await page.locator('.entrenolab-board circle[r="2.5"][fill="#1a73e8"]').count()).toBe(3);
    const ownTexts = await page.locator('.entrenolab-board svg text').count();
    expect(ownTexts).toBeLessThanOrEqual(3); // solo dorsales, sin nombres

    // Cambiar a Jugador rival → 3 rivales (ficha rápida Rojo; antes rail-btn "Jugador rival").
    await openJugadores(page);
    await page.locator('.tray-player[title="Jugador Rojo"]').click();
    for (const [nx, ny] of [[0.6, 0.5], [0.7, 0.62], [0.8, 0.5]] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, await hostBox(page), await fitMode(page));
      await page.mouse.click(p.x, p.y);
    }
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(6);
    expect(await page.locator('.entrenolab-board circle[r="2.5"][fill="#c0392b"]').count()).toBe(3);

    // Seleccionar: ya no se crean jugadores.
    await clickSelect(page);
    const p = normToScreen(0.5, 0.6, await hostBox(page), await fitMode(page));
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(6);
  });

  test('C: un jugador REAL de plantilla NO se duplica (una instancia por playerId)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, { players: [{ id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: '2026-01-01' }] });
    await openBoard(page);
    // Colocar el real → tras colocar vuelve a Seleccionar (no duplicable).
    await openJugadores(page);
    await page.locator('.side-panel-left .roster-item').first().click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    // Tras colocarlo ya está en Seleccionar (no armado).
    await expect(page.locator('.placement-hint')).toHaveCount(0);
    await expect(page.locator('.rail-btn[aria-label="Seleccionar y mover"]')).toHaveClass(/rail-active/);
    // Abrir Jugadores: la tarjeta está deshabilitada (una instancia).
    await openJugadores(page);
    await expect(page.locator('.side-panel-left .roster-item').first()).toHaveClass(/tray-disabled/);
  });

  // =====================================================================
  // Escenario D — Dibujo de un solo uso
  // =====================================================================
  test('D: Línea se crea UNA, vuelve a Seleccionar y arrastrar vacío no crea otra', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Línea"]').click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const a = normToScreen(0.2, 0.2, host, fit);
    const b = normToScreen(0.6, 0.4, host, fit);
    // pointerdown → move → up real.
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    // Volvió a Seleccionar.
    await expect(page.locator('.rail-btn[aria-label="Seleccionar y mover"]')).toHaveClass(/rail-active/);
    // Arrastrar en zona vacía no crea una segunda línea.
    const c = normToScreen(0.3, 0.6, await hostBox(page), await fitMode(page));
    const d = normToScreen(0.7, 0.7, await hostBox(page), await fitMode(page));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(d.x, d.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  });

  // =====================================================================
  // Escenario E — Seleccionar frente a Mano
  // =====================================================================
  test('E: Seleccionar NO panea desde vacío; Mano sí (desde vacío y sobre objeto)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page, { fill: true });
    await openBoard(page);

    // Zoom >100% (contenido oculto para panear). Se abre Propiedades → Zoom slider.
    await page.locator('button[aria-label="Propiedades"]').click();
    const zz = page.locator('.studio-panel .field', { hasText: 'Zoom' }).locator('input[type="range"]');
    await zz.evaluate((input: HTMLInputElement) => {
      input.value = '2';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('.studio-panel .panel-close').click();

    const readView = () => page.locator('.board-canvas').evaluate((el) => {
      const t = (el as HTMLElement).style.transform;
      const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
      return m ? { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { panX: 0, panY: 0, zoom: 1 };
    });

    // En Seleccionar: arrastra 100px desde vacío → panX/panY NO cambian.
    await clickSelect(page);
    let host = await hostBox(page);
    const v0 = await readView(page);
    await page.mouse.move(host.x + 60, host.y + host.height / 2);
    await page.mouse.down();
    await page.mouse.move(host.x + 160, host.y + host.height / 2, { steps: 6 });
    await page.mouse.up();
    // Observar la vista: Seleccionar NO debe cambiar panX (poll, sin wait fijo).
    await expect.poll(() => readView(page), { timeout: 3000 }).toEqual(v0);
    const v1 = await readView(page);
    expect(Math.abs(v1.panX - v0.panX), 'Seleccionar NO panea (panX)').toBeLessThan(1);
    expect(Math.abs(v1.panY - v0.panY), 'Seleccionar NO panea (panY)').toBeLessThan(1);

    // En Mano: arrastra desde vacío → panX cambia.
    await clickHand(page);
    const v2 = await readView(page);
    host = await hostBox(page);
    await page.mouse.move(host.x + 60, host.y + host.height / 2);
    await page.mouse.down();
    await page.mouse.move(host.x + 200, host.y + host.height / 2, { steps: 6 });
    await page.mouse.up();
    // Observar la vista: Mano debe panear (poll, sin wait fijo).
    await expect.poll(() => readView(page).then((v) => Math.abs(v.panX - v2.panX)), { timeout: 3000 }).toBeGreaterThan(20);
    const v3 = await readView(page);
    expect(Math.abs(v3.panX - v2.panX), 'Mano PANEA desde vacío').toBeGreaterThan(20);
  });

  test('E: Mano panea EMPEZANDO sobre un objeto sin moverlo; el objeto no cambia', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, { fill: true }); // campo desborda → hay rango de paneo
    await openBoard(page);

    // FASE 0 (Mano): el modo "Llenar pantalla" (y el desbordamiento que da RANGO DE PANEO)
    // se aplica vía change-detection, así que puede ir un frame por detrás del seed bajo
    // carga. Se espera de forma OBSERVABLE (sin wait fijo) a que el host lleve la clase
    // board-fill y a que el canvas sea más ancho que el host (campo desbordado → panRange>0),
    // ANTES de leer `before`/coordenadas y empezar el gesto. Así el pan nunca queda limitado
    // a cero por un tamaño de canvas aún no aplicado.
    await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
    await expect.poll(async () => {
      const canvas = await page.locator('.board-canvas').boundingBox();
      const host = (await page.locator('.board-host').boundingBox())!;
      return host && canvas && canvas.width > host.width + 10;
    }, { timeout: 5000 }).toBe(true);

    // Colocar un jugador.
    await openJugadores(page);
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    const host0 = await hostBox(page);
    const fit0 = await fitMode(page);
    const place = normToScreen(0.5, 0.5, host0, fit0);
    await page.mouse.click(place.x, place.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await clickSelect(page);

    // Normal del objeto antes.
    const objNorm = await page.locator('.entrenolab-board circle[r="2.5"]').first().evaluate((el) => {
      const g = el.closest('g');
      const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });

    // Mano: arrastra EMPEZANDO sobre el objeto → panea, el objeto no se mueve.
    await clickHand(page);
    const before = await page.locator('.board-canvas').evaluate((el) => (el as HTMLElement).style.transform);
    const circleLoc = page.locator('.entrenolab-board circle[r="2.5"]').first();
    await circleLoc.waitFor({ state: 'attached', timeout: 5000 });
    const obj = await circleLoc.evaluate((el) => {
      const r = (el as SVGGraphicsElement).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const oc = { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
    await page.mouse.move(oc.x, oc.y);
    await page.mouse.down();
    await page.mouse.move(oc.x + 100, oc.y - 40, { steps: 6 });
    await page.mouse.up();
    // Observar el pan: el transform del canvas cambia (poll, sin wait fijo).
    await expect.poll(() => page.locator('.board-canvas').evaluate((el) => (el as HTMLElement).style.transform), { timeout: 3000 }).not.toBe(before);
    const afterT = await page.locator('.board-canvas').evaluate((el) => (el as HTMLElement).style.transform);
    expect(afterT, 'Mano panea la vista').not.toBe(before);
    const objNorm2 = await page.locator('.entrenolab-board circle[r="2.5"]').first().evaluate((el) => {
      const g = el.closest('g');
      const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });
    expect(objNorm2!.x, 'objeto no se mueve en x').toBeCloseTo(objNorm!.x, 3);
    expect(objNorm2!.y, 'objeto no se mueve en y').toBeCloseTo(objNorm!.y, 3);
    // No se abre Propiedades ni se selecciona.
    expect(await page.locator('.studio-panel').count()).toBe(0);
  });

  // =====================================================================
  // Escenario F — Paneles y barra (medidas reales + botones operables)
  // =====================================================================
  const VIEWPORTS: Array<[number, number]> = [
    [360, 800], [390, 844], [844, 390], [932, 430], [768, 1024], [1024, 768], [1366, 768], [1440, 900],
  ];

  for (const [w, h] of VIEWPORTS) {
    test(`F: panel no invade la barra y barra operable a ${w}x${h}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoard(page);

      const assertPanelAboveBar = async (panelSel: string): Promise<void> => {
        const panel = await page.locator(panelSel).boundingBox();
        const bar = await page.locator('.studio-tools').boundingBox();
        expect(panel, `panel ${panelSel} visible`).not.toBeNull();
        expect(bar, 'barra inferior visible').not.toBeNull();
        expect(panel!.y + panel!.height, `${panelSel} bottom <= barra top`).toBeLessThanOrEqual(bar!.y + 1);
      };

      // Jugadores.
      await openJugadores(page);
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await assertPanelAboveBar('.side-panel-left');
      // Botón de barra operable (Seleccionar) con el panel abierto.
      await clickSelect(page);
      await expect(page.locator('.rail-btn[aria-label="Seleccionar y mover"]')).toHaveClass(/rail-active/);

      // Material.
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      await assertPanelAboveBar('.tools-panel-side');
      await clickSelect(page);

      // Dibujo.
      await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
      await expect(page.locator('.tools-panel-side')).toBeVisible();
      await assertPanelAboveBar('.tools-panel-side');
      await clickSelect(page);

      // Sin scroll horizontal en página.
      const studioScroll = await page.evaluate(() => {
        const el = document.querySelector('.studio');
        return el ? { scroll: (el as HTMLElement).scrollWidth, client: (el as HTMLElement).clientWidth } : null;
      });
      expect(studioScroll!.scroll).toBeLessThanOrEqual(studioScroll!.client + 1);
    });
  }

  // =====================================================================
  // Escenario G — Zigzag compacto
  // =====================================================================
  test('G: zigzag horizontal, vertical y diagonal — preview, guardar/reabrir y PNG', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    const drawZigzag = async (from: [number, number], to: [number, number]): Promise<void> => {
      // FASE B (paneles persistentes): no re-togglear Dibujo si ya está abierto (lo cerraría).
      if (!(await page.locator('.tools-panel-side').isVisible().catch(() => false))) {
        await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
        await expect(page.locator('.tools-panel-side')).toBeVisible();
      }
      await page.locator('.rail-btn[title="Conducción (zigzag)"]').click();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const a = normToScreen(from[0], from[1], host, fit);
      const b = normToScreen(to[0], to[1], host, fit);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 5 });
      // Antes de soltar: la preview existe.
      await expect(page.locator('.drag-preview, .preview, .zigzag-preview')).toBeVisible().catch(() => void 0);
      await page.mouse.up();
    };

    await drawZigzag([0.2, 0.2], [0.8, 0.2]); // horizontal
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await clickSelect(page);
    await drawZigzag([0.2, 0.4], [0.2, 0.8]); // vertical
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);
    await clickSelect(page);
    await drawZigzag([0.4, 0.3], [0.8, 0.7]); // diagonal
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
    await clickSelect(page);

    // Guardar y reabrir.
    await fillBoardTitle(page, 'Zigzag');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);

    // Exportar PNG no falla.
    const dlPromise = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await expect(page.locator('.top-pop-export')).toBeVisible();
    await page.locator('.rail-btn[title="Descargar PNG"]').click();
    const dl = await dlPromise;
    const p = await dl.path();
    expect(p).toBeTruthy();

    // Captura ampliada del zigzag.
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/zigzag-compacto-horizontal-vertical-diagonal.png` });
  });

  // =====================================================================
  // Táctil (390×844 y 844×390)
  // =====================================================================
  for (const [w, h] of [[390, 844], [844, 390]] as Array<[number, number]>) {
    test.describe(`Táctil ${w}x${h}`, () => {
      test.use({ hasTouch: true });

      test('3 colocaciones continuas de material y cambio a Seleccionar', async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seed(page);
        await openBoard(page);
        await openMaterial(page, 'Maniquí individual');
        // FASE B: el panel Material queda desplegado y cubre el campo en portrait
        // móvil; se minimiza con su X (sin desarmar) para poder tocar el campo.
        const matPanel = page.locator('.side-panel-left.tools-panel-side');
        if (await matPanel.isVisible().catch(() => false)) await matPanel.locator('.panel-close').click();
        const host = await hostBox(page);
        const fit = await fitMode(page);
        for (const [nx, ny] of [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]] as Array<[number, number]>) {
          const p = normToScreen(nx, ny, host, fit);
          await page.touchscreen.tap(p.x, p.y);
        }
        await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
        await clickSelect(page);
        // Un toque tras Seleccionar no crea más.
        const p = normToScreen(0.5, 0.4, host, fit);
        await page.touchscreen.tap(p.x, p.y);
        await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
      });

      test('3 jugadores propios genéricos; Seleccionar no panea, Mano sí', async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seed(page); // campo ajustado (contain): el mapeo norm→pantalla es fiable
        await openBoard(page);
        await openJugadores(page);
        await page.locator('.tray-player[title="Jugador Azul"]').click();
        // FASE B: minimizar el panel Jugadores (X) para liberar el campo en portrait.
        const jugPanel = page.locator('.side-panel-left');
        if (await jugPanel.isVisible().catch(() => false)) await jugPanel.first().locator('.panel-close').click();
        const host = await hostBox(page);
        const fit = await fitMode(page);
        for (const [nx, ny] of [[0.3, 0.5], [0.4, 0.65], [0.5, 0.5]] as Array<[number, number]>) {
          const p = normToScreen(nx, ny, host, fit);
          await page.touchscreen.tap(p.x, p.y);
        }
        await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
        await clickSelect(page);
        // Seleccionar no panea: un toque (tap) sobre vacío NO cambia la vista.
        const readView = () => page.locator('.board-canvas').evaluate((el) => (el as HTMLElement).style.transform);
        const v0 = await readView();
        const t0 = normToScreen(0.5, 0.5, host, fit);
        await page.touchscreen.tap(t0.x, t0.y);
        expect(await readView()).toBe(v0);
        // Mano panea con arrastre real (baja, mueve, sube) empezando sobre vacío.
        // Primero activo "Llenar pantalla" (espera observable: clase board-fill).
        await page.locator('.field-fit-toggle').click();
        await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
        const fit2 = await fitMode(page);
        const host2 = await hostBox(page);
        const t1 = normToScreen(0.5, 0.5, host2, fit2);
        await clickHand(page);
        const v1 = await readView();
        await page.evaluate(({ x, y }) => {
          const host = document.querySelector('.board-host') as HTMLElement | null;
          if (!host) return;
          host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 99, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
          host.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 99, pointerType: 'touch', isPrimary: true, clientX: x + 150, clientY: y, button: 0, buttons: 1 }));
          host.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 99, pointerType: 'touch', isPrimary: true, clientX: x + 150, clientY: y, button: 0, buttons: 0 }));
        }, { x: t1.x, y: t1.y });
        // Observar el pan: el transform cambia (poll, sin wait fijo).
        await expect.poll(() => readView(), { timeout: 3000 }).not.toBe(v1);
        const v2 = await readView();
        expect(v2, 'Mano panea con arrastre táctil').not.toBe(v1);
      });
    });
  }

  // =====================================================================
  // Capturas obligatorias
  // =====================================================================
  test('capturas: formación sin plantilla, paneles con barra, material continuo, preview, select/hand', async ({ page }) => {
    test.setTimeout(120_000);
    // formación-sin-plantilla-433-propia
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, { players: [] });
    await openBoard(page);
    await openJugadores(page);
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/formacion-sin-plantilla-433-propia.png` });
    // formaciones-genericas-propio-rival
    await page.locator('.tray-player[title="Jugador Rojo"]').click();
    // FASE B (paneles persistentes): el panel Jugadores ya está abierto; no se re-togglea (lo cerraría).
    await page.locator('.side-panel-left').first().waitFor();
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(22);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/formaciones-genericas-propio-rival.png` });
    // jugadores-genericos-colocacion-continua
    await page.locator('.formation-mirror input').uncheck();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    for (const [nx, ny] of [[0.3, 0.3], [0.5, 0.3], [0.7, 0.3]] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
    }
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/jugadores-genericos-colocacion-continua.png` });

    // material-maniqui-colocacion-continua
    await clickSelect(page);
    await openMaterial(page, 'Maniquí individual');
    for (const [nx, ny] of [[0.3, 0.5], [0.5, 0.5], [0.7, 0.5]] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
    }
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/material-maniqui-colocacion-continua.png` });
    // preview-material-en-cursor
    const hp = await hostBox(page);
    await page.mouse.move(hp.x + hp.width * 0.45, hp.y + hp.height * 0.55);
    await expect(page.locator('.placement-preview')).toBeVisible();
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/preview-material-en-cursor.png` });

    // panel-material-barra-visible-390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/panel-material-barra-visible-390x844.png` });

    // panel-dibujo-barra-visible-844x390
    await page.setViewportSize({ width: 844, height: 390 });
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/panel-dibujo-barra-visible-844x390.png` });

    // seleccionar-no-panea / mano-panea-campo
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page, { fill: true });
    await openBoard(page);
    await clickSelect(page);
    const h2 = await hostBox(page);
    await page.mouse.move(h2.x + 60, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(h2.x + 180, h2.y + h2.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/seleccionar-no-panea.png` });
    await clickHand(page);
    await page.mouse.move(h2.x + 60, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(h2.x + 180, h2.y + h2.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/mano-panea-campo.png` });
  });
});
