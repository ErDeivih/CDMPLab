import { test, expect, Page } from '@playwright/test';

// =============================================================
// Auditoría #10: sin errores de consola ni peticiones fallidas
// (404 / red) en los flujos principales de la pizarra. Recorre la
// carga de TODOS los PNG de material (riesgo 404), cambiar campo y
// orientación, guardar/reabrir y exportar. Cualquier error de
// consola o respuesta >= 400 rompe el test.
// =============================================================

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    const team = { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now };
    const players = [
      { id: 'p1', teamId: 't1', name: 'Marcos', number: 2, position: 'DF', color: '#1a73e8', active: true, createdAt: now },
      { id: 'p2', teamId: 't1', name: 'Pau', number: 10, position: 'MF', color: '#c0392b', active: true, createdAt: now },
    ];
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:teams', JSON.stringify([team]));
    localStorage.setItem('entrenolab:players', JSON.stringify(players));
    localStorage.setItem('entrenolab:exercises', JSON.stringify([]));
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  });
}

/** Pulsa una herramienta activando primero su categoría. */
async function useTool(page: Page, title: string, category?: string): Promise<void> {
  if (category) await page.locator('.tools-cat', { hasText: category }).click();
  await page.locator(`.rail-btn[title="${title}"]`).click();
}

/** Abre el panel Propiedades (derecha), que empieza cerrado (Fase 1). */
async function openProps(page: Page): Promise<void> {
  if (await page.locator('.studio-panel').isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Propiedades"]').click();
  await expect(page.locator('.studio-panel')).toBeVisible();
  await page.waitForTimeout(60);
}

test('no hay errores de consola ni peticiones fallidas en los flujos de la pizarra', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()} (${req.failure()?.errorText ?? 'sin error'})`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`${res.status()} ${res.url()}`);
  });

  await seed(page);
  await page.goto('/board');
  const box = (await page.locator('.board-host').boundingBox())!;
  const pt = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

  // Carga los 14 PNG de material base (cada uno dispara una petición de imagen).
  const materials: Array<[string, number, number]> = [
    ['Cono', 0.15, 0.3],
    ['Marcador', 0.3, 0.3],
    ['Pértiga / poste', 0.45, 0.3],
    ['Maniquí', 0.6, 0.3],
    ['Valla', 0.75, 0.3],
    ['Aro', 0.15, 0.45],
    ['Escalera', 0.3, 0.45],
    ['Mini portería', 0.45, 0.45],
    ['Balón', 0.6, 0.45],
    ['Banderín', 0.75, 0.45],
    ['Minitrampolín', 0.15, 0.6],
    ['Diana', 0.3, 0.6],
    ['Red', 0.45, 0.6],
    ['Balón morado', 0.6, 0.6],
  ];
  for (const [title, fx, fy] of materials) {
    await useTool(page, title, 'Material');
    const [x, y] = pt(fx, fy);
    await page.mouse.click(x, y);
  }
  await expect(page.locator('.field-count')).toHaveText(String(materials.length));

  // Un jugador propio + dibujos vectoriales.
  await useTool(page, 'Jugador propio', 'Jugadores');
  const [px, py] = pt(0.42, 0.5);
  await page.mouse.click(px, py);
  await useTool(page, 'Rectángulo', 'Dibujo');
  await useTool(page, 'Línea', 'Dibujo');
  await page.mouse.move(...pt(0.3, 0.7));
  await page.mouse.down();
  await page.mouse.move(...pt(0.6, 0.8), { steps: 4 });
  await page.mouse.up();

  // Cambiar campo (half) y orientación (vertical). (La "Rejilla" fue retirada por el dueño.)
  await openProps(page);
  await page.locator('.studio-panel .field', { hasText: 'Campo base' }).locator('select').selectOption('half');
  await page.locator('.studio-panel .field', { hasText: 'Orientación' }).locator('.chip[data-orient="vertical"]').click();

  // Guardar → reabrir (thumbnail + normalización).
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.field-count')).toHaveText(String(materials.length + 2));

  // Exportar PNG (SVG → canvas → descarga) desde el menú Exportar unificado.
  const dlPromise = page.waitForEvent('download');
  await page.locator('[aria-label="Exportar"]').click();
  await page.locator('.top-pop-export [title="Descargar PNG"]').click();
  await dlPromise;

  // Dejar que las peticiones/errores pendientes se asienten.
  await page.waitForTimeout(500);
  expect(problems).toEqual([]);
});

test('no hay errores de consola ni peticiones fallidas en plantilla, biblioteca y sesiones', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()} (${req.failure()?.errorText ?? 'sin error'})`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`${res.status()} ${res.url()}`);
  });

  await seed(page);

  // Plantilla: añadir y quitar un jugador.
  await page.goto('/team');
  await page.getByText('Añadir jugador').click();
  await page.locator('.modal input[name="name"]').fill('Eric');
  await page.locator('.modal input[name="number"]').fill('5');
  await page.getByText('Guardar').click();
  await expect(page.getByText('Eric')).toBeVisible();

  // Biblioteca: crear tarea, carpeta y reabrir.
  await page.goto('/library');
  await page.locator('.tree-add').click();
  await page.locator('.tree-inline input.folder-input').fill('Posesión');
  await page.locator('.tree-inline').getByText('Crear').click();
  await page.getByText('Crear tarea').first().click();
  await page.locator('.modal input[name="title"]').fill('Rondos');
  await page.locator('.modal textarea[name="description"]').fill('Conservación del balón');
  await page.getByText('Guardar').click();
  await expect(page.locator('.ex-card')).toHaveCount(1);
  await page.locator('.ex-card').first().locator('.ex-more-btn').click();
  await page.locator('[title="Editar datos"]').first().click();
  await expect(page.locator('.modal textarea[name="description"]')).toHaveValue('Conservación del balón');
  await page.getByText('Guardar').click();

  // Sesiones: crear una sesión con la tarea.
  await page.goto('/sessions');
  await page.getByText('Nueva sesión').click();
  await page.locator('.modal input[name="title"]').fill('Mi sesión');
  await page.locator('.tasks-head').getByText('Añadir ejercicio').click();
  await page.locator('.picker-item', { hasText: 'Rondos' }).click();
  await page.getByText('Guardar sesión').click();
  await expect(page.getByText('Mi sesión')).toBeVisible();

  await page.waitForTimeout(400);
  expect(problems).toEqual([]);
});
