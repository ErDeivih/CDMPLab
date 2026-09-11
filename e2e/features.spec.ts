import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { longPress, fillBoardTitle } from './gesture-helpers';

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
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

async function createTask(page: Page, title: string): Promise<void> {
  await page.getByText('Crear ejercicio').first().click();
  await page.locator('.modal input[name="title"]').fill(title);
  await page.getByText('Guardar').click();}

/** FASE B (paneles persistentes): abre la categoría sin re-togglear una que ya está
 *  desplegada (re-clickar la misma la cerraría). Distingue Jugadores de Material/Dibujo
 *  por el aria-label del panel para no confundir categorías. */
async function openCat(page: Page, category: string): Promise<void> {
  const probe: Record<string, string> = {
    Jugadores: '.side-panel-left[aria-label="Jugadores"]',
    Material: '.side-panel-left[aria-label="Herramientas de Material"]',
    Dibujo: '.side-panel-left[aria-label="Herramientas de Dibujo"]',
  };
  if (await page.locator(probe[category]).isVisible().catch(() => false)) return;
  await page.locator('.tools-cat', { hasText: category }).click();
  await expect(page.locator(probe[category])).toBeVisible();
}

/** Activa la categoría correcta y pulsa la herramienta por su título. */
async function useTool(page: Page, title: string): Promise<void> {
  const category: Record<string, string> = {
    'Jugador propio': 'Jugadores',
    'Jugador rival': 'Jugadores',
    'Cono': 'Material',
    'Balón': 'Material',
    'Maniquí individual': 'Material',
    'Miniportería': 'Material',
    'Pértiga / poste': 'Material',
    'BOSU': 'Material',
    'Conducción (zigzag)': 'Dibujo',
    'Línea': 'Dibujo',
    'Flecha (movimiento)': 'Dibujo',
    'Flecha doble sentido': 'Dibujo',
    'Curva derecha': 'Dibujo',
    'Dibujo a mano alzada': 'Dibujo',
    'Rectángulo': 'Dibujo',
    'Círculo / elipse': 'Dibujo',
    'Texto': 'Dibujo',
  };
  const tab = category[title];
  if (tab) {
    await openCat(page, tab);
  }
  if (title === 'Jugador propio' || title === 'Jugador rival') {
    // FASE C: se retiraron los botones "Jugador propio/rival"; el genérico se arma con
    // las fichas rápidas por COLOR (Propio = Azul, Rival = Rojo).
    const chip = title === 'Jugador propio' ? 'Azul' : 'Rojo';
    await page.locator(`.tray-player[title="Jugador ${chip}"]`).click();
    await closeCatalogPanelIfOpen(page);
    return;
  }
  await page.locator(`.rail-btn[title="${title}"]`).click();
  // FASE B: minimizar el catálogo tras elegir la herramienta para liberar el campo
  // (los arrastres/colocaciones en la zona izquierda quedan bajo el panel persistente).
  await closeCatalogPanelIfOpen(page);
}

/** Minimiza el catálogo lateral abierto (si lo hay) con su botón X: NO desarma la
 *  herramienta; deja el campo libre para dibujar/colocar. */
async function closeCatalogPanelIfOpen(page: Page): Promise<void> {
  const panel = page.locator('.side-panel');
  if (await panel.isVisible().catch(() => false)) {
    const close = panel.first().locator('.panel-close');
    if (await close.isVisible().catch(() => false)) await close.click();
  }
}

/** Abre el panel de Propiedades (derecha), que empieza cerrado (Fase 1). */
async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  // FASE G: el panel se espera con el `.toBeVisible()` siguiente (observable); sin wait fijo.
  await expect(page.locator('.studio-panel')).toBeVisible();
}

/**
 * DECISIÓN DEL DUEÑO (Fase 1): los inputs numéricos X/Y del panel Vista fueron
 * retirados (la Vista solo tiene el deslizador de Zoom). El desplazamiento (pan)
 * se hace ahora con la herramienta "Mano" (arrastre sobre el campo). Este helper lo
 * ejecuta: activa "Desplazar campo", arrastra la vista `dx`/`dy` px de pantalla y
 * vuelve a "Seleccionar y mover".
 */
async function panByDrag(page: Page, dx: number, dy: number): Promise<void> {
  await page.locator('.rail-btn[title="Desplazar campo"]').click();
  const host = (await page.locator('.board-host').boundingBox())!;
  const sx = host.x + host.width * 0.2;
  const sy = host.y + host.height * 0.5;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps: 6 });
  await page.mouse.up();
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  // FASE G: observable — la herramienta vuelve a "Seleccionar" (rail-active).
  await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
}

