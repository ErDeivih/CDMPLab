import { test, expect, Page } from '@playwright/test';

// FASE 5 — accesibilidad en TODA la app (modo local, con datos semilla).
// Recorre varias pantallas y falla si cualquier botón de icono carece de aria-label
// o title en español, o usa el nombre interno del icono como nombre accesible.
const NON_NAMES = [
  'edit', 'close', 'delete', 'person_remove', 'add', 'save', 'tune', 'more_horiz',
  'file_download', 'arrow_back', 'undo', 'redo', 'near_me', 'pan_tool', 'groups',
  'sports_soccer', 'draw', 'content_copy', 'rotate_left', 'rotate_right', 'fullscreen',
  'fullscreen_exit', 'search', 'chevron_left', 'chevron_right', 'cleaning_services',
  'lock', 'lock_open', 'flip_to_front', 'flip_to_back', 'swap_horiz', 'fit_screen',
  'settings', 'person', 'group', 'info', 'check', 'hourglass_top', 'warning',
  'label', 'picture_as_pdf', 'collections_bookmark', 'calendar_month', 'people',
  'menu', 'visibility', 'visibility_off', 'logout', 'download', 'upload', 'tune',
  'arrow_drop_down', 'expand_more', 'keyboard_arrow_down', 'keyboard_arrow_up',
];

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'pl1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([{ id: 'f1', teamId: 't1', parentId: null, name: 'Posesión' }]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([{ id: 'ex1', teamId: 't1', folderId: null, title: 'Rondo', description: '', explanation: '', category: 'Técnica', objectives: [], materials: [], durationMinutes: 15, minPlayers: null, maxPlayers: null, loadMode: 'fixed', seriesCount: null, repetitionsCount: null, workSeconds: null, restSeconds: null, isTemplate: false, canvas: null, thumbnail: null, savedAt: now }]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([{ id: 's1', teamId: 't1', title: 'Sesión 1', date: '2026-01-01', durationMinutes: 60, notes: '', tasks: [{ id: 'tk1', exerciseId: 'ex1', title: 'Rondo', durationMinutes: 15, material: '', sortOrder: 0 }], createdAt: now, savedAt: now }]));
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
  });
}

async function checkScreen(page: Page, url: string, nonNames: string[]): Promise<string[]> {
  await page.goto(url);
  // Esperar a que la app monta el shell (rutas de la app).
  await page.waitForTimeout(500);
  const bad = await page.evaluate((nonNames) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button')) {
      const aria = (el.getAttribute('aria-label') ?? '').trim();
      const title = (el.getAttribute('title') ?? '').trim();
      const text = (el.textContent ?? '').trim();
      const hasIcon = !!el.querySelector('.msi');
      // "Solo icono": su texto VISIBLE (sin las ligaduras .msi) está vacío.
      const msiText = Array.from(el.querySelectorAll('.msi')).map((s) => s.textContent ?? '').join('');
      const visible = text.replace(msiText, '').trim();
      const isIconOnly = !!hasIcon && visible.length === 0;
      if (isIconOnly) {
        const name = aria || title;
        if (!name) out.push(`sin nombre: ${el.outerHTML.slice(0, 80)}`);
        else if (nonNames.includes(name.toLowerCase())) out.push(`nombre = icono interno: "${name}"`);
      }
    }
    return out;
  }, nonNames);
  return bad;
}

const SCREENS: Array<[string, string]> = [
  ['pizarra', '/board'],
  ['biblioteca', '/library'],
  ['plantilla', '/team'],
  ['sesiones', '/sessions'],
  ['login', '/auth/login'],
  ['registro', '/auth/register'],
  ['recuperación', '/auth/forgot-password'],
  ['miembros', '/settings/team/members'],
];

test('toda la app: los botones de icono tienen nombre accesible español', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await seed(page);
  const problems: string[] = [];
  for (const [name, url] of SCREENS) {
    const bad = await checkScreen(page, url, NON_NAMES);
    for (const b of bad) problems.push(`[${name}] ${b}`);
  }
  expect(problems, 'botones de icono sin nombre accesible español').toEqual([]);
});
