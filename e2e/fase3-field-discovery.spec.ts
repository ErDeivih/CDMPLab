import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/fase3';
fs.mkdirSync(SHOTS, { recursive: true });

// Tamaños móviles que el dueño usa para probar: 360×800, 390×844, 430×932.
const MOBILE: Array<[number, number]> = [
  [360, 800],
  [390, 844],
  [430, 932],
];

type Box = { x: number; y: number; width: number; height: number };

// Rect canónico de contenido (largo→X, ancho→Y) de un campo 105×68 en el viewBox 100×80.
const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
const VBW = 100;
const VBH = 80;

/** Forward norm→pantalla (la inversa de screenToNorm) para el campo en horizontal.
 *  `fit` = 'height' (llenar pantalla) | 'contain' (campo completo). */
function normToScreen(
  nx: number,
  ny: number,
  host: Box,
  fit: 'height' | 'contain',
  panX = 0,
  panY = 0,
  zoom = 1
): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  const ox = host.width / 2;
  const oy = host.height / 2;
  return { x: host.x + ox + panX + zoom * (cx - ox), y: host.y + oy + panY + zoom * (cy - oy) };
}

/** Inversa: pantalla→norm para el campo horizontal (replica screenToNorm de render.ts).
 *  Se usa para verificar el round-trip tras panear y mover un objeto. */
function screenToNorm(
  clientX: number,
  clientY: number,
  host: Box,
  fit: 'height' | 'contain',
  panX = 0,
  panY = 0,
  zoom = 1
): { x: number; y: number } {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const ox = host.width / 2;
  const oy = host.height / 2;
  const cx = ox + (clientX - host.x - panX - ox) / zoom;
  const cy = oy + (clientY - host.y - panY - oy) / zoom;
  const vbX = (cx - offX) / s;
  const vbY = (cy - offY) / s;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x: clamp01((vbX - RECT.x) / RECT.w),
    y: clamp01((vbY - RECT.y) / RECT.h),
  };
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Sembrar UNA vez (no borrar en cada navegación): así las preferencias persistidas
    // con localStorage sobreviven a un reload del test.
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:orient-hint', '1'); // Fase 2: probar la pista sin el aviso de orientación
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
    ]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Abre la pizarra con los paneles cerrados y la ayuda descartada. */
async function openClosed(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) {
    await page.locator('.help-close').click();
  }
}

/** Caja del área usable real del host (entre la cabecera y el raíl inferior). */
async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b, 'el host (.board-host) debe existir').not.toBeNull();
  return b!;
}

/** Ancho (px) real del canvas en "Llenar pantalla" (el que se definió con style.width). */
async function canvasWidth(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat((document.querySelector('.board-canvas') as HTMLElement).style.width));
}

/** Modo "Llenar pantalla" por defecto (móvil, sin preferencia guardada). */
function expectFillMode(page: Page): Promise<void> {
  return expect(page.locator('.board-host')).toHaveClass(/board-fill/);
}

/** Arrastra (arrastre de campo vacío = PANEAR la vista) hasta saturar el extremo que
 *  revela la portería `goal`. Un gesto hacia la DERECHA (+panX) revela la IZQUIERDA;
 *  hacia la IZQUIERDA (−panX) revela la DERECHA.
 *
 *  El campo en "Llenar pantalla" rellena la ALTURA del host (escala derivada del rect de
 *  contenido, no del viewBox), así que su ANCHO —y con él el RANGO de paneo `[min,max]` =
 *  ±(canvasWidth·zoom − hostWidth)/2— es MAYOR que antes: un único arrastre de borde a
 *  borde del host (≲ hostWidth−80 px) ya no basta para llegar a la portería. Por eso se
 *  repite el arrastre: cada arrastre vacío acumula panX (panX se suma desde su valor
 *  actual y queda clampeado al rango del contenido) hasta que el indicador del extremo
 *  buscado desaparece. No se debilita ninguna aserción: al terminar, el indicador del
 *  lado revelado debe estar oculto y el contrario visible (lo verifican los tests). */
async function panToGoal(page: Page, host: Box, goal: 'left' | 'right'): Promise<void> {
  const y = host.y + host.height / 2;
  const startX = goal === 'left' ? host.x + 40 : host.x + host.width - 40;
  const endX = goal === 'left' ? host.x + host.width - 40 : host.x + 40;
  const targetSel = goal === 'left' ? '.edge-pan-left' : '.edge-pan-right';
  // Ancho máximo de las iteraciones: cada arrastre aporta ~hostWidth−80 px de paneo y el
  // campo desborda menos de 3× el ancho del host en los móviles objetivo, así que 20
  // bastan con margen; el clamp evita pasarse y el bucle comprueba el indicador real.
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 8 });
    await page.mouse.up();
    // La señal panX → DOM (la @if retira el indicador) se aplica en el cambio de
    // detección: esperar a que el indicador objetivo desaparezca antes de reintentar.
    const done = await page
      .waitForFunction((sel) => !document.querySelector(sel), targetSel, { timeout: 400 })
      .then(() => true)
      .catch(() => false);
    if (done) return;
  }
}

