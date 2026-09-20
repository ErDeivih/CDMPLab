import { test, expect, Page } from '@playwright/test';

/**
 * FASE 7 del encargo — TARJETAS DE BIBLIOTECA.
 *
 * Requisitos comprobados aquí, con medidas del DOM:
 *  · En móvil, EXACTAMENTE dos tarjetas por fila, también a 360 px de ancho.
 *  · Miniatura 16:9 y título como máximo en dos líneas.
 *  · Cero overflow horizontal.
 *  · En escritorio, cuadrícula adaptable de 3 a 4 tarjetas por fila (no gigantes).
 *  · Se prueban tarjetas CON miniatura, SIN miniatura (marcador) y con TÍTULO LARGO.
 *
 * Contrato anterior que cambia: la rejilla usaba `auto-fill/minmax(250px, 1fr)`, así que a 360 px
 * cabía UNA sola tarjeta. La prueba anterior no lo cubría; esta fija el contrato nuevo.
 */

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Seis ejercicios: 2 con miniatura, 1 sin miniatura ni objetos, 1 con título larguísimo. */
async function seed(page: Page): Promise<void> {
  await page.addInitScript((png: string) => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    const base = {
      teamId: 't1',
      folderId: null,
      description: 'Conservación',
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
      savedAt: now,
    };
    const conObjetos = {
      version: 2,
      field: 'full',
      frames: [
        {
          duration: 1000,
          elements: [
            { id: 'a', t: 'cone', x: 0.3, y: 0.3, c: '#e74c3c' },
            { id: 'b', t: 'cone', x: 0.6, y: 0.5, c: '#f6c945' },
          ],
        },
      ],
    };
    localStorage.setItem(
      'entrenolab:exercises',
      JSON.stringify([
        { ...base, id: 'e1', title: 'Rondo 4x2', thumbnail: png, canvas: conObjetos },
        {
          ...base,
          id: 'e2',
          title: 'Salida de balón con presión alta y tres carriles',
          thumbnail: png,
          canvas: conObjetos,
        },
        { ...base, id: 'e3', title: 'Sin miniatura', thumbnail: null, canvas: conObjetos },
        { ...base, id: 'e4', title: 'Vacío', thumbnail: null, canvas: null },
        { ...base, id: 'e5', title: 'Posesión', thumbnail: png, canvas: conObjetos },
        { ...base, id: 'e6', title: 'Finalización', thumbnail: png, canvas: conObjetos },
      ]),
    );
  }, PNG_1X1);
}

/** Cajas de las tarjetas: cuántas comparten fila (mismo `y` redondeado) y sus proporciones. */
async function medirRejilla(page: Page) {
  return page.evaluate(() => {
    const cajas = [...document.querySelectorAll('.ex-card')].map((el) => {
      const b = el.getBoundingClientRect();
      return {
        x: +b.x.toFixed(1),
        y: +b.y.toFixed(1),
        w: +b.width.toFixed(1),
        h: +b.height.toFixed(1),
      };
    });
    const filas = new Map<string, number>();
    for (const c of cajas) filas.set(String(c.y), (filas.get(String(c.y)) ?? 0) + 1);
    const thumbs = [...document.querySelectorAll('.ex-thumb')].map((el) => {
      const b = el.getBoundingClientRect();
      return +(b.width / b.height).toFixed(2);
    });
    const titulos = [...document.querySelectorAll('.ex-title')].map((el) => {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || 16;
      return {
        alto: el.getBoundingClientRect().height,
        lineas: Math.round(el.getBoundingClientRect().height / lh),
      };
    });
    const doc = document.documentElement;
    return {
      total: cajas.length,
      porFila: [...filas.values()],
      thumbs,
      titulos,
      overflow: doc.scrollWidth - doc.clientWidth,
      anchoTarjeta: cajas[0]?.w ?? 0,
      anchoGrid:
        (document.querySelector('.grid') as HTMLElement)?.getBoundingClientRect().width ?? 0,
      anchoMain:
        (document.querySelector('.lib-main') as HTMLElement)?.getBoundingClientRect().width ?? 0,
    };
  });
}

