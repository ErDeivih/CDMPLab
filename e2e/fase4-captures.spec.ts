import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase4';
fs.mkdirSync(SHOTS, { recursive: true });

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
      { id: 'p3', teamId: 't1', name: 'Dani', number: 1, position: 'GK', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([{ id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' }]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: 'Conservación', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function dismissHelp(page: Page): Promise<void> {
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
}

/** Abre el panel de Propiedades (derecha), que ahora empieza cerrado. */
async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

/** Renderiza una pizarra real con jugador + texto y deja abierto el panel Material. */
async function boardWithContent(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await dismissHelp(page);

  const box = (await page.locator('.board-host').boundingBox())!;

  // Jugador de la plantilla desde el panel Jugadores (izquierda).
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await page.locator('.side-panel-left .roster-item').first().click();
  await page.waitForTimeout(200);
  // Tocar un jugador arma la colocación (cierra el panel); el clic en el campo lo coloca.
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.5);
  await page.waitForTimeout(150);

  // Texto desde el panel Dibujo.
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator('.rail-btn[title="Texto"]').click();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.waitForTimeout(200);
  await expect(page.locator('.field-count')).toHaveText('2');

  // Abrir el panel Material (flyout escritorio / bottom-sheet móvil).
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
}

const DESKTOP = [1024, 1280, 1366, 1440, 1920];
const MOBILE = [
  [360, 800],
  [390, 844],
  [430, 932],
];

test.describe('Fase 4 — capturas multi-anchura (pizarra con paneles de herramientas)', () => {
  for (const w of DESKTOP) {
    test(`escritorio ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await seed(page);
      await boardWithContent(page);
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/desktop-${w}-material.png` });
    });
  }

  for (const [w, h] of MOBILE) {
    test(`móvil ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await boardWithContent(page);
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/movil-${w}x${h}-material.png` });
    });
  }

  test('campo base F7 (horizontal y vertical)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await expect(page.locator('.studio-panel [aria-label="Campo base"]')).toBeVisible();
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/f7-base-horizontal.png` });
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/f7-base-vertical.png` });
  });

  test('plantilla base F7 (sobre medio campo F11), horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await expect(page.locator('.studio-panel [aria-label="Campo base"]')).toBeVisible();
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(250);
    // La plantilla compuesta (sin toggle overlay) dibuja tanto el F11 como el F7.
    const svg = await page.locator('.board-canvas svg').first().innerHTML();
    expect(svg).toContain('width="92"');
    await page.screenshot({ path: `${SHOTS}/f7-overlay-horizontal.png` });
  });
});
