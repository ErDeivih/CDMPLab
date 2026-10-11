import { test, expect } from '@playwright/test';

for (const orientation of ['horizontal', 'vertical'] as const) {
  test(`texto ${orientation}: legible, asas coherentes, escala letra, undo y guardado`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((orientation) => {
      if (localStorage.getItem('entrenolab:seeded')) return;
      const now = new Date().toISOString();
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:board-hints', '1');
      localStorage.setItem('entrenolab:fill-hint', '1');
      localStorage.setItem(
        'entrenolab:teams',
        JSON.stringify([{ id: 't1', name: 'Equipo', accentColor: '#3056d3', createdAt: now }]),
      );
      for (const key of ['players', 'folders', 'sessions'])
        localStorage.setItem(`entrenolab:${key}`, '[]');
      localStorage.setItem(
        'entrenolab:exercises',
        JSON.stringify([
          {
            id: 'texto',
            teamId: 't1',
            folderId: null,
            title: 'Texto UX',
            description: '',
            explanation: '',
            category: 'Técnica',
            objectives: [],
            materials: [],
            durationMinutes: 10,
            loadMode: 'fixed',
            isTemplate: false,
            thumbnail: null,
            savedAt: now,
            canvas: {
              version: 2,
              // Esquema actual: no activar la migración histórica de tamaño (v4 → v5).
              schemaVersion: 5,
              field: 'half',
              orientation,
              frames: [
                {
                  duration: 1000,
                  elements: [
                    {
                      id: 'texto',
                      t: 'text',
                      x: 0.45,
                      y: 0.4,
                      w: 0.3,
                      h: 0.12,
                      size: 2,
                      v: 'Presión tras pérdida',
                    },
                  ],
                },
              ],
            },
          },
        ]),
      );
    }, orientation);
    await page.goto('/library');
    await page.locator('.ex-card').first().locator('.ex-open-btn').click();
    await page.waitForURL('**/board');
    const text = page.locator('.board-canvas [data-el-type="text"]');
    await text.locator('text').click();
    await expect(page.locator('.reshandle')).toHaveCount(4);
    const matrix = await text.locator('text').evaluate((e) => {
      const m = (e as SVGGraphicsElement).getScreenCTM()!;
      return { b: m.b, c: m.c, a: m.a, d: m.d };
    });
    expect(Math.abs(matrix.b)).toBeLessThan(0.001);
    expect(Math.abs(matrix.c)).toBeLessThan(0.001);
    expect(matrix.a).toBeGreaterThan(0);
    expect(matrix.d).toBeGreaterThan(0);
    const handles = page.locator('.reshandle');
    const a = (await handles.nth(0).boundingBox())!,
      b = (await handles.nth(3).boundingBox())!;
    const ax = a.x + a.width / 2,
      ay = a.y + a.height / 2;
    const bx = b.x + b.width / 2,
      by = b.y + b.height / 2;
    await page.mouse.move(bx, by);
    await page.mouse.down();
    await page.mouse.move(ax + (bx - ax) * 1.25, ay + (by - ay) * 1.25, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => Number(await text.locator('text').getAttribute('font-size')))
      .toBeCloseTo(2.5, 1);
    const anchored = (await handles.nth(0).boundingBox())!;
    expect(anchored.x).toBeCloseTo(a.x, 0);
    expect(anchored.y).toBeCloseTo(a.y, 0);
    await page.keyboard.press('Control+z');
    await expect(text.locator('text')).toHaveAttribute('font-size', '2');
    await page.keyboard.press('Control+y');
    await expect
      .poll(async () => Number(await text.locator('text').getAttribute('font-size')))
      .toBeCloseTo(2.5, 1);
    await page.screenshot({ path: `test-results/texto-ux-${orientation}.png` });
    if (!(await page.locator('.chip-icon-primary').isVisible()))
      await page.getByRole('button', { name: 'Propiedades', exact: true }).click();
    await page.locator('.chip-icon-primary').click();
    await page.waitForURL('**/library');
    await page.locator('.ex-card').first().locator('.ex-open-btn').click();
    await page.waitForURL('**/board');
    await expect
      .poll(async () => Number(await text.locator('text').getAttribute('font-size')))
      .toBeCloseTo(2.5, 1);
    await text.locator('text').click();
    await page.getByRole('button', { name: 'Enderezar texto', exact: true }).click();
    // SVG reparte las palabras en tspans: textContent concatena líneas sin espacios.
    // La fuente persistida del texto, no esa concatenación DOM, debe ser idéntica.
    await expect(page.getByRole('textbox', { name: 'Texto', exact: true })).toHaveValue(
      'Presión tras pérdida',
    );
  });
}
