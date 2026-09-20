import { describe, expect, it } from 'vitest';
import {
  fallbackVectorialDeAsset,
  hrefsDeAssets,
  inlineSvgAssets,
  tieneRefsExternas,
  type Fetcher,
} from './asset-inline';

/**
 * FASE 1 del encargo — la miniatura debe ser AUTOCONTENIDA **y no puede hacer desaparecer un
 * material**.
 *
 * Historial de las dos correcciones (las dos medidas en el navegador):
 *  1. Al principio, un asset que no se podía leer dejaba el `href` relativo en el SVG exportado:
 *     la miniatura salía con 35 colores en vez de 70 (el material desaparecía) y quedaba una
 *     referencia externa. Se corrigió incrustando siempre un data URL.
 *  2. Esa primera corrección usaba un PNG TRANSPARENTE de 1×1, que conseguía `naturalWidth > 0`
 *     pero seguía haciendo desaparecer el material: una miniatura que cambia un cono por
 *     transparencia NO es correcta (revisión externa del informe). Ahora se dibuja un FALLBACK
 *     VECTORIAL OPACO —triángulo del color del cono, rectángulo redondeado para el resto— en la
 *     misma caja que la imagen, así que la posición del material sigue representada.
 */

const svgConImagen = (href: string, comilla = '"') =>
  `<svg class="entrenolab-board"><image ${
    comilla === '"' ? 'href' : 'xlink:href'
  }=${comilla}${href}${comilla} x="10" y="20" width="6" height="8"/></svg>`;

const okFetcher =
  (bytes = [1, 2, 3, 4]): Fetcher =>
  async () => ({
    ok: true,
    blob: async () => new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
  });

const failFetcher: Fetcher = async () => {
  throw new Error('sin red');
};

/** No debe aparecer una imagen transparente ni un elemento vacío en el resultado. */
function esOpaco(svg: string): boolean {
  if (/transparent/i.test(svg)) return false;
  // El fallback debe tener un `fill` con color real (no 'none' ni 'transparent').
  const fallback = /data-asset-fallback="1"[^>]*>.*?fill="([^"]+)"/.exec(svg);
  return !!fallback && fallback[1] !== 'none' && !/transparent/i.test(fallback[1]);
}

