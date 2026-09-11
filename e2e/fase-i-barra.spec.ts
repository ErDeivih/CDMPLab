// =============================================================
// AUDITORÍA FINAL — Barra de contexto: colocación real en todas las vistas.
//
// La barra se coloca con su tamaño MEDIDO en el DOM (`ResizeObserver` sobre `.context-bar`),
// no con una copia en TypeScript de la geometría del CSS. Estas pruebas comprueban lo que
// de verdad importa y que una medida obsoleta rompería:
//   · la barra queda DENTRO del host (nunca fuera de pantalla),
//   · NO tapa el objeto seleccionado (separación exacta = hueco configurado),
//   · envuelve en dos filas cuando no cabe (360 px) y sigue dentro,
//   · funciona con el objeto cerca de los CUATRO bordes.
// Si cambia el número o el tamaño de los botones y alguien vuelve a calcular la altura a
// mano, la separación deja de ser la correcta y estas pruebas caen.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import {
  seedBoard,
  openBoard,
  hostBox,
  fitMode,
  fieldCount,
  normToScreen,
  showCategory,
} from './board-helpers';

/** Vistas del dueño: escritorio, móvil horizontal y tres verticales. */
const VIEWPORTS: Array<[number, number]> = [
  [1366, 768],
  [844, 390],
  [430, 932],
  [390, 844],
  [360, 800],
];

/** Posiciones del objeto: centro y los cuatro bordes. */
const POSICIONES: Array<[string, number, number]> = [
  ['centro', 0.5, 0.5],
  ['borde izquierdo', 0.07, 0.5],
  ['borde derecho', 0.93, 0.5],
  ['borde superior', 0.5, 0.08],
  ['borde inferior', 0.5, 0.92],
];

type Box = { x: number; y: number; width: number; height: number };

/** Posición de pantalla de un punto del campo, llevada al borde VISIBLE más cercano.
 *
 *  En móvil el campo va en modo «llenar alto» (`fit = height`): se ve la franja central y los
 *  lados quedan RECORTADOS fuera de la pantalla. Medido: en 430×932, pedir norm x = 0,07 da
 *  x = −298 px, un clic fuera del viewport que no prueba nada (el objeto ni se coloca).
 *  «Borde del campo» para el usuario es el borde que VE, así que el punto se lleva al borde
 *  visible del campo (intersección del campo con el host) con un margen. */
function puntoVisible(
  nx: number,
  ny: number,
  host: Box,
  fit: 'height' | 'contain',
): { x: number; y: number } {
  const p = normToScreen(nx, ny, host, fit);
  const campo0 = normToScreen(0, 0, host, fit);
  const campo1 = normToScreen(1, 1, host, fit);
  const margen = 24;
  const x0 = Math.max(host.x, campo0.x) + margen;
  const x1 = Math.min(host.x + host.width, campo1.x) - margen;
  const y0 = Math.max(host.y, campo0.y) + margen;
  const y1 = Math.min(host.y + host.height, campo1.y) - margen;
  return {
    x: Math.min(Math.max(p.x, x0), x1),
    y: Math.min(Math.max(p.y, y0), y1),
  };
}

async function placeCone(page: Page, nx: number, ny: number): Promise<void> {
  await showCategory(page, 'Material');
  await page.locator('.rail-btn[title="Cono"]').click();
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const p = puntoVisible(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
}

/** Caja en pantalla de un locator, esperando a que exista (el lienzo se repinta entero). */
async function box(page: Page, selector: string): Promise<Box> {
  let b: Box | null = null;
  await expect
    .poll(
      async () => {
        b = (await page.locator(selector).first().boundingBox()) as Box | null;
        return b !== null;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  return b as unknown as Box;
}

test.describe('AUDITORÍA — barra de contexto', () => {
  for (const [W, H] of VIEWPORTS) {
    for (const [nombre, nx, ny] of POSICIONES) {
      test(`${W}×${H} · objeto en ${nombre}: dentro del host, sin taparlo`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: W, height: H });
        await seedBoard(page);
        await openBoard(page);
        await placeCone(page, nx, ny);

        const cono = await box(page, '.entrenolab-board g[data-el-type="cone"]');
        const c = { x: cono.x + cono.width / 2, y: cono.y + cono.height / 2 };
        // El objeto se selecciona y el menú se abre con doble clic (la otra vía, la
        // pulsación larga, se cubre en `fase-i-interaccion`). SIN `delay`: un retardo
        // artificial entre los dos clics deja el gesto pegado al umbral de 350 ms del
        // producto (medido: 104–350 ms con `delay: 40`; 0–7 ms sin él) y falla con la
        // máquina cargada, que es un problema del gesto de la prueba, no de la app.
        await page.mouse.dblclick(c.x, c.y);
        await expect(page.locator('.context-bar')).toBeVisible();

        const barra = await box(page, '.context-bar');
        const host = (await hostBox(page)) as Box;
        const below = await page
          .locator('.context-bar')
          .evaluate((el) => el.classList.contains('context-bar-below'));

        // 1) DENTRO del host (tolerancia de 1 px por redondeo).
        expect(barra.x, 'no se sale por la izquierda').toBeGreaterThanOrEqual(host.x - 1);
        expect(barra.x + barra.width, 'no se sale por la derecha').toBeLessThanOrEqual(
          host.x + host.width + 1,
        );
        expect(barra.y, 'no se sale por arriba').toBeGreaterThanOrEqual(host.y - 1);
        expect(barra.y + barra.height, 'no se sale por abajo').toBeLessThanOrEqual(
          host.y + host.height + 1,
        );

        // 2) NO tapa el objeto: separación exacta (hueco = 8 px) en el eje vertical.
        const sep = below ? barra.y - (cono.y + cono.height) : cono.y - (barra.y + barra.height);
        expect(
          sep,
          `separación barra-objeto (${below ? 'debajo' : 'encima'})`,
        ).toBeGreaterThanOrEqual(5);
        expect(
          sep,
          'la separación es la del hueco configurado, no una altura adivinada',
        ).toBeLessThanOrEqual(12);

        // 3) Y sus cajas no se solapan (ni horizontal ni verticalmente).
        const solapaX = barra.x < cono.x + cono.width && cono.x < barra.x + barra.width;
        const solapaY = barra.y < cono.y + cono.height && cono.y < barra.y + barra.height;
        expect(solapaX && solapaY, 'la barra nunca se superpone al objeto').toBe(false);

        // 4) En móvil estrecho la barra ENVUELVE (dos filas) y sigue dentro.
        if (W <= 390 && host.width < 380) {
          expect(
            barra.height,
            'la barra envuelve en más de una fila y crece en alto',
          ).toBeGreaterThan(48);
          expect(barra.width, 'y respeta el ancho disponible').toBeLessThanOrEqual(host.width);
        }
      });
    }
  }
});

