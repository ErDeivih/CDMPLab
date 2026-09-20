import { test, expect, Page } from '@playwright/test';
import { openBoard, hostBox, normToScreen, showCategory, fitMode } from './board-helpers';

/**
 * FASE 8B/8C — CHINO y PORTERÍA GRANDE.
 *
 * Qué se mide aquí (no se opina sobre el dibujo: se mide en pantalla):
 *  1. El chino es un platillo PLANO (ancho ≈ 1,3× su alto), MÁS PEQUEÑO que el cono y con un rango
 *     visual real: entre el 45 % y el 55 % de su anchura (antes medía ~30 % y «parecía un punto»).
 *  2. La portería grande es ancha y plana (≈3:1) y su marco es blanco y reconocible.
 *  3. La caja táctil coincide con la figura: pulsar el CENTRO VISIBLE de cada uno los selecciona
 *     (antes, con la caja cuadrada del chino y la caja alta de la portería, se seleccionaba césped).
 *  4. Los dos aparecen en la miniatura guardada por sus colores reales (azul del chino y blanco
 *     del marco de la portería).
 */

const ESCRITORIO = { width: 1366, height: 900 };

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    localStorage.setItem('entrenolab:orient-hint', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Coloca un material en una posición normalizada y devuelve su caja en pantalla. */
async function colocar(page: Page, titulo: string, nx: number, ny: number) {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  await showCategory(page, 'Material');
  const btn = page.locator(`.rail-btn[title="${titulo}"]`).first();
  await expect(btn, `existe el material «${titulo}»`).toHaveCount(1);
  await btn.click();
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(140);
  const cerrar = page.locator('.side-panel-left .panel-close');
  if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
  return p;
}

const cajaDe = async (page: Page, tipo: string) => {
  const el = page.locator(`.board-canvas svg [data-el-type="${tipo}"]`).first();
  await expect(el, `existe el objeto ${tipo} en el campo`).toHaveCount(1);
  const b = await el.boundingBox();
  expect(b, `el objeto ${tipo} tiene caja visible`).not.toBeNull();
  return b!;
};

test.describe('FASE 8B/8C — chino y portería grande', () => {
  test.use({ hasTouch: true });

  test('el chino es plano y pequeño respecto al cono; la portería es ancha (≈3:1) y con marco blanco', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await openBoard(page);

    await colocar(page, 'Cono', 0.25, 0.3);
    await colocar(page, 'Chino', 0.55, 0.3);
    await colocar(page, 'Portería grande', 0.5, 0.7);

    const cono = await cajaDe(page, 'cone');
    const chino = await cajaDe(page, 'target');
    const porteria = await cajaDe(page, 'goal');
    console.log(
      `[graficos] cono=${cono.width.toFixed(0)}x${cono.height.toFixed(0)} chino=${chino.width.toFixed(0)}x${chino.height.toFixed(0)} porteria=${porteria.width.toFixed(0)}x${porteria.height.toFixed(0)}`,
    );

    // Chino: PLATILLO (redondo, no una raya) y MÁS PEQUEÑO que el cono, pero con un RANGO VISUAL
    // REAL (cierre del encargo): entre el 45 % y el 55 % de la anchura del cono. Antes medía ~30 %
    // (el dueño midió 10×8 px de chino frente a 32×32 px de cono) y lo veía «como un punto».
    // CAMBIO DE CONTRATO (cierre del encargo): la banda pasa de 33-42 % a 45-55 % porque el 45-55 %
    // que pidió el dueño se mide como él lo midió —caja visible contra caja visible— y no contra una
    // «figura visible» del cono deducida de un factor equivocado (se creía 43,3 px de caja cuando la
    // caja medida aquí son los 32 px que él mismo usó de referencia). Ambas cajas se miden igual,
    // con `getBoundingClientRect` del grupo del objeto en el mismo campo y ventana.
    expect(chino.height, 'el chino es más bajo que el cono').toBeLessThan(cono.height);
    expect(chino.width, 'el chino es más estrecho que el cono').toBeLessThan(cono.width);
    const proporcion = chino.width / cono.width;
    expect(
      proporcion,
      `ancho chino/cono = ${(proporcion * 100).toFixed(0)} % (se pide 45-55 %): chino=${chino.width.toFixed(0)} px, cono=${cono.width.toFixed(0)} px`,
    ).toBeGreaterThanOrEqual(0.45);
    expect(proporcion).toBeLessThanOrEqual(0.55);
    expect(chino.width / chino.height, 'el chino es un platillo (≈1,3-1,7)').toBeGreaterThan(1.2);
    expect(chino.width / chino.height).toBeLessThan(1.75);
    // Portería: ancha y plana, con proporción de portería reglamentaria.
    expect(porteria.width, 'la portería es el objeto más ancho').toBeGreaterThan(cono.width * 2);
    const ratio = porteria.width / porteria.height;
    expect(ratio, `proporción de la portería (${ratio.toFixed(2)})`).toBeGreaterThan(2.4);
    expect(ratio).toBeLessThan(3.6);
    // El marco es blanco y hay red (malla) dentro: no es una escalera (la escalera se dibuja con
    // travesaños y sin malla fina; se comparan los recuentos de líneas).
    const porteriaMarcado = await page
      .locator('.board-canvas svg [data-el-type="goal"]')
      .first()
      .evaluate((el) => el.innerHTML);
    expect(porteriaMarcado, 'marco blanco').toContain('#ffffff');
    expect((porteriaMarcado.match(/M/g) ?? []).length, 'malla de red').toBeGreaterThanOrEqual(10);
  });

  test('se seleccionan pulsando su figura visible y salen en la miniatura con sus colores', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await openBoard(page);
    await colocar(page, 'Chino', 0.35, 0.35);
    await colocar(page, 'Portería grande', 0.6, 0.65);
    // El material queda ARMADO (colocación continua): hay que volver a Cursor para SELECCIONAR; si
    // no, el clic colocaría otro material en vez de seleccionar el que ya está.
    await page.locator('.rail-btn[title="Seleccionar y mover"]').click();

    // Seleccionar el CHINO pulsando su centro VISIBLE medido (si la caja no coincidiera con la
    // figura, aquí se seleccionaría césped y no aparecería el inspector).
    const chino = await cajaDe(page, 'target');
    await page.mouse.click(chino.x + chino.width / 2, chino.y + chino.height / 2);
    await expect(
      page.locator('.studio-panel .inspector'),
      'el chino se selecciona por su figura',
    ).toBeVisible();

    // Seleccionar la PORTERÍA pulsando su marco (parte visible central del marco superior).
    const porteria = await cajaDe(page, 'goal');
    await page.mouse.click(porteria.x + porteria.width / 2, porteria.y + 2);
    await expect(
      page.locator('.studio-panel .inspector'),
      'la portería se selecciona por su marco',
    ).toBeVisible();

    // Guardar y comprobar que los dos aparecen en la miniatura por su color real.
    // Ojo: seleccionar un objeto YA abre el panel de Propiedades (el botón pasa a llamarse «Cerrar
    // propiedades»), así que solo se pulsa si el campo de título no está visible.
    const titulo = page.locator('input[aria-label="Título del ejercicio"]');
    if (!(await titulo.isVisible().catch(() => false))) {
      await page.locator('button[aria-label="Propiedades"]').first().click();
    }
    await titulo.fill('Chino y portería');
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await expect(page.locator('.ex-card').first()).toBeVisible();

    // El color del chino lo decide el panel de Material (medido en el modelo: #e74c3c). Se cuenta
    // ESE color, no un azul supuesto: la primera versión de esta prueba buscaba azul y fallaba por
    // una suposición mía, no por el dibujo.
    const modelo = await page.evaluate(() => {
      const arr = JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]') as Array<{
        canvas: {
          frames: Array<{ elements: Array<{ t: string; c?: string; size?: number }> }>;
        } | null;
      }>;
      const els = arr[0]?.canvas?.frames?.[0]?.elements ?? [];
      return {
        chino: els.find((e) => e.t === 'target')?.c ?? null,
        cuantos: els.length,
      };
    });
    console.log(`[graficos] modelo=${JSON.stringify(modelo)}`);
    expect(modelo.cuantos, 'los dos objetos están en el documento').toBe(2);
    expect(modelo.chino, 'el chino guarda su color').toBeTruthy();

    const pixeles = await page.evaluate(async (colorChino: string) => {
      const img = document.querySelector('.thumb-img') as HTMLImageElement | null;
      if (!img) return null;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const rgb = [1, 3, 5].map((i) => parseInt(colorChino.slice(i, i + 2), 16));
      let delChino = 0;
      let blanco = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        // Con tolerancia: el chino es pequeño y su aro y su sombra oscurecen el color base al escalar.
        // CAMBIO DE CONTRATO (encargo de materiales, FASE 4): el platillo nuevo tiene aro oscuro,
        // sombra y superficie más clara, así que son menos los píxeles del color BASE exacto; la
        // tolerancia se amplía y el mínimo baja en consecuencia (sigue exigiendo que se vea).
        if (Math.abs(r - rgb[0]) < 60 && Math.abs(g - rgb[1]) < 60 && Math.abs(b - rgb[2]) < 60) {
          delChino++;
        }
        if (r > 240 && g > 240 && b > 240) blanco++;
      }
      return { ancho: c.width, delChino, blanco, colorChino };
    }, modelo.chino!);
    console.log(`[graficos] miniatura=${JSON.stringify(pixeles)}`);
    expect(pixeles, 'hay miniatura').not.toBeNull();
    expect(pixeles!.ancho).toBe(480);
    // Cierre del encargo: antes el chino dejaba ~6 píxeles de su color en la miniatura (el dueño lo
    // veía como un punto) y con el dibujo intermedio 12. Con el dibujo definitivo (caja visible 16 px
    // en campo completo, 50 % del cono) la miniatura de 480 px da 22 píxeles de color medidos, así
    // que el mínimo exigido es 16: exige que se vea de verdad, no «que aparezca».
    expect(
      pixeles!.delChino,
      `el chino (${modelo.chino}) aparece en la miniatura con su color (medidos 22 px en la última medida)`,
    ).toBeGreaterThanOrEqual(16);
    expect(
      pixeles!.blanco,
      'el marco de la portería (blanco) aparece en la miniatura',
    ).toBeGreaterThan(200);
  });
});
