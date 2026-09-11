// =============================================================
// LOTE C1 — Biblioteca: usabilidad y coste de render.
//
// Comprueba lo que se cambió y por qué:
//   · la búsqueda filtra con retardo (200 ms) y sin recargar en cada tecla;
//   · hay contador de resultados ("N ejercicios" y "de M" con filtros);
//   · botón de limpiar la búsqueda y de limpiar TODOS los filtros;
//   · el orden se elige (Recientes / A–Z / Duración);
//   · el conteo por carpeta suma el SUBÁRBOL (una pasada cacheada, antes se recalculaba
//     por fila y en cada ciclo de detección de cambios).
// =============================================================
import { test, expect, Page } from '@playwright/test';

const TEAM = {
  id: 't1',
  name: 'Primer Equipo',
  accentColor: '#3056d3',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const FOLDERS = [
  { id: 'f1', teamId: 't1', parentId: null, name: 'Ataque' },
  { id: 'f2', teamId: 't1', parentId: 'f1', name: 'Rondos' },
  { id: 'f3', teamId: 't1', parentId: null, name: 'Defensa' },
];

function ex(
  id: string,
  title: string,
  durationMinutes: number | null,
  savedAt: string,
  folderId: string | null,
  elements = 0,
): unknown {
  return {
    id,
    teamId: 't1',
    folderId,
    title,
    description: '',
    explanation: '',
    category: 'Técnica',
    objectives: [],
    materials: [],
    durationMinutes,
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
          elements: Array.from({ length: elements }, (_, i) => ({
            id: `${id}-e${i}`,
            t: 'cone',
            x: 0.2 + i * 0.12,
            y: 0.5,
          })),
        },
      ],
      orientation: 'horizontal',
      grass: 'stripes',
    },
    thumbnail: null,
    savedAt,
  };
}

// Cuatro ejercicios con fecha, duración, título y carpeta DISTINTOS, de modo que los tres
// órdenes den resultados diferentes (si coincidieran, el test no probaría nada).
const EXERCISES = [
  ex('x1', 'Rondo 4v2', 30, '2026-01-02T10:00:00.000Z', 'f2', 2),
  ex('x2', 'Circulación', 8, '2026-01-03T10:00:00.000Z', 'f2', 1),
  ex('x3', 'Salida de balón', 12, '2026-01-04T10:00:00.000Z', 'f1', 3),
  ex('x4', 'Defensa en bloque', 20, '2026-01-05T10:00:00.000Z', 'f3', 1),
];

async function seedLibrary(page: Page): Promise<void> {
  await page.addInitScript(
    (data: { team: unknown; exercises: unknown[]; folders: unknown[] }) => {
      // Solo se siembra una vez por contexto: no re-empezar en cada navegación.
      if (localStorage.getItem('entrenolab:seeded')) return;
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:teams', JSON.stringify([data.team]));
      localStorage.setItem('entrenolab:players', JSON.stringify([]));
      localStorage.setItem('entrenolab:exercises', JSON.stringify(data.exercises));
      localStorage.setItem('entrenolab:folders', JSON.stringify(data.folders));
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    },
    { team: TEAM, exercises: EXERCISES, folders: FOLDERS },
  );
}

const titles = (page: Page) => page.locator('.ex-card .ex-title');

