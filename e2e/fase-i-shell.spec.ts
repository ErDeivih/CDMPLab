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

/** Abre el menú de cuenta (escritorio: botón al pie de la barra lateral; móvil: «Más»). */
async function abrirCuenta(page: Page): Promise<void> {
  // CONTRATO ACTUALIZADO (defecto de la doble navegación corregido): ahora SOLO una de las dos
  // navegaciones se muestra según el viewport, así que el botón «Más» de la barra inferior NO
  // existe visible en escritorio. El selector tiene que filtrar por visibilidad: sin `:visible`,
  // `.first()` elegía el «Más` oculto y el clic esperaba para siempre (el fallo era de la prueba,
  // no de la app: en escritorio la navegación de móvil debe estar oculta).
  const boton = page.locator('.cuenta-btn:visible, .nav-mas:visible').first();
  await boton.click();
  await expect(page.locator('.cuenta-panel')).toBeVisible();
}

test.describe('Lote C4 — Shell: conmutador de equipo', () => {
  // CONTRATO ACTUALIZADO (fase shell+móvil): el conmutador de equipo ya NO vive en una barra
  // superior —esa barra se ha eliminado del DOM, ocupaba 56 px en todas las pantallas y en móvil
  // robaba altura útil—. Ahora está en el menú de cuenta (`.cuenta-panel`), que en escritorio se
  // abre desde el botón del pie de la barra lateral y en móvil desde «Más». El contrato anterior
  // («el conmutador está visible en la cabecera al cargar») dejó de ser válido porque la cabecera
  // ya no existe: las funciones son las mismas, cambia dónde se ofrecen.
  test('con dos equipos se puede cambiar y la elección se recuerda al recargar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, TEAMS);
    await page.goto('/team');

    // Arranca en el primer equipo y el menú de cuenta ofrece los dos.
    await abrirCuenta(page);
    const select = page.locator('.cuenta-panel .team-switch select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('t1');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('.data-table tbody')).toContainText('Titular A');

    // Cambiar de equipo cambia la plantilla mostrada (y cierra el menú).
    await select.selectOption('t2');
    await expect(page.locator('.cuenta-panel')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('.data-table tbody')).toContainText('Cadete B');
    await expect(page.locator('.data-table tbody')).not.toContainText('Titular A');

    // La elección SOBREVIVE a una recarga (antes no se guardaba: volvía al primero).
    await page.reload();
    await abrirCuenta(page);
    await expect(page.locator('.cuenta-panel .team-switch select')).toHaveValue('t2');
    await page.keyboard.press('Escape');
    await expect(page.locator('.data-table tbody')).toContainText('Cadete B');
  });

  test('con un solo equipo NO hay conmutador (el menú muestra el nombre)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seed(page, [TEAMS[0]]);
    await page.goto('/team');
    await abrirCuenta(page);
    await expect(page.locator('.cuenta-panel .team-switch')).toHaveCount(0);
    await expect(page.locator('.cuenta-panel .cuenta-valor')).toHaveText('Primer Equipo');
  });

  test('en móvil el conmutador cabe sin desbordar (vive en «Más») y no hay barra superior', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, TEAMS);
    await page.goto('/team');

    // La cabecera antigua ya no existe en el DOM.
    await expect(page.locator('.topbar')).toHaveCount(0);
    await abrirCuenta(page);
    const select = page.locator('.cuenta-panel .team-switch select');
    await expect(select).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'sin desborde horizontal').toBeLessThanOrEqual(1);
    const box = (await select.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(320);
  });
});
