import { test, expect, Page } from '@playwright/test';

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en HORIZONTAL. */
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
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(200);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  await expect(page.locator('.board-host')).toBeVisible();
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Pulsa la herramienta de dibujo (por título) en el panel "Dibujo". */
async function useDrawTool(page: Page, title: string): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
  // FASE B (paneles persistentes): el panel Dibujo queda desplegado y cubriría el
  // campo en viewports compactos. Para dibujar el ejercicio necesita el campo libre,
  // así que se MINIMIZA con su botón X (sin desarmar la herramienta) antes del gesto.
  const panel = page.locator('.side-panel-left.tools-panel-side');
  if (await panel.isVisible().catch(() => false)) await panel.locator('.panel-close').click();
}

// ============================================================================

const DRAW_TOOLS = ['Línea', 'Flecha (movimiento)', 'Rectángulo', 'Círculo / elipse', 'Dibujo a mano alzada'] as const;

// Vistas del dueño: escritorio, tablet, móviles (horizontal).
const VIEWPORTS: Array<[number, number]> = [
  [1366, 768],
  [1024, 768],
  [390, 844],
  [360, 800],
];

test.describe('Fase 5 — dibujo de UN solo gesto (pointerdown → preview → pointerup)', () => {
  for (const [W, H] of VIEWPORTS) {
    for (const tool of DRAW_TOOLS) {
      test(`${tool} @ ${W}×${H}: la preview está visible ANTES del pointerup y se crea EXACTAMENTE UN objeto`, async ({ page }) => {
        await page.setViewportSize({ width: W, height: H });
        await seed(page);
        await openClosed(page);
        await useDrawTool(page, tool);
        await expect(page.locator('.field-count')).toHaveText('0');

        const host = await hostBox(page);
        const fit = await fitMode(page);
        const a = normToScreen(0.35, 0.4, host, fit);
        const b = normToScreen(0.65, 0.6, host, fit);

        // pointerdown + move de UN gesto, SIN pointerup.
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 6 });
        // FASE G: la preview se espera con la aserción siguiente (observable) antes de soltar.

        // La preview del gesto vive en su propio grupo con clase estable (`.board-preview`).
        // Antes se localizaba por su color de trazo, lo que acoplaba la prueba al color
        // por defecto de dibujo.
        await expect(page.locator('.board-canvas svg .board-preview'), 'la preview del trazo es visible ANTES de soltar').not.toHaveCount(0);
        // El documento NO ha modificado su contador (solo hay preview, no objeto definitivo).
        expect(await fieldCount(page), 'el objeto NO entra en el documento hasta el pointerup').toBe(0);

        // Captura de la preview antes de confirmar.
        await page.locator('.board-host').screenshot({ path: `e2e/shots/p56-selection/p5-preview-${tool.replace(/\W+/g, '-')}-${W}x${H}.png` });

        // pointerup → UN único objeto definitivo.
        await page.mouse.up();
        await expect(page.locator('.field-count')).toHaveText('1');

        // La herramienta vuelve a "Seleccionar".
        await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
      });
    }
  }

  test('un clic SIN movimiento NO crea una línea/shape invisible', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await useDrawTool(page, 'Línea');
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up(); // sin mover el puntero
    expect(await fieldCount(page), 'un clic sin movimiento no debe crear nada').toBe(0);
  });

  test('la herramienta se CAPTURA al empezar el borrador: ESPACIO a mitad de trazo (Mano) no pierde la línea', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openClosed(page);
    await useDrawTool(page, 'Línea');
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const a = normToScreen(0.35, 0.4, host, fit);
    const b = normToScreen(0.65, 0.6, host, fit);

    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    // A mitad del trazo se mantiene ESPACIO: la herramienta ACTIVA pasa a "Mano" (paneo rápido)
    // sin que el borrador deje de estar en curso.
    await page.keyboard.down(' ');
    await expect(page.locator('.rail-btn[aria-label="Desplazar campo"]')).toHaveClass(
      /rail-active/,
    );

    // La previsualización sigue siendo la LÍNEA del borrador: antes se quedaba VACÍA (ninguna
    // rama de `previewStr` casaba con "Mano") aunque el trazo se fuera a confirmar.
    await expect(
      page.locator('.board-canvas svg .board-preview line'),
      'la preview sigue mostrando la línea del borrador',
    ).toHaveCount(1);

    await page.mouse.up();
    await page.keyboard.up(' ');
    // El trazo NO desaparece: se crea la LÍNEA con la que EMPEZÓ el borrador (ni vacío ni otro tipo).
    await expect(page.locator('.field-count'), 'el trazo se confirma').toHaveText('1');
    await expect(page.locator('.board-canvas svg [data-el-type="line"]')).toHaveCount(1);
  });
});
