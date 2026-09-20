// =============================================================
// Helpers de pizarra compartidos (FASE H).
//
// Geometría norm→pantalla, siembra y apertura de la pizarra. Se usan
// desde los specs de FASE H para no duplicar la misma lógica.
// =============================================================
import { expect, Page } from '@playwright/test';

export const RECT = { x: 4, y: 10, w: 92, h: (92 * 68) / 105 };
export const VBW = 100;
export const VBH = 80;

export type Box = { x: number; y: number; width: number; height: number };
export type Fit = 'height' | 'contain';
export type Pt = { x: number; y: number };

export function normToScreen(nx: number, ny: number, host: Box, fit: Fit): Pt {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cxg = nx * RECT.w + RECT.x;
  const cyg = ny * RECT.h + RECT.y;
  const cx = offX + cxg * s;
  const cy = offY + cyg * s;
  return {
    x: host.x + host.width / 2 + cx - host.width / 2,
    y: host.y + host.height / 2 + cy - host.height / 2,
  };
}

/** Pantalla → norm (inversa), para verificar dónde cayó un objeto. */
export function screenToNorm(sx: number, sy: number, host: Box, fit: Fit): Pt {
  const s = fit === 'height' ? host.height / RECT.h : Math.min(host.width / VBW, host.height / VBH);
  const offX = (host.width - VBW * s) / 2;
  const offY = (host.height - VBH * s) / 2;
  const cx = host.width / 2 + (sx - (host.x + host.width / 2));
  const cy = host.height / 2 + (sy - (host.y + host.height / 2));
  return {
    x: (cx - offX) / s / RECT.w + (0 - RECT.x) / RECT.w,
    y: (cy - offY) / s / RECT.h - RECT.y / RECT.h,
  };
}

/** Siembra limpia: equipo + jugadores de plantilla, sin ejercicios. */
export async function seedBoard(page: Page, opts: { players?: boolean } = {}): Promise<void> {
  const withPlayers = opts.players !== false;
  await page.addInitScript((withPl) => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify(
        withPl
          ? [
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
            ]
          : [],
      ),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, withPlayers);
}

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
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

export async function hostBox(page: Page): Promise<Box> {
  const b = await page.locator('.board-host').boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

export async function fitMode(page: Page): Promise<Fit> {
  const cls = (await page.locator('.board-host').getAttribute('class')) ?? '';
  return cls.includes('board-fill') ? 'height' : 'contain';
}

export async function fieldCount(page: Page): Promise<number> {
  return page.locator('.field-count').evaluate((el) => parseInt(el.textContent ?? '0', 10));
}

/** Abre SIEMPRE la categoría indicada (cierra antes si hay panel abierto: pulsar una
 *  categoría ya abierta la cierra). */
export async function showCategory(page: Page, cat: string): Promise<void> {
  const close = page.locator('.side-panel-left .panel-close');
  if (await close.isVisible().catch(() => false)) await close.first().click();
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: cat }).click();
  await expect(page.locator('.side-panel-left')).toBeVisible();
}

/**
 * FASE 3 — contrato entre un panel de la pizarra y el grupo flotante de herramientas.
 *
 * El grupo flota en la esquina inferior izquierda y va POR ENCIMA de los paneles (`z-index` 86 > 40)
 * a propósito: así Cursor/Mano/Herramientas siguen operables con un panel abierto, que es lo que
 * permite cambiar de herramienta sin cerrarlo. Para que esa prioridad no se coma clics del panel, la
 * franja inferior está RESERVADA (`--reserva-grupo-herramientas`: 96 px en escritorio, 62 px en
 * compacto) y ningún panel baja hasta ella. Medido antes de la reserva: el grupo interceptaba los
 * clics de las últimas filas del catálogo y de la plantilla («Mancuerna / pesa» no se podía pulsar).
 *
 * El contrato es, por tanto, el mismo que había con la barra inferior: el panel termina por ENCIMA
 * del grupo, y el grupo sigue visible y operable.
 */
export async function expectPanelLibreDelGrupo(page: Page, panelSel: string): Promise<void> {
  const panel = page.locator(panelSel);
  await expect(panel, `el panel ${panelSel} está visible`).toBeVisible();
  const caja = (await panel.boundingBox())!;
  const grupo = (await page.locator('.studio-tools').boundingBox())!;
  expect(grupo, 'el grupo flotante tiene caja').not.toBeNull();
  expect(
    caja.y + caja.height,
    `el panel ${panelSel} termina por encima del grupo flotante (panel ${Math.round(caja.y + caja.height)} vs grupo ${Math.round(grupo.y)})`,
  ).toBeLessThanOrEqual(grupo.y + 1);
  await expect(
    page.locator('.rail-btn[aria-label="Seleccionar y mover"]'),
    'el grupo sigue operable con el panel abierto',
  ).toBeVisible();
}

/** Oculta los overlays flotantes (panel/barra contextual) sin cambiar el estado. */
export async function hideOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.studio-panel, .top-pop, .context-bar').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  });
}

/**
 * FASE 3 — abre el menú «Herramientas» (categorías) del grupo flotante del tablero.
 *
 * CAMBIO DE CONTRATO VISUAL DECLARADO: la barra inferior del tablero se sustituyó por un grupo
 * flotante anclado a la esquina inferior izquierda, así que el campo recupera los 57 px de alto que
 * la barra reservaba. Las tres categorías (Jugadores/Material/Dibujo) ya NO están siempre en el DOM:
 * viven en el menú que abre el botón «Herramientas», y el menú se cierra solo al elegir categoría
 * (para no tapar la banda inferior del campo mientras se coloca). Por eso pulsar un `.tools-cat`
 * exige abrir el menú antes: el código de la app es el correcto según el encargo y lo que cambió es
 * el contrato del DOM, de modo que se actualizan las pruebas, no la app.
 *
 * Es idempotente (si ya está abierto no hace nada) y consulta el DOM real, no una variable.
 */
export async function abrirHerramientas(page: Page): Promise<void> {
  const menu = page.locator('.tools-menu');
  if (await menu.isVisible().catch(() => false)) return;
  await page.locator('.tools-toggle').click();
  await menu.waitFor({ state: 'visible' });
}

/** Selecciona una herramienta de Dibujo por su título. */
export async function useDrawTool(page: Page, title: string): Promise<void> {
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

/** Dibuja arrastrando en un gesto desde (nx0,ny0) a (nx1,ny1). */
export async function dragDraw(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const a = normToScreen(from[0], from[1], host, fit);
  const b = normToScreen(to[0], to[1], host, fit);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}
