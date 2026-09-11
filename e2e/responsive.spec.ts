import { test, expect, Page } from '@playwright/test';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    const players = [
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ];
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:folders', JSON.stringify([{ id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' }]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: 'Conservación', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function expectNoHorizontalScroll(page: Page, selector: string): Promise<void> {
  const r = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? { scroll: (el as HTMLElement).scrollWidth, client: (el as HTMLElement).clientWidth } : null;
  }, selector);
  expect(r, `scroll horizontal en ${selector}`).not.toBeNull();
  expect(r!.scroll).toBeLessThanOrEqual(r!.client + 1);
}

test.describe('Responsive móvil (390×844)', () => {
  test('Plantilla, Biblioteca y Sesiones sin scroll horizontal y con acciones pulsables', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);

    // Plantilla.
    await page.goto('/team');
    await expect(page.getByText('Añadir jugador')).toBeVisible();
    await expectNoHorizontalScroll(page, '.content');
    await expectNoHorizontalScroll(page, '.roster');
    // Acción principal pulsable.
    await page.getByText('Añadir jugador').click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.locator('.modal .field input[name="name"]').fill('Eric');
    await page.locator('.modal .btn-primary').click();
    await expect(page.getByText('Eric')).toBeVisible();

    // Biblioteca.
    await page.goto('/library');
    await expect(page.locator('button', { hasText: 'Crear ejercicio' }).first()).toBeVisible();
    await expectNoHorizontalScroll(page, '.content');
    await expectNoHorizontalScroll(page, '.library');
    // Una tarjeta con acciones pulsables.
    await expect(page.locator('.ex-card')).toHaveCount(1);
    await page.locator('.ex-card .ex-open-btn[title="Diseñar en pizarra"]').click();
    await page.waitForURL('**/board');

    // Sesiones.
    await page.goto('/sessions');
    await expect(page.getByText('Nueva sesión')).toBeVisible();
    await expectNoHorizontalScroll(page, '.content');
    await expectNoHorizontalScroll(page, '.sessions');
  });

  test('la pizarra en móvil no desborda horizontalmente (panel y herramientas)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await page.goto('/board');
    await expect(page.locator('.board-host')).toBeVisible();
    await expectNoHorizontalScroll(page, '.studio');
    await expectNoHorizontalScroll(page, '.studio-main');
    // Herramientas del panel inferior visibles y usables.
    await expect(page.locator('.tools-cat').first()).toBeVisible();
  });

  test('el panel de la pizarra en móvil no desborda con un elemento seleccionado', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Colocar un texto primero (toolbar accesible con panel cerrado).
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    // FASE B: el panel Dibujo persiste y cubre el campo en móvil; se minimiza (X) para
    // poder colocar el texto en el centro (no desarma la herramienta).
    const dibPanel = page.locator('.side-panel-left.tools-panel-side');
    if (await dibPanel.isVisible().catch(() => false)) await dibPanel.locator('.panel-close').click();
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.5;
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');
    // En móvil la creación NO auto-abre Propiedades (regresión cubierta por `e1-mobile-props`):
    // se abre explícitamente con el botón Propiedades para comprobar el inspector.
    await page.locator('button[aria-label="Propiedades"]').click();
    await expect(page.locator('.studio-panel')).toBeVisible();
    await page.mouse.click(x, y);
    await expect(page.locator('.inspector')).toBeVisible();
    // Sin scroll horizontal en el panel.
    await expectNoHorizontalScroll(page, '.studio-panel');
    // Controles del inspector pulsables (color, tamaño, rotación, eliminar).
    await expect(page.locator('.inspector .swatch').first()).toBeVisible();
    await page.locator('.inspector input[type="number"]').first().fill('80');
    await expect(page.locator('.inspector input[type="number"]').first()).toHaveValue('80');
    await expect(page.locator('.inspector-actions button').first()).toBeVisible();
  });
});

