// =============================================================
// LOTE C2 — Sesiones: orden por FECHA (no por guardado), fecha legible, validación del
// editor y aviso de "Actualizado en biblioteca" cuando el ejercicio cambió después.
// =============================================================
import { test, expect, Page } from '@playwright/test';

const TEAM = {
  id: 't1',
  name: 'Primer Equipo',
  accentColor: '#3056d3',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function exercise(id: string, title: string, savedAt: string): Record<string, unknown> {
  return {
    id,
    teamId: 't1',
    folderId: null,
    title,
    description: '',
    explanation: '',
    category: 'Técnica',
    objectives: [],
    materials: [],
    durationMinutes: 15,
    minPlayers: null,
    maxPlayers: null,
    loadMode: 'fixed',
    seriesCount: null,
    repetitionsCount: null,
    workSeconds: null,
    restSeconds: null,
    isTemplate: false,
    canvas: null,
    thumbnail: null,
    savedAt,
  };
}

function session(
  id: string,
  title: string,
  date: string,
  savedAt: string,
  tasks: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    id,
    teamId: 't1',
    title,
    date,
    durationMinutes: null,
    notes: '',
    tasks,
    createdAt: '2026-01-01T00:00:00.000Z',
    savedAt,
  };
}

// La sesión MÁS ANTIGUA es la que se guardó MÁS TARDE: si el orden fuera por `savedAt`
// (como antes), aparecería la primera. El test lo distingue.
const EXERCISES = [
  exercise('ex1', 'Rondo', '2026-01-10T10:00:00.000Z'),
  exercise('ex2', 'Circulación', '2026-01-11T10:00:00.000Z'),
];

const SESSIONS = [
  session('s1', 'Sesión antigua editada hoy', '2026-01-05', '2026-01-20T10:00:00.000Z'),
  session('s2', 'Sesión de febrero', '2026-02-10', '2026-02-01T10:00:00.000Z'),
  session('s3', 'Sesión de marzo', '2026-03-02', '2026-01-15T10:00:00.000Z'),
  // Tarea con snapshot DESACTUALIZADO respecto al ejercicio vivo.
  session('s4', 'Con tarea desactualizada', '2026-04-01', '2026-04-01T10:00:00.000Z', [
    {
      id: 'tk1',
      exerciseId: 'ex1',
      title: 'Rondo',
      durationMinutes: 15,
      material: '',
      sortOrder: 0,
      snapshot: exercise('ex1', 'Rondo', '2026-01-05T10:00:00.000Z'),
    },
  ]),
];

async function seedSessions(page: Page): Promise<void> {
  await page.addInitScript(
    (data: { team: unknown; exercises: unknown[]; sessions: unknown[] }) => {
      if (localStorage.getItem('entrenolab:seeded')) return;
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:teams', JSON.stringify([data.team]));
      localStorage.setItem('entrenolab:players', JSON.stringify([]));
      localStorage.setItem('entrenolab:exercises', JSON.stringify(data.exercises));
      localStorage.setItem('entrenolab:folders', JSON.stringify([]));
      localStorage.setItem('entrenolab:sessions', JSON.stringify(data.sessions));
    },
    { team: TEAM, exercises: EXERCISES, sessions: SESSIONS },
  );
}

const cards = (page: Page) => page.locator('.session-card');

