import { test, expect, Page } from '@playwright/test';

// =============================================================
// Accesibilidad de los botones de color (`.swatch` / `.variant-swatch`).
//
// Los swatches se pintan con un hex y no llevan texto visible, así que un
// lector de pantalla no puede nombrarlos. Este spec comprueba, con los
// paneles ABIERTOS (donde viven los swatches), que:
//   - los swatches de Césped / Líneas / Color del elemento / Material y
//     Dibujo tienen `aria-label` y `title` no vacíos y legibles; y
//   - NO hay ningún botón visible sin nombre accesible en cada estado.
// =============================================================

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }])
    );
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
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
      ])
    );
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Carga la pizarra en escritorio con la ayuda descartada. */
async function openBoard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
}

/** Recolecta los botones VISIBLES de `.studio` sin nombre accesible. */
async function unnamedVisible(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.studio button'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue; // oculto
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const label = (el.getAttribute('aria-label') ?? '').trim();
      const text = (el.textContent ?? '').trim();
      const title = (el.getAttribute('title') ?? '').trim();
      if (!label && !text && !title) bad.push(`<${el.tagName.toLowerCase()} class="${el.className}">`);
    }
    return bad;
  });
}

/** Falla si hay un botón visible sin nombre accesible en `state`. */
async function expectEverythingNamed(page: Page, state: string): Promise<void> {
  const bad = await unnamedVisible(page);
  expect(bad, `botones sin nombre accesible en ${state}`).toEqual([]);
}

/** Un swatch debe tener `aria-label` y `title` no vacíos. */
async function expectSwatchNamed(locator: ReturnType<Page['locator']>, state: string): Promise<void> {
  const n = await locator.count();
  expect(n, `no hay swatches en ${state}`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const sw = locator.nth(i);
    await expect(sw, `swatch #${i} (${state}) sin aria-label`).toHaveAttribute('aria-label', /.+/);
    await expect(sw, `swatch #${i} (${state}) sin title`).toHaveAttribute('title', /.+/);
  }
}

/** Coloca un elemento en el centro del campo a partir de la herramienta ya armada. */
async function clickFieldCenter(page: Page): Promise<void> {
  const box = (await page.locator('.board-host').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
}

test.describe('Swatches de color — nombre accesible (aria-label + title)', () => {
  test('Propiedades sin selección: el césped es único (sin swatches) y todo botón tiene nombre', async ({ page }) => {
    await openBoard(page);
    await page.locator('button[aria-label="Propiedades"]').click();
    await expect(page.locator('.studio-panel')).toBeVisible();

    // FASE 2: el césped es el oficial ÚNICO. Se retira el selector de color (y el de
    // textura, retirado en la Fase 9): no hay swatches de "Césped" y se muestra una
    // indicación estática. Los ejercicios guardados conservan su backgroundColor.
    const grassField = page.locator('.studio-panel .field', { hasText: 'Césped' });
    await expect(grassField).toBeVisible();
    await expect(grassField.locator('.swatch')).toHaveCount(0);

    // Fase 11: se retira el selector de color de líneas del campo (las marcas
    // reglamentarias son siempre blancas), así que ya no hay swatches de "Líneas".

    await expectEverythingNamed(page, 'Propiedades sin selección');
  });

  test('Propiedades con jugador: los swatches del Color del elemento están nombrados', async ({ page }) => {
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    // FASE B (paneles persistentes): elegir jugador NO cierra el panel Jugadores.
    await expect(page.locator('.side-panel-left'), 'el panel Jugadores permanece abierto').toBeVisible();
    await clickFieldCenter(page);
    await expect(page.locator('.field-count')).toHaveText('1');
    // Fase 3: la colocación es continua y NO auto-selecciona. Se DESARMA con Seleccionar
    // y se hace clic sobre el jugador para seleccionarlo (abre el inspector).
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await clickFieldCenter(page);
    await expect(page.locator('.studio-panel')).toBeVisible();

    const color = page.locator('.studio-panel .inspector .field', { hasText: 'Color' }).locator('.swatch');
    await expect(color).toHaveCount(8);
    await expectSwatchNamed(color, 'Color del jugador');
    await expect(color.nth(0)).toHaveAttribute('aria-label', 'Color azul');
    await expectEverythingNamed(page, 'jugador seleccionado');
  });

  test('Propiedades con material (peto): el Color del elemento está nombrado', async ({ page }) => {
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Peto"]').click();
    await clickFieldCenter(page);
    await expect(page.locator('.field-count')).toHaveText('1');
    // Fase 3: la colocación es continua y NO auto-selecciona. Se DESARMA con Seleccionar
    // y se hace clic sobre el peto para seleccionarlo (abre Propiedades).
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await clickFieldCenter(page);
    await expect(page.locator('.studio-panel')).toBeVisible();

    const color = page.locator('.studio-panel .inspector .field', { hasText: 'Color' }).locator('.swatch');
    await expect(color).toHaveCount(8);
    await expectSwatchNamed(color, 'Color del material');
    await expectEverythingNamed(page, 'material seleccionado');
  });

  test('Propiedades con texto: el Color del elemento está nombrado', async ({ page }) => {
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await clickFieldCenter(page);
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.studio-panel')).toBeVisible();

    const color = page.locator('.studio-panel .inspector .field', { hasText: 'Color' }).locator('.swatch');
    await expect(color).toHaveCount(8);
    await expectSwatchNamed(color, 'Color del texto');
    await expectEverythingNamed(page, 'texto seleccionado');
  });

  test('Propiedades con figura (rectángulo): el Color del elemento está nombrado', async ({ page }) => {
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Rectángulo"]').click();
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 30, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
    // Dibujar una figura NO la selecciona: cambiamos a Seleccionar y pulsamos sobre ella.
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await page.mouse.click(x + 20, y + 15);
    await expect(page.locator('.studio-panel')).toBeVisible();

    const color = page.locator('.studio-panel .inspector .field', { hasText: 'Color' }).locator('.swatch');
    // Fase 10: la figura usa un único color (el relleno es del mismo color que el
    // perímetro), así que solo hay los 8 swatches de "Color" (ya no "Color de relleno").
    await expect(color).toHaveCount(8);
    await expectSwatchNamed(color, 'Color de la figura');
    await expectEverythingNamed(page, 'figura (rect) seleccionada');
  });

  test('Dibujo activo: los colores de dibujo en la barra están nombrados', async ({ page }) => {
    await openBoard(page);
    // Elegir una herramienta de dibujo (rect) deja la paleta visible en la barra.
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Rectángulo"]').click();

    const swatches = page.locator('.tools-caption .swatch');
    // Fase 10: herramienta de dibujo coloreable → 8 colores de dibujo; el relleno usa
    // el mismo color, así que ya no se muestran los 8 swatches de "Relleno".
    await expect(swatches).toHaveCount(8);
    await expectSwatchNamed(swatches, 'colores de dibujo');
    await expect(swatches.nth(0)).toHaveAttribute('aria-label', 'Color azul');
    await expectEverythingNamed(page, 'dibujo activo');
  });

  test('Material: los swatches de variante están nombrados y todo botón tiene nombre', async ({ page }) => {
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();

    const variants = page.locator('.tools-material-variants .variant-swatch');
    await expect(variants.first()).toBeVisible();
    await expectSwatchNamed(variants, 'variantes de material');
    await expectEverythingNamed(page, 'panel de Material abierto');
  });
});
