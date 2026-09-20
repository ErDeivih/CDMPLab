// =============================================================
// BLOQUE E — trazo Continuo/Discontinuo por herramienta (Línea y Flecha
// independientes), persistencia bajo clave CDMPLab versionada y migración
// de la clave antigua de color. Requisito de la entrega: el preview, el
// objeto final, la reapertura, el PNG y la memoria local deben coincidir.
//
// Fuente de verdad: el SVG renderizado del campo (`.entrenolab-board`) y el
// modelo persistido en localStorage bajo la clave versionada.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import type { CanvasDocument } from '../src/app/core/models';
import { toggleFillScreen } from './gesture-helpers';

const VBW = 100;
const VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
type Box = { x: number; y: number; width: number; height: number };
function normToScreen(nx: number, ny: number, b: Box): [number, number] {
  const s = Math.min(b.width / VBW, b.height / VBH);
  const offX = (b.width - VBW * s) / 2;
  const offY = (b.height - VBH * s) / 2;
  const cx = offX + (nx * RECT.w + RECT.x) * s;
  const cy = offY + (ny * RECT.h + RECT.y) * s;
  return [b.x + cx, b.y + cy];
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    // Sembrar la clave antigua de color para comprobar la migración BLOQUE E.
    localStorage.setItem('entrenolab:tool-colors', JSON.stringify({ line: '#111111' }));
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (
    await page
      .locator('.help-close')
      .isVisible()
      .catch(() => false)
  )
    await page.locator('.help-close').click();
  if (
    await page
      .locator('.fill-hint-close')
      .isVisible()
      .catch(() => false)
  )
    await page.locator('.fill-hint-close').click();
  const fill = await page
    .locator('.board-host')
    .evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await toggleFillScreen(page);
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  }
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

async function dragDraw(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await hostBox(page);
  const [x1, y1] = normToScreen(from[0], from[1], box);
  const [x2, y2] = normToScreen(to[0], to[1], box);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

async function useDrawTool(page: Page, title: string): Promise<void> {
  // FASE B (paneles persistentes): abrir la categoría Dibujo es IDEMPOTENTE. Si el panel
  // ya está desplegado (ya no se cierra al elegir una herramienta) no lo re-togglea, porque
  // re-clickear el mismo .tools-cat lo cerraría y la siguiente herramienta no se podría usar.
  if (
    !(await page
      .locator('.side-panel-left.tools-panel-side')
      .isVisible()
      .catch(() => false))
  ) {
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

async function pickTrazo(page: Page, label: 'Continuo' | 'Discontinuo'): Promise<void> {
  // Chips visibles SOLO cuando la herramienta activa es Línea/Flecha/doble/medida.
  // Se identifica el chip por su aria-label EXACTO (evita confundir «Continuo» con
  // «Discontinuo») en vez de por su texto con regex anclado: el texto del botón lleva
  // espacios alrededor porque la plantilla está formateada con Prettier, y depender de eso
  // hacía que la prueba se rompiera al formatear `board.component.html`. El aria-label es el
  // contrato estable (accesibilidad) y no cambia con el formato.
  const aria = label === 'Continuo' ? 'Trazo continuo' : 'Trazo discontinuo';
  await page.locator(`.tools-caption .chip[aria-label="${aria}"]`).click();
}

async function pickColor(page: Page, hex: string): Promise<void> {
  const index = [
    '#1a73e8',
    '#c0392b',
    '#1f7a4d',
    '#e67e22',
    '#7d3c98',
    '#b8860b',
    '#111111',
    '#f4f4f4',
  ].indexOf(hex);
  await page.locator('.tools-caption .swatch').nth(index).click();
}

async function boardSvg(page: Page): Promise<string> {
  return await page.evaluate(() => document.querySelector('.entrenolab-board')?.innerHTML ?? '');
}

function canvasDoc(page: Page): Promise<CanvasDocument> {
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas as CanvasDocument;
  });
}

async function openProps(page: Page): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(
    page.locator('.studio-panel input[aria-label="Título del ejercicio"]'),
  ).toBeVisible();
}