/** Geometría de la barra respecto al host y al objeto, en un instante dado. */
async function geometria(
  page: Page,
): Promise<{ dentro: boolean; solapa: boolean; sep: number; barra: Box; cono: Box }> {
  const barra = (await page.locator('.context-bar').boundingBox()) as Box;
  const cono = (await page
    .locator('.entrenolab-board g[data-el-type="cone"]')
    .boundingBox()) as Box;
  const host = (await hostBox(page)) as Box;
  const dentro =
    barra.x >= host.x - 1 &&
    barra.x + barra.width <= host.x + host.width + 1 &&
    barra.y >= host.y - 1 &&
    barra.y + barra.height <= host.y + host.height + 1;
  const solapaX = barra.x < cono.x + cono.width && cono.x < barra.x + barra.width;
  const solapaY = barra.y < cono.y + cono.height && cono.y < barra.y + barra.height;
  const sep =
    barra.y >= cono.y + cono.height
      ? barra.y - (cono.y + cono.height)
      : cono.y - (barra.y + barra.height);
  return { dentro, solapa: solapaX && solapaY, sep, barra, cono };
}

// Estas dos pruebas son las que FALLAN si alguien vuelve a calcular la posición con
// constantes en TypeScript (el antiguo `CTX_GEOM`): se cambia de verdad el DOM de la barra
// —tamaño de los botones y número de botones— y la colocación tiene que seguir siendo
// correcta. Con una copia de la geometría en TS, la barra crecería por debajo del alto
// supuesto y taparía el objeto (o se saldría del host).
test.describe('AUDITORÍA — la colocación sigue al DOM real, no a constantes', () => {
  test('con botones MÁS GRANDES la barra se recoloca sin tapar el objeto ni salirse', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await placeCone(page, 0.5, 0.5);
    const cono0 = await box(page, '.entrenolab-board g[data-el-type="cone"]');
    await page.mouse.dblclick(cono0.x + cono0.width / 2, cono0.y + cono0.height / 2);
    await expect(page.locator('.context-bar')).toBeVisible();
    const altoAntes = (await box(page, '.context-bar')).height;

    // Botones al doble de tamaño (selector más específico que el encapsulado de Angular).
    await page.addStyleTag({
      content:
        'div.context-bar button.ctx-btn { width: 84px !important; height: 84px !important; }',
    });
    // La colocación depende del `ResizeObserver`: se espera a la nueva disposición, pero la
    // aserción es la geometría, no el tiempo.
    await expect
      .poll(async () => (await geometria(page)).dentro, {
        message: 'la barra recolocada sigue dentro del host',
        timeout: 5000,
      })
      .toBe(true);
    const g = await geometria(page);
    expect(g.barra.height, 'la barra ha crecido de verdad').toBeGreaterThan(altoAntes + 20);
    expect(g.solapa, 'y aun así no tapa el objeto').toBe(false);
    expect(g.sep, 'mantiene la separación del hueco configurado').toBeGreaterThanOrEqual(5);
  });

  test('con MÁS BOTONES la barra se recoloca sin salirse del host', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await placeCone(page, 0.5, 0.5);
    const cono0 = await box(page, '.entrenolab-board g[data-el-type="cone"]');
    await page.mouse.dblclick(cono0.x + cono0.width / 2, cono0.y + cono0.height / 2);
    await expect(page.locator('.context-bar')).toBeVisible();
    const anchoAntes = (await box(page, '.context-bar')).width;

    // Se AÑADEN botones (no se quitan): la barra se ensancha y acaba envolviendo.
    await page.evaluate(() => {
      const bar = document.querySelector('.context-bar')!;
      const modelo = bar.querySelector('button.ctx-btn')!;
      for (let i = 0; i < 24; i++) bar.appendChild(modelo.cloneNode(true));
    });
    await expect
      .poll(async () => (await geometria(page)).dentro, {
        message: 'la barra con más botones sigue dentro del host',
        timeout: 5000,
      })
      .toBe(true);
    const g = await geometria(page);
    expect(g.barra.width, 'la barra ha cambiado de tamaño de verdad').not.toBe(anchoAntes);
    expect(g.solapa, 'y aun así no tapa el objeto').toBe(false);
    expect(g.sep, 'mantiene la separación del hueco configurado').toBeGreaterThanOrEqual(5);
  });
});
