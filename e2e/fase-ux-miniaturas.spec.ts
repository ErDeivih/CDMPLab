import { test, expect, Page } from '@playwright/test';
import { openBoard, hostBox, normToScreen, showCategory, fitMode } from './board-helpers';

/**
 * FASE 1 del encargo — MINIATURAS DE EJERCICIOS.
 *
 * Qué se demuestra aquí (con medidas, no con opiniones):
 *  1. La miniatura guardada es AUTOCONTENIDA y muestra los objetos colocados: se comprueba
 *     `img.complete`, `naturalWidth > 0` y se cuentan colores distintos del PNG real (si el
 *     campo estuviera vacío el número de colores se desploma).
 *  2. Sobrevive a GUARDAR, RECARGAR y REABRIR el ejercicio.
 *  3. Si los assets tácticos NO se pueden leer (404), la miniatura sigue mostrando los objetos
 *     vectoriales y NUNCA deja la imagen rota ni una tarjeta vacía.
 *  4. Una miniatura HISTÓRICA que no carga (dato roto) cae al diagrama SVG en vivo: fallback
 *     limpio del campo, nunca el icono de imagen rota del navegador.
 *
 * Nota sobre el sembrado: este spec usa su PROPIO `seed` con guarda (`if (seeded) return`) para
 * que al recargar NO se borren los datos: el `seedBoard` compartido limpia `entrenolab:*` en cada
 * navegación, y con él la comprobación de "guardar y recargar" no probaría nada.
 */

const ESCRITORIO = { width: 1366, height: 900 };

async function seed(page: Page, ejercicios: unknown[] = []): Promise<void> {
  await page.addInitScript((exs: unknown[]) => {
    if (localStorage.getItem('entrenolab:seeded')) return;
    const now = new Date().toISOString();
    localStorage.setItem('entrenolab:seeded', '1');
    localStorage.setItem('entrenolab:board-hints', '1');
    localStorage.setItem('entrenolab:fill-hint', '1');
    localStorage.setItem('entrenolab:orient-hint', '1');
    localStorage.setItem(
      'entrenolab:teams',
      JSON.stringify([{ id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now }]),
    );
    localStorage.setItem(
      'entrenolab:players',
      JSON.stringify([
        {
          id: 'p1',
          teamId: 't1',
          name: 'Marcos',
          number: 2,
          position: 'DF',
          color: '#1a73e8',
          active: true,
          createdAt: now,
        },
      ]),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:exercises', JSON.stringify(exs));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
  }, ejercicios);
}

/** Analiza la miniatura de la primera tarjeta: carga real + colores distintos del PNG. */
async function analizarMiniatura(page: Page) {
  return page.evaluate(async () => {
    const img = document.querySelector('.thumb-img') as HTMLImageElement | null;
    const diagrama = !!document.querySelector('.ex-thumb .diagram svg');
    const placeholder = !!document.querySelector('.ex-thumb .diagram.placeholder');
    if (!img) return { hayImg: false, diagrama, placeholder, colores: 0 };
    try {
      await img.decode();
    } catch {
      /* se informa por complete/naturalWidth */
    }
    let colores = 0;
    if (img.naturalWidth > 0) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const set = new Set<string>();
      for (let i = 0; i < d.length; i += 4)
        set.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      colores = set.size;
    }
    return {
      hayImg: true,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      colores,
      diagrama,
      placeholder,
    };
  });
}