async function save(page: Page): Promise<void> {
  await openProps(page);
  await page.locator('.studio-panel input[aria-label="Título del ejercicio"]').fill('Trazo');
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

async function reopen(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (
    await page
      .locator('.help-close')
      .isVisible()
      .catch(() => false)
  )
    await page.locator('.help-close').click();
}

test.setTimeout(120_000);

test.describe('BLOQUE E — trazo por herramienta, clave versionada y migración', () => {
  test('Línea discontinua y Flecha continua coexisten; el objeto final refleja el trazo elegido', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    // Línea → DISCONTINUA.
    await useDrawTool(page, 'Línea');
    await pickTrazo(page, 'Discontinuo');
    await dragDraw(page, [0.15, 0.3], [0.5, 0.3]);

    // Flecha → CONTINUA (independiente de Línea).
    await useDrawTool(page, 'Flecha (movimiento)');
    await pickTrazo(page, 'Continuo');
    await dragDraw(page, [0.15, 0.6], [0.5, 0.6]);

    const svg = await boardSvg(page);
    const lineDash = await page.evaluate(
      () =>
        document
          .querySelector('.entrenolab-board g[data-el-type="line"] line')
          ?.getAttribute('stroke-dasharray') ?? null,
    );
    const arrowDash = await page.evaluate(
      () =>
        document
          .querySelector('.entrenolab-board g[data-el-type="arrow"] line')
          ?.getAttribute('stroke-dasharray') ?? null,
    );
    expect(lineDash, 'la línea discontinua lleva stroke-dasharray').not.toBeNull();
    expect(arrowDash, 'la flecha continua NO lleva stroke-dasharray').toBeNull();

    // La preferencia se persiste bajo la clave CDMPLab versionada.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('cdmplab:tool-line-style:v1') ?? '{}'),
    );
    expect(stored['line'], 'Línea recuerda Discontinuo').toBe('dashed');
    expect(stored['arrow'], 'Flecha recuerda Continuo').toBe('solid');
  });

  test('la clave antigua de color se migra a la clave CDMPLab versionada y se descarta', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    // Al armar Línea, la aplicación lee el color sembrado en la clave antigua (#111111).
    await useDrawTool(page, 'Línea');
    await pickColor(page, '#c0392b');
    const newer = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('cdmplab:tool-colors:v1') ?? '{}'),
    );
    expect(newer['line'], 'el color se guarda en la clave nueva').toBe('#c0392b');
    const legacy = await page.evaluate(() => localStorage.getItem('entrenolab:tool-colors'));
    expect(legacy, 'la clave antigua se elimina tras migrar').toBeNull();
  });

  test('el trazo discontinuo persiste en el modelo al guardar y reabrir (objeto final estable)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    await useDrawTool(page, 'Línea');
    await pickTrazo(page, 'Discontinuo');
    await dragDraw(page, [0.2, 0.4], [0.7, 0.4]);

    await save(page);
    let doc = await canvasDoc(page);
    const line = doc.frames[0].elements.find((e) => e.t === 'line')!;
    expect(line.style, 'el modelo guarda el trazo discontinuo').toBe('dashed');

    await reopen(page);
    const svg = await boardSvg(page);
    expect(svg, 'al reabrir la línea sigue discontinua').toContain('stroke-dasharray');
  });

  test('la variante de material se persiste bajo la clave CDMPLab versionada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);

    // FASE 7: el Aro ya NO tiene variantes (se eliminó ring_flat). Se verifica la
    // persistencia de variante con un material que SÍ las conserva (Cono, 6 colores).
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-material-card')).toHaveCount(19);
    const coneCard = page.locator('.tools-material-card', { hasText: 'Cono' }).first();
    await coneCard.locator('.tools-material-variants .variant-swatch').nth(1).click();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('cdmplab:material-variant:v1') ?? '{}'),
    );
    expect(stored['cone'], 'el material recuerda su variante').toBeTruthy();
  });
});
