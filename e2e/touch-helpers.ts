// =============================================================
// Helpers TÁCTILES compartidos (FASE H).
//
// Extraídos TAL CUAL de los helpers ya validados en
// `fase-ux-movil.spec.ts` (arrastre de panel al campo con
// pointerdown/pointermove/pointerup) para que exista UNA sola
// implementación reutilizada por los specs de FASE H y por
// `fase-ux-movil`, en lugar de crear variantes distintas.
// =============================================================
import type { Page } from '@playwright/test';

export type Pt = { x: number; y: number };

/** Despacha un PointerEvent táctil sobre un elemento del panel (selector). */
export async function ptrItem(
  page: Page,
  selector: string,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  pointerId: number
): Promise<void> {
  await page.evaluate(({ selector, type, x, y, pointerId }) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    }));
  }, { selector, type, x, y, pointerId });
}

/** Despacha un PointerEvent táctil sobre `.board-host`. */
export async function ptrBoard(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  pointerId = 7,
  isPrimary = false
): Promise<void> {
  await page.evaluate(({ type, x, y, pointerId, isPrimary }) => {
    const host = document.querySelector('.board-host') as HTMLElement | null;
    if (!host) return;
    host.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
    }));
  }, { type, x, y, pointerId, isPrimary });
}

export async function tapBoard(page: Page, x: number, y: number): Promise<void> {
  await ptrBoard(page, 'pointerdown', x, y, 7, true);
  await ptrBoard(page, 'pointerup', x, y, 7);
}

/** Inicia un arrastre táctil desde una ficha del panel (pointerdown + moves), SIN soltar.
 *  Devuelve la función para soltar en la posición final. Permite capturar DURANTE el arrastre. */
export async function begindragItem(
  page: Page,
  selector: string,
  drop: Pt,
  steps = 8,
  pointerId = 91
): Promise<() => Promise<void>> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await ptrItem(page, selector, 'pointerdown', startX, startY, pointerId);
  for (let i = 1; i <= steps; i++) {
    const x = startX + ((drop.x - startX) * i) / steps;
    const y = startY + ((drop.y - startY) * i) / steps;
    await ptrItem(page, selector, 'pointermove', x, y, pointerId);
  }
  return async () => { await ptrItem(page, selector, 'pointerup', drop.x, drop.y, pointerId); };
}

/** Arrastre táctil COMPLETO desde una ficha del panel hasta un punto del campo. */
export async function dragItemToField(page: Page, selector: string, drop: Pt, steps = 8): Promise<void> {
  const release = await begindragItem(page, selector, drop, steps);
  await release();
}
