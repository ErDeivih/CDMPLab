// A2/A3/A4 — CAMBIO DE CAMPO (contrato nuevo tras la corrección urgente del dueño).
//
// QUÉ CAMBIÓ Y POR QUÉ: antes, cambiar de un campo completo a uno de media extensión CON objetos
// abría el diálogo «Cambiar a medio campo» y NO cambiaba el campo hasta elegir una opción
// («Dos medios campos» / «Encajar todo» / «Mantener los objetos»). Ese estado pendiente bloqueaba la
// pizarra: es el defecto que reportó el dueño. Ahora el cambio es DIRECTO y, además, NO TRANSFORMA
// COORDENADAS: los elementos conservan su posición normalizada al cambiar de campo.
//
// Esta prueba se actualiza porque el REQUISITO cambió (no porque la app fallara). Se conserva la
// cobertura de: (a) el cambio de campo respeta el modelo, (b) undo/redo conjunto campo+elementos,
// (c) F7 sin transformación y (d) los CAMPOS HISTÓRICOS `two_halves` y `box`, que ya no se ofrecen
// pero se siguen abriendo, dibujando y conservando sus objetos.
import { test, expect, Page } from '@playwright/test';
import {
  seedBoard,
  openBoard,
  abrirHerramientas,
  hostBox,
  fitMode,
  normToScreen,
} from './board-helpers';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase5-conversion';
fs.mkdirSync(SHOTS, { recursive: true });

async function openProps(page: Page): Promise<void> {
  if (
    !(await page
      .locator('.studio-panel')
      .isVisible()
      .catch(() => false))
  ) {
    await page.locator('button[aria-label="Propiedades"]').click();
  }
  await expect(page.locator('.studio-panel')).toBeVisible();
}

/** Campo real de la señal, expuesto en `data-field` del host. */
async function fieldValue(page: Page): Promise<string> {
  return page.locator('.board-host').getAttribute('data-field') ?? '';
}

async function setField(page: Page, field: string): Promise<void> {
  const sel = page.locator('.studio-panel select[aria-label="Campo base"]');
  if (!(await sel.isVisible().catch(() => false))) await openProps(page);
  await sel.selectOption(field);
}

/** Coloca un jugador genérico en el norm dado y desarma la colocación continua. */
async function placePlayer(page: Page, nx: number, ny: number): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador NO cierra el panel Jugadores.
  await expect(
    page.locator('.side-panel-left'),
    'el panel Jugadores permanece abierto',
  ).toBeVisible();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.field-count')).toHaveText('1');
  await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
}

/** Posición NORMALIZADA real del jugador, medida del DOM: centro del objeto sobre el rectángulo del
 *  campo dibujado. No depende de la escala del campo, así que un cambio de campo NO la puede
 *  disfrazar. */
async function normDelJugador(page: Page): Promise<{ nx: number; ny: number }> {
  return page.evaluate(() => {
    const campo = document
      .querySelector('.board-canvas .entrenolab-grass')!
      .getBoundingClientRect();
    const el = document
      .querySelector('.board-canvas [data-el-type="player"]')!
      .getBoundingClientRect();
    return {
      nx: (el.x + el.width / 2 - campo.x) / campo.width,
      ny: (el.y + el.height / 2 - campo.y) / campo.height,
    };
  });
}

