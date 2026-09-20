import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import { visibleMaterials } from '../src/app/core/material-registry';

// =============================================================
// FASE F — catálogo canónico único de materiales.
// El panel se deriva del registro (material-registry.ts); se verifica
// que cada material visible aparece exactamente una vez, se puede
// colocar y genera un elemento del tipo correcto. El número esperado
// se CALCULA del registro, no se repite como constante.
// =============================================================

const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;
type Box = { x: number; y: number; width: number; height: number };
type Fit = 'height' | 'contain';

function normToScreen(nx: number, ny: number, host: Box, fit: Fit): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  return { x: host.x + host.width / 2 + cx - host.width / 2, y: host.y + host.height / 2 + cy - host.height / 2 };
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}
async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (await page.locator(sel).isVisible().catch(() => false)) await page.locator(sel).click();
  }
}
async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b).not.toBeNull();
  return b!;
}
async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}
async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

test.describe('FASE F — catálogo canónico de materiales', () => {
  test.setTimeout(240_000);

  test('el panel se deriva del registro: cada material visible aparece EXACTAMENTE una vez', async ({ page }) => {
    const visible = visibleMaterials();
    expect(visible.length, 'catálogo visible').toBeGreaterThan(0);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    // El nº de tarjetas del panel se calcula del registro (no es una constante).
    expect(await page.locator('.tools-material-card').count(), 'nº de tarjetas = catálogo visible').toBe(visible.length);
    // Cada material visible tiene su tarjeta en el panel, exactamente una vez.
    for (const m of visible) {
      expect(await page.locator(`.tools-material-card .rail-btn[title="${m.title}"]`).count(), `${m.title} en el panel`).toBe(1);
    }
  });

  test('tabla parametrizada: cada material visible se coloca y genera un elemento de su tipo', async ({ page }) => {
    const visible = visibleMaterials();
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    let n = 0;
    for (const m of visible) {
      n++;
      const btn = page.locator(`.rail-btn[title="${m.title}"]`);
      await expect(btn).toBeVisible();
      await btn.click();
      const p = normToScreen(0.5, 0.5, host, fit);
      await page.mouse.click(p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(n);
      // El elemento creado es del tipo del material (data-el-type).
      await expect.poll(() => page.locator(`.board-canvas svg [data-el-type="${m.id}"]`).count(), { timeout: 5000 }).toBe(1);
      await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    }
  });

  test('dumbbell, goal y mannequin_row (materiales que fallaron antes) siguen colocándose', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    let n = 0;
    for (const subject of ['Mancuerna / pesa', 'Portería grande', 'Barrera de maniquíes'] as const) {
      n++;
      const btn = page.locator(`.rail-btn[title="${subject}"]`);
      await expect(btn).toBeVisible();
      await btn.click();
      const p = normToScreen(0.5, 0.5, host, fit);
      await page.mouse.click(p.x, p.y);
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(n);
      await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    }
  });

  test('el material puntual (Cono) NO muestra asas de redimensionado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.5, host, fit);
    const btn = page.locator('.rail-btn[title="Cono"]');
    await expect(btn).toBeVisible();
    await btn.click();
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    // Seleccionar el material puntual con Cursor: NO debe aparecer ninguna asa de resize.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.board-canvas svg .reshandle'), 'material puntual sin asas de resize').toHaveCount(0);
  });

  test('los materiales RETIRADOS cargan (documento) pero NO aparecen en el panel', async ({ page }) => {
    // Documento antiguo con un material RETIRADO (net) y otro visible (cone).
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:board-hints', '1');
      localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
      localStorage.setItem('entrenolab:players', JSON.stringify([]));
      localStorage.setItem('entrenolab:folders', JSON.stringify([]));
      localStorage.setItem('entrenolab:exercises', JSON.stringify([{
        id: 'x', teamId: 't1', folderId: null, title: 'Retirado', description: '', explanation: '',
        category: 'Técnica', objectives: [], materials: [], durationMinutes: 10, minPlayers: null, maxPlayers: null,
        loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null,
        isTemplate: false,
        canvas: {
          version: 2, schemaVersion: 3, field: 'full',
          frames: [{ duration: 1000, elements: [
            { id: 'n', t: 'net', x: 0.5, y: 0.5, size: 0.6 },
            { id: 'c', t: 'cone', x: 0.3, y: 0.3, size: 0.6 },
          ] }],
          orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a',
        },
        thumbnail: null, savedAt: now,
      }]));
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    });
    await page.setViewportSize({ width: 1366, height: 900 });
    // Abrir el documento retirado DESDE la Biblioteca (un `/board` nuevo no auto-carga).
    await page.goto('/library');
    await expect(page.locator('.ex-card')).toHaveCount(1);
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.board-canvas svg')).toBeVisible();
    for (const sel of ['.help-close', '.fill-hint-close']) if (await page.locator(sel).isVisible().catch(() => false)) await page.locator(sel).click();
    // CARGA: el documento abre y los dos elementos (net retirado + cone visible) están en el modelo.
    await expect(page.locator('.field-count')).toHaveText('2');
    await expect(page.locator('.board-canvas svg [data-el-type="net"]')).toHaveCount(1);
    await expect(page.locator('.board-canvas svg [data-el-type="cone"]')).toHaveCount(1);
    // NO aparece: el panel de Material NO ofrece el material retirado.
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    await expect(page.locator('.rail-btn[title="Red"]'), 'retirado «Red» no aparece en el panel').toHaveCount(0);
    await expect(page.locator('.rail-btn[title="Cono"]'), 'visible «Cono» sí aparece').toHaveCount(1);
  });
});
