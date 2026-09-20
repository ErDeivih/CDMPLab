import { test, expect, Page } from '@playwright/test';
import {
  hostBox,
  normToScreen,
  showCategory,
  fitMode,
  expectPanelLibreDelGrupo,
} from './board-helpers';

/**
 * FASE 5 del encargo — PANELES DE LA PIZARRA EN MÓVIL.
 *
 * Horizontal (844×390):
 *  1/2. El panel empieza justo debajo del encabezado compacto y llega al borde inferior disponible.
 *  3.   No queda ninguna franja de campo entre el borde izquierdo y el panel.
 *  4.   Ancho ≈ min(340px, 45vw) con scroll interno.
 *  5.   No se solapa con controles imprescindibles (raíl de herramientas y cabecera).
 *  6.   Permanece abierto hasta que el usuario lo minimiza o lo cierra.
 *
 * Vertical (390×844):
 *  1/3/4. Se mantiene la HOJA INFERIOR, con su alto acotado, encabezado/tabs/cierre visibles y
 *         posibilidad de minimizar.
 *  5.   Un material se puede arrastrar de uno en uno al campo.
 */

const MOVIL_H = { width: 844, height: 390 };
const MOVIL_V = { width: 390, height: 844 };

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    localStorage.setItem('entrenolab:orient-hint', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function abrirPizarraYLimpia(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (
      await page
        .locator(sel)
        .isVisible()
        .catch(() => false)
    )
      await page.locator(sel).click();
  }
}

