import { test, expect, Page } from '@playwright/test';
import { waitForTransitions } from './gesture-helpers';

/**
 * FASE 6 del encargo — PLANTILLA EN MÓVIL.
 *
 * 1. Pantalla compacta: menos cabecera y márgenes, filas de UNA línea y la información principal
 *    del jugador visible sin desplazarse. Medido antes del cambio (12 jugadores): a 360×800 la
 *    tabla empezaba en y=195 y solo se veían 3 filas, con filas de ~150 px porque el patrón global
 *    convierte las tablas en tarjetas apiladas.
 * 2. El menú «Más» de la Plantilla es un DRAWER que entra desde la IZQUIERDA (ya no una modal
 *    flotante ni una hoja inferior), con ancho razonable, apertura/cierre explícitos, Escape que
 *    cierra y devuelve el foco, y fondo inerte mientras está abierto.
 *
 * Se verifica en 360×800, 390×844 y 844×390 (los tres tamaños que pide el encargo).
 */

const VIEWPORTS = [
  ['360×800', { width: 360, height: 800 }],
  ['390×844', { width: 390, height: 844 }],
  ['844×390 (horizontal)', { width: 844, height: 390 }],
] as const;

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
      JSON.stringify(
        Array.from({ length: 12 }, (_, i) => ({
          id: `p${i + 1}`,
          teamId: 't1',
          name: `Jugador ${i + 1}`,
          number: i + 1,
          position: ['GK', 'DF', 'MF', 'FW'][i % 4],
          color: '#1a73e8',
          active: true,
          createdAt: now,
        })),
      ),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

const metricas = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const filas = [...document.querySelectorAll('tbody tr')].map((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, alto: b.height };
    });
    const cabecera = document.querySelector('.page-head')?.getBoundingClientRect() ?? null;
    const tabla = document.querySelector('.data-table')?.getBoundingClientRect() ?? null;
    const nav = document.querySelector('.sidebar')?.getBoundingClientRect() ?? null;
    const limite = nav ? nav.top : window.innerHeight;
    return {
      altoVentana: window.innerHeight,
      cabeceraAlto: cabecera ? cabecera.height : null,
      primeraFila: filas[0]?.top ?? null,
      altoFila: filas[0]?.alto ?? null,
      filas: filas.length,
      filasVisibles: filas.filter((f) => f.bottom <= limite + 1).length,
      anchoTabla: tabla ? tabla.width : null,
      overflowX: doc.scrollWidth - doc.clientWidth,
      metaVisible: (() => {
        const m = document.querySelector('.cell-meta') as HTMLElement | null;
        return m ? getComputedStyle(m).display !== 'none' : false;
      })(),
      columnasPlegadas: (() => {
        const d = document.querySelector('.cell-dorsal') as HTMLElement | null;
        return d ? getComputedStyle(d).display === 'none' : false;
      })(),
    };
  });

test.describe('FASE 6 — Plantilla compacta y drawer «Más»', () => {
  test.use({ hasTouch: true });

  for (const [nombre, vp] of VIEWPORTS) {
    test(`${nombre}: la Plantilla es compacta y muestra la información sin desplazarse`, async ({
      page,
    }) => {
      await page.setViewportSize(vp);
      await seed(page);
      await page.goto('/team');
      await expect(page.locator('tbody tr').first()).toBeVisible();

      const m = await metricas(page);
      console.log(`[plantilla ${nombre}] ${JSON.stringify(m)}`);
      // Cabecera compacta.
      expect(m.cabeceraAlto, 'cabecera compacta').toBeLessThanOrEqual(70);
      // Filas de UNA línea: mucho menos que los ~150 px de las tarjetas apiladas.
      expect(m.altoFila, `alto de fila (${m.altoFila} px)`).toBeLessThanOrEqual(60);
      // Las dos columnas que se pliegan traen su información en la línea compacta del nombre.
      expect(m.columnasPlegadas, 'Dorsal/Posición plegadas en el nombre').toBe(true);
      expect(m.metaVisible, 'la línea compacta con dorsal y posición se muestra').toBe(true);
      // La tabla no desborda el ancho disponible.
      expect(m.overflowX, 'sin overflow horizontal').toBeLessThanOrEqual(1);
      expect(m.anchoTabla!).toBeLessThanOrEqual(vp.width);
      // Y se ve la mayor parte de la plantilla sin desplazarse.
      const minimo = vp.height < 500 ? 3 : 8;
      expect(
        m.filasVisibles,
        `jugadores visibles sin desplazar (${m.filasVisibles} de ${m.filas})`,
      ).toBeGreaterThanOrEqual(minimo);
    });
  }

  for (const [nombre, vp] of VIEWPORTS) {
    test(`${nombre}: el «Más» es un drawer por la izquierda con foco y Escape correctos`, async ({
      page,
    }) => {
      await page.setViewportSize(vp);
      await seed(page);
      await page.goto('/team');
      const disparador = page.locator('.nav-mas');
      await expect(disparador).toBeVisible();
      await disparador.click();

      const panel = page.locator('.cuenta-panel');
      await expect(panel).toBeVisible();
      // El drawer entra con una animación de 0,18 s: medir durante la animación daba x=-180 (el
      // panel aún entrando). Se espera a que terminen SUS animaciones antes de medir geometría.
      await waitForTransitions(page, '.cuenta-panel');
      const caja = (await panel.boundingBox())!;
      console.log(
        `[plantilla drawer ${nombre}] panel=${JSON.stringify(caja)} ventana=${JSON.stringify(vp)}`,
      );
      // Entra desde la IZQUIERDA y ocupa el alto disponible.
      expect(caja.x, 'pegado al borde izquierdo').toBeLessThanOrEqual(1);
      expect(caja.y, 'arranca arriba').toBeLessThanOrEqual(1);
      expect(caja.height, 'ocupa el alto').toBeGreaterThan(vp.height * 0.8);
      // Ancho razonable: nunca toda la pantalla.
      expect(caja.width, 'no ocupa toda la pantalla').toBeLessThan(vp.width * 0.92);
      expect(caja.width).toBeGreaterThan(200);
      // El fondo queda inerte (no se puede tabular a lo de detrás).
      expect(
        await page.locator('.shell').evaluate((el) => el.hasAttribute('inert')),
        'el fondo está inerte mientras el drawer está abierto',
      ).toBe(true);

      // Escape lo cierra y devuelve el foco al disparador.
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(disparador, 'el foco vuelve a «Más»').toBeFocused();
      expect(
        await page.locator('.shell').evaluate((el) => el.hasAttribute('inert')),
        'el fondo recupera la interacción',
      ).toBe(false);

      // Y se puede cerrar explícitamente con su aspa.
      await disparador.click();
      await expect(panel).toBeVisible();
      await panel.locator('button[aria-label="Cerrar el menú de cuenta"]').click();
      await expect(panel).toHaveCount(0);
      await expect(disparador).toBeFocused();
    });
  }
});
