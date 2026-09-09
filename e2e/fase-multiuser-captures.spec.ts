import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase-multiuser';
fs.mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------
// Seed idéntico al de e2e/fase4-captures.spec.ts para que la plantilla,
// biblioteca y pizarra tengan contenido al navegar directamente.
// ---------------------------------------------------------------------------
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

/** Abre el panel de Propiedades (derecha), que arranca cerrado. */
async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

/** Cuenta cuántos paneles "principales" están visibles (ancho y alto > 2px). */
async function visibleMainPanels(page: Page): Promise<number> {
  const sels = ['.studio-panel', '.side-panel-left', '.top-pop-export', '.top-pop-mas'];
  return page.evaluate((s) => {
    let n = 0;
    for (const sel of s) {
      for (const el of document.querySelectorAll(sel)) {
        const b = (el as HTMLElement).getBoundingClientRect();
        if (b.width > 2 && b.height > 2) n++;
      }
    }
    return n;
  }, sels);
}

type Box = { x: number; y: number; width: number; height: number };

const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };

test.describe('Fase multiusuario — capturas del estado actual', () => {
  // -------------------------------------------------------------------------
  // Pantallas de autenticación (formularios; sin sesión Supabase en modo local).
  // -------------------------------------------------------------------------
  test('auth: login, register, pending-approval, forgot-password, onboarding-team (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);

    await page.goto('/auth/login');
    await expect(page.locator('input#login-email')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/login.png` });

    await page.goto('/auth/register');
    await expect(page.locator('input#reg-email')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/register.png` });

    await page.goto('/pending-approval');
    await expect(page.locator('.auth-title')).toHaveText('Aprobación pendiente');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/pending-approval.png` });

    await page.goto('/auth/forgot-password');
    await expect(page.locator('input#forgot-email')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/forgot-password.png` });

    await page.goto('/onboarding/team');
    await expect(page.locator('#team-name')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/onboarding-team.png` });
  });

  // -------------------------------------------------------------------------
  // Plantilla y Biblioteca (con contenido sembrado).
  // -------------------------------------------------------------------------
  test('equipo y biblioteca con contenido (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);

    await page.goto('/team');
    await expect(page.locator('.page-title')).toHaveText('Plantilla');
    await expect(page.locator('.data-table tbody tr')).toHaveCount(3);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/team.png` });

    await page.goto('/library');
    await expect(page.locator('.page-title')).toHaveText('Tareas y ejercicios');
    await expect(page.locator('.ex-card')).toHaveCount(1);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/library.png` });
  });

  // -------------------------------------------------------------------------
  // Miembros, Admin e Invitaciones: en MODO LOCAL (sin sesión Supabase real)
  // estos renderizan su estado vacío / sólo lectura. Se capturan tal cual.
  // -------------------------------------------------------------------------
  test('members, admin, invitations (desktop) — estados vacíos de desarrollo', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);

    // Miembros del equipo: la RPC de colaboradores exige propietario autenticado,
    // por lo que en modo local se muestra la vista de solo lectura (0 de 4 plazas).
    await page.goto('/settings/team/members');
    await expect(page.locator('.auth-title')).toHaveText('Miembros del equipo');
    await expect(page.locator('.auth-row')).toContainText('0 de 4');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/members.png` });

    await page.goto('/invitations');
    await expect(page.locator('.auth-title')).toHaveText('Invitaciones');
    await expect(page.locator('body')).toContainText('No tienes invitaciones pendientes');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/invitations.png` });

    await page.goto('/admin');
    await expect(page.locator('.auth-title')).toHaveText('Panel de administración');
    await expect(page.locator('body')).toContainText('No se han encontrado perfiles');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/admin.png` });
  });

  // -------------------------------------------------------------------------
  // Pizarra — escritorio 1366×900: cerrada y cada panel abierto.
  // -------------------------------------------------------------------------
  test('board desktop 1366×900: cerrada + cada panel abierto', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto('/board');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);

    // Captura "cerrada" con un jugador colocado. FASE B: el panel Jugadores PERMANECE
    // abierto tras tocar el jugador (persistencia), así que hay UN panel principal (el
    // lateral izquierdo), no cero.
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .roster-item').first().click();
    await page.waitForTimeout(200);
    // Tocar un jugador arma la colocación (el panel queda abierto); el clic en el campo lo coloca.
    const fbox = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(fbox.x + fbox.width * 0.5, fbox.y + fbox.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(await visibleMainPanels(page)).toBe(1);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/board-desktop-cerrado.png` });

    // Cada panel, cerrando el anterior con Escape (un solo panel principal a la vez).
    const opens: Array<[string, string, string]> = [
      ['jugadores', '.tools-cat:has-text("Jugadores")', '.side-panel-left'],
      ['propiedades', 'button[aria-label="Propiedades"]', '.studio-panel'],
      ['material', '.tools-cat:has-text("Material")', '.side-panel-left'],
      ['dibujo', '.tools-cat:has-text("Dibujo")', '.side-panel-left'],
      ['exportar', '[aria-label="Exportar"]', '.top-pop-export'],
      ['mas', 'button[aria-label="Más"]', '.top-pop-mas'],
    ];
    for (const [name, trigger, panel] of opens) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
      await page.locator(trigger).click();
      await expect(page.locator(panel)).toBeVisible();
      await expect(await visibleMainPanels(page)).toBe(1);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/board-desktop-${name}.png` });
    }

  });

  // -------------------------------------------------------------------------
  // Pizarra — móvil 390×844: cerrada (campo protagonista), Material y Propiedades.
  // -------------------------------------------------------------------------
  test('board móvil 390×844: cerrada + Material (bottom-sheet) + Propiedades', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await seed(page);
    await page.goto('/board');
    await expect(page.locator('.board-host')).toBeVisible();
    await dismissHelp(page);

    // Cerrada: el campo es el protagonista.
    const studio = (await page.locator('.studio').boundingBox())!;
    const field = (await page.locator('.studio-field').boundingBox())!;
    expect(field.width / studio.width).toBeGreaterThanOrEqual(0.9);
    expect(field.height / studio.height).toBeGreaterThanOrEqual(0.7);
    await expect(await visibleMainPanels(page)).toBe(0);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/board-movil-cerrado.png` });

    // Material: panel lateral IZQUIERDO que NO cubre todo el campo.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await expect(await visibleMainPanels(page)).toBe(1);
    const f0 = (await page.locator('.studio-field').boundingBox())!;
    const mat = (await page.locator('.side-panel-left').boundingBox())!;
    expect(mat.x, 'el panel Material se ancla al borde izquierdo').toBeLessThanOrEqual(f0.x + 1);
    expect(mat.width, 'el panel lateral no cubre todo el ancho').toBeLessThan(MOBILE.width);
    expect(mat.height, 'el panel lateral aprovecha la altura disponible').toBeGreaterThanOrEqual(MOBILE.height * 0.8);
    await expect(page.locator('.studio-field')).toBeVisible();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/board-movil-material.png` });

    // Propiedades (derecha), solo ese panel visible.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    await page.locator('button[aria-label="Propiedades"]').click();
    await expect(page.locator('.studio-panel')).toBeVisible();
    await expect(await visibleMainPanels(page)).toBe(1);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/board-movil-propiedades.png` });
  });

  // -------------------------------------------------------------------------
  // Campo base F7 (horiz/vertical) + overlay F7 — reutiliza los matchers de fase4.
  // -------------------------------------------------------------------------
  test('F7: base compuesta horizontal/vertical (desktop 1366×900)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await expect(page.locator('.studio-panel [aria-label="Campo base"]')).toBeVisible();

    // Base F7 horizontal.
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/f7-base-horizontal.png` });

    // Base F7 vertical.
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/f7-base-vertical.png` });
  });

  test('F7: plantilla base compuesta (sobre medio campo F11), desktop 1366×900', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await page.goto('/board');
    await dismissHelp(page);
    await openProps(page);
    await expect(page.locator('.studio-panel')).toBeVisible();
    // La plantilla F7 ya no es un overlay activable: se elige como campo base.
    await expect(page.locator('.studio-panel .field', { hasText: 'Ayudas' }).locator('.chip', { hasText: 'F7' })).toHaveCount(0);
    await page.locator('.studio-panel [aria-label="Campo base"]').selectOption('f7');
    await page.waitForTimeout(250);
    const svg = await page.locator('.board-canvas svg').first().innerHTML();
    expect(svg).toContain('height="46"'); // FASE 4/8b: F7 sobre el medio campo F11 apaisado (46 de alto)
    await page.screenshot({ path: `${SHOTS}/f7-overlay-horizontal.png` });
  });
});
