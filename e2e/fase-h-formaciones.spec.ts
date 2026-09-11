// =============================================================
// FASE H — Formaciones realmente aplicadas.
//
// DEFECTO 2 corregido: se aplican formaciones DE VERDAD (no solo captura
// del panel) y se comprueba el modelo persistido: 11 genéricos sin
// nombre/dorsal/side/type/POR, y una segunda formación REFLEJADA con otro
// color (geometría espejada + dos colores).
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { fillBoardTitle } from './gesture-helpers';
import { seedBoard, openBoard, showCategory, fieldCount, hostBox, fitMode, normToScreen } from './board-helpers';

const OUT = 'docs/screenshots/fase-h';
fs.mkdirSync(OUT, { recursive: true });

type El = { t: string; c?: string; x?: number; y?: number; n?: number; side?: string; type?: string; label?: string; playerId?: string };

/** Guarda el ejercicio y devuelve los elementos persistidos de la pizarra. */
async function saveAndRead(page: Page, title: string): Promise<El[]> {
  await fillBoardTitle(page, title);
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  return page.evaluate(() => {
    const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
    return ex.canvas.frames[0].elements as El[];
  });
}

async function openBoardAgain(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
}

/** Posiciones de los jugadores tal como se ven en el SVG. El grupo con
 *  `data-el-type` NO lleva transform: la posición va en su grupo INTERNO
 *  (`<g transform="translate(x y) scale(s)">`, ver render.ts caso 'player'). */
async function playerPoints(page: Page): Promise<string[]> {
  return page.locator('.entrenolab-board g[data-el-type="player"]').evaluateAll((els) =>
    els.map((e) => {
      const inner = e.querySelector('g[transform]');
      const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(inner?.getAttribute('transform') ?? '');
      return m ? `${m[1]},${m[2]}` : 'sin-transform';
    }),
  );
}

/** Posición de un jugador identificado por su etiqueta visible. */
async function labelledPoint(page: Page, label: string): Promise<string> {
  return page.locator('.entrenolab-board g[data-el-type="player"]').evaluateAll((els, lbl) => {
    const target = els.find((e) => (e.textContent ?? '').includes(lbl as string));
    if (!target) return 'no-encontrado';
    const inner = target.querySelector('g[transform]');
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(inner?.getAttribute('transform') ?? '');
    return m ? `${m[1]},${m[2]}` : 'sin-transform';
  }, label);
}

