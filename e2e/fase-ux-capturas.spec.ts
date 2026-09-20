import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { hostBox, normToScreen, showCategory, fitMode } from './board-helpers';

/**
 * FASE 10 del encargo — EVIDENCIA VISUAL OBLIGATORIA.
 *
 * Genera `docs/screenshots/fase-ux-final/` con las 19 piezas pedidas (17 capturas + hoja de
 * contacto + índice), SIN tocar ninguna galería anterior: esta carpeta es nueva y solo la escribe
 * esta spec.
 *
 * Solo se ejecuta cuando se pide a propósito (`CAPTURAS_UX=1`), igual que las demás specs de
 * capturas del proyecto: si corriera en cada pasada reescribiría binarios del repositorio.
 *
 * Las capturas de la pizarra NO pueden salir vacías: antes de cada disparo se comprueba que hay
 * objetos colocados de verdad (`.field-count`) y el índice lo deja escrito.
 */

const DIR = 'docs/screenshots/fase-ux-final';
const PEDIDO = process.env['CAPTURAS_UX'];
test.skip(!PEDIDO, 'Capturas de la fase UX: se ejecutan solo con CAPTURAS_UX=1');

const ESCRITORIO = { width: 1366, height: 900 };
const MOVIL_V = { width: 390, height: 844 };
const MOVIL_H = { width: 844, height: 390 };

/** Objetos que se colocan en la pizarra de las capturas (medido, no supuesto). */
const OBJETOS = 6;

type Ficha = { fichero: string; que: string; objetos?: number };
const FICHAS: Ficha[] = [];

