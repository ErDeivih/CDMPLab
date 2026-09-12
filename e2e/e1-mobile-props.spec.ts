import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { longPress } from './gesture-helpers';

const SHOTS = 'e2e/shots/e1-mobile-props';
fs.mkdirSync(SHOTS, { recursive: true });

// Tamaños móviles que el dueño usa para probar: 360×800, 390×844, 430×932.
const MOBILE: Array<[number, number]> = [
  [360, 800],
  [390, 844],
  [430, 932],
];

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

type Box = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Fit = 'height' | 'contain';

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en HORIZONTAL. */
function normToScreen(
  nx: number,
  ny: number,
  host: Box,
  fit: Fit,
  panX = 0,
  panY = 0,
  zoom = 1,
): Pt {
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

/**
 * Regresión móvil: el panel de Propiedades NO debe abrirse automáticamente al
 * colocar/seleccionar un objeto (ni durante el movimiento/rotación), porque lo tapa
 * y bloquea la manija de rotación. Solo se abre cuando el usuario pulsa el botón
 * "Propiedades"; al cerrarlo con un toque la selección y las manijas se conservan.
 */

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
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
      ]),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem(
      'entrenolab:exercises',
      JSON.stringify([
        {
          id: 'e1',
          teamId: 't1',
          folderId: null,
          title: 'Rondos',
          description: '',
          explanation: '',
          category: 'Técnica',
          objectives: [],
          materials: [],
          durationMinutes: 12,
          minPlayers: 6,
          maxPlayers: 8,
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
            frames: [{ duration: 1000, elements: [] }],
            orientation: 'horizontal',
            grass: 'stripes',
            lineColor: '#ffffff',
            backgroundColor: '#31834a',
          },
          thumbnail: null,
          savedAt: now,
        },
      ]),
    );
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    // Evitar los hints flotantes (ayuda general y pista de "Llenar pantalla"), que se
    // superpondrían al campo en las capturas. Son overlays de pointer-events:none.
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

/** Abre la pizarra con la ayuda y la pista descartadas (campo limpio). */
async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  // FASE G: observable — el campo se ha renderizado (SVG presente), no una espera fija.
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  if (
    await page
      .locator('.help-close')
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator('.help-close').click();
  }
  if (
    await page
      .locator('.fill-hint-close')
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator('.fill-hint-close').click();
  }
  await expect(page.locator('.board-host')).toBeVisible();
}

async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'la caja real de .board-host').not.toBeNull();
  return b!;
}

/** Modo de encaje actual: 'height' si el host lleva la clase board-fill (Llenar pantalla). */
async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

/** Centro en PANTALLA (coordenadas de página) del bounding box de un selector del SVG. */
async function objectScreen(page: Page, selector: string): Promise<Pt> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 5000 });
  const medida = () =>
    loc.evaluate((el) => {
      const r = (el as SVGGraphicsElement).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  // La caja tiene que ser REAL antes de usarla. MEDIDO en el trace de CI: este helper devolvió
  // (0, 0) —una caja 0×0, o centrada en el origen— y el toque siguiente se hizo en la esquina
  // superior izquierda de la pantalla (`touchscreenTap {x: 0, y: 0}`), así que el objeto NO se
  // seleccionaba y el test fallaba de forma intermitente en runners lentos con un mensaje que no
  // decía nada («selección presente»). Ahora se espera a una caja con tamaño y, si no llega, el
  // fallo dice exactamente esto.
  let caja = { x: 0, y: 0, width: 0, height: 0 };
  await expect
    .poll(
      async () => {
        caja = await medida();
        return caja.width > 0 && caja.height > 0;
      },
      { message: `la caja de ${selector} debe tener tamaño (no 0×0) antes de tocarla` },
    )
    .toBe(true);
  return { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
}

/** Norm (0..1) de un material <image> (el centro se codifica en x/y + width/height). */
async function imageNorm(page: Page, selector: string): Promise<Pt> {
  const v = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const w = parseFloat(el.getAttribute('width') ?? '0');
      const h = parseFloat(el.getAttribute('height') ?? '0');
      const x = parseFloat(el.getAttribute('x') ?? '0');
      const y = parseFloat(el.getAttribute('y') ?? '0');
      return { x: x + w / 2, y: y + h / 2 };
    });
  return { x: (v.x - RECT.x) / RECT.w, y: (v.y - RECT.y) / RECT.h };
}

