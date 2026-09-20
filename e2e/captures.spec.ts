import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';
import fs from 'node:fs';

const SHOTS = 'e2e/shots/after';
fs.mkdirSync(SHOTS, { recursive: true });

/** Replica el letterboxing del canvas (horizontal) para mapear 0..1 → pantalla. */
function normToScreen(
  nx: number,
  ny: number,
  box: { x: number; y: number; width: number; height: number },
): [number, number] {
  const rect = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };
  const s = Math.min(box.width / 100, box.height / 80);
  const offX = (box.width - 100 * s) / 2;
  const offY = (box.height - 80 * s) / 2;
  return [box.x + offX + (nx * rect.w + rect.x) * s, box.y + offY + (ny * rect.h + rect.y) * s];
}

/** Punto de pantalla SOBRE el trazo dibujado, leído del propio SVG del tablero.
 *
 * Antes esta prueba pulsaba una coordenada normalizada aproximada (0.52, 0.51) y daba por hecho que
 * caía sobre la curva. Medido: con el campo más alto (al retirarse la franja de estado el lienzo
 * crece ~5,7 %) ese punto quedaba a 16 px del trazo —el `elementFromPoint` devolvía el `rect` del
 * campo— así que no seleccionaba nada. El fallo era de la PRUEBA (aproximaba), no de la app: el
 * trazo está exactamente donde dice el SVG, así que se pregunta al propio SVG. */
async function puntoSobreTrazo(page: Page, fraccion = 0.1): Promise<{ x: number; y: number }> {
  return page
    .locator('.entrenolab-board [data-el-type="curve"] path')
    .first()
    .evaluate((el, f) => {
      const path = el as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() * f);
      const punto = path.ownerSVGElement!.createSVGPoint();
      punto.x = p.x;
      punto.y = p.y;
      const enPantalla = punto.matrixTransform(path.getScreenCTM()!);
      return { x: enPantalla.x, y: enPantalla.y };
    }, fraccion);
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Almacenamiento aislado: nada de residuo de otros casos antes de sembrar.
    for (const k of Object.keys(localStorage))
      if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    const players = [
      {
        id: 'p1',
        teamId: 't1',
        name: 'Marcos',
        number: 2,
        position: 'DF',
        color: '#1a73e8',
        active: true,
        createdAt: now,
      },
      {
        id: 'p2',
        teamId: 't1',
        name: 'Pau',
        number: 10,
        position: 'MF',
        color: '#c0392b',
        active: true,
        createdAt: now,
      },
      {
        id: 'p3',
        teamId: 't1',
        name: 'Dani',
        number: 1,
        position: 'GK',
        color: '#1a73e8',
        active: true,
        createdAt: now,
      },
    ];
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem(
      'entrenolab:folders',
      JSON.stringify([
        { id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' },
        { id: 'f2', teamId: 't1', parentId: 'f1', name: 'Rondos' },
      ]),
    );
    localStorage.setItem(
      'entrenolab:exercises',
      JSON.stringify([
        {
          id: 'e1',
          teamId: 't1',
          folderId: 'f2',
          title: 'Rondo 4v2',
          description: 'Conservación del balón con superioridad.',
          explanation: '4 poseedores contra 2 defensas.',
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
            field: 'half',
            frames: [],
            orientation: 'horizontal',
            grass: 'stripes',
            lineColor: '#ffffff',
            backgroundColor: '#31834a',
          },
          thumbnail: null,
          savedAt: now,
        },
      ]),
    );
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

test.describe('Capturas baseline', () => {
  test('escritorio 1366x900', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/team');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/desktop-plantilla.png` });
    await page.goto('/board');
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left .roster-item').first().click();
    // Tocar un jugador arma la colocación (FASE B: el panel permanece abierto, no se cierra
    // al elegir el jugador); el clic en el campo lo coloca.
    const box = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5, { button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/desktop-pizarra.png` });
    await page.goto('/library');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/desktop-biblioteca.png` });
    await page.goto('/sessions');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/desktop-sesiones.png` });
    await expect(page).toBeTruthy();
  });

  test('movil 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await page.goto('/team');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/movil-plantilla.png` });
    await page.goto('/board');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/movil-pizarra.png` });
    await page.goto('/library');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/movil-biblioteca.png` });
    await page.goto('/sessions');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/movil-sesiones.png` });
    await expect(page).toBeTruthy();
  });

  test('captura 6 campos (full/half/blank) × orientación (horizontal/vertical) para la revisión visual', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    await page.locator('button[aria-label="Propiedades"]').click();
    await expect(page.locator('.studio-panel [aria-label="Campo base"]')).toBeVisible();

    const combos: Array<[string, string]> = [
      ['full', 'horizontal'],
      ['full', 'vertical'],
      ['half', 'horizontal'],
      ['half', 'vertical'],
      ['blank', 'horizontal'],
      ['blank', 'vertical'],
    ];
    for (const [field, orient] of combos) {
      await page.locator('.studio-panel [aria-label="Campo base"]').selectOption(field);
      // Decisión del dueño: la orientación se elige por el valor estable data-orient
      // (el texto visible ahora describe el RESULTADO y depende del campo).
      await page
        .locator('.studio-panel .field', { hasText: 'Orientación' })
        .locator(`.chip[data-orient="${orient}"]`)
        .click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/board-${field}-${orient}.png` });
    }
    await expect(page.locator('.board-host')).toBeVisible();
  });

  test('captura limpia: barra de edición con la animación cerrada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    // La barra persistente de edición (Deshacer/Rehacer/Seleccionar) vive en el raíl inferior.
    await expect(page.locator('.studio-tools')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/pizarra-barra-edicion.png` });
  });

  test('captura limpia: texto multilínea', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const pt = (fx: number, fy: number) =>
      [box.x + box.width * fx, box.y + box.height * fy] as const;
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Texto"]').click();
    await page.mouse.click(...pt(0.3, 0.3));
    const textarea = page.locator('.studio-panel .inspector textarea').first();
    await textarea.fill('Rondos 4v2\nConservación');
    await textarea.dispatchEvent('change');
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3);
    await page.mouse.click(...pt(0.3, 0.3));
    await page.screenshot({ path: `${SHOTS}/pizarra-texto-multilinea.png` });
  });

  test('captura limpia: curva seleccionada con manijas separadas', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.rail-btn[title="Curva derecha"]').click();
    const [c1, c2] = normToScreen(0.5, 0.5, box);
    const [c3, c4] = normToScreen(0.85, 0.6, box);
    await page.mouse.move(c1, c2);
    await page.mouse.down();
    await page.mouse.move(c3, c4, { steps: 4 });
    await page.mouse.up();
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
    // Fase 3: el clic selecciona el elemento y abre el inspector (Propiedades). El punto se pide AL
    // SVG (un 10 % a lo largo del trazo), no se aproxima con coordenadas normalizadas: la medición
    // demostró que la aproximación anterior caía 16 px fuera del trazo.
    const puntoCurva = await puntoSobreTrazo(page, 0.1);
    await page.mouse.click(puntoCurva.x, puntoCurva.y);
    await expect(page.locator('.inspector')).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/pizarra-curva-manijas.png` });
  });

  test('captura limpia: material (pica) seleccionado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page);
    await page.goto('/board');
    const box = (await page.locator('.board-host').boundingBox())!;
    const pt = (fx: number, fy: number) =>
      [box.x + box.width * fx, box.y + box.height * fy] as const;
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Pica"]').click();
    await page.mouse.click(...pt(0.5, 0.5));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/pizarra-materiales.png` });
  });
});
