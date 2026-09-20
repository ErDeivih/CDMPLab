import { test, expect, Page } from '@playwright/test';
import { hostBox, normToScreen, showCategory, fitMode, abrirHerramientas } from './board-helpers';

/**
 * FASE 3 del encargo — barra inferior sustituida por el grupo flotante «Herramientas».
 *
 * CONTRATO NUEVO (implementado en esta ronda; esta prueba se actualiza explicando el cambio, porque
 * antes fijaba a propósito el estado pendiente):
 *  · `.studio-tools` ya NO participa en el layout (`position: absolute`), así que el campo recupera
 *    los 57 px de alto que la barra reservaba (medido antes: `.studio-main` 289 px en 844×390) y
 *    termina en el borde inferior de la pantalla.
 *  · Las tres categorías (Jugadores/Material/Dibujo) viven en el menú que abre el botón
 *    «Herramientas» y ya no existen en el DOM mientras está cerrado. El menú se cierra solo al
 *    elegir categoría.
 *  · Cursor y Mano siguen SIEMPRE visibles: su uso es continuo y mover/desarmar no puede exigir
 *    abrir un menú (además son ~190 usos en las pruebas y el flujo real del dueño).
 *
 * Por qué la esquina inferior IZQUIERDA y no el centro: «objeto en borde inferior» (FASE I) coloca en
 * x = centro del campo e y = borde inferior − 24 px. El grupo mide ~152 px de ancho en 360 px, así
 * que la banda inferior CENTRAL queda libre, y su contenedor no intercepta clics
 * (`pointer-events: none`): solo sus controles los reciben. La prueba «no tapa la banda de
 * colocación» comprueba exactamente eso con `elementFromPoint`.
 *
 * Mantenimiento: pulsar un `.tools-cat` exige abrir el menú antes (`abrirHerramientas(page)` en
 * `board-helpers`); el menú no está en el DOM cuando está cerrado.
 */

const ESCRITORIO = { width: 1366, height: 900 };
const MOVIL_H = { width: 844, height: 390 };

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

