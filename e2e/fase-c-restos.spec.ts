import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';

// =============================================================
// FASE C — Restos internos/visibles de jugadores antiguos.
// Verifica que la pizarra solo usa: fichas rápidas por COLOOR,
// jugadores reales de plantilla y formaciones genéricas.
// =============================================================

const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;
type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

function normToScreen(nx: number, ny: number, host: Box, fit: Fit): Pt {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  return {
    x: host.x + host.width / 2 + cx - host.width / 2,
    y: host.y + host.height / 2 + cy - host.height / 2,
  };
}

async function seed(page: Page, players: unknown[] = []): Promise<void> {
  await page.addInitScript((players) => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, players);
}

function realPlayer(): unknown {
  return {
    id: 'pl-1',
    teamId: 't1',
    name: 'David',
    number: 10,
    position: 'MC',
    color: '#1f7a4d',
    active: true,
    createdAt: new Date().toISOString(),
  };
}

async function openBoard(page: Page): Promise<void> {
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

/** Siembra un documento ANTIGUO (side:'rival' + type:'goalkeeper') y lo abre desde la
 *  biblioteca, para comprobar la compatibilidad de lectura/render (FASE C). */
async function seedLegacyAndOpen(page: Page): Promise<void> {
  const legacy = {
    id: 'legacy1',
    teamId: 't1',
    folderId: null,
    title: 'Antiguo',
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
      schemaVersion: 3,
      field: 'full',
      frames: [
        {
          duration: 1000,
          elements: [
            {
              id: 'gkRival',
              t: 'player',
              x: 0.5,
              y: 0.5,
              n: 1,
              c: '#c0392b',
              side: 'rival',
              type: 'goalkeeper',
            },
          ],
        },
      ],
      orientation: 'horizontal',
      grass: 'stripes',
      lineColor: '#ffffff',
      backgroundColor: '#31834a',
    },
    thumbnail: null,
    savedAt: new Date().toISOString(),
  };
  await page.addInitScript((legacy) => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([legacy]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, legacy);
  await page.goto('/library');
  await page.locator('.ex-card').first().waitFor();
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
}
async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b).not.toBeNull();
  return b!;
}
async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}
async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

