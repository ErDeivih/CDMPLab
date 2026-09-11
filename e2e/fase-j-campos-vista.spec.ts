// =============================================================
// FASE J — Encuadre del campo y CAMBIO DE CAMPO con objetos ya colocados.
//
// Dos peticiones del dueño, verificadas aquí con medidas reales en el navegador:
//  1) «que se pueda ver el campo completo en todas sus formas disponibles»: después de ampliar
//     (rueda o deslizador) el control «Ver campo completo» debe dejar el campo ENTERO dentro del
//     lienzo, en los 8 campos base y en las dos orientaciones. Antes solo cambiaba de modo, así
//     que un zoom >100 % seguía recortando y un medio campo vertical no se veía completo.
//  2) «verifica que el cambio de campo con objetos ya puestos funciona con todos los tipos»:
//     con 3 objetos colocados, se cambia a cada uno de los 8 campos y se comprueba que no se
//     pierde ninguno, que todos siguen dentro del campo y que volver al campo completo los
//     conserva.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import { seedBoard, openBoard, hostBox, fieldCount, showCategory } from './board-helpers';

type Box = { x: number; y: number; width: number; height: number };

/** Los 8 campos base de la galería, con la orientación que se probará. */
const CAMPOS: Array<{ nombre: string; id: string }> = [
  { nombre: 'Campo completo', id: 'full' },
  { nombre: 'Medio campo', id: 'half' },
  { nombre: 'Tercio de campo', id: 'third' },
  { nombre: 'Área y portería', id: 'box' },
  { nombre: 'Fútbol sala', id: 'futsal' },
  { nombre: 'F7 transversal', id: 'f7' },
  { nombre: 'Dos medios campos', id: 'two_halves' },
  { nombre: 'Lienzo', id: 'blank' },
];

async function abrePanel(page: Page): Promise<void> {
  if (
    !(await page
      .locator('.studio-panel')
      .isVisible()
      .catch(() => false))
  ) {
    await page.locator('button[aria-label="Propiedades"]').click();
  }
  await expect(page.locator('.studio-panel')).toBeVisible();
}

/** Elige una tarjeta de la galería. Si el campo nuevo es de media extensión y hay objetos, el
 *  producto pregunta CÓMO conservarlos; aquí se responde «Mantener los objetos donde están»,
 *  que cambia al campo PEDIDO sin tocar ninguna coordenada. Es la opción que permite llegar a
 *  F7 con objetos colocados (antes era imposible: solo se ofrecían «dos medios campos» —que deja
 *  el campo en `two_halves`— y «encajar todo» —que lo deja en `half`). Devuelve el campo en el
 *  que queda el documento. */
async function elegirCampo(
  page: Page,
  nombre: string,
  opcionDialogo:
    'Mantener los objetos' | 'Dos medios campos' | 'Encajar todo' = 'Mantener los objetos',
): Promise<string> {
  await abrePanel(page);
  await page.locator('.field-card', { hasText: nombre }).first().click();
  await page.waitForTimeout(220);
  const dialogo = page.locator('.field-change-dialog');
  if (await dialogo.isVisible().catch(() => false)) {
    await dialogo.locator('button', { hasText: opcionDialogo }).click();
    await page.waitForTimeout(220);
  }
  return (await page.locator('.board-host').getAttribute('data-field')) ?? '';
}

/** Marca la orientación con los chips del panel (vertical = «portería arriba»). */
async function orientar(page: Page, o: 'horizontal' | 'vertical'): Promise<void> {
  await abrePanel(page);
  const chip = page.locator(`.studio-panel .chip[data-orient="${o}"]`);
  if (await chip.isVisible().catch(() => false)) await chip.click();
  await page.waitForTimeout(150);
}

/** Caja en pantalla del campo dibujado: se mide el GRUPO `.entrenolab-grass`, que es el
 *  rectángulo real del campo (el mismo criterio que usan los specs de FASE H). NO se mide
 *  `.entrenolab-grass rect`, que es UNA franja del césped y da un ancho falso. */
async function campoBox(page: Page): Promise<Box> {
  const b = (await page.locator('.entrenolab-grass').first().boundingBox()) as Box | null;
  expect(b, 'el campo está dibujado').not.toBeNull();
  return b as Box;
}

/** Coloca un cono, un jugador genérico y una flecha (3 objetos de familias distintas). */
async function colocarObjetos(page: Page): Promise<void> {
  const host = await hostBox(page);
  const p = (nx: number, ny: number) => ({
    x: host.x + host.width * nx,
    y: host.y + host.height * ny,
  });
  await showCategory(page, 'Material');
  await page.locator('.rail-btn[title="Cono"]').click();
  const cerrar = page.locator('.side-panel-left .panel-close');
  if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
  await page.mouse.click(p(0.35, 0.35).x, p(0.35, 0.35).y);
  await showCategory(page, 'Jugadores');
  await page.locator('.tray-quick .tray-quick-chip').nth(0).click();
  if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
  await page.mouse.click(p(0.5, 0.5).x, p(0.5, 0.5).y);
  await showCategory(page, 'Dibujo');
  await page.locator('.rail-btn[title="Flecha (movimiento)"]').click();
  if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
  await page.mouse.move(p(0.4, 0.6).x, p(0.4, 0.6).y);
  await page.mouse.down();
  await page.mouse.move(p(0.6, 0.65).x, p(0.6, 0.65).y, { steps: 5 });
  await page.mouse.up();
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
  await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(3);
}