test.describe('FASE H — formaciones aplicadas de verdad', () => {
  test('4-3-3 sin plantilla → 11 genéricos sin nombre/dorsal/side/type/POR', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false }); // SIN plantilla
    await openBoard(page);
    await showCategory(page, 'Jugadores');

    // Color propio (azul, primer chip genérico) y formación 4-3-3.
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);

    // El render NO contiene "POR" ni nombres.
    const svg = await page.locator('.board-canvas svg').innerHTML();
    expect(svg, 'sin rol de portero en genéricos').not.toContain('POR');
    const circles = page.locator('.entrenolab-board circle[r="2.5"]');
    await expect(circles).toHaveCount(11);

    // Modelo persistido: 11 jugadores genéricos SIN nombre/dorsal/side/type/playerId.
    const els = await saveAndRead(page, 'Formacion 433');
    const players = els.filter((e) => e.t === 'player');
    expect(players.length, '11 genéricos de la formación').toBe(11);
    for (const p of players) {
      expect(p.label, 'genérico sin nombre').toBeFalsy();
      expect(p.playerId, 'genérico sin playerId').toBeFalsy();
      expect(p.side, 'genérico sin side').toBeFalsy();
      expect(p.type, 'genérico sin type (ni portero)').toBeFalsy();
      expect(p.n, 'genérico sin dorsal').toBeFalsy();
      expect(p.c, 'genérico con color').toBeTruthy();
    }
    // Todos del color elegido (propio = azul por defecto del chip).
    expect(new Set(players.map((p) => p.c)).size, 'un solo color').toBe(1);

    await openBoardAgain(page);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
  });

  test('segunda formación REFLEJADA y con otro color → geometría espejada y dos colores', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false });
    await openBoard(page);
    await showCategory(page, 'Jugadores');

    // Propia azul: 4-3-3.
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);

    // Rival rojo + Reflejar: 4-4-2.
    await page.locator('.tray-quick .tray-quick-chip').nth(1).click();
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(22);

    const els = await saveAndRead(page, 'Formaciones 433 442');
    const players = els.filter((e) => e.t === 'player');
    expect(players.length, '11 propias + 11 rivales').toBe(22);
    const colors = new Set(players.map((p) => p.c));
    expect(colors.size, 'dos colores (propio y rival)').toBe(2);
    const own = players.filter((p) => p.c === players[0].c);
    const rival = players.filter((p) => p.c !== players[0].c);
    expect(own.length).toBe(11);
    expect(rival.length).toBe(11);
    // Geometría REFLEJADA: el centroide en X del rival es ~1-x del propio.
    const cx = (arr: El[]) => arr.reduce((a, p) => a + (p.x ?? 0), 0) / arr.length;
    expect(Math.abs(cx(rival) - (1 - cx(own))), 'el rival está reflejado en X').toBeLessThan(0.05);
    // Ninguno tiene nombre/dorsal/POR.
    for (const p of players) {
      expect(p.label).toBeFalsy();
      expect(p.n).toBeFalsy();
      expect(p.type).toBeFalsy();
    }
  });

  test('reaplicar una formación NO borra el dorsal ni la etiqueta escritos a mano', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false });
    await openBoard(page);
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);

    // Se elige el mediocentro de la formación ([0.5, 0.25]) y se le pone dorsal y etiqueta
    // a mano: son datos DEL USUARIO, y reaplicar la formación no debe borrarlos.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.25, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.inspector')).toBeVisible();
    await page.locator('.inspector input[type="number"]').fill('9');
    await page.locator('.inspector input[type="number"]').press('Tab');
    await page.locator('.inspector input[placeholder="Nombre / puesto"]').fill('Pivote');
    await page.locator('.inspector input[placeholder="Nombre / puesto"]').press('Tab');
    // El `<svg>` es `.board-canvas svg` (`.entrenolab-board` es el <g> de dentro).
    await expect(page.locator('.board-canvas svg')).toContainText('9');
    await expect(page.locator('.board-canvas svg'), 'la etiqueta se dibuja').toContainText('Pivote');

    // Otra formación distinta: los genéricos se recolocan…
    await showCategory(page, 'Jugadores');
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    // …y el dorsal/la etiqueta siguen ahí (antes se borraba el dorsal al reaplicar).
    await expect(page.locator('.board-canvas svg'), 'el dorsal sobrevive').toContainText('Pivote');

    const els = await saveAndRead(page, 'Formacion con dorsal');
    const players = els.filter((e) => e.t === 'player');
    expect(players.filter((x) => x.n === 9).length, 'un jugador conserva el dorsal 9').toBe(1);
    expect(players.filter((x) => x.label === 'Pivote').length, 'conserva la etiqueta').toBe(1);
  });

  test('un jugador BLOQUEADO no se recoloca ni se borra al aplicar otra formación', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false });
    await openBoard(page);
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);

    // Se marca (etiqueta) y se bloquea el mediocentro ([0.5, 0.25]): la etiqueta sirve
    // para volver a encontrar EXACTAMENTE a ese jugador después.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.25, host, fit);
    await page.mouse.click(p.x, p.y);
    await page.locator('.inspector input[placeholder="Nombre / puesto"]').fill('Fijo');
    await page.locator('.inspector input[placeholder="Nombre / puesto"]').press('Tab');
    await page.locator('.inspector button[aria-label="Bloquear"]').click();
    await expect(page.locator('.locked-note'), 'el elemento queda bloqueado').toBeVisible();

    const antes = await playerPoints(page);
    expect(antes.length).toBe(11);
    const fijoAntes = await labelledPoint(page, 'Fijo');
    expect(fijoAntes, 'el jugador marcado existe').not.toBe('no-encontrado');

    // Otra formación del mismo color: se recolocan los NO bloqueados.
    await showCategory(page, 'Jugadores');
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    // La recolocación es un cambio de MODELO y su pintado llega en el fotograma siguiente: se
    // espera a que el SVG lo refleje antes de comparar, en vez de leer una sola vez tras el clic.
    // Medido (20 repeticiones del escenario, ~1 fallo): leer inmediatamente devolvía los vectores
    // de 4-3-3 y parecía que la formación no se aplicaba, cuando la app SÍ la aplicaba (traza del
    // componente: `formationId: '4-4-2'`, 11 specs, 1 bloqueado) y dos fotogramas después las
    // posiciones eran las correctas. El contador no servía de espera porque ya valía 11 antes del
    // clic. El lado equivocado era la PRUEBA, no el producto.
    await expect
      .poll(async () => (await playerPoints(page)).some((pt) => !antes.includes(pt)), {
        message: 'la segunda formación llega a pintarse',
        timeout: 5000,
      })
      .toBe(true);

    const despues = await playerPoints(page);
    expect(despues.length, 'el bloqueado ni se duplica ni se pierde').toBe(11);
    // El bloqueado se queda EXACTAMENTE donde estaba…
    const fijoDespues = await labelledPoint(page, 'Fijo');
    expect(fijoDespues, 'el bloqueado NO se recoloca').toBe(fijoAntes);
    // …y los demás sí se han movido (si no, la segunda formación no se habría aplicado).
    // (Ojo: 4-3-3 y 4-4-2 comparten los 5 primeros puestos, así que no basta con contar
    // posiciones repetidas: hay que mirar al jugador bloqueado en concreto.)
    expect(despues.some((pt) => !antes.includes(pt)), 'el resto se recoloca').toBe(true);
  });

  test('captura escritorio-formaciones.png: panel Jugadores + campo con formaciones', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page, { players: false });
    await openBoard(page);
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    await page.locator('.tray-quick .tray-quick-chip').nth(1).click();
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-4-2' }).click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(22);
    // Captura de PÁGINA completa (panel + campo + barra), no solo el locator del panel.
    await page.screenshot({ path: `${OUT}/escritorio-formaciones.png` });
  });
});
