import { test, expect, Page } from '@playwright/test';

function seed() {
  return `(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]));
    localStorage.setItem('entrenolab:players', JSON.stringify([{ id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now }]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  })()`;
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-host')).toBeVisible();
  if (await page.locator('.help-close').isVisible().catch(() => false)) await page.locator('.help-close').click();
}

test.describe('Fase 6 — aviso de orientación móvil', () => {
  test.use({ hasTouch: true });

  test('en portrait se muestra «Gira el móvil…» y «Continuar en vertical» lo descarta', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(seed());
    await openBoard(page);
    const hint = page.locator('.orient-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Gira el móvil');
    // Fase 2: mientras está el aviso de orientación, la pista de recorrido NO se muestra
    // (nunca dos avisos flotantes a la vez).
    await expect(page.locator('.fill-hint')).toBeHidden();
    await hint.locator('.orient-hint-btn').click();
    await expect(hint).toBeHidden();
    // Tras "Continuar en vertical", la pista de pan/zoom puede mostrarse (una vez), si no
    // se había descartado; lo importante es que NUNCA haya dos a la vez.
    const fillCount = await page.locator('.fill-hint').count();
    expect(fillCount).toBeLessThanOrEqual(1);
  });

  test('al girar a LANDSCAPE el aviso se oculta automáticamente', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(seed());
    await openBoard(page);
    await expect(page.locator('.orient-hint')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    // FASE G: al girar el aviso se oculta; el `.toBeHidden()` siguiente es la condición
    // observable (el wait fijo era redundante).
    await expect(page.locator('.orient-hint')).toBeHidden();
  });

  test('no bloquea la colocación de un objeto (el campo sigue siendo usable)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(seed());
    await openBoard(page);
    await expect(page.locator('.orient-hint')).toBeVisible();
    await page.locator('.tools-cat', { hasText: 'Jugadores' }).click();
    await page.locator('.side-panel-left').first().waitFor();
    await page.locator('.tray-player[title="Jugador Azul"]').click();
    // FASE G: la colocación se espera con el `toHaveText('1')` final (observable);
    // el wait fijo post-arma era redundante.
    // FASE B (regla C): en móvil vertical (390x844) el panel persistente tapa el centro
    // del campo; lo cerramos con su botón X (.panel-close) para poder tocar el punto de
    // colocación. Cerrar el panel NO desarma la colocación ya armada.
    await page.locator('.side-panel-left .panel-close').click();
    const host = (await page.locator('.board-host').boundingBox())!;
    await page.touchscreen.tap(host.x + host.width / 2, host.y + host.height / 2);
    await expect(page.locator('.field-count')).toHaveText('1');
  });
});
