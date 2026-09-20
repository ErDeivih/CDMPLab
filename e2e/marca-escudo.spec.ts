import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * FASE 8A del encargo — ESCUDO con el exterior TRANSPARENTE.
 *
 * Problema: el recurso de marca era un JPG con fondo blanco CUADRADO y estaba referenciado en
 * shell, login, pizarra, favicon y apple-touch-icon. Sobre fondos oscuros se veía el cuadrado.
 *
 * Solución: a partir del escudo ORIGINAL del club (sin retocarlo ni redibujarlo) se recorta el
 * exterior siguiendo su círculo, con un margen transparente del ~4 %, y se exporta un PNG maestro
 * de 512×512 (más los iconos de pestaña). El recorte se calcula MIDIENDO el original: se busca la
 * caja del contenido (píxeles no blancos) y el círculo se ajusta a esa caja con un 3 % de holgura,
 * de modo que no se corta ninguna parte del círculo exterior.
 *
 * La generación solo se ejecuta a propósito (`GENERAR_ESCUDO=1`) para no reescribir binarios en
 * cada pasada de la suite; la VERIFICACIÓN de los ficheros generados se ejecuta siempre.
 */

const ORIGINAL = 'src/assets/brand/cdm-pizarrales-original.jpg';
const MAESTRO = 'src/assets/brand/cdm-pizarrales-escudo.png';
const ICONOS = [
  'public/favicon-32x32.png',
  'public/favicon-192x192.png',
  'public/apple-touch-icon.png',
];
/** Margen transparente exigido por el encargo (3–5 % del lado). */
const MARGEN = 0.04;

const RUTA_MAESTRO = path.resolve(MAESTRO);

/** Analiza el original y devuelve la caja del contenido (píxeles no blancos) y sus dimensiones. */
async function medirOriginal(page: Page) {
  const jpg = fs.readFileSync(path.resolve(ORIGINAL)).toString('base64');
  return page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width;
    let y0 = c.height;
    let x1 = -1;
    let y1 = -1;
    let contenido = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        // Fondo = blanco casi puro. Todo lo demás es escudo.
        if (r > 244 && g > 244 && b > 244) continue;
        contenido++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    return {
      anchoOriginal: c.width,
      altoOriginal: c.height,
      caja: { x0, y0, x1, y1, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 },
      contenido,
    };
  }, jpg);
}

/** Dibuja el escudo recortado en un canvas cuadrado del tamaño pedido y devuelve el data URL PNG. */
async function recortarCircular(page: Page, lado: number, ladoContenido: number) {
  const jpg = fs.readFileSync(path.resolve(ORIGINAL)).toString('base64');
  return page.evaluate(
    async ({ b64, lado, ladoContenido }: { b64: string; lado: number; ladoContenido: number }) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      const src = document.createElement('canvas');
      src.width = img.naturalWidth;
      src.height = img.naturalHeight;
      const sctx = src.getContext('2d')!;
      sctx.drawImage(img, 0, 0);
      const d = sctx.getImageData(0, 0, src.width, src.height).data;
      // Caja del contenido otra vez (el recorte y el análisis usan la MISMA definición de fondo).
      let x0 = src.width;
      let y0 = src.height;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const i = (y * src.width + x) * 4;
          if (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244) continue;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
      const ancho = x1 - x0 + 1;
      const alto = y1 - y0 + 1;
      const destino = document.createElement('canvas');
      destino.width = lado;
      destino.height = lado;
      const ctx = destino.getContext('2d')!;
      ctx.clearRect(0, 0, lado, lado);
      // El contenido se escala para caber EXACTAMENTE en `ladoContenido` conservando proporción.
      const escala = Math.min(ladoContenido / ancho, ladoContenido / alto);
      const w = ancho * escala;
      const h = alto * escala;
      const dx = (lado - w) / 2;
      const dy = (lado - h) / 2;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, x0, y0, ancho, alto, dx, dy, w, h);
      // Máscara CIRCULAR: el círculo circunscribe la caja del contenido con un 3 % de holgura,
      // así no se corta ninguna parte del círculo exterior del escudo.
      const radio = (Math.max(w, h) / 2) * 1.03;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.arc(lado / 2, lado / 2, radio, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      return { dataUrl: destino.toDataURL('image/png'), radio, dx, dy, w, h };
    },
    { b64: jpg, lado, ladoContenido },
  );
}