test.describe('A2/A3/A4 — cambio de campo directo', () => {
  test('A2: cambiar de campo NO mueve los objetos: la posición normalizada se conserva', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await openProps(page);
    await page
      .locator('.studio-panel .field', { hasText: 'Orientación' })
      .locator('.chip[data-orient="horizontal"]')
      .click();
    await placePlayer(page, 0.6, 0.4);
    const antes = await normDelJugador(page);
    expect(antes.nx, 'colocado donde se pidió (x)').toBeGreaterThan(0.55);
    expect(antes.nx).toBeLessThan(0.65);
    expect(antes.ny, 'colocado donde se pidió (y)').toBeGreaterThan(0.35);
    expect(antes.ny).toBeLessThan(0.45);

    // Recorrido de campos: ninguno puede mover ni perder el objeto, y ninguno abre diálogo.
    for (const campo of ['half', 'third', 'futsal', 'f7', 'blank', 'half', 'full']) {
      await setField(page, campo);
      await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe(campo);
      await expect(page.locator('.field-change-dialog'), `sin diálogo en ${campo}`).toHaveCount(0);
      await expect(page.locator('.field-count'), `el objeto sigue ahí en ${campo}`).toHaveText('1');
      if (campo === 'blank') continue; // el lienzo no dibuja rectángulo de campo
      // OJO (medido): cambiar a un campo de media extensión desde escritorio FUERZA la orientación
      // vertical (portería arriba) y eso ROTA la vista. Para comparar la posición normalizada se
      // vuelve a poner horizontal: la orientación no transforma coordenadas, es cómo se mira el
      // mismo modelo.
      const chipH = page
        .locator('.studio-panel .field', { hasText: 'Orientación' })
        .locator('.chip[data-orient="horizontal"]');
      if (!((await chipH.getAttribute('class')) ?? '').includes('chip-active')) {
        await chipH.click();
        await expect(chipH).toHaveClass(/chip-active/);
      }
      const ahora = await normDelJugador(page);
      expect(
        Math.abs(ahora.nx - antes.nx),
        `x normalizada conservada en ${campo} (${ahora.nx.toFixed(3)} vs ${antes.nx.toFixed(3)})`,
      ).toBeLessThan(0.02);
      expect(
        Math.abs(ahora.ny - antes.ny),
        `y normalizada conservada en ${campo} (${ahora.ny.toFixed(3)} vs ${antes.ny.toFixed(3)})`,
      ).toBeLessThan(0.02);
    }
    await page.screenshot({ path: `${SHOTS}/campo-directo.png` });
  });

  test('A3: Undo/Redo de un cambio de campo restaura conjuntamente campo y elementos', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await openProps(page);
    await page
      .locator('.studio-panel .field', { hasText: 'Orientación' })
      .locator('.chip[data-orient="horizontal"]')
      .click();
    await placePlayer(page, 0.5, 0.5);
    await setField(page, 'half');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('half');
    // Undo → vuelve al campo anterior, con el objeto intacto.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('full');
    await expect(page.locator('.field-count')).toHaveText('1');
    // Redo → medio campo de nuevo.
    await page.keyboard.press('Control+y');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('half');
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('A4: F7 participa en los cambios (half → F7 NO transforma coordenadas)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await openProps(page);
    await page
      .locator('.studio-panel .field', { hasText: 'Orientación' })
      .locator('.chip[data-orient="horizontal"]')
      .click();
    // Pasar a medio campo con el campo VACÍO y colocar el jugador ahí.
    await setField(page, 'half');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('half');
    await placePlayer(page, 0.5, 0.5);
    const antes = await normDelJugador(page);
    // half → f7 (ambos media extensión): las coordenadas se conservan.
    await setField(page, 'f7');
    await expect.poll(async () => fieldValue(page), { timeout: 4000 }).toBe('f7');
    await expect(page.locator('.field-count')).toHaveText('1');
    const ahora = await normDelJugador(page);
    expect(Math.abs(ahora.nx - antes.nx), 'x conservada en F7').toBeLessThan(0.02);
    expect(Math.abs(ahora.ny - antes.ny), 'y conservada en F7').toBeLessThan(0.02);
  });

  for (const legado of [
    { campo: 'two_halves', porterias: 2 },
    { campo: 'box', porterias: 1 },
  ]) {
    test(`A2-histórico: un documento «${legado.campo}» se abre, se dibuja y conserva a su jugador`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1366, height: 768 });
      const doc = {
        id: `legacy-${legado.campo}`,
        teamId: 't1',
        folderId: null,
        title: `Antiguo ${legado.campo}`,
        description: '',
        explanation: '',
        category: 'Técnica',
        objectives: [],
        materials: [],
        durationMinutes: 15,
        minPlayers: null,
        maxPlayers: null,
        loadMode: 'fixed',
        seriesCount: null,
        repetitionsCount: null,
        workSeconds: null,
        restSeconds: null,
        isTemplate: false,
        canvas: {
          version: 2,
          schemaVersion: 4,
          field: legado.campo,
          orientation: 'horizontal',
          frames: [
            {
              duration: 1000,
              elements: [
                { id: 'e1', t: 'player', x: 0.6, y: 0.4, n: 9, c: '#1a73e8' },
                { id: 'e2', t: 'cone', x: 0.3, y: 0.7, c: '#f9ab00' },
              ],
            },
          ],
          grass: 'stripes',
        },
        thumbnail: null,
        savedAt: '2026-01-01T10:00:00.000Z',
      };
      await page.addInitScript((documento: unknown) => {
        localStorage.clear();
        const now = new Date().toISOString();
        localStorage.setItem('entrenolab:seeded', '1');
        localStorage.setItem('entrenolab:board-hints', '1');
        localStorage.setItem('entrenolab:fill-hint', '1');
        localStorage.setItem(
          'entrenolab:teams',
          JSON.stringify([
            { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now },
          ]),
        );
        localStorage.setItem('entrenolab:players', JSON.stringify([]));
        localStorage.setItem('entrenolab:folders', JSON.stringify([]));
        localStorage.setItem('entrenolab:exercises', JSON.stringify([documento]));
        localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
      }, doc);
      await page.goto('/library');
      await page.locator('.ex-card').first().hover();
      await page.locator('[title="Diseñar en pizarra"]').first().click();
      await page.waitForURL('**/board');
      await expect(page.locator('.board-canvas svg')).toBeVisible();

      // Se abre con SU campo, dibuja su geometría y conserva los dos objetos.
      await expect(page.locator('.board-host')).toHaveAttribute('data-field', legado.campo);
      await expect(page.locator('.field-count')).toHaveText('2');
      const svg = await page.locator('.board-canvas svg').first().innerHTML();
      expect(
        (svg.match(/rgba\(255,255,255,0\.25\)/g) ?? []).length,
        `porterías dibujadas en ${legado.campo}`,
      ).toBeGreaterThanOrEqual(legado.porterias);
      const pos = await normDelJugador(page);
      expect(Math.abs(pos.nx - 0.6), 'el jugador conserva su x normalizada').toBeLessThan(0.02);
      expect(Math.abs(pos.ny - 0.4), 'el jugador conserva su y normalizada').toBeLessThan(0.02);
      await page.screenshot({ path: `${SHOTS}/${legado.campo}.png` });
    });
  }
});