test.describe('Fase 3 — descubribilidad del campo oculto en "Llenar pantalla" (indicadores)', () => {
  test.use({ hasTouch: true });

  for (const [w, h] of MOBILE) {
    test(`[${w}x${h}] inicialmente hay contenido oculto a BANDOS → ambos indicadores visibles`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      // En llenar pantalla el campo desborda el ancho del host: los dos extremos
      // (porterías) quedan ocultos → ambos indicadores deben ser visibles.
      await expect(page.locator('.edge-pan-left')).toBeVisible();
      await expect(page.locator('.edge-pan-right')).toBeVisible();
    });

    test(`[${w}x${h}] el indicador izquierdo está en el borde IZQUIERDO y el derecho en el DERECHO`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      await expect(page.locator('.edge-pan-left')).toBeVisible();
      await expect(page.locator('.edge-pan-right')).toBeVisible();
      const host = await hostBox(page);
      const left = (await page.locator('.edge-pan-left').boundingBox())!;
      const right = (await page.locator('.edge-pan-right').boundingBox())!;
      const centerX = host.x + host.width / 2;
      // El izquierdo está a la izquierda del centro; el derecho a la derecha.
      expect(left.x + left.width / 2, 'centro del indicador izquierdo < centro del host').toBeLessThan(centerX);
      expect(right.x + right.width / 2, 'centro del indicador derecho > centro del host').toBeGreaterThan(centerX);
      // Ambos pegados a su borde (cerca del borde correspondiente del host).
      expect(Math.abs(left.x - host.x), 'indicador izquierdo junto al borde izquierdo').toBeLessThan(4);
      expect(Math.abs(right.x + right.width - (host.x + host.width)), 'indicador derecho junto al borde derecho').toBeLessThan(4);
    });

    test(`[${w}x${h}] panear (arrastre vacío) hacia la DERECHA revela la portería IZQUIERDA → el indicador IZQUIERDO desaparece`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      await expect(page.locator('.edge-pan-left')).toBeVisible();
      await expect(page.locator('.edge-pan-right')).toBeVisible();

      const host = await hostBox(page);
      // Arrastrar vacío hacia la DERECHA (+panX) → se revela la portería IZQUIERDA →
      // se alcanza el extremo izquierdo → el indicador IZQUIERDO desaparece.
      await panToGoal(page, host, 'left');
      await expect(page.locator('.edge-pan-left')).toBeHidden();
      // Al haber paneado a la izquierda, el contenido derecho queda MÁS oculto: el
      // indicador derecho sigue visible (los indicadores cambian con el paneo).
      await expect(page.locator('.edge-pan-right')).toBeVisible();
    });

    test(`[${w}x${h}] panear (arrastre vacío) hacia la IZQUIERDA revela la portería DERECHA → el indicador DERECHO desaparece`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      await expect(page.locator('.edge-pan-left')).toBeVisible();
      await expect(page.locator('.edge-pan-right')).toBeVisible();

      const host = await hostBox(page);
      // Arrastrar vacío hacia la IZQUIERDA (−panX) → se revela la portería DERECHA →
      // se alcanza el extremo derecho → el indicador DERECHO desaparece.
      await panToGoal(page, host, 'right');
      await expect(page.locator('.edge-pan-right')).toBeHidden();
      // El contenido izquierdo queda más oculto: el indicador izquierdo sigue visible.
      await expect(page.locator('.edge-pan-left')).toBeVisible();
    });

    test(`[${w}x${h}] en "Campo completo" los indicadores de contenido oculto desaparecen`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      await expect(page.locator('.edge-pan-left')).toBeVisible();
      await expect(page.locator('.edge-pan-right')).toBeVisible();

      // Cambiar a "Campo completo": el campo cabe entero → sin pan → sin indicadores.
      await page.locator('.field-fit-toggle').click();
      await expect(page.locator('.board-host')).not.toHaveClass(/board-fill/);
      await expect(page.locator('.edge-pan-left')).toBeHidden();
      await expect(page.locator('.edge-pan-right')).toBeHidden();

      // Volver a "Llenar pantalla": reaparecen.
      await page.locator('.field-fit-toggle').click();
      await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
      await expect(page.locator('.edge-pan-left')).toBeVisible();
      await expect(page.locator('.edge-pan-right')).toBeVisible();
    });
  }

  test('colocar un objeto DESPUÉS de panear y moverlo aterriza en las coords normalizadas esperadas (round-trip)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await expectFillMode(page);
    const host = await hostBox(page);

    // Panear a la portería DERECHA (se satura panX en su mínimo).
    await panToGoal(page, host, 'right');
    const cw = await canvasWidth(page);
    const panX = -(cw - host.width) / 2; // extremo derecho (zoom=1)

    const P = { x: 0.75, y: 0.5 }; // mitad derecha, visible tras panear a la derecha
    const S = normToScreen(P.x, P.y, host, 'height', panX);

    // Colocar un Portero en S.
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await expect(page.locator('.side-panel-left')).toBeVisible();
    await page.locator('.tray-player[title="Portero"]').click();
    await expect(page.locator('.side-panel-left')).toHaveCount(0);
    await page.touchscreen.tap(S.x, S.y);
    await expect(page.locator('.field-count')).toHaveText('1');

    const circle = page.locator('.entrenolab-board circle[r="2.5"]').first();
    await expect(circle).toHaveCount(1);
    // El elemento RENDERIZADO debe estar donde se tocó (consistencia pantalla↔modelo).
    const cb = (await circle.boundingBox())!;
    expect(Math.abs(cb.x + cb.width / 2 - S.x), 'centro X del elemento ≈ toque tras paneo').toBeLessThan(6);
    expect(Math.abs(cb.y + cb.height / 2 - S.y), 'centro Y del elemento ≈ toque tras paneo').toBeLessThan(6);

    // El norm almacenado en el modelo es el esperado (leído del translate del SVG).
    const pos = await circle.evaluate((el) => {
      const g = el.closest('g');
      const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });
    expect(pos).not.toBeNull();
    expect((pos!.x - RECT.x) / RECT.w, 'norm x almacenado tras paneo').toBeCloseTo(P.x, 2);
    expect((pos!.y - RECT.y) / RECT.h, 'norm y almacenado tras paneo').toBeCloseTo(P.y, 2);

    // Mover el objeto (arrastrar la BOLITA, no el campo) por un delta de pantalla y
    // comprobar que el modelo se actualiza al norm del punto final (screenToNorm).
    const ddx = 30;
    const ddy = 20;
    await page.mouse.move(S.x, S.y);
    await page.mouse.down();
    await page.mouse.move(S.x + ddx, S.y + ddy, { steps: 5 });
    await page.mouse.up();

    const pos2 = await circle.evaluate((el) => {
      const g = el.closest('g');
      const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(g?.getAttribute('transform') ?? '');
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });
    expect(pos2).not.toBeNull();
    const exp = screenToNorm(S.x + ddx, S.y + ddy, host, 'height', panX);
    expect((pos2!.x - RECT.x) / RECT.w, 'norm x tras mover el objeto').toBeCloseTo(exp.x, 2);
    expect((pos2!.y - RECT.y) / RECT.h, 'norm y tras mover el objeto').toBeCloseTo(exp.y, 2);
    // El count no cambia al mover (solo se desliza el objeto).
    await expect(page.locator('.field-count')).toHaveText('1');
  });
});