async function abrirPizarra(page: Page): Promise<void> {
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

test.describe('FASE 3 — herramientas de la pizarra (grupo flotante)', () => {
  test.use({ hasTouch: true });

  test('FASE 3.1: la barra ya NO ocupa layout y el campo llega al borde inferior', async ({
    page,
  }) => {
    await page.setViewportSize(MOVIL_H);
    await seed(page);
    await abrirPizarra(page);
    const posicion = await page
      .locator('.studio-tools')
      .evaluate((el) => getComputedStyle(el).position);
    // CAMBIO DE CONTRATO: antes esta prueba exigía `not.toBe('absolute')` y un campo que NO llegaba
    // al borde inferior (estado pendiente documentado). Ahora el grupo flota y el campo llega abajo.
    expect(posicion, 'el grupo flotante está fuera del flujo').toBe('absolute');
    const main = (await page.locator('.studio-main').boundingBox())!;
    expect(
      Math.abs(main.y + main.height - MOVIL_H.height),
      `el área del campo termina en el borde inferior de la pantalla (${main.y + main.height} vs ${MOVIL_H.height})`,
    ).toBeLessThanOrEqual(2);
  });

  test('FASE 3.2: el grupo flotante NO intercepta la banda inferior de colocación (cerrado y abierto)', async ({
    page,
  }) => {
    await page.setViewportSize(MOVIL_H);
    await seed(page);
    await abrirPizarra(page);
    const host = await hostBox(page);

    // Punto real de «objeto en borde inferior» (FASE I): centro del campo visible, 24 px por encima
    // del borde inferior del área del campo.
    const x = host.x + host.width / 2;
    const y = host.y + host.height - 24;
    const quienRecibe = () =>
      page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px as number, py as number);
          if (!el) return 'nada';
          return el.closest('.studio-tools') ? 'grupo-flotante' : el.className || el.tagName;
        },
        [x, y],
      );

    expect(await quienRecibe(), 'con el menú cerrado llega el tablero').not.toBe('grupo-flotante');
    await abrirHerramientas(page);
    await expect(page.locator('.tools-menu')).toBeVisible();
    expect(
      await quienRecibe(),
      'con el menú abierto la banda inferior central sigue siendo del tablero',
    ).not.toBe('grupo-flotante');
  });

  test('FASE 3.2b: «Herramientas» abre el menú de categorías y se cierra al elegir una', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await abrirPizarra(page);

    // Cerrado por defecto: las categorías NO están en el DOM.
    await expect(page.locator('.tools-menu')).toHaveCount(0);
    await expect(page.locator('.tools-cat')).toHaveCount(0);

    await page.locator('.tools-toggle').click();
    const menu = page.locator('.tools-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.tools-cat')).toHaveCount(3);
    await expect(page.locator('.tools-toggle')).toHaveAttribute('aria-expanded', 'true');

    // Elegir categoría abre su panel y CIERRA el menú (para no tapar la banda inferior del campo).
    await abrirHerramientas(page); // idempotente: ya estaba abierto
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await expect(page.locator('.tools-menu')).toHaveCount(0);
    await expect(page.locator('.tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  test('todas las herramientas siguen accesibles: Cursor, Mano, Jugadores, Material y Dibujo', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await abrirPizarra(page);

    // Cursor y Mano existen, son distintos y funcionan como herramientas separadas.
    const cursor = page.locator('.rail-btn[aria-label="Seleccionar y mover"]');
    const mano = page.locator('.rail-btn[aria-label="Desplazar campo"]');
    await expect(cursor).toBeVisible();
    await expect(mano).toBeVisible();
    await cursor.click();
    await expect(cursor).toHaveClass(/rail-active/);
    await mano.click();
    await expect(mano).toHaveClass(/rail-active/);
    await expect(cursor).not.toHaveClass(/rail-active/);
    await cursor.click();

    // Las tres categorías abren su panel.
    for (const [categoria, panel] of [
      ['Jugadores', '.side-panel-left[aria-label="Jugadores"]'],
      ['Material', '.side-panel-left[aria-label="Herramientas de Material"]'],
      ['Dibujo', '.side-panel-left[aria-label="Herramientas de Dibujo"]'],
    ] as Array<[string, string]>) {
      await showCategory(page, categoria);
      await expect(page.locator(panel), `el panel de ${categoria} se abre`).toBeVisible();
      await page.locator('.side-panel-left .panel-close').first().click();
      await expect(page.locator(panel)).toHaveCount(0);
    }

    // Colocación continua: dos toques con la herramienta armada colocan dos objetos.
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').first().click();
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    for (const [nx, ny] of [
      [0.4, 0.4],
      [0.6, 0.6],
    ] as Array<[number, number]>) {
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
    }
    await expect(page.locator('.field-count'), 'dos conos seguidos').toHaveText('2');
  });

  test('FASE 3.3: con colocación continua activa aparece «Volver a Cursor» en la cabecera y devuelve al Cursor', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await abrirPizarra(page);
    const volver = page.locator('.studio-top button[aria-label="Volver a Cursor"]');
    // Con el Cursor activo no hay nada a lo que volver.
    await expect(volver, 'sin colocación activa no aparece').toHaveCount(0);
    const cabeceraAntes = (await page.locator('.studio-top').boundingBox())!;

    // Se arma el material: aparece el botón.
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').first().click();
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
    await expect(volver, 'con el cono armado aparece el botón').toBeVisible();
    // Y la cabecera NO crece: el botón no le quita ni un píxel al campo (por eso vive aquí y no
    // flotando sobre el campo, donde tapaba la banda inferior y impedía colocar ahí — medido).
    const cabeceraDespues = (await page.locator('.studio-top').boundingBox())!;
    expect(
      Math.abs(cabeceraDespues.height - cabeceraAntes.height),
      'la cabecera mantiene su altura',
    ).toBeLessThanOrEqual(1);
    const main = (await page.locator('.studio-main').boundingBox())!;
    expect(main.y, 'el campo sigue empezando donde empezaba').toBeLessThanOrEqual(
      cabeceraAntes.y + cabeceraAntes.height + 2,
    );

    // Y devuelve al Cursor de verdad: el botón desaparece y el raíl marca Cursor.
    await volver.click();
    await expect(volver).toHaveCount(0);
    await expect(page.locator('.rail-btn[aria-label="Seleccionar y mover"]')).toHaveClass(
      /rail-active/,
    );
  });

  test('la interfaz NO se cuela en el PNG exportado (se dibuja desde el modelo)', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await abrirPizarra(page);
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').first().click();
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.field-count')).toHaveText('1');

    await page.locator('.studio-top button[aria-label="Exportar"]').click();
    await page.locator('.rail-btn', { hasText: 'PNG' }).first().click();
    const dl = await page.waitForEvent('download', { timeout: 20_000 });
    const ruta = await dl.path();
    expect(ruta, 'el navegador entregó el PNG').toBeTruthy();

    const analisis = await page.evaluate(
      async (dataUrl: string) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const banda = 60;
        const fraccionOscura = (desde: number) => {
          const d = ctx.getImageData(0, desde, c.width, banda).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] < 60 && d[i + 1] < 65 && d[i + 2] < 75) n++;
          }
          return n / (banda * c.width);
        };
        return {
          ancho: c.width,
          alto: c.height,
          abajo: fraccionOscura(c.height - banda),
          arriba: fraccionOscura(0),
        };
      },
      `data:image/png;base64,${(await import('node:fs')).readFileSync(ruta!).toString('base64')}`,
    );
    console.log(`[fase3] PNG exportado: ${JSON.stringify(analisis)}`);
    expect(analisis.ancho).toBeGreaterThan(500);
    // El PNG exportado incluye el MARGEN OSCURO del campo (por diseño, `MARGIN_STRIP`), así que la
    // prueba correcta es la SIMETRÍA entre la banda inferior y la superior: si la barra de
    // herramientas (o cualquier control) se exportara, la inferior sería distinta. (La primera
    // versión de esta aserción exigía césped abajo y falló: el error era de la prueba, no del PNG.)
    expect(
      Math.abs(analisis.abajo - analisis.arriba),
      `abajo=${analisis.abajo.toFixed(3)} arriba=${analisis.arriba.toFixed(3)}`,
    ).toBeLessThanOrEqual(0.02);
  });
});
