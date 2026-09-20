import { test, expect, Page } from '@playwright/test';

/**
 * ACCESIBILIDAD DEL MENÚ DE CUENTA / «Más» (defectos del informe del dueño).
 *
 * QUÉ SE COMPRUEBA (y con qué observable):
 *  1. `aria-controls` del botón «Más» apunta al diálogo que REALMENTE abre (`#cuenta-menu`), no a
 *     un contenedor interno (`#cuenta-mas` era el contenedor de acciones): se resuelve el id y se
 *     exige que sea el `role="dialog"` visible.
 *  2. Al abrir, el foco entra en el diálogo (primer control = botón Cerrar).
 *  3. Tab y Shift+Tab no sacan el foco del diálogo (varias vueltas completas): el fondo queda
 *     `inert`, así que ningún control tapado por la capa puede recibir foco.
 *  4. Escape cierra y devuelve el foco al disparador; la X también. Probado en escritorio
 *     (`.cuenta-btn`) y en móvil (`.nav-mas`).
 *  5. Abrir Ajustes desde el menú y cerrarlo devuelve el foco al disparador de Cuenta/Más.
 *  6. Recorrido SOLO con teclado: Tab hasta el disparador, Enter para abrir, Tab por el diálogo,
 *     Enter en Ajustes, Escape para cerrar; nunca se usa el ratón.
 *
 * NO SE COMPRUEBA AQUÍ (pendiente manual declarado, no se afirma): el comportamiento con lector de
 * pantalla real (NVDA/VoiceOver/TalkBack). El E2E solo verifica el DOM, el foco y el teclado.
 *
 * El caso del colaborador con rol `editor` (no debe ver «Miembros») NO está aquí: el rol lo resuelve
 * el servidor y el E2E corre en modo local sin sesión, así que se cubre con un test de componente
 * con `AccessService` sustituido (`src/app/app.spec.ts`).
 */

const ESCRITORIO = { width: 1366, height: 768 };
const MOVIL_V = { width: 390, height: 844 };

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
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, equipos);
}

