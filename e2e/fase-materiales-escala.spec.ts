// =============================================================
// ESCALA DE MATERIALES POR CAMPO — medición real en píxeles.
//
// QUÉ SE MIDE: el tamaño APARENTE (px) de cada objeto en el mismo viewport, con el mismo objeto y
// sin zoom (encuadre neutro), campo por campo. Es la única forma honesta de hablar de «se ve más
// grande»: la escala del modelo (`size`) no cambia, lo que cambia es cuántos píxeles ocupa.
//
// Se mide con `getBoundingClientRect()` del grupo del objeto en el SVG, así que incluye el dibujo
// real (PNG con su transparencia o vector), no una caja teórica.
// =============================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';

const SALIDA = 'docs/screenshots/fase-escala-materiales';
fs.mkdirSync(SALIDA, { recursive: true });

/** Los seis campos visibles, en el orden del encargo (la tarjeta del tercio se llama
 *  «Tercio de campo» en la interfaz). */
const CAMPOS: Array<{ etiqueta: string; id: string }> = [
  { etiqueta: 'Campo completo', id: 'full' },
  { etiqueta: 'Medio campo', id: 'half' },
  { etiqueta: 'Tercio de campo', id: 'third' },
  { etiqueta: 'Fútbol sala', id: 'futsal' },
  { etiqueta: 'F7 transversal', id: 'f7' },
  { etiqueta: 'Lienzo', id: 'blank' },
];

/** Objetos medidos: selector estable en el SVG → nombre legible. */
const OBJETOS: Array<{ nombre: string; selector: string }> = [
  { nombre: 'jugador', selector: '[data-el-type="player"]' },
  { nombre: 'cono', selector: '[data-asset-kind="cone_yellow"]' },
  { nombre: 'chino', selector: '[data-asset-kind="target"]' },
  { nombre: 'escalera', selector: '[data-asset-kind="ladder"]' },
  { nombre: 'miniporteria', selector: '[data-asset-kind="minigoal"]' },
  { nombre: 'porteria', selector: '[data-el-type="goal"]' },
  { nombre: 'maniqui', selector: '[data-asset-kind="mannequin"]' },
  { nombre: 'balon', selector: '[data-asset-kind="ball_football"]' },
];

/** Documento con los ocho objetos repartidos (mismas ids y coordenadas en todos los campos). */
const ELEMENTOS = [
  { id: 'e1', t: 'player', x: 0.18, y: 0.25, c: '#1a73e8' },
  {
    id: 'e2',
    t: 'cone',
    x: 0.38,
    y: 0.25,
    c: '#f6c945',
    size: 1.0,
    asset: 'assets/tactical/cone-yellow.png',
    assetKind: 'cone_yellow',
  },
  {
    id: 'e3',
    t: 'target',
    x: 0.58,
    y: 0.25,
    c: '#2c7be5',
    size: 0.62,
    asset: '',
    assetKind: 'target',
  },
  {
    id: 'e4',
    t: 'ladder',
    x: 0.8,
    y: 0.25,
    c: '#e8edf2',
    size: 1.6,
    asset: 'assets/tactical/ladder.png',
    assetKind: 'ladder',
  },
  {
    id: 'e5',
    t: 'minigoal',
    x: 0.18,
    y: 0.65,
    c: '#e8edf2',
    size: 1.45,
    asset: 'assets/tactical/minigoal.png',
    assetKind: 'minigoal',
  },
  {
    id: 'e6',
    t: 'goal',
    x: 0.45,
    y: 0.65,
    c: '#ffffff',
    size: 1.6,
    asset: '',
    assetKind: 'goal',
  },
  {
    id: 'e7',
    t: 'mannequin',
    x: 0.7,
    y: 0.65,
    c: '#e8edf2',
    size: 1.35,
    asset: 'assets/tactical/mannequin.png',
    assetKind: 'mannequin',
  },
  {
    id: 'e8',
    t: 'ball',
    x: 0.88,
    y: 0.65,
    c: '#ffffff',
    size: 1.5,
    asset: 'assets/tactical/ball.png',
    assetKind: 'ball_football',
  },
];

