import { test, expect, Page } from '@playwright/test';
import { abrirHerramientas } from './board-helpers';

// Todos los nombres de ligadura que usa la app (a partir del audit de fuentes).
// Si un nombre no existe en la fuente autoalojada, el navegador lo pinta como
// texto literal (ancho >> 30px) en lugar de un único glifo.
const ALL_ICONS: string[] = [
  // nav
  'group', 'sports_soccer', 'collections_bookmark', 'calendar_month', 'people',
  // herramientas / material pizarra
  'near_me', 'person', 'sports', 'change_history', 'accessibility_new', 'straighten',
  'label', 'looks_one', 'radio_button_unchecked', 'format_list_numbered', 'flag',
  'airline_seat_flat', 'radio_button_checked', 'grid_on', 'sports_volleyball', 'pin',
  'checkroom', 'landscape', 'check_box_outline_blank', 'circle', 'trending_flat',
  'swap_horiz', 'show_chart', 'horizontal_rule', 'gesture', 'crop_square', 'title', 'backspace',
  // pizarra
  'arrow_back', 'close', 'tune', 'check', 'save', 'file_download', 'more_horiz', 'lightbulb',
  'info', 'lock', 'lock_open', 'flip_to_front', 'flip_to_back', 'content_copy', 'delete',
  'search', 'image', 'cleaning_services', 'undo', 'redo', 'more_vert',
  // shell
  'login', 'settings', 'warning', 'sync_problem', 'sync', 'help',
  // sesiones
  'add', 'calendar_today', 'list', 'schedule', 'edit', 'arrow_upward', 'arrow_downward',
  // plantilla
  'person_remove',
  // biblioteca
  'apps', 'folder_open', 'expand_more', 'chevron_right', 'folder', 'create_new_folder',
  'drive_file_move', 'groups', 'restore', 'sports_soccer',
];

const GLYPH_WIDTH_LIMIT = 30;

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([
      { id: 'e1', teamId: 't1', folderId: null, title: 'Rondos', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 12, minPlayers: 6, maxPlayers: 8, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: { version: 2, schemaVersion: 3, field: 'full', frames: [{ duration: 1000, elements: [] }], orientation: 'horizontal', grass: 'stripes', lineColor: '#ffffff', backgroundColor: '#31834a' }, thumbnail: null, savedAt: now },
    ]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Mide el ancho del glifo de cada nombre ligadura usando la fuente autoalojada. */
async function measure(page: Page, names: string[]): Promise<Array<{ name: string; w: number }>> {
  return page.evaluate(async (ns: string[]) => {
    const els: HTMLSpanElement[] = [];
    for (const n of ns) {
      const s = document.createElement('span');
      s.className = 'msi';
      s.textContent = n;
      document.body.appendChild(s);
      els.push(s);
    }
    const fonts = (document as any).fonts as FontFaceSet;
    try {
      await Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 4000))]);
    } catch {
      /* ignore */
    }
    return els.map((el) => {
      const w = el.getBoundingClientRect().width;
      el.remove();
      return { name: el.textContent ?? '', w };
    });
  }, names);
}

test.describe('Iconos: la fuente Material Symbols autoalojada pinta cada ligadura como glifo', () => {
  test('ninguna ligadura de la app se pinta como texto literal', async ({ page }) => {
    test.setTimeout(120_000);
    await seed(page);
    await page.goto('/team');
    await page.locator('body').waitFor();

    const results = await measure(page, ALL_ICONS);
    const broken = results.filter((r) => r.w > GLYPH_WIDTH_LIMIT);
    expect(broken, `iconos que se pintan como texto (no glifo): ${JSON.stringify(broken)}`).toEqual([]);
    expect(results.length).toBe(ALL_ICONS.length);
  });

  test('cada .msi real en pantalla es un único glifo (no se desborda ni pinta el nombre)', async ({ page }) => {
    test.setTimeout(120_000);
    await seed(page);
    await page.goto('/library');
    await page.locator('.library').waitFor();
    await page.goto('/board');
    await page.locator('.board-host').waitFor();

    // Abrir los paneles que contienen iconos para inspeccionarlos.
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Dibujo' }).click();
    await page.locator('.side-panel-left').waitFor();
    // Cerrar el panel antes de cambiar de categoría: en escritorio el panel izquierdo
    // (Fase 15) solapa los botones de categoría del raíl (Jugadores/Material/Dibujo).
    await page.keyboard.press('Escape');
    await page.locator('.side-panel-left').waitFor({ state: 'detached' });
    await abrirHerramientas(page);
    await page.locator('.tools-cat', { hasText: 'Material' }).click();
    await page.locator('.side-panel-left').waitFor();
    await page.locator('button[aria-label="Exportar"]').click();
    await page.locator('.top-pop-export').waitFor();

    const bad = await page.evaluate((limit: number) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.msi')) {
        const r = el.getBoundingClientRect();
        const txt = (el.textContent ?? '').trim();
        // Un .msi debe pintar un único glifo: ancho pequeño.
        if (r.width > limit) out.push(`${txt} (ancho=${r.width.toFixed(0)}px)`);
      }
      return out;
    }, GLYPH_WIDTH_LIMIT);
    expect(bad, `elementos .msi que desbordan o pintan texto literal: ${JSON.stringify(bad)}`).toEqual([]);
  });
});
