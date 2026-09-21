import { test, expect, Page } from '@playwright/test';
import { openBoard, hostBox, normToScreen, showCategory, fitMode } from './board-helpers';

/**
 * FASE 2 del encargo — COLOR DE JUGADOR EXCLUSIVO DEL EJERCICIO.
 *
 * Defecto que se corrige: `setRosterColor` llamaba a `store.updatePlayer(id, { color })`, así que
 * elegir un color en la pizarra modificaba PERMANENTEMENTE al jugador de la plantilla (y con él
 * todos los ejercicios). Ahora el color vive en `CanvasDocument.playerColors` (mapa
 * `playerId → color` del ejercicio).
 *
 * Este spec demuestra, con datos reales del almacén:
 *  1. Ejercicio A: Marcos en ROJO → su ficha sale roja y se guarda `playerColors.p1 = rojo`.
 *  2. Ejercicio B (nuevo): Marcos se coloca con el color POR DEFECTO (no hereda A) y se cambia a
 *     MORADO → `playerColors.p1 = morado`.
 *  3. La plantilla (`entrenolab:players`) NO cambia nunca: sigue en su azul original.
 *  4. Al reabrir A, su ficha vuelve a ser roja (cada ejercicio recupera SUS colores).
 */

const ESCRITORIO = { width: 1366, height: 900 };
const AZUL_PLANTILLA = '#1a73e8';
const ROJO = '#c0392b';
const MORADO = '#8e44ad';

/** Almacén de jugadores/exercicios con guarda para que recargar o navegar no borre nada. */
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
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify([
        {
          id: 'p1',
          teamId: 't1',
          name: 'Marcos',
          number: 2,
          position: 'DF',
          color: '#1a73e8',
          active: true,
          createdAt: now,
        },
        // CORRECCIÓN 1: dos jugadores más con colores PERMANENTES distintos. En un ejercicio nuevo
        // los tres deben salir con el color común por defecto (azul), no con el suyo.
        {
          id: 'p2',
          teamId: 't1',
          name: 'Pau',
          number: 10,
          position: 'MF',
          color: '#c0392b',
          active: true,
          createdAt: now,
        },
        {
          id: 'p3',
          teamId: 't1',
          name: 'Dani',
          number: 1,
          position: 'GK',
          color: '#8e44ad',
          active: true,
          createdAt: now,
        },
      ]),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function abrirJugadores(page: Page): Promise<void> {
  await showCategory(page, 'Jugadores');
  await expect(page.locator('.side-panel-left')).toBeVisible();
}

/** Elige un color en la paleta del jugador (abre la mini-paleta y pulsa el swatch). */
async function elegirColor(page: Page, color: string): Promise<void> {
  await page.locator('.roster-color').first().click();
  const swatch = page.locator(`.roster-color-menu .swatch[data-color="${color}"]`);
  await expect(swatch, 'el swatch del color pedido está en la paleta').toHaveCount(1);
  await swatch.click();
  // El cierre de la paleta no garantiza que Angular haya repintado la ficha y el SVG.
  await expect(page.locator('.roster-color').first()).toHaveAttribute(
    'data-color-ejercicio',
    color,
  );
}

/** Coloca a Marcos en el campo (arma la colocación y pulsa el campo). */
async function colocarMarcos(page: Page): Promise<void> {
  const fila = page.locator('.side-panel-left button', { hasText: 'Marcos' }).first();
  await expect(fila, 'la fila de Marcos está en el panel Jugadores').toBeVisible();
  await fila.click();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(0.45, 0.55, host, fit);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.field-count')).toHaveText('1');
}

/** Color real de la ficha de Marcos dibujada en el SVG (`c` del elemento renderizado). */
async function colorFichaEnPantalla(page: Page): Promise<string> {
  await expect(page.locator('.board-canvas svg [data-el-type="player"]').first()).toBeVisible();
  return (
    (await page
      .locator('.board-canvas svg [data-el-type="player"]')
      .first()
      .evaluate((el) => {
        const conRelleno = el.querySelector('[fill]');
        return (
          el.getAttribute('fill') ??
          conRelleno?.getAttribute('fill') ??
          el.querySelector('circle')?.getAttribute('fill') ??
          ''
        );
      })) ?? ''
  );
}

async function guardar(page: Page, titulo: string): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').first().click();
  await page.locator('input[aria-label="Título del ejercicio"]').fill(titulo);
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  await expect(page.locator('.ex-card').first()).toBeVisible();
}

const almacen = (page: Page) =>
  page.evaluate(() => ({
    jugadores: JSON.parse(localStorage.getItem('entrenolab:players') ?? '[]') as Array<{
      id: string;
      color: string;
    }>,
    ejercicios: JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]') as Array<{
      title: string;
      canvas: { playerColors?: Record<string, string> } | null;
    }>,
  }));

