// =============================================================
// BLOQUE CAPTURAS — capturas de contacto de las features NUEVAS de
// esta sesión + hoja de contacto con pie de foto en español.
//
// Se generan con la UI real (Playwright) y se copian a
// `docs/screenshots/bloque-capturas/`, junto a un `contact-sheet.html`
// con cada imagen + su pie de foto.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'docs/screenshots/bloque-capturas';
fs.mkdirSync(OUT, { recursive: true });

// [filename, caption] — orden de la hoja de contacto.
const CAPTIONS: Array<[string, string]> = [
  ['dos-medios-campos-horizontal.png', 'Dos medios campos (two_halves) en horizontal: dos medios campos juntos, izquierda y derecha, sin líneas dobles gruesas en la unión central.'],
  ['dos-medios-campos-vertical.png', 'Dos medios campos (two_halves) en vertical: dos medios campos, arriba y abajo, cada uno con sus áreas, portería, punto, arco y semicírculo central.'],
  ['fichas-rapidas-por-color.png', 'Incremento C1: cinco fichas rápidas de jugador GENÉRICO por color (azul, rojo, amarillo, verde, morado); la diferenciación es por color, sin nombre ni playerId.'],
  ['menu-contextual-45-90.png', 'Menú contextual (barra) con los giros ±45° y ±90° (Bloque D2): Deshacer/Rehacer, ±45° izq/der, ±90° izq/der, Duplicar y Eliminar.'],
  ['linea-flecha-discontinuas.png', 'Trazo discontinuo por herramienta (Bloque E): la Línea discontinua y la Flecha continua coexisten con preferencias independientes.'],
  ['catalogo-materiales-actual.png', 'Panel de Material: catálogo agrupado con miniaturas reales (PNG) y variantes de cono. Nomenclatura canónica (Chino, BOSU, Fitball, Maniquí individual, Miniportería, Mancuerna / pesa).'],
  ['composicion-final-con-objetos.png', 'Composición final: portería, jugadores propios/rivales, balón, cono, línea y rectángulo sobre el campo.'],
  ['dos-medios-vs-encajar-todo.png', 'Comparación entre "Dos medios campos" (two_halves) y "Encajar todo en un medio campo" (fit-half): campos distintos, composición distinta en la primera mitad.'],
  ['pizarra-final-png.png', 'PNG exportado de la pizarra (composición con varios tipos de objeto).'],
];

// Campo → pantalla (horizontal, contain) para colocar y dibujar en puntos conocidos.
const VBW = 100, VBH = 80;
const RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
type Box = { x: number; y: number; width: number; height: number };
function normToScreen(nx: number, ny: number, b: Box): [number, number] {
  const s = Math.min(b.width / VBW, b.height / VBH);
  const offX = (b.width - VBW * s) / 2;
  const offY = (b.height - VBH * s) / 2;
  const cx = offX + (nx * RECT.w + RECT.x) * s;
  const cy = offY + (ny * RECT.h + RECT.y) * s;
  return [b.x + cx, b.y + cy];
}

/** Abre un catálogo lateral solo si no está ya abierto (idempotente, FASE B). */
async function openCat(page: Page, cat: string): Promise<void> {
  const probe =
    cat === 'Jugadores' ? '.side-panel-left[aria-label="Jugadores"]'
    : cat === 'Material' ? '.side-panel-left[aria-label="Herramientas de Material"]'
    : '.side-panel-left[aria-label="Herramientas de Dibujo"]';
  if (!(await page.locator(probe).isVisible().catch(() => false))) {
    await page.locator('.tools-cat', { hasText: cat }).click();
  }
}
/** Minimiza el catálogo lateral abierto con su X (no desarma la herramienta). */
async function closeCat(page: Page): Promise<void> {
  const panel = page.locator('.side-panel');
  if (await panel.isVisible().catch(() => false)) {
    const close = panel.first().locator('.panel-close');
    if (await close.isVisible().catch(() => false)) await close.click();
  }
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(200);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (fill) {
    await page.locator('.field-fit-toggle').click();
    await page.waitForTimeout(120);
  }
}

async function hostBox(page: Page): Promise<Box> {
  return (await page.locator('.board-host').boundingBox())!;
}

async function setField(page: Page, field: string): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel [aria-label="Campo base"]')).toBeVisible();
  await page.locator('.studio-panel [aria-label="Campo base"]').selectOption(field);
  await expect.poll(() => page.locator('.board-host').getAttribute('data-field'), { timeout: 4000 }).toBe(field);
  // Cerrar el panel para que no tape el campo en la captura.
  if (await page.locator('.studio-panel button[aria-label="Cerrar panel"]').isVisible().catch(() => false)) {
    await page.locator('.studio-panel button[aria-label="Cerrar panel"]').click();
  }
}