/** Abre el menú "Exportar" (unificado) y pulsa una de sus acciones por título. */
async function exportFromMenu(page: Page, title: string): Promise<void> {
  await page.locator('[aria-label="Exportar"]').click();
  await expect(page.locator('.top-pop-export')).toBeVisible();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

/** Abre el menú "Exportar" y entra en el diálogo de opciones (PNG avanzado). */
async function openExportDialog(page: Page): Promise<void> {
  await page.locator('button[aria-label="Exportar"]').click();
  await expect(page.locator('.top-pop-export')).toBeVisible();
  await page.locator('[title="Exportar con opciones (PNG)"]').click();
  await expect(page.locator('.export')).toBeVisible();
}

test.describe('EntrenoLab funcionalidades', () => {
  test('añade, edita y quita jugadores', async ({ page }) => {
    await seed(page);
    await page.goto('/team');
    await page.getByText('Añadir jugador').click();
    await page.locator('.modal input[name="name"]').fill('Eric');
    await page.locator('.modal input[name="number"]').fill('5');
    await page.getByText('Guardar').click();
    await expect(page.getByText('Eric')).toBeVisible();

    // Editar: cambiamos el nombre del último.
    await page.locator('[title="Editar"]').first().click();
    await page.locator('.modal input[name="name"]').fill('Eric García');
    await page.getByText('Guardar').click();
    await expect(page.getByText('Eric García')).toBeVisible();

    // Quitar con diálogo propio.
    const row = page.locator('tr', { hasText: 'Eric García' });
    await row.locator('[title="Quitar"]').click();
    await expect(page.locator('.confirm-actions .btn-danger-solid')).toBeVisible();
    await page.locator('.confirm-actions .btn-danger-solid').click();
    await expect(page.getByText('Eric García')).toHaveCount(0);
  });

  test('restaura el ejercicio completo al guardar y reabrir (orientación, guía)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    // Orientación vertical. (La "Rejilla" fue retirada por el dueño y ya no se guarda.)
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    // Un jugador (genérico): tocar el genérico ARMA la colocación. FASE B: el panel no se cierra.
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .tray-player[title="Jugador Azul"]').click();
    await expect(page.locator('.field-count')).toHaveText('0');
    const boxC = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(boxC.x + boxC.width * 0.5, boxC.y + boxC.height * 0.5, { button: 'right' });
    await expect(page.locator('.field-count')).toHaveText('1');

    // Guardar → biblioteca.
    await fillBoardTitle(page, 'OrientacionVertical');
    await page.locator('[title="Guardar ejercicio"]').click();
    await page.waitForURL('**/library');

    // Reabrir desde la tarjeta.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');

    // Se conserva el jugador y la orientación vertical.
    await expect(page.locator('.field-count')).toHaveText('1');
    await openProps(page);
    await expect(page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]')).toHaveClass(/chip-active/);
  });

  test('coloca y borra elementos en la pizarra', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height * 0.55;

    await useTool(page, 'Jugador propio');
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');

    await useTool(page, 'Balón');
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await expect(page.locator('.field-count')).toHaveText('2');

    // Borrar el primer elemento (mismo punto donde lo colocamos): seleccionar + Supr.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(x, y);
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('exporta PNG (validando el contenido del fichero)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');

    const pngDownload = page.waitForEvent('download');
    await exportFromMenu(page, 'Descargar PNG');
    const png = await pngDownload;
    const pngPath = await png.path();
    const pngBuf = fs.readFileSync(pngPath!);
    expect(png.suggestedFilename()).toContain('.png');
    expect(pngBuf.subarray(0, 4).toString('hex')).toBe('89504e47'); // firma PNG
    // Dimensiones reales (IHDR): horizontal 1600x1280.
    expect(pngBuf.readUInt32BE(16)).toBe(1600);
    expect(pngBuf.readUInt32BE(20)).toBe(1280);
    // Contenido: el píxel central debe ser césped (verde), no un lienzo vacío.
    const pixel = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(Math.floor(img.width * 0.35), Math.floor(img.height * 0.5), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    }, pngBuf.toString('base64'));
    expect(pixel.g).toBeGreaterThan(pixel.r);
    expect(pixel.g).toBeGreaterThan(pixel.b);
  });

  test('el PNG exportado sí incluye los materiales (conos PNG embebidos, no solo el campo)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;

    // Colocar un cono en el centro (material con PNG).
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(cx, cy);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Fase 3: la colocación continua NO auto-selecciona. Seleccionamos el cono (que ya está
    // en el centro) para que Delete lo borre.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(cx, cy);

    // Exportar (con cono).
    const dlA = page.waitForEvent('download');
    await exportFromMenu(page, 'Descargar PNG');
    const aBuf = fs.readFileSync((await (await dlA).path())!);

    // Borrar el cono → campo vacío.
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('0');

    // Exportar de nuevo (sin cono).
    const dlB = page.waitForEvent('download');
    await exportFromMenu(page, 'Descargar PNG');
    const bBuf = fs.readFileSync((await (await dlB).path())!);

    // Comparar la región alrededor del cono: el export CON cono debe diferir del vacío.
    const diff = await page.evaluate(async ({ a, b }) => {
      const load = (b64: string) => {
        return new Promise<HTMLCanvasElement>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            c.getContext('2d')!.drawImage(img, 0, 0);
            resolve(c);
          };
          img.src = 'data:image/png;base64,' + b64;
        });
      };
      const [ca, cb] = await Promise.all([load(a), load(b)]);
      const W = ca.width, H = ca.height;
      const sx = Math.round(((0.5 * 92 + 4) / 100) * W);
      const sy = Math.round(((0.5 * (92 / (105 / 68)) + 10) / 80) * H);
      const ctxA = ca.getContext('2d')!;
      const ctxB = cb.getContext('2d')!;
      let changed = 0;
      for (let dy = -60; dy <= 60; dy += 3) {
        for (let dx = -60; dx <= 60; dx += 3) {
          const pa = ctxA.getImageData(sx + dx, sy + dy, 1, 1).data;
          const pb = ctxB.getImageData(sx + dx, sy + dy, 1, 1).data;
          if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]) > 60) changed++;
        }
      }
      return { W, H, sx, sy, changed };
    }, { a: aBuf.toString('base64'), b: bBuf.toString('base64') });

    // El cono (icono PNG) debe estar presente en el export → región distinta del campo vacío.
    expect(diff.changed).toBeGreaterThan(0);
  });

  test('los menús de exportación no ofrecen GIF (solo PNG)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');

    // Menú "Exportar": solo PNG, sin fila GIF.
    await page.locator('button[aria-label="Exportar"]').click();
    await expect(page.locator('.top-pop-export')).toBeVisible();
    await expect(page.locator('.rail-btn[title="Exportar GIF animado"]')).toHaveCount(0);
    await expect(page.getByText('Exportar GIF animado', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/GIF \(activa la animación/)).toHaveCount(0);
    await expect(page.locator('[aria-label="Descargar PNG"]')).toBeVisible();
    await page.locator('.top-pop-export .panel-close').click();
    await expect(page.locator('.top-pop-export')).toHaveCount(0);

    // Diálogo de opciones: sin formato GIF ni velocidad de animación.
    await openExportDialog(page);
    await expect(page.getByText('GIF', { exact: true })).toHaveCount(0);
    await expect(page.locator('.export-opts .chip', { hasText: 'GIF' })).toHaveCount(0);
    await expect(page.getByText('Velocidad', { exact: true })).toHaveCount(0);
    await expect(page.locator('.export-foot .btn-primary')).toBeVisible();
  });

  test('crea carpeta anidada, mueve, duplica y elimina una tarea', async ({ page }) => {
    await seed(page);
    await page.goto('/library');
    // Crear carpeta raíz.
    await page.locator('.tree-add').click();
    await page.locator('.tree-inline input.folder-input').fill('Posesión');
    await page.locator('.tree-inline').getByText('Crear').click();
    await expect(page.locator('.tree-name', { hasText: 'Posesión' })).toBeVisible();

    // Crear ejercicio y moverla a la carpeta.
    await page.getByText('Crear ejercicio').first().click();
    await page.locator('.modal input[name="title"]').fill('Rondos');
    await page.getByText('Guardar').click();
    await expect(page.locator('.ex-card')).toHaveCount(1);

    // Mover mediante el menú "Más" de la tarjeta → carpeta 'Posesión'.
    await page.locator('.ex-card').first().locator('.ex-more-btn').click();
    await page.locator('[title="Mover a carpeta"]').first().click();
    await page.locator('.picker-item', { hasText: 'Posesión' }).click();
    await expect(page.locator('.ex-card')).toHaveCount(1);

    // Filtrar por carpeta (breadcrumb/migas).
    await page.locator('.tree-name', { hasText: 'Posesión' }).click();
    await expect(page.locator('.ex-card')).toHaveCount(1);

    // Duplicar.
    await page.locator('.ex-card').first().locator('.ex-more-btn').click();
    await page.locator('[title="Duplicar"]').first().click();
    await expect(page.locator('.ex-card')).toHaveCount(2);

    // Eliminar (con diálogo).
    await page.locator('.ex-card').first().locator('.ex-more-btn').click();
    await page.locator('[title="Eliminar"]').first().click();
    await page.locator('.confirm-actions .btn-danger-solid').click();
    await expect(page.locator('.ex-card')).toHaveCount(1);
  });

  test('edita el dorsal de un jugador seleccionado desde el inspector', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.45;
    const y = box.y + box.height * 0.55;

    await useTool(page, 'Jugador propio');
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Seleccionar → aparece el inspector.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(x, y);
    const dorsal = page.locator('.inspector input[type="number"]');
    await expect(dorsal).toBeVisible();

    await dorsal.fill('9');
    await dorsal.press('Tab');
    await expect(dorsal).toHaveValue('9');
  });

  test('coloca objetos (maniquí, portería, pértiga, marcador, rectángulo) y ajusta tamaño/rotación', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const point = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy];

    const objs: Array<[string, number, number]> = [
      ['Maniquí individual', 0.3, 0.4],
      ['Miniportería', 0.6, 0.4],
      ['Pértiga / poste', 0.3, 0.6],
      ['BOSU', 0.6, 0.6],
      ['Rectángulo', 0.45, 0.75],
    ];
    for (const [title, fx, fy] of objs) {
      await useTool(page, title);
      const [x, y] = point(fx, fy);
      // El Rectángulo es una figura que se DIBUJA arrastrando: un clic suelto (sin
      // arrastre) no crea nada. Se arrastra para crear el rectángulo centrado en (fx,fy).
      if (title === 'Rectángulo') {
        const [x1, y1] = point(fx - 0.03, fy - 0.03);
        const [x2, y2] = point(fx + 0.03, fy + 0.03);
        await page.mouse.move(x1, y1);
        await page.mouse.down();
        await page.mouse.move(x2, y2, { steps: 4 });
        await page.mouse.up();
      } else {
        await page.mouse.click(x, y);
      }
    }
    await expect(page.locator('.field-count')).toHaveText('5');

    // Seleccionar el rectángulo.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    const [rx, ry] = point(0.45, 0.75);
    await page.mouse.click(rx, ry);

    // El inspector ofrece Ancho (%). DECISIÓN DEL DUEÑO (Fase 6): el control numérico
    // "Rotación (°)" fue retirado; la rotación es ±90° desde la barra de contexto.
    const ancho = page.locator('.inspector .field', { hasText: 'Ancho' }).locator('input');
    await expect(ancho).toBeVisible();

    await ancho.fill('30');
    await ancho.press('Tab');
    await expect(ancho).toHaveValue('30');

    // Rotación por el MENÚ CONTEXTUAL: +90° (un paso exacto). Fase 3: el menú se abre
    // con PULSACIÓN LARGA sobre el objeto (el clic derecho fue retirado), no con un tap normal.
    await longPress(page, rx, ry);
    const ctxRot = page.locator('.context-bar [aria-label="Girar 90° a la derecha"]');
    await expect(ctxRot).toBeVisible();
    await ctxRot.click();
    // El inspector ya NO debe ofrecer "Rotación (°)".
    await openProps(page);
    await expect(page.locator('.inspector .field', { hasText: 'Rotación' }).locator('input')).toHaveCount(0);
  });

  test('dibuja una conducción (zigzag) y no existe el control "Rejilla"', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;

    // Conducción: arrastre.
    await useTool(page, 'Conducción (zigzag)');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');

    // La cuadrícula "Rejilla" fue retirada por decisión del dueño (Fase 1): no debe existir.
    await openProps(page);
    await expect(page.locator('.studio-panel .chip', { hasText: 'Rejilla' })).toHaveCount(0);
  });

  test('deshace y rehace con teclado y borra seleccionado', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height * 0.55;

    await useTool(page, 'Jugador propio');
    await page.mouse.click(x, y, { button: 'right' });
    await expect(page.locator('.field-count')).toHaveText('1');

    // Deshacer (Ctrl+Z).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count')).toHaveText('0');

    // Rehacer (Ctrl+Y).
    await page.keyboard.press('Control+y');
    await expect(page.locator('.field-count')).toHaveText('1');

    // Seleccionar y borrar con Supr.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(x, y);
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('0');
  });

  test('seleccionar un elemento NO crea entradas fantasma de undo (un solo Ctrl+Z deshace)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height * 0.55;

    await useTool(page, 'Jugador propio');
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Seleccionar el jugador (gesto sin cambio de documento).
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(x, y);
    await expect(page.locator('.inspector')).toBeVisible();

    // Un solo Ctrl+Z debe deshacer la COLOCACIÓN (no una selección fantasma).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count')).toHaveText('0');

    // Rehacer restaura la colocación.
    await page.keyboard.press('Control+y');
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('borrar con Supr es una sola acción de undo (un Ctrl+Z lo restaura)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height * 0.5;
    await useTool(page, 'Jugador propio');
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(x, y);
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('0');
    // Un solo Ctrl+Z restaura el elemento (una transacción, no dos).
    await page.keyboard.press('Control+z');
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('coloca materiales y el césped es el oficial único (sin selector de color)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // El Material vive ahora en el panel inferior desplegable (no en Propiedades).
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await expect(page.locator('.field-count')).toHaveText('1');
    // FASE B (paneles persistentes): el panel Material ya está abierto; no se re-togglea (lo cerraría).
    await openCat(page, 'Material');
    await page.locator('.rail-btn[title="Valla"]').click();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await expect(page.locator('.field-count')).toHaveText('2');
    // FASE 2: el césped es el oficial ÚNICO: no hay selector de color (ni de textura).
    await openProps(page);
    const grassField = page.locator('.field', { hasText: 'Césped' });
    await expect(grassField).toBeVisible();
    await expect(grassField.locator('.swatch')).toHaveCount(0);
  });

  test('rectángulo, elipse y zona guardan el color elegido y el relleno (no blanco fijo)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Activar una herramienta de dibujo (muestra la paleta) y elegir rojo.
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Rectángulo"]').click();
    await page.locator('.tools-caption .swatch').nth(1).click(); // rojo
    const col = '#c0392b';
    const draw = async (title: string, fx: number, fy: number) => {
      // Cada herramienta vive en el panel desplegable de Dibujo: hay que abrirlo
      // antes de pulsar la herramienta. FASE B: abrir es IDEMPOTENTE (si ya está
      // abierto no se re-togglea, lo cerraría).
      await openCat(page, 'Dibujo');
      await page.locator('.rail-btn[title="' + title + '"]').click();
      // DECISIÓN DEL DUEÑO (Fase 1): cada herramienta recuerda SU color. Elegimos
      // rojo para esta herramienta concreta antes de dibujar.
      await page.locator('.tools-caption .swatch').nth(1).click(); // rojo
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 30, y + 20, { steps: 4 });
      await page.mouse.up();
    };
    await draw('Rectángulo', 0.25, 0.3);
    await draw('Círculo / elipse', 0.5, 0.3);
    await draw('Línea', 0.25, 0.5);
    await expect(page.locator('.field-count')).toHaveText('3');
    await fillBoardTitle(page, 'Dibujo');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
    for (const k of ['rect', 'ellipse', 'line']) {
      const el = ex.canvas.frames[0].elements.find((e: { t: string }) => e.t === k);
      expect(el.c).toBe(col);
    }
  });

  test('FASE 9: no hay selector de textura de césped (siempre franjas) y un ejercicio nuevo se guarda con franjas', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    // Fase 9: el selector de textura fue retirado; solo existe el césped de franjas.
    await expect(page.locator('select[aria-label="Textura del césped"]')).toHaveCount(0);

    // Un ejercicio guardado nuevo queda con césped de franjas.
    await fillBoardTitle(page, 'CespedFranjas');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
    expect(ex.canvas.grass).toBe('stripes');
  });

  test('la miniatura del ejercicio respeta la orientación (vertical → retrato)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    // Un jugador + orientación vertical.
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await useTool(page, 'Jugador propio');
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');

    await fillBoardTitle(page, 'MiniaturaVertical');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');

    const dims = await page.evaluate(async () => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      const src = ex.thumbnail as string; // dataURL PNG
      const img = new Image();
      img.src = src;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight };
    });
    // Vertical → retrato (384x480), no paisaje (480x384).
    expect(dims.w).toBe(384);
    expect(dims.h).toBe(480);
  });

  test('el inspector de jugador NO ofrece Tipo/Portero y sí permite cambiar la opacidad', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.42;
    const y = box.y + box.height * 0.5;

    await useTool(page, 'Jugador propio');
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');

    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(x, y);

    // FASE C: el inspector de jugador ya NO ofrece el control "Tipo" (ni la opción Portero).
    await expect(page.locator('.inspector .field', { hasText: 'Tipo' })).toHaveCount(0);

    const op = page.locator('.inspector .field', { hasText: 'Opacidad' }).locator('input[type="range"]');
    await op.fill('0.5');
    await op.dispatchEvent('change');
    await expect(page.getByText('Opacidad — 50%')).toBeVisible();
  });

  test('cambia el color de un elemento ya colocado desde el inspector y persiste al reabrir', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Dibujar una línea.
    await useTool(page, 'Línea');
    const a = [box.x + box.width * 0.3, box.y + box.height * 0.4] as const;
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');

    // Seleccionar y cambiar el color a rojo (2º swatch de la paleta del inspector).
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click((a[0] + box.x + box.width * 0.6) / 2, (a[1] + box.y + box.height * 0.5) / 2);
    await expect(page.locator('.inspector')).toBeVisible();
    const swatchRed = page.locator('.inspector .field', { hasText: 'Color' }).locator('.swatch').nth(1);
    await swatchRed.click();
    await expect(swatchRed).toHaveClass(/swatch-active/);

    // Guardar → reabrir → el color rojo persiste.
    await fillBoardTitle(page, 'ColorRojo');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
    expect(ex.canvas.frames[0].elements[0].c).toBe('#c0392b');
  });

  test('hace zoom y borra varios seleccionados (selección múltiple)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const p1 = [box.x + box.width * 0.35, box.y + box.height * 0.5] as const;
    const p2 = [box.x + box.width * 0.6, box.y + box.height * 0.55] as const;

    await useTool(page, 'Jugador propio');
    await page.mouse.click(p1[0], p1[1]);
    // Tras colocar un jugador, la herramienta vuelve a Selección; se re-activa para el segundo.
    await useTool(page, 'Jugador propio');
    await page.mouse.click(p2[0], p2[1]);
    await expect(page.locator('.field-count')).toHaveText('2');

    // Selección múltiple (Shift-clic) y borrar.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(p1[0], p1[1]);
    await page.keyboard.down('Shift');
    await page.mouse.click(p2[0], p2[1]);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('0');

    // Zoom.
    await openProps(page);
    const z = page.locator('.field', { hasText: 'Zoom' }).locator('input[type="range"]');
    await z.fill('1.5');
    await z.dispatchEvent('change');
    await expect(page.getByText('Zoom — 150%')).toBeVisible();

    // Tras el zoom, se sigue pudiendo colocar (coordenadas mapeadas).
    await useTool(page, 'Jugador propio');
    await page.mouse.click(p1[0], p1[1]);
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('la selección múltiple se mueve como un GRUPO (no solo el último clic)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const pa = [box.x + box.width * 0.35, box.y + box.height * 0.5] as const;
    const pb = [box.x + box.width * 0.6, box.y + box.height * 0.55] as const;
    const pc = [box.x + box.width * 0.5, box.y + box.height * 0.7] as const;

    // Tres conos (A y B se moverán juntos; C queda fuera de la selección).
    for (const [x, y] of [pa, pb, pc]) {
      // FASE B (paneles persistentes): abrir Material es IDEMPOTENTE (no re-togglea lo abierto).
      await openCat(page, 'Material');
      await page.locator('.rail-btn[title="Cono"]').click();
      await page.mouse.click(x, y);
    }
    await expect(page.locator('.field-count')).toHaveText('3');

    // Capturar posiciones iniciales.
    await fillBoardTitle(page, 'SeleccionMulti');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const readEls = async () =>
      JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0].canvas.frames[0].elements.map(
        (e: { id: string; t: string; x: number; y: number }) => ({ id: e.id, t: e.t, x: e.x, y: e.y })
      );
    const orig = await readEls();

    // Reabrir y selección múltiple: clic en A + Shift-clic en B.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(pa[0], pa[1]);
    await page.keyboard.down('Shift');
    await page.mouse.click(pb[0], pb[1]);
    await page.keyboard.up('Shift');

    // Arrastrar desde A: debe mover A y B juntos (grupo), no solo A.
    await page.mouse.move(pa[0], pa[1]);
    await page.mouse.down();
    await page.mouse.move(pa[0] + 50, pa[1] + 40, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('3');

    // Guardar y comparar.
    await fillBoardTitle(page, 'SeleccionMulti');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const fin = await readEls();
    const byId = (id: string) => fin.find((e: { id: string }) => e.id === id)!;
    const a = orig[0], b = orig[1], c = orig[2];
    const a1 = byId(a.id), b1 = byId(b.id), c1 = byId(c.id);
    // A y B se movieron; C no.
    const movedA = Math.abs(a.x - a1.x) + Math.abs(a.y - a1.y);
    const movedB = Math.abs(b.x - b1.x) + Math.abs(b.y - b1.y);
    const movedC = Math.abs(c.x - c1.x) + Math.abs(c.y - c1.y);
    expect(movedA).toBeGreaterThan(0.005);
    expect(movedB).toBeGreaterThan(0.005);
    expect(movedC).toBeLessThan(0.005);
    // El grupo se traslada entero: A y B tienen exactamente el mismo delta.
    expect(Math.abs((a1.x - a.x) - (b1.x - b.x))).toBeLessThan(0.0001);
    expect(Math.abs((a1.y - a.y) - (b1.y - b.y))).toBeLessThan(0.0001);
  });

  test('la pizarra es estática: no hay ningún control de animación', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    // Sin panel/timeline de animación.
    await expect(page.locator('.top-pop-anim')).toHaveCount(0);
    await expect(page.locator('.anim-toggle')).toHaveCount(0);
    await expect(page.locator('.tl-list')).toHaveCount(0);
    await expect(page.locator('.tl-add')).toHaveCount(0);
    await expect(page.locator('.transport')).toHaveCount(0);
    // El menú "Más" NO ofrece Animación y la opción "Ayuda" fue retirada por el dueño.
    await page.locator('[aria-label="Más"]').click();
    await expect(page.locator('.top-pop-mas')).toBeVisible();
    await expect(page.locator('[aria-label="Animación"]')).toHaveCount(0);
    await expect(page.getByText('Animación', { exact: true })).toHaveCount(0);
    await expect(page.locator('[aria-label="Ayuda"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Limpiar pizarra"]')).toBeVisible();
  });

  test('un documento con varios fotogramas conserva los fotogramas al abrir, editar y guardar', async ({ page }) => {
    const now = new Date().toISOString();
    await seed(page);
    // Sembrar un ejercicio con 3 fotogramas (doc antiguo).
    await page.addInitScript(({ now }) => {
      localStorage.setItem('entrenolab:exercises', JSON.stringify([{
        id: 'x-multi', teamId: 't1', folderId: null, title: 'Multi-frame', description: '', explanation: '',
        category: 'Técnica', objectives: [], materials: [], durationMinutes: 10, minPlayers: null, maxPlayers: null,
        loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null,
        isTemplate: false,
        canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [
          { duration: 800, elements: [{ id: 'a', t: 'player', x: 0.2, y: 0.5, n: 1, c: '#1a73e8', side: 'own' }] },
          { duration: 1200, elements: [{ id: 'a', t: 'player', x: 0.5, y: 0.5, n: 1, c: '#1a73e8', side: 'own' }] },
          { duration: 600, elements: [{ id: 'a', t: 'player', x: 0.8, y: 0.5, n: 1, c: '#1a73e8', side: 'own' }] },
        ], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' },
        thumbnail: null, savedAt: now,
      }]));
    }, { now });

    await page.goto('/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.board-canvas svg')).not.toContainText('#f6c945');
    expect(await page.locator('.board-canvas svg').innerHTML()).not.toContain('#f6c945');

    // Editar el documento (colocar un jugador) mantiene los fotogramas.
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .tray-player[title="Jugador Azul"]').click();
    await expect(page.locator('.field-count')).toHaveText('1'); // aún no coloca: está armado
    const boxM = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(boxM.x + boxM.width * 0.8, boxM.y + boxM.height * 0.8);
    await expect(page.locator('.field-count')).toHaveText('2');

    // Guardar → el array de fotogramas NO se resetea a 1.
    await fillBoardTitle(page, 'Fotogramas');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
    expect(ex.canvas.frames.length).toBe(3);
  });

  test('exporta desde el diálogo (orientación, nombre y descarga)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;

    await useTool(page, 'Jugador propio');
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);

    await openExportDialog(page);
    await expect(page.getByText('720 × 576 px')).toBeVisible();

    // Orientación vertical.
    await page.locator('.export-opts .chip', { hasText: 'Vertical' }).click();
    await expect(page.getByText('576 × 720 px')).toBeVisible();

    // Nombre y exportar PNG.
    await page.locator('.export-opts input').fill('Mi jugada');
    const dl = page.waitForEvent('download');
    await page.locator('.export-foot .btn-primary').click();
    const download = await dl;
    expect(download.suggestedFilename()).toBe('Mi jugada.png');
  });

  test('exportar PNG con fondo "Transparente" produce píxeles transparentes', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await useTool(page, 'Jugador propio');
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);

    await openExportDialog(page);
    // Fondo Transparente (formato fijo PNG).
    await page.locator('.export-opts .chip', { hasText: 'Transparente' }).click();

    const dl = page.waitForEvent('download');
    await page.locator('.export-foot .btn-primary').click();
    const buf = fs.readFileSync((await (await dl).path())!);
    const b64 = buf.toString('base64');

    const res = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      let transparent = 0, total = 0;
      for (let y = 0; y < img.height; y += 4) {
        for (let x = 0; x < img.width; x += 4) {
          total++;
          if (ctx.getImageData(x, y, 1, 1).data[3] < 10) transparent++;
        }
      }
      return { transparent, total };
    }, b64);
    // Al menos parte del fondo debe ser transparente (no una textura de césped opaca).
    expect(res.transparent).toBeGreaterThan(res.total * 0.1);
  });

  test('la miniatura del ejercicio incluye el material en su posición (región, no colores globales)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Colocar un cono en el centro.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');

    await fillBoardTitle(page, 'MiniaturaMaterial');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');

    const res = await page.evaluate(async () => {
      const ex = JSON.parse(localStorage.getItem('entrenolab:exercises')!)[0];
      const img = new Image();
      img.src = ex.thumbnail as string; // dataURL PNG
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // Cono en el centro: norm (0.5,0.5) → viewBox (50, 39.79) → píxel.
      const sx = Math.round((50 / 100) * img.width);
      const sy = Math.round((39.790476 / 80) * img.height);
      let orange = 0;
      for (let dy = -18; dy <= 18; dy += 2) {
        for (let dx = -18; dx <= 18; dx += 2) {
          const d = ctx.getImageData(sx + dx, sy + dy, 1, 1).data;
          if (d[0] > d[1] + 30 && d[0] > 120) orange++;
        }
      }
      return { orange };
    });
    // El cono (PNG rojo/naranja) debe estar presente en la miniatura en esa región.
    expect(res.orange).toBeGreaterThan(0);
  });

  test('coloca jugadores desde el panel Jugadores', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    // La plantilla tiene los 2 jugadores del seed (los genéricos están aparte).
    await expect(page.locator('.side-panel-left .roster-item')).toHaveCount(2);

    const box = (await page.locator('.board-host').boundingBox())!;
    const pt = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

    // Tocar un jugador ARMA la colocación (no coloca aún). FASE B: el panel no se cierra.
    await page.locator('.side-panel-left .roster-item').nth(0).click();
    await expect(page.locator('.field-count')).toHaveText('0');
    await page.mouse.click(...pt(0.35, 0.45));
    await expect(page.locator('.field-count')).toHaveText('1');

    // Colocar el segundo jugador en otro punto. FASE B: el panel ya está abierto;
    // no se re-togglea (lo cerraría).
    await openCat(page, 'Jugadores');
    await page.locator('.side-panel-left .roster-item').nth(1).click();
    await page.mouse.click(...pt(0.65, 0.55));
    await expect(page.locator('.field-count')).toHaveText('2');
  });

  test('orienta el campo en vertical y sigue colocando jugadores', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await openProps(page);
    const vert = page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]');
    await vert.click();
    await expect(vert).toHaveClass(/chip-active/);

    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .roster-item').first().click();
    await expect(page.locator('.field-count')).toHaveText('0'); // armado, aún no coloca
    const boxV = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(boxV.x + boxV.width * 0.5, boxV.y + boxV.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('bandeja: coloca genéricos de dos colores y un jugador de plantilla', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const pt = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    await expect(page.locator('.field-count')).toHaveText('0'); // armado, aún no coloca
    await page.mouse.click(...pt(0.25, 0.4));
    await expect(page.locator('.field-count')).toHaveText('1');
    // FASE B (paneles persistentes): el panel ya está abierto; no se re-togglea (lo cerraría).
    await openCat(page, 'Jugadores');
    await page.locator('.tray-player[title="Jugador Rojo"]').click();
    await page.mouse.click(...pt(0.45, 0.4));
    await expect(page.locator('.field-count')).toHaveText('2');
    // Colocar un jugador de la plantilla (conserva su color, una sola instancia).
    await openCat(page, 'Jugadores');
    await page.locator('.side-panel-left .roster-item').first().click();
    await page.mouse.click(...pt(0.65, 0.55));
    await expect(page.locator('.field-count')).toHaveText('3');
  });

  test('la sesión se conserva y recupera al recargar', async ({ page }) => {
    await seed(page);
    // Crear dos ejercicios en la biblioteca.
    await page.goto('/library');
    await createTask(page, 'Rondos A');
    await createTask(page, 'Rondos B');
    // Crear sesión con ambos y guardar.
    await page.goto('/sessions');
    await page.getByText('Nueva sesión').click();
    await page.locator('.modal input[name="title"]').fill('Mi sesión');
    await page.locator('.tasks-head').getByText('Añadir ejercicio').click();
    await page.locator('.picker-item', { hasText: 'Rondos A' }).click();
    await page.locator('.tasks-head').getByText('Añadir ejercicio').click();
    await page.locator('.picker-item', { hasText: 'Rondos B' }).click();
    await page.getByText('Guardar sesión').click();
    await expect(page.getByText('Mi sesión')).toBeVisible();

    // Recargar → la sesión persiste (localStorage) con sus 2 tareas.
    await page.reload();
    await expect(page.getByText('Mi sesión')).toBeVisible();
    await expect(page.getByText('2 tareas')).toBeVisible();
  });

  test('la colocación de material es CONTINUA (Fase 3): queda armado y cada clic coloca una instancia', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const pt = [box.x + box.width * 0.4, box.y + box.height * 0.5] as const;
    const pt2 = [box.x + box.width * 0.55, box.y + box.height * 0.6] as const;
    await useTool(page, 'Cono');
    await page.mouse.click(pt[0], pt[1]);
    await expect(page.locator('.field-count')).toHaveText('1');
    // Fase 3: el material SIGUE armado (no vuelve a Seleccionar).
    await expect(page.locator('.placement-hint')).toBeVisible();
    await expect(page.locator('.tools-caption-title')).toHaveText('Cono');
    // Cada clic en una zona distinta coloca una nueva instancia (colocación continua).
    await page.mouse.click(pt2[0], pt2[1]);
    await expect(page.locator('.field-count')).toHaveText('2');
    // Pasar a Seleccionar detiene la colocación: un clic posterior no crea otro cono.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await expect(page.locator('.placement-hint')).toHaveCount(0);
    await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
    await page.mouse.click(pt[0], pt[1]);
    await expect(page.locator('.field-count')).toHaveText('2');
  });

  test('un jugador de plantilla no se duplica en la pizarra', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    const first = page.locator('.side-panel-left .roster-item').first();
    await first.click();
    await expect(page.locator('.field-count')).toHaveText('0'); // armado, aún no coloca
    // El clic sobre el campo coloca al jugador una sola vez.
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    // La tarjeta queda deshabilitada con "Ya está en el campo".
    // FASE B (paneles persistentes): el panel ya está abierto; no se re-togglea (lo cerraría).
    await openCat(page, 'Jugadores');
    await expect(first).toHaveClass(/tray-disabled/);
    await expect(first.locator('.mini-name')).toHaveText('Ya está en el campo');
    // Pulsar de nuevo no duplica.
    await first.click({ force: true });
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('dibuja un rectángulo y una elipse arrastrando (preview en vivo)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await useTool(page, 'Rectángulo');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');

    await useTool(page, 'Círculo / elipse');
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('2');
  });

  test('mueve y elimina un rectángulo (elemento no puntual)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Dibujar rectángulo.
    await useTool(page, 'Rectángulo');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
    // Seleccionar y mover el cuerpo del rectángulo.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
    // Borrar con Supr.
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('0');
  });

  test('las herramientas de dibujo vuelven a Seleccionar tras crear (un solo uso)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const drawTools = [
      'Flecha (movimiento)',
      'Curva derecha',
      'Línea',
      'Conducción (zigzag)',
      'Rectángulo',
      'Círculo / elipse',
      'Dibujo a mano alzada',
    ];
    let expected = 0;
    let x = box.x + box.width * 0.22;
    let y = box.y + box.height * 0.4;
    for (const title of drawTools) {
      await useTool(page, title, 'Dibujo');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y + 30, { steps: 4 });
      await page.mouse.up();
      expected++;
      await expect(page.locator('.field-count')).toHaveText(String(expected));
      // Vuelve a Seleccionar automáticamente.
      await expect(page.locator('.rail-btn[title="Seleccionar y mover"]')).toHaveClass(/rail-active/);
      // Un clic posterior en la misma zona no vuelve a dibujar (solo selecciona).
      await page.mouse.click(x + 40, y + 30);
      await expect(page.locator('.field-count')).toHaveText(String(expected));
      // Separar el punto de inicio para la siguiente herramienta (elementos apilados no interfieren).
      x = box.x + box.width * (0.22 + 0.1);
    }
  });

  test('redimensiona un rectángulo arrastrando una asa', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await useTool(page, 'Rectángulo');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
    // Seleccionar.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    // Arrastrar el asa inferior-derecha (en x=0.5,y=0.6) hacia fuera.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('soltar un elemento sobre la papelera lo elimina', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Dibujar un rectángulo.
    await useTool(page, 'Rectángulo');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
    // Seleccionar y arrastrar sobre la papelera.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.mouse.down();
    const trash = await page.locator('.board-trash').boundingBox();
    await page.mouse.move(trash!.x + trash!.width / 2, trash!.y + trash!.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('0');
  });

  test('inserta y edita un texto (edición directa en el inspector)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await useTool(page, 'Texto');
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    // El texto insertado queda seleccionado y editable en el panel.
    const ti = page.locator('.studio-panel .inspector textarea').first();
    await ti.fill('Rondos 4v2');
    await ti.dispatchEvent('change');
    await expect(ti).toHaveValue('Rondos 4v2');
  });

  test('el cuadro de texto controla el ancho/alto y persiste al reabrir', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await useTool(page, 'Texto');
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    // El texto queda seleccionado → inspector con Ancho/Alto y clipPath que recorta el contenido.
    await expect(page.locator('.studio-panel .inspector .field', { hasText: 'Ancho' }).locator('input')).toBeVisible();
    const hasClip = await page.evaluate(() => document.querySelector('.board-canvas clipPath') != null);
    expect(hasClip).toBe(true);
    // Cambiar Ancho y Alto.
    const ancho = page.locator('.studio-panel .inspector .field', { hasText: 'Ancho' }).locator('input');
    await ancho.fill('40');
    await ancho.dispatchEvent('change');
    const alto = page.locator('.studio-panel .inspector .field', { hasText: 'Alto' }).locator('input');
    await alto.fill('25');
    await alto.dispatchEvent('change');
    // Guardar → reabrir → w/h persisten.
    await fillBoardTitle(page, 'FeaturesText');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
    const t = ex.canvas.frames[0].elements[0];
    expect(t.w).toBeCloseTo(0.4, 2);
    expect(t.h).toBeCloseTo(0.25, 2);
  });

  test('pide confirmación al salir con cambios sin guardar (3 decisiones)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Hacer un cambio (colocar un jugador).
    await useTool(page, 'Jugador propio');
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Volver → aparece el diálogo.
    await page.locator('[title="Volver"]').click();
    const dialog = page.getByRole('dialog', { name: 'Cambios sin guardar' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Cambios sin guardar' })).toBeVisible();

    // Cancelar te mantiene en la pizarra.
    await dialog.getByText('Cancelar').click();
    await expect(page).toHaveURL(/\/board/);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Guardar y salir → guarda y vuelve a la biblioteca.
    await fillBoardTitle(page, 'Confirmacion');
    await page.locator('[title="Volver"]').click();
    await page.getByRole('dialog', { name: 'Cambios sin guardar' }).getByText('Guardar y salir').click();
    await page.waitForURL('**/library');
    await expect(page.locator('.ex-card')).toHaveCount(1);

    // Abrir de nuevo y salir sin guardar.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await useTool(page, 'Jugador propio');
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.locator('[title="Volver"]').click();
    await page.getByRole('dialog', { name: 'Cambios sin guardar' }).getByText('Salir sin guardar').click();
    await page.waitForURL('**/library');
  });

  test('no se puede duplicar un jugador de plantilla (se bloquea con aviso)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Colocar un jugador de plantilla (primer slot: normalizado 0.1, 0.38).
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .roster-item').first().click();
    await expect(page.locator('.field-count')).toHaveText('0'); // armado, aún no coloca
    // Mapear normalizado → pantalla (inversa de screenToNorm, con letterboxing; zoom=1, pan=0).
    const s = Math.min(box.width / 100, box.height / 80);
    const offX = (box.width - 100 * s) / 2;
    const offY = (box.height - 80 * s) / 2;
    const sx = box.x + offX + (0.1 * 92 + 4) * s;
    const sy = box.y + offY + (0.38 * 59.58 + 10) * s;
    await page.mouse.click(sx, sy); // el clic en el campo coloca al jugador ahí
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(sx, sy);
    // Duplicar (teclado) → se bloquea.
    await page.keyboard.press('Control+d');
    await expect(page.locator('.field-count')).toHaveText('1');
    await expect(page.locator('.board-notice')).toHaveText(/jugador de la plantilla/i);
  });

  test('selecciona y mueve con precisión al hacer zoom y desplazar la vista', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height * 0.5;

    // Un cono.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Función: posición actual del cono en pantalla (después de zoom/pan).
    const coneScreen = () =>
      page.evaluate(() => {
        const r = (document.querySelector('.board-canvas image') as SVGGraphicsElement).getBoundingClientRect().toJSON();
        return { cx: r!.x + r!.width / 2, cy: r!.y + r!.height / 2 };
      });

    // Seleccionar al 100 % (baseline).
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    let { cx, cy } = await coneScreen();
    await page.mouse.click(cx, cy);
    await expect(page.locator('.inspector')).toBeVisible();
    await page.keyboard.press('Escape');

    // Zoom 150 % y seleccionar en la nueva posición.
    await openProps(page);
    const z = page.locator('.field', { hasText: 'Zoom' }).locator('input[type="range"]');
    await z.evaluate((input: HTMLInputElement) => {
      input.value = '1.5';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    ({ cx, cy } = await coneScreen());
    await page.mouse.click(cx, cy);
    await expect(page.locator('.inspector')).toBeVisible();
    await page.keyboard.press('Escape');

    // Zoom 200 % y desplazamiento (pan) + seleccionar.
    // DECISIÓN DEL DUEÑO: los inputs X/Y de la Vista fueron retirados → el pan se
    // hace con la herramienta "Mano" (arrastre). Escape cierra el panel, se reabre.
    await openProps(page);
    const z2 = page.locator('.field', { hasText: 'Zoom' }).locator('input[type="range"]');
    await z2.evaluate((input: HTMLInputElement) => {
      input.value = '2';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await panByDrag(page, 30, 20);
    ({ cx, cy } = await coneScreen());
    await page.mouse.click(cx, cy);
    await expect(page.locator('.inspector')).toBeVisible();
  });

  test('zoom y desplazamiento deterministas: el elemento se mantiene clicable y se selecciona (100-300%, pan ±, H y V)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;

    // Colocar un cono EXACTAMENTE en norm (0.5,0.5) usando la misma matemática del render
    // (letterboxing + transform con origen en el centro; a zoom=1/pan=0 es la identidad).
    const s = Math.min(box.width / 100, box.height / 80);
    const offX = (box.width - 100 * s) / 2;
    const offY = (box.height - 80 * s) / 2;
    const placeX = box.x + offX + (0.5 * 92 + 4) * s;
    const placeY = box.y + offY + (0.5 * (92 / (105 / 68)) + 10) * s;
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(placeX, placeY);
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();

    const coneCenter = () =>
      page.evaluate(() => {
        const r = (document.querySelector('.board-canvas image') as SVGGraphicsElement).getBoundingClientRect().toJSON();
        return { cx: r!.x + r!.width / 2, cy: r!.y + r!.height / 2 };
      });

    const setZoomPan = async (zoom: number, panX: number, panY: number) => {
      await openProps(page);
      const zz = page.locator('.field', { hasText: 'Zoom' }).locator('input[type="range"]');
      await zz.evaluate((input: HTMLInputElement, v: number) => {
        input.value = String(v);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, zoom);
      // DECISIÓN DEL DUEÑO: los inputs X/Y de la Vista fueron retirados → el pan se
      // hace con la herramienta "Mano" (arrastre), no con campos numéricos.
      await panByDrag(page, panX, panY);
    };

    // En cada combinación el centro visual del elemento debe quedar DENTRO de la zona
    // clicable del host (coincidencia visual↔detección) y el clic debe seleccionarlo.
    for (const [zoom, panX, panY] of [
      [1.5, 0, 0],
      [2, 30, 20],
      [2, -50, -35],
      [3, 30, 20],
    ] as Array<[number, number, number]>) {
      await setZoomPan(zoom, panX, panY);
      const c = await coneCenter();
      expect(c.cx).toBeGreaterThan(box.x);
      expect(c.cx).toBeLessThan(box.x + box.width);
      expect(c.cy).toBeGreaterThan(box.y);
      expect(c.cy).toBeLessThan(box.y + box.height);
      await page.mouse.click(c.cx, c.cy);
      await expect(page.locator('.inspector')).toBeVisible();
      await page.keyboard.press('Escape');
    }

    // Orientación VERTICAL: el cono rota pero su centro sigue dentro del host y se
    // selecciona con el mismo clic en el centro visual (round-trip coherente H/V).
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();
    await setZoomPan(2, 30, 20);
    const cv = await coneCenter();
    expect(cv.cx).toBeGreaterThan(box.x);
    expect(cv.cx).toBeLessThan(box.x + box.width);
    expect(cv.cy).toBeGreaterThan(box.y);
    expect(cv.cy).toBeLessThan(box.y + box.height);
    await page.mouse.click(cv.cx, cv.cy);
    await expect(page.locator('.inspector')).toBeVisible();
  });

  test('un elemento bloqueado se puede re-seleccionar y desbloquear (el bloqueo no es permanente)', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const x = box.x + box.width * 0.45;
    const y = box.y + box.height * 0.5;
    // Cono.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Seleccionar y bloquear.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    await page.mouse.click(x, y);
    await expect(page.locator('.inspector')).toBeVisible();
    await page.locator('[title="Bloquear / desbloquear"]').click();

    // Deseleccionar y re-seleccionar el bloqueado (debe ser posible para desbloquear).
    await page.keyboard.press('Escape');
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
    await expect(page.locator('.inspector')).toHaveCount(0);
    await page.mouse.click(x, y);
    await expect(page.locator('.inspector')).toBeVisible();

    // El bloqueado no se borra con Supr.
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('1');

    // Desbloquear → ahora sí se puede borrar.
    await page.locator('[title="Bloquear / desbloquear"]').click();
    await page.keyboard.press('Delete');
    await expect(page.locator('.field-count')).toHaveText('0');
  });

  test('crea cada tipo de elemento, guarda y los recupera al reabrir', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const pt = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

    // Herramientas que se dibujan arrastrando.
    const draw: Array<[string, number, number]> = [
      // El Rectángulo se dibuja en el INTERIOR del campo: en el margen izquierdo
      // (letterbox) screenToNorm satura ambos extremos del arrastre a x=0 y el trazo
      // se descarta (grosor 0), así que un arranque en el borde sup-izq no crea nada.
      ['Rectángulo', 0.3, 0.32],
      ['Círculo / elipse', 0.32, 0.2],
      ['Línea', 0.52, 0.2],
      ['Flecha (movimiento)', 0.12, 0.45],
      ['Curva derecha', 0.32, 0.45],
      ['Dibujo a mano alzada', 0.52, 0.45],
      ['Conducción (zigzag)', 0.12, 0.7],
      ['Flecha doble sentido', 0.34, 0.7],
    ];
    for (const [title, fx, fy] of draw) {
      await useTool(page, title);
      // Arrastre CENTRADO: el glifo se crea alrededor de (fx,fy). Un arrastre sesgado
      // en el borde sup-izq (0.12,0.2) no creaba el Rectángulo (primer elemento).
      const [x1, y1] = pt(fx - 0.035, fy - 0.025);
      const [x2, y2] = pt(fx + 0.035, fy + 0.025);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 5 });
      await page.mouse.up();
    }

    // Herramientas de colocación única.
    const place: Array<[string, number, number]> = [
      ['Texto', 0.55, 0.75],
      ['Balón', 0.55, 0.65],
      ['Cono', 0.55, 0.55],
      ['BOSU', 0.55, 0.45],
      ['Miniportería', 0.55, 0.35],
    ];
    for (const [title, fx, fy] of place) {
      await useTool(page, title);
      const [x, y] = pt(fx, fy);
      await page.mouse.click(x, y);
    }

    const total = draw.length + place.length;
    await expect(page.locator('.field-count')).toHaveText(String(total));

    // Guardar → biblioteca → reabrir → se conservan todos.
    await fillBoardTitle(page, 'ColocacionContinua');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText(String(total));
  });

  test('la biblioteca guarda y recupera descripción, material, duración y jugadores', async ({ page }) => {
    await seed(page);
    await page.goto('/library');
    await page.getByText('Crear ejercicio').first().click();
    await page.locator('.modal input[name="title"]').fill('Rondos');
    await page.locator('.modal textarea[name="description"]').fill('Conservación del balón');
    await page.locator('.modal textarea[name="explanation"]').fill('4 contra 2');
    await page.locator('.modal input[name="materials"]').fill('Conos, balón');
    await page.locator('.modal input[name="duration"]').fill('15');
    await page.locator('.modal input[name="minPlayers"]').fill('6');
    await page.locator('.modal input[name="maxPlayers"]').fill('8');
    await page.getByText('Guardar').click();
    await expect(page.locator('.ex-card')).toHaveCount(1);

    // Reabrir en edición → los campos se mantienen.
    await page.locator('.ex-card').first().locator('.ex-more-btn').click();
    await page.locator('[title="Editar datos"]').first().click();
    await expect(page.locator('.modal textarea[name="description"]')).toHaveValue('Conservación del balón');
    await expect(page.locator('.modal textarea[name="explanation"]')).toHaveValue('4 contra 2');
    await expect(page.locator('.modal input[name="materials"]')).toHaveValue('Conos, balón');
    await expect(page.locator('.modal input[name="duration"]')).toHaveValue('15');
    await expect(page.locator('.modal input[name="minPlayers"]')).toHaveValue('6');
    await expect(page.locator('.modal input[name="maxPlayers"]')).toHaveValue('8');
  });

  test('la Biblioteca no guarda ni abre Diseñar cuando min > max', async ({ page }) => {
    await seed(page);
    await page.goto('/library');
    await page.getByText('Crear ejercicio').first().click();
    await page.locator('.modal input[name="title"]').fill('Rondos');
    await page.locator('.modal input[name="duration"]').fill('15');
    await page.locator('.modal input[name="minPlayers"]').fill('12');
    await page.locator('.modal input[name="maxPlayers"]').fill('5');
    await page.getByText('Guardar').click();
    // Muestra el error y no crea la tarjeta.
    await expect(page.locator('.form-error').first()).toContainText('mínimo');
    await expect(page.locator('.ex-card')).toHaveCount(0);
  });

  test('elige la variante/color de un material y lo coloca con ella', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    // El Material (con variantes) vive en el panel inferior desplegable.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    const card = page.locator('.tools-material-card', { hasText: 'Cono' });
    const variants = card.locator('.tools-material-variants');
    await expect(variants).toBeVisible();
    await variants.locator('.variant-swatch').nth(1).click(); // variante azul
    // Confirmar que quedó seleccionada.
    await expect(variants.locator('.variant-swatch').nth(1)).toHaveClass(/sel/);
    // Colocar el cono (con la variante elegida).
    await card.locator('.rail-btn[title="Cono"]').click();
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
  });

  test('la barra inferior inserta el PNG de material y persiste al reabrir', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    // Categoría Material en la barra inferior.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');
    // El tablero renderiza el PNG del material (asset + <image href>).
    const html = await page.locator('.board-canvas').innerHTML();
    expect(html).toContain('cone-red.png');

    // Guardar → reabrir → persiste el mismo recurso.
    await fillBoardTitle(page, 'MaterialPNG');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('1');
    const html2 = await page.locator('.board-canvas').innerHTML();
    expect(html2).toContain('cone-red.png');
  });

  test('el botón Atrás del navegador no sale de /board con cambios sin guardar', async ({ page }) => {
    await seed(page);
    // Crear una actividad y abrirla en la pizarra (navegación SPA pushState /library → /board).
    await page.goto('/library');
    await page.getByText('Crear ejercicio').first().click();
    await page.locator('.modal input[name="title"]').fill('Rondos');
    await page.getByText('Diseñar').click();
    await page.waitForURL('**/board');
    // Modificar algo que marque dirty (campo base).
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('half');
    // Atrás del navegador (popstate SPA).
    await page.goBack();
    // El guard bloquea: aparece el diálogo y la pizarra (overlay .studio) sigue en pantalla.
    const dialog = page.getByRole('dialog', { name: 'Cambios sin guardar' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Cambios sin guardar' })).toBeVisible();
    await expect(page.locator('.studio')).toBeVisible();
    // Cancelar → seguimos en la pizarra.
    await dialog.getByText('Cancelar').click();
    await expect(page.locator('.studio')).toBeVisible();
  });

  test('long-press en la barra abre el selector de variantes y no coloca', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    const cone = page.locator('.rail-btn[title="Cono"]');
    const b = (await cone.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650); // > 500 ms → long-press
    await page.mouse.up();
    // Se abre el selector y NO se coloca nada.
    await expect(page.locator('.bar-variant-pop')).toBeVisible();
    await expect(page.locator('.field-count')).toHaveText('0');
    // Elegir una variante → el popover se cierra.
    await page.locator('.bar-variant-pop .variant-swatch').nth(2).click();
    await expect(page.locator('.bar-variant-pop')).toHaveCount(0);
  });

  test('long-press táctil (pointerType touch) abre el selector de variantes y no coloca', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    const cone = page.locator('.rail-btn[title="Cono"]');
    const b = (await cone.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;

    // pointerdown táctil real (PointerEvent) sobre la herramienta.
    await cone.evaluate((el, p) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }));
    }, { x: cx, y: cy });
    await page.waitForTimeout(650); // > 500 ms → long-press

    // pointerup + click: el long-press anula la colocación.
    await cone.evaluate((el, p) => {
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
    }, { x: cx, y: cy });

    await expect(page.locator('.bar-variant-pop')).toBeVisible();
    await expect(page.locator('.field-count')).toHaveText('0');
    // Elegir una variante → se cierra.
    await page.locator('.bar-variant-pop .variant-swatch').nth(2).click();
    await expect(page.locator('.bar-variant-pop')).toHaveCount(0);
  });

  test('long-press con stylus (pointerType pen) abre el selector de variantes', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    const cone = page.locator('.rail-btn[title="Cono"]');
    const b = (await cone.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;

    await cone.evaluate((el, p) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'pen', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }));
    }, { x: cx, y: cy });
    await page.waitForTimeout(650);
    await cone.evaluate((el, p) => {
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'pen', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
    }, { x: cx, y: cy });

    await expect(page.locator('.bar-variant-pop')).toBeVisible();
    await expect(page.locator('.field-count')).toHaveText('0');
  });

  test('long-press cancelado por movimiento (pointermove > 10px) no abre el selector', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    const cone = page.locator('.rail-btn[title="Cono"]');
    const b = (await cone.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;

    await cone.evaluate((el, p) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }));
    }, { x: cx, y: cy });
    // SIN dormir entre bajar y mover: la ventana de la pulsación larga de la barra es de 500 ms
    // (`beginBarPress`) y aquí se comprueba justo que un movimiento la CANCELA antes de que
    // venza. Un `waitForTimeout(200)` en medio se comía el 40 % del margen y, con la máquina
    // cargada (el `dispatchEvent` es una ida y vuelta más), el temporizador llegaba a dispararse:
    // fallo intermitente de la suite completa en `features.spec.ts` («long-press cancelado por
    // movimiento … no abre el selector»). Los eventos se procesan en orden, así que mover
    // enseguida es exactamente el escenario que la prueba quiere medir.
    // Se mueve > 10 px → cancelación por movimiento.
    await cone.evaluate((el, p) => {
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }));
    }, { x: cx + 20, y: cy + 12 });
    await page.waitForTimeout(650);
    await cone.evaluate((el, p) => {
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
    }, { x: cx, y: cy });

    // No se abre el selector y, al ser clic normal, NO coloca nada (sigue en la barra).
    await expect(page.locator('.bar-variant-pop')).toHaveCount(0);
    await expect(page.locator('.field-count')).toHaveText('0');
  });

  test('el clic derecho abre el mismo selector de variantes que la pulsación larga', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    const cone = page.locator('.rail-btn[title="Cono"]');
    const b = (await cone.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;

    // Clic derecho (contextmenu) → selector de variantes, sin colocar.
    await page.mouse.click(cx, cy, { button: 'right' });
    await expect(page.locator('.bar-variant-pop')).toBeVisible();
    await expect(page.locator('.field-count')).toHaveText('0');

    // Elegir una variante y comprobar que se cierra.
    await page.locator('.bar-variant-pop .variant-swatch').nth(2).click();
    await expect(page.locator('.bar-variant-pop')).toHaveCount(0);
  });

  test('crea rectángulo, línea, texto y material; mueve la línea, edita el texto y persiste con igualdad de modelo', async ({ page }) => {
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const pt = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

    // Rectángulo (arrastre).
    await useTool(page, 'Rectángulo');
    let [x, y] = pt(0.2, 0.2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 40, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('1');
    // Línea (arrastre).
    await useTool(page, 'Línea');
    [x, y] = pt(0.5, 0.25);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 30, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.field-count')).toHaveText('2');
    // Texto.
    await useTool(page, 'Texto');
    [x, y] = pt(0.4, 0.6);
    await page.mouse.click(x, y);
    const ti = page.locator('.studio-panel .inspector textarea').first();
    await ti.fill('Rondos 4v2');
    await ti.dispatchEvent('change');
    await expect(page.locator('.field-count')).toHaveText('3');
    // Material PNG desde la barra.
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    [x, y] = pt(0.6, 0.6);
    await page.mouse.click(x, y);
    await expect(page.locator('.field-count')).toHaveText('4');

    // Mover la línea (seleccionarla y arrastrar su cuerpo). La herramienta "Seleccionar"
    // ya está activa en el raíl; NO se abre el panel de Dibujo (Fase 15: taparía el botón).
    await page.locator('[aria-label="Seleccionar y mover"]').click();
    const lineMid = pt(0.5 + 30 / box.width, 0.25 + 15 / box.height);
    await page.mouse.move(lineMid[0], lineMid[1]);
    await page.mouse.down();
    await page.mouse.move(lineMid[0] + 20, lineMid[1] + 10, { steps: 4 });
    await page.mouse.up();

    // Guardar.
    await fillBoardTitle(page, 'GuardarCompuesto');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');

    // Modelo tras guardar: 4 elementos, texto v, material con assetKind+asset.
    const ex = JSON.parse((await page.evaluate(() => localStorage.getItem('entrenolab:exercises')))!)[0];
    const els = ex.canvas.frames[0].elements;
    expect(els).toHaveLength(4);
    const text = els.find((e: { t: string }) => e.t === 'text');
    expect(text.v).toBe('Rondos 4v2');
    const cone = els.find((e: { t: string }) => e.t === 'cone');
    expect(cone.assetKind).toBe('cone_red');
    expect(cone.asset).toContain('cone-red.png');
    const line = els.find((e: { t: string }) => e.t === 'line');
    expect(line.x1).toBeDefined();
    expect(line.x1).toBeGreaterThan(0.5); // se ha trasladado (no quedó en el punto inicial)

    // Reabrir → se conservan los 4 y el texto.
    await page.locator('.ex-card').first().hover();
    await page.locator('[title="Diseñar en pizarra"]').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.field-count')).toHaveText('4');
  });

  test('el guard conserva el destino original al salir sin guardar', async ({ page }) => {
    await seed(page);
    await page.goto('/library');
    await page.getByText('Crear ejercicio').first().click();
    await page.locator('.modal input[name="title"]').fill('Rondos');
    await page.getByText('Diseñar').click();
    await page.waitForURL('**/board');
    // Modificar (dirty).
    await openProps(page);
    await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('half');
    // Atrás (destino original: /library) → diálogo → Salir sin guardar → vuelve a /library.
    await page.goBack();
    const dialog = page.getByRole('dialog', { name: 'Cambios sin guardar' });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Salir sin guardar').click();
    await page.waitForURL('**/library');
  });

  test('reordena y quita tareas en una sesión', async ({ page }) => {
    await seed(page);
    await page.goto('/library');
    await createTask(page, 'Rondos A');
    await createTask(page, 'Rondos B');
    await expect(page.locator('.ex-card')).toHaveCount(2);
    await page.goto('/sessions');

    await page.getByText('Nueva sesión').click();
    await page.locator('.modal input[name="title"]').fill('Mi sesión');
    await page.locator('.tasks-head').getByText('Añadir ejercicio').click();
    await page.locator('.picker-item', { hasText: 'Rondos A' }).click();
    await page.locator('.tasks-head').getByText('Añadir ejercicio').click();
    await page.locator('.picker-item', { hasText: 'Rondos B' }).click();
    await expect(page.locator('.task')).toHaveCount(2);

    // Subir la segunda tarea → pasa a ser la primera.
    await page.locator('.task').nth(1).locator('[title="Subir"]').click();
    await expect(page.locator('.task').nth(0).locator('.task-title')).toHaveText('Rondos B');

    // Quitar la segunda tarea.
    await page.locator('.task').nth(1).locator('[title="Quitar"]').click();
    await expect(page.locator('.task')).toHaveCount(1);

    await page.getByText('Guardar sesión').click();
    await expect(page.getByText('Mi sesión')).toBeVisible();
  });

  test('respaldo: exporta un JSON versionado y rechaza un archivo inválido sin perder datos', async ({ page }) => {
    await seed(page);
    await page.goto('/team');
    await page.locator('[title="Ajustes"]').click();
    await expect(page.locator('.settings')).toBeVisible();

    // Exportar → descarga con contenido versionado y los datos actuales.
    const dl = page.waitForEvent('download');
    await page.locator('.settings', { hasText: 'Exportar respaldo' }).getByRole('button', { name: 'Exportar' }).click();
    const download = await dl;
    const buf = fs.readFileSync((await download.path())!);
    const backup = JSON.parse(buf.toString());
    expect(backup.version).toBe(1);
    expect(Array.isArray(backup.teams)).toBe(true);
    expect(backup.teams.length).toBeGreaterThan(0);
    expect(Array.isArray(backup.exercises)).toBe(true);
    expect(Array.isArray(backup.sessions)).toBe(true);

    // Importar un archivo corrupto → error visible y ningún dato destruido.
    const beforeHtml = await page.locator('.settings').innerHTML();
    await page.locator('.settings', { hasText: 'Importar respaldo' }).locator('input[type="file"]').setInputFiles({ name: 'mal.json', mimeType: 'application/json', buffer: Buffer.from('esto no es json') });
    await expect(page.locator('.settings', { hasText: 'El archivo no es JSON válido.' })).toBeVisible();
    expect(await page.locator('.settings').innerHTML()).toContain('Exportar respaldo'); // no se ha roto

    // Importar el respaldo válido (reemplazar) → recarga y conserva el equipo.
    await page.locator('.settings', { hasText: 'Importar respaldo' }).locator('input[type="file"]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: buf });
    await expect(page.locator('.settings', { hasText: 'Respaldo válido' })).toBeVisible();
    await page.locator('.settings', { hasText: 'Respaldo válido' }).getByRole('button', { name: 'Reemplazar' }).click();
    // FASE G: observable — el equipo exportado ya está restaurado en localStorage (no espera fija).
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('entrenolab:teams') ?? '[]') as unknown[]).length), { timeout: 5000 }).toBeGreaterThan(0);
    // El equipo exportado sigue presente (fuente de verdad: localStorage) y la app recargada.
    const teams = await page.evaluate(() => JSON.parse(localStorage.getItem('entrenolab:teams') ?? '[]'));
    expect(teams.length).toBeGreaterThan(0);
    await page.goto('/team');
    await expect(page.getByText('Primer Equipo').first()).toBeVisible();
  });
});
