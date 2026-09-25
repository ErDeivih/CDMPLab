// =============================================================
// AUDITORÍA FINAL — Doble clic y papelera, en escenarios DUROS y con repetición.
//
// Intermitencia detectada por la suite completa: el menú contextual no se abría con doble
// clic porque la ventana de doble clic se medía con `performance.now()` DENTRO del
// manejador (que puede ejecutarse tarde si el hilo principal está ocupado repintando el
// inspector) en vez de con el `timeStamp` del EVENTO. Aquí se repite el gesto muchas veces
// (×50, ver la puerta de la auditoría) y en escenarios que estresan la disposición: zoom,
// «Llenar pantalla», bordes del campo y panel de propiedades abierto/cerrado.
//
// Segunda causa, medida DESPUÉS con una traza temporal del componente (×50 y ×100): el
// gesto de esta misma prueba llevaba un `delay: 40` artificial, con lo que el hueco real
// entre los dos clics quedaba en 104–350 ms, es decir pegado al umbral de 350 ms del
// producto. Con la máquina cargada lo superaba y la app veía dos clics sueltos (que es lo
// correcto). El gesto ahora se mide (`doubleClick`) y se exige que caiga dentro de la
// ventana: si vuelve a fallar por esto, el fallo dice por qué.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import {
  seedBoard,
  openBoard,
  hostBox,
  fitMode,
  fieldCount,
  normToScreen,
  showCategory,
} from './board-helpers';
import { longPress, toggleFillScreen } from './gesture-helpers';

/** El cono sigue ofreciendo acciones, pero no puede tumbarse. */
const CTX_BUTTONS = ['Duplicar', 'Eliminar'];

/** Zoom actual del lienzo (para el escenario con zoom). */
async function zoom(page: Page): Promise<number> {
  return page.locator('.board-canvas').evaluate((el) => {
    const m = /scale\(\s*(-?[\d.]+)\s*\)/.exec((el as HTMLElement).style.transform);
    return m ? parseFloat(m[1]) : 1;
  });
}

/** Centro en PANTALLA del cono colocado (se relee: con zoom o «Llenar pantalla» cambia).
 *  Se espera a que el objeto tenga caja: el lienzo se repinta entero tras cada cambio de
 *  herramienta, así que leer la caja justo en medio de un repintado puede dar null. Esto
 *  es esperar a una PRECONDICIÓN (que el objeto esté dibujado), no sustituir una aserción
 *  del gesto por una espera. */