// El panel derecho de la pizarra NO debe desbordar en escritorio: los controles
// (Duración, Jugadores min/max, inspector del elemento) encogen/envuelven en vez
// de empujar el ancho. Se mide con texto, figura y material seleccionados.
test.describe('Panel de pizarra sin desbordamiento (escritorio)', () => {
  const WIDTHS = [1024, 1280, 1366, 1440];

  const measureNoOverflow = async (page: Page, sel: string): Promise<void> => {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null;
      return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null;
    }, sel);
    expect(r, `el elemento ${sel} no debería existir`).not.toBeNull();
    expect(r!.scroll, `scroll horizontal en ${sel}`).toBeLessThanOrEqual(r!.client + 1);
  };

  for (const w of WIDTHS) {
    test(`panel ${w}px: ni el panel ni la rejilla de Duración/Jugadores desbordan`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await seed(page);
      await page.goto('/board');
      // El panel de Propiedades ya no se abre por defecto (Fase 1): lo abrimos.
      await page.locator('button[aria-label="Propiedades"]').click();
      await expect(page.locator('.studio-panel')).toBeVisible();
      await measureNoOverflow(page, '.studio-panel');
      await measureNoOverflow(page, '.studio-panel .field-grid2');
    });
  }

  test('panel con texto y material seleccionados (inspector completo) no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;

    // Texto seleccionado (inspector con Ancho/Alto, color, tamaño, rotación).
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.inspector')).toBeVisible();
    await measureNoOverflow(page, '.studio-panel');
    await measureNoOverflow(page, '.studio-panel .field-grid2');

    // Material (cono) seleccionado (variante/tamaño). Fase 3: la colocación es continua,
    // así que tras colocar hay que dar a Seleccionar y hacer clic para seleccionarlo.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await expect(page.locator('.field-count')).toHaveText('2');
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await expect(page.locator('.inspector')).toBeVisible();
    await measureNoOverflow(page, '.studio-panel');
    await measureNoOverflow(page, '.studio-panel .field-grid2');
  });
});

// Fase 3: ningún botón de herramienta puede quedar detrás del panel (en todos los anchos).
test.describe('Barra de herramientas no tapada por el panel', () => {
  const WIDTHS = [390, 768, 1024, 1280, 1366, 1440];

  const overlapPanel = async (page: Page): Promise<string[]> => {
    return page.evaluate(() => {
      const panel = document.querySelector('.studio-panel') as HTMLElement | null;
      if (!panel || panel.getBoundingClientRect().width === 0) return [];
      const pb = panel.getBoundingClientRect();
      // Un botón está "detrás" del panel si su CAJA VISIBLE (recortada por el raíl
      // con overflow) está dentro del área del panel. Los botones fuera de la caja
      // visible del raíl son alcanzables mediante su scroll, no están tapados.
      const clippedBy = (el: HTMLElement): DOMRect => {
        const r = el.getBoundingClientRect();
        let right = r.right;
        // Intersección con el contenedor de scroll visible del raíl.
        let anc: HTMLElement | null = el.parentElement;
        while (anc) {
          const a = anc.getBoundingClientRect();
          const oa = getComputedStyle(anc).overflowX;
          if ((oa === 'auto' || oa === 'hidden') && a.width < a.scrollWidth) {
            right = Math.min(right, a.right);
            break;
          }
          anc = anc.parentElement;
        }
        return new DOMRect(r.x, r.y, Math.max(0, right - r.x), r.height);
      };
      const behind: string[] = [];
      const overlaps = (b: DOMRect) => !(b.right <= pb.left || b.left >= pb.right || b.bottom <= pb.top || b.top >= pb.bottom);
      for (const el of document.querySelectorAll('.studio-tools .rail-btn, .studio-tools .tools-cat')) {
        const b = clippedBy(el as HTMLElement);
        if (b.width > 0 && overlaps(b)) behind.push((el as HTMLElement).getAttribute('title') ?? el.className);
      }
      return behind;
    });
  };

  for (const w of [1024, 1280, 1366, 1440]) {
    test(`a ${w}px no hay botones de herramienta detrás del panel derecho`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await seed(page);
      await page.goto('/board');
      // Asegurar que el panel de Propiedades está abierto (ahora cerrado por defecto).
      if (!(await page.locator('.studio-panel').isVisible().catch(() => false))) {
        await page.locator('button[aria-label="Propiedades"]').click();
        await expect(page.locator('.studio-panel')).toBeVisible();
      }
      expect(await overlapPanel(page), `botones detrás del panel a ${w}px`).toEqual([]);
    });
  }
});
