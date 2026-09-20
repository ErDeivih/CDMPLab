import { expect, type Page } from '@playwright/test';

/**
 * FASE 3: el menú contextual de la pizarra se abre exclusivamente por PULSACIÓN LARGA
 * (el clic derecho fue retirado). Mantiene el botón pulsado ~600 ms (> el umbral de
 * 550 ms de la app) y lo suelta en el mismo punto, abriendo el `.context-bar`.
 *
 * La colocación y la selección siguen funcionando con clic normal o derecho (la app
 * actúa en `pointerdown`, independiente del botón); este helper es SOLO para abrir la
 * barra de contexto (rotar ±90°, duplicar, eliminar).
 */
export async function longPress(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  // La pulsación larga es el GESTO en sí: hay que mantener el puntero bajado durante los
  // ~550 ms del umbral de la app para que se dispare. Es un hold intencional, no un settle.
  await page.waitForTimeout(600);
  await page.mouse.up();
}

/**
 * A5: pone un título al ejercicio antes de guardar. El guardado se BLOQUEA si el título
 * está vacío, así que los tests que guardan deben fijarlo antes de pulsar "Guardar".
 *
 * El campo de título vive en el panel de Propiedades (`.studio-panel`), que en escritorio
 * arranca cerrado. Este helper lo abre si hace falta, rellena el título y, si lo abrió
 * él, lo vuelve a cerrar para dejar el estado del panel tal como estaba (las llamadas
 * posteriores que asumen el panel cerrado no se rompen). En móvil el panel puede no
 * verse (viewport compacto) solo si hay otros paneles abiertos; aquí solo se usa en
 * escritorio, donde el panel se abre con el toggle.
 */
export async function fillBoardTitle(page: Page, title: string): Promise<void> {
  const titleField = page.locator('.studio-panel input[aria-label="Título del ejercicio"]');
  // Garantiza que el input de título sea VISIBLE. Si el panel de Propiedades no está
  // abierto, se abre con el toggle y se espera a que el input aparezca. Se usa `visible`
  // (no isVisible previo) para no depender de un estado que puede ir un frame por detrás.
  // Solo se abre si el input NO está ya presente/en su panel: así no se togglea un panel
  // que YA estaba abierto (lo cerraría) y no se rompe el estado esperado por el test.
  if (!(await titleField.isVisible().catch(() => false))) {
    const propsBtn = page.locator('button[aria-label="Propiedades"]').first();
    if (await propsBtn.isVisible().catch(() => false)) await propsBtn.click();
    await titleField.waitFor({ state: 'visible', timeout: 4000 });
  }
  await titleField.fill(title);
}

/**
 * FASE G — espera OBSERVABLE a que terminen las animaciones/transiciones CSS del elemento
 * dado, en lugar de una espera fija antes de una captura. Si el elemento no existe o no
 * tiene animaciones, resuelve de inmediato (no bloquea). Sustituye los `waitForTimeout`
 * de las capturas de galerías (familia 5) por el estado real de la animación.
 */
export async function waitForTransitions(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return true;
    return (el as Element)
      .getAnimations()
      .every((a) => a.playState !== 'running' && a.playState !== 'pending');
  }, selector);
}
/**
 * Abre el diálogo de Ajustes.
 *
 * CONTRATO ACTUALIZADO (fase shell+móvil): el botón de Ajustes vivía en la barra superior, que se
 * ha ELIMINADO del DOM; ahora se entra desde el menú de cuenta (botón al pie de la barra lateral en
 * escritorio, «Más» en móvil). El diálogo y todo lo que hay dentro son los mismos: cambia la puerta
 * de entrada, no la función. Este helper evita repetir la secuencia en cada spec.
 */
export async function abrirAjustes(page: Page): Promise<void> {
  await page.locator('.cuenta-btn:visible, .nav-mas:visible').first().click();
  await expect(page.locator('.cuenta-panel')).toBeVisible();
  await page.locator('.cuenta-accion', { hasText: 'Ajustes' }).click();
  await expect(page.locator('.settings')).toBeVisible();
}

/**
 * Abre el menú «Más» de la PIZARRA (`.top-pop-mas`).
 *
 * CONTRATO ACTUALIZADO (franja de estado retirada): «Llenar pantalla / Ver campo completo» ya no
 * vive en la franja superior del campo —el dueño la retiró porque comía altura del campo—, sino
 * dentro de este menú. El disparador se busca DENTRO de `.studio-top` a propósito: el shell tiene
 * otro «Más» en su barra inferior (`.nav-mas`) y en móvil los dos existen en el DOM.
 */
export async function abrirMasPizarra(page: Page): Promise<void> {
  if (await page.locator('.top-pop-mas').isVisible().catch(() => false)) return;
  await page.locator('.studio-top button[aria-label="Más"]').click();
  await expect(page.locator('.top-pop-mas')).toBeVisible();
}

/**
 * Alterna «Llenar pantalla» / «Ver campo completo». Es el MISMO control de siempre (conserva la
 * clase `.field-fit-toggle` para no cambiar el observable de los tests), pero ahora hay que abrir
 * el menú «Más» de la pizarra antes de pulsarlo.
 */
export async function toggleFillScreen(page: Page): Promise<void> {
  await abrirMasPizarra(page);
  await page.locator('.top-pop-mas .field-fit-toggle').click();
}
