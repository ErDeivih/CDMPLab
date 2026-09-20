// =============================================================
// FASE H — Galería de campos COMPLETA y conversiones de campo.
//
// DEFECTO 6 corregido: se exige la lista EXPLÍCITA de campos (9 tipos),
// se verifica cada tarjeta, se desplaza la galería, se abre cada tipo
// comprobando que el SVG cambia y se generan capturas de CADA campo para
// componer un contact sheet real (no una captura parcial del viewport).
// DEFECTO 7 corregido: conversiones de campo con elementos, undo/redo y
// guardar/reabrir.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { fillBoardTitle } from './gesture-helpers';
import {
  seedBoard,
  openBoard,
  hostBox,
  fitMode,
  fieldCount,
  normToScreen,
  showCategory,
} from './board-helpers';

const OUT = 'docs/screenshots/fase-h';
const CARDS = `${OUT}/_fieldcards`;
fs.mkdirSync(CARDS, { recursive: true });

/** Lista EXPLÍCITA de los campos base OFRECIDOS (id → etiqueta de la tarjeta).
 *  «Medio campo» es UNA sola tarjeta (auditoría final): `vertical_half` ya no se ofrece porque su
 *  SVG es idéntico al de `half` con orientación vertical.
 *  CORRECCIÓN URGENTE (dueño): `box` («Área y portería») y `two_halves` («Dos medios campos») dejan
 *  de ofrecerse —el dueño no los usa— pero siguen ADMITIDOS: un documento antiguo con esos campos se
 *  abre, se dibuja y se puede cambiar a otro campo. Esa compatibilidad se cubre en
 *  `e2e/fase-cambio-campos.spec.ts` (documentos históricos) y en `store.spec.ts` (respaldos). */
const FIELDS: Array<[string, string]> = [
  ['full', 'Campo completo'],
  ['half', 'Medio campo'],
  ['third', 'Tercio de campo'],
  ['futsal', 'Fútbol sala'],
  ['f7', 'F7 transversal'],
  ['blank', 'Lienzo'],
];

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

async function clickNorm(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
}

