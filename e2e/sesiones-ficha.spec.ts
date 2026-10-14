import { test, expect, Page } from '@playwright/test';
import { hostBox, normToScreen, fitMode, abrirHerramientas } from './board-helpers';

async function seed(page: Page, withSession = false, long = false) {
  await page.addInitScript(
    ({ withSession, long }) => {
      if (localStorage.getItem('entrenolab:seeded')) return;
      localStorage.setItem('entrenolab:seeded', '1');
      const now = '2026-10-13T19:00:00.000Z';
      localStorage.setItem(
        'entrenolab:teams',
        JSON.stringify([{ id: 't1', name: 'Juvenil B', accentColor: '#c0392b', createdAt: now }]),
      );
      const players = Array.from({ length: 14 }, (_, i) => ({
        id: `p${i}`,
        teamId: 't1',
        name: `Jugador ${i + 1}`,
        number: i + 1,
        position: i < 2 ? 'GK' : 'MF',
        color: '#1a73e8',
        active: true,
        createdAt: now,
      }));
      localStorage.setItem('entrenolab:players', JSON.stringify(players));
      localStorage.setItem(
        'entrenolab:folders',
        JSON.stringify([{ id: 'f1', teamId: 't1', name: 'Circuitos', parentId: null }]),
      );
      const exercise = {
        id: 'e1',
        teamId: 't1',
        folderId: 'f1',
        title: 'Rueda de pases',
        description: 'Perfilarse antes de recibir',
        explanation: 'Jugar y moverse al siguiente cono',
        category: 'Técnica',
        objectives: [],
        materials: ['Balones', 'Conos'],
        durationMinutes: 10,
        minPlayers: null,
        maxPlayers: null,
        loadMode: 'fixed',
        seriesCount: null,
        repetitionsCount: null,
        workSeconds: null,
        restSeconds: null,
        isTemplate: false,
        canvas: {
          version: 2,
          schemaVersion: 4,
          field: 'half',
          frames: [{ duration: 1000, elements: [{ id: 'ball', t: 'ball', x: 0.5, y: 0.5 }] }],
        },
        thumbnail: null,
        savedAt: now,
      };
      localStorage.setItem('entrenolab:exercises', JSON.stringify([exercise]));
      const task = (section: string, i: number) => ({
        id: `task${i}`,
        exerciseId: 'e1',
        title:
          section === 'warmup'
            ? 'Activación con balón'
            : section === 'cooldown'
              ? 'Movilidad final'
              : `Posesión ${i}`,
        material: 'Balones',
        durationMinutes: 10,
        seriesCount: 2,
        minutesPerSeries: 5,
        sortOrder: i,
        section,
        development: long
          ? 'Indicación extensa para comprobar saltos de página y evitar cortes. '.repeat(70)
          : exercise.explanation,
        aspects: exercise.description,
        progression: 'Reducir los toques',
        playerColors: { p0: '#1a73e8', p1: '#8e44ad', p2: '#c0392b' },
        snapshot: exercise,
      });
      const session = {
        id: 's1',
        teamId: 't1',
        title: 'Bloque medio y transiciones',
        number: 13,
        date: '2026-10-13',
        durationMinutes: 120,
        notes: 'Sesión de ejemplo',
        objectives: 'Cerrar el pase interior y salir tras robo',
        material: 'Balones, conos y petos',
        sheet: {
          time: '19:00',
          macrocycle: 'Competición',
          mesocycle: 'Transformación',
          microcycle: 'MD -5',
          preSession: 'Preparar el material',
        },
        attendance: players.map((p) => ({
          playerId: p.id,
          playerName: p.name,
          position: p.position,
          status: 'Asiste',
          group: '',
          attitude: 'Buena',
          minutes: 100,
          notes: '',
        })),
        tasks: [
          task('warmup', 0),
          ...Array.from({ length: 7 }, (_, i) => task('main', i + 1)),
          task('cooldown', 8),
        ],
        createdAt: now,
        savedAt: now,
      };
      localStorage.setItem('entrenolab:sessions', JSON.stringify(withSession ? [session] : []));
    },
    { withSession, long },
  );
}