test.describe('FASE 8A — escudo con exterior transparente', () => {
  test('genera el escudo maestro y los iconos (solo con GENERAR_ESCUDO=1)', async ({ page }) => {
    test.skip(!process.env['GENERAR_ESCUDO'], 'Generación: se ejecuta solo con GENERAR_ESCUDO=1');
    await page.goto('/auth/login');
    const origen = await medirOriginal(page);
    console.log(
      `[escudo] original ${origen.anchoOriginal}×${origen.altoOriginal} caja=${JSON.stringify(origen.caja)}`,
    );
    const lado = 512;
    const ladoContenido = Math.round(lado * (1 - 2 * MARGEN));
    const maestro = await recortarCircular(page, lado, ladoContenido);
    fs.writeFileSync(RUTA_MAESTRO, Buffer.from(maestro.dataUrl.split(',')[1], 'base64'));
    for (const [fichero, tam] of [
      [ICONOS[0], 32],
      [ICONOS[1], 192],
      [ICONOS[2], 180],
    ] as Array<[string, number]>) {
      const icono = await recortarCircular(page, tam, Math.round(tam * (1 - 2 * MARGEN)));
      fs.writeFileSync(path.resolve(fichero), Buffer.from(icono.dataUrl.split(',')[1], 'base64'));
    }
    console.log(`[escudo] generado ${MAESTRO} (${lado}×${lado}) + ${ICONOS.join(', ')}`);
  });

  test('el escudo maestro no recorta el círculo, tiene margen y el exterior es transparente', async ({
    page,
  }) => {
    expect(fs.existsSync(RUTA_MAESTRO), `existe ${MAESTRO}`).toBe(true);
    await page.goto('/auth/login');
    const png = fs.readFileSync(RUTA_MAESTRO).toString('base64');
    const medido = await page.evaluate(async (b64: string) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const alfa = (x: number, y: number) => d[(y * c.width + x) * 4 + 3];
      const esquinas = [
        alfa(0, 0),
        alfa(c.width - 1, 0),
        alfa(0, c.height - 1),
        alfa(c.width - 1, c.height - 1),
      ];
      // Fondo del canvas: píxeles opacos FUERA del círculo (radio del círculo inscrito con margen).
      const cx = c.width / 2;
      const cy = c.height / 2;
      let fueraOpacos = 0;
      let opacos = 0;
      let minX = c.width;
      let maxX = -1;
      let minY = c.height;
      let maxY = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const a = alfa(x, y);
          if (a < 8) continue;
          opacos++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          // 1 px de tolerancia por el suavizado del borde circular.
          if (dist > Math.max(c.width, c.height) / 2 - 1) fueraOpacos++;
        }
      }
      return {
        ancho: c.width,
        alto: c.height,
        esquinas,
        fueraOpacos,
        opacos,
        caja: { minX, maxX, minY, maxY },
      };
    }, png);

    expect(medido.ancho, 'el maestro tiene al menos 512 de lado').toBeGreaterThanOrEqual(512);
    expect(medido.alto).toBe(medido.ancho);
    expect(
      medido.esquinas,
      'las CUATRO esquinas son transparentes (no queda el fondo blanco cuadrado)',
    ).toEqual([0, 0, 0, 0]);
    expect(
      medido.fueraOpacos,
      'ningún píxel opaco fuera del círculo (el exterior es transparente)',
    ).toBe(0);
    // Margen transparente de ~4 %: la caja del contenido no puede llegar al borde.
    const margenIzq = medido.caja.minX / medido.ancho;
    const margenDer = (medido.ancho - 1 - medido.caja.maxX) / medido.ancho;
    const margenSup = medido.caja.minY / medido.alto;
    const margenInf = (medido.alto - 1 - medido.caja.maxY) / medido.alto;
    for (const [nombre, m] of [
      ['izquierda', margenIzq],
      ['derecha', margenDer],
      ['arriba', margenSup],
      ['abajo', margenInf],
    ] as Array<[string, number]>) {
      expect(m, `margen transparente por ${nombre} entre el 3 % y el 8 %`).toBeGreaterThanOrEqual(
        0.03,
      );
      expect(m).toBeLessThanOrEqual(0.08);
    }

    // NO se ha recortado el escudo: se comparan los píxeles de contenido del original con los
    // opacos del maestro. Debe sobrevivir ~todo (el suavizado quita unos pocos del borde).
    const origen = await medirOriginal(page);
    const ratio = medido.opacos / origen.contenido;
    console.log(
      `[escudo] contenido original=${origen.contenido} opacos maestro=${medido.opacos} ratio=${ratio.toFixed(3)} caja=${JSON.stringify(medido.caja)}`,
    );
    expect(ratio, 'se conserva el escudo completo (no se recorta el círculo)').toBeGreaterThan(0.9);
  });

  test('shell, login y pizarra usan el escudo nuevo y ya no el JPG cuadrado', async ({ page }) => {
    const rutas = ['/auth/login', '/team', '/board'];
    const vistos: string[] = [];
    for (const ruta of rutas) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      const info = await page.evaluate(async () => {
        const imgs = [...document.querySelectorAll<HTMLImageElement>('img')].filter((i) =>
          /pizarrales|escudo/.test(i.getAttribute('src') ?? ''),
        );
        await Promise.all(
          imgs.map((i) =>
            i.complete
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  i.addEventListener('load', () => res(), { once: true });
                  i.addEventListener('error', () => res(), { once: true });
                }),
          ),
        );
        return imgs.map((i) => ({
          src: i.getAttribute('src') ?? '',
          completo: i.complete,
          ancho: i.naturalWidth,
          objectFit: getComputedStyle(i).objectFit,
        }));
      });
      expect(info.length, `${ruta}: se encontró el escudo`).toBeGreaterThan(0);
      for (const i of info) {
        vistos.push(`${ruta}→${i.src}`);
        expect(i.src, `${ruta}: usa el PNG nuevo, no el JPG`).toContain(
          'cdm-pizarrales-escudo.png',
        );
        expect(i.completo, `${ruta}: la imagen carga`).toBe(true);
        expect(i.ancho, `${ruta}: tiene tamaño real`).toBeGreaterThan(0);
        expect(['contain', 'scale-down'], `${ruta}: object-fit sin deformar`).toContain(
          i.objectFit,
        );
      }
    }
    console.log(`[escudo] referencias comprobadas: ${vistos.join(' | ')}`);

    // El favicon y el icono de iOS también son el PNG transparente.
    const head = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => ({
        rel: l.getAttribute('rel'),
        href: l.getAttribute('href'),
        type: l.getAttribute('type'),
      })),
    );
    for (const l of head) {
      expect(l.href, `${l.rel} apunta al PNG`).toContain('cdm-pizarrales-escudo.png');
      expect(l.type ?? 'image/png', `${l.rel} declara imagen PNG`).toContain('png');
    }
  });
});
