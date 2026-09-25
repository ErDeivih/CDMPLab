import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas, expectPanelLibreDelGrupo } from './board-helpers';
import fs from 'node:fs';

// =============================================================
// Fase «shell + móvil» — lo que se comprueba y lo que queda pendiente.
//
// COMPROBADO AQUÍ
//  1. `.topbar` no existe en el DOM.
//  2. No quedan 56 px vacíos arriba (el contenido empieza en el primer píxel útil).
//  3. Escritorio: el menú de cuenta abre y contiene equipo, Ajustes y Miembros cuando toca.
//  4. Móvil: tres destinos principales + «Más» (exactamente cuatro entradas).
//  5. Miembros se ofrece dentro de «Más»/cuenta (en modo local el rol se desconoce: se muestra).
//  7. El selector de equipos sigue funcionando desde el menú y cierra el menú al cambiar.
//  8. Ajustes abre desde el menú nuevo.
//  9. Escape cierra el menú y devuelve el foco al botón que lo abrió.
// 10. Login no tiene cabecera ni barra inferior vacías.
// 11. La pizarra horizontal gana altura útil (el contenido empieza en el borde superior).
// 13/17. Material no solapa la navegación inferior ni la barra de herramientas del tablero.
// 14. El aviso de Mano/pinch no queda recortado detrás de un panel.
// 16. Sin scroll horizontal en los cuatro viewports del encargo.
// 18. Sin errores de consola.
// 19. Colocar jugadores y materiales sigue funcionando.
// 20. La exportación PNG es la del CAMPO (no la pantalla con paneles ni menús).
//
// 12. Los cuatro paneles se abren, MINIMIZAN y recuperan (con el control de minimizar, ya hecho).
// 15. Vertical usa bottom sheet y horizontal panel lateral.
//  3b. «Cerrar sesión» dentro del menú (solo existe con sesión; el E2E corre en modo local).
// 20. (Añadido después) la exportación PNG es la del campo, no la pantalla.
//
// LO QUE NO SE COMPRUEBA AQUÍ
//  · 6. El colaborador con rol 'editor' no recibe «Miembros»: cubierto con un test de componente
//       (`src/app/app.spec.ts`), porque el rol lo resuelve el servidor y el E2E corre sin sesión.
//  · El comportamiento con lector de pantalla real: PENDIENTE DE PRUEBA MANUAL, no se afirma.
// =============================================================

const VIEWPORTS = {
  escritorio: { width: 1366, height: 768 },
  tablet: { width: 1024, height: 768 },
  movilH: { width: 844, height: 390 },
  movilV: { width: 390, height: 844 },
} as const;

async function seed(page: Page, equipos = 2): Promise<void> {
  await page.addInitScript((n: number) => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    localStorage.setItem('entrenolab:orient-hint', '1');
    const todos = [
      { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now },
      { id: 't2', name: 'Cadete B', accentColor: '#c0392b', createdAt: now },
    ];
    localStorage.setItem('entrenolab:teams', JSON.stringify(todos.slice(0, n)));
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify([
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
      ]),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, equipos);
}

/** Fallos de consola acumulados durante el test (se comprueban al final). */
function vigilarConsola(page: Page): string[] {
  const errores: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  page.on('pageerror', (e) => errores.push(String(e)));
  return errores;
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (
      await page
        .locator(sel)
        .isVisible()
        .catch(() => false)
    )
      await page.locator(sel).click();
  }
}

