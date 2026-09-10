import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { fillBoardTitle } from './gesture-helpers';

// =============================================================
// FASE 0 — persistencia del campo F7 (transversal sobre medio campo F11).
//
// Recorrido REAL por la interfaz visible (Biblioteca → crear → Diseñar →
// pizarra → elegir F7 → colocar cono → guardar → reabrir) y aserciones
// autoritativas sobre el DOCUMENTO PERSISTIDO y sobre el CAMPO
// seleccionado tras reabrir. También duplicado y round-trip de respaldo.
// =============================================================

const F7_BLUE = '#38bdf8';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'pl1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function hasF7(page: Page): Promise<boolean> {
  return page.locator('.board-canvas svg').evaluate((c) => c.innerHTML.includes('#38bdf8'));
}

async function openBoardClean(page: Page): Promise<void> {
  await page.waitForURL('**/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    // FASE G: el letterbox se espera con la ausencia de board-fill.
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}

async function savedExercise(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0]);
}

async function currentField(page: Page): Promise<string> {
  // Campo seleccionado en el panel de Propiedades (interacción visible).
  await page.locator('button[aria-label="Propiedades"]').click();
  const sel = page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select');
  await sel.waitFor({ state: 'visible' });
  // FASE G: observable — esperamos a que el select tenga el valor seleccionado.
  await expect.poll(async () => (await sel.inputValue()).trim(), { timeout: 5000 }).not.toBe('');
  const val = await sel.inputValue();
  await page.keyboard.press('Escape');
  // FASE G: observable — el panel se cierra al pulsar Escape.
  await expect(page.locator('.studio-panel')).toHaveCount(0);
  return val;
}