async function coneCentre(page: Page): Promise<{ x: number; y: number }> {
  type Box = { x: number; y: number; width: number; height: number };
  let box: Box | null = null;
  await expect
    .poll(
      async () => {
        box = (await page
          .locator('.entrenolab-board g[data-el-type="cone"]')
          .first()
          .boundingBox()) as Box | null;
        return box !== null;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  const b = box as unknown as Box;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Doble clic REAL sobre el objeto, comprobando además que los dos clics han caído DENTRO de
 *  la ventana del producto (`DBL_CLICK_MS` = 350 ms), que es lo que la app mide con el
 *  `timeStamp` del EVENTO.
 *
 *  Por qué se comprueba: Playwright emite cada clic con varias llamadas al navegador. Con un
 *  `delay: 40` artificial (lo que hacía esta prueba) el hueco medido entre los dos
 *  `pointerdown` salía en 104–350 ms (media 143 en 100 repeticiones): pegadísimo al umbral, y
 *  con la máquina cargada lo superaba, así que la app veía —correctamente— DOS clics sueltos y
 *  el menú no se abría. Medido sin ese retardo: 0–7 ms (media 0,3) y 100/100 menús abiertos.
 *  Si algún día vuelve a fallar por esto, la aserción del hueco lo dice explícitamente en vez
 *  de dejar un «el menú no se abre» sin causa. */
async function doubleClick(page: Page, x: number, y: number): Promise<void> {
  const antes = await page.evaluate(
    () => (window as unknown as { __pds?: number[] }).__pds?.length ?? 0,
  );
  await page.mouse.dblclick(x, y);
  const par = await page.evaluate(
    (desde) => ((window as unknown as { __pds?: number[] }).__pds ?? []).slice(desde),
    antes,
  );
  expect(par.length, 'el doble clic emite DOS pulsaciones (no una)').toBe(2);
  expect(
    par[1] - par[0],
    `hueco entre los dos clics (${par[1] - par[0]} ms) dentro de la ventana de la app (350 ms)`,
  ).toBeLessThan(350);
}

/** Coloca UN cono en la posición normalizada indicada y deja armado «Seleccionar». */
async function placeCone(page: Page, nx: number, ny: number): Promise<void> {
  await showCategory(page, 'Material');
  await page.locator('.rail-btn[title="Cono"]').click();
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const p = normToScreen(nx, ny, host, fit);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  await page.locator('.rail-btn[title="Seleccionar y mover"]').click();
}

type Escenario = {
  nombre: string;
  nx: number;
  ny: number;
  /** Prepara el tablero ANTES de localizar el cono (el punto se relee después). */
  preparar?: (page: Page) => Promise<void>;
};

const ESCENARIOS: Escenario[] = [
  { nombre: 'normal (centro, panel cerrado)', nx: 0.5, ny: 0.5 },
  {
    nombre: 'panel de propiedades ABIERTO',
    nx: 0.5,
    ny: 0.5,
    preparar: async (page) => {
      if (
        !(await page
          .locator('.studio-panel')
          .isVisible()
          .catch(() => false))
      ) {
        await page.locator('button[aria-label="Propiedades"]').click();
      }
      await expect(page.locator('.studio-panel')).toBeVisible();
    },
  },
  { nombre: 'cerca del borde superior izquierdo', nx: 0.08, ny: 0.12 },
  { nombre: 'cerca del borde inferior derecho', nx: 0.92, ny: 0.88 },
  {
    nombre: 'con zoom >150 %',
    nx: 0.5,
    ny: 0.5,
    preparar: async (page) => {
      const host = await hostBox(page);
      await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
      // La rueda avanza poco por muesca (×1,1): se insiste hasta pasar del 150 %, que es
      // el escenario que interesa (objeto grande y desplazado).
      for (let i = 0; i < 12 && (await zoom(page)) <= 1.5; i++) {
        await page.mouse.wheel(0, -500);
      }
      expect(await zoom(page), 'el tablero queda con zoom >150 %').toBeGreaterThan(1.5);
    },
  },
  {
    nombre: '«Llenar pantalla» activado',
    nx: 0.5,
    ny: 0.5,
    preparar: async (page) => {
      const host = page.locator('.board-host');
      const cls = (await host.getAttribute('class')) ?? '';
      if (!cls.includes('board-fill')) {
        await toggleFillScreen(page);
        await expect(host).toHaveClass(/board-fill/);
      }
    },
  },
];

test.describe('AUDITORÍA — doble clic sobre el mismo objeto', () => {
  test.beforeEach(async ({ page }) => {
    // Registra el instante REAL (`event.timeStamp`) de cada pulsación, que es justo lo que
    // usa la app para medir la ventana de doble clic.
    await page.addInitScript(() => {
      const w = window as unknown as { __pds?: number[] };
      if (!w.__pds) {
        w.__pds = [];
        window.addEventListener(
          'pointerdown',
          (e) => {
            w.__pds!.push(e.timeStamp);
          },
          true,
        );
      }
    });
  });

  for (const esc of ESCENARIOS) {
    test(`abre el menú contextual: ${esc.nombre}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1366, height: 768 });
      await seedBoard(page);
      await openBoard(page);
      await placeCone(page, esc.nx, esc.ny);
      if (esc.preparar) await esc.preparar(page);

      // El punto se localiza DESPUÉS de preparar: si la disposición cambió (zoom, llenar
      // pantalla), el usuario mira dónde está el objeto antes de doble clicar.
      const p = await coneCentre(page);
      await doubleClick(page, p.x, p.y);
      await expect(
        page.locator('.context-bar'),
        'el doble clic abre el menú contextual',
      ).toBeVisible();
      for (const label of CTX_BUTTONS) {
        await expect(
          page.locator(`.context-bar [aria-label="${label}"]`),
          `ofrece ${label}`,
        ).toBeVisible();
      }
      await expect(page.locator('.context-bar [aria-label="Girar 90° a la derecha"]')).toHaveCount(
        0,
      );
      await expect(page.locator('.field-count'), 'el doble clic no duplica ni borra').toHaveText(
        '1',
      );
      await page.keyboard.press('Escape');
      await expect(page.locator('.context-bar')).toHaveCount(0);

      // La PULSACIÓN LARGA sigue abriendo el mismo menú.
      await longPress(page, p.x, p.y);
      await expect(
        page.locator('.context-bar'),
        'la pulsación larga abre el mismo menú',
      ).toBeVisible();
      await expect(page.locator('.context-bar [aria-label="Eliminar"]')).toBeVisible();
      await expect(page.locator('.field-count')).toHaveText('1');
      await page.keyboard.press('Escape');
    });
  }
});

test.describe('AUDITORÍA — papelera, undo y redo', () => {
  const CASOS: Array<{ nombre: string; nx: number; ny: number; panel: boolean }> = [
    { nombre: 'panel cerrado', nx: 0.5, ny: 0.5, panel: false },
    { nombre: 'panel abierto', nx: 0.5, ny: 0.5, panel: true },
    { nombre: 'objeto junto al borde', nx: 0.1, ny: 0.15, panel: false },
    // El objeto cae DENTRO de la caja de la papelera (norm 0.5, 0.965): la zona donde el
    // clic sin arrastre borraba el objeto.
    { nombre: 'objeto ENCIMA de la papelera', nx: 0.5, ny: 0.92, panel: false },
  ];

  for (const caso of CASOS) {
    test(`elimina EXACTAMENTE una vez y Deshacer/Rehacer funcionan (${caso.nombre})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1366, height: 768 });
      await seedBoard(page);
      await openBoard(page);
      await placeCone(page, caso.nx, caso.ny);
      if (caso.panel) {
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

      const c = await coneCentre(page);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      // El primer movimiento va INMEDIATAMENTE después de bajar el botón, sin ninguna
      // comprobación en medio. Motivo medido (no supuesto): el pointerdown con ratón arma
      // además la PULSACIÓN LARGA (550 ms) y, si vence antes de que el objeto se mueva, abre
      // el menú contextual y CONSUME el gesto (`consumeLongPressGesture` vacía `movingIds`),
      // de modo que el arrastre posterior no mueve nada. Una aserción con sondeo entre bajar
      // y mover tarda una ida y vuelta a la página y, con la máquina cargada, puede superar
      // ese plazo: entonces el fallo se atribuía a la papelera cuando en realidad era una
      // pausa del propio test. Las comprobaciones van después del primer movimiento, dentro
      // del MISMO gesto y antes de soltar, así que no se pierde ninguna cobertura.
      await page.mouse.move(c.x + 20, c.y + 20, { steps: 3 });
      // El pointerdown selecciona: si el hit-test fallara, se ve AQUÍ (el primer fallo es la
      // selección, no la papelera), que es lo que se quería poder distinguir.
      await expect(
        page.locator('.studio-panel .inspector'),
        'el pointerdown selecciona el cono (precondición del arrastre)',
      ).toBeVisible();
      await expect(
        page.locator('.board-trash.trash-visible'),
        'la papelera aparece al arrastrar',
      ).toBeVisible();
      const trash = (await page.locator('.board-trash').boundingBox())!;
      await page.mouse.move(trash.x + trash.width / 2, trash.y + trash.height / 2, { steps: 8 });
      await expect(
        page.locator('.board-trash.trash-hot'),
        'el objeto llega sobre la papelera',
      ).toBeVisible();
      await page.mouse.up();

      // Elimina UNA sola vez.
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
      await page.keyboard.press('Control+z');
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
      await page.keyboard.press('Control+y');
      await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    });
  }

  // BUG REAL encontrado por esta auditoría (existía ya en HEAD): la papelera está SIEMPRE en
  // el DOM (oculta con `opacity: 0`) y su caja se ancla en norm (0.5, 0.965). `onPointerUp`
  // daba por bueno el soltado con solo estar dentro de esa caja, así que un CLIC sin arrastre
  // sobre un objeto que cae ahí lo BORRABA: medido, el contador pasaba de 1 a 0 sin que el
  // usuario arrastrara nada. Un clic es una selección; borrar exige arrastrar.
  test('un CLIC sin arrastre junto a la papelera NO borra el objeto', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await placeCone(page, 0.5, 0.92);
    const c = await coneCentre(page);

    // Un solo clic (bajar y levantar en el mismo punto, sin ningún movimiento).
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('.field-count'), 'el objeto sigue ahí tras un clic').toHaveText('1');
    await expect(page.locator('.studio-panel .inspector'), 'y queda seleccionado').toBeVisible();
    // Un segundo clic tampoco (no es un arrastre por repetirlo).
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('.field-count'), 'y tras dos clics tampoco').toHaveText('1');

    // Y ARRASTRAR hasta la papelera desde esa misma posición SÍ borra (una sola vez).
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 20, c.y + 20, { steps: 3 });
    const trash = (await page.locator('.board-trash').boundingBox())!;
    await page.mouse.move(trash.x + trash.width / 2, trash.y + trash.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => fieldCount(page), { timeout: 5000 }).toBe(1);
  });
});

