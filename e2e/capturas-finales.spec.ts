import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { longPress } from './gesture-helpers';

// Capturas de esta versión (decidido por el dueño): los 8 resultados
// campo/orientación, el selector abierto, propiedades de jugador y de
// cono redimensionado/girado, menús, biblioteca con carpetas/duplicados,
// móvil y una composición final. Se inspeccionan visualmente.
const SHOTS = 'e2e/shots/capturas-finales';
fs.mkdirSync(SHOTS, { recursive: true });

const VBW = 100;
const VBH = 80;
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

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'pl1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function openBoard(page: Page, opts?: { keepFill?: boolean }): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  await page.waitForTimeout(250);
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
  if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
  const fill = await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill'));
  if (opts?.keepFill) {
    // Forzar "Llenar pantalla" (aunque la preferencia persistida lo haya apagado).
    if (!fill) {
      await page.locator('.field-fit-toggle').click();
      await page.waitForTimeout(120);
    }
  } else if (fill) {
    await page.locator('.field-fit-toggle').click();
    await page.waitForTimeout(120);
  }
}

async function setField(page: Page, field: string): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').click();
  await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption(field);
  await page.waitForTimeout(150);
}
async function setOrient(page: Page, orient: 'horizontal' | 'vertical'): Promise<void> {
  await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator(`.chip[data-orient="${orient}"]`).click();
  await page.waitForTimeout(150);
}
async function shotBoard(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.locator('.board-host').screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe('Capturas finales de esta versión', () => {
  test('ocho combinaciones campo/orientación', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    for (const [field, orient] of [['full','horizontal'],['full','vertical'],['half','horizontal'],['half','vertical'],['f7','horizontal'],['f7','vertical'],['blank','horizontal'],['blank','vertical']] as Array<[string,string]>) {
      await setField(page, field);
      await setOrient(page, orient as 'horizontal'|'vertical');
      await shotBoard(page, `campo-${field}-${orient}`);
    }
  });

  test('selector de campo y orientación abierto', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await page.locator('button[aria-label="Propiedades"]').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/selector-campo-orientacion.png` });
  });

  test('propiedades de un jugador (real)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.locator('.roster-item', { hasText: 'Marcos' }).click();
    const b = await page.locator('.board-host').boundingBox();
    const [cx, cy] = normToScreen(0.5, 0.5, b!);
    await page.mouse.click(cx, cy, { button: 'right' });
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/propiedades-jugador.png` });
  });

  test('propiedades de un cono redimensionado y girado ±90°', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    const b = await page.locator('.board-host').boundingBox();
    const [cx, cy] = normToScreen(0.5, 0.5, b!);
    // Fase 3: clic derecho coloca el cono; el menú contextual se abre con pulsación larga.
    await page.mouse.click(cx, cy, { button: 'right' });
    await expect(page.locator('.field-count')).toHaveText('1');
    await page.waitForTimeout(200);
    // Girar +90° desde el menú contextual.
    await longPress(page, cx, cy);
    await page.locator('.context-bar [aria-label="Girar 90° a la derecha"]').click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/propiedades-cono-girado.png` });
  });

  test('menús Jugadores, Material y Dibujo abiertos', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    const menus: Array<[string, string, string]> = [
      ['jugadores', '.tools-cat[aria-label="Jugadores"]', '.side-panel-left'],
      ['material', '.tools-cat[aria-label="Material"]', '.side-panel-left'],
      ['dibujo', '.tools-cat[aria-label="Dibujo"]', '.side-panel-left'],
    ];
    for (const [name, sel, panel] of menus) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      await page.locator(sel).click();
      await expect(page.locator(panel)).toBeVisible();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/menu-${name}.png` });
    }
  });

  test('biblioteca con carpetas y un duplicado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/library');
    await expect(page.locator('body')).toBeVisible();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const now = new Date().toISOString();
      localStorage.setItem('entrenolab:folders', JSON.stringify([
        { id: 'f-pos', teamId: 't1', parentId: null, name: 'Posesión' },
        { id: 'f-rondo', teamId: 't1', parentId: 'f-pos', name: 'Rondos' },
      ]));
      localStorage.setItem('entrenolab:exercises', JSON.stringify([
        { id: 'ex1', teamId: 't1', folderId: null, title: 'Rondo F7', description: '', explanation: '', category: 'Técnica', objectives: [], materials: ['conos'], durationMinutes: 15, minPlayers: null, maxPlayers: null, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: null, thumbnail: null, savedAt: now },
        { id: 'ex2', teamId: 't1', folderId: 'f-rondo', title: 'Rondo F7 (copia)', description: '', explanation: '', category: 'Técnica', objectives: [], materials: ['conos'], durationMinutes: 15, minPlayers: null, maxPlayers: null, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: null, thumbnail: null, savedAt: now },
      ]));
    });
    await page.reload();
    await expect(page.locator('body')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/biblioteca-carpetas-duplicados.png`, fullPage: true });
  });

  test('móvil: campo-completo y llenar-pantalla en 360, 390 y 430 (ocupación real)', async ({ page }) => {
    const occupancy = async (): Promise<number> => {
      const host = (await page.locator('.board-host').boundingBox())!;
      let grass: { height: number } | null = null;
      try {
        grass = await page.locator('.entrenolab-grass').boundingBox();
      } catch {
        grass = null;
      }
      if (!grass) return 0;
      return grass.height / host.height;
    };

    for (const [w, h] of [[360, 800], [390, 844], [430, 932]] as Array<[number, number]>) {
      // ---- Campo completo (letterbox: campo pequeño, NO llena) ----
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoard(page); // sin keepFill → campo completo
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      const occFull = await occupancy();
      expect(await page.locator('.board-host').evaluate((el) => el.classList.contains('board-fill')), 'campo-completo no debe tener board-fill').toBe(false);
      await page.screenshot({ path: `${SHOTS}/movil-${w}-campo-completo.png` });

      // ---- Llenar pantalla (campo grande) ----
      await page.goto('/board');
      await expect(page.locator('.board-host')).toBeVisible();
      await page.waitForTimeout(250);
      if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
      if (await page.locator('.fill-hint-close').isVisible().catch(() => false)) await page.locator('.fill-hint-close').click();
      await openBoard(page, { keepFill: true });
      await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
      const occFill = await occupancy();
      // Medición real (no solo la clase CSS) de la ocupación de la altura.
      expect(occFill, `llenar-pantalla ${w}px llena la altura (${occFill.toFixed(2)})`).toBeGreaterThan(0.9);
      expect(occFull, `llenar-pantalla ${w}px ocupa más que campo-completo (${occFull.toFixed(2)})`).toBeLessThan(occFill);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/movil-${w}-llenar-pantalla.png` });

      // ---- Desplazarse con la mano hasta cada extremo (no modifica el terreno) ----
      await page.locator('.rail-btn[title="Desplazar campo"]').click();
      const host = (await page.locator('.board-host').boundingBox())!;
      const yMid = host.y + host.height / 2;
      const drag = async (toRight: boolean): Promise<void> => {
        const xEnd = toRight ? host.x + host.width - 10 : host.x + 10;
        for (let i = 0; i < 5; i++) {
          await page.mouse.move(host.x + host.width / 2, yMid);
          await page.mouse.down();
          await page.mouse.move(xEnd, yMid, { steps: 6 });
          await page.mouse.up();
        }
      };
      await drag(true); // alcanza la izquierda
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/movil-${w}-llenar-izquierda.png` });
      await drag(false); // alcanza la derecha
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/movil-${w}-llenar-derecha.png` });
    }

    // ---- Zoom + objeto seleccionado (en campo-completo para geometría estable) ----
    for (const [w, h] of [[360, 800], [390, 844], [430, 932]] as Array<[number, number]>) {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openBoard(page); // campo-completo, geometría contain estable
      // Colocar y seleccionar un cono.
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      await page.locator('.rail-btn[title="Cono"]').click();
      const b = (await page.locator('.board-host').boundingBox())!;
      const [cx, cy] = normToScreen(0.5, 0.5, b);
      await page.mouse.click(cx, cy, { button: 'right' });
      await expect(page.locator('.field-count')).toHaveText('1');
      await page.waitForTimeout(150);
      await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
      // Fase 3: pulsación larga abre el menú contextual.
      await longPress(page, cx, cy);
      await expect(page.locator('.context-bar')).toBeVisible();
      // Zoom al 150 % (sin cambiar la orientación persistida).
      await page.locator('button[aria-label="Propiedades"]').click();
      const zoom = page.locator('.studio-panel .field', { hasText: 'Zoom' }).locator('input[type="range"]');
      await zoom.evaluate((input) => { (input as HTMLInputElement).value = '1.5'; (input as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true })); });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/movil-${w}-zoom-objeto.png` });
    }
  });

  test('composición final completa', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await seed(page);
    await openBoard(page);
    // Figuras con relleno: Rectángulo relleno, Círculo/elipse relleno y un
    // Rectángulo solo de perímetro. La herramienta "Zona" fue eliminada (Fase 8),
    // así que la composición usa las figuras existentes.
    const b = await page.locator('.board-host').boundingBox();
    async function drawShape(title: string, fill: 'Relleno' | 'Perímetro', from: [number, number], to: [number, number]): Promise<void> {
      await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
      await page.locator(`.rail-btn[title="${title}"]`).click();
      await page.locator('.tools-caption .chip', { hasText: fill }).click();
      const p0 = normToScreen(from[0], from[1], b!);
      const p1 = normToScreen(to[0], to[1], b!);
      await page.mouse.move(p0[0], p0[1]);
      await page.mouse.down();
      await page.mouse.move(p1[0], p1[1], { steps: 5 });
      await page.mouse.up();
    }
    // Rectángulo con relleno (sustituye la antigua "Zona").
    await drawShape('Rectángulo', 'Relleno', [0.3, 0.32], [0.68, 0.7]);
    // Elipse con relleno.
    await drawShape('Círculo / elipse', 'Relleno', [0.71, 0.3], [0.95, 0.62]);
    // Rectángulo únicamente de perímetro (sin relleno).
    await drawShape('Rectángulo', 'Perímetro', [0.26, 0.7], [0.5, 0.92]);
    const place: Array<[string, string, number, number]> = [
      ['Jugador propio', 'Jugadores', 0.36, 0.36],
      ['Jugador propio', 'Jugadores', 0.64, 0.36],
      ['Cono', 'Material', 0.36, 0.64],
      ['Cono', 'Material', 0.64, 0.64],
      ['Balón', 'Material', 0.5, 0.5],
    ];
    for (const [title, cat, nx, ny] of place) {
      await page.locator('.tools-cat', { hasText: cat }).click();
      await page.locator(`.rail-btn[title="${title}"]`).click();
      const p = normToScreen(nx, ny, b!);
      await page.mouse.click(p[0], p[1]);
    }
    // Línea y flecha.
    for (const [tool, f, t] of [['Línea',[0.35,0.35],[0.6,0.4]],['Flecha (movimiento)',[0.5,0.55],[0.62,0.5]]] as Array<[string,[number,number],[number,number]]>) {
      await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
      await page.locator(`.rail-btn[title="${tool}"]`).click();
      const a2 = normToScreen(f[0], f[1], b!); const b2 = normToScreen(t[0], t[1], b!);
      await page.mouse.move(a2[0], a2[1]); await page.mouse.down(); await page.mouse.move(b2[0], b2[1], { steps: 5 }); await page.mouse.up();
    }
    // Texto explicativo.
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    const tp = normToScreen(0.5, 0.85, b!);
    await page.mouse.click(tp[0], tp[1]);
    await page.locator('.studio-panel .inspector textarea').fill('Rondo 5v2\nConservación');
    await page.locator('.studio-panel .inspector textarea').dispatchEvent('change');
    await page.locator('.studio-panel .inspector textarea').evaluate((el) => (el as HTMLElement).blur());
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.locator('.board-host').screenshot({ path: `${SHOTS}/composicion-final.png` });
  });
});

test.describe('Contact sheet de capturas-finales', () => {
  test('genera contact-sheet-legible para capturas-finales', async ({ page }) => {
    const files = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort();
    const rows = files.map((f) => {
      const p = path.resolve(SHOTS, f);
      const b64 = fs.readFileSync(p).toString('base64');
      return `<figure><img src="data:image/png;base64,${b64}" alt="${f}"><figcaption>${f}</figcaption></figure>`;
    }).join('\n');
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;margin:12px;background:#111;color:#eee}h1{font-size:16px}figure{display:inline-block;margin:10px;text-align:center;vertical-align:top}figure img{max-width:480px;border:1px solid #555}figcaption{font-size:12px;margin-top:4px;max-width:480px}</style></head><body><h1>CDMPLab · capturas-finales</h1>' + rows + '</body></html>';
    const file = path.resolve(SHOTS, 'contact-sheet.html');
    fs.writeFileSync(file, html, 'utf8');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    await page.locator('h1').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.resolve(SHOTS, 'contact-sheet.png'), fullPage: true });
  });
});