test.describe('Lote C2 — Sesiones', () => {
  test('la lista va por FECHA de la sesión (no por fecha de guardado) y la muestra legible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSessions(page);
    await page.goto('/sessions');
    await expect(cards(page)).toHaveCount(4);

    // La primera es la de fecha MÁS RECIENTE (2026-04-01), aunque su savedAt sea el 3º.
    await expect(cards(page).first().locator('.session-title')).toHaveText(
      'Con tarea desactualizada',
    );
    const titles = await cards(page).locator('.session-title').allInnerTexts();
    expect(titles).toEqual([
      'Con tarea desactualizada', // 2026-04-01
      'Sesión de marzo', // 2026-03-02
      'Sesión de febrero', // 2026-02-10
      'Sesión antigua editada hoy', // 2026-01-05
    ]);
    // La fecha se muestra en formato español, no como ISO.
    await expect(cards(page).first().locator('.session-meta')).toContainText('01/04/2026');
    await expect(cards(page).first().locator('.session-meta')).not.toContainText('2026-04-01');
  });

  test('avisa cuando el ejercicio de la biblioteca se editó después de añadirlo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSessions(page);
    await page.goto('/sessions');

    // La sesión 's1' (sin tareas) no avisa de nada.
    await cards(page).filter({ hasText: 'Sesión de febrero' }).getByTitle('Editar').click();
    await expect(page.locator('.task-badge-info')).toHaveCount(0);
    await page.locator('.modal-foot button', { hasText: 'Cancelar' }).click();

    // La sesión con snapshot viejo SÍ avisa.
    await cards(page).filter({ hasText: 'Con tarea desactualizada' }).getByTitle('Editar').click();
    await expect(page.locator('.task-title')).toHaveText('Rondo');
    await expect(page.locator('.task-badge-info')).toBeVisible();
    await expect(page.locator('.task-badge-info')).toHaveText('Actualizado en biblioteca');
  });

  test('el picker deja añadir VARIOS ejercicios seguidos (antes se cerraba en cada uno)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSessions(page);
    await page.goto('/sessions');

    await page.locator('button', { hasText: 'Nueva sesión' }).click();
    await page.locator('.modal input[name="title"]').fill('Sesión larga');
    await page.locator('.tasks-head').getByText('Añadir ejercicio').click();

    // Es un panel EN LÍNEA dentro del editor, no un modal encima.
    const picker = page.locator('.picker-inline');
    await expect(picker).toBeVisible();

    await picker.locator('.picker-item', { hasText: 'Rondo' }).click();
    await expect(page.locator('.task')).toHaveCount(1);
    // Sigue abierto: se puede seguir añadiendo sin reabrirlo.
    await expect(picker, 'el picker NO se cierra al añadir').toBeVisible();

    await picker.locator('.picker-item', { hasText: 'Circulación' }).click();
    await expect(page.locator('.task')).toHaveCount(2);
    await expect(picker).toBeVisible();

    // Repetir un ejercicio es legítimo y el picker lo dice.
    await picker.locator('.picker-item', { hasText: 'Rondo' }).click();
    await expect(page.locator('.task')).toHaveCount(3);
    await expect(picker.locator('.picker-item', { hasText: 'Rondo' })).toContainText(
      'en la sesión ×2',
    );

    // «Listo» lo cierra y el guardado sigue accesible (antes lo tapaba el modal).
    await picker.locator('button', { hasText: 'Listo' }).click();
    await expect(page.locator('.picker-inline')).toHaveCount(0);
    await page.locator('.modal-foot button', { hasText: 'Guardar sesión' }).click();
    await expect(cards(page)).toHaveCount(5);
    await expect(cards(page).first().locator('.session-title')).toHaveText('Sesión larga');
  });

  test('valida fecha y duraciones antes de guardar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSessions(page);
    await page.goto('/sessions');

    // Fecha vacía → error y NO se guarda.
    await page.locator('button', { hasText: 'Nueva sesión' }).click();
    await page.locator('.modal input[name="title"]').fill('Sin fecha');
    await page.locator('.modal input[name="date"]').fill('');
    await page.locator('.modal-foot button', { hasText: 'Guardar sesión' }).click();
    await expect(page.locator('.modal .form-error')).toContainText('La fecha no es válida');
    await expect(cards(page)).toHaveCount(4);

    // Duración imposible → error.
    await page.locator('.modal input[name="date"]').fill('2026-05-05');
    await page.locator('.modal input[name="dur"]').fill('900');
    await page.locator('.modal-foot button', { hasText: 'Guardar sesión' }).click();
    await expect(page.locator('.modal .form-error')).toContainText('entre 0 y 600');
    await expect(cards(page)).toHaveCount(4);

    // Duración correcta → se guarda y aparece la primera (fecha más reciente).
    await page.locator('.modal input[name="dur"]').fill('75');
    await page.locator('.modal-foot button', { hasText: 'Guardar sesión' }).click();
    await expect(cards(page)).toHaveCount(5);
    await expect(cards(page).first().locator('.session-title')).toHaveText('Sin fecha');
    await expect(cards(page).first().locator('.session-meta')).toContainText('75 min');
  });
});