async function abrirDocumento(page: Page, field: string): Promise<void> {
  await page.addInitScript(
    ([campo, elementos]: [string, unknown[]]) => {
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
            id: 'esc-1',
            teamId: 't1',
            folderId: null,
            title: 'Escalas',
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
              field: campo,
              orientation: 'horizontal',
              frames: [{ duration: 1000, elements: elementos }],
              grass: 'stripes',
            },
            thumbnail: null,
            savedAt: '2026-01-01T10:00:00.000Z',
          },
        ]),
      );
      localStorage.setItem('entrenolab:sessions', JSON.stringify([]));
    },
    [field, ELEMENTOS] as [string, unknown[]],
  );
  await page.goto('/library');
  await page.locator('.ex-card').first().hover();
  await page.locator('[title="Diseñar en pizarra"]').first().click();
  await page.waitForURL('**/board');
  await expect(page.locator('.board-canvas svg')).toBeVisible();
  await expect(page.locator('.board-host')).toHaveAttribute('data-field', field);
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
  await expect(page.locator('.studio-panel .field-gallery')).toBeVisible();
}

async function cambiarCampo(page: Page, etiqueta: string, id: string): Promise<void> {
  await abrirPropiedades(page);
  await page.locator('.field-gallery .field-card', { hasText: etiqueta }).first().click();
  await expect(page.locator('.board-host')).toHaveAttribute('data-field', id);
  await page.waitForTimeout(120);
}

/** Tamaño en px de cada objeto del tablero + la anchura de la portería dibujada en el campo. */
async function medir(
  page: Page,
): Promise<
  Record<string, { w: number; h: number }> & { porteriaCampo?: { w: number; h: number } }