/** Coloca material, un jugador y un trazo; devuelve cuántos objetos quedaron. */
async function componerPizarra(page: Page, materiales: string[]): Promise<number> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  await showCategory(page, 'Material');
  const posiciones: Array<[number, number]> = [
    [0.3, 0.35],
    [0.7, 0.35],
    [0.5, 0.6],
  ];
  for (let i = 0; i < materiales.length; i++) {
    const btn = page.locator(`.rail-btn[title="${materiales[i]}"]`).first();
    if ((await btn.count()) === 0) continue;
    await btn.click();
    const p = normToScreen(
      posiciones[i % posiciones.length][0],
      posiciones[i % posiciones.length][1],
      host,
      fit,
    );
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
  await showCategory(page, 'Jugadores');
  const jugador = page.locator('.tray-player[title="Jugador Azul"]').first();
  if ((await jugador.count()) > 0) {
    await jugador.click();
    const p = normToScreen(0.45, 0.7, host, fit);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
  const cerrar = page.locator('.side-panel-left .panel-close');
  if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
  await showCategory(page, 'Dibujo');
  const linea = page.locator('.rail-btn[title="Línea"]').first();
  if ((await linea.count()) > 0) {
    await linea.click();
    const a = normToScreen(0.25, 0.8, host, fit);
    const b = normToScreen(0.75, 0.85, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  }
  const cerrar2 = page.locator('.side-panel-left .panel-close');
  if (await cerrar2.isVisible().catch(() => false)) await cerrar2.first().click();
  return Number(await page.locator('.field-count').textContent());
}

async function guardar(page: Page, titulo: string): Promise<void> {
  await page.locator('button[aria-label="Propiedades"]').first().click();
  await page.locator('input[aria-label="Título del ejercicio"]').fill(titulo);
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
  await expect(page.locator('.ex-card').first()).toBeVisible();
}

test.describe('FASE 1 — miniaturas de ejercicios', () => {
  test.use({ hasTouch: true });

  test('la miniatura guardada es autocontenida, muestra los objetos y sobrevive a recargar y reabrir', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seed(page);
    await openBoard(page);
    const objetos = await componerPizarra(page, ['Cono', 'Miniportería']);
    expect(objetos, 'se han colocado objetos de verdad').toBeGreaterThanOrEqual(3);

    await guardar(page, 'Miniatura con objetos');
    const antes = await analizarMiniatura(page);
    expect(antes.hayImg, 'la tarjeta usa la miniatura PNG guardada').toBe(true);
    expect(antes.complete, 'la imagen está completa').toBe(true);
    expect(antes.naturalWidth, 'naturalWidth > 0').toBeGreaterThan(0);
    // Un campo vacío da muy pocos colores: con objetos (césped + líneas + fichas + material)
    // el PNG tiene decenas de tonos distintos.
    expect(antes.colores, 'la miniatura muestra los objetos colocados').toBeGreaterThan(20);

    // El PNG guardado está DENTRO del ejercicio (data URL), no es una ruta que se pueda romper.
    const guardado = await page.evaluate(() => {
      const arr = JSON.parse(localStorage.getItem('entrenolab:exercises') ?? '[]') as Array<{
        title: string;
        thumbnail: string | null;
      }>;
      const ex = arr.find((e) => e.title === 'Miniatura con objetos');
      return {
        esDataUrl: !!ex?.thumbnail?.startsWith('data:image/png;base64,'),
        largo: ex?.thumbnail?.length ?? 0,
      };
    });
    expect(guardado.esDataUrl, 'la miniatura es un data URL PNG autocontenido').toBe(true);
    expect(guardado.largo).toBeGreaterThan(1000);

    // RECARGAR: los datos siguen (el seed tiene guarda) y la miniatura se vuelve a pintar igual.
    await page.reload();
    await expect(page.locator('.ex-card').first()).toBeVisible();
    const trasRecarga = await analizarMiniatura(page);
    expect(trasRecarga.naturalWidth, 'tras recargar la miniatura carga igual').toBeGreaterThan(0);
    expect(trasRecarga.colores).toBeGreaterThan(20);

    // REABRIR: el ejercicio conserva sus objetos.
    await page.locator('.ex-card .ex-open-btn').first().click();
    await page.waitForURL('**/board');
    await expect(page.locator('.board-canvas svg')).toBeVisible();
    await expect(page.locator('.field-count')).toHaveText(String(objetos));
  });

  test('CORRECCIÓN 2: con los assets caídos el cono NO desaparece (fallback opaco, píxeles en su zona)', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    // Los PNG tácticos devuelven 404: ningún `<image>` puede cargar en NINGUNA ruta de render.
    await page.route('**/assets/tactical/**', (r) => r.fulfill({ status: 404, body: '' }));
    await seed(page);
    await openBoard(page);

    // MATERIAL AISLADO: solo un cono, sin jugadores ni líneas que puedan falsear el conteo.
    const host = await hostBox(page);
    const fit = await fitMode(page);
    await showCategory(page, 'Material');
    await page.locator('.rail-btn[title="Cono"]').first().click();
    const cerrarPanel = page.locator('.side-panel-left .panel-close');
    if (await cerrarPanel.isVisible().catch(() => false)) await cerrarPanel.first().click();
    const punto = normToScreen(0.3, 0.3, host, fit);
    await page.mouse.click(punto.x, punto.y);
    await expect(page.locator('.field-count'), 'hay UN solo objeto: el cono').toHaveText('1');
    await guardar(page, 'Miniatura cono sin assets');

    // Análisis de PÍXELES de la miniatura real (480×384, fondo opaco).
    const pixeles = await page.evaluate(async () => {
      const img = document.querySelector('.thumb-img') as HTMLImageElement | null;
      if (!img) return { hayImg: false } as const;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let transparentes = 0;
      let rojos = 0;
      let sumaX = 0;
      let sumaY = 0;
      let rojosAbajoDerecha = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];
        if (a < 250) transparentes++;
        // Rojo del cono (#e74c3c ≈ 231,76,60). El césped es verde y las líneas blancas: nada más
        // de la miniatura entra en este filtro.
        if (r > 150 && g < 120 && b < 120) {
          rojos++;
          const p = i / 4;
          const x = p % c.width;
          const y = Math.floor(p / c.width);
          sumaX += x;
          sumaY += y;
          if (x > c.width / 2 && y > c.height / 2) rojosAbajoDerecha++;
        }
      }
      return {
        hayImg: true,
        ancho: c.width,
        alto: c.height,
        transparentes,
        rojos,
        centroX: rojos ? sumaX / rojos : -1,
        centroY: rojos ? sumaY / rojos : -1,
        rojosAbajoDerecha,
      } as const;
    });

    expect(pixeles.hayImg, 'la tarjeta usa la miniatura generada').toBe(true);
    if (!pixeles.hayImg) return;
    expect(pixeles.ancho).toBe(480);
    expect(pixeles.alto).toBe(384);
    // 1) NADA transparente: el material no puede haberse sustituido por transparencia.
    expect(
      pixeles.transparentes,
      'la miniatura no puede tener zonas transparentes (el cono no se sustituye por transparencia)',
    ).toBe(0);
    // 2) El cono ESTÁ en la miniatura: hay suficientes píxeles de su color…
    expect(
      pixeles.rojos,
      'el cono se dibuja con el fallback vectorial opaco (no solo césped)',
    ).toBeGreaterThanOrEqual(40);
    // …y está DONDE se colocó (cuarto superior izquierdo del campo), no repartido por la imagen.
    expect(pixeles.centroX, 'el cono está en la mitad izquierda').toBeLessThan(pixeles.ancho / 2);
    expect(pixeles.centroY, 'el cono está en la mitad superior').toBeLessThan(pixeles.alto / 2);
    // 3) La comprobación está LOCALIZADA: en el cuarto opuesto no hay píxeles de ese color.
    expect(
      pixeles.rojosAbajoDerecha,
      'no hay rojo del cono en la esquina opuesta (la comprobación es de la zona, no global)',
    ).toBe(0);
  });

  test('una miniatura histórica que no carga cae al diagrama limpio, nunca al icono roto', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    const now = new Date().toISOString();
    await seed(page, [
      {
        id: 'e-roto',
        teamId: 't1',
        folderId: null,
        title: 'Miniatura histórica rota',
        description: '',
        explanation: '',
        category: 'Técnica',
        objectives: [],
        materials: [],
        durationMinutes: 10,
        minPlayers: null,
        maxPlayers: null,
        loadMode: 'fixed',
        seriesCount: null,
        repetitionsCount: null,
        workSeconds: null,
        restSeconds: null,
        isTemplate: false,
        // Data URL TRUNCADA: el navegador no puede cargarla (caso real de dato histórico).
        thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
        canvas: {
          version: 2,
          field: 'full',
          frames: [
            {
              duration: 1000,
              elements: [{ id: 'x1', t: 'cone', x: 0.4, y: 0.4, c: '#e74c3c' }],
            },
          ],
        },
        savedAt: now,
      },
    ]);
    await page.goto('/library');
    await expect(page.locator('.ex-card').first()).toBeVisible();

    // El <img> falla y la tarjeta pasa al diagrama SVG en vivo (fallback limpio del campo).
    await expect(page.locator('.ex-thumb .thumb-img')).toHaveCount(0);
    await expect(page.locator('.ex-thumb .diagram svg')).toHaveCount(1);
    const medida = await analizarMiniatura(page);
    expect(medida.hayImg, 'no queda una imagen rota en la tarjeta').toBe(false);
    expect(medida.diagrama, 'se ve el campo dibujado').toBe(true);
  });
});