describe('inlineSvgAssets (autocontención de la miniatura)', () => {
  it('incrusta el PNG como data URL base64 cuando el asset se puede leer', async () => {
    const out = await inlineSvgAssets(svgConImagen('assets/tactical/cone-red.png'), {
      fetcher: okFetcher(),
      avisar: () => undefined,
    });
    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toContain('assets/tactical/cone-red.png');
    expect(tieneRefsExternas(out), 'no queda ninguna referencia externa').toBe(false);
  });

  it('si el asset FALLA dibuja un fallback VECTORIAL opaco (nunca transparencia) en la misma caja', async () => {
    const avisos: string[] = [];
    const out = await inlineSvgAssets(svgConImagen('assets/tactical/cone-yellow.png'), {
      fetcher: failFetcher,
      avisar: (m) => avisos.push(m),
    });
    // Sin referencias externas…
    expect(out).not.toContain('assets/tactical/');
    expect(tieneRefsExternas(out)).toBe(false);
    // …y sin transparencia: hay un fallback con relleno opaco y en la caja de la imagen.
    expect(out).toContain('data-asset-fallback="1"');
    expect(esOpaco(out), 'el fallback no puede ser transparente ni quedar vacío').toBe(true);
    const fallback = /data-asset-fallback="1">(.*?)<\/g>/s.exec(out)![1];
    expect(fallback, 'el cono se dibuja como triángulo').toContain('<polygon');
    expect(fallback, 'usa el color del cono amarillo').toContain('#f6c945');
    // Misma caja que la imagen sustituida: x=10, y=20, ancho=6, alto=8 → base en y+h=28 y vértice
    // en y=20, de x=10 a x=16. (La primera versión de esta aserción esperaba «20,28», que era una
    // coordenada inventada por mí: el error estaba en la prueba, no en el fallback.)
    expect(fallback).toContain('10,28');
    expect(fallback).toContain('16,28');
    expect(fallback, 'el vértice superior está en y=20 (el `y` de la imagen)').toContain('13,20');
    // El aviso NO se silencia: hay un motivo registrado.
    expect(avisos.join(' ')).toContain('sin red');
  });

  it('un material que no es un cono usa un bloque redondeado opaco, no un triángulo', async () => {
    const out = await inlineSvgAssets(svgConImagen('assets/tactical/ladder.png'), {
      fetcher: failFetcher,
      avisar: () => undefined,
    });
    expect(out).toContain('<rect');
    expect(out).not.toContain('<polygon');
    expect(esOpaco(out)).toBe(true);
  });

  it('un fallo NO se cachea: si el asset se recupera, la siguiente vez se incrusta de verdad', async () => {
    let falla = true;
    const aVeces: Fetcher = async () => {
      if (falla) throw new Error('sin red');
      return {
        ok: true,
        blob: async () => new Blob([new Uint8Array([5, 5])], { type: 'image/png' }),
      };
    };
    const t = svgConImagen('assets/tactical/hurdle.png');
    const primera = await inlineSvgAssets(t, { fetcher: aVeces, avisar: () => undefined });
    expect(primera).toContain('data-asset-fallback="1"');
    falla = false;
    const segunda = await inlineSvgAssets(t, { fetcher: aVeces, avisar: () => undefined });
    expect(segunda, 'el fallo transitorio no puede quedar cacheado para siempre').not.toContain(
      'data-asset-fallback="1"',
    );
    expect(segunda).toContain('data:image/png;base64,');
  });

  it('acepta el formato histórico con barra inicial, comillas simples y xlink:href', async () => {
    const urls: string[] = [];
    const espia: Fetcher = async (url) => {
      urls.push(url);
      return {
        ok: true,
        blob: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }),
      };
    };
    const out = await inlineSvgAssets(
      svgConImagen('/assets/tactical/flag.png', "'") + svgConImagen('assets/tactical/net.png'),
      { fetcher: espia, avisar: () => undefined },
    );
    expect(out).not.toContain('assets/tactical/');
    expect(tieneRefsExternas(out)).toBe(false);
    // La barra inicial se normaliza para que el `<base href>` del despliegue mande.
    expect(urls.some((u) => u.endsWith('assets/tactical/flag.png'))).toBe(true);
    expect(urls.some((u) => u.startsWith('/'))).toBe(false);
  });

  it('cachea los aciertos: el mismo asset repetido no se descarga dos veces', async () => {
    let llamadas = 0;
    const contando: Fetcher = async () => {
      llamadas++;
      return {
        ok: true,
        blob: async () => new Blob([new Uint8Array([7])], { type: 'image/png' }),
      };
    };
    const out = await inlineSvgAssets(
      svgConImagen('assets/tactical/cone-blue.png') + svgConImagen('assets/tactical/cone-blue.png'),
      { fetcher: contando, avisar: () => undefined },
    );
    expect(llamadas).toBe(1);
    expect(out).not.toContain('assets/tactical/');
  });

  it('un SVG sin assets no se toca', async () => {
    const sinAssets = '<svg class="entrenolab-board"><circle r="4"/></svg>';
    await expect(inlineSvgAssets(sinAssets, { fetcher: failFetcher })).resolves.toBe(sinAssets);
  });

  it('el fallback vectorial es determinista y conserva la caja (función pura)', () => {
    const tag = '<image href="assets/tactical/cone-blue.png" x="1" y="2" width="4" height="4"/>';
    const a = fallbackVectorialDeAsset(tag, 'assets/tactical/cone-blue.png');
    const b = fallbackVectorialDeAsset(tag, 'assets/tactical/cone-blue.png');
    expect(a).toBe(b);
    expect(a).toContain('polygon');
    expect(a).toContain('#2c7be5');
    // Los hrefs siguen siendo detectables para diagnóstico.
    expect(hrefsDeAssets(svgConImagen('assets/tactical/cone-red.png'))).toEqual([
      'assets/tactical/cone-red.png',
    ]);
  });
});
