// =============================================================
// FASE H — Dibujos REALES con verificación de atributos.
//
// DEFECTO 3 corregido: se crean de verdad las 12 familias de dibujo y se
// comprueba el tipo de elemento y sus atributos (trazo discontinuo,
// punta de flecha, doble punta, curvas distintas, zigzag, color), además
// de la preview visible desde pointerdown hasta pointerup. La captura
// muestra los dibujos EN EL CAMPO, no la lista de botones.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { seedBoard, openBoard, hostBox, fitMode, fieldCount, normToScreen, showCategory } from './board-helpers';

const OUT = 'docs/screenshots/fase-h';
fs.mkdirSync(OUT, { recursive: true });

/** Arma una herramienta de Dibujo (abre el panel), fija el estilo de trazo si procede y
 *  CIERRA el panel para no tapar el campo al dibujar. */
async function armDraw(page: Page, title: string, style?: 'Trazo continuo' | 'Trazo discontinuo'): Promise<void> {
  await showCategory(page, 'Dibujo');
  await page.locator(`.rail-btn[title="${title}"]`).click();
  if (style) await page.locator(`.tools-caption .chip[aria-label="${style}"]`).click();
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
}

async function drawAt(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], host, fit);
  const b = normToScreen(to[0], to[1], host, fit);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

const g = (page: Page, type: string) => page.locator(`.board-canvas svg g[data-el-type="${type}"]`);