test.describe('FASE 0 — el terreno F7 sobrevive a guardar/reabrir, duplicar y respaldo', () => {
  test('crear → Diseñar → F7 → cono → guardar → reabrir conserva field f7 y el cono', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await page.goto('/library');
    await expect(page.locator('body')).toBeVisible();
    // FASE G: observable — la biblioteca ha cargado el botón "Crear tarea".
    await expect(page.locator('button', { hasText: 'Crear tarea' }).first()).toBeVisible();

    // Crear ejercicio → Diseñar.
    await page.locator('button', { hasText: 'Crear tarea' }).first().click();
    await page.locator('.modal input[name="title"]').fill('Rondo F7');
    await page.locator('.modal-foot button', { hasText: 'Diseñar' }).click();
    await openBoardClean(page);

    // Seleccionar F7 → el SVG renderiza las marcas azules F7.
    await page.locator('button[aria-label="Propiedades"]').click();
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('f7');
    // FASE G: observable — las marcas F7 ya están en el SVG (no una espera fija).
    await expect.poll(() => hasF7(page), { timeout: 5000 }).toBe(true);
    expect(await hasF7(page), 'F7 visible al seleccionarlo').toBe(true);

    // Colocar un cono y guardar.
    await page.keyboard.press('Escape');
    // FASE G: observable — el panel de Propiedades se cierra.
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    const host = await page.locator('.board-host').boundingBox();
    await page.mouse.click(host!.x + host!.width * 0.5, host!.y + host!.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    await fillBoardTitle(page, 'Rondo F7');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');

    // Aserción sobre el DOCUMENTO persistido.
    const saved = await savedExercise(page);
    expect(saved.canvas.field, 'documento persistido conserva field f7').toBe('f7');
    expect(saved.canvas.frames[0].elements).toHaveLength(1);
    expect(saved.canvas.frames[0].elements[0].t).toBe('cone');

    // Reabrir → aserción sobre el campo seleccionado tras reabrir.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await openBoardClean(page);
    expect(await hasF7(page), 'F7 renderizado tras reabrir').toBe(true);
    const reopenedDoc = await savedExercise(page);
    expect(reopenedDoc.canvas.field).toBe('f7');
    const fieldAfterReopen = await currentField(page);
    expect(fieldAfterReopen, 'campo seleccionado tras reabrir es f7').toBe('f7');
    expect(reopenedDoc.canvas.frames[0].elements).toHaveLength(1);
  });

  test('duplicar el ejercicio conserva F7 (documento + campo al reabrir la copia)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await page.goto('/board');
    await openBoardClean(page);
    await page.locator('button[aria-label="Propiedades"]').click();
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('f7');
    await expect.poll(() => hasF7(page), { timeout: 5000 }).toBe(true);
    await page.keyboard.press('Escape');
    // FASE G: observable — el panel de Propiedades se cierra.
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    const host = await page.locator('.board-host').boundingBox();
    await page.mouse.click(host!.x + host!.width * 0.5, host!.y + host!.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    await fillBoardTitle(page, 'Duplicar F7');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');

    // Duplicar desde el menú de opciones.
    await page.locator('.ex-card').first().hover();
    await page.locator('.ex-more-btn').first().click();
    await page.locator('.ex-more-item[title="Duplicar"]').first().click();
    // FASE G: observable — esperamos a que haya 2 ejercicios en localStorage.
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]') as unknown[]).length), { timeout: 5000 }).toBe(2);
    const copies = await page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:exercises')!));
    expect(copies).toHaveLength(2);
    const copy = copies[1];
    expect(copy.canvas?.field, 'copia duplicada conserva field f7').toBe('f7');

    // Abrir la copia (identificada por su título "(copia)") → sigue F7.
    const copyCard = page.locator('.ex-card', { hasText: '(copia)' });
    await expect(copyCard).toHaveCount(1);
    await copyCard.hover();
    await copyCard.locator('[title="Diseñar en pizarra"]').click();
    await openBoardClean(page);
    const copyField = await currentField(page);
    expect(copyField, 'campo seleccionado al abrir la copia es f7').toBe('f7');
  });

  test('exportar/importar respaldo conserva el campo F7 y el cono', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await page.goto('/board');
    await openBoardClean(page);
    await page.locator('button[aria-label="Propiedades"]').click();
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('f7');
    await expect.poll(() => hasF7(page), { timeout: 5000 }).toBe(true);
    await page.keyboard.press('Escape');
    // FASE G: observable — el panel de Propiedades se cierra.
    await expect(page.locator('.studio-panel')).toHaveCount(0);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    const host = await page.locator('.board-host').boundingBox();
    await page.mouse.click(host!.x + host!.width * 0.5, host!.y + host!.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    await fillBoardTitle(page, 'Backup F7');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');

    // Exportar respaldo.
    await page.locator('button[aria-label="Ajustes"]').click();
    const dlPromise = page.waitForEvent('download');
    await page.locator('.settings-row', { hasText: 'Exportar respaldo' }).locator('button', { hasText: 'Exportar' }).click();
    const dl = await dlPromise;
    const path = await dl.path();
    const parsed = JSON.parse(fs.readFileSync(path!, 'utf8'));
    expect(parsed.exercises[0].canvas.field, 'respaldo exportado conserva field f7').toBe('f7');

    // Importar (Reemplazar) → se conserva.
    await page.locator('.settings-row', { hasText: 'Importar respaldo' }).locator('input[type="file"]').setInputFiles(path!);
    await expect(page.locator('.settings-row', { hasText: 'Respaldo válido' })).toBeVisible();
    await page.locator('.settings-row', { hasText: 'Respaldo válido' }).locator('button', { hasText: 'Reemplazar' }).click();
    // FASE G: observable — esperamos a que el respaldo restaurado conserve el campo f7.
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]') as Array<{ canvas?: { field?: string } }>)[0]?.canvas?.field), { timeout: 5000 }).toBe('f7');
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:exercises')!));
    expect(restored[0].canvas.field, 'respaldo importado conserva field f7').toBe('f7');
    expect(restored[0].canvas.frames[0].elements).toHaveLength(1);
  });
});
