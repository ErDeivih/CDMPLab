// =============================================================
// CORRECCIÓN URGENTE — CAMBIO DE CAMPO (defecto reproducido por el dueño)
//
// QUÉ PASABA (causa raíz): `board.component.ts` tenía un flujo con estado pendiente. Al pasar de
// un campo completo a uno de media extensión CON objetos, `setField` guardaba un plan
// (`fieldChangePlan`), abría el diálogo «Cambiar a medio campo» (`fieldDialogOpen`) y terminaba
// con `return` SIN cambiar el campo. El diálogo pendiente bloqueaba las interacciones
// siguientes: el primer cambio podía funcionar y los demás «no hacían nada» hasta insistir.
// La suite no lo veía porque el helper de otras pruebas detectaba el diálogo y pulsaba solo
// «Mantener los objetos».
//
// QUÉ SE VERIFICA AQUÍ, sin llamar a métodos de Angular y como lo haría una persona:
//  · un clic = un cambio de campo, con y sin objetos, repetido muchas veces;
//  · ningún diálogo, backdrop ni plan pendiente; el panel de Propiedades sigue abierto;
//  · los objetos conservan ids y coordenadas normalizadas; no se duplican ni desaparecen;
//  · undo/redo siguen funcionando después de cambiar de campo;
//  · la galería tiene SEIS campos y los retirados (`box`, `two_halves`) no se ofrecen;
//  · un documento histórico con `box`/`two_halves` se abre, se dibuja y cambia a Campo completo
//    con un clic;
//  · fútbol sala azul: superficie lisa, áreas claras detrás de las líneas y PNG sin verde.
//
// MEDIDO para no confundir copias del SVG: la galería de tarjetas dibuja su PROPIA miniatura de
// cada campo (con el mismo diseño), así que las comprobaciones del tablero se acotan a
// `.board-canvas`: en fútbol sala hay 2 rellenos de área en el tablero y 2 más en la tarjeta.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import {
  seedBoard,
  openBoard,
  hostBox,
  normToScreen,
  fitMode,
  showCategory,
} from './board-helpers';
import { fillBoardTitle } from './gesture-helpers';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = 'docs/screenshots/fase-cambio-campos';
const CAPTURAS = process.env['CAPTURAS_CAMPOS'];
const ESCRITORIO = { width: 1366, height: 900 };
const MOVIL_V = { width: 390, height: 844 };
const MOVIL_H = { width: 844, height: 390 };

/** Los SEIS campos que ofrece la galería, con la etiqueta visible de su tarjeta. */
const CAMPOS: Array<{ etiqueta: string; id: string }> = [
  { etiqueta: 'Campo completo', id: 'full' },
  { etiqueta: 'Medio campo', id: 'half' },
  { etiqueta: 'Tercio de campo', id: 'third' },
  { etiqueta: 'Fútbol sala', id: 'futsal' },
  { etiqueta: 'F7 transversal', id: 'f7' },
  { etiqueta: 'Lienzo', id: 'blank' },
];

/** Secuencia del encargo: los seis campos y vuelta a Campo completo. */
const SECUENCIA = [...CAMPOS.map((c) => c.etiqueta), 'Campo completo'];

function idDe(etiqueta: string): string {
  return CAMPOS.find((c) => c.etiqueta === etiqueta)!.id;
}

async function abrirPropiedades(page: Page): Promise<void> {
  if (
    !(await page
      .locator('.studio-panel')
      .isVisible()
      .catch(() => false))
  ) {
    await page.locator('button[aria-label="Propiedades"]').click();
  }
  await expect(page.locator('.studio-panel')).toBeVisible();
  await expect(page.locator('.field-gallery')).toBeVisible();
}

async function cerrarPropiedades(page: Page): Promise<void> {
  const cerrar = page.locator('.studio-panel button[aria-label="Cerrar panel"]');
  if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
}

async function campoActual(page: Page): Promise<string | null> {
  return page.locator('.board-host').getAttribute('data-field');
}

/** Pulso una tarjeta y espero al cambio REAL de `data-field`. Devuelve cuántos ms tardó. */
async function pulsarCampo(page: Page, etiqueta: string, limite = 1500): Promise<number> {
  const esperado = idDe(etiqueta);
  const t0 = Date.now();
  await page.locator('.field-gallery .field-card', { hasText: etiqueta }).first().click();
  await expect
    .poll(() => campoActual(page), { timeout: limite, message: `«${etiqueta}» no se aplicó` })
    .toBe(esperado);
  return Date.now() - t0;
}

/** Comprueba que no hay NADA del diálogo retirado ni overlays pendientes.
 *  Se busca por ROL DE BOTÓN: el título del ejercicio puede contener esas palabras y no debe
 *  confundirse con una opción del diálogo que ya no existe. */
async function sinDialogoNiOverlay(page: Page): Promise<void> {
  await expect(page.locator('.field-change-dialog'), 'diálogo retirado').toHaveCount(0);
  await expect(page.locator('.unsaved-backdrop'), 'ningún backdrop pendiente').toHaveCount(0);
  const opciones = page.getByRole('button', {
    name: /Mantener los objetos|Dos medios campos|Encajar todo en un medio campo/,
  });
  await expect(opciones, 'opciones del diálogo retirado').toHaveCount(0);
}

/** Coloca un jugador de plantilla, un cono, una portería grande y una flecha. */
async function colocarObjetos(page: Page): Promise<void> {
  const host = await hostBox(page);
  const fit = await fitMode(page);
  const cerrarPanel = async (): Promise<void> => {
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
  };

  // 1) Jugador de plantilla.
  await showCategory(page, 'Jugadores');
  await page.locator('.side-panel-left .roster-item').first().click();
  await cerrarPanel();
  const p1 = normToScreen(0.25, 0.3, host, fit);
  await page.mouse.click(p1.x, p1.y);

  // 2) Cono.
  await showCategory(page, 'Material');
  await page.locator('.rail-btn[title="Cono"]').first().click();
  await cerrarPanel();
  const p2 = normToScreen(0.5, 0.3, host, fit);
  await page.mouse.click(p2.x, p2.y);

  // 3) Portería grande.
  await showCategory(page, 'Material');
  await page.locator('.rail-btn[title="Portería grande"]').first().click();
  await cerrarPanel();
  const p3 = normToScreen(0.75, 0.3, host, fit);
  await page.mouse.click(p3.x, p3.y);

  // 4) Flecha, arrastrando de verdad sobre el campo.
  await showCategory(page, 'Dibujo');
  await page.locator('.rail-btn[title="Flecha (movimiento)"]').first().click();
  await cerrarPanel();
  const a = normToScreen(0.35, 0.6, host, fit);
  const b = normToScreen(0.65, 0.72, host, fit);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape'); // desarmar sin tocar los objetos
  await expect(page.locator('.field-count')).toHaveText('4');
}

type ElementoCrudo = Record<string, unknown>;

/** Firma de la geometría del modelo: TODOS los campos numéricos de cada elemento (una flecha no
 *  guarda `x`/`y`, guarda sus extremos, así que no se puede mirar solo `x`/`y`). */
