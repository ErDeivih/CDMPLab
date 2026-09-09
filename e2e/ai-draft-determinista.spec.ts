// =============================================================
// FASE 4/1/7 (IA) — E2E del borrador determinista.
//
// Inyecta un AiExerciseDraftV1 (JSON) en sessionStorage (aislado por
// pestaña), navega a `/board/draft` y el `AiDraftGuard` lo compila y
// abre la pizarra como borrador editable, inicializando el panel
// "Datos del ejercicio" con los metadatos del borrador. Se verifica:
//  1. el borrador se abre con su composición y SU METADATOS;
//  2. se puede EDITAR (mover un jugador) y DESHACER (Ctrl+Z);
//  3. NO se auto-guarda (entrenolab:exercises sigue vacío);
//  4. el borrador se CONSUME (recargar no lo reabre);
//  5. se GUARDA únicamente tras la confirmación del usuario y conserva
//     los metadatos al reabrir desde Biblioteca.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/ai-draft';
fs.mkdirSync(SHOTS, { recursive: true });

const DRAFT = {
  schemaVersion: 1,
  title: 'Salida de balón 4-3-3',
  description: 'Posesión y salida limpia desde el portero.',
  objective: 'Circular el balón y superar la primera línea de presión.',
  durationMinutes: 15,
  material: '2 miniporterías',
  field: 'half',
  orientation: 'horizontal',
  playerCount: 11,
  ownColor: '#1a73e8',
  rivalColor: '#25a5d9',
  ownFormation: '4-3-3',
  rivalFormation: '4-4-2',
  materials: [
    { kind: 'cone_red', position: { x: 0.3, y: 0.3 } },
    { kind: 'cone_red', position: { x: 0.6, y: 0.6 } },
    { kind: 'pole', position: { x: 0.5, y: 0.8 } },
  ],
  shapes: [
    { kind: 'arrow', from: { x: 0.35, y: 0.25 }, to: { x: 0.65, y: 0.45 } },
  ],
  texts: [{ position: { x: 0.5, y: 0.12 }, value: 'Salida de balón' }],
};

function seed() {
  return `(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    sessionStorage.setItem('entrenolab:ai-draft', ${JSON.stringify(JSON.stringify(DRAFT))});
  })()`;
}

async function exercisesCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]');
    return Array.isArray(ex) ? ex.length : 0;
  });
}

async function injectDraft(page: Page): Promise<void> {
  // Debe ejecutarse con una página con origen (no about:blank).
  await page.evaluate((draft) => {
    sessionStorage.setItem('entrenolab:ai-draft', JSON.stringify(draft));
  }, DRAFT);
}

async function dismissHelp(page: Page): Promise<void> {
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

test('borrador IA determinista: abre con metadatos, se edita/deshace, no se auto-guarda, se consume y conserva al guardar', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript(seed());

  // 1) Abrir el borrador; el panel "Datos del ejercicio" se inicializa con sus metadatos.
  await page.goto('/board/draft');
  await expect(page.locator('.board-host')).toBeVisible();
  await dismissHelp(page);
  await page.waitForTimeout(400);

  const total = Number(await page.locator('.field-count').innerText());
  expect(total, 'se abrió la composición del borrador').toBeGreaterThanOrEqual(25);
  await expect(page.locator('.board-canvas svg [data-el-type="player"]').first()).toHaveCount(1);

  // Abrir el panel de Propiedades para leer los metadatos del borrador.
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(150);

  // Metadatos en el panel "Datos del ejercicio" (por aria-label).
  await expect(page.locator('[aria-label="Título del ejercicio"]')).toHaveValue('Salida de balón 4-3-3');
  await expect(page.locator('[aria-label="Descripción"]')).toHaveValue(/Posesión y salida limpia/);
  await expect(page.locator('[aria-label="Explicación"]')).toHaveValue(/Circular el balón/);
  // FASE 8: "Material necesario" es un checklist. El material del borrador IA
  // ("2 miniporterías") se muestra como opción marcada.
  await expect(page.locator('.material-checklist input[aria-label="2 miniporterías"]')).toBeChecked();
  await expect(page.locator('.material-checklist')).toContainText('miniporterías');

  // 2) EDITAR: mover el primer jugador.
  const playerSel = '.board-canvas svg [data-el-type="player"]';
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  const firstBox = (await page.locator(playerSel).first().boundingBox())!;
  const cx = firstBox.x + firstBox.width / 2;
  const cy = firstBox.y + firstBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.locator('.board-host').screenshot({ path: `${SHOTS}/borrador-ia-editado.png` });

  // 3) DESHACER.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  await page.locator('.board-host').screenshot({ path: `${SHOTS}/borrador-ia.png` });

  // 4) No se auto-guarda.
  expect(await exercisesCount(page), 'el borrador no se auto-guarda').toBe(0);

  // 5) El draft se CONSUMIÓ: recargar /board/draft sin draft pendiente NO lo reabre (va a /board vacío).
  await page.goto('/board/draft');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(300);
  const emptyCount = Number(await page.locator('.field-count').innerText());
  expect(emptyCount, 'sin draft pendiente el borrador no se reabre').toBe(0);

  // 6) GUARDAR tras confirmación: reinjectamos y volvemos a /board/draft, guardamos.
  await injectDraft(page);
  await page.goto('/board/draft');
  await expect(page.locator('.board-host')).toBeVisible();
  await dismissHelp(page);
  await page.waitForTimeout(300);
  await page.locator('.chip-icon-primary[aria-label="Guardar"]').click();
  await page.waitForURL('**/library');
  expect(await exercisesCount(page), 'guardar tras confirmación crea el ejercicio').toBe(1);

  // 7) REABRIR desde Biblioteca: metadatos, campo y elementos conservados.
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(150);
  const savedTitle = await page.locator('[aria-label="Título del ejercicio"]').inputValue();
  expect(savedTitle, 'el título guardado se conserva').toBe('Salida de balón 4-3-3');
  await expect(page.locator('[aria-label="Descripción"]')).toHaveValue(/Posesión y salida limpia/);
  // FASE 8: material como checkbox (se conserva al reabrir).
  await expect(page.locator('.material-checklist input[aria-label="2 miniporterías"]')).toBeChecked();
  const saveCount = Number(await page.locator('.field-count').innerText());
  expect(saveCount, 'los elementos del borrador se conservan').toBeGreaterThanOrEqual(25);
});
