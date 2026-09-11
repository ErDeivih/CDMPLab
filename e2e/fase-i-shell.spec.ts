// =============================================================
// LOTE C4 — Shell: conmutador de equipo.
//
// Con más de un equipo (multi-rol/multi-equipo, caso real del club) no había forma de
// cambiar: la cabecera solo mostraba el activo. Y la elección no se recordaba entre
// recargas.
// =============================================================
import { test, expect, Page } from '@playwright/test';

const TEAMS = [
  {
    id: 't1',
    name: 'Primer Equipo',
    accentColor: '#3056d3',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  { id: 't2', name: 'Cadete A', accentColor: '#c8102e', createdAt: '2026-01-02T00:00:00.000Z' },
];

const PLAYERS = [
  {
    id: 'p1',
    teamId: 't1',
    name: 'Titular A',
    number: 1,
    position: 'GK',
    color: '#1a73e8',
    active: true,
    createdAt: 'x',
  },
  {
    id: 'p2',
    teamId: 't2',
    name: 'Cadete B',
    number: 7,
    position: 'FW',
    color: '#c0392b',
    active: true,
    createdAt: 'x',
  },
];

async function seed(page: Page, teams: unknown[], players: unknown[] = PLAYERS): Promise<void> {
  await page.addInitScript(
    (data: { teams: unknown[]; players: unknown[] }) => {
      if (localStorage.getItem('entrenolab:seeded')) return;
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:teams', JSON.stringify(data.teams));
      localStorage.setItem('entrenolab:players', JSON.stringify(data.players));
      localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
      localStorage.setItem('entrenolab:folders', JSON.stringify([]));
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    },
    { teams, players },
  );
}

const rows = (page: Page) => page.locator('.data-table tbody tr');

test.describe('Lote C4 — Shell: conmutador de equipo', () => {
  test('con dos equipos se puede cambiar y la elección se recuerda al recargar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, TEAMS);
    await page.goto('/team');

    // Arranca en el primer equipo y el conmutador ofrece los dos.
    const select = page.locator('.team-switch select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('t1');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('.data-table tbody')).toContainText('Titular A');

    // Cambiar de equipo cambia la plantilla mostrada.
    await select.selectOption('t2');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('.data-table tbody')).toContainText('Cadete B');
    await expect(page.locator('.data-table tbody')).not.toContainText('Titular A');

    // La elección SOBREVIVE a una recarga (antes no se guardaba: volvía al primero).
    await page.reload();
    await expect(page.locator('.team-switch select')).toHaveValue('t2');
    await expect(page.locator('.data-table tbody')).toContainText('Cadete B');
  });

  test('con un solo equipo NO hay conmutador (solo el nombre)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, [TEAMS[0]]);
    await page.goto('/team');
    await expect(page.locator('.team-switch')).toHaveCount(0);
    await expect(page.locator('.topbar-title')).toHaveText('Primer Equipo');
  });

  test('en móvil el conmutador cabe sin desbordar la cabecera', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, TEAMS);
    await page.goto('/team');

    const select = page.locator('.team-switch select');
    await expect(select).toBeVisible();
    // El topbar mide 56 px de alto: el selector no puede provocar scroll horizontal.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'sin desborde horizontal en la cabecera').toBeLessThanOrEqual(1);
    const box = (await select.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(200);
  });
});