/** Norm (0..1) de un elemento leído del `translate` de su <g> más cercano. */
async function objectNorm(page: Page, selector: string): Promise<Pt> {
  const v = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const g = el.closest('g');
      const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(
        g?.getAttribute('transform') ?? '',
      );
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });
  expect(v, `el objeto (${selector}) debe estar renderizado con translate`).not.toBeNull();
  return { x: (v!.x - RECT.x) / RECT.w, y: (v!.y - RECT.y) / RECT.h };
}

/** Rotación (grados) del envoltorio externo `rotate(r …)` del elemento, subiendo por el DOM. */
async function elementRot(page: Page, selector: string): Promise<number> {
  const v = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      let g = el.closest('g') as Element | null;
      while (g) {
        const m = /rotate\((-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
        if (m) return { r: parseFloat(m[1]) };
        g = g.parentElement;
      }
      return { r: 0 };
    });
  return v.r;
}

/** Rotación del PRIMER grupo del SVG envuelto en rotate(...). Robusto porque en
 *  horizontal el campo no se envuelve en rotate, así que el primer grupo rotado es el
 *  elemento dibujado (y su ángulo coincide con `rot`). */
async function firstRot(page: Page): Promise<number> {
  return page.locator('.board-canvas svg').evaluate((svg) => {
    const g = svg.querySelector('g[transform*="rotate("]');
    if (!g) return 0;
    const m = /rotate\((-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
    return m ? parseFloat(m[1]) : 0;
  });
}

/** Nº de elementos del campo. */
async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Arma la colocación de un Cono (material). */
async function armCone(page: Page): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  await expect(page.locator('.placement-hint')).toBeVisible();
  // FASE B (paneles persistentes): el panel Material sigue abierto y en móvil tapa el punto de
  // colocación del cono (izquierda). Se cierra por su botón X (.panel-close), que no desarma la
  // colocación, para poder tocar el campo después.
  await page.locator('.side-panel-left.tools-panel-side .panel-close').click();
  await expect(page.locator('.side-panel-left.tools-panel-side')).toHaveCount(0);
}

/** Arma la colocación de un Portero (jugador genérico). */
async function armComodin(page: Page): Promise<void> {
  await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
  await page.locator('.tray-player[title="Jugador Azul"]').click();
  // FASE B (paneles persistentes): elegir un jugador NO cierra el panel Jugadores.
  await expect(
    page.locator('.side-panel-left'),
    'el panel Jugadores permanece abierto',
  ).toBeVisible();
  // FASE B (regla C): el panel Jugadores, que ya no se autocienda, taparía después los toques
  // sobre el cono (colocado a la izquierda). Se cierra por su botón X (.panel-close), que no
  // desarma la colocación.
  await page.locator('.side-panel-left .panel-close').click();
  await expect(page.locator('.side-panel-left')).toHaveCount(0);
}

/**
 * Arrastra (arrastre de UN dedo, táctil) desde (x,y) por (dx,dy).
 *
 * El gesto se despacha ATÓMICO: `pointerdown`, los `pointermove` y `pointerup` en la MISMA tarea
 * del navegador. Antes eran tres `page.evaluate` seguidos —tres viajes por CDP— y en un runner
 * cargado entre el `down` y el primer `move` podían pasar más de los 550 ms de la pulsación larga:
 * el gesto que este test cree "un arrastre rápido" llegaba a la app como "pulsación larga y luego
 * arrastre", que es OTRA entrada (el menú se abre y el dedo ya no mueve nada).
 *
 * MEDIDO con una sonda en este mismo flujo (móvil 390×844, jugador colocado y seleccionado):
 *   down → 700 ms → move+up  ⟹ objeto QUIETO (Δx = 0) y el menú contextual ABIERTO.
 *   down+move+up en la MISMA tarea ⟹ el objeto se mueve (Δx = -0,036, lo esperado).
 * Culpable: el TEST, no la app. La app responde como debe a una pulsación larga táctil (abre el
 * menú y no arrastra); lo que no puede es que el significado del gesto dependa de la velocidad del
 * runner. FASE G: el movimiento se verifica en el llamador con `expect.poll(objectNorm/imageNorm)`.
 */
async function drag(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  id = 7,
): Promise<void> {
  await page.evaluate(
    ({ x, y, dx, dy, id }) => {
      const host = document.querySelector('.board-host') as HTMLElement | null;
      if (!host) return;
      const ev = (type: string, cx: number, cy: number, buttons: number) =>
        host.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'touch',
            isPrimary: true,
            clientX: cx,
            clientY: cy,
            button: 0,
            buttons,
          }),
        );
      ev('pointerdown', x, y, 1);
      for (const f of [0.5, 1]) ev('pointermove', x + dx * f, y + dy * f, 1);
      ev('pointerup', x + dx, y + dy, 0);
    },
    { x, y, dx, dy, id },
  );
}