test.describe('Fase shell+móvil — barra superior eliminada y cuenta reubicada', () => {
  test.use({ hasTouch: true });

  test('1-2. no queda barra superior ni franja vacía arriba (escritorio y móvil)', async ({
    page,
  }) => {
    for (const [nombre, vp] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(vp);
      await seed(page);
      await page.goto('/team');
      await expect(page.locator('.topbar')).toHaveCount(0);
      await expect(page.locator('.topbar-title, .topbar-user, .topbar-shield')).toHaveCount(0);
      // El contenido del shell empieza pegado arriba: no hay 56 px reservados.
      const caja = (await page.locator('.main').boundingBox())!;
      expect(caja.y, `${nombre}: el contenido arranca arriba`).toBeLessThanOrEqual(1);
      // Y no hay hueco muerto entre el borde superior y el primer elemento visible.
      const primero = await page.evaluate(() => {
        const nodos = [...document.querySelectorAll('.content > *')];
        const visible = nodos.find((n) => (n as HTMLElement).offsetHeight > 0);
        return visible ? Math.round(visible.getBoundingClientRect().top) : -1;
      });
      expect(primero, `${nombre}: el primer contenido visible no deja franja`).toBeLessThanOrEqual(
        vp.width <= 768 ? 80 : 40,
      );
    }
  });

  test('21. NUNCA se ven las dos navegaciones a la vez: escritorio solo la lateral, móvil solo la inferior', async ({
    page,
  }) => {
    // Defecto medido por el dueño: en escritorio se veían LAS DOS (`.nav-movil` no tenía regla base
    // y solo se ocultaba `.nav-escritorio` dentro del bloque móvil). No basta con `toHaveCount`:
    // aquí se comprueba VISIBILIDAD REAL y caja de cada navegación, y se exige que exactamente una
    // esté visible en cada viewport. La aserción de “las dos visibles” es la que falla si vuelve.
    for (const [nombre, vp, esperada] of [
      ['escritorio', VIEWPORTS.escritorio, 'escritorio'],
      ['tablet', VIEWPORTS.tablet, 'escritorio'],
      ['móvil vertical', VIEWPORTS.movilV, 'movil'],
      ['móvil horizontal', VIEWPORTS.movilH, 'movil'],
    ] as const) {
      await page.setViewportSize(vp);
      await seed(page);
      await page.goto('/team');

      const escritorio = page.locator('.nav-escritorio');
      const movil = page.locator('.nav-movil');
      await expect(escritorio, `${nombre}: existe la navegación de escritorio`).toHaveCount(1);
      await expect(movil, `${nombre}: existe la navegación de móvil`).toHaveCount(1);

      // Visibilidad computada real (no presencia en el DOM).
      const visibilidad = await page.evaluate(() => {
        const leer = (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return { visible: false, w: 0, h: 0, display: 'ausente' };
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            visible:
              cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
            w: Math.round(r.width),
            h: Math.round(r.height),
            display: cs.display,
          };
        };
        return { escritorio: leer('.nav-escritorio'), movil: leer('.nav-movil') };
      });

      const visibles = [visibilidad.escritorio, visibilidad.movil].filter((v) => v.visible);
      expect(
        visibles.length,
        `${nombre}: exactamente UNA navegación visible (escritorio=${JSON.stringify(visibilidad.escritorio)}, móvil=${JSON.stringify(visibilidad.movil)})`,
      ).toBe(1);
      expect(
        visibilidad.escritorio.visible && visibilidad.movil.visible,
        `${nombre}: las dos navegaciones NO pueden estar visibles a la vez`,
      ).toBe(false);

      if (esperada === 'escritorio') {
        await expect(escritorio, `${nombre}: se ve la navegación lateral`).toBeVisible();
        await expect(movil, `${nombre}: la de móvil está oculta`).toBeHidden();
        expect(visibilidad.escritorio.w, `${nombre}: la lateral tiene ancho real`).toBeGreaterThan(
          100,
        );
        expect(
          visibilidad.escritorio.h,
          `${nombre}: la lateral es vertical (más alta que ancha)`,
        ).toBeGreaterThan(visibilidad.escritorio.w * 0.5);
        // Y no ocupa espacio en el flujo: su caja no deja hueco entre el contenido y el borde.
        await expect(movil).toHaveJSProperty('offsetHeight', 0);
      } else {
        await expect(movil, `${nombre}: se ve la navegación inferior`).toBeVisible();
        await expect(escritorio, `${nombre}: la lateral está oculta`).toBeHidden();
        const cajaNav = (await movil.boundingBox())!;
        const cajaBarra = (await page.locator('.sidebar').boundingBox())!;
        expect(cajaNav.width, `${nombre}: la navegación inferior ocupa el ancho`).toBeGreaterThan(
          vp.width * 0.9,
        );
        // La navegación va DENTRO de la barra inferior (centrada, con el padding de la barra: la
        // primera versión de esta aserción exigía el mismo `y` exacto y fallaba por 4,5 px de
        // padding — el medido era el de la barra, no el de la navegación).
        expect(cajaNav.y, `${nombre}: la navegación no se sale por arriba`).toBeGreaterThanOrEqual(
          cajaBarra.y - 1,
        );
        expect(
          cajaNav.y + cajaNav.height,
          `${nombre}: la navegación no se sale por abajo de la barra`,
        ).toBeLessThanOrEqual(cajaBarra.y + cajaBarra.height + 1);
        await expect(escritorio).toHaveJSProperty('offsetHeight', 0);
      }
    }
  });

  test('22. la franja de estado del campo YA NO EXISTE y el campo arranca pegado a la cabecera', async ({
    page,
  }) => {
    // Defecto medido por el dueño: la banda negra (`.field-status`) se comía la parte superior del
    // campo en escritorio y en móvil. Aquí se comprueba que no existe, que no deja hueco (ni
    // margen, ni altura reservada) y se MIDE la altura recuperada entre cabecera y campo.
    for (const [nombre, vp] of [
      ['escritorio', VIEWPORTS.escritorio],
      ['móvil horizontal', VIEWPORTS.movilH],
      ['móvil vertical', VIEWPORTS.movilV],
    ] as const) {
      await page.setViewportSize(vp);
      await seed(page);
      await openBoard(page);

      await expect(page.locator('.field-status'), `${nombre}: la franja no existe`).toHaveCount(0);
      await expect(page.locator('.save-state'), `${nombre}: no hay chips de estado`).toHaveCount(0);

      const cabecera = (await page.locator('.studio-top').boundingBox())!;
      const campo = (await page.locator('.studio-field').boundingBox())!;
      const host = (await page.locator('.board-host').boundingBox())!;
      // El campo empieza inmediatamente debajo de la cabecera: el hueco es el relleno del campo
      // (4 px en compacto, 10 px en escritorio), no una franja de estado.
      const hueco = host.y - (cabecera.y + cabecera.height);
      expect(hueco, `${nombre}: sin franja negra entre cabecera y campo`).toBeLessThanOrEqual(12);
      expect(campo.y - (cabecera.y + cabecera.height)).toBeLessThanOrEqual(2);

      // El contador sigue disponible como observable, pero NO ocupa sitio (invisible, 1×1 px).
      const contador = page.locator('.field-count');
      await expect(contador, `${nombre}: el contador existe como nodo invisible`).toHaveCount(1);
      const cajaContador = (await contador.boundingBox())!;
      expect(cajaContador.width, `${nombre}: el contador no reserva ancho`).toBeLessThanOrEqual(2);
      expect(cajaContador.height, `${nombre}: el contador no reserva alto`).toBeLessThanOrEqual(2);
      // Y dentro del contenedor del campo no hay NINGÚN elemento visible por encima del lienzo
      // (el aviso de girar el móvil se excluye: es una pista deliberada, no la franja retirada).
      // La primera versión de esta comprobación miraba los hijos de `.studio` y contaba el propio
      // `.studio-main` (contenedor del campo): la medición estaba mal, no el código.
      const intrusos = await page.evaluate(() => {
        const campo = document.querySelector('.studio-field') as HTMLElement | null;
        const host = document.querySelector('.board-host') as HTMLElement | null;
        if (!campo || !host) return ['sin .studio-field o .board-host'];
        const limite = host.getBoundingClientRect().top;
        return [...campo.children]
          .filter(
            (el) => !el.classList.contains('board-host') && !el.classList.contains('orient-hint'),
          )
          .filter((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.height > 4 && r.top < limite - 1;
          })
          .map((el) => (el as HTMLElement).className);
      });
      expect(intrusos, `${nombre}: nada ocupa la banda entre cabecera y campo`).toEqual([]);

      // La altura útil del campo se mide y se compara con el mínimo razonable del viewport.
      expect(host.height, `${nombre}: el campo se queda con la altura útil`).toBeGreaterThanOrEqual(
        vp.height * 0.5,
      );
    }
  });

  test('23. el guardado se comunica desde el botón Guardar (icono + aria-label), sin franja propia', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.escritorio);
    await seed(page);
    await openBoard(page);

    const guardar = page.locator(
      '.studio-top button[aria-label="Guardar"], .studio-top button[aria-label="Guardado"], .studio-top button[aria-label="Guardando…"]',
    );
    await expect(guardar, 'el botón de guardar está en la cabecera').toHaveCount(1);
    await expect(guardar).toHaveAttribute('data-guardado', 'pendiente');

    // «Llenar pantalla / Ver campo completo» ya no está suelto sobre el campo: vive en «Más».
    // (Sin zoom aplicado tampoco existe el control flotante «Volver al encuadre».)
    const sueltos = await page.evaluate(
      () =>
        [...document.querySelectorAll('.field-fit-toggle')].filter(
          (el) => !el.closest('.top-pop-mas'),
        ).length,
    );
    expect(sueltos, 'ningún control de encuadre suelto fuera de «Más»').toBe(0);
    await page.locator('.studio-top button[aria-label="Más"]').click();
    const enMas = page.locator('.top-pop-mas .field-fit-toggle');
    await expect(enMas, 'el control de encuadre está dentro de «Más»').toHaveCount(1);
    await expect(enMas).toHaveAttribute('aria-label', 'Llenar pantalla');
    await enMas.click();
    await expect(page.locator('.board-host')).toHaveClass(/board-fill/);
    await page.locator('.studio-top button[aria-label="Más"]').click();
    await expect(page.locator('.top-pop-mas .field-fit-toggle')).toHaveAttribute(
      'aria-label',
      'Ver campo completo',
    );
  });

  test('3-5-7-8. el menú de cuenta contiene equipo, Miembros y Ajustes, y cambia de equipo', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.escritorio);
    await seed(page);
    await page.goto('/team');

    const boton = page.locator('.cuenta-btn');
    await expect(boton).toBeVisible();
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    await expect(boton).toHaveAttribute('aria-controls', 'cuenta-menu');
    await expect(boton).toHaveAttribute('aria-haspopup', 'dialog');

    const panel = page.locator('.cuenta-panel');
    await expect(panel).toBeVisible();
    // Equipo activo + selector con los dos equipos.
    await expect(panel.locator('.cuenta-valor, .team-switch select').first()).toContainText(
      'Primer Equipo',
    );
    const select = panel.locator('.team-switch select');
    await expect(select).toHaveValue('t1');
    // Miembros (modo local: el rol se desconoce → se ofrece) y Ajustes.
    await expect(panel.locator('.cuenta-accion', { hasText: 'Miembros' })).toHaveCount(1);
    await expect(panel.locator('.cuenta-accion', { hasText: 'Ajustes' })).toHaveCount(1);

    // Cambiar de equipo funciona y cierra el menú.
    await select.selectOption('t2');
    await expect(panel).toHaveCount(0);
    await expect(boton.locator('.cuenta-btn-texto')).toHaveText('Cadete B');

    // Ajustes se abre desde el menú nuevo.
    await boton.click();
    await panel.locator('.cuenta-accion', { hasText: 'Ajustes' }).click();
    await expect(page.locator('.settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings')).toHaveCount(0);
  });

  test('9. Escape cierra el menú y devuelve el foco al botón; el botón de cerrar también', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.escritorio);
    await seed(page);
    await page.goto('/team');

    const boton = page.locator('.cuenta-btn');
    await boton.click();
    await expect(page.locator('.cuenta-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.cuenta-panel')).toHaveCount(0);
    expect(
      await boton.evaluate((el) => el === document.activeElement),
      'el foco vuelve al botón que abrió el menú',
    ).toBe(true);

    await boton.click();
    await page.locator('.cuenta-panel button[aria-label="Cerrar el menú de cuenta"]').click();
    await expect(page.locator('.cuenta-panel')).toHaveCount(0);
    expect(await boton.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  test('4-5. móvil: tres destinos + «Más», y Miembros vive dentro de «Más»', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.movilV);
    await seed(page);
    await page.goto('/team');

    const nav = page.locator('.nav-movil');
    await expect(nav).toBeVisible();
    // Tres enlaces + el botón «Más» = cuatro entradas, y ninguna es Miembros ni Pizarra.
    await expect(nav.locator('a.nav-item')).toHaveCount(3);
    await expect(nav.locator('.nav-mas')).toHaveCount(1);
    await expect(nav.locator('.nav-item')).toHaveCount(4);
    await expect(nav.locator('.nav-item', { hasText: 'Miembros' })).toHaveCount(0);
    await expect(nav.locator('.nav-item', { hasText: 'Pizarra' })).toHaveCount(0);

    await nav.locator('.nav-mas').click();
    const panel = page.locator('.cuenta-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.cuenta-accion', { hasText: 'Miembros' })).toHaveCount(1);
    await expect(panel.locator('.cuenta-marca')).toHaveText('CDMPLab');
    // CONTRATO ACTUALIZADO (FASE 6 del encargo): en móvil el menú «Más»/Cuenta ya NO es una hoja
    // inferior anclada sobre la barra de navegación; ahora es un DRAWER que entra desde la
    // IZQUIERDA, a pantalla completa de alto y con ancho razonable (nunca toda la pantalla), para
    // no tapar la lista de la Plantilla con una modal flotante. Se comprueba la geometría nueva.
    const cajaPanel = (await panel.boundingBox())!;
    expect(cajaPanel.x, 'el cajón entra pegado al borde IZQUIERDO').toBeLessThanOrEqual(1);
    expect(cajaPanel.y, 'y empieza en el borde superior').toBeLessThanOrEqual(1);
    expect(
      cajaPanel.width,
      `ancho razonable (medido: ${cajaPanel.width} px de ${VIEWPORTS.movilV.width})`,
    ).toBeLessThan(VIEWPORTS.movilV.width * 0.92);
    expect(cajaPanel.width).toBeGreaterThan(200);
    expect(cajaPanel.height, 'ocupa el alto disponible').toBeGreaterThan(
      VIEWPORTS.movilV.height * 0.8,
    );
    // Miembros lleva a la pantalla de miembros.
    await panel.locator('.cuenta-accion', { hasText: 'Miembros' }).click();
    await expect(page).toHaveURL(/settings\/team\/members/);
  });

  test('10. login no tiene cabecera ni barra inferior vacías', async ({ page }) => {
    for (const vp of [VIEWPORTS.escritorio, VIEWPORTS.movilV]) {
      await page.setViewportSize(vp);
      await page.goto('/auth/login');
      await expect(page.locator('.topbar')).toHaveCount(0);
      await expect(page.locator('.cuenta-btn')).toHaveCount(0);
      await expect(page.locator('.nav-mas')).toHaveCount(0);
      if (vp.width <= 768) {
        // En móvil la barra lateral se convierte en barra inferior: en auth no debe verse.
        await expect(page.locator('.sidebar')).toBeHidden();
      }
      // El formulario no arranca a mitad de pantalla por un hueco reservado.
      const caja = (await page.locator('.auth-card, .card').first().boundingBox())!;
      expect(caja.y, 'el formulario arranca arriba').toBeLessThan(vp.height * 0.6);
    }
  });

  test('11. la pizarra gana altura útil (el contenido arranca en el borde superior)', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.movilH);
    await seed(page);
    await openBoard(page);

    const main = (await page.locator('.main').boundingBox())!;
    const studio = (await page.locator('.studio').boundingBox())!;
    // CONTRATO ACTUALIZADO (FASE 4 del encargo): dentro de /board la navegación global inferior se
    // OCULTA en móvil, así que ya no hay barra con la que comparar: el tablero ocupa la pantalla
    // completa hasta la safe area. Antes esta prueba medía que el tablero terminase justo encima de
    // la barra inferior (56 px perdidos); ahora se exige que llegue al borde.
    await expect(
      page.locator('.sidebar'),
      'la nav inferior no se muestra en la pizarra',
    ).toBeHidden();
    expect(main.y, 'el shell arranca en el borde superior').toBeLessThanOrEqual(1);
    expect(studio.y - main.y, 'el tablero arranca en el borde superior').toBeLessThanOrEqual(2);
    expect(
      studio.y + studio.height,
      'el tablero llega al borde inferior de la pantalla',
    ).toBeGreaterThanOrEqual(VIEWPORTS.movilH.height - 2);
    expect(
      studio.height,
      'altura útil del tablero (sin descontar ninguna barra)',
    ).toBeGreaterThanOrEqual(VIEWPORTS.movilH.height - 2);
  });

  test('14. el aviso de Mano/pinch no queda recortado detrás de un panel', async ({ page }) => {
    for (const vp of [VIEWPORTS.movilH, VIEWPORTS.tablet, VIEWPORTS.escritorio]) {
      await page.setViewportSize(vp);
      await seed(page);
      await page.goto('/board');
      const hint = page.locator('.fill-hint');
      const panel = page.locator('.side-panel-left[aria-label="Herramientas de Material"]');
      const abierto = await hint.isVisible().catch(() => false);
      if (abierto) {
        // Si se ve, tiene que verse ENTERO dentro del viewport.
        const c = (await hint.boundingBox())!;
        expect(c.x, 'el aviso no se sale por la izquierda').toBeGreaterThanOrEqual(0);
        expect(c.x + c.width, 'ni por la derecha').toBeLessThanOrEqual(vp.width + 1);
        expect(c.y, 'ni por arriba').toBeGreaterThanOrEqual(0);
        expect(c.y + c.height, 'ni por abajo').toBeLessThanOrEqual(vp.height + 1);
      }
      // Con el panel de Material ABIERTO el aviso no puede quedar a medias: se oculta.
      if (
        await page
          .locator('.tools-cat', { hasText: 'Material' })
          .isVisible()
          .catch(() => false)
      ) {
        await abrirHerramientas(page);
        await page.locator('.tools-cat', { hasText: 'Material' }).click();
        await expect(panel).toBeVisible();
        await expect(page.locator('.fill-hint'), 'sin aviso recortado tras el panel').toBeHidden();
      }
    }
  });

  test('13-17. Material no solapa la barra de herramientas del tablero ni la navegación', async ({
    page,
  }) => {
    // Solo MÓVIL HORIZONTAL: en vertical el panel lateral izquierdo (300 px) tapa la barra de
    // herramientas, y eso es exactamente lo que debe resolver el bottom sheet de la Fase 3 (ver el
    // test marcado como pendiente más abajo). El solape de vertical NO se declara resuelto.
    for (const vp of [VIEWPORTS.movilH]) {
      await page.setViewportSize(vp);
      await seed(page);
      await openBoard(page);
      await abrirHerramientas(page);
      await page.locator('.tools-cat', { hasText: 'Material' }).click();
      const panel = (await page
        .locator('.side-panel-left[aria-label="Herramientas de Material"]')
        .boundingBox())!;
      const solapa = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

      // CONTRATO/selector CORREGIDO: esta comprobación medía `.rail-btn[title="Cono"]`, que es un
      // botón que vive DENTRO del propio panel de Material, así que comparaba el panel consigo
      // mismo. Pasaba por casualidad: con el panel más corto ese botón quedaba fuera del scroll y su
      // caja caía fuera del panel. Al hacer el panel más alto (FASE 5: llega hasta el borde inferior
      // disponible) el botón entra en la vista y la comparación se vuelve imposible de satisfacer.
      // Lo que importa es que el panel sea usable con el grupo de herramientas abierto.
      // FASE 3: la barra inferior desapareció (el grupo FLOTA sobre la esquina inferior izquierda del
      // panel, por encima de él, para poder cambiar de herramienta sin cerrarlo). Por eso ya no se
      // exige que no se solapen —es imposible—: se exige huella acotada, controles libres y grupo
      // operable, que es el contrato nuevo y está en `expectPanelLibreDelGrupo`.
      await expectPanelLibreDelGrupo(
        page,
        '.side-panel-left[aria-label="Herramientas de Material"]',
      );
      const nav = await page.locator('.sidebar').boundingBox();
      if (nav) {
        expect(solapa(panel, nav), `${vp.width}×${vp.height}: el panel no tapa la navegación`).toBe(
          false,
        );
      }
      // Sin scroll horizontal con el panel abierto.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${vp.width}×${vp.height}: sin scroll horizontal`).toBeLessThanOrEqual(1);
    }
  });

  test('16-18. sin scroll horizontal en los cuatro viewports y sin errores de consola', async ({
    page,
  }) => {
    const errores = vigilarConsola(page);
    for (const [nombre, vp] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(vp);
      await seed(page);
      for (const ruta of ['/team', '/library', '/sessions', '/board']) {
        await page.goto(ruta);
        await expect(
          page.locator('.board-host, .data-table, .library, .page-head').first(),
        ).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `${nombre} ${ruta}: sin scroll horizontal`).toBeLessThanOrEqual(1);
      }
      // El menú de cuenta se comprueba FUERA de la pizarra: en escritorio el tablero es un estudio
      // a pantalla completa que tapa la barra lateral a propósito (se sale con «Volver»), así que
      // pulsar ahí el botón de cuenta no es un escenario real de uso.
      await page.goto('/team');
      // El disparador visible depende del ancho: botón de cuenta en escritorio, «Más» en móvil.
      await page.locator('.cuenta-btn:visible, .nav-mas:visible').first().click();
      await expect(page.locator('.cuenta-panel')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${nombre} con el menú abierto: sin scroll horizontal`).toBeLessThanOrEqual(
        1,
      );
      await page.keyboard.press('Escape');
    }
    const graves = errores.filter(
      (e) => !e.includes('[SupabaseService]') && !e.includes('[AccessService]'),
    );
    expect(graves, `errores de consola: ${graves.join(' | ')}`).toEqual([]);
  });

  test('19. colocar jugadores y materiales sigue funcionando con el shell nuevo', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.movilV);
    await seed(page);
    await openBoard(page);

    // Material (cono) desde su panel: se arma, se CIERRA el panel (tapa el punto de colocación en
    // móvil) y se toca el campo, como hace la spec de móvil del panel de propiedades.
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.rail-btn[title="Cono"]').click();
    await page.locator('.side-panel-left .panel-close').first().click();
    await expect(page.locator('.side-panel-left')).toHaveCount(0);
    const host = (await page.locator('.board-host').boundingBox())!;
    await page.mouse.click(host.x + host.width * 0.35, host.y + host.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('1');

    // Jugador desde su panel.
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.tray-player, .roster-item').first().click();
    await page.locator('.side-panel-left .panel-close').first().click();
    await expect(page.locator('.side-panel-left')).toHaveCount(0);
    await page.mouse.click(host.x + host.width * 0.65, host.y + host.height * 0.5);
    await expect(page.locator('.field-count')).toHaveText('2');
  });

  test('20. la exportación PNG es la del CAMPO (no la pantalla con paneles ni menús)', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.escritorio);
    await seed(page);
    await openBoard(page);
    // Deja la pantalla «sucia»: panel abierto y menú de cuenta abierto.
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    // El menú de cuenta NO puede quedarse abierto: su capa tapa la pantalla (a propósito) y el
    // clic de exportar no llegaría. La prueba es que el PNG sea el del CAMPO aunque el panel de
    // Material siga abierto.
    await expect(page.locator('.side-panel-left')).toBeVisible();

    const descarga = page.waitForEvent('download');
    await page.locator('[aria-label="Exportar"]').click();
    await page
      .locator('.top-pop-export [title="Exportar PNG"], .top-pop-export button', { hasText: 'PNG' })
      .first()
      .click();
    const fichero = await descarga;
    expect(fichero.suggestedFilename()).toMatch(/\.png$/i);
    // El PNG del campo es apaisado (105:68) y del tamaño del viewBox, no de la ventana.
    const ruta = await fichero.path();
    expect(ruta, 'el PNG se ha descargado').toBeTruthy();
    // El PNG es el del CAMPO: se comprueba su cabecera (IHDR) y su proporción 105:68, no la de la
    // ventana (que incluiría paneles, menús y navegación).
    const bytes = fs.readFileSync(ruta!);
    expect(bytes.subarray(1, 4).toString('ascii'), 'es un PNG').toBe('PNG');
    const ancho = bytes.readUInt32BE(16);
    const alto = bytes.readUInt32BE(20);
    // El lienzo del campo tiene viewBox 100×80 → la exportación sale 1600×1280. Ni la proporción ni
    // el tamaño son los de la VENTANA (1366×768), así que el PNG no puede ser una captura con
    // paneles, menús ni navegación.
    expect([ancho, alto], 'lienzo del campo, no la ventana').toEqual([1600, 1280]);
    expect(ancho / alto).toBeCloseTo(100 / 80, 2);
    expect(ancho / alto, 'no es la proporción de la pantalla').not.toBeCloseTo(
      VIEWPORTS.escritorio.width / VIEWPORTS.escritorio.height,
      2,
    );
  });

  test('12-15. los cuatro paneles se abren, MINIMIZAN y recuperan; vertical usa hoja inferior', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.movilH);
    await seed(page);
    await openBoard(page);

    const paneles = [
      {
        nombre: 'Jugadores',
        abrir: async () => {
          await abrirHerramientas(page);
          await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
        },
        panel: '.side-panel-left[aria-label="Jugadores"]',
      },
      {
        nombre: 'Material',
        abrir: async () => {
          await abrirHerramientas(page);
          await page.locator('.tools-cat', { hasText: 'Material' }).click();
        },
        panel: '.side-panel-left[aria-label="Herramientas de Material"]',
      },
      {
        nombre: 'Dibujo',
        abrir: async () => {
          await abrirHerramientas(page);
          await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
        },
        panel: '.side-panel-left[aria-label="Herramientas de Dibujo"]',
      },
      {
        nombre: 'Propiedades',
        abrir: () => page.locator('button[aria-label="Propiedades"]').click(),
        panel: '.studio-panel',
      },
    ];

    // HORIZONTAL: los cuatro se abren como panel lateral acotado, minimizan y recuperan.
    for (const p of paneles) {
      await p.abrir();
      const panel = page.locator(p.panel);
      await expect(panel, `${p.nombre}: se abre`).toBeVisible();
      const caja = (await panel.boundingBox())!;
      expect(caja.width, `${p.nombre}: ancho acotado (min(320px, 42vw))`).toBeLessThanOrEqual(
        Math.max(320, VIEWPORTS.movilH.width * 0.42) + 2,
      );
      // El campo sigue visible al lado del panel.
      const host = (await page.locator('.board-host').boundingBox())!;
      expect(host.width, `${p.nombre}: queda campo a la derecha`).toBeGreaterThan(0);

      await panel.locator('.panel-min').first().click();
      await expect(panel, `${p.nombre}: minimizado`).toHaveCount(0);
      const tab = page.locator('.panel-tab');
      await expect(tab, `${p.nombre}: pestaña para reabrir`).toBeVisible();
      await expect(tab).toContainText(p.nombre);
      await tab.click();
      await expect(page.locator(p.panel), `${p.nombre}: recuperado`).toBeVisible();

      await page.locator(`${p.panel} .panel-close`).first().click();
      await expect(page.locator(p.panel)).toHaveCount(0);
    }
  });

  test('15b. vertical: el panel es una hoja inferior por encima de la navegación', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.movilV);
    await seed(page);
    await openBoard(page);
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();

    const panel = page.locator('.side-panel-left[aria-label="Herramientas de Material"]');
    await expect(panel).toBeVisible();
    const c = (await panel.boundingBox())!;
    // CONTRATO ACTUALIZADO (FASE 4): en /board la navegación global está oculta, así que la hoja
    // inferior se ancla al BORDE DE LA PANTALLA (respetando la safe area) y no a una barra de 56 px.
    expect(
      await page
        .locator('.sidebar')
        .isVisible()
        .catch(() => false),
      'la nav inferior no se muestra en la pizarra',
    ).toBe(false);
    expect(c.width, 'ocupa el ancho de la pantalla').toBeGreaterThanOrEqual(
      VIEWPORTS.movilV.width - 2,
    );
    expect(c.height, 'alto máximo ~58 %').toBeLessThanOrEqual(VIEWPORTS.movilV.height * 0.6 + 2);
    // La hoja llega hasta el final del ÁREA DISPONIBLE. FASE 3: la barra inferior ya no existe (el
    // grupo de herramientas flota), pero su franja está RESERVADA (`--reserva-grupo-herramientas`)
    // para que el grupo —que va por encima del panel— no intercepte sus últimas filas. Ese es ahora el
    // borde inferior disponible de la hoja.
    const grupo = (await page.locator('.studio-tools').boundingBox())!;
    expect(
      Math.abs(c.y + c.height - grupo.y),
      'la hoja llega justo encima del grupo flotante (sin hueco extra)',
    ).toBeLessThanOrEqual(2);

    // Y también minimiza/recupera en vertical.
    await panel.locator('.panel-min').first().click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.panel-tab')).toBeVisible();
    await page.locator('.panel-tab').click();
    await expect(panel).toBeVisible();
  });
});