for (const [nombre, vp] of [
  ['360×800', { width: 360, height: 800 }],
  ['390×844', { width: 390, height: 844 }],
  ['844×390 (horizontal)', { width: 844, height: 390 }],
] as const) {
  test(`FASE 7: en móvil ${nombre} hay EXACTAMENTE dos tarjetas por fila`, async ({ page }) => {
    await page.setViewportSize(vp);
    await seed(page);
    await page.goto('/library');
    await expect(page.locator('.ex-card').first()).toBeVisible();

    const m = await medirRejilla(page);
    expect(m.total, 'se ven los seis ejercicios').toBe(6);
    expect(
      Math.max(...m.porFila),
      `ninguna fila puede tener más de dos tarjetas (medido: ${m.porFila.join('/')})`,
    ).toBe(2);
    expect(
      m.porFila.filter((n) => n === 2).length,
      'hay filas de dos tarjetas',
    ).toBeGreaterThanOrEqual(2);
    expect(m.overflow, 'sin overflow horizontal').toBeLessThanOrEqual(1);
    // Miniatura 16:9 en móvil.
    for (const r of m.thumbs) expect(r).toBeGreaterThan(1.6);
    for (const r of m.thumbs) expect(r).toBeLessThan(1.9);
    // Título: como máximo dos líneas (incluido el título largo).
    for (const t of m.titulos)
      expect(t.lineas, 'título de dos líneas como máximo').toBeLessThanOrEqual(2);
  });
}

test('FASE 7: en escritorio la rejilla es de 3–4 tarjetas por fila y no gigantes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await seed(page);
  await page.goto('/library');
  await expect(page.locator('.ex-card').first()).toBeVisible();
  const m = await medirRejilla(page);
  const porFila = Math.max(...m.porFila);
  console.log(
    `[biblioteca escritorio] grid=${m.anchoGrid}px main=${m.anchoMain}px tarjeta=${m.anchoTarjeta}px porFila=${porFila} (${m.porFila.join('/')})`,
  );
  expect(porFila, 'entre 3 y 4 tarjetas por fila en escritorio').toBeGreaterThanOrEqual(3);
  expect(porFila).toBeLessThanOrEqual(4);
  expect(m.anchoTarjeta, 'las tarjetas no son gigantes').toBeLessThan(420);
  expect(m.overflow).toBeLessThanOrEqual(1);
});

test('FASE 7: las tarjetas con miniatura, sin miniatura y con título largo se pintan sin romperse', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/library');
  await expect(page.locator('.ex-card').first()).toBeVisible();

  // Con miniatura: <img> cargado de verdad.
  const conMiniatura = page.locator('.ex-card', { hasText: 'Rondo 4x2' }).first();
  const img = conMiniatura.locator('.thumb-img');
  await expect(img).toHaveCount(1);
  const medida = await img.evaluate(async (el) => {
    const i = el as HTMLImageElement;
    try {
      await i.decode();
    } catch {
      /* se informa abajo */
    }
    return { complete: i.complete, nw: i.naturalWidth };
  });
  expect(medida.complete).toBe(true);
  expect(medida.nw, 'la miniatura carga (nada de imagen rota)').toBeGreaterThan(0);

  // Sin miniatura pero con objetos: diagrama SVG en vivo.
  const sinMiniatura = page.locator('.ex-card', { hasText: 'Sin miniatura' }).first();
  await expect(sinMiniatura.locator('.ex-thumb .diagram svg')).toHaveCount(1);

  // Sin miniatura y sin objetos: marcador limpio del campo (nunca imagen rota).
  const vacio = page.locator('.ex-card', { hasText: 'Vacío' }).first();
  await expect(vacio.locator('.ex-thumb .diagram.placeholder')).toHaveCount(1);
  await expect(page.locator('.ex-thumb img.thumb-img')).toHaveCount(4);

  // Título largo: dos líneas y sin desbordar la tarjeta.
  const largo = page.locator('.ex-card', { hasText: 'Salida de balón' }).first();
  const caja = await largo.boundingBox();
  const cajaTitulo = await largo.locator('.ex-title').boundingBox();
  expect(cajaTitulo!.width).toBeLessThanOrEqual(caja!.width + 1);
});
