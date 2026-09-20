import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';
import { abrirMasPizarra, toggleFillScreen } from './gesture-helpers';

const SHOTS = 'e2e/shots/fase2';
fs.mkdirSync(SHOTS, { recursive: true });

// Tamaños móviles que el dueño usa para probar: 360×800, 390×844, 430×932.
const MOBILE: Array<[number, number]> = [
  [360, 800],
  [390, 844],
  [430, 932],
];

type Box = { x: number; y: number; width: number; height: number };

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en horizontal.
 *  `fit` = 'height' (llenar pantalla) | 'contain' (campo completo). */
function normToScreen(
  nx: number,
  ny: number,
  host: Box,
  fit: 'height' | 'contain',
  panX = 0,
  panY = 0,
  zoom = 1,
): { x: number; y: number } {
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

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Sembrar UNA vez (no borrar en cada navegación): así la preferencia del modo
    // de pantalla persistida con localStorage sobrevive a un reload del test.
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
  });
}

/** Abre la pizarra con los paneles cerrados y la ayuda descartada. */
async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (
    await page
      .locator('.help-close')
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator('.help-close').click();
  }
}

/** Caja real del campo renderizado (el césped, dentro del SVG). */
async function fieldBox(page: Page): Promise<Box> {
  const b = await page.locator('.entrenolab-grass').boundingBox();
  expect(b, 'el campo renderizado (.entrenolab-grass) debe existir').not.toBeNull();
  return b!;
}

/** Caja del área usable real del host (entre la cabecera y el raíl inferior). */
async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** Medidas del campo frente al host: altura/anchura y banda negra (letterbox) vertical. */
async function metrics(
  page: Page,
): Promise<{
  fieldBox: Box;
  hostBox: Box;
  heightRatio: number;
  blackRatio: number;
  blackTop: number;
  blackBottom: number;
}> {
  const host = await hostBox(page);
  const field = await fieldBox(page);
  const heightRatio = field.height / host.height;
  const blackTop = field.y - host.y;
  const blackBottom = host.y + host.height - (field.y + field.height);
  const blackRatio = (host.height - field.height) / host.height;
  return { fieldBox: field, hostBox: host, heightRatio, blackRatio, blackTop, blackBottom };
}

/** Comprueba que el documento no tiene scroll horizontal (la página NO desborda). */
async function expectNoPageOverflow(page: Page): Promise<void> {
  const r = await page.evaluate(() => {
    const d = document.documentElement;
    const studio = document.querySelector('.studio') as HTMLElement | null;
    return {
      doc: { scroll: d.scrollWidth, client: d.clientWidth },
      studio: studio ? { scroll: studio.scrollWidth, client: studio.clientWidth } : null,
    };
  });
  expect(r.doc.scroll, `scroll horizontal de la página`).toBeLessThanOrEqual(r.doc.client + 1);
  if (r.studio)
    expect(r.studio.scroll, 'scroll horizontal de .studio').toBeLessThanOrEqual(
      r.studio.client + 1,
    );
}

/** Modo "Llenar pantalla" por defecto (móvil, sin preferencia guardada). */
function expectFillMode(page: Page): Promise<void> {
  return expect(page.locator('.board-host')).toHaveClass(/board-fill/);
}

