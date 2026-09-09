// =============================================================
// Fase 3 — Escala normalizada del material + selección táctil robusta.
//
// Verifica con la UI REAL:
//   1) Ningún material nace diminuto: cada uno se coloca con su tamaño
//      base normalizado (TACTICAL_SIZE) y los de longitud de campo
//      (pértiga, escalera, portería, valla, maniquí-fila) son mayores
//      que los compactos (cono, diana, marcador).
//   2) La hit-test de un material alto/estrecho (pértiga) usa su CAJA
//      (bbox): se selecciona pulsando sobre el cuerpo del poste (lejos
//      del ancla) y NO se selecciona pulsando el hueco vacío cercano.
//      Además el código garantiza un área táctil mínima de ~44 px.
//   3) `size` escala el render (<image>), `rot` aparece en el SVG y tanto
//      Tamaño como Rotación se conservan al Guardar/reabrir/duplicar.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { TACTICAL_SIZE, MATERIAL_SIZE_RATIO } from '../src/app/core/tactic-assets';

const SHOTS = 'e2e/shots/fase3-material-scale';
import fs from 'node:fs';
import { longPress, fillBoardTitle } from './gesture-helpers';
fs.mkdirSync(SHOTS, { recursive: true });

interface Box { x: number; y: number; width: number; height: number }

const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

function normToScreen(nx: number, ny: number, box: Box): [number, number] {
  const s = Math.min(box.width / 100, box.height / 80);
  const offX = (box.width - 100 * s) / 2;
  const offY = (box.height - 80 * s) / 2;
  return [box.x + offX + (nx * RECT.w + RECT.x) * s, box.y + offY + (ny * RECT.h + RECT.y) * s];
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  // Fuerza "Campo completo" (letterbox) para que el helper norm→pantalla coincida.
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

async function placeMaterial(page: Page, box: Box, tool: string, nx: number, ny: number, variantIndex?: number): Promise<void> {
  // FASE B (paneles persistentes): elegir un material NO cierra el panel, así que abrir la
  // categoría es IDEMPOTENTE (solo se toca .tools-cat la primera vez). En la hoja de
  // contactos y en el test de rotación se coloca en bucle: re-togglear Material ahora
  // cerraría el panel y el .rail-btn del material siguiente ya no sería visible.
  const panel = page.locator('.side-panel-left.tools-panel-side');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
  }
  const card = page.locator('.tools-material-card', { has: page.locator(`.rail-btn[title="${tool}"]`) });
  // Solo se pincha el swatch de variante si el material realmente lo tiene.
  const variantCount = await card.locator('.variant-swatch').count();
  if (variantIndex != null && variantCount > 0) {
    await card.locator('.variant-swatch').nth(variantIndex).click();
  }
  await page.locator(`.rail-btn[title="${tool}"]`).click();
  box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y, { button: 'right' });
  // El material se auto-selecciona y abre Propiedades: se deselecciona para
  // que el siguiente clic en el campo no se traguen el panel.
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}

async function save(page: Page): Promise<void> {
  await fillBoardTitle(page, 'Fase 3');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

function canvasElements(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0] as { canvas: { frames: Array<{ elements: Array<Record<string, unknown>> }> } };
    return ex.canvas.frames[0].elements;
  });
}

async function tapSelect(page: Page, box: Box, nx: number, ny: number): Promise<void> {
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  box = await hostBox(page);
  const [x, y] = normToScreen(nx, ny, box);
  await page.mouse.click(x, y);
}

test.setTimeout(120_000);