test.describe('Fase 3 — pista única de recorrido del campo (helper)', () => {
  test.use({ hasTouch: true });

  test('la pista aparece la primera vez, se auto-oculta y NO reaparece en una visita posterior', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await expectFillMode(page);

    // Primera visita: la pista está visible.
    await expect(page.locator('.fill-hint')).toBeVisible();

    // Se auto-oculta (no ocupa espacio permanente).
    await expect(page.locator('.fill-hint')).toBeHidden({ timeout: 7000 });

    // Visita posterior (reload): no reaparece (persistida en localStorage).
    await page.reload();
    await expect(page.locator('.board-host')).toBeVisible();
    await expectFillMode(page);
    await expect(page.locator('.fill-hint')).toBeHidden();
  });

  test('la pista es descartable manualmente y sigue sin reaparecer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await openClosed(page);
    await expectFillMode(page);
    await expect(page.locator('.fill-hint')).toBeVisible();

    await page.locator('.fill-hint-close').click();
    await expect(page.locator('.fill-hint')).toBeHidden();

    await page.reload();
    await expect(page.locator('.board-host')).toBeVisible();
    await expect(page.locator('.fill-hint')).toBeHidden();
  });
});

test.describe('Fase 3 — capturas (indicadores + pista y tras paneo)', () => {
  test.use({ hasTouch: true });

  for (const [w, h] of MOBILE) {
    test(`captura ${w}x${h}: llenar pantalla (indicadores + pista) y tras paneo a una portería`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page);
      await openClosed(page);
      await expectFillMode(page);
      // Un Portero visible para que la pizarra no esté vacía (no abre inspector).
      await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
      await expect(page.locator('.side-panel-left')).toBeVisible();
      await page.locator('.tray-player[title="Portero"]').click();
      await expect(page.locator('.side-panel-left')).toHaveCount(0);
      const host = await hostBox(page);
      const c = normToScreen(0.5, 0.5, host, 'height');
      await page.touchscreen.tap(c.x, c.y);
      await expect(page.locator('.field-count')).toHaveText('1');

      // Estado inicial: ambos indicadores + pista visible.
      await expect(page.locator('.edge-pan-left')).toBeVisible();
      await expect(page.locator('.edge-pan-right')).toBeVisible();
      await expect(page.locator('.fill-hint')).toBeVisible();
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/${w}x${h}-indicadores-pista.png` });

      // Panear a la portería IZQUIERDA → indicador izquierdo desaparece.
      await panToGoal(page, host, 'left');
      await expect(page.locator('.edge-pan-left')).toBeHidden();
      await expect(page.locator('.edge-pan-right')).toBeVisible();
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${SHOTS}/${w}x${h}-pan-left-indicador-guardado.png` });
    });
  }
});
