import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

// Contrato del puente en páginas SIMULADAS: no inicia sesión ni escribe en Coach real.
const coachUrl = 'https://coach.cdmpizarrales.es/prueba-local';
const labUrl = 'https://erdeivih.github.io/CDMPLab/';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';

async function openFixture(page: Page): Promise<void> {
  await page.context().route('https://coach.cdmpizarrales.es/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<form id="form-entrenamiento-2106">
        <section id="task-1165"><h3>Rondo con presión</h3>
          <textarea name="desarrollo[1165]">Circular y apoyar</textarea>
          <textarea name="aspectos[1165]">Orientar el cuerpo</textarea>
          <textarea name="progresion[1165]">Limitar toques</textarea>
          <select name="tipo-imagen[1165]" aria-label="Imagen de Rondo con presión">
            <option value="none">Sin imagen</option><option value="drawing">Dibujo</option>
          </select>
          <input type="file" id="src-imagen-ejer-1165"
          name="src-imagen-ejer[1165]" accept=".jpg,.jpeg,.png,.webp"></section>
        <section id="task-1166"><select name="tipo-imagen[1166]" aria-label="Imagen de otra tarea">
          <option value="none">Sin imagen</option><option value="drawing">Dibujo</option>
          </select><input type="file" id="src-imagen-ejer-1166"
          name="src-imagen-ejer[1166]" accept=".jpg,.jpeg,.png,.webp"></section>
        <button type="button" id="apply" onclick="document.getElementById('preview').hidden=false">Aplicar</button>
        <img id="preview" alt="Miniatura" hidden>
      </form>`,
    }),
  );
  // Las rutas registradas en el contexto también interceptan la nueva pestaña.
  await page.context().route('https://erdeivih.github.io/CDMPLab/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<button id="send" onclick="window.opener.postMessage({
          kind:'CDMPLAB_COACH_PNG',
          nonce:new URLSearchParams(location.search).get('coachTransfer'),
          dataUrl:'${png}',fileName:'cdmplab-prueba.png'
        },'https://coach.cdmpizarrales.es')">Enviar PNG</button>
        <script>window.addEventListener('message',event=>{
          if(event.data?.kind==='CDMPLAB_COACH_DRAFT')
            document.body.dataset.draft=JSON.stringify(event.data.draft);
        });</script>`,
    }),
  );
  await page.goto(coachUrl);
  await page.addScriptTag({ path: resolve('integrations/coach-brave/coach.js') });
}