test('PDF: dibujos en todos los bloques, cinco columnas y más de cinco ejercicios', async ({
  page,
}) => {
  await seed(page, true);
  await page.goto('/sessions');
  const popupPromise = page.waitForEvent('popup');
  await page.getByTitle('Ver PDF').click();
  const sheet = await popupPromise;
  await expect(sheet.locator('main')).toBeVisible();
  await expect(sheet.locator('.diagram')).toHaveCount(9);
  await expect(sheet.locator('thead th').filter({ hasText: 'Ej.' })).toHaveCount(5);
  await expect(sheet.locator('.block')).toHaveCount(3);
  await expect(sheet.locator('.block').first().locator('.diagram')).toHaveCount(1);
  await expect(sheet.locator('.block').last().locator('.diagram')).toHaveCount(1);
  await expect(sheet.getByRole('heading', { name: '7. Posesión 7', exact: true })).toBeVisible();
  await sheet.waitForFunction(() =>
    Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
  );
  await sheet.emulateMedia({ media: 'print' });
  await sheet.pdf({
    path: 'output/pdf/ficha-sesion-ejemplo.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  });
  await sheet.screenshot({ path: 'test-results/ficha-sesion.png', fullPage: true });
  expect(await sheet.locator('.toolbar').isVisible()).toBe(false);
});

test('ficha compacta de cinco ejercicios principales: dos páginas con dibujos en los tres bloques', async ({
  page,
}) => {
  await seed(page, true);
  await page.addInitScript(() => {
    const sessions = JSON.parse(localStorage.getItem('entrenolab:sessions')!);
    sessions[0].tasks = sessions[0].tasks
      .filter(
        (task: { section: string; sortOrder: number }) =>
          task.section !== 'main' || task.sortOrder <= 5,
      )
      .map((task: Record<string, unknown>) => ({
        ...task,
        progression: '',
        material: '',
      }));
    localStorage.setItem('entrenolab:sessions', JSON.stringify(sessions));
  });
  await page.goto('/sessions');
  const popup = page.waitForEvent('popup');
  await page.getByTitle('Ver PDF').click();
  const sheet = await popup;
  await expect(sheet.locator('.diagram')).toHaveCount(7);
  await expect(sheet.locator('.crest img')).toBeVisible();
  await sheet.waitForFunction(() =>
    Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
  );
  const pdf = await sheet.pdf({
    path: 'output/pdf/ficha-sesion-formato-club.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length).toBe(2);
});

test('crear, dibujar y volver no pierde la sesión; petos e indicaciones persisten', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Nueva sesión', exact: true }).click();
  await page.locator('#session-title').fill('Sesión conservada');
  await page.locator('#session-time').fill('19:00');
  await page
    .locator('.section-heading')
    .first()
    .getByRole('button', { name: 'Crear ejercicio' })
    .click();
  await page.getByLabel('Título del nuevo ejercicio', { exact: true }).fill('Calentamiento nuevo');
  await page.getByLabel('Guardar en carpeta', { exact: true }).selectOption({ label: 'Circuitos' });
  await page.getByRole('button', { name: 'Crear y añadir a la sesión' }).click();
  const task = page.locator('.task').first();
  await expect(task.locator('.task-title')).toHaveText('Calentamiento nuevo');
  await task.locator('summary').click();
  await task.getByRole('button', { name: 'Dibujar', exact: true }).click();
  await page.waitForURL('**/board');
  await abrirHerramientas(page);
  await page.locator('.tools-cat', { hasText: 'Material' }).click();
  await page.locator('.rail-btn[title="Cono"]').click();
  const box = await hostBox(page);
  const point = normToScreen(0.5, 0.5, box, await fitMode(page));
  await page.mouse.click(point.x, point.y);
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/sessions');
  await expect(page.locator('#session-title')).toHaveValue('Sesión conservada');
  await expect(page.locator('#session-time')).toHaveValue('19:00');
  await expect(page.locator('.task')).toHaveCount(1);
  await page.locator('.task summary').click();
  await expect(page.locator('.task-image img')).toBeVisible();
  await page.getByRole('button', { name: 'Jugador 1: Morado', exact: true }).click();
  await page.getByLabel('Desarrollo', { exact: true }).fill('Indicaciones para esta sesión');
  await page.locator('.task').getByText('Min/rep', { exact: true }).locator('input').fill('8');
  await page.locator('.task').getByText('Min/rep', { exact: true }).locator('input').blur();
  await page.getByLabel('Repeticiones', { exact: true }).fill('2');
  await page.getByLabel('Descanso (min)', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.reload();
  await page.getByTitle('Editar', { exact: true }).click();
  await page.locator('.task summary').click();
  await expect(
    page.getByRole('button', { name: 'Jugador 1: Morado', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Desarrollo', { exact: true })).toHaveValue(
    'Indicaciones para esta sesión',
  );
  await expect(page.locator('.task-sum')).toHaveText('20 min');
  const ex = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]').find(
      (e: { title: string }) => e.title === 'Calentamiento nuevo',
    ),
  );
  expect(ex.explanation).not.toBe('Indicaciones para esta sesión');
  expect(ex.canvas.frames[0].elements).toHaveLength(1);
});

test('móvil: cinco colores accesibles sin desbordar el editor y título opcional', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, true);
  await page.goto('/sessions');
  await page.getByTitle('Editar', { exact: true }).click();
  await page.locator('.task summary').first().click();
  await expect(page.locator('.bib-row').first().locator('span')).toHaveCount(6);
  const box = await page.locator('.modal').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(
    await page.locator('.modal-body').evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.locator('.bib-choice').first().focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.bib-choice').first()).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#session-title').fill('');
  await page.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(page.locator('.session-title')).toHaveText('Sesión 13');
});

test('PDF de texto largo no elimina ejercicios ni la vuelta a la calma', async ({ page }) => {
  await seed(page, true, true);
  await page.goto('/sessions');
  const popupPromise = page.waitForEvent('popup');
  await page.getByTitle('Ver PDF').click();
  const sheet = await popupPromise;
  await expect(sheet.locator('.exercise')).toHaveCount(9);
  await expect(sheet.locator('.diagram')).toHaveCount(9);
  const pdf = await sheet.pdf({
    path: 'tmp/pdfs/ficha-texto-largo.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.length).toBeGreaterThan(20000);
  await expect(sheet.locator('.block').last()).toContainText('Movilidad final');
});

test('cerrar con cambios pide confirmación y un guardado fallido conserva el borrador', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Nueva sesión', exact: true }).click();
  await page.locator('#session-title').fill('No perder');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.modal-foot').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('#session-title')).toHaveValue('No perder');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'entrenolab:sessions')
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(page.locator('.modal .form-error')).toContainText('borrador sigue abierto');
  await expect(page.locator('#session-title')).toHaveValue('No perder');
  await expect(page.locator('.session-card')).toHaveCount(0);
});

test('los tiempos fraccionarios se rechazan antes de enviarlos al servidor de minutos enteros', async ({
  page,
}) => {
  await seed(page, true);
  await page.goto('/sessions');
  await page.getByTitle('Editar', { exact: true }).click();
  await page.locator('.task summary').first().click();
  await page.locator('.task').first().getByLabel('Descanso (min)', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(page.locator('.modal .form-error')).toContainText(
    'El descanso debe ser un número entero',
  );
  await expect(page.locator('.modal')).toBeVisible();
});

test('los petos del PDF repintan el jugador sin cambiar la biblioteca y mantienen F7 transversal', async ({
  page,
}) => {
  await seed(page, true);
  await page.addInitScript(() => {
    const sessions = JSON.parse(localStorage.getItem('entrenolab:sessions') ?? '[]');
    for (const task of sessions[0].tasks) {
      task.snapshot.canvas.frames[0].elements = [
        { id: 'p', t: 'player', playerId: 'p0', c: '#1a73e8', x: 0.5, y: 0.5 },
      ];
      task.snapshot.canvas.f7 = { enabled: true, color: '#ff00ff', thickness: 0.3, opacity: 1 };
      task.playerColors.p0 = '#8e44ad';
    }
    localStorage.setItem('entrenolab:sessions', JSON.stringify(sessions));
  });
  await page.goto('/sessions');
  const popupPromise = page.waitForEvent('popup');
  await page.getByTitle('Ver PDF').click();
  const sheet = await popupPromise;
  await expect(sheet.locator('.diagram')).toHaveCount(9);
  const counts = await sheet
    .locator('.diagram')
    .first()
    .evaluate(async (el) => {
      const image = el as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let purple = 0,
        magenta = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i] - 142) < 20 &&
          Math.abs(pixels[i + 1] - 68) < 20 &&
          Math.abs(pixels[i + 2] - 173) < 20
        )
          purple++;
        if (pixels[i] > 230 && pixels[i + 1] < 30 && pixels[i + 2] > 230) magenta++;
      }
      return { purple, magenta };
    });
  expect(counts.purple).toBeGreaterThan(10);
  expect(counts.magenta).toBeGreaterThan(40);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('entrenolab:sessions') ?? '[]')[0].tasks[0].snapshot.canvas
          .frames[0].elements[0].c,
    ),
  ).toBe('#1a73e8');
});