test.describe('Lote C1 — Biblioteca: búsqueda, contador y orden', () => {
  test('la búsqueda filtra con retardo, el contador lo dice y se puede limpiar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedLibrary(page);
    await page.goto('/library');

    await expect(page.locator('.ex-card')).toHaveCount(4);
    await expect(page.locator('.result-count')).toContainText('4 ejercicios');
    // Sin filtros no se muestra el total ni el botón de limpiar filtros.
    await expect(page.locator('.result-total')).toHaveCount(0);
    await expect(page.locator('.results-bar button', { hasText: 'Limpiar filtros' })).toHaveCount(
      0,
    );

    // Escribir filtra (la aserción reintenta: el filtro es con retardo, no instantáneo).
    await page.locator('.search input').fill('rondo');
    await expect(page.locator('.ex-card')).toHaveCount(1);
    await expect(page.locator('.ex-card .ex-title')).toHaveText('Rondo 4v2');
    await expect(page.locator('.result-count')).toContainText('1 ejercicio');
    await expect(page.locator('.result-count')).toContainText('de 4');
    // Con filtro puesto aparece el botón de limpiar todos los filtros.
    await expect(page.locator('.results-bar button', { hasText: 'Limpiar filtros' })).toBeVisible();

    // El botón de la lupa vacía la búsqueda.
    await page.locator('.search-clear').click();
    await expect(page.locator('.search input')).toHaveValue('');
    await expect(page.locator('.ex-card')).toHaveCount(4);

    // Y "Limpiar filtros" devuelve la lista completa tras filtrar por categoría.
    await page.locator('.chips .chip', { hasText: 'Portero' }).click();
    await expect(page.locator('.ex-card')).toHaveCount(0);
    await page.locator('.results-bar button', { hasText: 'Limpiar filtros' }).click();
    await expect(page.locator('.ex-card')).toHaveCount(4);
  });

  test('el orden se puede cambiar: Recientes (por defecto), A–Z y Duración', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedLibrary(page);
    await page.goto('/library');
    await expect(page.locator('.ex-card')).toHaveCount(4);

    // Por defecto, lo último guardado primero (x4 es el más reciente).
    await expect(titles(page).first()).toHaveText('Defensa en bloque');

    await page.locator('.order select').selectOption('az');
    await expect(titles(page).first()).toHaveText('Circulación');
    await expect(titles(page).last()).toHaveText('Salida de balón');

    await page.locator('.order select').selectOption('duration');
    await expect(titles(page).first()).toHaveText('Rondo 4v2'); // 30 min: la más larga
    await expect(titles(page).last()).toHaveText('Circulación'); // 8 min

    await page.locator('.order select').selectOption('recent');
    await expect(titles(page).first()).toHaveText('Defensa en bloque');
  });

  test('el conteo de carpeta suma el SUBÁRBOL (padre e hijo)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedLibrary(page);
    await page.goto('/library');

    // 'Ataque' (f1) tiene 1 ejercicio propio + 2 de su subcarpeta 'Rondos'.
    const ataque = page.locator('.tree-row', { hasText: 'Ataque' });
    await expect(ataque.locator('.tree-count')).toHaveText('3');
    // 'Defensa' tiene 1.
    await expect(
      page.locator('.tree-row', { hasText: 'Defensa' }).locator('.tree-count'),
    ).toHaveText('1');

    // La subcarpeta solo aparece al desplegar el padre; su conteo es el suyo (2).
    await ataque.locator('.tree-caret').click();
    await expect(
      page.locator('.tree-row', { hasText: 'Rondos' }).locator('.tree-count'),
    ).toHaveText('2');
  });

  test('la miniatura muestra la pizarra COMPLETA (sin recortar)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedLibrary(page);
    await page.goto('/library');

    // La tarjeta dibuja la pizarra en SVG (`previewOf`) o, si hay PNG, lo muestra con
    // `object-fit: contain` (con `cover` se recortaban los bordes de la pizarra).
    const img = page.locator('.ex-card .thumb-img').first();
    if (await img.count()) {
      const fit = await img.evaluate((el) => getComputedStyle(el).objectFit);
      expect(fit, 'la miniatura no debe recortar la pizarra').toBe('contain');
    } else {
      await expect(
        page.locator('.ex-card .diagram svg').first(),
        'sin PNG, la tarjeta dibuja la pizarra completa',
      ).toBeVisible();
    }
    // El hueco de la miniatura tiene SIEMPRE el verde del campo (el letterbox no se nota).
    const bg = await page
      .locator('.ex-card .ex-thumb')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});