test('adjunta el PNG solo a la tarea elegida y deja Aplicar bajo control del usuario', async ({
  page,
}) => {
  await openFixture(page);
  const opened = page.waitForEvent('popup');
  await page.locator('#task-1165 .cdmplab-coach-button').click();
  const popup = await opened;
  await expect(page.locator('#task-1165 select')).toHaveValue('drawing');
  await expect(page.locator('#task-1166 select')).toHaveValue('none');
  await expect(popup).toHaveURL(new RegExp('^' + labUrl.replaceAll('.', '\\.')));
  await popup.locator('#send').click();
  await expect(page.locator('#task-1165 .cdmplab-coach-status')).toContainText('Pulsa «Aplicar»');
  expect(
    await page
      .locator('#src-imagen-ejer-1165')
      .evaluate((element: HTMLInputElement) => element.files?.item(0)?.name),
  ).toBe('cdmplab-prueba.png');
  expect(
    await page
      .locator('#src-imagen-ejer-1166')
      .evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(0);
  await expect(page.locator('#preview')).toBeHidden();
  await page.locator('#apply').click();
  await expect(page.locator('#preview')).toBeVisible();
});

test('si la tarea desaparece, no adjunta el PNG a otra', async ({ page }) => {
  await openFixture(page);
  const opened = page.waitForEvent('popup');
  await page.locator('#task-1165 .cdmplab-coach-button').click();
  const popup = await opened;
  await page.locator('#task-1165').evaluate((element) => element.remove());
  await popup.locator('#send').click();
  expect(
    await page
      .locator('#src-imagen-ejer-1166')
      .evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(0);
});

test('si Coach reconstruye el selector al elegir Dibujo, mantiene la tarea de destino', async ({
  page,
}) => {
  await openFixture(page);
  await page.locator('#task-1165 select').evaluate((select) => {
    select.addEventListener('change', () => {
      const input = document.querySelector<HTMLInputElement>('#src-imagen-ejer-1165')!;
      input.nextElementSibling?.remove();
      input.replaceWith(input.cloneNode() as HTMLInputElement);
    });
  });
  const opened = page.waitForEvent('popup');
  await page.locator('#task-1165 .cdmplab-coach-button').click();
  const popup = await opened;
  await expect(page.locator('#task-1165 select')).toHaveValue('drawing');
  await popup.locator('#send').click();
  await expect
    .poll(() =>
      page
        .locator('#src-imagen-ejer-1165')
        .evaluate((input: HTMLInputElement) => input.files?.item(0)?.name),
    )
    .toBe('cdmplab-prueba.png');
  await expect(page.locator('#task-1165 .cdmplab-coach-status')).toContainText('Pulsa «Aplicar»');
  expect(
    await page
      .locator('#src-imagen-ejer-1166')
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
});

test('precarga solo los datos reconocidos de la tarea elegida', async ({ page }) => {
  await openFixture(page);
  const opened = page.waitForEvent('popup');
  await page.locator('#task-1165 .cdmplab-coach-button').click();
  const popup = await opened;
  await popup.evaluate(() =>
    window.opener?.postMessage(
      {
        kind: 'CDMPLAB_COACH_READY',
        nonce: new URLSearchParams(location.search).get('coachTransfer'),
      },
      'https://coach.cdmpizarrales.es',
    ),
  );
  await expect
    .poll(() => popup.locator('body').getAttribute('data-draft'))
    .toContain('Rondo con presión');
  const draft = JSON.parse((await popup.locator('body').getAttribute('data-draft'))!);
  expect(draft).toMatchObject({
    title: 'Rondo con presión',
    development: 'Circular y apoyar',
    aspects: 'Orientar el cuerpo',
    progression: 'Limitar toques',
    durationMinutes: null,
  });
});

test('Coach abre la creación con datos, CDMPLab guarda y entrega su PNG', async ({ page }) => {
  const nonce = '12345678-1234-4123-8123-123456789abc';
  await page.context().addInitScript(() => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([
        {
          id: 't1',
          name: 'Equipo de prueba',
          accentColor: '#3056d3',
          createdAt: new Date().toISOString(),
        },
      ]),
    );
    for (const key of ['players', 'exercises', 'folders', 'sessions']) {
      localStorage.setItem('entrenolab:' + key, '[]');
    }
  });
  await page.context().route(coachUrl, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      // Emula el enlace de la extensión inicial (raíz); debe abrir la biblioteca igualmente.
      // Este spec usa playwright.dev.config.ts (puerto 4301); 4200 era un fixture obsoleto.
      body: `<button id="open" onclick="window.open('http://127.0.0.1:4301/?coachTransfer=${nonce}', '_blank')">Abrir</button>
        <script>
          window.addEventListener('message', (event) => {
            if (event.origin === 'http://127.0.0.1:4301' &&
                event.data?.kind === 'CDMPLAB_COACH_READY' && event.data.nonce === '${nonce}') {
              event.source.postMessage({kind:'CDMPLAB_COACH_DRAFT',nonce:'${nonce}',draft:{
                title:'Rueda de pases',development:'Pase y apoyo',aspects:'Perfilar el cuerpo',
                progression:'Dos toques',players:14,durationMinutes:null
              }},event.origin);
              return;
            }
            if (event.origin !== 'http://127.0.0.1:4301' ||
                event.data?.kind !== 'CDMPLAB_COACH_PNG' || event.data.nonce !== '${nonce}') return;
            document.body.dataset.png = event.data.dataUrl;
            event.source.postMessage({kind:'CDMPLAB_COACH_ACK',nonce:'${nonce}',success:true},event.origin);
          });
        </script>`,
    }),
  );
  await page.goto(coachUrl);
  const opened = page.waitForEvent('popup');
  await page.locator('#open').click();
  const lab = await opened;
  await expect(lab).toHaveURL(/\/library$/);
  await expect(lab.getByRole('heading', { name: 'Nuevo ejercicio' })).toBeVisible();
  await expect(lab.locator('input[name="title"]')).toHaveValue('Rueda de pases');
  await expect(lab.locator('textarea[name="description"]')).toHaveValue('Perfilar el cuerpo');
  await lab.getByRole('button', { name: 'Crear y dibujar' }).click();
  await expect(lab.locator('.board-host')).toBeVisible();
  await expect(lab.locator('.top-title .exercise')).toHaveText('Rueda de pases');
  await expect(lab.locator('.studio-top .coach-export')).toBeVisible();
  await lab.locator('.studio-top .coach-export').click();
  await lab.locator('.top-pop-export button[aria-label="Enviar imagen a Coach"]').click();
  await expect(lab.locator('.board-notice')).toBeVisible({ timeout: 2000 });
  await expect(lab.locator('[data-guardado]')).toHaveAttribute('data-guardado', 'guardado');
  await expect
    .poll(() => page.locator('body').getAttribute('data-png'), { timeout: 20_000 })
    .toMatch(/^data:image\/png;base64,/);
  await expect(lab.locator('.studio')).toBeVisible();
  await expect(lab.locator('[aria-label="Exportar"]')).toBeVisible();
});
