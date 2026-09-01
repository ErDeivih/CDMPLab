import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/d3-mobile-hints';
fs.mkdirSync(SHOTS, { recursive: true });

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en horizontal.
 *  `fit` = 'height' (llenar pantalla) | 'contain' (campo completo). */
function normToScreen(
  nx: number,
  ny: number,
  host: Box,
  fit: 'height' | 'contain',
  panX = 0,
  panY = 0,
  zoom = 1
): { x: number; y: number } {
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

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    // Fase 2: este spec prueba la pista de "Llenar pantalla" en aislamiento; se descarta
    // el aviso de orientación para que la pista sea la única visible.
    localStorage.setItem('entrenolab:orient-hint', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Abre la pizarra SIN descartar nada: así vemos el estado inicial de los hints. */
async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // Por defecto (móvil) el modo es "Llenar pantalla".
  await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

/** Cuenta cuántos hints flotantes son visibles ahora mismo (0 o 1). La ayuda inicial
 *  fue RETIRADA por el dueño (decisión Fase 1), así que el único hint es la pista de
 *  "Llenar pantalla". */
async function visibleHints(page: Page): Promise<number> {
  let n = 0;
  if (await page.locator('.fill-hint').isVisible().catch(() => false)) n += 1;
  return n;
}

/** Coloca un Portero en un punto NORMALIZADO (cierra la plantilla y toca el campo). */
async function placeComodin(page: Page, nx: number, ny: number): Promise<{ x: number; y: number }> {
  const host = await hostBox(page);
  const S = normToScreen(nx, ny, host, 'height');
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Portero"]').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
  await page.touchscreen.tap(S.x, S.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  return S;
}

/** Lee panX/panY/zoom del transform inline del `.board-canvas`. */
async function readView(page: Page): Promise<{ panX: number; panY: number; zoom: number }> {
  return page.locator('.board-canvas').evaluate((el) => {
    const t = (el as HTMLElement).style.transform;
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
    return m ? { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { panX: 0, panY: 0, zoom: 1 };
  });
}

/** Despacha un PointerEvent sintético sobre `.board-host` (dos dedos = pinch). */
async function ptr(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number, pointerId: number, isPrimary = false): Promise<void> {
  await page.evaluate(({ type, x, y, pointerId, isPrimary }) => {
    const host = document.querySelector('.board-host') as HTMLElement | null;
    if (!host) return;
    const up = type === 'pointerup' || type === 'pointercancel';
    host.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        isPrimary,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: up ? 0 : 1,
      })
    );
  }, { type, x, y, pointerId, isPrimary });
}

/** Gesto de dos dedos simétrico alrededor de (cx,cy), bajando con spread[0] y terminando en el último. */
async function twoFinger(page: Page, cx: number, cy: number, spreads: number[]): Promise<void> {
  const idA = 101;
  const idB = 102;
  const pts = spreads.map((s) => ({ ax: cx - s / 2, ay: cy, bx: cx + s / 2, by: cy }));
  await ptr(page, 'pointerdown', pts[0].ax, pts[0].ay, idA, true);
  await ptr(page, 'pointerdown', pts[0].bx, pts[0].by, idB, false);
  for (let i = 1; i < pts.length; i++) {
    await ptr(page, 'pointermove', pts[i].ax, pts[i].ay, idA);
    await ptr(page, 'pointermove', pts[i].bx, pts[i].by, idB);
  }
  const last = pts[pts.length - 1];
  await ptr(page, 'pointerup', last.ax, last.ay, idA);
  await ptr(page, 'pointerup', last.bx, last.by, idB);
}

test.describe('D3 — los hints flotantes de móvil nunca se solapan (una sola pista a la vez)', () => {
  test.use({ hasTouch: true });

  test('[390x844] estado inicial: la pista de "Llenar pantalla" es el único hint; al cerrarla, ninguno', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);

    // Primera visita en móvil (Llenar pantalla por defecto): la pista es el único hint.
    // (La ayuda inicial fue retirada por el dueño y ya no tapa la pista.)
    await expect(page.locator('.fill-hint')).toBeVisible();
    await expect(page.locator('.board-help')).toHaveCount(0);
    expect(await visibleHints(page), 'al cargar solo la pista').toBe(1);

    // Captura inicial (solo la pista).
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOTS}/390x844-inicial-solo-pista.png` });

    // Cierra la pista → no queda ningún hint.
    await page.locator('.fill-hint-close').click();
    await expect(page.locator('.fill-hint')).toBeHidden();
    expect(await visibleHints(page), 'con la pista cerrada no hay ningún hint').toBe(0);
  });

  test('[390x844] la pista no tapa un objeto seleccionable ni bloquea el gesto de pellizco', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);

    // Se muestra la pista (sin ayuda general que la tape).
    await expect(page.locator('.fill-hint')).toBeVisible();

    // Coloca un Portero en el CENTRO: el toque atraviesa la pista (pointer-events:none)
    // y el objeto queda JUSTO DEBAJO de la pista → no puede decirse que la pista la tapa.
    const host = await hostBox(page);
    const cx = host.x + host.width / 2;
    const cy = host.y + host.height / 2;
    const S = await placeComodin(page, 0.5, 0.5);
    // Un toque sobre el propio Portero lo SELECCIONA (la pista, superpuesta en el centro,
    // no impide la selección del objeto). En móvil el panel de Propiedades NO se abre
    // automáticamente (regresión cubierta por `e1-mobile-props`): la selección queda viva
    // (marcada en el campo) y el inspector sigue cerrado, dejando el campo libre para el pinch.
    await page.touchscreen.tap(S.x, S.y);
    await expect(page.locator('.field-count')).toHaveText('1'); // sigue siendo un solo objeto
    await expect(page.locator('.board-canvas svg [stroke="#2563eb"]')).not.toHaveCount(0);
    await expect(page.locator('.studio-panel')).toHaveCount(0);

    // Pinch de dos dedos: los dedos caen FUERA del objeto (spread 120→220) y la pista
    // centrada NO intercepta los punteros → el zoom cambia y no se reabre el inspector.
    const before = await readView(page);
    await twoFinger(page, cx, cy, [120, 220]);
    const after = await readView(page);
    console.log(`[d3 pinch] zoom ${before.zoom.toFixed(2)} → ${after.zoom.toFixed(2)}`);
    expect(after.zoom, 'el pellizco cambia el zoom con la pista visible').toBeGreaterThan(before.zoom);
    expect(await page.locator('.studio-panel').count(), 'el pellizco no debe reabrir el inspector').toBe(0);

    // Durante el pellizco solo se ve la pista (no hay banner de ayuda).
    await expect(page.locator('.fill-hint')).toBeVisible();
    await expect(page.locator('.board-help')).toHaveCount(0);
    expect(await visibleHints(page), 'durante el pellizco solo la pista').toBe(1);

    // Captura "durante el pellizco" (solo la pista específica).
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${SHOTS}/390x844-durante-pellizco-solo-pista.png` });

    // Al cerrar la pista no queda ningún hint.
    await page.locator('.fill-hint-close').click();
    await expect(page.locator('.fill-hint')).toBeHidden();
    expect(await visibleHints(page), 'con la pista cerrada no hay ningún hint').toBe(0);
  });

  test('[390x844] el descarte se persiste: al recargar no reaparece ningún hint', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openBoard(page);

    // Se muestra la pista; la descartamos (no hay ayuda inicial que descartar).
    await expect(page.locator('.fill-hint')).toBeVisible();
    await page.locator('.fill-hint-close').click();
    await expect(page.locator('.fill-hint')).toBeHidden();

    // Recarga: el flag "ya mostrado" está persistido → ninguno reaparece.
    await page.reload();
    await expect(page.locator('.board-host')).toBeVisible();
    await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
    await expect(page.locator('.board-help')).toHaveCount(0);
    await expect(page.locator('.fill-hint')).toBeHidden();
    expect(await visibleHints(page), 'tras recargar no hay ningún hint').toBe(0);
  });
});
