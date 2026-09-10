// =============================================================
// FASE H — Selección, asas, resize, rotación, menú contextual,
//          Cursor/Mano, zoom y papelera.
//
// DEFECTOS 4 y 5 corregidos: se EJECUTAN de verdad la selección, las asas,
// el resize con cambio de geometría, la rotación exacta ±45/±90, el menú
// contextual (doble clic y pulsación larga), Cursor vs Mano, zoom y el
// borrado por papelera con undo/redo.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { longPress } from './gesture-helpers';
import { seedBoard, openBoard, hostBox, fitMode, fieldCount, normToScreen, showCategory, hideOverlays } from './board-helpers';

/** Selecciona en un punto (pulsación larga: abre el menú contextual). */
async function selectAt(page: Page, nx: number, ny: number): Promise<void> {
  const host = await hostBox(page); const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await longPress(page, p.x, p.y);
  await expect(page.locator('.context-bar')).toBeVisible();
}
async function firstRot(page: Page): Promise<number> {
  return page.locator('.board-canvas svg').evaluate((svg) => {
    const g = svg.querySelector('g[transform*="rotate("]');
    if (!g) return 0;
    const m = /rotate\((-?[\d.]+)/.exec(g.getAttribute('transform') ?? '');
    return m ? parseFloat(m[1]) : 0;
  });
}
const norm360 = (r: number) => ((r % 360) + 360) % 360;
async function readView(page: Page): Promise<{ panX: number; panY: number; zoom: number }> {
  return page.locator('.board-canvas').evaluate((el) => {
    const t = (el as HTMLElement).style.transform;
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
    return m ? { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { panX: 0, panY: 0, zoom: 1 };
  });
}
async function placeMaterial(page: Page, title: string, nx: number, ny: number): Promise<void> {
  await showCategory(page, 'Material');
  await page.locator(`.rail-btn[title="${title}"]`).click();
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
  const host = await hostBox(page); const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
}
async function drawShape(page: Page, title: string, from: [number, number], to: [number, number]): Promise<void> {
  await showCategory(page, 'Dibujo');
  await page.locator(`.rail-btn[title="${title}"]`).click();
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
  const host = await hostBox(page); const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], host, fit);
  const b = normToScreen(to[0], to[1], host, fit);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
}

