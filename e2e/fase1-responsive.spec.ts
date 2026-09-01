import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase1';
fs.mkdirSync(SHOTS, { recursive: true });

const MOBILE = [
  [360, 800],
  [390, 844],
  [430, 932],
];
const DESKTOP = [1024, 1280, 1366, 1440, 1920];
const TABLET: Array<[number, number]> = [[768, 1024]];
const ALL = [...MOBILE, ...TABLET.map(([w, h]) => [w, h] as [number, number]), ...DESKTOP.map((w) => [w, 900] as [number, number])];

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([{ id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' }]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: 'Conservación', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Carga la pizarra con todos los paneles CERRADOS y la ayuda descartada. */
async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // Descartar la ayuda (no debe cubrir el campo de forma permanente).
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
}

type Box = { x: number; y: number; width: number; height: number };

function ratio(b: Box, s: Box, axis: 'w' | 'h'): number {
  return axis === 'w' ? b.width / s.width : b.height / s.height;
}

/** Coloca un Portero (no selecciona → no abre el panel de Propiedades). */
async function placeGenericPlayer(page: Page): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Portero"]').click();
  // Tocar un genérico ARMA la colocación (cierra el panel); el clic en el campo lo coloca.
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
  const box = (await page.locator('.board-host').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.locator('.field-count')).toHaveText('1');
}

const MAIN_PANEL_SELECTORS = ['.studio-panel', '.side-panel-left', '.top-pop-export', '.top-pop-mas'];

/** Cuenta cuántos paneles "principales" están visibles. */
async function visibleMainPanels(page: Page): Promise<number> {
  return page.evaluate((sels) => {
    let n = 0;
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const b = (el as HTMLElement).getBoundingClientRect();
        if (b.width > 2 && b.height > 2) n++;
      }
    }
    return n;
  }, MAIN_PANEL_SELECTORS);
}