/** Elemento con el foco, descrito de forma legible para los mensajes de fallo. */
async function focoActual(page: Page): Promise<{ dentro: boolean; descripcion: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const panel = document.querySelector('.cuenta-panel');
    const descripcion = el
      ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20) ?? ''}]`
      : 'null';
    return { dentro: !!el && !!panel && panel.contains(el), descripcion };
  });
}

test.describe('Accesibilidad del menú de cuenta («Más»)', () => {
  test('1. aria-controls de «Más» apunta al diálogo real que abre', async ({ page }) => {
    await page.setViewportSize(MOVIL_V);
    await seed(page);
    await page.goto('/team');

    const mas = page.locator('.nav-mas');
    await expect(mas).toBeVisible();
    const controls = await mas.getAttribute('aria-controls');
    expect(controls, 'el botón declara a qué control apunta').toBeTruthy();
    // El id declarado debe ser el del DIÁLOGO. Se comprueba tras abrir, porque el diálogo se crea
    // al abrirlo (`@if`): antes de abrir, el id no existe y no se puede resolver.
    await mas.click();
    const apuntado = page.locator(`#${controls}`);
    await expect(apuntado, `#${controls} es el diálogo visible`).toBeVisible();
    await expect(apuntado).toHaveAttribute('role', 'dialog');
    await expect(apuntado).toHaveAttribute('aria-modal', 'true');
    await expect(apuntado).toHaveClass(/cuenta-panel/);
  });

  test('2-3. al abrir el foco entra en el diálogo y Tab/Shift+Tab no lo abandonan', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await page.goto('/team');

    await page.locator('.cuenta-btn').click();
    const panel = page.locator('.cuenta-panel');
    await expect(panel).toBeVisible();

    // El foco entra en el diálogo (primer control en orden DOM = botón Cerrar).
    await expect
      .poll(async () => (await focoActual(page)).dentro, {
        message: 'al abrir, el foco está dentro del diálogo',
      })
      .toBe(true);
    await expect(
      page.locator('.cuenta-panel button[aria-label="Cerrar el menú de cuenta"]'),
    ).toBeFocused();

    // Vueltas completas con Tab: en ningún momento el foco sale del diálogo.
    const controles = await page
      .locator('.cuenta-panel a[href], .cuenta-panel button, .cuenta-panel select')
      .count();
    expect(controles, 'el diálogo tiene controles que recorrer').toBeGreaterThan(1);
    for (let i = 0; i < controles + 3; i++) {
      await page.keyboard.press('Tab');
      const foco = await focoActual(page);
      expect(foco.dentro, `tras ${i + 1} Tab el foco sigue dentro (${foco.descripcion})`).toBe(
        true,
      );
    }
    for (let i = 0; i < controles + 3; i++) {
      await page.keyboard.press('Shift+Tab');
      const foco = await focoActual(page);
      expect(foco.dentro, `tras ${i + 1} Shift+Tab el foco sigue dentro`).toBe(true);
    }

    // El fondo queda inerte: el contenido de la app NO puede recibir foco.
    expect(
      await page.locator('.shell').evaluate((el) => el.hasAttribute('inert')),
      'el contenido de detrás de la capa está inerte',
    ).toBe(true);
    // Y ningún control visible de detrás tiene el foco.
    const enlacesVisibles = page.locator('.shell .nav-item');
    for (let i = 0; i < (await enlacesVisibles.count()); i++) {
      const enfocado = await enlacesVisibles
        .nth(i)
        .evaluate((el) => el === document.activeElement)
        .catch(() => false);
      expect(enfocado, 'un control tapado por la capa no puede tener el foco').toBe(false);
    }
  });

  test('4. Escape y la X cierran el menú y devuelven el foco al disparador (escritorio y móvil)', async ({
    page,
  }) => {
    for (const [vp, disparador] of [
      [ESCRITORIO, '.cuenta-btn'],
      [MOVIL_V, '.nav-mas'],
    ] as const) {
      await page.setViewportSize(vp);
      await seed(page);
      await page.goto('/team');
      const boton = page.locator(disparador);
      await expect(boton).toBeVisible();

      // Escape.
      await boton.click();
      await expect(page.locator('.cuenta-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.cuenta-panel')).toHaveCount(0);
      await expect(boton, `el foco vuelve al disparador ${disparador} tras Escape`).toBeFocused();
      expect(
        await page.locator('.shell').evaluate((el) => el.hasAttribute('inert')),
        'el fondo deja de estar inerte al cerrar',
      ).toBe(false);

      // Botón de cerrar (X).
      await boton.click();
      await page.locator('.cuenta-panel button[aria-label="Cerrar el menú de cuenta"]').click();
      await expect(page.locator('.cuenta-panel')).toHaveCount(0);
      await expect(boton, `el foco vuelve al disparador ${disparador} tras la X`).toBeFocused();
    }
  });

  test('5. abrir Ajustes desde el menú y cerrarlo devuelve el foco al disparador de Cuenta/Más', async ({
    page,
  }) => {
    for (const [vp, disparador] of [
      [ESCRITORIO, '.cuenta-btn'],
      [MOVIL_V, '.nav-mas'],
    ] as const) {
      await page.setViewportSize(vp);
      await seed(page);
      await page.goto('/team');
      const boton = page.locator(disparador);

      await boton.click();
      await page.locator('.cuenta-panel .cuenta-accion', { hasText: 'Ajustes' }).click();
      const ajustes = page.locator('.settings');
      await expect(ajustes).toBeVisible();
      await expect(page.locator('.cuenta-panel'), 'el menú no se queda abierto detrás').toHaveCount(
        0,
      );
      // El foco entra en Ajustes (no se queda en el botón que ya no existe).
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            const dlg = document.querySelector('.settings');
            return !!el && !!dlg && dlg.contains(el);
          }),
        )
        .toBe(true);
      await expect(page.locator('.settings button[aria-label="Cerrar"]')).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(ajustes).toHaveCount(0);
      await expect(
        boton,
        `al cerrar Ajustes el foco vuelve al disparador ${disparador} de Cuenta/Más`,
      ).toBeFocused();
      expect(
        await page.locator('.shell').evaluate((el) => el.hasAttribute('inert')),
        'el fondo recupera la interacción',
      ).toBe(false);
    }
  });

  test('6. recorrido completo SOLO con teclado: abrir, navegar, abrir Ajustes y cerrar', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await page.goto('/team');

    // Solo teclado: Tab hasta el disparador de cuenta (está al final de la barra lateral).
    const boton = page.locator('.cuenta-btn');
    let alcanzado = false;
    for (let i = 0; i < 40 && !alcanzado; i++) {
      await page.keyboard.press('Tab');
      alcanzado = await boton.evaluate((el) => el === document.activeElement);
    }
    expect(alcanzado, 'se llega al botón de cuenta con Tab (sin ratón)').toBe(true);

    // Enter abre el diálogo (comportamiento nativo del botón).
    await page.keyboard.press('Enter');
    await expect(page.locator('.cuenta-panel')).toBeVisible();

    // Tab hasta «Ajustes» y Enter para abrirlo, todo con el teclado.
    const ajustesBtn = page.locator('.cuenta-panel .cuenta-accion', { hasText: 'Ajustes' });
    let sobreAjustes = false;
    for (let i = 0; i < 12 && !sobreAjustes; i++) {
      await page.keyboard.press('Tab');
      sobreAjustes = await ajustesBtn.evaluate((el) => el === document.activeElement);
    }
    expect(sobreAjustes, 'se llega a «Ajustes» con Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('.settings')).toBeVisible();

    // Escape cierra Ajustes y el foco vuelve al disparador de Cuenta.
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings')).toHaveCount(0);
    await expect(boton).toBeFocused();
  });
});
