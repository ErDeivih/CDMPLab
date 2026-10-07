import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { fillBoardTitle } from './gesture-helpers';

// Contrato del puente en páginas SIMULADAS: no inicia sesión ni escribe en Coach real.
const coachUrl = 'https://coach.cdmpizarrales.es/prueba-local';
const labUrl = 'https://erdeivih.github.io/CDMPLab/';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';

async function openFixture(page: Page): Promise<void> {
  await page.context().route('https://coach.cdmpizarrales.es/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<form id="form-entrenamiento-2106">
        <section id="task-1165"><input type="file" id="src-imagen-ejer-1165"
          name="src-imagen-ejer[1165]" accept=".jpg,.jpeg,.png,.webp"></section>
        <section id="task-1166"><input type="file" id="src-imagen-ejer-1166"
          name="src-imagen-ejer[1166]" accept=".jpg,.jpeg,.png,.webp"></section>
        <button type="button" id="apply" onclick="document.getElementById('preview').hidden=false">Aplicar</button>
        <img id="preview" alt="Miniatura" hidden>
      </form>`,
    }),
  );
  // Las rutas registradas en el contexto también interceptan la nueva pestaña.
  await page.context().route('https://erdeivih.github.io/CDMPLab/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<button id="send" onclick="window.opener.postMessage({
          kind:'CDMPLAB_COACH_PNG',
          nonce:new URLSearchParams(location.search).get('coachTransfer'),
          dataUrl:'${png}',fileName:'cdmplab-prueba.png'
        },'https://coach.cdmpizarrales.es')">Enviar PNG</button>`,
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

test('CDMPLab guarda y entrega su PNG real a la pestaña que lo abrió', async ({ page }) => {
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
      contentType: 'text/html',
      body: `<button id="open" onclick="window.open('http://127.0.0.1:4200/board?coachTransfer=${nonce}', '_blank')">Abrir</button>
        <script>
          window.addEventListener('message', (event) => {
            if (event.origin !== 'http://127.0.0.1:4200' ||
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
  await expect(lab.locator('.board-host')).toBeVisible();
  await fillBoardTitle(lab, 'Transferencia de prueba');
  await lab.locator('button[aria-label="Exportar"]').click();
  await lab.getByRole('button', { name: 'Guardar y enviar a Coach' }).click();
  await expect
    .poll(() => page.locator('body').getAttribute('data-png'))
    .toMatch(/^data:image\/png;base64,/);
  await expect(lab.locator('.studio')).toBeVisible();
  await expect(lab.locator('[aria-label="Exportar"]')).toBeVisible();
});