> {
  return page.evaluate((objetos: Array<{ nombre: string; selector: string }>) => {
    const salida: Record<string, { w: number; h: number }> = {};
    for (const o of objetos) {
      const el = document.querySelector(`.board-canvas ${o.selector}`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      salida[o.nombre] = { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    }
    const campo = document.querySelector('.board-canvas .entrenolab-goal-field');
    if (campo) {
      const r = campo.getBoundingClientRect();
      salida['porteriaCampo'] = {
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      };
    }
    return salida;
  }, OBJETOS);
}

test.describe('ESCALA DE MATERIALES — medición por campo', () => {
  test('mide el tamaño aparente de cada objeto en los seis campos', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await abrirDocumento(page, 'full');

    const medidas: Record<string, Record<string, { w: number; h: number }>> = {};
    for (const campo of CAMPOS) {
      await cambiarCampo(page, campo.etiqueta, campo.id);
      medidas[campo.id] = await medir(page);
      console.log(`[escala] ${campo.id}: ${JSON.stringify(medidas[campo.id])}`);
    }

    // Informe legible: ratio de cada objeto respecto a Campo completo (mismo viewport, mismo objeto).
    const lineas: string[] = [];
    for (const o of OBJETOS) {
      const base = medidas['full']?.[o.nombre];
      const fila = CAMPOS.map((c) => {
        const m = medidas[c.id]?.[o.nombre];
        if (!m || !base) return `${c.id}=—`;
        return `${c.id}=${(m.w / base.w).toFixed(2)}`;
      });
      lineas.push(`${o.nombre}: ${fila.join(' · ')}`);
    }
    console.log(`[escala] ratios (ancho, base = campo completo):\n  ${lineas.join('\n  ')}`);
    fs.writeFileSync(
      `${SALIDA}/medidas.json`,
      JSON.stringify({ medidas, ratios: lineas }, null, 2),
      'utf8',
    );

    // Sanidad mínima: los ocho objetos se dibujan en todos los campos (y la portería del campo se
    // puede medir al menos en los campos que la tienen).
    for (const campo of CAMPOS) {
      for (const o of OBJETOS) {
        expect(medidas[campo.id]?.[o.nombre], `${o.nombre} dibujado en ${campo.id}`).toBeTruthy();
      }
    }
  });

  test('la escala aparente de los materiales sigue la POLÍTICA pedida por el dueño', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await abrirDocumento(page, 'full');

    const medidas: Record<string, Record<string, { w: number; h: number }>> = {};
    for (const campo of CAMPOS) {
      await cambiarCampo(page, campo.etiqueta, campo.id);
      medidas[campo.id] = await medir(page);
    }

    // Bandas pedidas (en píxeles, mismo viewport y mismo objeto). La PORTERÍA se excluye de esta
    // tabla: es la excepción de la FASE 3 (tamaño reglamentario del campo) y se comprueba aparte.
    const POLITICA: Array<{ campo: string; min: number; max: number }> = [
      { campo: 'full', min: 1.0, max: 1.0 },
      { campo: 'half', min: 1.15, max: 1.25 },
      { campo: 'third', min: 1.2, max: 1.35 },
      { campo: 'futsal', min: 1.1, max: 1.25 },
      { campo: 'f7', min: 1.1, max: 1.25 },
      // Lienzo: comportamiento ESTABLE y documentado = mismo tamaño aparente que campo completo.
      { campo: 'blank', min: 0.95, max: 1.05 },
    ];
    const informes: string[] = [];
    for (const p of POLITICA) {
      for (const o of OBJETOS.filter((x) => x.nombre !== 'porteria')) {
        const base = medidas['full'][o.nombre].w;
        const valor = medidas[p.campo][o.nombre].w;
        const ratio = valor / base;
        informes.push(`${o.nombre}@${p.campo}=${ratio.toFixed(3)}`);
        expect(
          ratio,
          `${o.nombre} en ${p.campo}: ${valor} px vs ${base} px en campo completo → ${(ratio * 100).toFixed(0)} % (se pide ${(p.min * 100).toFixed(0)}-${(p.max * 100).toFixed(0)} %)`,
        ).toBeGreaterThanOrEqual(p.min - 0.005);
        expect(ratio).toBeLessThanOrEqual(p.max + 0.005);
      }
    }
    console.log(`[escala] ratios medidos: ${informes.join(' · ')}`);
    fs.writeFileSync(
      `${SALIDA}/ratios.json`,
      JSON.stringify({ medidas, informes }, null, 2),
      'utf8',
    );
  });

  test('la portería de MATERIAL coincide con la portería dibujada en el campo (0,90-1,10)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await abrirDocumento(page, 'full');

    for (const campo of CAMPOS.filter((c) => c.id !== 'blank')) {
      await cambiarCampo(page, campo.etiqueta, campo.id);
      // Horizontal y vertical: el criterio se comprueba en las dos orientaciones.
      for (const orient of ['horizontal', 'vertical'] as const) {
        const chip = page.locator(`.studio-panel .chip[data-orient="${orient}"]`);
        if (await chip.isVisible().catch(() => false)) {
          await chip.click();
          await page.waitForTimeout(150);
          await expect(chip).toHaveClass(/chip-active/);
        }
        const m = await medir(page);
        // Se compara la BOCA de la portería (distancia entre postes), que es la dimensión mayor en
        // las dos figuras: en el campo la portería se dibuja perpendicular (su boca va a lo largo de
        // un eje u otro según la orientación) y el material la dibuja de frente.
        const bocaMaterial = Math.max(m['porteria']?.w ?? 0, m['porteria']?.h ?? 0);
        const bocaCampo = Math.max(m['porteriaCampo']?.w ?? 0, m['porteriaCampo']?.h ?? 0);
        expect(bocaCampo, `portería dibujada en ${campo.id}/${orient}`).toBeGreaterThan(0);
        const ratio = bocaMaterial / bocaCampo;
        console.log(
          `[porteria] ${campo.id}/${orient}: material=${bocaMaterial} px campo=${bocaCampo} px ratio=${ratio.toFixed(3)}`,
        );
        expect(
          ratio,
          `boca portería-material / boca portería-campo en ${campo.id}/${orient}: ${bocaMaterial} / ${bocaCampo} = ${ratio.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(0.9);
        expect(ratio).toBeLessThanOrEqual(1.1);
      }
      // Se deja en horizontal para el siguiente campo.
      const chipH = page.locator('.studio-panel .chip[data-orient="horizontal"]');
      if (await chipH.isVisible().catch(() => false)) await chipH.click();
    }
  });
});