test.describe('Fase 2 — el campo es el protagonista en móvil (modo "Llenar pantalla")', () => {
  test.use({ hasTouch: true });

  for (const [w, h] of MOBILE) {
    test(`[${w}x${h}] el campo LLENA la altura usable (ratio alto, banda negra mínima) por defecto`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      await expectNoPageOverflow(page);

      const m = await metrics(page);
      // Diagnóstico (para el informe): métricas reales del campo frente al host.
      console.log(
        `[fase2 ${w}x${h}] host=${m.hostBox.width.toFixed(0)}x${m.hostBox.height.toFixed(0)} campo=${m.fieldBox.width.toFixed(0)}x${m.fieldBox.height.toFixed(0)} ratioAltura=${m.heightRatio.toFixed(3)} bandaNegra=${(m.blackRatio * 100).toFixed(1)}%`,
      );
      // El campo ocupa ≥ 90% de la altura usable del host.
      expect(
        m.heightRatio,
        `altura del campo respecto al host en ${w}x${h}`,
      ).toBeGreaterThanOrEqual(0.9);
      // Banda negra (letterbox) arriba+abajo pequeña (≤ 8% de la altura del host).
      expect(m.blackRatio, `banda negra total en ${w}x${h}`).toBeLessThanOrEqual(0.08);
      // En "llenar pantalla" el campo sobrepasa el ancho del host (se puede panear).
      expect(
        m.fieldBox.width,
        `el campo debe extender más allá del ancho del host (pan)`,
      ).toBeGreaterThan(m.hostBox.width);
      // La vista no es un "cinturón central": la banda superior E inferior son mínimas
      // (cada una ≤ ~4% de la altura del host).
      expect(m.blackTop, `banda superior en ${w}x${h}`).toBeLessThan(m.hostBox.height * 0.04 + 2);
      expect(m.blackBottom, `banda inferior en ${w}x${h}`).toBeLessThan(
        m.hostBox.height * 0.04 + 2,
      );
    });

    test(`[${w}x${h}] "Llenar pantalla" reduce la banda negra vs "Campo completo"`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      const fill = await metrics(page);

      // Cambiar a "Campo completo" (toggle) y volver a medir.
      await toggleFillScreen(page);
      await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
      const fit = await metrics(page);
      console.log(
        `[fase2-comparativa ${w}x${h}] llenar: bandaNegra=${(fill.blackRatio * 100).toFixed(1)}% campo=${fill.fieldBox.height.toFixed(0)}px | completo: bandaNegra=${(fit.blackRatio * 100).toFixed(1)}% campo=${fit.fieldBox.height.toFixed(0)}px`,
      );

      // En llenar pantalla la banda negra es mucho menor que en campo completo.
      expect(fill.blackRatio, `banda negra en Llenar pantalla ${w}x${h}`).toBeLessThanOrEqual(0.08);
      expect(fit.blackRatio, `banda negra en Campo completo ${w}x${h}`).toBeGreaterThan(
        fill.blackRatio + 0.2,
      );
      // El campo es MÁS GRANDE en llenar pantalla que en campo completo.
      expect(
        fill.fieldBox.height,
        `altura del campo en Llenar pantalla vs Campo completo`,
      ).toBeGreaterThan(fit.fieldBox.height + 4);
      await expectNoPageOverflow(page);
    });
  }

  test('el toggle tiene un nombre accesible y alterna el estado persistido', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await expectFillMode(page);
    // CONTRATO ACTUALIZADO: el control conserva la misma clase y el mismo nombre accesible, pero
    // ahora vive en el menú «Más» de la pizarra (la franja de estado se retiró por decisión del
    // dueño). Se abre el menú para comprobarlo y el propio menú se cierra al pulsar la opción.
    await abrirMasPizarra(page);
    // En modo llenar pantalla el botón ofrece "Ver campo completo".
    await expect(page.locator('.top-pop-mas .field-fit-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.top-pop-mas .field-fit-toggle')).toHaveAttribute(
      'aria-label',
      'Ver campo completo',
    );
    // Cambiar a campo completo.
    await page.locator('.top-pop-mas .field-fit-toggle').click();
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
    // El menú se cierra solo al elegir la opción: no se queda ocupando el campo.
    await expect(page.locator('.top-pop-mas')).toHaveCount(0);
    await abrirMasPizarra(page);
    await expect(page.locator('.top-pop-mas .field-fit-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.locator('.top-pop-mas .field-fit-toggle')).toHaveAttribute(
      'aria-label',
      'Llenar pantalla',
    );
    // Persistido: al recargar sigue en campo completo (ya no vuelve al default móvil).
    await page.reload();
    await expect(page.locator('.board-host')).toBeVisible();
    await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
  });

  test('un toque táctil en un punto normalizado aterriza en ese punto del modelo (round-trip)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await expectFillMode(page);

    const host = await hostBox(page);
    const P = { x: 0.4, y: 0.6 };
    // Punto de pantalla correspondiente al norm P en el modo actual (llenar pantalla).
    const S = normToScreen(P.x, P.y, host, 'height');

    // Colocar un Portero (arma la colocación; en FASE B el panel queda abierto).
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    await expect(
      page.locator('.side-panel-left'),
      'el panel Jugadores permanece abierto',
    ).toBeVisible();
    // El punto P=(0.4,0.6) queda bajo el panel en móvil vertical; se cierra el panel
    // con su X (el cierre NO desarma la colocación) antes del toque táctil real.
    await page.locator('.side-panel-left .panel-close').first().click();
    // Toque táctil real.
    await page.touchscreen.tap(S.x, S.y);
    await expect(page.locator('.field-count')).toHaveText('1');

    // 1) El elemento RENDERIZADO debe estar donde se tocó (consistencia pantalla↔modelo).
    const circle = page.locator('.entrenolab-board circle[r="2.5"]').first();
    await expect(circle).toHaveCount(1);
    const cb = (await circle.boundingBox())!;
    expect(Math.abs(cb.x + cb.width / 2 - S.x), 'centro X del elemento ≈ toque').toBeLessThan(6);
    expect(Math.abs(cb.y + cb.height / 2 - S.y), 'centro Y del elemento ≈ toque').toBeLessThan(6);

    // 2) El norm almacenado en el modelo es el esperado (leído del translate del SVG).
    const pos = await circle.evaluate((el) => {
      const g = el.closest('g');
      const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(
        g?.getAttribute('transform') ?? '',
      );
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });
    expect(pos).not.toBeNull();
    const normX = (pos!.x - RECT.x) / RECT.w;
    const normY = (pos!.y - RECT.y) / RECT.h;
    expect(normX, 'norm x almacenado').toBeCloseTo(P.x, 2);
    expect(normY, 'norm y almacenado').toBeCloseTo(P.y, 2);
  });
});

