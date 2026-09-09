import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fields';
fs.mkdirSync(SHOTS, { recursive: true });

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Abre el panel Propiedades (derecha), que empieza cerrado (Fase 1). */
async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

/** Devuelve los shapes (paths del campo) cuyo bbox es "gigante" (arcos mal escalados).
 *  Los arcos de esquina y de penalti deben ser pequeños; un arco doblemente escalado
 *  produce un bbox enorme. */
async function hugeShapes(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const bad: { tag: string; w: number; h: number; x: number; y: number }[] = [];
    for (const el of document.querySelectorAll('.board-canvas svg g[fill="none"] path')) {
      let b;
      try {
        b = (el as SVGGraphicsElement).getBBox();
      } catch {
        continue;
      }
      if (b.width > 30 || b.height > 30) bad.push({ tag: el.tagName, w: b.width, h: b.height, x: b.x, y: b.y });
    }
    return bad;
  });
}

test.describe('Campos (geometría y evidencia visual)', () => {
  test('captura las 6 combinaciones y ningún arco de campo es gigante', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    const fields = ['full', 'half', 'blank'] as const;
    // Decisión del dueño: la orientación se elige/verifica por valor estable (data-orient),
    // no por el texto visible (que ahora describe el RESULTADO y depende del campo).
    for (const orient of ['horizontal', 'vertical'] as const) {
      for (const field of fields) {
        await page.goto('/board');
        await openProps(page);
        await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator(`.chip[data-orient="${orient}"]`).click();
        await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption(field);
        await page.waitForTimeout(250);
        const name = `${orient}-${field}`;
        await page.screenshot({ path: `${SHOTS}/${name}.png` });
        // Comprobación geométrica real: ningún arco gigante (evita el doble escalado de esquinas).
        expect(await hugeShapes(page), `arco gigante en ${orient} / ${field}`).toEqual([]);
      }
    }
  });

  test('los arcos de penalti del medio campo sobresalen hacia el centro, no hacia el área', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    // Seleccionar el medio campo lo pone en vertical por defecto; pasamos a horizontal
    // para medir el arco del área (pendiente) en el eje X.
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('half');
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="horizontal"]').click();
    await page.waitForTimeout(250);

    // El medio campo 52,5×68 se dibuja en el rect canónico {4,4,46,59.58}; el borde lejano
    // del área grande desde la portería (l=16,5/52,5) está en x = 4 + (16,5/52,5)*46.
    const boxEdgeX = 4 + (16.5 / 52.5) * 46;
    const arcs = await page.evaluate(() => {
      return [...document.querySelectorAll('.board-canvas path')]
        .filter((p) => (p.getAttribute('d') ?? '').includes('A'))
        .map((p) => {
          const L = p.getTotalLength();
          return { startX: p.getPointAtLength(0).x, midX: p.getPointAtLength(L / 2).x };
        });
    });
    const penalty = arcs.find((a) => Math.abs(a.startX - boxEdgeX) < 6);
    expect(penalty).toBeDefined();
    // El arco sobresale hacia el CENTRO del campo (hacia x mayor, a la derecha).
    expect(penalty!.midX).toBeGreaterThan(boxEdgeX);
  });

  test('campo base F7: plantilla compuesta activable desde el selector, sin toggle overlay', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);

    // El toggle overlay "F7" en Ayudas ya NO existe: el F7 es ahora una plantilla base.
    await expect(page.locator('.studio-panel .field', { hasText: 'Ayudas' }).locator('.chip', { hasText: 'F7' })).toHaveCount(0);

    // El campo base F7 se elige desde el selector y dibuja la plantilla compuesta
    // (medio campo F11 + F7 perpendicular): aparece la portería del F11 y el rect del F7.
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('f7');
    await page.waitForTimeout(250);
    await expect(page.locator('.board-canvas svg').first()).toBeVisible();
    const svg = await page.locator('.board-canvas svg').first().innerHTML();
    // FASE 4/8b: el F7 usa el medio campo F11 APISAADO (68 m en X, 52,5 m en Y → 46 de alto).
    expect(svg).toContain('height="46"'); // medio campo F11 apaisado (52,5 m en Y)
    expect(svg).toContain('rgba(255,255,255,0.25)'); // portería del medio campo F11

    // Guardar → reabrir → el campo compuesto se conserva y se vuelve a dibujar.
    // A5: el título es obligatorio; se escribe antes de guardar.
    await openProps(page);
    await page.locator('.studio-panel input[aria-label="Título del ejercicio"]').fill('F7 compuesto');
    await page.locator('[title="Guardar ejercicio"]').click();
    await page.waitForURL('**/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await openProps(page);
    await expect(page.locator('.board-canvas svg').first()).toBeVisible();
    const svg2 = await page.locator('.board-canvas svg').first().innerHTML();
    // FASE 4/8b: al reabrir se mantiene el F7 apaisado sobre el MEDIO campo F11 (46 de alto).
    expect(svg2).toContain('height="46"');
    expect(svg2).toContain('rgba(255,255,255,0.25)');
    // Al reabrir tampoco aparece el toggle overlay.
    await expect(page.locator('.studio-panel .field', { hasText: 'Ayudas' }).locator('.chip', { hasText: 'F7' })).toHaveCount(0);
  });

  test('"Sin líneas" (blank) no dibuja ni marcas ni puntos de ajuste', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('blank');
    await page.waitForTimeout(200);
    // La capa de puntos de ajuste (snapDots) fue RETIRADA por decisión del dueño.
    // En un lienzo "blank" (sin líneas) no hay marcas reglamentarias ni snap dots,
    // así que NO debe haber ningún círculo.
    const circles = await page.evaluate(() => document.querySelectorAll('.board-canvas circle').length);
    expect(circles).toBe(0);
  });

  test('no existe la opción "Rejilla" y en un campo real solo quedan las marcas reglamentarias', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    // La cuadrícula "Rejilla" fue retirada por decisión del dueño: no debe haber control.
    await expect(page.locator('.studio-panel .chip', { hasText: 'Rejilla' })).toHaveCount(0);
    // En un campo completo real solo permanecen las marcas reglamentarias: los 2 puntos
    // de penalti (r=0.35) y el círculo central. NO los puntos de ajuste/snap que antes se
    // dibujaban con la cuadrícula activada o por defecto.
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('full');
    await page.waitForTimeout(200);
    const circleCount = await page.evaluate(() => document.querySelectorAll('.board-canvas circle').length);
    // El campo completo dibuja exactamente los 2 puntos de penalti (los extrados del
    // punto central los dibuja el círculo central, que es una <ellipse>). Con snapDots
    // retirado no hay puntos de ajuste (esquinas/lados/centro) añadidos.
    expect(circleCount).toBe(2);
  });

  test('campo completo vertical: porterías arriba y abajo y círculo central circular (no lateral)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('full');
    await page.waitForTimeout(250);

    const res = await page.evaluate(() => {
      const svg = document.querySelector('.board-canvas svg')!;
      const boxOf = (el: Element) => {
        const b = el.getBoundingClientRect(); // incluye la rotación del grupo en vertical
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const goals: { x: number; y: number; w: number; h: number }[] = [];
      let pitch: { x: number; y: number; w: number; h: number } | null = null;
      for (const el of svg.querySelectorAll('rect')) {
        if ((el.getAttribute('fill') ?? '') === 'rgba(255,255,255,0.25)') {
          goals.push(boxOf(el));
        } else if (el.getAttribute('stroke') !== 'none' && !el.closest('.entrenolab-strip')) {
          // FASE 2: ignorar el rect de la franja exterior (stroke=none / .entrenolab-strip)
          // para que el "pitch" sea el rect del terreno reglamentario, no la franja.
          const bb = boxOf(el);
          if (!pitch || bb.w * bb.h > pitch.w * pitch.h) pitch = bb;
        }
      }
      const c = [...svg.querySelectorAll('ellipse')].map((e) => boxOf(e));
      return { goals, pitch, center: c.find((e) => e.w > 0) };
    });

    // Dos porterías: una se extiende por encima del borde superior del campo y otra por debajo del inferior.
    expect(res.goals.length).toBe(2);
    const top = res.goals.some((g) => g.y < res.pitch!.y);
    const bottom = res.goals.some((g) => g.y + g.h > res.pitch!.y + res.pitch!.h);
    expect(top).toBe(true);
    expect(bottom).toBe(true);
    // El círculo central es visualmente circular (no deformado en uno de los ejes).
    expect(res.center).toBeDefined();
    expect(Math.abs(res.center!.w - res.center!.h)).toBeLessThan(1);
  });

  test('FASE 3: la galería visual de campos muestra tarjetas con miniatura REAL, estado seleccionado y es navegable', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    // La galería existe con varias tarjetas.
    const gallery = page.locator('.field-gallery');
    await expect(gallery).toBeVisible();
    const cards = gallery.locator('.field-card');
    const count = await cards.count();
    // Al menos los campos base requeridos (incluye F7 y lienzo).
    expect(count, 'la galería muestra todos los campos base').toBeGreaterThanOrEqual(5);
    // Cada tarjeta tiene una miniatura REAL (SVG del renderizador) y un nombre.
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i).locator('.field-card-thumb .field-preview-svg')).toHaveCount(1);
      await expect(cards.nth(i).locator('.field-card-name')).toBeVisible();
    }
    // Estado seleccionado: el campo por defecto (full) está activo.
    await expect(gallery.locator('.field-card-active')).toHaveCount(1);
    // Hacer clic en la tarjeta "Medio campo" cambia el campo activo y actualiza la señal.
    const half = cards.filter({ hasText: 'Medio campo' }).first();
    await half.click();
    await expect(half).toHaveClass(/field-card-active/);
    await expect(page.locator('.board-canvas svg')).toBeVisible();
    // La selección es NAVEGABLE por teclado: foco en la galería y Tab activa la primera
    // tarjeta; Enter la selecciona.
    await gallery.focus();
    await page.keyboard.press('Tab');
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(cards.first()).toHaveClass(/field-card-active/);
    // Captura de la galería para la revisión visual.
    await page.locator('.studio-panel').screenshot({ path: `${SHOTS}/galeria-campos.png` });
  });
});