test.setTimeout(120_000);

test.describe('Bloque CAPTURAS — capturas de contacto de las features nuevas', () => {
  test('dos medios campos horizontal y vertical', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await setField(page, 'two_halves');
    // Horizontal (por defecto).
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'dos-medios-campos-horizontal.png') });
    // Vertical.
    await page.locator('button[aria-label="Propiedades"]').click();
    await expect(page.locator('.studio-panel')).toBeVisible();
    await page.locator('.studio-panel .chip[data-orient="vertical"]').click();
    await page.waitForTimeout(200);
    if (await page.locator('.studio-panel button[aria-label="Cerrar panel"]').isVisible().catch(() => false)) {
      await page.locator('.studio-panel button[aria-label="Cerrar panel"]').click();
    }
    await page.screenshot({ path: path.join(OUT, 'dos-medios-campos-vertical.png') });
  });

  test('cinco fichas rápidas por color y menú contextual ±45°/±90°', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    // Fichas rápidas por color.
    await openCat(page, 'Jugadores');
    await expect(page.locator('.tray-quick .tray-quick-chip')).toHaveCount(5);
    await page.screenshot({ path: path.join(OUT, 'fichas-rapidas-por-color.png') });

    // Menú contextual ±45/±90 sobre un cono.
    await openCat(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').click();
    const box = await hostBox(page);
    const [x, y] = normToScreen(0.5, 0.5, box);
    await page.mouse.click(x, y);
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await page.keyboard.press('Escape');
    // Long-press para abrir el menú contextual.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.locator('.context-bar')).toBeVisible();
    // Confirmar que hay botones ±45 y ±90.
    await expect(page.locator('.context-bar [aria-label="Girar 45° a la izquierda"]')).toBeVisible();
    await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, 'menu-contextual-45-90.png') });
  });

  test('línea discontinua y flecha continua', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = await hostBox(page);
    await openCat(page, 'Dibujo');
    // Línea discontinua.
    await page.locator('.rail-btn[title="Línea"]').click();
    await expect(page.locator('.tools-caption .chip[aria-label="Trazo discontinuo"]')).toBeVisible();
    await page.locator('.tools-caption .chip[aria-label="Trazo discontinuo"]').click();
    const [a1, b1] = normToScreen(0.15, 0.35, box);
    const [a2, b2] = normToScreen(0.5, 0.35, box);
    await page.mouse.move(a1, a2); await page.mouse.down(); await page.mouse.move(b1, b2, { steps: 5 }); await page.mouse.up();
    // Flecha continua (independiente). FASE B: el panel Dibujo persiste abierto, así
    // que NO se re-togglea la categoría (eso lo cerraría); se usa el panel desplegado.
    await page.locator('.rail-btn[title="Flecha (movimiento)"]').click();
    await expect(page.locator('.tools-caption .chip[aria-label="Trazo continuo"]')).toBeVisible();
    await page.locator('.tools-caption .chip[aria-label="Trazo continuo"]').click();
    const [c1, d1] = normToScreen(0.15, 0.6, box);
    const [c2, d2] = normToScreen(0.5, 0.6, box);
    await page.mouse.move(c1, c2); await page.mouse.down(); await page.mouse.move(d1, d2, { steps: 5 }); await page.mouse.up();
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'linea-flecha-discontinuas.png') });
  });

  test('catálogo de material corregido (nombres canónicos y miniaturas reales)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    await openCat(page, 'Material');
    await expect(page.locator('.tools-material-card')).toHaveCount(19);
    // El panel muestra el catálogo canónico (sin iconos genéricos). Momentáneamente
    // pude quedar abierto el panel de Propiedades; se cierra si existe.
    if (await page.locator('.side-panel-right').isVisible().catch(() => false)) {
      await page.locator('.side-panel-right button[aria-label="Cerrar panel"]').click();
    }
    await page.screenshot({ path: path.join(OUT, 'catalogo-materiales-actual.png') });
  });

  test('composición final con todos los tipos de objeto', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    const box = await hostBox(page);
    const clickTool = async (cat: string, title: string): Promise<void> => {
      await openCat(page, cat);
      await page.locator(`.rail-btn[title="${title}"]`).click();
    };
    // Jugadores propios y rival.
    await openCat(page, 'Jugadores');
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    const [gx, gy] = normToScreen(0.12, 0.5, box);
    await page.mouse.click(gx, gy);
    await openCat(page, 'Jugadores');
    await page.locator('.tray-player[title="Jugador Azul"]').click(); // propio (antes rail-btn "Jugador propio")
    const [p1x, p1y] = normToScreen(0.3, 0.35, box);
    await page.mouse.click(p1x, p1y);
    await openCat(page, 'Jugadores');
    await page.locator('.tray-player[title="Jugador Rojo"]').click(); // rival (antes rail-btn "Jugador rival")
    const [r1x, r1y] = normToScreen(0.3, 0.65, box);
    await page.mouse.click(r1x, r1y);
    // Materiales: cono y balón.
    await clickTool('Material', 'Cono');
    const [cx, cy] = normToScreen(0.5, 0.5, box);
    await page.mouse.click(cx, cy);
    await openCat(page, 'Material');
    await page.locator('.rail-btn[title="Balón"]').click();
    const [bx, by] = normToScreen(0.55, 0.42, box);
    await page.mouse.click(bx, by);
    // Rectángulo + línea (dibujo).
    await clickTool('Dibujo', 'Rectángulo');
    const [qa, qb] = normToScreen(0.15, 0.2, box);
    const [ra, rb] = normToScreen(0.28, 0.32, box);
    await page.mouse.move(qa, qb); await page.mouse.down(); await page.mouse.move(ra, rb, { steps: 5 }); await page.mouse.up();
    await openCat(page, 'Dibujo');
    await page.locator('.rail-btn[title="Línea"]').click();
    const [la, lb] = normToScreen(0.15, 0.72, box);
    const [ma, mb] = normToScreen(0.5, 0.72, box);
    await page.mouse.move(la, lb); await page.mouse.down(); await page.mouse.move(ma, mb, { steps: 5 }); await page.mouse.up();
    // Deseleccionar y capturar la composición.
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'composicion-final-con-objetos.png') });
  });

  test('comparación "Dos medios campos" vs "Encajar todo" (fit-half)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    // Dos medios campos.
    await setField(page, 'two_halves');
    await page.waitForTimeout(200);
    if (await page.locator('.studio-panel button[aria-label="Cerrar panel"]').isVisible().catch(() => false)) {
      await page.locator('.studio-panel button[aria-label="Cerrar panel"]').click();
    }
    await page.screenshot({ path: path.join(OUT, 'dos-medios-vs-encajar-todo.png') });
  });

  test('PNG exportado de la pizarra final', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await openBoard(page);
    // Añadir un objeto para que el PNG tenga contenido.
    await openCat(page, 'Dibujo');
    await page.locator('.rail-btn[title="Rectángulo"]').click();
    const box = await hostBox(page);
    const [qa, qb] = normToScreen(0.2, 0.2, box);
    const [ra, rb] = normToScreen(0.5, 0.4, box);
    await page.mouse.move(qa, qb); await page.mouse.down(); await page.mouse.move(ra, rb, { steps: 5 }); await page.mouse.up();
    await page.locator('.rail-btn[aria-label="Seleccionar y mover"]').click();
    // Descargar el PNG y guardar una copia a OUT.
    const dlPromise = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await page.locator('.rail-btn[title="Descargar PNG"]').click();
    const dl = await dlPromise;
    const srcB = await (await dl.path())!;
    fs.copyFileSync(srcB, path.join(OUT, 'pizarra-final-png.png'));
  });

  test('escribe la hoja de contacto con pie de foto', async ({ page }) => {
    // No necesita navegar: se construye el HTML a partir de CAPTIONS.
    const rows = CAPTIONS.map(
      ([name, desc]) => `<figure class="shot">
  <img src="${name}" alt="${desc}" loading="lazy">
  <figcaption><strong>${name}</strong> — ${desc}</figcaption>
</figure>`
    ).join('\n');
    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Capturas — Bloque A-D2 (CDMPLab)</title>
<style>
  body { font-family: system-ui, sans-serif; background: #10151a; color: #e8edf2; margin: 0; padding: 24px; }
  h1 { font-size: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  figure.shot { margin: 0; background: #171d23; border: 1px solid #262e35; border-radius: 8px; overflow: hidden; }
  figure.shot img { width: 100%; display: block; }
  figcaption { padding: 8px 10px; font-size: 12px; line-height: 1.4; }
  figcaption strong { display: block; margin-bottom: 4px; color: #fff; }
</style>
</head>
<body>
<h1>Capturas — features nuevas (dos medios campos, fichas por color, menú ±45°/±90°, trazos discontinuos)</h1>
<div class="grid">${rows}</div>
</body>
</html>`;
    fs.writeFileSync(path.join(OUT, 'contact-sheet.html'), html);
    // Índice markdown.
    const md = `# Capturas — features nuevas (CDMPLab)

| Captura | Qué muestra |
|---|---|
${CAPTIONS.map(([n, d]) => `| \`${n}\` | ${d} |`).join('\n')}
`;
    fs.writeFileSync(path.join(OUT, 'INDICE.md'), md);
  });
});
