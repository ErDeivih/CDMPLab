// =============================================================
// FASE 4 del encargo de materiales — DIBUJOS RECONOCIBLES (vectoriales).
//
// El dueño dejó claro que las pruebas de proporciones no bastan: «solo validan proporciones y
// presencia; no demuestran que el dibujo represente correctamente el objeto». Estas pruebas miran la
// ESTRUCTURA del dibujo (qué formas hay, cuántas y de qué tamaño relativo), que es lo comprobable
// sin ojos: un chino tiene que ser un disco con aro y abertura central, una escalera tiene que tener
// DOS raíles y entre SEIS y OCHO peldaños, y la miniportería tiene que ser claramente más baja y
// compacta que la portería grande.
// =============================================================
import { describe, expect, it } from 'vitest';
import { renderBoardSvg } from './render';
import type { CanvasElement } from './models';

/** Extrae el grupo SVG del elemento indicado (el render lo marca con `data-el-type`). */
function grupo(campo: 'full' | 'futsal', el: CanvasElement): string {
  const svg = renderBoardSvg(campo, [el], {});
  const marca = el.assetKind ?? el.t;
  const porTipo = new RegExp(`<g [^>]*data-el-type="${el.t}"[^>]*>[\\s\\S]*?</g>`);
  const m = new RegExp(
    `<g [^>]*data-el-type="${el.t}"[^>]*data-asset-kind="${marca}"[^>]*>[\\s\\S]*?</g>`,
  );
  return (svg.match(m) ?? svg.match(porTipo) ?? [''])[0];
}

const rects = (g: string): Array<{ w: number; h: number; x: number; y: number }> =>
  [...g.matchAll(/<rect ([^>]*?)\/>/g)].map((m) => {
    const a = m[1];
    const n = (k: string): number => Number(new RegExp(`${k}="([\\d.eE+-]+)"`).exec(a)?.[1] ?? NaN);
    return { x: n('x'), y: n('y'), w: n('width'), h: n('height') };
  });

const elipses = (g: string): Array<{ rx: number; ry: number }> =>
  [...g.matchAll(/<ellipse [^>]*rx="([\d.]+)" ry="([\d.]+)"/g)].map((m) => ({
    rx: Number(m[1]),
    ry: Number(m[2]),
  }));