/** Selecciona un campo por su tarjeta de la galería (interacción real). */
async function pickFieldCard(page: Page, label: string): Promise<void> {
  await openProps(page);
  const card = page.locator(`.field-gallery .field-card[aria-label="Campo ${label}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
}

test.describe('FASE H — galería de campos completa', () => {
  test('la galería ofrece EXACTAMENTE los campos esperados, cada uno con miniatura', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await openProps(page);
    const gallery = page.locator('.field-gallery');
    await expect(gallery).toBeVisible();
    // Exactamente 8 tarjetas (lista explícita, no ">=5"), y NINGUNA duplicada: el medio
    // campo se ofrece una sola vez (antes había también «Medio campo vertical», que
    // renderizaba exactamente lo mismo).
    await expect(page.locator('.field-gallery .field-card')).toHaveCount(FIELDS.length);
    await expect(
      page.locator('.field-gallery .field-card[aria-label="Campo Medio campo vertical"]'),
      'la tarjeta duplicada del medio campo ya no existe',
    ).toHaveCount(0);
    // Cada campo esperado tiene EXACTAMENTE una tarjeta, con miniatura SVG y nombre.
    for (const [id, label] of FIELDS) {
      const card = page.locator(`.field-gallery .field-card[aria-label="Campo ${label}"]`);
      await expect(card, `${id} presente una vez`).toHaveCount(1);
      await expect(card.locator('.field-card-thumb svg'), `${id} con miniatura SVG`).toHaveCount(1);
      await expect(card.locator('.field-card-name')).toHaveText(label);
    }
    // TODAS las tarjetas caben a lo ancho: la galería es una REJILLA, no un carrusel.
    // (Antes esta prueba exigía lo contrario —`scrollWidth > clientWidth`— y estaba MAL: con
    // 8 campos la fila medía 824 px dentro de un panel de 271 px, así que solo se veían 2,6
    // tarjetas y había que desplazar en horizontal dentro de un panel que ya va en vertical.
    // El dueño lo señaló como «no poder elegir»; ahora el catálogo entero está a la vista.)
    const desborde = await gallery.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(
      desborde,
      `la galería no se desplaza en horizontal (desborde ${desborde}px)`,
    ).toBeLessThanOrEqual(1);
    // Y las 8 tarjetas son visibles de verdad dentro del ancho de la galería (ninguna fuera).
    const anchos = await gallery.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.field-card')).map((c) => {
        const b = c.getBoundingClientRect();
        return b.left >= r.left - 1 && b.right <= r.right + 1;
      });
    });
    expect(anchos.every(Boolean), 'ninguna tarjeta queda fuera del ancho del panel').toBe(true);
  });

  test('la miniatura de cada tarjeta anuncia la orientación que se aplicará al pulsarla', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await openProps(page);
    await pickFieldCard(page, 'Campo completo');

    // La miniatura de «Medio campo» se dibuja YA con la orientación que aplicará el clic
    // (vertical en escritorio), no con la orientación actual (horizontal, porque el campo
    // activo es «Campo completo»). Antes la tarjeta prometía una cosa y hacía otra.
    const thumb = page.locator(
      '.field-gallery .field-card[aria-label="Campo Medio campo"] .field-card-thumb',
    );
    const anunciaGirada = await thumb.evaluate((el) => /rotate\(90\)/.test(el.innerHTML));

    await pickFieldCard(page, 'Medio campo');
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'half');
    const chipVerticalActivo = (
      (await page.locator('.studio-panel .chip[data-orient="vertical"]').getAttribute('class')) ??
      ''
    ).includes('chip-active');
    expect(
      anunciaGirada,
      'la miniatura ya mostraba la orientación que el clic acaba de aplicar',
    ).toBe(chipVerticalActivo);
  });

  test('abre cada campo: el SVG cambia y se captura cada uno (contact sheet real)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    const svgs: Record<string, string> = {};
    for (const [id, label] of FIELDS) {
      await pickFieldCard(page, label);
      await expect(page.locator('.board-canvas svg')).toBeVisible();
      const html = await page.locator('.board-canvas svg').innerHTML();
      expect(html.length, `el campo ${id} renderiza un SVG`).toBeGreaterThan(50);
      svgs[id] = html;
      // Captura del CAMPO (board) de cada tipo para el contact sheet.
      await page.locator('.board-host').screenshot({ path: `${CARDS}/${id}.png` });
    }
    // Los 8 campos de la galería renderizan DISTINTO entre sí: ya no hay dos tarjetas para
    // el mismo dibujo (el alias `vertical_half` dejó de ofrecerse).
    const distinct = new Set(FIELDS.map(([id]) => svgs[id]));
    expect(distinct.size, 'los 8 campos renderizan distinto').toBe(FIELDS.length);
  });

  test('un documento antiguo `vertical_half` se abre como medio campo VERTICAL sin perder elementos', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    // Documento ANTIGUO: campo `vertical_half` (el tipo que ya no se ofrece) con DOS
    // elementos, uno de ellos con dorsal para poder comprobar que no se pierde nada.
    const legacy = {
      id: 'legacy-vh',
      teamId: 't1',
      folderId: null,
      title: 'Antiguo vertical',
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
        field: 'vertical_half',
        orientation: 'horizontal',
        frames: [
          {
            duration: 1000,
            elements: [
              { id: 'e1', t: 'player', x: 0.3, y: 0.4, n: 9, c: '#1a73e8' },
              { id: 'e2', t: 'cone', x: 0.7, y: 0.6, c: '#f9ab00' },
            ],
          },
        ],
        grass: 'stripes',
      },
      thumbnail: null,
      savedAt: '2026-01-01T10:00:00.000Z',
    };
    await page.addInitScript((doc: unknown) => {
      for (const k of Object.keys(localStorage))
        if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
      const now = new Date().toISOString();
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:board-hints', '1');
      localStorage.setItem(
        'entrenolab:teams',
        JSON.stringify([
          { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now },
        ]),
      );
      localStorage.setItem('entrenolab:players', JSON.stringify([]));
      localStorage.setItem('entrenolab:folders', JSON.stringify([]));
      localStorage.setItem('entrenolab:exercises', JSON.stringify([doc]));
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    }, legacy);
    await page.goto('/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.board-canvas svg')).toBeVisible();

    // 1) El campo antiguo se lee como `half` con orientación VERTICAL (medio campo vertical).
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'half');
    await openProps(page);
    await expect(
      page
        .locator('.studio-panel .field', { hasText: 'Orientación' })
        .locator('.chip[data-orient="vertical"]'),
      'se interpreta como medio campo con la portería arriba',
    ).toHaveClass(/chip-active/);
    // 2) NO se pierde ningún elemento.
    await expect(page.locator('.field-count')).toHaveText('2');

    // 3) Al guardar, el documento queda en el modelo nuevo: `half` + orientación vertical.
    await fillBoardTitle(page, 'Antiguo vertical migrado');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0].canvas,
    );
    expect(saved.field, 'se guarda como half (un solo tipo de medio campo)').toBe('half');
    expect(saved.orientation, 'y con la orientación que significaba vertical').toBe('vertical');
    expect(saved.frames[0].elements, 'sin perder elementos').toHaveLength(2);
    expect(saved.frames[0].elements.map((e: { id: string }) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  test('orientación horizontal/vertical cambia el SVG en el mismo campo', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await openProps(page);
    // En "Campo completo" la orientación SÍ aplica (rota el terreno).
    await page
      .locator('.studio-panel .field', { hasText: 'Campo base' })
      .locator('select')
      .selectOption('full');
    await expect.poll(() => page.locator('.board-host').getAttribute('data-field')).toBe('full');
    await page
      .locator('.studio-panel .field', { hasText: 'Orientación' })
      .locator('.chip[data-orient="horizontal"]')
      .click();
    await expect(
      page
        .locator('.studio-panel .field', { hasText: 'Orientación' })
        .locator('.chip[data-orient="horizontal"]'),
    ).toHaveClass(/chip-active/);
    const h = await page.locator('.board-canvas svg').innerHTML();
    await page
      .locator('.studio-panel .field', { hasText: 'Orientación' })
      .locator('.chip[data-orient="vertical"]')
      .click();
    await expect(
      page
        .locator('.studio-panel .field', { hasText: 'Orientación' })
        .locator('.chip[data-orient="vertical"]'),
    ).toHaveClass(/chip-active/);
    const v = await page.locator('.board-canvas svg').innerHTML();
    expect(v, 'vertical y horizontal renderizan distinto').not.toBe(h);
  });
});

test.describe('FASE H — cambios de campo con elementos (directos)', () => {
  test('half↔full conservan los elementos; undo/redo y guardar/reabrir', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);

    // Ejercicio con jugadores, material, línea y figura.
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    let close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    await page.mouse.click(
      ...(Object.values(normToScreen(0.35, 0.4, host, fit)) as [number, number]),
    );
    await page.mouse.click(
      ...(Object.values(normToScreen(0.5, 0.5, host, fit)) as [number, number]),
    );
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').click();
    close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    await clickNorm(page, 0.6, 0.6);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Línea"]').click();
    close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    const a = normToScreen(0.3, 0.7, host, fit);
    const b = normToScreen(0.7, 0.7, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Rectángulo"]').click();
    close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    const r1 = normToScreen(0.2, 0.15, host, fit);
    const r2 = normToScreen(0.4, 0.3, host, fit);
    await page.mouse.move(r1.x, r1.y);
    await page.mouse.down();
    await page.mouse.move(r2.x, r2.y, { steps: 5 });
    await page.mouse.up();
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(5);
    const total = 5;

    // helper: el campo activo y el nº de elementos.
    const fieldOf = () => page.locator('.board-host').getAttribute('data-field');

    // CAMBIO DE CONTRATO (corrección urgente del dueño): cambiar de campo es DIRECTO. Ya no hay
    // diálogo «Cambiar a medio campo» ni opciones («Dos medios campos», «Encajar todo», «Mantener
    // los objetos»): el campo cambia con un clic y los elementos conservan sus coordenadas.
    await openProps(page);
    await page
      .locator('.studio-panel .field', { hasText: 'Campo base' })
      .locator('select')
      .selectOption('half');
    await expect(page.locator('.field-change-dialog'), 'sin diálogo').toHaveCount(0);
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('half');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Undo/redo del cambio de campo: restaura el campo COMPLETO previo y los elementos.
    await page.keyboard.press('Control+z');
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('full');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);
    await page.keyboard.press('Control+y');
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('half');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Volver a "Campo completo" conserva los elementos (y tampoco abre diálogo).
    await page
      .locator('.studio-panel .field', { hasText: 'Campo base' })
      .locator('select')
      .selectOption('full');
    await expect(page.locator('.field-change-dialog'), 'sin diálogo al volver').toHaveCount(0);
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('full');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Cambio de orientación conserva los elementos.
    await page
      .locator('.studio-panel .field', { hasText: 'Orientación' })
      .locator('.chip[data-orient="vertical"]')
      .click();
    await expect(
      page
        .locator('.studio-panel .field', { hasText: 'Orientación' })
        .locator('.chip[data-orient="vertical"]'),
    ).toHaveClass(/chip-active/);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);

    // Guardar y reabrir conserva campo, orientación y elementos.
    await fillBoardTitle(page, 'Conversiones');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const saved = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return {
        field: ex.canvas.field,
        orientation: ex.canvas.orientation,
        n: ex.canvas.frames[0].elements.length,
      };
    });
    expect(saved.field).toBe('full');
    expect(saved.orientation).toBe('vertical');
    expect(saved.n).toBe(total);

    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect.poll(() => fieldOf(), { timeout: 4000 }).toBe('full');
    await openProps(page);
    await expect(
      page
        .locator('.studio-panel .field', { hasText: 'Orientación' })
        .locator('.chip[data-orient="vertical"]'),
    ).toHaveClass(/chip-active/);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(total);
  });
});
