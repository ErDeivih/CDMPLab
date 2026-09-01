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