test.describe('Fase 2 — capturas móviles (Llenar pantalla por defecto)', () => {
  test.use({ hasTouch: true });

  for (const [w, h] of MOBILE) {
    test(`captura ${w}x${h}: campo cerrado + comparación Campo completo vs Llenar pantalla`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      // Un Portero visible para que la pizarra no esté vacía (no abre inspector).
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.locator('.tray-player[title="Jugador Azul"]').click();
      await expect(
        page.locator('.side-panel-left'),
        'el panel Jugadores permanece abierto',
      ).toBeVisible();
      // En móvil vertical el centro del campo queda bajo el panel y los pasos siguientes
      // (captura "cerrado", toggle y paneo) necesitan el campo despejado: se cierra el
      // panel con su X (no desarma la colocación) antes del toque táctil.
      await page.locator('.side-panel-left .panel-close').first().click();
      const host = await hostBox(page);
      const c = normToScreen(0.5, 0.5, host, 'height');
      await page.touchscreen.tap(c.x, c.y);
      await expect(page.locator('.field-count')).toHaveText('1');
      // Fase 3: la colocación es continua → queda ARMADO y muestra la pista sobre el campo. Se
      // DESARMA con Seleccionar para dejar la captura "cerrada" limpia y sin pista flotante.
      await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/${w}x${h}-llenar-pantalla.png` });

      // Cambiar a Campo completo para el contraste (el control vive en el menú «Más»).
      await toggleFillScreen(page);
      await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/${w}x${h}-campo-completo.png` });
    });
  }
});
