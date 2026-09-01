import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase7';
fs.mkdirSync(SHOTS, { recursive: true });

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#c8102e', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
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
async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

test.describe('Fase 7 — capturas (identidad CDM Pizarrales, F7 compuesto, líneas finas, sin animación)', () => {
  test('login escritorio y móvil con el escudo y botón rojo', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/auth/login');
    await expect(page.locator('.auth-brand')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/login-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.auth-brand')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/login-mobile.png` });
  });

  test('biblioteca y pizarra con la paleta roja/blanca/negra', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/library');
    await expect(page.locator('.ex-card')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/library.png` });
    await page.goto('/board');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);
    await page.screenshot({ path: `${SHOTS}/board-closed.png` });
  });

  test('F7 compuesto escritorio (horizontal y vertical)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(250);
    const svg = await page.locator('.board-canvas svg').first().innerHTML();
    expect(svg).toContain('width="92"'); // fondos F7 coinciden con las bandas F11
    expect(svg).not.toContain('<ellipse'); // sin círculo central del F7
    await page.screenshot({ path: `${SHOTS}/f7-composite-horizontal.png` });
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/f7-composite-vertical.png` });
  });

  test('F7 compuesto móvil 390×844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(250);
    await page.locator('.studio-panel [aria-label="Cerrar panel"]').click();
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/f7-composite-mobile.png` });
  });

  test('campo full y medio campo con líneas finas', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('full');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/campo-full-lineas-finas.png` });
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('half');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/campo-half-lineas-finas.png` });
  });

  test('menú Más no muestra Animación', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await page.locator('[aria-label="Más"]').click();
    await expect(page.locator('.top-pop-mas')).toBeVisible();
    // No hay control de animación ni GIF.
    await expect(page.locator('.top-pop-mas')).not.toContainText('Animación');
    await expect(page.locator('[aria-label="Animación"]')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/menu-mas-sin-animacion.png` });
  });
});
