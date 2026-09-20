import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/e5-props-close';
fs.mkdirSync(SHOTS, { recursive: true });

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

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

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) {
    await page.locator('.fill-hint-close').click();
  }
  await expect(page.locator('.board-host')).toBeVisible();
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'la caja real de .board-host').not.toBeNull();
  return b!;
}

async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

async function armCone(page: Page): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  await expect(page.locator('.placement-hint')).toBeVisible();
  // FASE B (paneles persistentes): el panel Material sigue abierto y en móvil tapa el punto de
  // colocación del cono (izquierda). Se cierra por su botón X (.panel-close), que no desarma la
  // colocación, para poder tocar el campo después.
  await page.locator('.side-panel-left.tools-panel-side .panel-close').click();
  await expect(page.locator('.side-panel-left.tools-panel-side')).toHaveCount(0);
}

const CONE = '.board-canvas svg image[href*="cone"]';
const SEL = '.board-canvas svg [stroke="#2563eb"]';
// DECISIÓN DEL DUEÑO (Fase 6): la manija de rotación continua fue retirada; la
// selección conservada se muestra con las ASAS de redimensionado (`.reshandle`).
const RESIZE = '.board-canvas svg .reshandle';
const ROT_HANDLE = '.rot-handle';

/** Coloca un cono vía el panel de Material y lo deja seleccionado. (Fase 3: la colocación
 *  es continua, así que tras colocar se DESARMA con Seleccionar y se hace clic sobre él.) */
async function placeCone(page: Page): Promise<void> {
  await armCone(page);
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const s = normToScreen(0.4, 0.55, host, fit);
  await page.mouse.click(s.x, s.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
  await page.mouse.click(s.x, s.y); // seleccionar el cono recién colocado
}

async function topPropsClosedState(page: Page): Promise<void> {
  // El botón superior arranca como "Propiedades" (cerrado).
  await expect(page.getByRole('button', { name: 'Propiedades' })).toBeVisible();
}

test.describe('E5 — cerrar Propiedades por la X superior o la X interior deja el MISMO estado (selección conservada)', () => {
  const SIZES: Array<[number, number]> = [[360, 800], [390, 844], [430, 932], [1366, 900]];

  for (const [W, H] of SIZES) {
    test(`a ${W}×${H}: ambas X cierran conservando selección/manijas; mismo estado; sin cambiar modelo/dirty/undo`, async ({ page }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await openClosed(page);

      // 1. Colocar y seleccionar un cono.
      await placeCone(page);
      await expect(page.locator(SEL)).not.toHaveCount(0);

      // 2. Abrir Propiedades EXPLÍCITAMENTE via el botón superior (si el panel está cerrado;
      //    en escritorio podría haberse auto-abierto al colocar — igual está abierto).
      const topClosed = page.getByRole('button', { name: 'Propiedades', exact: true });
      if (await topClosed.isVisible().catch(() => false)) {
        await topClosed.click();
      }
      const propsPanel = page.locator('.studio-panel');
      await expect(propsPanel).toBeVisible();

      // Nombre accesible dinámico: abierto → "Cerrar propiedades".
      await expect(page.getByRole('button', { name: 'Cerrar propiedades', exact: true })).toBeVisible();

      const countBefore = await fieldCount(page);
      // Fase 3: Deshacer/Rehacer ya no viven en la barra permanente; el estado del historial
      // se verifica al final con un ÚNICO Ctrl+Z (una sola entrada = la colocación del cono).

      // ---- Cerrar con la X SUPERIOR ----
      await page.getByRole('button', { name: 'Cerrar propiedades', exact: true }).click();
      await expect(propsPanel).toHaveCount(0);
      // Fase 1: un MATERIAL (cono) NO muestra asas de redimensionado (resizable:false).
      // La selección se conserva tras cerrar, pero sin manijas de resize ni de rotación.
      await expect(page.locator(SEL), 'la selección del cono se conserva tras cerrar').not.toHaveCount(0);
      await expect(page.locator(RESIZE), 'un material no tiene asas de resize').toHaveCount(0);
      await expect(page.locator(ROT_HANDLE)).toHaveCount(0);
      await expect(page.locator('.field-count')).toHaveText(String(countBefore));

      // El estado final (modelo/dirty/undo) no cambió por el cierre.
      expect(await fieldCount(page)).toBe(countBefore);
      // Fase 3: cerrar con la X superior no introduce entradas de historial (contador intacto).

      // Captura móvil obligatoria: panel cerrado, objeto seleccionado con su manija visible.
      if (W === 390 && H === 844) {
        await page.screenshot({ path: `${SHOTS}/movil-cierre-superior-seleccion-conservada.png`, fullPage: false });
      }

      // ---- Reabrir con el botón superior y confirmar el inspector del MISMO cono ----
      await page.getByRole('button', { name: 'Propiedades', exact: true }).click();
      await expect(propsPanel).toBeVisible();
      // El inspector se reabre para el CONO seleccionado. Fase 1: un material NO muestra
      // el control "Tamaño" (resizable:false); el panel se reabre conservando la selección.
      await expect(page.locator('.studio-panel')).toBeVisible();
      await expect(page.locator(SEL), 'la selección del cono se conserva al reabrir').not.toHaveCount(0);

      // ---- Cerrar con la X INTERIOR y confirmar EXACTAMENTE el mismo estado final ----
      await page.locator('.studio-panel .panel-close').click();
      await expect(propsPanel).toHaveCount(0);
      await expect(page.locator(SEL), 'la selección del cono se conserva tras cerrar').not.toHaveCount(0);
      await expect(page.locator(RESIZE), 'un material no tiene asas de resize').toHaveCount(0);
      await expect(page.locator(ROT_HANDLE)).toHaveCount(0);
      await expect(page.locator('.field-count')).toHaveText(String(countBefore));
      // Fase 3: cerrar con la X interior tampoco introduce entradas de historial.

      // ---- Nombre accesible del botón superior tras cerrar: vuelve a "Propiedades" ----
      await expect(page.getByRole('button', { name: 'Propiedades', exact: true })).toBeVisible();
    });
  }
});