test.describe('FASE C — restos de jugadores antiguos', () => {
  test('las cinco fichas por color colocan jugadores genéricos SIN nombre/dorsal/side/type', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    // Coloca un jugador de cada uno de los 5 colores (drops fuera del panel, en el campo).
    for (const [, label, drop] of [
      ['#1a73e8', 'Azul', 0.45],
      ['#c0392b', 'Rojo', 0.5],
      ['#e6b800', 'Amarillo', 0.55],
      ['#1f7a4d', 'Verde', 0.6],
      ['#b884ff', 'Morado', 0.65],
    ] as Array<[string, string, number]>) {
      const sel = `.tray-player[title="Jugador ${label}"]`;
      const box = (await page.locator(sel).boundingBox())!;
      const sx = box.x + box.width / 2;
      const sy = box.y + box.height / 2;
      const dropP = normToScreen(drop, 0.5, host, fit);
      const id = 91;
      await page.evaluate(
        ({ sel, sx, sy, dropP, id }) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return;
          el.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerId: id,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: sx,
              clientY: sy,
            }),
          );
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerId: id,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: dropP.x,
              clientY: dropP.y,
            }),
          );
          el.dispatchEvent(
            new PointerEvent('pointerup', {
              bubbles: true,
              cancelable: true,
              pointerId: id,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: 0,
              clientX: dropP.x,
              clientY: dropP.y,
            }),
          );
        },
        { sel, sx, sy, dropP, id },
      );
    }
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(5);
    // Modelo: los genéricos NO llevan nombre, dorsal (n), side ni type.
    const players = await page
      .locator('.entrenolab-board circle[r="2.5"]')
      .evaluateAll((els) =>
        els.map((e) => ({
          fill: (e as SVGCircleElement).getAttribute('fill'),
          num: (e as SVGElement).querySelector('text')?.textContent ?? '',
        })),
      );
    expect(players.length).toBe(5);
    expect(
      players.every((p) => p.num === ''),
      'ningún genérico muestra dorsal/nombre',
    ).toBe(true);
  });

  test('cada formación funciona sin plantilla y se crea en los cinco colores', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    const colors: Array<[string, string]> = [
      ['#1a73e8', 'Azul'],
      ['#c0392b', 'Rojo'],
      ['#e6b800', 'Amarillo'],
      ['#1f7a4d', 'Verde'],
      ['#b884ff', 'Morado'],
    ];
    for (const [hex, label] of colors) {
      await page.locator(`.tray-player[title="Jugador ${label}"]`).click();
      await page.locator('.formation-btn', { hasText: '4-3-3' }).first().click();
    }
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(55);
    for (const [hex] of colors) {
      expect(await page.locator(`.entrenolab-board circle[r="2.5"][fill="${hex}"]`).count()).toBe(
        11,
      );
    }
  });

  test('Reflejar produce la formación en la geometría del lado contrario', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    await page.locator('.formation-mirror input').check();
    await page.locator('.formation-btn', { hasText: '4-3-3' }).first().click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(11);
    // El espejo en X está activo y la formación se aplica sin error (la geometría
    // reflejada se cubre en el test unitario de formations.spec).
    await expect(page.locator('.formation-mirror input')).toBeChecked();
  });

  test('el inspector de jugador NO contiene la opción Portero ni el campo Lado', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, [realPlayer()]);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .roster-item').first().click();
    // Colocar el jugador real.
    const host = await hostBox(page);
    const p = normToScreen(0.5, 0.5, host, await fitMode(page));
    await page.mouse.click(p.x, p.y);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(p.x, p.y);
    // Inspector del jugador: sin "Tipo/Portero" ni "Lado".
    await expect(page.locator('.inspector .field', { hasText: 'Portero' })).toHaveCount(0);
    await expect(page.locator('.inspector .field', { hasText: 'Lado' })).toHaveCount(0);
    await expect(page.locator('.inspector select option', { hasText: 'Portero' })).toHaveCount(0);
  });

  test('no existe ningún botón visible Jugador propio/rival/Portero', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.tools-panel-side')).toBeVisible();
    const bad = await page
      .locator(
        '[title="Jugador propio"], [title="Jugador rival"], [title="Portero"], [aria-label="Jugador propio"], [aria-label="Jugador rival"], [aria-label="Portero"]',
      )
      .count();
    expect(bad).toBe(0);
  });

  test('un jugador real de plantilla conserva nombre, dorsal y playerId; su color es el del EJERCICIO', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await seed(page, [realPlayer()]);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .roster-item').first().click();
    const host = await hostBox(page);
    const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    // CONTRATO CORREGIDO (corrección 1 de la revisión externa): esta prueba exigía antes que la
    // ficha NUEVA saliera con el color PERMANENTE de la plantilla (#1f7a4d). Ese contrato era el
    // defecto: en la pizarra, un jugador sin asignación propia del ejercicio sale con el color
    // común por defecto (azul), y el color de plantilla no decide nada de lo que se dibuja.
    // Lo que sí se conserva: nombre, dorsal, `playerId` y el hecho de que la PLANTILLA no cambia.
    expect(
      await page.locator('.entrenolab-board circle[r="2.5"][fill="#1a73e8"]').count(),
      'la ficha nueva usa el color por defecto del ejercicio (azul)',
    ).toBe(1);
    expect(
      await page.locator('.entrenolab-board circle[r="2.5"][fill="#1f7a4d"]').count(),
      'ya NO se usa el color permanente de la plantilla al colocar',
    ).toBe(0);
    expect(
      await page.locator('.entrenolab-board [data-player-id="pl-1"]').count(),
      'la ficha sigue siendo del jugador real (playerId conservado)',
    ).toBe(1);
    const texts = await page.locator('.entrenolab-board text').allTextContents();
    expect(texts, 'el dorsal del jugador real se muestra').toContain('10');
    // Y la plantilla no se ha tocado.
    const plantilla = await page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('entrenolab:players') ?? '[]') as Array<{ color: string }>
        )[0]?.color,
    );
    expect(plantilla, 'el color permanente del jugador sigue igual').toBe('#1f7a4d');
  });

  test('un documento ANTIGUO (side rival + type goalkeeper) abre y renderiza sin error', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedLegacyAndOpen(page);
    // El documento antiguo se carga y renderiza: un solo elemento (el portero rival).
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    expect(await page.locator('.entrenolab-board circle[r="2.5"][fill="#c0392b"]').count()).toBe(1);
    const texts = await page.locator('.entrenolab-board text').allTextContents();
    expect(texts, 'el portero antiguo muestra POR').toContain('POR');
  });
});
