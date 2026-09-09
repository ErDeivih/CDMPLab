import { test, expect, Page } from '@playwright/test';
import { longPress, fillBoardTitle } from './gesture-helpers';

const SHOTS = 'e2e/shots';

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    const players = [
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ];
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Replica el letterboxing del canvas (horizontal) para mapear norm (0..1) → pantalla. */
function normToScreen(nx: number, ny: number, box: { x: number; y: number; width: number; height: number }): [number, number] {
  const rect = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
  const s = Math.min(box.width / 100, box.height / 80);
  const offX = (box.width - 100 * s) / 2;
  const offY = (box.height - 80 * s) / 2;
  return [box.x + offX + (nx * rect.w + rect.x) * s, box.y + offY + (ny * rect.h + rect.y) * s];
}

test.describe('Fase 3 — texto usable', () => {
  test('crea un texto con tamaño/caja legibles y edita INMEDIATAMENTE (editor enfocado)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...normToScreen(0.3, 0.3, box), { button: 'right' });
    await expect(page.locator('.field-count')).toHaveText('1');
    // El texto queda seleccionado y el editor visible + enfocado.
    const ta = page.locator('.studio-panel .inspector textarea');
    await expect(ta).toBeVisible();
    await expect(ta).toBeFocused();
  });

  test('los valores por defecto del texto son legibles (no un tamaño gigante que desborda)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...normToScreen(0.3, 0.3, box), { button: 'right' });
    // "Texto" cabe en UNA línea dentro del cuadro por defecto.
    const tsps = await page.evaluate(() => document.querySelectorAll('.board-canvas svg tspan').length);
    expect(tsps).toBe(1);
    // El tamaño y la caja no son los antiguos (size 4 / w 0.2 / h 0.09).
    await fillBoardTitle(page, 'Texto3');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const t = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return ex.canvas.frames[0].elements[0];
    });
    expect(t.size).toBeLessThan(4);
    expect(t.w).toBeGreaterThan(0.2);
  });

  test('la edición del texto se refleja EN VIVO (cada tecla, sin blur)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...normToScreen(0.3, 0.3, box));
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Rondos');
    // El contenido aparece al instante en el SVG del campo (sin necesidad de blur).
    await expect(page.locator('.board-canvas svg')).toContainText('Rondos');
  });

  test('admite varias líneas y las ajusta (wrap) dentro del cuadro sin desbordar', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...normToScreen(0.3, 0.3, box));
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Rondos de pase y recepción');
    await ta.dispatchEvent('change');
    // Se generó más de una línea (tspan) y el clipPath recorta el desbordamiento.
    const tsps = await page.evaluate(() => document.querySelectorAll('.board-canvas svg tspan').length);
    expect(tsps).toBeGreaterThan(1);
    const html = await page.locator('.board-canvas svg').innerHTML();
    expect(html).toContain('clipPath');
    expect(html).toContain('Rondos');
    expect(html).toContain('recepción');
  });

  test('preserva color, tamaño, rotación y opacidad al editar el texto', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...normToScreen(0.4, 0.4, box));
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Título');

    // Color (rojo → PALETTE[1]).
    const col = page.locator('.inspector .field', { hasText: 'Color' }).locator('.swatch').nth(1);
    await col.click();
    await expect(col).toHaveClass(/swatch-active/);

    // Tamaño.
    const size = page.locator('.inspector .field', { hasText: 'Tamaño' }).locator('input');
    await size.fill('2');
    await size.dispatchEvent('change');

    // Rotación (±90° desde el MENÚ CONTEXTUAL — Fase 3: se abre con pulsación larga).
    // Pulsamos en el CENTRO del cuerpo del texto (no en el ancla, que es el asa de redimensionado).
    await longPress(page, ...normToScreen(0.55, 0.47, box));
    const ctxRot = page.locator('.context-bar [aria-label="Girar 90° a la derecha"]');
    await expect(ctxRot).toBeVisible();
    await ctxRot.click();

    // Opacidad.
    const op = page.locator('.inspector .field', { hasText: 'Opacidad' }).locator('input[type="range"]');
    await op.fill('0.6');
    await op.dispatchEvent('change');

    // Editar el texto (input en vivo) → se conservan las propiedades.
    await ta.fill('Título editado');
    await expect(page.locator('.board-canvas svg')).toContainText('Título editado');

    // Guardar → reabrir → persisten v + rot + size + opacity + color.
    await fillBoardTitle(page, 'Texto3');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const t = await page.evaluate(() => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      return ex.canvas.frames[0].elements.find((e: { t: string }) => e.t === 'text');
    });
    expect(t.v).toBe('Título editado');
    expect(t.rot).toBe(90); // un paso EXACTO de +90° (barra de contexto)
    expect(t.size).toBe(2);
    expect(t.opacity).toBeCloseTo(0.6, 2);
    expect(t.c).toBe('#c0392b');
  });

  test('persiste de forma idéntica al guardar y reabrir (v + caja + tamaño)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...normToScreen(0.5, 0.5, box), { button: 'right' });
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Marca');
    await ta.dispatchEvent('change');
    await fillBoardTitle(page, 'Texto3');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');

    // Reabrir desde la tarjeta.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('1');
    expect(await page.locator('.board-canvas svg').innerHTML()).toContain('Marca');
  });

  test('capturas: texto corto, largo y multilínea (seleccionado y no seleccionado)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const place = async (v: string, fx: number, fy: number) => {
      // FASE B: el catálogo Dibujo persiste abierto; solo se abre si no lo está.
      if (!(await page.locator('.rail-btn[title="Texto"]').isVisible().catch(() => false))) {
        await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
      }
      await page.locator('.rail-btn[title="Texto"]').click();
      await page.mouse.click(...normToScreen(fx, fy, box), { button: 'right' });
      const ta = page.locator('.studio-panel .inspector textarea');
      await ta.fill(v);
      await ta.dispatchEvent('change');
      await page.waitForTimeout(120);
    };
    await place('Corto', 0.18, 0.18);
    await place('Un texto bastante largo que debería ajustarse dentro del cuadro sin desbordar', 0.62, 0.18);
    await place('Rondos 4v2\nConservación\nPase en superioridad', 0.35, 0.55);
    await expect(page.locator('.field-count')).toHaveText('3');

    // Deseleccionar (clic en zona vacía) y cerrar paneles → captura NO seleccionada.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(...normToScreen(0.9, 0.9, box));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/p3-text-unselected.png` });

    // Seleccionar el multilínea y capturar (seleccionado).
    await page.mouse.click(...normToScreen(0.35, 0.55, box));
    await page.waitForTimeout(200);
    await expect(page.locator('.inspector')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p3-text-multiline-selected.png` });
  });

  test('captura móvil (390×844): texto corto, largo y multilínea', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    // Pre-sembrar un documento con los tres textos (corto, largo y multilínea)
    // para una captura determinista de cómo se renderiza el texto en móvil.
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const mk = (id: string, v: string, x: number, y: number) => ({ id, t: 'text', x, y, v, size: 3, w: 0.3, h: 0.14 });
      localStorage.setItem(
        'entrenolab:exercises',
        JSON.stringify([
          {
            id: 'x', teamId: 't1', folderId: null, title: 'Textos', description: '', explanation: '',
            category: 'Técnica', objectives: [], materials: [], durationMinutes: 0, minPlayers: null, maxPlayers: null,
            loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null,
            isTemplate: false,
            canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [
              mk('a', 'Corto', 0.12, 0.16),
              mk('b', 'Un texto bastante largo que debería ajustarse dentro del cuadro sin desbordar', 0.12, 0.42),
              mk('c', 'Rondos 4v2\nConservación\nPase en superioridad', 0.12, 0.68),
            ] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' },
            thumbnail: null, savedAt: now,
          },
        ])
      );
    });
    await page.goto('/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('3');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/p3-text-movil.png` });
  });

  test('el inspector del texto muestra porcentajes (una decimal) y la acción "Ajustar al contenido"', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...normToScreen(0.3, 0.3, box));
    const ta = page.locator('.studio-panel .inspector textarea');
    await ta.fill('Corto');
    await ta.dispatchEvent('change');
    await page.waitForTimeout(120);

    const ancho = page.locator('.studio-panel .inspector .field', { hasText: 'Ancho' }).locator('input');
    const alto = page.locator('.studio-panel .inspector .field', { hasText: 'Alto' }).locator('input');
    // El ancho por defecto 0.3 se muestra como "30" (%), nunca "0,3".
    await expect(ancho).toHaveValue('30');
    const altoVal = (await alto.inputValue()).replace(',', '.');
    const altoNum = Number(altoVal);
    expect(altoNum).toBeGreaterThan(0);
    expect(altoNum).toBeLessThanOrEqual(100);
    expect((altoVal.split('.')[1]?.length ?? 0)).toBeLessThanOrEqual(1);

    // Unidades visibles en Tamaño. DECISIÓN DEL DUEÑO (Fase 6): el control numérico
    // "Rotación (°)" del inspector fue retirado (la rotación es ±90° desde la barra
    // de contexto), así que NO debe estar visible.
    await expect(page.locator('.studio-panel .inspector .field', { hasText: 'Tamaño (u.)' })).toBeVisible();
    await expect(page.locator('.studio-panel .inspector .field', { hasText: 'Rotación (°)' })).toHaveCount(0);
    // Fase 3: el menú contextual se abre con pulsación larga (en el centro del cuerpo del texto).
    await longPress(page, ...normToScreen(0.45, 0.37, box));
    await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toBeVisible();

    // Acción "Ajustar al contenido": encoge el cuadro al texto y reactiva autoH.
    const fitBtn = page.locator('.inspector-actions button', { hasText: 'Ajustar al contenido' });
    await expect(fitBtn).toBeVisible();
    await fitBtn.click();
    await page.waitForTimeout(100);
    const anchoAjustado = Number((await ancho.inputValue()).replace(',', '.'));
    expect(anchoAjustado).toBeLessThan(30); // "Corto" ocupa mucho menos del 30 % por defecto
    const dec = (await ancho.inputValue()).split('.')[1]?.length ?? 0;
    expect(dec).toBeLessThanOrEqual(1); // nunca más de una decimal
  });
});