test.describe('FASE H — selección, asas, resize y rotación', () => {
  test('material: se selecciona y NO muestra asas de resize; jugador: muestra sus asas', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await hideOverlays(page);

    await placeMaterial(page, 'Cono', 0.35, 0.5);
    await selectAt(page, 0.35, 0.5);
    await hideOverlays(page);
    await expect(page.locator('.board-canvas svg .reshandle'), 'material puntual: 0 asas').toHaveCount(0);
    await page.keyboard.press('Escape');

    // Jugador genérico: sí tiene asas (4 esquinas).
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    const close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    const host = await hostBox(page); const fit = await fitMode(page);
    const p = normToScreen(0.65, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await selectAt(page, 0.65, 0.5);
    await hideOverlays(page);
    await expect(page.locator('.board-canvas svg .reshandle'), 'jugador: 4 asas').toHaveCount(4);
  });

  test('línea: mover un extremo cambia su geometría', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await drawShape(page, 'Línea', [0.25, 0.4], [0.6, 0.4]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    const lineSel = '.board-canvas svg line[stroke="#1f2933"]';
    const before = await page.locator(lineSel).first().evaluate((el) => ({
      x1: parseFloat(el.getAttribute('x1') ?? '0'), x2: parseFloat(el.getAttribute('x2') ?? '0'),
      y1: parseFloat(el.getAttribute('y1') ?? '0'), y2: parseFloat(el.getAttribute('y2') ?? '0'),
    }));
    await selectAt(page, 0.425, 0.4);
    await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(2);
    await hideOverlays(page);
    // Arrastrar el extremo derecho (0.6,0.4) → (0.8,0.6).
    const host = await hostBox(page); const fit = await fitMode(page);
    const from = normToScreen(0.6, 0.4, host, fit);
    const to = normToScreen(0.8, 0.6, host, fit);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await page.locator(lineSel).first().evaluate((el) => parseFloat(el.getAttribute('x2') ?? '0'))), { timeout: 4000 }).toBeGreaterThan(before.x2 + 2);
  });

  test('rectángulo y elipse: redimensionar cambia la geometría', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);

    // Rectángulo.
    await drawShape(page, 'Rectángulo', [0.2, 0.3], [0.4, 0.5]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    const rectSel = '.board-canvas svg [data-el-type="rect"] rect';
    const rb = await page.locator(rectSel).first().evaluate((el) => ({ w: parseFloat(el.getAttribute('width') ?? '0'), h: parseFloat(el.getAttribute('height') ?? '0') }));
    await selectAt(page, 0.3, 0.4);
    await expect(page.locator('.board-canvas svg .reshandle')).toHaveCount(4);
    await hideOverlays(page);
    let host = await hostBox(page); let fit = await fitMode(page);
    let from = normToScreen(0.4, 0.5, host, fit);
    let to = normToScreen(0.55, 0.63, host, fit);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => (await page.locator(rectSel).first().evaluate((el) => parseFloat(el.getAttribute('width') ?? '0'))), { timeout: 4000 }).toBeGreaterThan(rb.w + 1);
    await page.keyboard.press('Escape');

    // Elipse en OTRA zona (el rectángulo sigue en la pizarra).
    await drawShape(page, 'Círculo / elipse', [0.6, 0.3], [0.8, 0.5]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(2);
    const elSel = '.board-canvas svg [data-el-type="ellipse"] ellipse';
    const eb = await page.locator(elSel).first().evaluate((el) => ({ rx: parseFloat(el.getAttribute('rx') ?? '0') }));
    await selectAt(page, 0.7, 0.4);
    await hideOverlays(page);
    host = await hostBox(page); fit = await fitMode(page);
    from = normToScreen(0.8, 0.5, host, fit);
    to = normToScreen(0.92, 0.62, host, fit);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => (await page.locator(elSel).first().evaluate((el) => parseFloat(el.getAttribute('rx') ?? '0'))), { timeout: 4000 }).toBeGreaterThan(eb.rx + 0.5);
  });

  test('rotación exacta: +45, −45, +90, −90', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await drawShape(page, 'Rectángulo', [0.3, 0.35], [0.5, 0.55]);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await selectAt(page, 0.4, 0.45);
    await page.locator('.context-bar [aria-label="Girar 45° a la derecha"]').click();
    await expect.poll(() => firstRot(page), { timeout: 4000 }).toBeCloseTo(45, 0);

    await selectAt(page, 0.4, 0.45);
    await page.locator('.context-bar [aria-label="Girar 45° a la izquierda"]').click();
    await expect.poll(async () => norm360(await firstRot(page)), { timeout: 4000 }).toBeCloseTo(0, 0);

    await selectAt(page, 0.4, 0.45);
    await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
    await expect.poll(() => firstRot(page), { timeout: 4000 }).toBeCloseTo(90, 0);

    await selectAt(page, 0.4, 0.45);
    await page.locator('.context-bar [aria-label="Girar 90° a la izquierda"]').click();
    await expect.poll(async () => norm360(await firstRot(page)), { timeout: 4000 }).toBeCloseTo(0, 0);
  });

  test('menú contextual: doble clic de ratón y pulsación larga ofrecen rotar/duplicar/eliminar', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await placeMaterial(page, 'Cono', 0.5, 0.5);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    const host = await hostBox(page); const fit = await fitMode(page);
    const p = normToScreen(0.5, 0.5, host, fit);

    // Doble clic de ratón abre el menú contextual.
    await page.mouse.dblclick(p.x, p.y, { delay: 40 });
    await expect(page.locator('.context-bar')).toBeVisible();
    for (const label of ['Girar 45° a la izquierda', 'Girar 45° a la derecha', 'Girar 90° a la izquierda', 'Girar 90° a la derecha', 'Duplicar', 'Eliminar']) {
      await expect(page.locator(`.context-bar [aria-label="${label}"]`), `ofrece ${label}`).toBeVisible();
    }
    await expect(page.locator('.field-count'), 'el doble clic no duplica').toHaveText('1');
    await page.keyboard.press('Escape');

    // Pulsación larga abre el mismo menú.
    await longPress(page, p.x, p.y);
    await expect(page.locator('.context-bar')).toBeVisible();
    await expect(page.locator('.context-bar [aria-label="Duplicar"]')).toBeVisible();
    await page.locator('.context-bar [aria-label="Eliminar"]').click();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
  });
});