test.describe('FASE H — los 12 dibujos, con atributos verificados', () => {
  test('línea continua y discontinua: tipo y trazo discontinuo', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);

    await armDraw(page, 'Línea', 'Trazo continuo');
    await drawAt(page, [0.2, 0.2], [0.5, 0.2]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);

    await armDraw(page, 'Línea', 'Trazo discontinuo');
    await drawAt(page, [0.2, 0.3], [0.5, 0.3]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);

    await expect(g(page, 'line')).toHaveCount(2);
    // Una línea es continua (sin stroke-dasharray) y la otra discontinua (con dasharray).
    await expect(page.locator('.board-canvas svg g[data-el-type="line"] line[stroke-dasharray]')).toHaveCount(1);
    const dashes = await page.locator('.board-canvas svg g[data-el-type="line"] line').evaluateAll((els) => els.map((e) => e.getAttribute('stroke-dasharray')));
    expect(dashes.filter((d) => !d).length, 'una sin discontinuo').toBe(1);
    expect(dashes.filter((d) => d).length, 'una con discontinuo').toBe(1);
  });

  test('flecha continua/discontinua y flecha doble: puntas correctas', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);

    await armDraw(page, 'Flecha (movimiento)', 'Trazo continuo');
    await drawAt(page, [0.2, 0.2], [0.5, 0.2]);
    await armDraw(page, 'Flecha (movimiento)', 'Trazo discontinuo');
    await drawAt(page, [0.2, 0.3], [0.5, 0.3]);
    await armDraw(page, 'Flecha doble sentido');
    await drawAt(page, [0.2, 0.4], [0.5, 0.4]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);

    await expect(g(page, 'arrow')).toHaveCount(2);
    await expect(g(page, 'doubleArrow')).toHaveCount(1);
    // Cada flecha simple tiene UNA punta (1 polígono).
    for (let i = 0; i < 2; i++) {
      await expect(g(page, 'arrow').nth(i).locator('polygon'), 'flecha simple: una punta').toHaveCount(1);
    }
    // Trazo discontinuo presente en UNA de las flechas simples.
    await expect(page.locator('.board-canvas svg g[data-el-type="arrow"] line[stroke-dasharray]')).toHaveCount(1);
    // La flecha doble tiene DOS puntas (2 polígonos).
    await expect(g(page, 'doubleArrow').locator('polygon'), 'flecha doble: dos puntas').toHaveCount(2);
  });

  test('curvas izquierda y derecha son DISTINTAS; zigzag compacto con punta', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);

    await armDraw(page, 'Curva izquierda');
    await drawAt(page, [0.2, 0.2], [0.5, 0.4]);
    await armDraw(page, 'Curva derecha');
    await drawAt(page, [0.2, 0.6], [0.5, 0.8]);
    await armDraw(page, 'Conducción (zigzag)');
    await drawAt(page, [0.6, 0.3], [0.9, 0.5]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);

    await expect(g(page, 'curve')).toHaveCount(2);
    const ds = await g(page, 'curve').locator('path').evaluateAll((els) => els.map((e) => e.getAttribute('d')));
    expect(ds.length).toBe(2);
    expect(ds[0], 'la curva es una Bézier (Q)').toContain('Q');
    expect(ds[0], 'las dos curvas se doblan en sentidos distintos').not.toBe(ds[1]);
    // Zigzag: path con varios tramos (L) + una punta.
    await expect(g(page, 'dribble')).toHaveCount(1);
    const zig = await g(page, 'dribble').locator('path').getAttribute('d');
    const segments = (zig!.match(/L/g) ?? []).length;
    expect(segments, 'el zigzag tiene varios dientes').toBeGreaterThanOrEqual(3);
    await expect(g(page, 'dribble').locator('polygon'), 'zigzag con punta').toHaveCount(1);
  });

  test('rectángulo, elipse, mano alzada y texto: tipos y contenido', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);

    await armDraw(page, 'Rectángulo');
    await drawAt(page, [0.2, 0.2], [0.4, 0.4]);
    await armDraw(page, 'Círculo / elipse');
    await drawAt(page, [0.5, 0.2], [0.7, 0.4]);
    await armDraw(page, 'Dibujo a mano alzada');
    await drawAt(page, [0.2, 0.6], [0.5, 0.8]);
    // Texto: se coloca con un clic y se escribe en el inspector.
    await armDraw(page, 'Texto');
    const host = await hostBox(page); const fit = await fitMode(page);
    const pt = normToScreen(0.75, 0.7, host, fit);
    await page.mouse.click(pt.x, pt.y);
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Rondo 4v2');
    await ta.dispatchEvent('change');
    await ta.evaluate((el) => (el as HTMLElement).blur());
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(4);

    await expect(g(page, 'rect')).toHaveCount(1);
    await expect(g(page, 'rect').locator('rect')).toHaveCount(1);
    await expect(g(page, 'ellipse')).toHaveCount(1);
    await expect(g(page, 'freehand')).toHaveCount(1);
    await expect(g(page, 'freehand').locator('polyline')).toHaveCount(1);
    await expect(g(page, 'text')).toHaveCount(1);
    await expect(g(page, 'text').locator('text')).toContainText('Rondo 4v2');
  });

  test('color seleccionado se aplica al trazo (data-color)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Línea"]').click();
    // Elegir ROJO en la paleta de la herramienta (caption).
    await page.locator('.tools-caption .swatch').nth(1).click(); // #c0392b
    await page.locator('.side-panel-left .panel-close').first().click();
    await drawAt(page, [0.25, 0.5], [0.6, 0.5]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await expect(g(page, 'line')).toHaveAttribute('data-color', '#c0392b');
  });

  test('preview visible DESDE pointerdown hasta pointerup', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await armDraw(page, 'Línea');
    const host = await hostBox(page); const fit = await fitMode(page);
    const a = normToScreen(0.25, 0.4, host, fit);
    const b = normToScreen(0.65, 0.6, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    // ANTES de soltar: hay preview en el SVG y todavía NO hay elemento definitivo.
    await expect(page.locator('.board-canvas svg .board-preview'), 'preview visible antes de soltar').not.toHaveCount(0);
    expect(await fieldCount(page), 'el documento no cambia hasta el pointerup').toBe(0);
    await page.mouse.up();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  });

  test('captura escritorio-dibujos.png: los 12 dibujos EN EL CAMPO', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);

    await armDraw(page, 'Línea', 'Trazo continuo'); await drawAt(page, [0.12, 0.12], [0.32, 0.12]);
    await armDraw(page, 'Línea', 'Trazo discontinuo'); await drawAt(page, [0.12, 0.2], [0.32, 0.2]);
    await armDraw(page, 'Flecha (movimiento)', 'Trazo continuo'); await drawAt(page, [0.42, 0.12], [0.62, 0.12]);
    await armDraw(page, 'Flecha (movimiento)', 'Trazo discontinuo'); await drawAt(page, [0.42, 0.2], [0.62, 0.2]);
    await armDraw(page, 'Flecha doble sentido'); await drawAt(page, [0.72, 0.12], [0.92, 0.12]);
    await armDraw(page, 'Curva izquierda'); await drawAt(page, [0.12, 0.35], [0.32, 0.45]);
    await armDraw(page, 'Curva derecha'); await drawAt(page, [0.42, 0.35], [0.62, 0.45]);
    await armDraw(page, 'Conducción (zigzag)'); await drawAt(page, [0.72, 0.35], [0.92, 0.45]);
    await armDraw(page, 'Rectángulo'); await drawAt(page, [0.12, 0.6], [0.28, 0.8]);
    await armDraw(page, 'Círculo / elipse'); await drawAt(page, [0.36, 0.6], [0.52, 0.8]);
    await armDraw(page, 'Dibujo a mano alzada'); await drawAt(page, [0.6, 0.72], [0.78, 0.62]);
    await armDraw(page, 'Texto');
    const host = await hostBox(page); const fit = await fitMode(page);
    const pt = normToScreen(0.62, 0.88, host, fit);
    await page.mouse.click(pt.x, pt.y);
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Salida de balón');
    await ta.dispatchEvent('change');
    await ta.evaluate((el) => (el as HTMLElement).blur());

    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(12);
    // Captura de PÁGINA: campo con los dibujos + barra (no solo el panel).
    await page.screenshot({ path: `${OUT}/escritorio-dibujos.png` });
  });
});