test.describe('Fase 3 — escala del material y selección táctil robusta', () => {
  // =====================================================================
  // 1. Tamaños base normalizados: ningún material nace diminuto.
  // =====================================================================
  test('tamaños base normalizados: colocados con su size coherente (longitud de campo > compacto)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    let box = (await page.locator('.board-host').boundingBox())!;

    // Rejilla de 5×4 para la hoja de contactos (cada material a su tamaño base).
    const xs = [0.12, 0.31, 0.5, 0.69, 0.88];
    const ys = [0.13, 0.36, 0.59, 0.82];
    const recipe: Array<[string, number]> = [
      ['Balón', 0], ['Fitball', 0], ['Cono', 0], ['BOSU', 0], ['Banderín', 0],
      ['Chino', 0], ['Pica coloreable', 0], ['Pértiga / poste', 0], ['Maniquí individual', 0], ['Barrera de maniquíes', 0],
      ['Miniportería', 0], ['Portería grande', 0], ['Valla', 0], ['Aro', 0], ['Escalera', 0],
      ['Minitrampolín', 0], ['Peto', 0], ['Chaleco lastrado', 0], ['Mancuerna / pesa', 0],
    ];
    for (let i = 0; i < recipe.length; i++) {
      const [tool] = recipe[i];
      await placeMaterial(page, box, tool, xs[i % 5], ys[Math.floor(i / 5)]);
    }

    await expect(page.locator('.field-count')).toHaveText('19');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/contact-sheet.png` });

    await save(page);
    const els = await canvasElements(page);
    expect(els).toHaveLength(19);
    for (const el of els) {
      const kind = (el.assetKind ?? el.t) as string;
      const expectsSize = TACTICAL_SIZE[kind];
      expect(expectsSize, `falta tamaño base para ${kind}`).toBeGreaterThan(0);
      // Fase 4: el tamaño inicial se reduce a 0.75 × la base antigua.
      expect(el.size, `material ${kind} debería nacer con su tamaño base`).toBeCloseTo(expectsSize * MATERIAL_SIZE_RATIO, 5);
    }
    // Coherencia: los de longitud de campo nacen más grandes que los compactos.
    const pitch = ['pole', 'ladder', 'ladder_yellow', 'minigoal', 'mannequin_row', 'hurdle', 'flag', 'mannequin'];
    const compact = ['cone_red', 'cone_yellow', 'cone_blue', 'cone_orange', 'cone_white', 'cone_blue2', 'disc', 'target', 'ring', 'vball'];
    for (const p of pitch) expect(TACTICAL_SIZE[p]).toBeGreaterThan(1);
    for (const c of compact) expect(TACTICAL_SIZE[c]).toBeLessThanOrEqual(1);
  });

  // =====================================================================
  // 2. Hit-test de un material alto/estrecho (pértiga) usa su CAJA.
  // =====================================================================
  test('hit-test robusto: la pértiga se selecciona por el cuerpo y no por el hueco vacío cercano', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    let box = (await page.locator('.board-host').boundingBox())!;

    await placeMaterial(page, box, 'Pértiga / poste', 0.4, 0.5);
    expect(await page.locator('.field-count').innerText()).toBe('1');

    // Cuerpo del poste: un punto dentro de la caja real del material (proporción fina y
    // alta de la pértiga). D1: el área de selección es la caja del objeto + un margen en px
    // (no el antiguo radio fijo de ~44 px), así que se selecciona por el CUERPO.
    await tapSelect(page, box, 0.4, 0.5 - 0.03);
    await expect(page.locator('.inspector')).toBeVisible();
    // Fase 1: un material NO ofrece control "Tamaño" (resizable:false); el inspector
    // lo selecciona pero sin asas ni tamaño editable.
    await expect(page.locator('.studio-panel .inspector .field', { hasText: 'Tamaño' })).toHaveCount(0);

    // Hueco vacío JUSTO ENCIMA del poste (el antiguo punto de selección con el floor de
    // ~44 px): D1 lo considera FUERA del cuerpo → NO se selecciona.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    await tapSelect(page, box, 0.4, 0.5 - 0.06);
    await expect(page.locator('.inspector')).not.toBeVisible();

    // Hueco vacío claramente separado del poste: NO se selecciona.
    await tapSelect(page, box, 0.4, 0.5 - 0.16);
    await expect(page.locator('.inspector')).not.toBeVisible();

    // Lado del poste estrecho (perpendicular, fuera del ancho táctil): NO.
    await tapSelect(page, box, 0.4 - 0.12, 0.5);
    await expect(page.locator('.inspector')).not.toBeVisible();

    // En el export PNG el poste aparece (región distinta del campo vacío).
    await save(page);
  });

  // =====================================================================
  // 3. size escala el <image>, rot aparece en el SVG y se conservan al
  //    Guardar/reabrir/duplicar; la rotación respeta la hit-test.
  // =====================================================================
  test('material: rot ±90° se aplica y conserva; NO es redimensionable (sin control Tamaño) al guardar, reabrir y duplicar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = (await page.locator('.board-host').boundingBox())!;

    // Colocar un cono y una pértiga.
    await placeMaterial(page, box, 'Cono', 0.3, 0.5, 0);
    await placeMaterial(page, box, 'Pértiga / poste', 0.6, 0.5);
    await expect(page.locator('.field-count')).toHaveText('2');

    // Fase 1: un material NO es redimensionable → su inspector NO muestra "Tamaño".
    await tapSelect(page, box, 0.3, 0.5);
    await expect(page.locator('.studio-panel .inspector .field', { hasText: 'Tamaño' })).toHaveCount(0);
    // Rotación ±90 (menú contextual, Fase 3: clic derecho sobre el cono).
    const [rx, ry] = normToScreen(0.3, 0.5, box);
    await longPress(page, rx, ry);
    const ctxRot = page.locator('.context-bar [aria-label="Girar 90° a la derecha"]');
    await expect(ctxRot).toBeVisible();
    await ctxRot.click();
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // El <image> del cono ROTA (g rotate). Fase 1: NO crece por Tamaño.
    const svg = await page.locator('.entrenolab-board').innerHTML();
    expect(svg).toContain('rotate(90 ');
    await page.screenshot({ path: `${SHOTS}/cone-resized-rotated.png` });

    await save(page);
    let els = await canvasElements(page);
    const cone = els.find((e) => e.t === 'cone')!;
    // Fase 1: sin resize → el material conserva su size por defecto (no 2); rot=90.
    expect(cone.rot).toBeCloseTo(90, 0);

    // Reabrir → se conserva la rotación.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('2');

    // Duplicar el cono → la copia conserva rot (menú contextual por pulsación larga).
    await longPress(page, ...normToScreen(0.3, 0.5, (await page.locator('.board-host').boundingBox())!));
    await page.locator('.context-bar [aria-label="Duplicar"]').click();
    await page.waitForTimeout(80);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    await expect(page.locator('.field-count')).toHaveText('3');
    await save(page);
    const cones = (await canvasElements(page)).filter((e) => e.t === 'cone');
    expect(cones).toHaveLength(2);
    for (const c of cones) {
      expect(c.rot).toBeCloseTo(90, 0);
    }
  });
});