// Selectores reutilizados.
const CONE = '.board-canvas svg image[href*="cone"]';
const PLAYER = '.entrenolab-board circle[r="2.5"]';
const SEL = '.board-canvas svg [stroke="#2563eb"]';

test.describe('E1 — el panel Propiedades NO bloquea el movimiento en móvil (≤700px)', () => {
  test.use({ hasTouch: true });

  for (const [W, H] of MOBILE) {
    test(`a ${W}×${H}: colocar/seleccionar/mover/rotar NO abre Propiedades; solo el botón la abre y la X mantiene la selección`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: W, height: H });
      await seed(page);
      await openClosed(page);
      const fit = await fitMode(page);
      expect(fit, `[${W}x${H}] por defecto en móvil es "Llenar pantalla"`).toBe('height');

      // El panel comienza cerrado.
      await expect(page.locator('.studio-panel')).toHaveCount(0);

      // ---- 1. Colocar un cono: selección + manijas visibles, panel CERRADO ----
      await armCone(page);
      let host = await hostBox(page); // re-capturar: el host se mueve al abrir paneles
      let s = normToScreen(0.35, 0.6, host, fit);
      await page.touchscreen.tap(s.x, s.y);
      await expect(page.locator('.field-count')).toHaveText('1');
      await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click(); // Fase 3: desarmar para interactuar
      // El cono se coloca con su CENTRO en el punto de colocación `s` (el material se
      // centra en el norm del toque), así que `s` es la posición exacta del cono en
      // pantalla. Selecto con `s` en vez de `objectScreen` (getBoundingClientRect),
      // que en "Llenar pantalla" y viewports pequeños desvía el centro al borde.
      const coneScreen = s; // centro exacto del cono (pantalla)
      await page.touchscreen.tap(coneScreen.x, coneScreen.y); // seleccionar el cono
      await expect(page.locator('.studio-panel')).toHaveCount(0); // NO auto-abre
      await expect(page.locator(SEL)).not.toHaveCount(0); // manijas/selección visibles
      // Fase 6: la rotación ya no es una manija continua sino la BARRA/MENÚ contextual (±90°).
      await expect(page.locator('.rot-handle')).toHaveCount(0); // sin manija de rotación
      // Fase 3: el menú contextual se abre con pulsación larga.
      await longPress(page, coneScreen.x, coneScreen.y);
      await expect(page.locator('.context-bar')).toBeVisible(); // menú contextual (±90°)
      if (W === 390 && H === 844) {
        await page.screenshot({
          path: `${SHOTS}/movil-objeto-seleccionado-panel-cerrado.png`,
          fullPage: false,
        });
      }

      // ---- 1b. Colocar un Portero (jugador) para poder seleccionarlo después ----
      await armComodin(page);
      host = await hostBox(page);
      s = normToScreen(0.65, 0.35, host, fit);
      await page.touchscreen.tap(s.x, s.y);
      await expect(page.locator('.field-count')).toHaveText('2');
      await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click(); // Fase 3: desarmar
      await expect(page.locator('.studio-panel')).toHaveCount(0); // sigue cerrado
      const playerScreen = await objectScreen(page, PLAYER); // posición real del jugador (pantalla)

      // ---- 2. Seleccionar un jugador existente → panel CERRADO ----
      // (tras colocar, la herramienta ya es "Seleccionar"; un toque sobre el jugador lo selecciona)
      await page.touchscreen.tap(playerScreen.x, playerScreen.y);
      await expect(page.locator('.studio-panel')).toHaveCount(0); // NO auto-abre
      await expect(page.locator(SEL)).not.toHaveCount(0); // selección presente

      // ---- 3. Arrastrar (táctil) un material y un jugador → cambia la posición, panel CERRADO ----
      // Jugador primero y material después (así el material queda seleccionado para rotar).
      const playerBefore = await objectNorm(page, PLAYER);
      await drag(page, playerScreen.x, playerScreen.y, -38, -26);
      await expect(page.locator('.studio-panel')).toHaveCount(0); // mover NO abre
      // FASE G: observable — el jugador se movió (x disminuyó).
      await expect
        .poll(async () => (await objectNorm(page, PLAYER)).x - playerBefore.x, { timeout: 4000 })
        .toBeLessThan(-0.01);

      const coneBefore = await imageNorm(page, CONE);
      await drag(page, coneScreen.x, coneScreen.y, 42, 22);
      await expect(page.locator('.studio-panel')).toHaveCount(0); // mover NO abre
      // FASE G: observable — el material se movió (x aumentó).
      await expect
        .poll(async () => (await imageNorm(page, CONE)).x - coneBefore.x, { timeout: 4000 })
        .toBeGreaterThan(0.01);
      if (W === 390 && H === 844) {
        await page.screenshot({
          path: `${SHOTS}/movil-durante-movimiento-panel-cerrado.png`,
          fullPage: false,
        });
      }

      // ---- 4. Rotar con el MENÚ CONTEXTUAL (panel CERRADO) → cambia `rot` a ±90° ----
      // Tras arrastrar el material por último, el cono es el elemento seleccionado: el menú
      // se abre con pulsación larga (Fase 3) y el panel sigue cerrado.
      const coneNow = await objectScreen(page, CONE);
      await longPress(page, coneNow.x, coneNow.y);
      await expect(page.locator('.studio-panel')).toHaveCount(0);
      await expect(page.locator('.context-bar')).toBeVisible();
      const rotBefore = await firstRot(page);
      const expected = ((((rotBefore % 360) + 360) % 360) + 90) % 360;
      await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
      // FASE G: observable — la rotación se espera con expect.poll (no un wait fijo).
      await expect.poll(() => firstRot(page), { timeout: 5000 }).toBeCloseTo(expected, 0);
      await expect(page.locator('.studio-panel')).toHaveCount(0); // rotar NO abre
      const rotAfter = await firstRot(page);
      expect(rotAfter, '[rotate] la rotación gira a +90° desde la barra de contexto').toBeCloseTo(
        expected,
        0,
      );
      if (W === 390 && H === 844) {
        await page.screenshot({
          path: `${SHOTS}/movil-manija-rotacion-visible.png`,
          fullPage: false,
        });
      }

      // ---- 5. Pulsar el botón "Propiedades" → se abre el inspector correcto ----
      await page.locator('button[aria-label="Propiedades"]').click();
      await expect(page.locator('.studio-panel')).toBeVisible();
      // Fase 6: el inspector ya NO ofrece el control numérico "Rotación (°)".
      expect(
        await page.locator('.studio-panel .inspector .field', { hasText: 'Rotación' }).count(),
        '[inspector] sin control Rotación (°)',
      ).toBe(0);
      if (W === 390 && H === 844) {
        await page.screenshot({
          path: `${SHOTS}/movil-propiedades-explicitas.png`,
          fullPage: false,
        });
      }

      // ---- 6. Cerrar con UN toque → panel CERRADO y selección conservada ----
      await page.locator('.studio-panel .panel-close').click();
      await expect(page.locator('.studio-panel')).toHaveCount(0); // cerrado en un toque
      await expect(page.locator(SEL)).not.toHaveCount(0); // la selección sigue viva
      await expect(page.locator('.field-count')).toHaveText('2'); // los objetos siguen

      // ---- 7. Un Undo por movimiento/rotación, sin entradas fantasma ----
      // La última operación fue cerrar el panel (no es histórico). La anterior en el
      // historial es la ROTACIÓN: un único Undo la revierte, pero NO borra el cono.
      await page.keyboard.press('Control+z');
      await expect(
        page.locator('.field-count'),
        '[undo] un solo Undo no borra elementos',
      ).toHaveText('2');
      // El render tras deshacer es asíncrono: esperar a que la rotación vuelva a la previa.
      await expect.poll(async () => firstRot(page), { timeout: 4000 }).toBeCloseTo(rotBefore, 0);
    });
  }
});
