import type { Page } from '@playwright/test';

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