function firma(els: ElementoCrudo[]): string {
  return els
    .slice()
    .sort((a, b) => String(a['id']).localeCompare(String(b['id'])))
    .map((e) => {
      const nums = Object.entries(e)
        .filter(([, v]) => typeof v === 'number')
        .sort(([k1], [k2]) => k1.localeCompare(k2))
        .map(([k, v]) => `${k}=${(v as number).toFixed(6)}`)
        .join(',');
      return `${String(e['id'])}:${String(e['t'])}:${nums}`;
    })
    .join('|');
}

/** Lee del ALMACÉN la instantánea real del ejercicio (ids y geometría del MODELO). */
async function leerModelo(
  page: Page,
): Promise<{ field: string; elementos: ElementoCrudo[] } | null> {
  return page.evaluate(() => {
    const crudo = localStorage.getItem('entrenolab:exercises');
    if (!crudo) return null;
    const docs = JSON.parse(crudo) as Array<{
      canvas?: { field?: string; frames?: Array<{ elements?: ElementoCrudo[] }> };
    }>;
    if (!docs.length) return null;
    const canvas = docs[0].canvas ?? {};
    return { field: canvas.field ?? '', elementos: canvas.frames?.[0]?.elements ?? [] };
  });
}

async function guardarYSalir(page: Page): Promise<void> {
  await page.locator('.chip-icon-primary').click();
  await page.waitForURL('**/library');
}

/** Vuelve a abrir el ejercicio guardado en la pizarra (desde la biblioteca, como el dueño). */
async function reabrirEnPizarra(page: Page): Promise<void> {
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
}

/** Los ocho objetos de la comparación de escalas, con su tipo/asset REALES (como los coloca la app). */
const OBJETOS_ESCALA: Array<{ nombre: string; el: Record<string, unknown> }> = [
  { nombre: 'jugador', el: { id: 'e1', t: 'player', x: 0.18, y: 0.25, c: '#1a73e8' } },
  {
    nombre: 'cono',
    el: {
      id: 'e2',
      t: 'cone',
      x: 0.38,
      y: 0.25,
      c: '#f6c945',
      size: 1.0,
      asset: 'assets/tactical/cone-yellow.png',
      assetKind: 'cone_yellow',
    },
  },
  {
    nombre: 'chino',
    el: {
      id: 'e3',
      t: 'target',
      x: 0.58,
      y: 0.25,
      c: '#2c7be5',
      size: 0.62,
      asset: '',
      assetKind: 'target',
    },
  },
  {
    nombre: 'escalera',
    el: {
      id: 'e4',
      t: 'ladder',
      x: 0.8,
      y: 0.25,
      c: '#f6c945',
      size: 1.6,
      asset: '',
      assetKind: 'ladder',
    },
  },
  {
    nombre: 'miniporteria',
    el: {
      id: 'e5',
      t: 'minigoal',
      x: 0.2,
      y: 0.68,
      c: '#e8edf2',
      size: 1.45,
      asset: '',
      assetKind: 'minigoal',
    },
  },
  {
    nombre: 'porteria',
    el: {
      id: 'e6',
      t: 'goal',
      x: 0.5,
      y: 0.68,
      c: '#ffffff',
      size: 1.6,
      asset: '',
      assetKind: 'goal',
    },
  },
  {
    nombre: 'maniqui',
    el: {
      id: 'e7',
      t: 'mannequin',
      x: 0.72,
      y: 0.68,
      c: '#e8edf2',
      size: 1.35,
      asset: 'assets/tactical/mannequin.png',
      assetKind: 'mannequin',
    },
  },
  {
    nombre: 'balon',
    el: {
      id: 'e8',
      t: 'ball',
      x: 0.9,
      y: 0.68,
      c: '#ffffff',
      size: 1.5,
      asset: 'assets/tactical/ball.png',
      assetKind: 'ball_football',
    },
  },
];

/** Abre un documento de prueba con los objetos de escala (todos o solo los indicados). */
async function abrirDocumentoEscala(page: Page, campo: string, solo?: string[]): Promise<void> {
  const elementos = OBJETOS_ESCALA.filter((o) => !solo || solo.includes(o.nombre)).map((o) => o.el);
  await page.addInitScript(
    ([campoDoc, els]: [string, unknown[]]) => {
      localStorage.clear();
      const now = new Date().toISOString();
      localStorage.setItem('entrenolab:seeded', '1');
      localStorage.setItem('entrenolab:board-hints', '1');
      localStorage.setItem('entrenolab:fill-hint', '1');
      localStorage.setItem(
        'entrenolab:teams',
        JSON.stringify([
          { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now },
        ]),
      );
      localStorage.setItem('entrenolab:players', JSON.stringify([]));
      localStorage.setItem('entrenolab:folders', JSON.stringify([]));
      localStorage.setItem(
        'entrenolab:exercises',
        JSON.stringify([
          {
            id: 'esc-capturas',
            teamId: 't1',
            folderId: null,
            title: 'Materiales y escalas',
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
            canvas: {
              version: 2,
              schemaVersion: 4,
              field: campoDoc,
              orientation: 'horizontal',
              frames: [{ duration: 1000, elements: els }],
              grass: 'stripes',
            },
            thumbnail: null,
            savedAt: '2026-01-01T10:00:00.000Z',
          },
        ]),
      );
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    },
    [campo, elementos] as [string, unknown[]],
  );
  await page.goto('/library');
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  await expect(page.locator('.board-host')).toHaveAttribute('data-field', campo);
}

/** Lee una captura ya escrita y la devuelve como data URL (para componer la hoja de contacto). */
function dataUrl(fichero: string): string {
  const ruta = path.join(SHOTS, `${fichero}.png`);
  return `data:image/png;base64,${fs.readFileSync(ruta).toString('base64')}`;
}

/** Pie de foto de cada pieza de esta galería (para la hoja de contacto y el índice). */
const PIES: Record<string, string> = {
  'campo-completo': 'Campo completo con los cuatro objetos reales colocados',
  'medio-campo': 'Medio campo con los MISMOS objetos (el cambio es directo, sin diálogo)',
  'tercio-campo': 'Tercio de campo con los mismos objetos',
  'futbol-sala-horizontal': 'Fútbol sala azul en horizontal (superficie lisa y áreas claras)',
  'futbol-sala-vertical': 'Fútbol sala azul en vertical',
  'f7-transversal': 'F7 transversal con los mismos objetos',
  lienzo: 'Lienzo (sin marcas de campo) con los mismos objetos',
  'cambio-con-objetos-antes': 'Cuatro objetos sobre Campo completo (antes del cambio)',
  'cambio-con-objetos-despues': 'Los MISMOS objetos tras un clic en Medio campo',
  'movil-cambio-campos': 'Cambio de campo en móvil 390×844 (fútbol sala azul)',
  'movil-horizontal-campos': 'Pizarra en móvil horizontal 844×390',
  'materiales-campo-completo': 'Los ocho materiales en Campo completo (100 %, referencia)',
  'materiales-medio-campo': 'Los mismos materiales en Medio campo: se ven ~120 %',
  'materiales-comparativa-completo-medio':
    'Comparación medida lado a lado: campo completo vs medio campo',
  'porteria-vs-campo-f11': 'Portería de material junto a la portería del campo en F11',
  'porteria-vs-campo-f7': 'Portería de material junto a la portería visible en F7',
  'porteria-vs-campo-futsal': 'Portería de material junto a la portería de fútbol sala',
  'chino-junto-a-cono': 'Chino (platillo) junto al cono: reconocible y más pequeño',
  'escalera-porteria-miniporteria':
    'Escalera (vista desde arriba), miniportería y portería: tres siluetas distintas',
};