test.describe('AUDITORÍA — límite medido del gesto de arrastre', () => {
  // Medido, no supuesto: bajar el botón sobre un objeto deja `movingIds` puesto (la papelera
  // ya se ve en ese instante) y arma la pulsación larga. Si el objeto no se mueve en 550 ms,
  // la pulsación larga abre el menú contextual y CONSUME el gesto: a partir de ahí, arrastrar
  // con el botón todavía bajado no mueve nada ni muestra la papelera. Este test fija ese
  // comportamiento tal y como está hoy (y por eso las pruebas de arrastre mueven enseguida):
  // si algún día el arrastre recupera el gesto tras el menú, este test debe cambiar A
  // PROPÓSITO, no por accidente.
  test('sostener más de la pulsación larga abre el menú SIN romper el arrastre', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedBoard(page);
    await openBoard(page);
    await placeCone(page, 0.5, 0.5);
    const c = await coneCentre(page);

    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    // Sin mover: el plazo de la pulsación larga vence y abre el menú contextual.
    await expect(
      page.locator('.context-bar'),
      'sostener sin moverse abre el menú contextual',
    ).toBeVisible({ timeout: 5000 });
    // Sostener no borra nada: la papelera solo actúa al SOLTAR y con el objeto ya movido.
    await expect(page.locator('.field-count'), 'sostener no borra el objeto').toHaveText('1');

    // Y si el usuario SIGUE arrastrando con el botón bajado, el objeto se mueve igual.
    // ANTES esta prueba exigía lo contrario («el arrastre no recupera la papelera» / «el objeto
    // no se mueve») porque `commitLongPress` llamaba a `consumeLongPressGesture` y vaciaba
    // `movingIds`. Eso era un ACCIDENTE, no una decisión: convertía una carrera del temporizador
    // (550 ms frente al primer `pointermove`) en un fallo funcional — el usuario arrastra y no
    // pasa nada— y de ahí salieron dos intermitencias de la suite completa («la papelera no
    // aparece» y «la selección múltiple se mueve como un GRUPO» con movedA = 0). Ahora el menú
    // se abre y el arrastre sigue vivo.
    await page.mouse.move(c.x + 20, c.y + 20, { steps: 3 });
    await expect(
      page.locator('.board-trash.trash-visible'),
      'el arrastre posterior sigue mostrando la papelera',
    ).toBeVisible();
    const c2 = await coneCentre(page);
    expect(
      Math.abs(c2.x - c.x) + Math.abs(c2.y - c.y),
      'el objeto se mueve con el arrastre',
    ).toBeGreaterThan(5);
    await page.mouse.up();
    await expect(page.locator('.field-count'), 'no borra ni duplica').toHaveText('1');
  });
});