test.describe('FASE 5 — paneles de la pizarra en móvil', () => {
  test.use({ hasTouch: true });

  test('horizontal 844×390: el panel pega con la cabecera, llega abajo, mide ≈min(340px,45vw) y no tapa controles', async ({
    page,
  }) => {
    await page.setViewportSize(MOVIL_H);
    await seed(page);
    await abrirPizarraYLimpia(page);
    await showCategory(page, 'Material');

    const panel = page.locator('.side-panel-left[aria-label="Herramientas de Material"]');
    await expect(panel).toBeVisible();
    const caja = (await panel.boundingBox())!;
    const cabecera = (await page.locator('.studio-top').boundingBox())!;
    const main = (await page.locator('.studio-main').boundingBox())!;
    const grupo = (await page.locator('.studio-tools').boundingBox())!;
    console.log(
      `[fase5-h] panel=${JSON.stringify(caja)} cabecera=${JSON.stringify(cabecera)} main=${JSON.stringify(main)} grupo=${JSON.stringify(grupo)}`,
    );

    // 1) Empieza inmediatamente debajo del encabezado compacto (el panel vive dentro del área
    //    principal, que arranca donde termina la cabecera).
    expect(caja.y, 'el panel arranca justo bajo la cabecera').toBeGreaterThanOrEqual(
      cabecera.y + cabecera.height - 2,
    );
    expect(caja.y).toBeLessThanOrEqual(cabecera.y + cabecera.height + 2);
    // 2) Y llega hasta el borde inferior DISPONIBLE. FASE 3: ese borde ya no es el final de
    //    `.studio-main`, sino la franja que reserva el grupo flotante de herramientas (el grupo va por
    //    encima del panel y sin reserva interceptaba sus últimas filas). Se mide contra el grupo.
    expect(
      Math.abs(caja.y + caja.height - grupo.y),
      'el panel termina justo encima del grupo flotante (sin hueco extra)',
    ).toBeLessThanOrEqual(2);
    // 3) Sin franja muerta a la izquierda.
    expect(caja.x, 'pegado al borde izquierdo').toBeLessThanOrEqual(1);
    // 4) Ancho del encargo y scroll interno.
    const esperado = Math.min(340, MOVIL_H.width * 0.45);
    expect(
      Math.abs(caja.width - esperado),
      `ancho medido ${caja.width} vs ${esperado}`,
    ).toBeLessThanOrEqual(2);
    const desborda = await panel.evaluate((el) => getComputedStyle(el).overflowY);
    expect(['auto', 'scroll'], 'el panel tiene scroll interno').toContain(desborda);
    // 5) FASE 3: ya no hay barra inferior que invada el panel. Ahora el grupo flota SOBRE el panel
    //    (esquina inferior izquierda) y lo que se exige es huella acotada, controles libres y grupo
    //    operable; la cabecera sigue libre.
    await expectPanelLibreDelGrupo(page, '.side-panel-left[aria-label="Herramientas de Material"]');
    expect(caja.y, 'ni con la cabecera').toBeGreaterThanOrEqual(cabecera.y + cabecera.height - 2);
    // 6) Sigue abierto hasta que el usuario lo minimice o cierre.
    await page.waitForTimeout(400);
    await expect(panel, 'el panel sigue abierto sin que nadie lo cierre').toBeVisible();
    await panel.locator('.panel-min').first().click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.panel-tab'), 'minimizado → pestaña para recuperarlo').toBeVisible();
    await page.locator('.panel-tab').click();
    await expect(panel, 'se recupera tal cual estaba').toBeVisible();
  });

  test('vertical 390×844: hoja inferior acotada, con cabecera/tabs/cierre y minimizable', async ({
    page,
  }) => {
    await page.setViewportSize(MOVIL_V);
    await seed(page);
    await abrirPizarraYLimpia(page);
    await showCategory(page, 'Material');

    const panel = page.locator('.side-panel-left[aria-label="Herramientas de Material"]');
    await expect(panel).toBeVisible();
    const caja = (await panel.boundingBox())!;
    const main = (await page.locator('.studio-main').boundingBox())!;
    const grupo = (await page.locator('.studio-tools').boundingBox())!;
    console.log(
      `[fase5-v] panel=${JSON.stringify(caja)} main=${JSON.stringify(main)} grupo=${JSON.stringify(grupo)}`,
    );
    expect(caja.width, 'ocupa el ancho').toBeGreaterThanOrEqual(MOVIL_V.width - 2);
    expect(caja.height, 'no ocupa más de lo necesario (~58 %)').toBeLessThanOrEqual(
      MOVIL_V.height * 0.6 + 2,
    );
    // FASE 3: la hoja se ancla al borde inferior DISPONIBLE, que ahora es la franja reservada del
    // grupo flotante (antes el final de `.studio-main`).
    expect(
      Math.abs(caja.y + caja.height - grupo.y),
      'anclada justo encima del grupo flotante',
    ).toBeLessThanOrEqual(2);
    // Encabezado, tabs y botón de cerrar siguen visibles.
    await expect(panel.locator('.panel-close').first()).toBeVisible();
    // FASE 3: la categoría ya no vive en una barra fija (está en el menú flotante «Herramientas» y el
    // menú se cierra al elegir). Lo que debe seguir visible con el panel abierto es el GRUPO flotante
    // —permite volver al Cursor sin cerrar el panel—, que flota por encima del panel.
    await expect(page.locator('.tools-persist')).toBeVisible();
    await expect(page.locator('.tools-toggle')).toBeVisible();
    await expect(page.locator('.rail-btn[aria-label="Seleccionar y mover"]')).toBeVisible();
    await panel.locator('.panel-min').first().click();
    await expect(panel).toHaveCount(0);
    await page.locator('.panel-tab').click();
    await expect(panel).toBeVisible();
  });

  test('vertical: los materiales se añaden de uno en uno al campo', async ({ page }) => {
    await page.setViewportSize(MOVIL_V);
    await seed(page);
    await abrirPizarraYLimpia(page);
    await showCategory(page, 'Material');

    // Se elige el material y se coloca con un toque en el campo. La app añade los objetos DE UNO EN
    // UNO (la colocación continua permite repetir sin volver al panel). Se comprueba con DOS
    // objetos: el primero y el segundo, cada uno con su propio toque.
    const cono = page.locator('.rail-btn[title="Cono"]').first();
    await expect(cono).toBeVisible();
    await cono.click();
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    for (const [nx, ny] of [
      [0.45, 0.45],
      [0.55, 0.55],
    ] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
    }
    await expect(page.locator('.field-count'), 'dos materiales, uno a uno').toHaveText('2');
  });
});