describe('FASE 4 — el CHINO es un platillo, no una raya', () => {
  const chino = (): string => grupo('full', { id: 'c', t: 'target', x: 0.5, y: 0.5, c: '#2c7be5' });

  it('tiene cuerpo redondo, aro, superficie interior y ABERTURA central', () => {
    const g = chino();
    const el = elipses(g);
    // Cuerpo + superficie + abertura + brillo/sombra: al menos cuatro elipses.
    expect(el.length, 'el chino se dibuja con varias elipses').toBeGreaterThanOrEqual(4);
    // El CUERPO es la elipse de mayor área (las demás son la abertura y la sombra, planas a propósito).
    const cuerpo = el.slice().sort((a, b) => b.rx * b.ry - a.rx * a.ry)[0];
    // La forma es REDONDA (ancho/alto ≤ 1,6), no una raya: la versión anterior medía 4,4 × 1,8
    // unidades (2,4:1) y por eso el dueño lo describió como «una raya/óvalo muy pequeño».
    expect(cuerpo.rx / cuerpo.ry, 'proporción de platillo (no de raya)').toBeLessThan(1.6);
    expect(cuerpo.rx / cuerpo.ry).toBeGreaterThan(1.2);
    // Aro oscuro + superficie del color elegido + abertura: hay al menos tres rellenos distintos.
    expect((g.match(/<ellipse/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // Es RECOLOREABLE: el color pedido aparece en el dibujo.
    expect(g).toContain('#2c7be5');
  });

  it('mide un 45-55 % del cono (rango visual real, no solo "menor que el cono")', () => {
    // CAMBIO DE CONTRATO (cierre del encargo de materiales): esta prueba solo exigía «menor que el
    // cono», y con ese margen el chino pasó midiendo ~30 %: en la pantalla del dueño salía de 10×8 px
    // frente a los 32×32 px del cono y lo describió «como un punto». Ahora se exige un RANGO REAL:
    // entre el 45 % y el 55 % de la anchura del cono, medido como lo mide el dueño y como lo mide la
    // suite E2E (`fase-ux-graficos.spec.ts`): caja visible contra caja visible.
    // Las dos medidas se hacen en el MISMO espacio (unidades del SVG, ya con su escala aplicada):
    // el chino dibuja 2 × rx dentro de su grupo `scale(s)` y el cono ocupa su caja `5,2 × size`.
    const g = chino();
    const escalaChino = Number(/scale\(([\d.]+)\)/.exec(g)?.[1] ?? 0);
    expect(escalaChino, 'el grupo del chino lleva su escala').toBeGreaterThan(0);
    const anchoChino = Math.max(...elipses(g).map((e) => e.rx)) * 2 * escalaChino;
    // El cono CONSERVA su PNG: se mide su imagen (caja 5,2 × size) en el SVG completo.
    const cono = renderBoardSvg(
      'full',
      [
        {
          id: 'k',
          t: 'cone',
          x: 0.5,
          y: 0.5,
          c: '#f6c945',
          asset: 'assets/tactical/cone-yellow.png',
          assetKind: 'cone_yellow',
        },
      ],
      {},
    );
    const anchoCono = Number(/<image [^>]*width="([\d.]+)"/.exec(cono)?.[1] ?? 0);
    expect(anchoCono, 'el cono se dibuja con su imagen ancha').toBeGreaterThan(0);
    expect(anchoCono, 'el chino sigue siendo menor que el cono').toBeGreaterThan(anchoChino);
    // Mismo margen que exige `fase-ux-graficos.spec.ts` en el navegador: la caja del cono son 3,12
    // unidades (32 px medidos en la suite) y el chino debe quedar entre el 45 % y el 55 % de ella.
    const proporcion = anchoChino / anchoCono;
    expect(
      proporcion,
      `el ancho del chino es el ${(proporcion * 100).toFixed(0)} % del cono (se pide 45-55 %)`,
    ).toBeGreaterThanOrEqual(0.45);
    expect(proporcion).toBeLessThanOrEqual(0.55);
  });
});

describe('FASE 4 — la ESCALERA es una vista desde arriba', () => {
  const escalera = (color?: string): string =>
    grupo('full', { id: 'l', t: 'ladder', x: 0.5, y: 0.5, c: color ?? '#e8edf2' });

  it('tiene DOS raíles y SIETE peldaños (entre 6 y 8 como pide el encargo)', () => {
    const r = rects(escalera());
    // Raíles: dos barras largas HORIZONTALES (más anchas que altas y de la máxima longitud).
    const largos = r.filter((x) => x.w > 4 && x.w > x.h * 3);
    expect(largos.length, 'dos raíles longitudinales').toBe(2);
    // Peldaños: barras transversales (más altas que anchas) repartidas a lo largo.
    const peldaños = r.filter((x) => x.h > 1.5 && x.h < 2.5 && x.w < 0.4);
    expect(peldaños.length, 'entre 6 y 8 peldaños').toBeGreaterThanOrEqual(6);
    expect(peldaños.length).toBeLessThanOrEqual(8);
  });

  it('su silueta es claramente ALARGADA (no cuadrada) y se puede pintar en amarillo', () => {
    const r = rects(escalera());
    const ancho = Math.max(...r.map((x) => x.x + x.w)) - Math.min(...r.map((x) => x.x));
    const alto = Math.max(...r.map((x) => x.y + x.h)) - Math.min(...r.map((x) => x.y));
    // Se dibuja ANCHA (eje largo horizontal), como el PNG anterior: así conserva la orientación de
    // siempre y al girarla 90° queda alta.
    expect(ancho / alto, 'relación largo/ancho ≥ 2').toBeGreaterThanOrEqual(2);
    // La variante amarilla usa el color elegido.
    expect(escalera('#f6c945')).toContain('#f6c945');
  });
});

describe('FASE 4 — PORTERÍA, MINIPORTERÍA y ESCALERA tienen siluetas distintas', () => {
  const porteria = (): string => grupo('full', { id: 'g', t: 'goal', x: 0.5, y: 0.5 });
  const mini = (): string =>
    grupo('full', { id: 'm', t: 'minigoal', x: 0.5, y: 0.5, c: '#e8edf2' });
  const escalera = (): string => grupo('full', { id: 'l', t: 'ladder', x: 0.5, y: 0.5 });

  it('la miniportería es BAJA y COMPACTA, y no se confunde con la portería grande', () => {
    const rMini = rects(mini());
    const anchoMini = Math.max(...rMini.map((x) => x.x + x.w)) - Math.min(...rMini.map((x) => x.x));
    const altoMini = Math.max(...rMini.map((x) => x.y + x.h)) - Math.min(...rMini.map((x) => x.y));
    const rPort = rects(porteria());
    const anchoPort = Math.max(...rPort.map((x) => x.x + x.w)) - Math.min(...rPort.map((x) => x.x));
    const altoPort = Math.max(...rPort.map((x) => x.y + x.h)) - Math.min(...rPort.map((x) => x.y));
    // La miniportería es COMPACTA: menos de la mitad de ancho que la grande y claramente más baja
    // (medido: 0,42 de ancho y 0,50 de alto tras bajar su altura de 1,0 a 0,85 unidades en el cierre
    // del encargo de materiales).
    expect(anchoMini / anchoPort, 'anchura de miniportería vs portería').toBeLessThan(0.5);
    expect(altoMini / altoPort, 'altura de miniportería vs portería').toBeLessThan(0.65);
    // Y es más ANCHA que alta (portería), no alargada (escalera).
    expect(anchoMini / altoMini).toBeGreaterThan(1.5);
    expect(anchoMini / altoMini).toBeLessThan(2.6);
  });

  it('las tres figuras son diferentes entre sí (no comparten silueta)', () => {
    const p = porteria();
    const m = mini();
    const e = escalera();
    expect(p).not.toBe(m);
    expect(p).not.toBe(e);
    expect(m).not.toBe(e);
    // La escalera tiene MUCHOS peldaños transversales (barras altas y estrechas); la portería solo
    // su larguero (una barra ancha y baja, forma distinta).
    expect(
      rects(e).filter((r) => r.h > 1.5 && r.h < 2.5 && r.w < 0.4).length,
    ).toBeGreaterThanOrEqual(6);
    expect(
      rects(p).filter((r) => r.h > 1.5 && r.h < 2.5 && r.w < 0.4).length,
      'la portería solo tiene sus dos postes con esa forma (peldaños: 6-8 en la escalera)',
    ).toBeLessThanOrEqual(2);
    // La miniportería tiene una BARRA DE BASE que sobresale del marco; la portería no tiene ninguna
    // pieza más ancha que su propio fondo de red.
    const anchoDe = (g: string): number =>
      Math.max(...rects(g).map((r) => r.x + r.w)) - Math.min(...rects(g).map((r) => r.x));
    const anchoFondoMini = rects(m).filter((r) => r.h > 0.4)[0].w;
    expect(anchoDe(m), 'la base sobresale del fondo de la miniportería').toBeGreaterThan(
      anchoFondoMini,
    );
    expect(anchoDe(p), 'la portería no tiene base que sobresalga').toBeLessThanOrEqual(
      rects(p).filter((r) => r.h > 1)[0].w + 0.001,
    );
  });
});

describe('FASE 4 — un PNG antiguo NO puede volver a pintar estos materiales', () => {
  it('escalera, miniportería, chino y portería se dibujan en vector aunque el documento traiga asset', () => {
    // Compatibilidad: los documentos antiguos guardaron el PNG de estos materiales. El render los
    // pinta vectoriales igual (lista `SIEMPRE_VECTOR`), así que no reaparece el dibujo ilegible.
    const conAsset: CanvasElement[] = [
      {
        id: 'l',
        t: 'ladder',
        x: 0.2,
        y: 0.3,
        asset: 'assets/tactical/ladder.png',
        assetKind: 'ladder',
      },
      {
        id: 'm',
        t: 'minigoal',
        x: 0.4,
        y: 0.3,
        asset: 'assets/tactical/minigoal.png',
        assetKind: 'minigoal',
      },
      {
        id: 'c',
        t: 'target',
        x: 0.6,
        y: 0.3,
        asset: 'assets/tactical/target.png',
        assetKind: 'target',
      },
    ];
    const svg = renderBoardSvg('full', conAsset, {});
    expect(svg.includes('<image'), 'ningún material de estos usa <image>').toBe(false);
    // Y el cono, que sí conserva su PNG, sigue usándolo (control: no se ha desactivado todo).
    const conCono = renderBoardSvg(
      'full',
      [
        {
          id: 'k',
          t: 'cone',
          x: 0.5,
          y: 0.5,
          asset: 'assets/tactical/cone-yellow.png',
          assetKind: 'cone_yellow',
        },
      ],
      {},
    );
    expect(conCono).toContain('<image');
  });

  it('jugador y balón se dibujan un 10 % más pequeños en TODOS los campos, y el resto no cambia', () => {
    // CAMBIO DE CONTRATO VISUAL (encargo del dueño, 23/09/2026, a partir del aviso de un
    // colaborador: «los jugadores muy gordos»):
    //   · jugador y balón se reducen un 10 % → miden 9/10 de un material que NO se reduce;
    //   · el número y el nombre viajan DENTRO del grupo escalado, así que encogen en la MISMA
    //     proporción sin tocar sus tamaños por separado (lo pidió así);
    //   · los demás materiales (aquí un cono) conservan su tamaño;
    //   · vale para los seis campos, no solo para el campo completo.
    //
    // El 0,9 va escrito AQUÍ a propósito (no se lee de `PLAYER_BALL_SIZE_FACTOR`): si el factor
    // cambiara, la prueba tiene que fallar y obligar a decidir si el cambio de tamaño es
    // intencionado. Con la constante dentro de la expectativa, la prueba pasaría con cualquier
    // valor (comprobado: pasaba con el factor a 1) y no vigilaría nada.
    const REFERENCIA = 0.9;
    // Los tres con el MISMO `size` explícito, para que la comparación no dependa del tamaño base
    // que cada tipo tenga por defecto: solo se está midiendo la reducción pedida.
    const elementos: CanvasElement[] = [
      { id: 'p', t: 'player', x: 0.5, y: 0.5, n: 10, size: 0.5 },
      { id: 'b', t: 'ball', x: 0.3, y: 0.5, size: 0.5 },
      { id: 'c', t: 'cone', x: 0.7, y: 0.5, size: 0.5 },
    ];
    for (const campo of ['full', 'half', 'third', 'futsal', 'f7', 'blank'] as const) {
      const svg = renderBoardSvg(campo, elementos, {});
      // El render emite un `scale(...)` por elemento, en el orden de la lista.
      const escalas = [...svg.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
      expect(escalas, `tres elementos → tres escalas en ${campo}`).toHaveLength(3);
      const [jugador, balon, cono] = escalas;
      expect(jugador, `jugador en ${campo}: 90 % del material de referencia`).toBeCloseTo(
        cono * REFERENCIA,
        5,
      );
      expect(balon, `el balón se reduce como el jugador en ${campo}`).toBeCloseTo(
        cono * REFERENCIA,
        5,
      );
    }
  });
});