test.describe('FASE H — Cursor/Mano, zoom y papelera', () => {
  test('Cursor sobre vacío NO desplaza; Mano SÍ desplaza el campo', async ({ page }) => {
    test.setTimeout(120_000);
    // Móvil (Llenar pantalla): el campo DESBORDA el ancho → existe rango de paneo.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedBoard(page); await openBoard(page);
    expect(await fitMode(page)).toBe('height');
    const host = await hostBox(page);
    const cx = host.x + host.width / 2; const cy = host.y + host.height / 2;

    // Cursor: arrastre sobre vacío → la vista NO cambia.
    const v0 = await readView(page);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + 90, cy + 40, { steps: 6 }); await page.mouse.up();
    const v1 = await readView(page);
    expect(Math.abs(v1.panX - v0.panX), 'Cursor no panea').toBeLessThan(2);
    expect(Math.abs(v1.panY - v0.panY), 'Cursor no panea').toBeLessThan(2);

    // Mano: el mismo arrastre SÍ panea.
    await page.locator('.rail-btn[title="Desplazar campo"]').click();
    await expect(page.locator('.board-host')).toHaveClass(/cursor-grab/);
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + 90, cy + 40, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => Math.abs((await readView(page)).panX - v0.panX), { timeout: 4000 }).toBeGreaterThan(5);
  });

  test('Cursor mueve un objeto sin desplazar; Mano sobre el objeto desplaza sin moverlo', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedBoard(page); await openBoard(page);
    // Jugador genérico (círculo) colocado con el panel.
    await showCategory(page, 'Jugadores');
    await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
    const close = page.locator('.side-panel-left .panel-close');
    if (await close.isVisible().catch(() => false)) await close.first().click();
    let host = await hostBox(page); let fit = await fitMode(page);
    let p = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();

    const objNorm = (pg: Page) => pg.locator('.entrenolab-board circle[r="2.5"]').first().evaluate((el) => {
      const g = el.closest('g'); const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)/.exec(g?.getAttribute('transform') ?? '');
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
    });
    host = await hostBox(page); fit = await fitMode(page);
    p = normToScreen(0.5, 0.5, host, fit);
    const before = await objNorm(page);
    const v0 = await readView(page);

    // Cursor: arrastrar el jugador → el objeto se mueve y la vista NO.
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 20, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => Math.abs((await objNorm(page)).x - before.x), { timeout: 4000 }).toBeGreaterThan(0.02);
    const v1 = await readView(page);
    expect(Math.abs(v1.panX - v0.panX), 'Cursor mueve el objeto sin panear').toBeLessThan(2);

    // Mano: arrastrar SOBRE el objeto → panea y NO mueve el objeto.
    const before2 = await objNorm(page);
    const moved = await page.locator('.entrenolab-board circle[r="2.5"]').first().boundingBox();
    await page.locator('.rail-btn[title="Desplazar campo"]').click();
    await page.mouse.move(moved!.x + moved!.width / 2, moved!.y + moved!.height / 2);
    await page.mouse.down();
    await page.mouse.move(moved!.x + moved!.width / 2 + 60, moved!.y + moved!.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await readView(page)).panX - v1.panX), { timeout: 4000 }).toBeGreaterThan(5);
    const after2 = await objNorm(page);
    expect(Math.abs(after2.x - before2.x), 'la Mano NO mueve el objeto').toBeLessThan(0.005);
  });

  test('pinch de dos dedos modifica el zoom', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await seedBoard(page); await openBoard(page);
    const host = await hostBox(page);
    const cx = host.x + host.width / 2; const cy = host.y + host.height / 2;
    const before = await readView(page);
    // Dos dedos simétricos que se separan.
    const ptr = async (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, id: number, primary: boolean) => {
      await page.evaluate(({ type, x, y, id, primary }) => {
        const h = document.querySelector('.board-host') as HTMLElement | null;
        h?.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: primary, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
      }, { type, x, y, id, primary });
    };
    await ptr('pointerdown', cx - 60, cy, 101, true);
    await ptr('pointerdown', cx + 60, cy, 102, false);
    for (const s of [80, 120, 160, 200]) {
      await ptr('pointermove', cx - s / 2, cy, 101, true);
      await ptr('pointermove', cx + s / 2, cy, 102, false);
    }
    await ptr('pointerup', cx - 100, cy, 101, true);
    await ptr('pointerup', cx + 100, cy, 102, false);
    await expect.poll(async () => (await readView(page)).zoom, { timeout: 4000 }).toBeGreaterThan(before.zoom);
  });

  test('arrastrar a la papelera elimina; undo restaura y redo vuelve a eliminar', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page); await openBoard(page);
    await placeMaterial(page, 'Cono', 0.5, 0.5);
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const host = await hostBox(page); const fit = await fitMode(page);
    const c = normToScreen(0.5, 0.5, host, fit);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    // La papelera aparece al empezar a mover; el objeto llega VISUALMENTE a ella.
    await page.mouse.move(c.x + 20, c.y + 20, { steps: 3 });
    await expect(page.locator('.board-trash.trash-visible'), 'la papelera aparece al arrastrar').toBeVisible();
    const trash = (await page.locator('.board-trash').boundingBox())!;
    const tx = trash.x + trash.width / 2; const ty = trash.y + trash.height / 2;
    await page.mouse.move(tx, ty, { steps: 8 });
    await expect(page.locator('.board-trash.trash-hot'), 'el objeto llega sobre la papelera').toBeVisible();
    await page.mouse.up();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);

    // Undo lo restaura; redo lo vuelve a eliminar.
    await page.keyboard.press('Control+z');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
    await page.keyboard.press('Control+y');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
  });
});