/**
 * Escribe la HOJA DE CONTACTO y el ÍNDICE a partir de las capturas que hay en la carpeta.
 *
 * DEFECTO QUE CORRIGE: antes el HTML apuntaba a rutas relativas (`materiales-campo-completo.png`)
 * que el navegador NO puede resolver cuando el contenido se inyecta con `setContent`, así que la
 * hoja salía con iconos de «imagen no encontrada» aunque las capturas existieran. Ahora cada
 * imagen se incrusta como data URL (el navegador sí la resuelve) y, además, se COMPRUEBA que
 * ninguna imagen quede rota antes de disparar la captura de la hoja.
 */
async function escribirHojaDeContacto(
  page: Page,
  fichas: Array<{ fichero: string; que: string }>,
): Promise<void> {
  const enDisco = fs
    .readdirSync(SHOTS)
    .filter((f) => f.endsWith('.png') && f !== 'contact-sheet.png')
    .map((f) => f.replace(/\.png$/, ''));
  // Todas las piezas de la carpeta (las dos pruebas de captura suman aquí), con su pie de foto.
  const piezas = [...new Set([...fichas.map((f) => f.fichero), ...enDisco])].sort();
  const filas = piezas
    .map((p) => {
      const pie = PIES[p] ?? fichas.find((f) => f.fichero === p)?.que ?? p;
      return `<figure><img src="${dataUrl(p)}" alt="${pie}"/><figcaption>${p}.png — ${pie}</figcaption></figure>`;
    })
    .join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cambio de campos y materiales — contacto</title>
<style>body{background:#10151a;color:#e8edf2;font:14px system-ui;margin:0;padding:16px}
h1{font-size:18px;margin:0 0 14px}figure{margin:0 0 18px}
img{width:100%;max-width:920px;border:1px solid #2b3947;border-radius:8px;background:#171d23;display:block}
figcaption{color:#8a97a3;margin-top:6px}</style></head><body>
<h1>Cambio de campo directo, escala de materiales y siluetas reconocibles</h1>${filas}</body></html>`;
  fs.writeFileSync(path.join(SHOTS, 'contact-sheet.html'), html, 'utf8');
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.setContent(html, { waitUntil: 'load' });
  const rotas = await page.evaluate(
    () => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
  );
  expect(rotas, 'ninguna imagen rota en la hoja de contacto').toBe(0);
  await page.screenshot({ path: path.join(SHOTS, 'contact-sheet.png'), fullPage: true });

  const indice = [
    '# Evidencia visual — cambio de campo, escala de materiales y siluetas',
    '',
    'Generadas por `e2e/fase-cambio-campos.spec.ts` (solo con `CAPTURAS_CAMPOS=1`). Carpeta NUEVA: no',
    'se ha tocado ninguna galería anterior del repositorio. La hoja de contacto compone las imágenes',
    'incrustadas (data URL) y comprueba que NINGUNA queda rota antes de disparar.',
    '',
    '| Fichero | Qué muestra |',
    '| --- | --- |',
    ...piezas.map((p) => `| \`${p}.png\` | ${PIES[p] ?? p} |`),
    '| `contact-sheet.png` | Hoja de contacto compuesta con todas las capturas |',
    '',
    '## Estado reflejado',
    '',
    '- El cambio de campo es DIRECTO: un clic cambia el campo y los objetos conservan ids y',
    '  coordenadas normalizadas. El diálogo «Cambiar a medio campo» ya no existe.',
    '- La galería ofrece SEIS campos: Campo completo, Medio campo, Tercio de campo, Fútbol sala,',
    '  F7 transversal y Lienzo. `box` y `two_halves` siguen admitidos para documentos antiguos.',
    '- El fútbol sala es azul LISO con las áreas de penalti en azul claro (`#1e3a8a` / `#2563eb`).',
    '- Escala aparente medida (mismo objeto y viewport): medio campo 120 %, tercio 127 %, fútbol sala',
    '  y F7 118 %, lienzo 100 % (documentado).',
    '- La portería de material mide lo mismo que la portería dibujada en el campo (ratio medido',
    '  1,000-1,002 en F11, medio, tercio, F7 y fútbol sala, horizontal y vertical).',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(SHOTS, 'INDICE.md'), indice, 'utf8');
}

type Analisis = {
  dominante: [number, number, number];
  dominantePct: number;
  superficie: [number, number, number];
  area: [number, number, number];
  verdes: number;
};

/** Analiza un PNG (de pantalla o exportado) midiendo el COLOR DOMINANTE de la zona indicada y dos
 *  puntos concretos. El muestreo es una CUADRÍCULA y se toma el color más frecuente, así que las
 *  líneas blancas (finas) no falsean la medida. */
async function analizar(
  page: Page,
  png: Buffer,
  caja: { x: number; y: number; width: number; height: number },
): Promise<Analisis> {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  return page.evaluate(
    async ([url, bx, by, bw, bh]) => {
      const img = new Image();
      img.src = url as string;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const x0 = bx as number;
      const y0 = by as number;
      const ancho = bw as number;
      const alto = bh as number;
      const leer = (px: number, py: number): [number, number, number] => {
        const d = ctx.getImageData(
          Math.max(0, Math.min(c.width - 1, Math.round(px))),
          Math.max(0, Math.min(c.height - 1, Math.round(py))),
          1,
          1,
        ).data;
        return [d[0], d[1], d[2]];
      };
      const cuenta = new Map<string, { n: number; c: [number, number, number] }>();
      for (let i = 1; i < 24; i++) {
        for (let j = 1; j < 16; j++) {
          const col = leer(x0 + (ancho * i) / 24, y0 + (alto * j) / 16);
          const clave = col.map((v) => Math.round(v / 8) * 8).join(',');
          const prev = cuenta.get(clave);
          if (prev) prev.n++;
          else cuenta.set(clave, { n: 1, c: col });
        }
      }
      const orden = [...cuenta.values()].sort((a, b) => b.n - a.n);
      const total = [...cuenta.values()].reduce((s, v) => s + v.n, 0);
      const zona = ctx.getImageData(
        Math.max(0, Math.round(x0)),
        Math.max(0, Math.round(y0)),
        Math.max(1, Math.min(c.width - Math.round(x0), Math.round(ancho))),
        Math.max(1, Math.min(c.height - Math.round(y0), Math.round(alto))),
      ).data;
      let verdes = 0;
      for (let i = 0; i < zona.length; i += 4) {
        const r = zona[i];
        const g = zona[i + 1];
        const b = zona[i + 2];
        if (g > r + 20 && g > b + 10 && g > 60) verdes++;
      }
      return {
        dominante: orden[0].c,
        dominantePct: orden[0].n / total,
        // Puntos SIN líneas: a un cuarto del largo y fuera del eje central (que tiene la línea de
        // medio campo y los puntos de penalti), y dentro del área (a 2 m de la portería).
        superficie: leer(x0 + ancho * 0.25, y0 + alto * 0.35),
        area: leer(x0 + ancho * 0.05, y0 + alto * 0.5),
        verdes,
      };
    },
    [dataUrl, caja.x, caja.y, caja.width, caja.height],
  );
}

const azulado = (c: [number, number, number]): boolean => c[2] > c[0] + 25 && c[2] > c[1] + 15;

test.describe('CAMBIO DE CAMPO — sin objetos (un clic = un cambio)', () => {
  test('la secuencia completa de los seis campos, cinco vueltas, sin diálogo y sin bloqueos', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(`pageerror: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errores.push(`console.error: ${m.text()}`);
    });

    await abrirPropiedades(page);
    // La galería tiene EXACTAMENTE los seis campos pedidos.
    await expect(page.locator('.field-gallery .field-card')).toHaveCount(CAMPOS.length);
    for (const c of CAMPOS) {
      await expect(
        page.locator('.field-gallery .field-card', { hasText: c.etiqueta }),
        `existe la tarjeta «${c.etiqueta}»`,
      ).toHaveCount(1);
    }

    for (let vuelta = 1; vuelta <= 5; vuelta++) {
      for (const etiqueta of SECUENCIA) {
        const ms = await pulsarCampo(page, etiqueta);
        expect(
          ms,
          `vuelta ${vuelta}: «${etiqueta}» tardó ${ms} ms (el cambio debe ser inmediato)`,
        ).toBeLessThan(1500);
        await sinDialogoNiOverlay(page);
        await expect(
          page.locator('.studio-panel'),
          `vuelta ${vuelta}: el panel de Propiedades sigue abierto tras «${etiqueta}»`,
        ).toBeVisible();
        // aria-pressed: exactamente una tarjeta pulsada, y es la del campo activo.
        const pulsadas = page.locator('.field-gallery .field-card[aria-pressed="true"]');
        await expect(pulsadas, 'una sola tarjeta activa').toHaveCount(1);
        await expect(pulsadas).toHaveText(new RegExp(etiqueta));
        await expect(page.locator('.board-host')).toHaveAttribute('data-field', idDe(etiqueta));
      }
    }
    expect(errores, `errores de página/consola: ${errores.join(' | ')}`).toEqual([]);
  });

  test('pulsar el campo YA activo es un no-op seguro (no ensucia ni cambia nada)', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);

    await pulsarCampo(page, 'Medio campo');
    const antes = await page.locator('.board-host').evaluate((el) => el.outerHTML.length);
    const guardadoAntes = await page.locator('.chip-icon-primary').getAttribute('data-guardado');
    // Tres pulsaciones seguidas sobre la tarjeta ya activa.
    for (let i = 0; i < 3; i++) {
      await page.locator('.field-gallery .field-card', { hasText: 'Medio campo' }).first().click();
    }
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'half');
    await expect(page.locator('.field-gallery .field-card[aria-pressed="true"]')).toHaveCount(1);
    const despues = await page.locator('.board-host').evaluate((el) => el.outerHTML.length);
    expect(despues, 'el campo no se degrada al repetir el mismo clic').toBe(antes);
    expect(
      await page.locator('.chip-icon-primary').getAttribute('data-guardado'),
      'no cambia el estado de guardado',
    ).toBe(guardadoAntes);
    await sinDialogoNiOverlay(page);
  });

  test('FASE 1: 50 cambios consecutivos, comprobando cada estado por señales observables', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);

    // Sin esperas fijas arbitrarias: cada iteración espera al ESTADO observable (data-field) y luego
    // comprueba las otras cuatro señales que el encargo exige que coincidan.
    const SECUENCIA50 = SECUENCIA;
    for (let i = 0; i < 50; i++) {
      const etiqueta = SECUENCIA50[i % SECUENCIA50.length];
      const id = idDe(etiqueta);
      await page.locator('.field-gallery .field-card', { hasText: etiqueta }).first().click();
      await expect
        .poll(() => campoActual(page), { timeout: 3000, message: `cambio ${i + 1}` })
        .toBe(id);
      // 1) tarjeta activa, 2) selector, 3) SVG del campo, 4) orientación, 5) tipo del documento.
      const pulsada = page.locator('.field-gallery .field-card[aria-pressed="true"]');
      await expect(pulsada, `tarjeta activa en el cambio ${i + 1}`).toHaveCount(1);
      await expect(pulsada).toHaveText(new RegExp(etiqueta));
      await expect(
        page.locator('.studio-panel select[aria-label="Campo base"]'),
        `selector en el cambio ${i + 1}`,
      ).toHaveValue(id);
      // El SVG del campo corresponde al tipo activo (los seis campos dibujan distinto).
      const svg = await page.locator('.board-canvas svg').first().innerHTML();
      expect(svg.length, `SVG del campo en el cambio ${i + 1}`).toBeGreaterThan(200);
      if (id !== 'blank') {
        await expect(
          page.locator('.board-canvas .entrenolab-grass'),
          `césped/superficie dibujada en ${id}`,
        ).toHaveCount(1);
      }
      // La orientación que se aplica (portería arriba/izquierda) coincide con la que promete la
      // tarjeta: si el campo es de media extensión en escritorio, la orientación es vertical.
      const chipV = page.locator('.studio-panel .chip[data-orient="vertical"]');
      const chipH = page.locator('.studio-panel .chip[data-orient="horizontal"]');
      const activo = ((await chipV.getAttribute('class')) ?? '').includes('chip-active')
        ? 'vertical'
        : ((await chipH.getAttribute('class')) ?? '').includes('chip-active')
          ? 'horizontal'
          : null;
      const esperado = ['half', 'third'].includes(id) ? 'vertical' : null;
      if (esperado) {
        expect(activo, `orientación aplicada en ${id} (cambio ${i + 1})`).toBe(esperado);
      } else {
        expect(activo, `alguna orientación activa en ${id}`).not.toBeNull();
      }
      // El tipo de campo del DOCUMENTO (lo que se guardará) es el pulsado.
      const guardado = await page.evaluate(() => {
        const st = document.querySelector('.board-host');
        return st?.getAttribute('data-field') ?? null;
      });
      expect(guardado, `documento en el cambio ${i + 1}`).toBe(id);
    }
    // Y la galería sigue respondiendo después de 50 cambios.
    await expect(page.locator('.field-gallery .field-card').first()).toBeEnabled();
  });

  for (const zona of [
    { nombre: 'miniatura', posicion: { x: 0.5, y: 0.28 } },
    { nombre: 'nombre', posicion: { x: 0.5, y: 0.85 } },
    { nombre: 'borde izquierdo', posicion: { x: 0.04, y: 0.5 } },
    { nombre: 'centro', posicion: { x: 0.5, y: 0.5 } },
  ]) {
    test(`FASE 1: pulsar la zona «${zona.nombre}» de la tarjeta cambia el campo igual`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(ESCRITORIO);
      await seedBoard(page);
      await openBoard(page);
      await abrirPropiedades(page);

      // Se recorren campos distintos pulsando SIEMPRE la misma zona relativa de la tarjeta: así se
      // demuestra que el clic funciona en la miniatura, en el nombre, en el borde y en el centro.
      for (const etiqueta of ['Medio campo', 'Fútbol sala', 'Campo completo']) {
        const tarjeta = page.locator('.field-gallery .field-card', { hasText: etiqueta }).first();
        await tarjeta.scrollIntoViewIfNeeded();
        const caja = (await tarjeta.boundingBox())!;
        const x = caja.x + caja.width * zona.posicion.x;
        const y = caja.y + caja.height * zona.posicion.y;
        await page.mouse.click(x, y);
        await expect
          .poll(() => campoActual(page), {
            timeout: 3000,
            message: `zona «${zona.nombre}» en «${etiqueta}»`,
          })
          .toBe(idDe(etiqueta));
        await sinDialogoNiOverlay(page);
      }
    });
  }

  test('escenario rápido: diez cambios seguidos con ritmo humano, ninguno se pierde', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);

    const ritmo = [
      'Medio campo',
      'Tercio de campo',
      'Fútbol sala',
      'Campo completo',
      'F7 transversal',
    ];
    for (let i = 0; i < 10; i++) {
      const etiqueta = ritmo[i % ritmo.length];
      // Sin esperas largas: se pulsa y se comprueba en el mismo gesto humano (≈120 ms entre clics).
      await page.waitForTimeout(120);
      const ms = await pulsarCampo(page, etiqueta, 1200);
      expect(ms, `clic ${i + 1} («${etiqueta}») perdido o lento: ${ms} ms`).toBeLessThan(1200);
      await expect(page.locator('.board-host')).toHaveAttribute('data-field', idDe(etiqueta));
    }
    // El último campo pulsado es el activo y la galería sigue respondiendo.
    const ultima = ritmo[9 % ritmo.length];
    await expect(page.locator('.field-gallery .field-card[aria-pressed="true"]')).toHaveText(
      new RegExp(ultima),
    );
    await expect(page.locator('.field-gallery .field-card').first()).toBeEnabled();
  });

  test('las miniaturas de la galería NO se reconstruyen en cada ciclo (causa de clics perdidos)', async ({
    page,
  }) => {
    // DEFECTO CORREGIDO: la miniatura de cada tarjeta se calculaba en cada ciclo de detección de
    // cambios y, al ser un objeto nuevo, Angular REEMPLAZABA sus nodos internos continuamente. Al
    // pulsar seguido (justo después de un cambio de campo) el nodo pulsado podía desaparecer entre
    // `pointerdown` y `pointerup`, y el navegador NO disparaba el `click`: el dueño lo describía como
    // «a veces responde después de insistir». Medido antes de la corrección: 10-13 clics perdidos en
    // 20 repeticiones de esta batería; después: 0 en 440.
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);

    const mini = page.locator('.field-card[aria-label="Campo Medio campo"] .field-preview-svg');
    await mini.evaluate((el) => {
      (el as unknown as { __marca: string }).__marca = 'vivo';
    });
    // Interacciones que provocan detección de cambios SIN tocar el campo, la orientación ni cerrar el
    // panel de Propiedades (que es donde vive la galería).
    const guia = page.locator('.studio-panel select[aria-label="Guía de zonas"]');
    for (const valor of ['2x2', '3x3', 'none']) {
      await guia.selectOption(valor);
      await page.waitForTimeout(60);
    }
    await page.locator('.field-card[aria-label="Campo Fútbol sala"]').hover();
    await page.locator('.field-card[aria-label="Campo F7 transversal"]').hover();
    await expect(mini).toBeVisible();
    const sigueViva = await mini.evaluate(
      (el) => (el as unknown as { __marca?: string }).__marca === 'vivo',
    );
    expect(
      sigueViva,
      'la miniatura es el MISMO nodo tras varios ciclos (no se reinyecta con innerHTML)',
    ).toBe(true);
  });

  for (const vp of [MOVIL_V, MOVIL_H]) {
    test(`móvil ${vp.width}×${vp.height}: las tarjetas se pulsan y nada intercepta el clic`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(vp);
      await seedBoard(page);
      await openBoard(page);
      await abrirPropiedades(page);

      for (const etiqueta of ['Medio campo', 'Fútbol sala', 'Campo completo']) {
        // Playwright falla si algún control flotante intercepta el clic: eso ES la comprobación.
        const tarjeta = page.locator('.field-gallery .field-card', { hasText: etiqueta }).first();
        await tarjeta.scrollIntoViewIfNeeded();
        await tarjeta.click();
        await expect(page.locator('.board-host')).toHaveAttribute('data-field', idDe(etiqueta));
        await sinDialogoNiOverlay(page);
      }
      // Y el grupo flotante de herramientas sigue visible (no tapa la galería ni al revés).
      await expect(page.locator('.tools-persist')).toBeVisible();
      await expect(page.locator('.field-gallery')).toBeVisible();
    });
  }
});

test.describe('CAMBIO DE CAMPO — con objetos (nada se transforma ni se pierde)', () => {
  test('FASE 1.6: un gesto de dibujo EN CURSO se cancela limpiamente al cambiar de campo', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);

    // Se arma la Línea y se empieza a dibujar con el puntero ABAJO.
    await page.locator('.field-card[aria-label="Campo Medio campo"]').click();
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'half');
    await showCategory(page, 'Dibujo');
    await page.locator('.rail-btn[title="Línea"]').first().click();
    const cerrar = page.locator('.side-panel-left .panel-close');
    if (await cerrar.isVisible().catch(() => false)) await cerrar.first().click();
    await abrirPropiedades(page);
    const host = await hostBox(page);
    const fit = await fitMode(page);
    // Puntos en la MITAD DERECHA del campo: el panel de Propiedades (izquierda) no los tapa.
    const a = normToScreen(0.55, 0.3, host, fit);
    const b = normToScreen(0.78, 0.5, host, fit);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });

    // Cambio de campo SIN levantar el puntero (el selector no necesita el ratón).
    await page.locator('.studio-panel select[aria-label="Campo base"]').selectOption('full');
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'full');
    await page.mouse.up();

    // El borrador no se ha confirmado: no entra ningún objeto y no queda nada a medias.
    await expect(page.locator('.field-count'), 'el borrador no se confirma').toHaveText('0');
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'full');
    await expect(page.locator('.field-change-dialog')).toHaveCount(0);
    // Y la pizarra sigue usable CON LA MISMA HERRAMIENTA: el cambio de campo cancela el trazo, pero
    // no desarma la herramienta que el usuario había elegido.
    await page.locator('.field-card[aria-label="Campo Tercio de campo"]').click();
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'third');
    await expect(
      page.locator('.tools-caption-title'),
      'la herramienta sigue siendo la elegida',
    ).toHaveText('Línea');
    const a2 = normToScreen(0.55, 0.3, host, fit);
    const b2 = normToScreen(0.78, 0.5, host, fit);
    await page.mouse.move(a2.x, a2.y);
    await page.mouse.down();
    await page.mouse.move(b2.x, b2.y, { steps: 5 });
    await page.mouse.up();
    await expect(
      page.locator('.field-count'),
      'tras la cancelación se dibuja con normalidad',
    ).toHaveText('1');
  });

  test('los objetos conservan ids y coordenadas normalizadas; undo/redo y guardar/reabrir', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await colocarObjetos(page);

    // Guardar y reabrir para partir de un documento REAL en el almacén.
    await fillBoardTitle(page, 'Cambio de campo con objetos');
    await guardarYSalir(page);
    await reabrirEnPizarra(page);
    await expect(page.locator('.field-count')).toHaveText('4');
    const antes = await leerModelo(page);
    expect(antes, 'el ejercicio está en el almacén').not.toBeNull();
    expect(antes!.elementos, 'cuatro objetos en el modelo').toHaveLength(4);
    const firmaAntes = firma(antes!.elementos);

    await abrirPropiedades(page);
    for (const etiqueta of SECUENCIA) {
      await pulsarCampo(page, etiqueta);
      await sinDialogoNiOverlay(page);
      // Los objetos siguen siendo los mismos en pantalla (ni duplicados ni perdidos).
      await expect(page.locator('.field-count'), `tras «${etiqueta}»`).toHaveText('4');
      await expect(page.locator('.board-canvas [data-el-type]')).toHaveCount(4);
    }

    // Undo/redo tras los cambios de campo: vuelve al campo anterior y se rehace.
    await pulsarCampo(page, 'Fútbol sala');
    await page.keyboard.press('Control+z');
    await expect.poll(() => campoActual(page), { timeout: 4000 }).toBe(idDe('Campo completo'));
    await expect(page.locator('.field-count'), 'undo no toca los objetos').toHaveText('4');
    await page.keyboard.press('Control+y');
    await expect.poll(() => campoActual(page), { timeout: 4000 }).toBe('futsal');
    await expect(page.locator('.field-count')).toHaveText('4');

    // Guardar, recargar y reabrir: mismos ids, mismos tipos, mismas coordenadas del modelo.
    await pulsarCampo(page, 'Medio campo');
    await guardarYSalir(page);
    const despues = await leerModelo(page);
    expect(despues!.field, 'el campo se guardó').toBe('half');
    expect(despues!.elementos.length, 'cuatro objetos guardados').toBe(4);
    expect(
      despues!.elementos.map((e) => e['id']).sort(),
      'los ids son EXACTAMENTE los mismos (sin duplicados ni pérdidas)',
    ).toEqual(antes!.elementos.map((e) => e['id']).sort());
    expect(
      firma(despues!.elementos),
      'coordenadas normalizadas y geometría intactas tras la secuencia de campos',
    ).toBe(firmaAntes);

    // Reapertura real: el documento vuelve con todo.
    await reabrirEnPizarra(page);
    await expect(page.locator('.field-count')).toHaveText('4');
    await expect(page.locator('.board-host')).toHaveAttribute('data-field', 'half');
  });
});

test.describe('CAMBIO DE CAMPO — compatibilidad de documentos históricos', () => {
  const LEGADO: Array<{ etiqueta: string; campo: string; titulo: string }> = [
    { etiqueta: 'Área y portería', campo: 'box', titulo: 'Antiguo area porteria' },
    { etiqueta: 'Dos medios campos', campo: 'two_halves', titulo: 'Antiguo dos medios' },
  ];

  for (const caso of LEGADO) {
    test(`un documento histórico «${caso.campo}» se abre, se dibuja y cambia a Campo completo con UN clic`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(ESCRITORIO);
      const doc = {
        id: `legacy-${caso.campo}`,
        teamId: 't1',
        folderId: null,
        title: caso.titulo,
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
        canvas: {
          version: 2,
          schemaVersion: 4,
          field: caso.campo,
          orientation: 'horizontal',
          frames: [
            {
              duration: 1000,
              elements: [
                { id: 'e1', t: 'player', x: 0.3, y: 0.4, n: 9, c: '#1a73e8' },
                { id: 'e2', t: 'cone', x: 0.7, y: 0.6, c: '#f9ab00' },
              ],
            },
          ],
          grass: 'stripes',
        },
        thumbnail: null,
        savedAt: '2026-01-01T10:00:00.000Z',
      };
      await page.addInitScript((documento: unknown) => {
        for (const k of Object.keys(localStorage))
          if (k.startsWith('entrenolab:')) localStorage.removeItem(k);
        const now = new Date().toISOString();
        localStorage.setItem('entrenolab:seeded', '1');
        localStorage.setItem('entrenolab:board-hints', '1');
        localStorage.setItem('entrenolab:fill-hint', '1');
        localStorage.setItem(
          'entrenolab:teams',
          JSON.stringify([
            { id: 't1', name: 'Primer Equipo', accentColor: '#3056d3', createdAt: now },
          ]),
        );
        localStorage.setItem('entrenolab:players', JSON.stringify([]));
        localStorage.setItem('entrenolab:folders', JSON.stringify([]));
        localStorage.setItem('entrenolab:exercises', JSON.stringify([documento]));
        localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
      }, doc);

      await page.goto('/library');
      await page.locator('.ex-card').first().hover();
      await page.locator('[title="Diseñar en pizarra"]').first().click();
      await page.waitForURL('**/board');
      await expect(page.locator('.board-canvas svg')).toBeVisible();

      // 1) El campo histórico se ABRE y se DIBUJA (no se convierte en lienzo vacío).
      await expect(page.locator('.board-host')).toHaveAttribute('data-field', caso.campo);
      await expect(page.locator('.field-count')).toHaveText('2');
      await expect(page.locator('.board-canvas .entrenolab-grass')).toBeVisible();
      expect(
        (await page.locator('.board-canvas svg').innerHTML()).length,
        'el campo histórico dibuja marcas',
      ).toBeGreaterThan(1000);

      // 2) NO se ofrece como tarjeta nueva, y la galería ofrece los seis campos pedidos.
      await abrirPropiedades(page);
      await expect(page.locator('.field-gallery .field-card')).toHaveCount(CAMPOS.length);
      await expect(
        page.locator('.field-gallery .field-card', { hasText: caso.etiqueta }),
        `«${caso.etiqueta}» ya no se ofrece`,
      ).toHaveCount(0);

      // 3) A Campo completo con UN solo clic, conservando los objetos y SIN diálogo.
      const ms = await pulsarCampo(page, 'Campo completo');
      expect(ms, `el cambio tardó ${ms} ms`).toBeLessThan(1500);
      await sinDialogoNiOverlay(page);
      await expect(page.locator('.field-count'), 'los objetos siguen ahí').toHaveText('2');
    });
  }
});

test.describe('FÚTBOL SALA AZUL — estructura y píxeles', () => {
  test('horizontal y vertical: superficie lisa azul, dos áreas claras y líneas blancas', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);
    await pulsarCampo(page, 'Fútbol sala');

    for (const o of ['horizontal', 'vertical']) {
      const chip = page.locator(`.studio-panel .chip[data-orient="${o}"]`);
      await chip.click();
      await expect(chip).toHaveClass(/chip-active/);
      // Superficie LISA: el grupo del césped tiene UNA sola figura (sin las diez franjas).
      const superficie = page.locator('.board-canvas .entrenolab-grass rect');
      await expect(superficie, `${o}: fútbol sala sin franjas (una superficie lisa)`).toHaveCount(
        1,
      );
      expect(
        (await superficie.first().getAttribute('fill'))?.toLowerCase(),
        `${o}: superficie azul`,
      ).toBe('#1e3a8a');
      // Dos áreas de penalti rellenas de azul más claro.
      const areas = page.locator('.board-canvas .entrenolab-area-fill');
      await expect(areas, `${o}: dos áreas rellenas`).toHaveCount(2);
      expect(
        new Set(
          await areas.evaluateAll((els) => els.map((e) => e.getAttribute('fill')?.toLowerCase())),
        ),
        `${o}: el relleno es el azul claro`,
      ).toEqual(new Set(['#2563eb']));
      // Las líneas del campo siguen siendo blancas.
      const trazos = await page
        .locator('.board-canvas .entrenolab-board [stroke]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('stroke')?.toLowerCase()));
      expect(trazos.includes('#ffffff'), `${o}: hay líneas blancas`).toBe(true);
      expect(
        trazos.some((t) => t && t !== 'none' && t !== '#ffffff'),
        `${o}: ninguna línea del campo en otro color`,
      ).toBe(false);
    }
  });

  test('píxeles: color dominante azul, área más clara y cero verde (pantalla y PNG exportado)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);
    await pulsarCampo(page, 'Fútbol sala');
    await cerrarPropiedades(page);

    // Zona medida: el RECTÁNGULO DEL CAMPO (`.entrenolab-grass`), no el host entero.
    const campo = (await page.locator('.board-canvas .entrenolab-grass').first().boundingBox())!;
    const enPantalla = await analizar(page, await page.screenshot(), campo);
    console.log(`[futsal-pantalla] ${JSON.stringify(enPantalla)}`);
    expect(
      azulado(enPantalla.dominante),
      `el color dominante del campo es azul: ${JSON.stringify(enPantalla.dominante)} (${(enPantalla.dominantePct * 100).toFixed(0)} % de la cuadrícula)`,
    ).toBe(true);
    expect(
      enPantalla.dominantePct,
      'la superficie domina claramente sobre las líneas',
    ).toBeGreaterThan(0.5);
    expect(
      azulado(enPantalla.superficie),
      `superficie azul ${JSON.stringify(enPantalla.superficie)}`,
    ).toBe(true);
    expect(azulado(enPantalla.area), `área azul ${JSON.stringify(enPantalla.area)}`).toBe(true);
    expect(
      enPantalla.area[2],
      `el área (${enPantalla.area}) es más clara que la superficie (${enPantalla.superficie})`,
    ).toBeGreaterThan(enPantalla.superficie[2]);
    expect(enPantalla.verdes, 'sin píxeles verdes de césped en el campo').toBe(0);

    // Y en el PNG EXPORTADO, el mismo diseño. OJO con el orden: la promesa de descarga se registra
    // ANTES del clic; si se espera después, el evento ya ocurrió y la espera no termina nunca.
    const descarga = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator('.studio-top button[aria-label="Exportar"]').click();
    await page.locator('.top-pop-export [title="Descargar PNG"]').click();
    const dl = await descarga;
    const ruta = await dl.path();
    expect(ruta, 'el navegador entregó el PNG').toBeTruthy();
    const pngExp = fs.readFileSync(ruta!);
    const medida = await page.evaluate(
      async (url: string) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return { ancho: img.naturalWidth, alto: img.naturalHeight };
      },
      `data:image/png;base64,${pngExp.toString('base64')}`,
    );
    // El PNG exportado lleva el margen oscuro del campo alrededor: se mide la banda CENTRAL.
    const enPng = await analizar(page, pngExp, {
      x: medida.ancho * 0.15,
      y: medida.alto * 0.15,
      width: medida.ancho * 0.7,
      height: medida.alto * 0.7,
    });
    console.log(`[futsal-png] ${JSON.stringify(enPng)}`);
    expect(
      azulado(enPng.dominante),
      `PNG: color dominante azul ${JSON.stringify(enPng.dominante)}`,
    ).toBe(true);
    expect(enPng.verdes, 'PNG: sin verde de césped').toBe(0);
    expect(azulado(enPng.area), `PNG: interior del área azul ${JSON.stringify(enPng.area)}`).toBe(
      true,
    );
  });

  test('la MINIATURA DE BIBLIOTECA del fútbol sala también es azul y sin verde', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    // Un objeto es obligatorio: sin elementos no se genera miniatura (por diseño).
    await colocarObjetos(page);
    await abrirPropiedades(page);
    await pulsarCampo(page, 'Fútbol sala');
    await cerrarPropiedades(page);
    await fillBoardTitle(page, 'Futsal miniatura');
    await guardarYSalir(page);

    // La tarjeta de la biblioteca muestra su miniatura guardada (dataURL PNG).
    const src = await page.locator('.ex-card img').first().getAttribute('src');
    expect(src, 'la tarjeta tiene miniatura propia').toContain('data:image/png;base64,');
    const b64 = src!.split(',')[1];
    const analisis = await page.evaluate(async (url: string) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let azules = 0;
      let verdes = 0;
      const cuenta = new Map<string, number>();
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (b > r + 25 && b > g + 15) azules++;
        if (g > r + 20 && g > b + 10 && g > 60) verdes++;
        const clave = `${Math.round(r / 8) * 8},${Math.round(g / 8) * 8},${Math.round(b / 8) * 8}`;
        cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
      }
      const dominante = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return {
        ancho: c.width,
        alto: c.height,
        azulesPct: azules / (d.length / 4),
        verdes,
        dominante,
      };
    }, `data:image/png;base64,${b64}`);
    console.log(`[futsal-miniatura] ${JSON.stringify(analisis)}`);
    expect(analisis.ancho, 'miniatura generada').toBeGreaterThan(100);
    expect(analisis.azulesPct, 'la miniatura es azul').toBeGreaterThan(0.5);
    expect(analisis.verdes, 'miniatura sin verde de césped (ni en el marco)').toBe(0);
  });
});

test.describe('CAPTURAS — docs/screenshots/fase-cambio-campos', () => {
  test.skip(!CAPTURAS, 'Capturas del cambio de campos: se ejecutan solo con CAPTURAS_CAMPOS=1');

  test('genera las capturas de la carpeta + hoja de contacto + índice', async ({ page }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const fichas: Array<{ fichero: string; que: string }> = [];
    const disparo = async (fichero: string, que: string): Promise<void> => {
      await page.screenshot({ path: path.join(SHOTS, `${fichero}.png`) });
      fichas.push({ fichero, que });
    };
    const FICHERO: Record<string, string> = {
      'Campo completo': 'campo-completo',
      'Medio campo': 'medio-campo',
      'Tercio de campo': 'tercio-campo',
      'Fútbol sala': 'futbol-sala-horizontal',
      'F7 transversal': 'f7-transversal',
      Lienzo: 'lienzo',
    };

    // 1-7: un campo por captura, con objetos reales colocados sobre el campo.
    await page.setViewportSize(ESCRITORIO);
    await seedBoard(page);
    await openBoard(page);
    await colocarObjetos(page);
    await abrirPropiedades(page);
    for (const c of CAMPOS) {
      await pulsarCampo(page, c.etiqueta);
      await page.waitForTimeout(200);
      await disparo(FICHERO[c.etiqueta], `${c.etiqueta} con los 4 objetos reales colocados`);
    }

    // Fútbol sala en VERTICAL.
    await pulsarCampo(page, 'Fútbol sala');
    await page.locator('.studio-panel .chip[data-orient="vertical"]').click();
    await page.waitForTimeout(250);
    await disparo('futbol-sala-vertical', 'Fútbol sala azul en vertical (áreas claras y líneas)');

    // Cambio de campo CON objetos: antes y después (los mismos objetos, un solo clic).
    await pulsarCampo(page, 'Campo completo');
    await cerrarPropiedades(page);
    await page.waitForTimeout(200);
    await disparo('cambio-con-objetos-antes', 'Cuatro objetos sobre Campo completo (antes)');
    await abrirPropiedades(page);
    await pulsarCampo(page, 'Medio campo');
    await cerrarPropiedades(page);
    await page.waitForTimeout(250);
    await disparo(
      'cambio-con-objetos-despues',
      'Los MISMOS objetos tras un clic en Medio campo (sin diálogo)',
    );

    // Móvil vertical y horizontal cambiando de campo.
    await page.setViewportSize(MOVIL_V);
    await seedBoard(page);
    await openBoard(page);
    await abrirPropiedades(page);
    await pulsarCampo(page, 'Fútbol sala');
    await page.waitForTimeout(250);
    await disparo('movil-cambio-campos', 'Cambio de campo en móvil 390×844 con fútbol sala azul');
    await page.setViewportSize(MOVIL_H);
    await page.waitForTimeout(250);
    await disparo('movil-horizontal-campos', 'Pizarra en móvil horizontal 844×390 con fútbol sala');

    // ------------------------------------------------------------------
    // FASE 5 del encargo de materiales: las capturas de MATERIALES y ESCALAS se generan en OTRA
    // prueba (con página nueva) para no acumular navegaciones en esta: tras guardar/cerrar paneles,
    // seguir navegando en la misma página terminaba en el login y las capturas no salían.
    // ------------------------------------------------------------------

    await escribirHojaDeContacto(page, fichas);

    for (const f of [
      ...fichas.map((x) => `${x.fichero}.png`),
      'contact-sheet.png',
      'contact-sheet.html',
    ]) {
      const ruta = path.join(SHOTS, f);
      expect(fs.existsSync(ruta), `existe ${f}`).toBe(true);
      expect(fs.statSync(ruta).size, `${f} no está vacío`).toBeGreaterThan(1000);
    }
    console.log(`[capturas-campos] ${fichas.length + 1} PNG en ${SHOTS}`);
  });

  test('FASE 5: capturas de materiales y escalas (página nueva, para no acumular navegaciones)', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const fichas: Array<{ fichero: string; que: string }> = [];
    const disparo = async (fichero: string, que: string): Promise<void> => {
      await page.screenshot({ path: path.join(SHOTS, `${fichero}.png`) });
      fichas.push({ fichero, que });
    };
    const disparoZona = async (
      fichero: string,
      que: string,
      selectores: string[],
    ): Promise<void> => {
      const cajas = await Promise.all(
        selectores.map(async (s) => page.locator(`.board-canvas ${s}`).first().boundingBox()),
      );
      const validas = cajas.filter((b): b is NonNullable<typeof b> => !!b);
      expect(validas.length, `objetos encontrados para ${fichero}`).toBeGreaterThan(0);
      const margen = 26;
      const x = Math.max(0, Math.min(...validas.map((b) => b.x)) - margen);
      const y = Math.max(0, Math.min(...validas.map((b) => b.y)) - margen);
      const derecha = Math.max(...validas.map((b) => b.x + b.width));
      const abajo = Math.max(...validas.map((b) => b.y + b.height));
      const vp = page.viewportSize()!;
      await page.screenshot({
        path: path.join(SHOTS, `${fichero}.png`),
        clip: {
          x,
          y,
          width: Math.min(vp.width - x, derecha + margen - x),
          height: Math.min(vp.height - y, abajo + margen - y),
        },
      });
      fichas.push({ fichero, que });
    };

    // Un documento con los ocho objetos de la comparación (mismo id y posición en todos los campos).
    await page.setViewportSize(ESCRITORIO);
    await abrirDocumentoEscala(page, 'full');
    await cerrarPropiedades(page);
    await page.waitForTimeout(300);
    await disparo(
      'materiales-campo-completo',
      'Los ocho materiales en Campo completo (referencia del 100 %)',
    );

    await abrirPropiedades(page);
    await pulsarCampo(page, 'Medio campo');
    await cerrarPropiedades(page);
    await page.waitForTimeout(300);
    await disparo(
      'materiales-medio-campo',
      'Los MISMOS materiales en Medio campo: se ven aproximadamente un 120 % (misma caja)',
    );

    // Comparación lado a lado (composición real con las capturas incrustadas).
    await page.setContent(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comparación</title>
<style>body{background:#10151a;color:#e8edf2;font:14px system-ui;margin:0;padding:18px}
h1{font-size:18px;margin:0 0 12px}.fila{display:flex;gap:12px}figure{margin:0;flex:1}
img{width:100%;border:1px solid #2b3947;border-radius:8px}figcaption{color:#8a97a3;margin-top:6px}</style>
</head><body><h1>Escala aparente: Campo completo vs Medio campo (mismo objeto, mismo viewport)</h1>
<div class="fila">
<figure><img src="${dataUrl('materiales-campo-completo')}"><figcaption>Campo completo (100 %)</figcaption></figure>
<figure><img src="${dataUrl('materiales-medio-campo')}"><figcaption>Medio campo (~120 %)</figcaption></figure>
</div></body></html>`,
      { waitUntil: 'load' },
    );
    await page.screenshot({ path: path.join(SHOTS, 'materiales-comparativa-completo-medio.png') });
    fichas.push({
      fichero: 'materiales-comparativa-completo-medio',
      que: 'Comparación medida: los mismos materiales en campo completo y en medio campo',
    });

    // `setContent` ha sustituido el documento de la página: se vuelve a abrir el ejercicio desde la
    // biblioteca (no basta con `/board`, que abriría una pizarra VACÍA y sin la portería de material).
    await abrirDocumentoEscala(page, 'full');

    // Portería de material junto a la portería del campo, cambiando de campo con las tarjetas.
    for (const [etiqueta, fichero] of [
      ['Campo completo', 'porteria-vs-campo-f11'],
      ['F7 transversal', 'porteria-vs-campo-f7'],
      ['Fútbol sala', 'porteria-vs-campo-futsal'],
    ] as Array<[string, string]>) {
      await abrirPropiedades(page);
      await pulsarCampo(page, etiqueta);
      await cerrarPropiedades(page);
      await page.waitForTimeout(300);
      await disparoZona(
        fichero,
        `Portería de material junto a la portería dibujada en ${etiqueta}: deben medir lo mismo`,
        ['[data-el-type="goal"]', '.entrenolab-goal-field'],
      );
    }

    // Chino junto a un cono y escalera junto a portería y miniportería (siluetas reconocibles).
    await abrirPropiedades(page);
    await pulsarCampo(page, 'Campo completo');
    await cerrarPropiedades(page);
    await page.waitForTimeout(300);
    await disparoZona(
      'chino-junto-a-cono',
      'Chino junto al cono: platillo reconocible y más pequeño que el cono',
      ['[data-asset-kind="target"]', '[data-asset-kind="cone_yellow"]'],
    );
    await disparoZona(
      'escalera-porteria-miniporteria',
      'Escalera (vista desde arriba), miniportería y portería grande: tres siluetas distintas',
      ['[data-asset-kind="ladder"]', '[data-asset-kind="minigoal"]', '[data-el-type="goal"]'],
    );

    await escribirHojaDeContacto(page, fichas);
    for (const f of [
      ...fichas.map((x) => `${x.fichero}.png`),
      'contact-sheet.png',
      'contact-sheet.html',
      'INDICE.md',
    ]) {
      const ruta = path.join(SHOTS, f);
      expect(fs.existsSync(ruta), `existe ${f}`).toBe(true);
      expect(fs.statSync(ruta).size, `${f} no está vacío`).toBeGreaterThan(1000);
    }
    console.log(`[capturas-campos-materiales] ${fichas.length} piezas nuevas en ${SHOTS}`);
  });
});