test.describe('Fase 1 — utilidad responsive real (campo protagonista)', () => {
  for (const [w, h] of ALL) {
    test(`[${w}x${h}] el campo ocupa ≥90% del ancho y la mayor altura posible con todo cerrado`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      const studio = (await page.locator('.studio').boundingBox())!;
      const field = (await page.locator('.studio-field').boundingBox())!;
      expect(ratio(field, studio, 'w'), `ancho del campo en ${w}x${h}`).toBeGreaterThanOrEqual(0.9);
      expect(ratio(field, studio, 'h'), `alto del campo en ${w}x${h}`).toBeGreaterThanOrEqual(0.7);
      expect(await visibleMainPanels(page)).toBe(0);
    });
  }

  test('abrir/cerrar cada panel NO muta el documento subyacente (frame/campo/elemento)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openClosed(page);
    await placeGenericPlayer(page);

    const read = async () => {
      const count = await page.locator('.field-count').innerText();
      const html = await page.locator('.board-canvas').innerHTML();
      return { count, html };
    };
    const baseline = await read();

    const panels: Array<[string, string]> = [
      ['Propiedades', 'button[aria-label="Propiedades"]'],
      ['Jugadores', '.tools-cat:has-text("Jugadores")'],
      ['Material', '.tools-cat:has-text("Material")'],
      ['Dibujo', '.tools-cat:has-text("Dibujo")'],
      ['Exportar', '[aria-label="Exportar"]'],
      ['Más', '[aria-label="Más"]'],
    ];
    for (const [name, trigger] of panels) {
      await page.locator(trigger).click();
      await page.waitForTimeout(80);
      expect(await read(), `documento cambiado al abrir ${name}`).toEqual(baseline);
      // Cerrar con el botón visible.
      const close = page.locator('.panel-close').first();
      await expect(close).toBeVisible();
      await close.click();
      await page.waitForTimeout(80);
      expect(await read(), `documento cambiado al cerrar ${name}`).toEqual(baseline);
    }
  });

  test('cada panel se cierra con su botón visible y ningún panel se queda atascado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);

    const openers: Array<[string, string]> = [
      ['Propiedades', 'button[aria-label="Propiedades"]'],
      ['Jugadores', '.tools-cat:has-text("Jugadores")'],
      ['Material', '.tools-cat:has-text("Material")'],
      ['Dibujo', '.tools-cat:has-text("Dibujo")'],
      ['Exportar', '[aria-label="Exportar"]'],
      ['Más', '[aria-label="Más"]'],
    ];
    for (const [name, trigger] of openers) {
      await page.locator(trigger).click();
      const panel = name === 'Jugadores' || name === 'Material' || name === 'Dibujo' ? '.side-panel-left' : name === 'Exportar' ? '.top-pop-export' : name === 'Más' ? '.top-pop-mas' : '.studio-panel';
      const el = page.locator(panel);
      await expect(el, `el panel «${name}» se abre`).toBeVisible();
      const close = el.locator('.panel-close').first();
      await expect(close, `el panel «${name}» tiene botón de cierre`).toBeVisible();
      await close.click();
      await expect(el, `el panel «${name}» se cierra`).toHaveCount(0);
    }
  });

  test('solo UN panel principal puede estar abierto a la vez', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openClosed(page);

    const openers: Array<[string, string]> = [
      ['Propiedades', 'button[aria-label="Propiedades"]'],
      ['Jugadores', '.tools-cat:has-text("Jugadores")'],
      ['Material', '.tools-cat:has-text("Material")'],
      ['Dibujo', '.tools-cat:has-text("Dibujo")'],
      ['Exportar', '[aria-label="Exportar"]'],
      ['Más', '[aria-label="Más"]'],
    ];
    for (const [, trigger] of openers) {
      await page.locator(trigger).click();
      await page.waitForTimeout(60);
      expect(await visibleMainPanels(page)).toBe(1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
      expect(await visibleMainPanels(page)).toBe(0);
    }
  });

  test('no hay acciones duplicadas (un Guardar, un Exportar, un Jugadores)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openClosed(page);
    expect(await page.locator('[aria-label="Guardar"]').count()).toBe(1);
    expect(await page.locator('[aria-label="Exportar"]').count()).toBe(1);
    expect(await page.locator('[aria-label="Jugadores"]').count()).toBe(1);
  });

  test('todo botón tiene un nombre accesible (aria-label, texto o title)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.studio button')) {
        const label = (el.getAttribute('aria-label') ?? '').trim();
        const text = (el.textContent ?? '').trim();
        const title = (el.getAttribute('title') ?? '').trim();
        if (!label && !text && !title) bad.push(el.outerHTML.slice(0, 80));
      }
      return bad;
    });
    expect(unnamed, `botones sin nombre accesible`).toEqual([]);
  });

  test('los objetivos táctiles esenciales miden ≥44×44 px en móvil', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    const selectors = [
      '[aria-label="Volver"]',
      'button[aria-label="Propiedades"]',
      '[aria-label="Guardar"]',
      '[aria-label="Exportar"]',
      '[aria-label="Más"]',
      '[aria-label="Jugadores"]',
      '.tools-cat:has-text("Material")',
      '.tools-cat:has-text("Dibujo")',
      // Fase 3: Deshacer/Rehacer ya no están en la barra; viven en el menú contextual.
      '[aria-label="Seleccionar y mover"]',
    ];
    for (const sel of selectors) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box, `no visible ${sel}`).not.toBeNull();
      const dim = Math.min(box!.width, box!.height);
      expect(dim, `objetivo táctil de ${sel}`).toBeGreaterThanOrEqual(44);
    }
  });

  test('el campo sigue parcialmente visible al abrir paneles más pequeños', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openClosed(page);

    // Panel derecho (Propiedades).
    await page.locator('button[aria-label="Propiedades"]').click();
    const field = (await page.locator('.studio-field').boundingBox())!;
    const panel = (await page.locator('.studio-panel').boundingBox())!;
    expect(panel.width).toBeLessThan(field.width);
    expect((await page.locator('.studio-field').boundingBox())!.width).toBeGreaterThan(0);
    await page.keyboard.press('Escape');

    // Panel izquierdo (Jugadores).
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    const lpanel = (await page.locator('.side-panel-left').boundingBox())!;
    const lfield = (await page.locator('.studio-field').boundingBox())!;
    expect(lpanel.width).toBeLessThan(lfield.width);
    await page.keyboard.press('Escape');

    // Material (lateral izquierdo).
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const bhost = (await page.locator('.board-host').boundingBox())!;
    const mat = (await page.locator('.side-panel-left').boundingBox())!;
    expect(bhost.height).toBeGreaterThan(0);
    expect(mat.x, 'el panel Material se ancla a la izquierda').toBeLessThanOrEqual(bhost.x + 1);
    expect(mat.width, 'el panel lateral no cubre todo el ancho').toBeLessThan(bhost.width);
  });
});

test.describe('Fase 1 — capturas (pizarra cerrada y cada lado abierto)', () => {
  for (const [w, h, label] of [
    [1366, 900, 'desktop-1366'],
    [390, 844, 'movil-390x844'],
  ] as Array<[number, number, string]>) {
    test(`${label}: pizarra con todo cerrado y con cada panel abierto`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await placeGenericPlayer(page);
      await page.screenshot({ path: `${SHOTS}/${label}-cerrado.png` });

      const opens: Array<[string, string]> = [
        ['izquierda', '.tools-cat:has-text("Jugadores")'],
        ['derecha', 'button[aria-label="Propiedades"]'],
        ['inferior', '.tools-cat:has-text("Material")'],
        ['superior', '[aria-label="Exportar"]'],
      ];
      for (const [side, trigger] of opens) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
        await page.locator(trigger).click();
        await expect(page.locator('.panel-close').first()).toBeVisible();
        await page.waitForTimeout(120);
        await page.screenshot({ path: `${SHOTS}/${label}-abierto-${side}.png` });
      }
    });
  }
});
