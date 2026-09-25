import { test, expect, Page } from '@playwright/test';
import { openBoard, hostBox, normToScreen, showCategory, fitMode } from './board-helpers';

/**
 * FASE 4 del encargo — PIZARRA MÓVIL Y ORIENTACIÓN.
 *
 *  1/2. Dentro de /board la navegación global inferior NO se muestra en móvil (las cuatro entradas:
 *      Plantilla, Biblioteca, Sesiones y Más); las demás pantallas la conservan.
 *  3.   La pizarra ocupa todo el espacio hasta la safe area (sin hueco reservado a la nav).
 *  4.   Hay salida clara por el encabezado compacto (botón «Volver»).
 *  6/11. Si el navegador no permite bloquear la orientación, la app NO se bloquea: aparece un aviso
 *      corto y descartable y se sigue pudiendo dibujar.
 *  7/8. Sin bloqueo, el campo se adapta a la pantalla: vertical en 390×844, horizontal en 844×390.
 *  9.   Un ejercicio YA GUARDADO no se reescribe en silencio: se ofrece «Adaptar a la pantalla».
 */

const MOVIL_V = { width: 390, height: 844 };
const MOVIL_H = { width: 844, height: 390 };

async function seed(page: Page, ejercicios: unknown[] = []): Promise<void> {
  await page.addInitScript((exs: unknown[]) => {
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
    localStorage.setItem('entrenolab:exercises', JSON.stringify(exs));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, ejercicios);
}

/**
 * ¿El campo dibujado está en horizontal (más ancho que alto) o en vertical?
 * Devuelve `null` mientras no haya una caja medible: el tablero repinta al abrir y al girar, y una
 * aserción dentro del sondeo abortaba el `expect.poll` (fallo intermitente medido). Devolviendo
 * `null`, el sondeo simplemente sigue esperando.
 */
async function orientacionDelCampo(page: Page): Promise<'horizontal' | 'vertical' | null> {
  const caja = await page
    .locator('.entrenolab-grass')
    .first()
    .boundingBox()
    .catch(() => null);
  if (!caja || caja.width < 2 || caja.height < 2) return null;
  return caja.width >= caja.height ? 'horizontal' : 'vertical';
}

test.describe('FASE 4 — pizarra móvil, navegación y orientación', () => {
  test.use({ hasTouch: true });

  test('1-2-3-4. en /board la navegación global se oculta y la pizarra llega hasta abajo; otras páginas la conservan', async ({
    page,
  }) => {
    for (const vp of [MOVIL_V, MOVIL_H]) {
      await page.setViewportSize(vp);
      await seed(page);

      // Otra pantalla: la navegación sigue ahí, con sus cinco entradas.
      await page.goto('/team');
      await expect(page.locator('.nav-movil')).toBeVisible();
      await expect(page.locator('.nav-movil .nav-item')).toHaveCount(4);

      // Pizarra: la navegación global NO se muestra y no deja hueco. Se espera ANTES a que el shell
      // haya aplicado el estado de pizarra: si se mide mientras el layout se recoloca, la prueba se
      // vuelve intermitente (medido: un fallo distinto en cada pasada).
      await openBoard(page);
      await expect(page.locator('.shell')).toHaveClass(/en-pizarra/);
      await expect(page.locator('.sidebar'), 'la barra inferior se oculta en /board').toBeHidden();
      await expect(page.locator('.nav-movil'), 'sin navegación global').toBeHidden();
      // Las cuatro entradas siguen en el DOM (el shell no se desmonta) pero NINGUNA se ve.
      for (const destino of ['Plantilla', 'Biblioteca', 'Sesiones', 'Más']) {
        const enlaces = page.locator('.shell .nav-item', { hasText: destino });
        const cuantos = await enlaces.count();
        expect(cuantos, `«${destino}» existe en el DOM (shell montado)`).toBeGreaterThan(0);
        for (let i = 0; i < cuantos; i++) {
          await expect(
            enlaces.nth(i),
            `«${destino}» no se MUESTRA dentro de la pizarra`,
          ).toBeHidden();
        }
      }
      const studio = (await page.locator('.studio').boundingBox())!;
      console.log(`[fase4 ${vp.width}x${vp.height}] studio=${JSON.stringify(studio)}`);
      expect(studio.y, 'el tablero arranca arriba').toBeLessThanOrEqual(2);
      expect(
        studio.y + studio.height,
        'y llega al borde inferior (safe area), sin hueco de navegación',
      ).toBeGreaterThanOrEqual(vp.height - 2);

      // Salida clara por el encabezado.
      await expect(page.locator('.studio-top button[aria-label="Volver"]')).toBeVisible();
    }
  });

  test('6-11. si el navegador no permite bloquear la orientación, avisa y NO bloquea la app', async ({
    page,
  }) => {
    await page.setViewportSize(MOVIL_V);
    await seed(page);
    await openBoard(page);

    // En Chromium headless el bloqueo no se concede (y puede no existir): el resultado esperado es
    // el aviso corto y descartable, nunca un error que impida usar la pizarra.
    const aviso = page.locator('.orient-aviso');
    if ((await aviso.count()) > 0) {
      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText('no permite girar');
      await aviso.locator('button[aria-label="Entendido, ocultar el aviso"]').click();
      await expect(aviso).toHaveCount(0);
    }
    // Se sigue pudiendo trabajar: colocar material.
    const host = await hostBox(page);
    const fit = await fitMode(page);
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').first().click();
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
    const p = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('7-8. al girar la pantalla el campo se adapta: vertical en 390×844 y horizontal en 844×390', async ({
    page,
  }) => {
    await page.setViewportSize(MOVIL_H);
    await seed(page);
    await openBoard(page);
    // CONTRATO: al CARGAR no se cambia el campo bajo los pies del usuario (32 ficheros de pruebas
    // asumen la orientación del documento al abrir, y cambiarla al entrar tampoco es deseable). En
    // horizontal y con un ejercicio nuevo el campo ya nace horizontal, así que no hay nada que
    // ofrecer; si no cuadrara, se ofrecería «Adaptar a la pantalla».
    expect(await orientacionDelCampo(page), 'al abrir en horizontal el campo es horizontal').toBe(
      'horizontal',
    );

    // Y al GIRAR de verdad (cambio real de orientación) un ejercicio NUEVO se adapta solo. Se espera
    // con `expect.poll` al estado nuevo en vez de con un tiempo fijo: el `waitForTimeout(400)` corto
    // dejaba la prueba INTERMITENTE (a veces medía antes de que el tablero se repintara).
    await page.setViewportSize(MOVIL_V);
    await expect.poll(async () => orientacionDelCampo(page), { timeout: 5000 }).toBe('vertical');

    // Y al volver a horizontal, otra vez.
    await page.setViewportSize(MOVIL_H);
    await expect.poll(async () => orientacionDelCampo(page), { timeout: 5000 }).toBe('horizontal');
  });

  test('9. un ejercicio GUARDADO no se reescribe en silencio: ofrece «Adaptar a la pantalla»', async ({
    page,
  }) => {
    await page.setViewportSize(MOVIL_V);
    const ahora = new Date().toISOString();
    await seed(page, [
      {
        id: 'e-guardado',
        teamId: 't1',
        folderId: null,
        title: 'Guardado horizontal',
        description: '',
        explanation: '',
        category: 'Técnica',
        objectives: [],
        materials: [],
        durationMinutes: 10,
        minPlayers: null,
        maxPlayers: null,
        loadMode: 'fixed',
        seriesCount: null,
        repetitionsCount: null,
        workSeconds: null,
        restSeconds: null,
        isTemplate: false,
        thumbnail: null,
        canvas: {
          version: 2,
          field: 'full',
          orientation: 'horizontal',
          frames: [
            { duration: 1000, elements: [{ id: 'c1', t: 'cone', x: 0.4, y: 0.4, c: '#e74c3c' }] },
          ],
        },
        savedAt: ahora,
      },
    ]);
    await page.goto('/library');
    await expect(page.locator('.ex-card').first()).toBeVisible();
    await page.locator('.ex-card .ex-open-btn').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.board-canvas svg')).toBeVisible();

    // El documento guardado sigue en horizontal: NO se ha reescrito. Se mide con `expect.poll`
    // porque el tablero repinta al abrir y una medición puntual podía caer a mitad del repintado
    // (medido: fallo intermitente).
    await expect.poll(async () => orientacionDelCampo(page), { timeout: 5000 }).toBe('horizontal');
    const guardadoAntes = await page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]') as Array<{
            canvas: { orientation?: string };
          }>
        )[0]?.canvas?.orientation,
    );
    expect(guardadoAntes, 'el documento guardado no se toca').toBe('horizontal');

    // Y se ofrece adaptarlo a mano.
    const adaptar = page.locator('.adaptar-pantalla');
    await expect(adaptar, 'se ofrece «Adaptar a la pantalla»').toBeVisible();
    await adaptar.click();
    await expect.poll(async () => orientacionDelCampo(page), { timeout: 5000 }).toBe('vertical');
    await expect(adaptar, 'tras adaptar, el ofrecimiento desaparece').toHaveCount(0);
  });
});