/** Cada objeto colocado, con su tipo y su caja en pantalla. */
async function objetos(page: Page): Promise<Array<Box & { tipo: string }>> {
  return page.locator('.entrenolab-board g[data-el-type]').evaluateAll((els) =>
    els.map((e) => {
      const r = (e as SVGGElement).getBoundingClientRect();
      return {
        tipo: e.getAttribute('data-el-type') ?? '?',
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
}

test.describe('FASE J — el campo se ve ENTERO en todas sus formas', () => {
  for (const campo of CAMPOS) {
    for (const o of ['horizontal', 'vertical'] as const) {
      test(`${campo.nombre} · ${o}: tras ampliar, «Ver campo completo» lo enseña entero`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1366, height: 768 });
        await seedBoard(page);
        await openBoard(page);
        await elegirCampo(page, campo.nombre);
        await orientar(page, o);

        // 1) Se AMPLÍA con la rueda (acción real del usuario); el panel se cierra después para
        //    poder pulsar el botón de encuadre de la barra de estado (el panel lo tapa).
        const host = (await hostBox(page)) as Box;
        await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -500);
        await page.waitForTimeout(200);
        await abrePanel(page);
        await expect(page.locator('.studio-panel .field', { hasText: 'Zoom' })).not.toContainText(
          '100%',
        );
        const cerrarPanel = page.locator('.studio-panel button[aria-label="Cerrar panel"]');
        if (await cerrarPanel.isVisible().catch(() => false)) await cerrarPanel.click();
        await page.waitForTimeout(200);

        // 2) Si el lienzo está en «Llenar pantalla», se pasa a «Ver campo completo» (que además
        //    restablece el encuadre). Después se pulsa «Volver al encuadre», el botón que aparece
        //    cuando hay zoom o paneo: el campo vuelve a verse ENTERO.
        const verCompleto = page.locator('.field-fit-toggle[aria-label="Ver campo completo"]');
        if (await verCompleto.isVisible().catch(() => false)) await verCompleto.click();
        const volver = page.locator('button[aria-label="Volver al encuadre"]');
        await expect(volver, 'con zoom aplicado aparece «Volver al encuadre»').toBeVisible();
        await volver.click();
        await page.waitForTimeout(300);
        await expect(volver, 'tras volver al encuadre el botón desaparece').toHaveCount(0);

        const entero = await campoBox(page);
        const h2 = (await hostBox(page)) as Box;
        expect(entero.x, 'el campo no se sale por la izquierda').toBeGreaterThanOrEqual(h2.x - 1);
        expect(entero.y, 'el campo no se sale por arriba').toBeGreaterThanOrEqual(h2.y - 1);
        expect(entero.x + entero.width, 'el campo no se sale por la derecha').toBeLessThanOrEqual(
          h2.x + h2.width + 1,
        );
        expect(entero.y + entero.height, 'el campo no se sale por abajo').toBeLessThanOrEqual(
          h2.y + h2.height + 1,
        );
        // El zoom queda deshecho: el propio botón desaparece (solo existe con zoom o paneo), que
        // es la prueba observable de que la vista volvió a su encuadre neutro. No se consulta el
        // deslizador del panel porque el panel se ha cerrado para poder pulsar este botón.
      });
    }
  }
});

test.describe('FASE J — cambiar de campo con objetos ya colocados', () => {
  for (const destino of CAMPOS) {
    test(`de Campo completo a ${destino.nombre}: no se pierde ni se sale ningún objeto`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: 1366, height: 768 });
      await seedBoard(page);
      await openBoard(page);
      await elegirCampo(page, 'Campo completo');
      await colocarObjetos(page);

      // Con «Mantener los objetos donde están» el documento queda en el campo PEDIDO —los 8
      // tipos, F7 incluido—: esa opción existe precisamente para poder cambiar de campo sin
      // recolocar nada (antes, con objetos, era imposible llegar a F7).
      const campoFinal = await elegirCampo(page, destino.nombre);
      expect(campoFinal, `el documento queda en ${destino.id}`).toBe(destino.id);
      await expect(page.locator('.field-count'), 'no se pierde ningún objeto').toHaveText('3');

      // Todos los objetos siguen dentro del campo (con 1 px de tolerancia por el trazo).
      const caja = await campoBox(page);
      for (const o of await objetos(page)) {
        const donde = `${o.tipo} [${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.width)}x${Math.round(o.height)}] campo [${Math.round(caja.x)},${Math.round(caja.y)} ${Math.round(caja.width)}x${Math.round(caja.height)}]`;
        expect(o.x, `objeto dentro del campo (izquierda): ${donde}`).toBeGreaterThanOrEqual(
          caja.x - 1,
        );
        expect(o.y, `objeto dentro del campo (arriba): ${donde}`).toBeGreaterThanOrEqual(
          caja.y - 1,
        );
        expect(o.x + o.width, `objeto dentro del campo (derecha): ${donde}`).toBeLessThanOrEqual(
          caja.x + caja.width + 1,
        );
        expect(o.y + o.height, `objeto dentro del campo (abajo): ${donde}`).toBeLessThanOrEqual(
          caja.y + caja.height + 1,
        );
      }

      // Y volver al campo completo los conserva.
      const vuelta = await elegirCampo(page, 'Campo completo');
      expect(vuelta, 'vuelve al campo completo').toBe('full');
      await expect(page.locator('.field-count'), 'vuelven los 3 objetos').toHaveText('3');
    });
  }
});