test.describe('FASE 2 — el color del jugador pertenece al ejercicio', () => {
  test.use({ hasTouch: true });

  test('dos ejercicios con colores distintos del mismo jugador y la plantilla intacta', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);

    // ---------- Ejercicio A: Marcos en ROJO ----------
    await openBoard(page);
    await abrirJugadores(page);
    await elegirColor(page, ROJO);
    await colocarMarcos(page);
    expect(await colorFichaEnPantalla(page), 'la ficha colocada sale ROJA').toBe(ROJO);
    await guardar(page, 'Ejercicio A');

    let datos = await almacen(page);
    expect(datos.ejercicios[0].canvas?.playerColors, 'A guarda su propio mapa de colores').toEqual({
      p1: ROJO,
    });
    expect(
      datos.jugadores.find((j) => j.id === 'p1')?.color,
      'la PLANTILLA no se ha tocado al elegir color en la pizarra',
    ).toBe(AZUL_PLANTILLA);

    // ---------- Ejercicio B (nuevo): Marcos NO hereda el rojo ----------
    await page.goto('/board');
    await expect(page.locator('.board-canvas svg')).toBeVisible();
    await abrirJugadores(page);
    await colocarMarcos(page);
    expect(
      await colorFichaEnPantalla(page),
      'un ejercicio NUEVO no hereda los colores del anterior',
    ).toBe(AZUL_PLANTILLA);

    await elegirColor(page, MORADO);
    await expect
      .poll(() => colorFichaEnPantalla(page), {
        message: 'la ficha ya colocada se repinta a MORADO',
      })
      .toBe(MORADO);
    await guardar(page, 'Ejercicio B');

    datos = await almacen(page);
    const a = datos.ejercicios.find((e) => e.title === 'Ejercicio A');
    const b = datos.ejercicios.find((e) => e.title === 'Ejercicio B');
    expect(a?.canvas?.playerColors, 'A conserva el rojo').toEqual({ p1: ROJO });
    expect(b?.canvas?.playerColors, 'B conserva el morado').toEqual({ p1: MORADO });
    expect(
      datos.jugadores.find((j) => j.id === 'p1')?.color,
      'la plantilla sigue en azul tras los dos ejercicios',
    ).toBe(AZUL_PLANTILLA);

    // ---------- Reabrir A: recupera SUS colores ----------
    const tarjetaA = page.locator('.ex-card', { hasText: 'Ejercicio A' }).first();
    await tarjetaA.locator('.ex-open-btn').click();
    await page.waitForURL('**/board');
    await expect(page.locator('.board-canvas svg')).toBeVisible();
    expect(await colorFichaEnPantalla(page), 'al reabrir A la ficha vuelve a ser ROJA').toBe(ROJO);
    // Y la paleta del panel marca el color del ejercicio, no el de la plantilla.
    await abrirJugadores(page);
    await expect(page.locator('.roster-color').first()).toHaveAttribute(
      'data-color-ejercicio',
      ROJO,
    );

    // ---------- La fichas genéricas por color siguen funcionando ----------
    await showCategory(page, 'Jugadores');
    const generico = page.locator('.tray-player[title="Jugador Azul"]').first();
    if ((await generico.count()) > 0) {
      await generico.click();
      const host = await hostBox(page);
      const fit = await fitMode(page);
      const p = normToScreen(0.7, 0.3, host, fit);
      await page.mouse.click(p.x, p.y);
      await expect(page.locator('.field-count')).toHaveText('2');
    }
  });

  test('CORRECCIÓN 1: tres jugadores con colores de plantilla distintos salen TODOS azules en un ejercicio nuevo', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await openBoard(page);
    await abrirJugadores(page);

    // Colocar los tres jugadores, sin asignar ningún color.
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const posiciones: Array<[string, number, number]> = [
      ['Marcos', 0.3, 0.35],
      ['Pau', 0.5, 0.5],
      ['Dani', 0.7, 0.65],
    ];
    for (const [nombre, nx, ny] of posiciones) {
      await page.locator('.side-panel-left button', { hasText: nombre }).first().click();
      const p = normToScreen(nx, ny, host, fit);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(120);
    }
    await expect(page.locator('.field-count')).toHaveText('3');

    // Los TRES fichas son del mismo azul por defecto, aunque en la plantilla tengan colores
    // permanentes distintos (azul, rojo y morado): el color de plantilla no decide nada aquí.
    const colores = await page
      .locator('.board-canvas svg [data-el-type="player"] circle[fill]')
      .evaluateAll((els) => els.map((e) => (e.getAttribute('fill') ?? '').toLowerCase()));
    expect(colores, 'hay tres fichas pintadas').toHaveLength(3);
    for (const c of colores) {
      expect(c, `la ficha sale con el azul común (medido: ${colores.join(', ')})`).toBe('#1a73e8');
    }
    expect(new Set(colores).size, 'no hay dos colores distintos').toBe(1);

    // Y la plantilla sigue intacta con sus colores permanentes.
    const plantilla = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('entrenolab:players') ?? '[]') as Array<{
          id: string;
          color: string;
        }>,
    );
    expect(plantilla.map((p) => p.color)).toEqual(['#1a73e8', '#c0392b', '#8e44ad']);
  });

  test('la paleta marca el color elegido con un tick accesible', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await openBoard(page);
    await abrirJugadores(page);

    await page.locator('.roster-color').first().click();
    const menu = page.locator('.roster-color-menu');
    await expect(menu).toBeVisible();
    // Los cinco colores del encargo, con su estado accesible.
    await expect(menu.locator('.swatch')).toHaveCount(5);
    await expect(menu.locator('.swatch[data-color="#1a73e8"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(menu.locator('.swatch[aria-checked="true"] .msi')).toHaveText('check');

    await menu.locator('.swatch[data-color="#e67e22"]').click();
    await page.locator('.roster-color').first().click();
    await expect(menu.locator('.swatch[data-color="#e67e22"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(menu.locator('.swatch[data-color="#c0392b"]')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(menu.locator('.swatch[aria-checked="true"] .msi')).toHaveText('check');
  });
});