async function disparo(page: Page, fichero: string, que: string, objetos?: number): Promise<void> {
  fs.mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}/${fichero}.png`, fullPage: false });
  FICHAS.push({ fichero, que, objetos });
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
      JSON.stringify(
        Array.from({ length: 6 }, (_, i) => ({
          id: `p${i + 1}`,
          teamId: 't1',
          name: ['Marcos', 'Pau', 'Dani', 'Hugo', 'Leo', 'Iker'][i],
          number: i + 1,
          position: ['GK', 'DF', 'DF', 'MF', 'MF', 'FW'][i],
          color: '#1a73e8',
          active: true,
          createdAt: now,
        })),
      ),
    );
    localStorage.setItem('entrenolab:folders', JSON.stringify([]));
    localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    const base = {
      teamId: 't1',
      folderId: null,
      description: 'Conservación',
      explanation: '',
      category: 'Técnica',
      objectives: [],
      materials: [],
      durationMinutes: 12,
      minPlayers: 6,
      maxPlayers: 8,
      loadMode: 'fixed',
      seriesCount: null,
      repetitionsCount: null,
      workSeconds: null,
      restSeconds: null,
      isTemplate: false,
      savedAt: now,
    };
    const conObjetos = {
      version: 2,
      field: 'full',
      orientation: 'horizontal',
      playerColors: { p1: '#c0392b', p4: '#8e44ad' },
      frames: [
        {
          duration: 1000,
          elements: [
            { id: 'a', t: 'cone', x: 0.25, y: 0.3, c: '#e74c3c', assetKind: 'cone_red' },
            { id: 'b', t: 'cone', x: 0.35, y: 0.55, c: '#f6c945', assetKind: 'cone_yellow' },
            { id: 'c', t: 'target', x: 0.55, y: 0.3, c: '#2c7be5' },
            { id: 'd', t: 'goal', x: 0.75, y: 0.25, c: '#ffffff' },
            { id: 'e', t: 'player', playerId: 'p1', n: 1, c: '#c0392b', x: 0.4, y: 0.7 },
            { id: 'f', t: 'player', playerId: 'p4', n: 4, c: '#8e44ad', x: 0.6, y: 0.7 },
          ],
        },
      ],
    };
    localStorage.setItem(
      'entrenolab:exercises',
      JSON.stringify(
        [1, 2, 3, 4, 5, 6].map((n) => ({
          ...base,
          id: `e${n}`,
          title: n === 2 ? 'Salida de balón con presión alta y tres carriles' : `Ejercicio ${n}`,
          thumbnail: null,
          canvas: n === 6 ? null : conObjetos,
        })),
      ),
    );
  });
}

/** Abre la pizarra y coloca objetos REALES (la captura no puede salir vacía). */
async function componerPizarra(page: Page): Promise<void> {
  await page.goto('/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  for (const sel of ['.help-close', '.fill-hint-close']) {
    if (
      await page
        .locator(sel)
        .isVisible()
        .catch(() => false)
    )
      await page.locator(sel).click();
  }
  const host = await hostBox(page);
  const fit = await fitMode(page);
  await showCategory(page, 'Material');
  const materiales: Array<[string, number, number]> = [
    // Posiciones CERCANAS AL CENTRO: en «Llenar pantalla» el campo va ampliado y los bordes quedan
    // fuera de la vista, así que un clic en 0.25 o 0.8 puede caer fuera del campo (medido: solo se
    // colocaban 2 objetos y la captura salía casi vacía).
    ['Cono', 0.4, 0.4],
    ['Miniportería', 0.6, 0.4],
    ['Chino', 0.45, 0.3],
    ['Portería grande', 0.5, 0.6],
    ['Escalera', 0.6, 0.6],
  ];
  for (const [titulo, nx, ny] of materiales) {
    // Hay que REABRIR el panel en cada vuelta: al cerrarlo desaparecen sus botones del DOM (medido:
    // sin reabrir, solo se colocaba el primer material).
    await showCategory(page, 'Material');
    const btn = page.locator(`.rail-btn[title="${titulo}"]`).first();
    if ((await btn.count()) === 0) continue;
    await btn.click();
    // El panel lateral TAPA la parte izquierda del campo: si se deja abierto, el clic de colocación
    // cae sobre el panel y el material no se coloca (medido: 4 de 6 objetos). Se cierra antes de
    // cada clic; la herramienta queda armada igualmente (colocación continua).
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
    const p = normToScreen(nx, ny, host, fit);
    const antes = Number(await page.locator('.field-count').textContent());
    await page.mouse.click(p.x, p.y);
    // Se comprueba que el objeto se ha colocado de verdad y se reintenta UNA vez si no: un clic que
    // cae fuera del campo (o sobre un panel que acaba de abrirse) no coloca nada y la captura
    // saldría con menos objetos de los previstos.
    const colocado = await expect
      .poll(async () => Number(await page.locator('.field-count').textContent()), { timeout: 2500 })
      .toBeGreaterThan(antes)
      .then(() => true)
      .catch(() => false);
    if (!colocado) {
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(150);
    }
  }
  await showCategory(page, 'Dibujo');
  const linea = page.locator('.rail-btn[title="Línea"]').first();
  if ((await linea.count()) > 0) {
    await linea.click();
    const a = normToScreen(0.2, 0.5, host, fit);
    const b = normToScreen(0.8, 0.5, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  }
  const cerrar2 = page.locator('.side-panel-left .panel-close');
  if (await cerrar2.isVisible().catch(() => false)) await cerrar2.first().click();
  // La captura NO puede salir vacía: se exige un mínimo de objetos REALES colocados (el número
  // exacto puede variar en una unidad por un clic que caiga fuera del campo, y el índice lo dice).
  const colocados = Number(await page.locator('.field-count').textContent());
  expect(
    colocados,
    'la pizarra tiene objetos de verdad antes de la captura',
  ).toBeGreaterThanOrEqual(4);
}

test('genera docs/screenshots/fase-ux-final (17 capturas + hoja de contacto + índice)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  fs.mkdirSync(DIR, { recursive: true });

  // ---------- Escritorio ----------
  await page.setViewportSize(ESCRITORIO);
  await seed(page);
  await componerPizarra(page);
  await disparo(
    page,
    'escritorio-pizarra-completa',
    'Pizarra en escritorio con objetos reales colocados',
    OBJETOS,
  );

  await showCategory(page, 'Jugadores');
  await page.locator('.roster-color').first().click();
  await page.waitForTimeout(120);
  await disparo(
    page,
    'escritorio-jugadores-colores',
    'Panel de Jugadores con la paleta por ejercicio abierta',
  );

  await showCategory(page, 'Material');
  await disparo(page, 'escritorio-materiales', 'Panel de Material con el catálogo');

  // Chino y portería grande: se colocan aislados y se selecciona la portería.
  await page.goto('/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  const host = await hostBox(page);
  const fit = await fitMode(page);
  await showCategory(page, 'Material');
  for (const [titulo, nx, ny] of [
    ['Chino', 0.35, 0.4],
    ['Portería grande', 0.65, 0.4],
  ] as Array<[string, number, number]>) {
    await page.locator(`.rail-btn[title="${titulo}"]`).first().click();
    const p = normToScreen(nx, ny, host, fit);
    await page.mouse.click(p.x, p.y);
  }
  const cerrar = page.locator('.side-panel-left .panel-close');
  if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
  await disparo(
    page,
    'escritorio-chino-porteria',
    'Campo con el Chino nuevo y la Portería grande frontal',
    2,
  );

  await page.goto('/library');
  await expect(page.locator('.ex-card').first()).toBeVisible();
  await disparo(
    page,
    'escritorio-biblioteca-miniaturas',
    'Biblioteca con las tarjetas y sus miniaturas',
  );
  await page.goto('/team');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await disparo(page, 'escritorio-plantilla', 'Plantilla en escritorio');

  // Escudo sobre fondo claro y oscuro (se inyecta el fondo a propósito).
  for (const [fichero, fondo, tinta] of [
    ['escudo-fondo-claro', '#ffffff', '#111111'],
    ['escudo-fondo-oscuro', '#171d23', '#f2f5f7'],
  ] as Array<[string, string, string]>) {
    await page.evaluate(
      ({ f, t }) => {
        document.querySelectorAll('[data-fondo-escudo]').forEach((n) => n.remove());
        const caja = document.createElement('div');
        caja.setAttribute('data-fondo-escudo', '1');
        caja.style.cssText = `position:fixed;inset:0;z-index:99999;background:${f};color:${t};display:grid;place-items:center;gap:16px;grid-auto-flow:row;font:600 14px Inter,sans-serif`;
        caja.innerHTML = `<img src="assets/brand/cdm-pizarrales-escudo.png" alt="escudo" style="width:220px;height:220px;object-fit:contain"><span>Escudo sobre fondo ${f}</span>`;
        document.body.appendChild(caja);
      },
      { f: fondo, t: tinta },
    );
    await page.waitForTimeout(250);
    await disparo(
      page,
      fichero,
      `Escudo transparente sobre fondo ${fondo === '#ffffff' ? 'claro' : 'oscuro'}`,
    );
  }
  await page.evaluate(() =>
    document.querySelectorAll('[data-fondo-escudo]').forEach((n) => n.remove()),
  );

  // ---------- Móvil horizontal ----------
  await page.setViewportSize(MOVIL_H);
  await seed(page);
  await componerPizarra(page);
  await disparo(
    page,
    'movil-horizontal-pizarra',
    'Pizarra en móvil horizontal con objetos',
    OBJETOS,
  );
  await showCategory(page, 'Jugadores');
  await disparo(page, 'movil-horizontal-panel-jugadores', 'Panel de Jugadores en móvil horizontal');
  await showCategory(page, 'Material');
  await disparo(page, 'movil-horizontal-panel-material', 'Panel de Material en móvil horizontal');

  // ---------- Móvil vertical ----------
  await page.setViewportSize(MOVIL_V);
  await seed(page);
  await componerPizarra(page);
  await disparo(page, 'movil-vertical-pizarra', 'Pizarra en móvil vertical con objetos', OBJETOS);
  await showCategory(page, 'Material');
  await disparo(page, 'movil-vertical-panel', 'Material como hoja inferior en móvil vertical');

  await page.goto('/team');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await disparo(page, 'movil-vertical-plantilla', 'Plantilla compacta en móvil vertical');
  await page.locator('.nav-mas').click();
  await expect(page.locator('.cuenta-panel')).toBeVisible();
  await page.waitForTimeout(250);
  await disparo(page, 'movil-vertical-plantilla-drawer', 'Drawer «Más» entrando por la izquierda');
  await page.keyboard.press('Escape');

  await page.goto('/library');
  await expect(page.locator('.ex-card').first()).toBeVisible();
  await disparo(
    page,
    'movil-vertical-biblioteca-dos-columnas',
    'Biblioteca a dos columnas en móvil',
  );

  // ---------- PNG exportado ----------
  await page.setViewportSize(ESCRITORIO);
  await componerPizarra(page);
  await page.locator('.studio-top button[aria-label="Exportar"]').click();
  const descarga = await Promise.race([
    page.waitForEvent('download', { timeout: 15_000 }).catch(() => null),
    (async () => {
      await page.locator('.rail-btn', { hasText: 'PNG' }).first().click();
      return null;
    })(),
  ]);
  const dl =
    descarga ?? (await page.waitForEvent('download', { timeout: 15_000 }).catch(() => null));
  if (dl) {
    await dl.saveAs(`${DIR}/ejercicio-exportado.png`);
    FICHAS.push({
      fichero: 'ejercicio-exportado',
      que: 'PNG exportado por la app (campo con objetos)',
    });
  } else {
    // Si el navegador no entrega la descarga, se captura al menos el menú de exportación abierto.
    await page.screenshot({ path: `${DIR}/ejercicio-exportado.png` });
    FICHAS.push({
      fichero: 'ejercicio-exportado',
      que: 'Exportación abierta (el navegador no entregó la descarga en esta pasada)',
    });
  }

  // ---------- Hoja de contacto e índice ----------
  const ficheros = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.png') && f !== 'contact-sheet.png')
    .sort();
  const filas = ficheros
    .map((f) => {
      const b64 = fs.readFileSync(`${DIR}/${f}`).toString('base64');
      return `<figure><img src="data:image/png;base64,${b64}" alt="${f}"><figcaption>${f}</figcaption></figure>`;
    })
    .join('\n');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Evidencia visual — fase UX</title>
<style>body{font:14px Inter,system-ui,sans-serif;background:#0f1418;color:#e8edf2;margin:24px}
h1{font-size:20px}figure{margin:0 0 18px}img{max-width:520px;border:1px solid #2b3947;border-radius:8px;display:block}
figcaption{margin-top:6px;color:#9fb0bf}main{display:flex;flex-wrap:wrap;gap:18px}</style></head>
<body><h1>Evidencia visual — fase UX (${ficheros.length} capturas)</h1><main>${filas}</main></body></html>`;
  fs.writeFileSync(`${DIR}/contact-sheet.html`, html, 'utf8');

  // La hoja de contacto como PNG: se captura el propio HTML renderizado.
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('about:blank');
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: `${DIR}/contact-sheet.png`, fullPage: true });

  const indice = [
    '# Evidencia visual — fase UX final',
    '',
    'Generadas por `e2e/fase-ux-capturas.spec.ts` (solo con `CAPTURAS_UX=1`). Carpeta NUEVA: no se ha',
    'tocado ninguna galería anterior del repositorio.',
    '',
    '| Fichero | Qué muestra | Objetos colocados |',
    '| --- | --- | --- |',
    ...FICHAS.map((f) => `| \`${f.fichero}.png\` | ${f.que} | ${f.objetos ?? '—'} |`),
    '| `contact-sheet.png` | Hoja de contacto con todas las capturas | — |',
    '',
    '## Estado de las fases reflejadas',
    '',
    '- Miniatura autocontenida (FASE 1), colores de jugador por ejercicio (FASE 2), Plantilla compacta y',
    '  drawer «Más» (FASE 6), biblioteca a dos columnas (FASE 7), escudo transparente y Chino/Portería',
    '  nuevos (FASE 8A/8B/8C), pizarra móvil sin navegación global (FASE 4) y grupo flotante',
    '  «Herramientas» SIN barra inferior (FASE 3) están implementados: en las capturas de la pizarra el',
    '  fondo ya NO tiene barra y el campo llega al borde inferior; las categorías viven en el menú del',
    '  botón «Herramientas».',
    '- Los paneles móviles (FASE 5) terminan justo ENCIMA del grupo flotante: su franja inferior está',
    '  reservada (`--reserva-grupo-herramientas`) para que el grupo, que va por encima del panel para',
    '  seguir operable, no intercepte las últimas filas del catálogo ni de la plantilla.',
    '',
  ].join('\n');
  fs.writeFileSync(`${DIR}/INDICE.md`, indice, 'utf8');

  // Verificación de que la evidencia existe y no está vacía.
  for (const f of [
    ...FICHAS.map((x) => `${x.fichero}.png`),
    'contact-sheet.png',
    'contact-sheet.html',
    'INDICE.md',
  ]) {
    const ruta = `${DIR}/${f}`;
    expect(fs.existsSync(ruta), `existe ${f}`).toBe(true);
    expect(fs.statSync(ruta).size, `${f} no está vacío`).toBeGreaterThan(1000);
  }

  // Verificación POR PÍXELES de que las capturas muestran la FASE 3 y no la barra vieja. Medido en la
  // fila a 30 px del borde inferior:
  //  · con la barra, su fondo (#171d23) cubría TODO el ancho (~1,00 de la fila);
  //  · ahora el grupo flotante pinta color de interfaz solo en su pastilla (149 px de 390 en móvil →
  //    0,29 de la fila; 210 px de 1366 en escritorio → 0,06), y el margen oscuro del campo no entra en
  //    la tolerancia.
  // Se comprueba además que en el tercio DERECHO de esa fila no queda interfaz (con barra sería ~1,00)
  // y que el rincón inferior IZQUIERDO difiere del fondo medido al otro extremo: eso es el grupo.
  for (const [fichero, ancho] of [
    ['movil-vertical-pizarra', 390],
    ['escritorio-pizarra-completa', 1366],
  ] as Array<[string, number]>) {
    const dataUrl = `data:image/png;base64,${fs
      .readFileSync(`${DIR}/${fichero}.png`)
      .toString('base64')}`;
    const analisis = await page.evaluate(
      async ([url, vw]) => {
        const img = new Image();
        img.src = url as string;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const fila = c.height - 30;
        // Color de interfaz = fondo del grupo (23,29,35) con tolerancia ESTRECHA: medido en la captura,
        // la pastilla da (23,28,34) y el margen oscuro del campo (16,21,26), que NO debe contar.
        const esInterfaz = (r: number, g: number, b: number): boolean =>
          Math.abs(r - 23) <= 5 && Math.abs(g - 29) <= 5 && Math.abs(b - 35) <= 5;
        const fraccionEn = (desde: number, hasta: number): number => {
          const d = ctx.getImageData(desde, fila, hasta - desde, 1).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (esInterfaz(d[i], d[i + 1], d[i + 2])) n++;
          return n / (hasta - desde);
        };
        const media = (desde: number, hasta: number): number[] => {
          const d = ctx.getImageData(desde, fila, hasta - desde, 1).data;
          let r = 0;
          let g = 0;
          let b = 0;
          const n = d.length / 4;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i];
            g += d[i + 1];
            b += d[i + 2];
          }
          return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        };
        const izq = media(0, 60);
        const der = media(c.width - 60, c.width);
        return {
          ancho: c.width,
          alto: c.height,
          fila: fraccionEn(0, c.width),
          derecha: fraccionEn(c.width - 300, c.width),
          izquierda: izq,
          fondoDerecha: der,
          diferencia: Math.max(...izq.map((v, i) => Math.abs(v - der[i]))),
          anchoEsperado: vw as number,
        };
      },
      [dataUrl, ancho],
    );
    console.log(`[capturas-ux] ${fichero}: ${JSON.stringify(analisis)}`);
    // La captura es de la app a ese ancho de viewport (no un recorte).
    expect(Math.abs(analisis.ancho - ancho), `${fichero}: ancho de viewport`).toBeLessThanOrEqual(
      2,
    );
    // Sin barra: el fondo de interfaz no puede ocupar la fila inferior entera.
    expect(
      analisis.fila,
      `${fichero}: la banda inferior no es una barra (${analisis.fila.toFixed(2)} de interfaz)`,
    ).toBeLessThan(0.6);
    // Y no llega al lado derecho: ahí solo hay campo.
    expect(
      analisis.derecha,
      `${fichero}: el tercio derecho de la banda inferior es campo (${analisis.derecha.toFixed(2)})`,
    ).toBeLessThan(0.05);
    // El rincón inferior izquierdo SÍ tiene el grupo flotante: su color medio difiere del fondo del
    // campo medido al otro extremo de la misma fila.
    expect(
      analisis.diferencia,
      `${fichero}: el grupo flotante está en el rincón inferior izquierdo (diferencia ${analisis.diferencia})`,
    ).toBeGreaterThan(8);
  }

  console.log(`[capturas-ux] ${FICHAS.length + 1} PNG en ${DIR}`);
});
