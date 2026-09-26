import { describe, expect, it } from 'vitest';
import {
  renderBoardSvg,
  hitTestElement,
  textColor,
  boardGeometry,
  screenToNorm,
  wrapTextForBox,
  autoTextBoxH,
  textLayoutForBox,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_W,
  DEFAULT_TEXT_H,
  HostRect,
  materialSize,
  materialHitHalfExtents,
  MATERIAL_BOX,
  normalizedToPct,
  pctToNormalized,
  parseLocalizedNumber,
  clampNorm,
  roundToOne,
  fitTextToContent,
  Geometry,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_ELEMENT_COLOR,
  arrowHeadSize,
  ARROW_HEAD_FACTOR,
  svgZigzag,
  screenPxToNormTolerance,
  BOARD_CANON_RECT,
  DASH_PATTERN,
} from './render';
import { CanvasElement } from './models';
import { MATERIAL_SIZE_RATIO, TACTICAL_SIZE } from './tactic-assets';
import { fieldGeometry, F7_LINE_COLOR, OFFICIAL_PITCH_COLOR, goalBoxUnits } from './field';

function mkPlayer(id: string, x: number, y: number, n = 9): CanvasElement {
  return { id, t: 'player', x, y, n, c: '#1a73e8', side: 'own' };
}

// Rect canónico (largo→X, ancho→Y) usado por el render y por screenToNorm.
const HORIZONTAL_RECT = { x: 4, y: 10, w: 92, h: 92 / (105 / 68) };

/** Forward norm→pantalla que replica el render real: letterboxing del SVG
 *  + transform `translate(pan) scale(zoom)` con origen en el centro del host. */
function normToScreenPoint(
  nx: number,
  ny: number,
  host: HostRect,
  g: Geometry,
  panX: number,
  panY: number,
  zoom: number,
): { x: number; y: number } {
  const s = Math.min(host.width / g.vbW, host.height / g.vbH);
  const offX = (host.width - g.vbW * s) / 2;
  const offY = (host.height - g.vbH * s) / 2;
  const cxg = nx * g.rect.w + g.rect.x;
  const cyg = ny * g.rect.h + g.rect.y;
  let vbX: number;
  let vbY: number;
  if (g.vertical) {
    // (x,y) → (Tx - y, x) en el wrapper rotate(90)
    const Tx = g.vbW / 2 + (g.rect.y + g.rect.h / 2);
    vbX = Tx - cyg;
    vbY = cxg;
  } else {
    vbX = cxg;
    vbY = cyg;
  }
  const cx = offX + vbX * s;
  const cy = offY + vbY * s;
  const ox = host.width / 2;
  const oy = host.height / 2;
  return {
    x: host.left + ox + panX + zoom * (cx - ox),
    y: host.top + oy + panY + zoom * (cy - oy),
  };
}

/** Forward norm→pantalla para el modo "Llenar pantalla" (fit = 'height'): la escala es
 *  COVER (igual que `fillScale` del componente), es decir max(hostH/dimVert, hostW/dimHor).
 *  Así el rect de contenido (el campo con sus marcas) cubre el host y puede desbordar y
 *  panearse. En hosts verticales coincide con contain-height; en panorámicos difiere. Debe
 *  coincidir EXACTAMENTE con screenToNorm(..., 'height'). */
function normToScreenPointFit(
  nx: number,
  ny: number,
  host: HostRect,
  g: Geometry,
  panX: number,
  panY: number,
  zoom: number,
): { x: number; y: number } {
  const dimVert = g.vertical ? g.rect.w : g.rect.h;
  const dimHor = g.vertical ? g.rect.h : g.rect.w;
  const s = Math.max(host.height / dimVert, host.width / dimHor);
  const offX = (host.width - g.vbW * s) / 2;
  const offY = (host.height - g.vbH * s) / 2;
  const cxg = nx * g.rect.w + g.rect.x;
  const cyg = ny * g.rect.h + g.rect.y;
  let vbX: number;
  let vbY: number;
  if (g.vertical) {
    const Tx = g.vbW / 2 + (g.rect.y + g.rect.h / 2);
    vbX = Tx - cyg;
    vbY = cxg;
  } else {
    vbX = cxg;
    vbY = cyg;
  }
  const cx = offX + vbX * s;
  const cy = offY + vbY * s;
  const ox = host.width / 2;
  const oy = host.height / 2;
  return {
    x: host.left + ox + panX + zoom * (cx - ox),
    y: host.top + oy + panY + zoom * (cy - oy),
  };
}

describe('render', () => {
  it('renderBoardSvg produces svg markup with the elements', () => {
    const svg = renderBoardSvg('full', [mkPlayer('p1', 0.5, 0.5)], {});
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 100 80"');
  });

  it('includes a circle for a player', () => {
    const svg = renderBoardSvg('full', [mkPlayer('p1', 0.5, 0.5)], {});
    expect(svg).toContain('<circle');
    expect(svg).toContain('9');
  });

  it('hitTestElement finds a player near its position', () => {
    const els = [mkPlayer('p1', 0.5, 0.5)];
    expect(hitTestElement({ x: 0.52, y: 0.5 }, els)).toBe('p1');
    expect(hitTestElement({ x: 0.9, y: 0.9 }, els)).toBeNull();
  });

  it('textColor returns dark text on light background', () => {
    expect(textColor('#f4f4f4')).toBe('#111111');
    expect(textColor('#1a73e8')).toBe('#ffffff');
  });

  it('hides an element below 100% opacity inside an <g opacity> wrapper', () => {
    const el: CanvasElement = { id: 'p', t: 'player', x: 0.5, y: 0.5, opacity: 0.5 };
    const svg = renderBoardSvg('full', [el], {});
    expect(svg).toContain('<g opacity="0.5">');
  });

  it('applies a rotation transform for a rotated element', () => {
    const rect: CanvasElement = { id: 'r', t: 'rect', x: 0.3, y: 0.3, w: 0.2, h: 0.1, rot: 45 };
    const svg = renderBoardSvg('full', [rect], {});
    expect(svg).toContain('rotate(45 ');
  });

  it('hitTestElement finds a rect by point-in-rect', () => {
    const rect: CanvasElement = { id: 'r', t: 'rect', x: 0.3, y: 0.3, w: 0.2, h: 0.1 };
    expect(hitTestElement({ x: 0.4, y: 0.35 }, [rect])).toBe('r');
    expect(hitTestElement({ x: 0.9, y: 0.9 }, [rect])).toBeNull();
  });

  it('renders a goalkeeper tag for goalkeeper players', () => {
    const gk: CanvasElement = { id: 'gk', t: 'player', x: 0.5, y: 0.5, n: 1, type: 'goalkeeper' };
    const svg = renderBoardSvg('full', [gk], {});
    expect(svg).toContain('POR');
  });

  it('Fase 8: el nombre y el número de un jugador se CONTRARROTAN (quedan derechos) y el círculo conserva la rotación', () => {
    const p0: CanvasElement = {
      id: 'p0',
      t: 'player',
      x: 0.5,
      y: 0.5,
      n: 7,
      label: 'Sergio',
      rot: 90,
    };
    const svg = renderBoardSvg('full', [p0], {});
    // El jugador girado lleva el texto compensado con -rot (rotate(-90)) dentro del grupo.
    expect(svg).toContain('rotate(-90 0 0)');
    // El wrapper sigue conservando la rotación de la marca (rotate(90 x y)).
    expect(svg).toContain('rotate(90 ');
    // Un jugador SIN rotación no añade la compensación.
    const p1: CanvasElement = { id: 'p1', t: 'player', x: 0.5, y: 0.5, n: 8 };
    const svg1 = renderBoardSvg('full', [p1], {});
    expect(svg1).not.toContain('rotate(-90 ');
  });

  it('Fase 1: en campo VERTICAL el dorsal/nombre quedan DERECHOS por pantalla (contrarrotan la orientación +90)', () => {
    // Vertical: todo el canvas se rota +90; el texto del jugador debe compensar -90.
    const p0: CanvasElement = { id: 'p0', t: 'player', x: 0.5, y: 0.5, n: 7, label: 'Sergio' };
    const svg = renderBoardSvg('full', [p0], { orientation: 'vertical' });
    expect(svg).toContain('rotate(-90 0 0)');
    // Un jugador girado ±90 en vertical compensa -(90+rot) → para rot=90, rotate(-180 0 0).
    const p2: CanvasElement = {
      id: 'p2',
      t: 'player',
      x: 0.5,
      y: 0.5,
      n: 8,
      label: 'Pau',
      rot: 90,
    };
    const svg2 = renderBoardSvg('full', [p2], { orientation: 'vertical' });
    expect(svg2).toContain('rotate(-180 0 0)');
    // Horizontal: un jugador sin rotación NO compensa la orientación (queda a 0°).
    const svgH = renderBoardSvg('full', [{ id: 'p3', t: 'player', x: 0.5, y: 0.5, n: 9 }], {
      orientation: 'horizontal',
    });
    expect(svgH).not.toContain('rotate(-90 ');
  });

  it('A7: el césped es el OFICIAL único (se ignora backgroundColor), las líneas son SIEMPRE blancas y el césped de franjas', () => {
    const svg = renderBoardSvg('full', [], {
      backgroundColor: '#123456',
      lineColor: '#ff0000',
      grass: 'plain',
    });
    // A7: el render usa el césped oficial, NO el backgroundColor del documento.
    expect(svg).not.toContain('#123456');
    expect(svg).toContain(OFFICIAL_PITCH_COLOR);
    // La marca reglamentaria ignora el color del documento: siempre blanca.
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).not.toContain('stroke="#ff0000"');
  });

  it('Fase 2: el césped va precedido de una franja exterior LISA (5 % del lado corto) y las franjas quedan dentro del terreno', () => {
    const svg = renderBoardSvg('full', [], {});
    // Existe la franja exterior con su clase estable.
    expect(svg).toContain('class="entrenolab-strip"');
    // La franja es un rect LISO (fill=base, sin rayas) que rodea el rect de contenido.
    const strip =
      /<g class="entrenolab-strip"[^>]*><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"/.exec(
        svg,
      );
    expect(strip, 'debe existir el <rect> de la franja').not.toBeNull();
    expect(parseFloat(strip![1])).toBeLessThan(0); // se extiende a la izquierda del rect
    expect(parseFloat(strip![2])).toBeLessThan(0); // y por arriba
    // El ancho/alto de la franja es mayor que el rect de contenido (92×~59,58): sobresale.
    expect(parseFloat(strip![3])).toBeGreaterThan(92);
    // El rect de contenido (césped de franjas) sigue existiendo dentro.
    expect(svg).toContain('class="entrenolab-grass"');
  });

  it('Bloque F #9 — la franja exterior NO tapa el césped interior (se dibuja ANTES y el césped va encima)', () => {
    const svg = renderBoardSvg('full', [], {});
    const idxStrip = svg.indexOf('class="entrenolab-strip"');
    const idxGrass = svg.indexOf('class="entrenolab-grass"');
    expect(idxStrip, 'existe la franja').toBeGreaterThan(-1);
    expect(idxGrass, 'existe el césped').toBeGreaterThan(-1);
    // El orden en el SVG: franja ANTES, césped DESPUÉS (el césped interior queda encima).
    expect(idxStrip, 'la franja se dibuja ANTES del césped (queda detrás)').toBeLessThan(idxGrass);
    // El césped interior cubre el campo con sus bandas (no queda tapado por la franja):
    // al existir el grupo de césped después de la franja, las bandas se pintan encima.
    const bands = svg.slice(idxGrass).match(/<rect /g) ?? [];
    expect(bands.length, 'el césped pinta sus bandas (no está vacío)').toBeGreaterThanOrEqual(10);
  });

  it('Fase 9: el césped es SIEMPRE de franjas (se ignora la textura liso/cuadros del documento)', () => {
    const count = (svg: string) => (svg.match(/<rect /g) ?? []).length;
    const stripes = count(renderBoardSvg('full', [], { grass: 'stripes' }));
    const plain = count(renderBoardSvg('full', [], { grass: 'plain' }));
    const checker = count(renderBoardSvg('full', [], { grass: 'checker' }));
    expect(stripes).toBeGreaterThanOrEqual(10);
    // Los tres producen el MISMO césped: siempre franjas.
    expect(plain).toBe(stripes);
    expect(checker).toBe(stripes);
  });

  it('renders a vertical viewBox for vertical orientation', () => {
    const svg = renderBoardSvg('full', [], { orientation: 'vertical' });
    expect(svg).toContain('viewBox="0 0 80 100"');
  });

  it('scales rect/zone by the ACTIVE geometry (vertical rota el contenido canónico)', () => {
    const rect: CanvasElement = {
      id: 'r',
      t: 'rect',
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.5,
      c: '#ff0000',
    };
    const h = renderBoardSvg('full', [rect], { orientation: 'horizontal' });
    const v = renderBoardSvg('full', [rect], { orientation: 'vertical' });
    expect(h).toContain('width="46"'); // 0.5 * 92 (espacio canónico)
    expect(h).toContain('rgba(255,0,0,0.16)'); // relleno translúcido del color elegido
    expect(h).toContain('stroke="#ff0000"'); // contorno con el color
    // En vertical TODO el contenido se rota (mismo espacio canónico + rotate(90)).
    expect(v).toContain('rotate(90)');
    expect(v).toContain('width="46"');
    expect(v).toContain('rgba(255,0,0,0.16)');
  });

  it('positions a point element by the ACTIVE geometry (vertical rota el contenido)', () => {
    const p: CanvasElement = { id: 'p', t: 'player', x: 0.5, y: 0.5 };
    const v = renderBoardSvg('full', [p], { orientation: 'vertical' });
    // Contenido en espacio canónico (x=0.5*92+4=50, y=0.5*59.58+10≈39.79) + rotate(90).
    expect(v).toContain('translate(50 ');
    expect(v).toContain('rotate(90)');
  });

  it('renders an ellipse and hit-tests inside vs outside', () => {
    const el: CanvasElement = {
      id: 'e',
      t: 'ellipse',
      x: 0.2,
      y: 0.2,
      w: 0.4,
      h: 0.3,
      fill: false,
      c: '#ff0000',
    };
    const svg = renderBoardSvg('full', [el], {});
    expect(svg).toContain('<ellipse');
    expect(hitTestElement({ x: 0.4, y: 0.35 }, [el])).toBe('e');
    expect(hitTestElement({ x: 0.9, y: 0.9 }, [el])).toBeNull();
  });

  it('renders freehand polyline and hit-tests on the stroke', () => {
    const el: CanvasElement = {
      id: 'f',
      t: 'freehand',
      points: [
        [0.2, 0.2],
        [0.4, 0.5],
        [0.6, 0.2],
      ],
    };
    const svg = renderBoardSvg('full', [el], {});
    expect(svg).toContain('<polyline');
    expect(hitTestElement({ x: 0.4, y: 0.49 }, [el])).toBe('f');
    expect(hitTestElement({ x: 0.9, y: 0.2 }, [el])).toBeNull();
  });

  it('renders a curved arrow path and hit-tests near it', () => {
    const el: CanvasElement = {
      id: 'c',
      t: 'curve',
      x1: 0.2,
      y1: 0.3,
      c1x: 0.5,
      c1y: 0.7,
      x2: 0.8,
      y2: 0.3,
    };
    const svg = renderBoardSvg('full', [el], {});
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('Q ');
    expect(hitTestElement({ x: 0.5, y: 0.49 }, [el])).toBe('c');
  });

  it('FASE 5: dos curvaturas opuestas (Curva izq/der) dibujan puntos de control opuestos', () => {
    const up: CanvasElement = {
      id: 'l',
      t: 'curve',
      x1: 0.2,
      y1: 0.3,
      c1x: 0.5,
      c1y: 0.3 - 0.14,
      x2: 0.8,
      y2: 0.3,
    };
    const down: CanvasElement = {
      id: 'r',
      t: 'curve',
      x1: 0.2,
      y1: 0.3,
      c1x: 0.5,
      c1y: 0.3 + 0.14,
      x2: 0.8,
      y2: 0.3,
    };
    const svgUp = renderBoardSvg('full', [up], {});
    const svgDown = renderBoardSvg('full', [down], {});
    // Valores en píxeles: py(c1y) = c1y*r.h + r.y. El control del curve_left (arriba) es
    // MENOR que el del curve_right (abajo), luego los puntos de control son opuestos.
    const ctrlY = (svg: string): number => {
      const m = /<path d="M [^ ]+ [^ ]+ Q ([^ ]+) ([^ ]+) [^ ]+ [^ ]+"/.exec(svg);
      return m ? Number(m[2]) : NaN;
    };
    expect(ctrlY(svgUp)).toBeLessThan(ctrlY(svgDown));
    // Ambos terminan con una punta unida al final (polygon con la punta en x2,y2).
    expect(svgUp).toMatch(/<polygon points="[^"]+"/);
    expect(svgDown).toMatch(/<polygon points="[^"]+"/);
  });

  it('renders a 3x3 zone guide but not a "none" guide', () => {
    const withGuide = renderBoardSvg('full', [], { guide: '3x3' });
    expect(withGuide).toContain('class="zone-guide"');
    const none = renderBoardSvg('full', [], { guide: 'none' });
    expect(none).not.toContain('zone-guide');
  });

  it('renders text content, is selectable, and shows its editing rect ONLY when selected', () => {
    const t: CanvasElement = {
      id: 't',
      t: 'text',
      x: 0.3,
      y: 0.3,
      v: 'Hola',
      size: 4,
      w: 0.2,
      h: 0.09,
    };
    // Render en LIMPIO (sin selección): aparece el texto pero NO el cuadro punteado.
    const clean = renderBoardSvg('blank', [t], {});
    expect(clean).toContain('Hola');
    expect(clean).not.toContain('text-edit-rect');
    expect(clean).not.toContain('stroke-dasharray="1,0.7"');
    // Con selección SÍ se dibuja el cuadro de edición (la miniatura/PNG usan el render limpio).
    const sel = renderBoardSvg('blank', [t], { selectedId: 't' });
    expect(sel).toContain('text-edit-rect');
    // Hit-test: dentro del cuadro y cerca del centro.
    expect(hitTestElement({ x: 0.38, y: 0.32 }, [t])).toBe('t');
    expect(hitTestElement({ x: 0.5, y: 0.5 }, [t])).toBeNull();
  });

  it('los valores por defecto del texto son legibles y el cuadro contiene "Texto"', () => {
    // Con el tamaño por defecto, "Texto" cabe en una sola línea dentro del cuadro.
    const boxW = DEFAULT_TEXT_W * 92; // rect canónico w=92
    expect(wrapTextForBox('Texto', boxW, DEFAULT_TEXT_SIZE)).toEqual(['Texto']);
    // El alto por defecto admite al menos dos líneas (interlineado * líneas <= alto).
    const boxH = DEFAULT_TEXT_H * (92 / (105 / 68));
    const lineH = DEFAULT_TEXT_SIZE * 1.15;
    expect(lineH * 2).toBeLessThanOrEqual(boxH + 0.001);
  });

  it('wrapTextForBox respeta saltos de línea explícitos', () => {
    expect(wrapTextForBox('A\nB', 200, 3)).toEqual(['A', 'B']);
    expect(wrapTextForBox('', 200, 3)).toEqual([]);
  });

  it('wrapTextForBox parte palabras que solas desbordan el ancho', () => {
    // Ancho muy pequeño (una sola letra): cada carácter va a su línea.
    const lines = wrapTextForBox('abc', 2 * 3 * 0.58, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('abc');
  });

  it('wrapTextForBox no pierde texto al envolver (reconstrucción por palabras)', () => {
    const text = 'Rondos de pase y recepción en superioridad numérica 4 contra 2';
    const boxW = 0.3 * 92;
    const lines = wrapTextForBox(text, boxW, DEFAULT_TEXT_SIZE);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text);
  });

  // ---- Texto: geometría REAL (no solo "existe clipPath") ----

  const R = HORIZONTAL_RECT; // rect canónico de contenido 4,10,92,58.58
  const lineStep = (size: number) => size * 1.15;
  const under = (size: number) => size * 0.25; // descensor (margen bajo un glifo)
  /** Líneas que caben ENTERAS (sin cortar un glifo) dentro de una altura boxH. */
  const visibleLines = (lines: string[], size: number, boxH: number): number => {
    let vc = 0;
    for (let i = 0; i < lines.length; i++) {
      if (size * 0.8 + i * lineStep(size) + under(size) > boxH) break;
      vc = i + 1;
    }
    return vc;
  };
  function parseTspans(svg: string): Array<{ text: string; y: number | null; dy: number | null }> {
    const out: Array<{ text: string; y: number | null; dy: number | null }> = [];
    const re = /<tspan([^>]*)>([^<]*)<\/tspan>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) {
      const attrs = m[1];
      const y = /\by="([-\d.]+)"/.exec(attrs);
      const dy = /\bdy="([-\d.]+)"/.exec(attrs);
      out.push({ text: m[2], y: y ? parseFloat(y[1]) : null, dy: dy ? parseFloat(dy[1]) : null });
    }
    return out;
  }
  /** Línea base ABSOLUTA de cada tspan (la 1ª usa y= y el resto acumula dy=). */
  function tspanBaselines(
    tsps: Array<{ text: string; y: number | null; dy: number | null }>,
  ): number[] {
    const res: number[] = [];
    let cur = 0;
    tsps.forEach((t, i) => {
      if (i === 0) {
        if (t.y == null) throw new Error('la primera línea necesita y absoluta');
        cur = t.y;
      } else {
        cur += t.dy ?? 0;
      }
      res.push(cur);
    });
    return res;
  }
  /** Rect del clipPath del cuadro de texto (x,y,ancho,alto). */
  function clipRect(svg: string): { x: number; y: number; w: number; h: number } {
    const m =
      /<clipPath id="txtclip-[^"]*">\s*<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"\s*\/>/.exec(
        svg,
      );
    if (!m) throw new Error('no clip rect');
    return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  }

  it('auto-grow: más líneas aumentan el alto del cuadro y ninguna línea queda cortada', () => {
    const size = DEFAULT_TEXT_SIZE;
    const w = DEFAULT_TEXT_W;
    const boxW = w * R.w;
    const v = 'Rondos 4v2\nConservación\nPase en superioridad';
    const h = autoTextBoxH(v, size, boxW);
    // Fase 4 (fuente más pequeña): el alto crece con las líneas (3 > 1), aunque
    // ya no supera la caja por defecto 0.14 (que ahora sobra para 3 líneas).
    const h1 = autoTextBoxH('Una línea', size, boxW);
    expect(h).toBeGreaterThan(h1); // creció para caber las 3 líneas
    const t: CanvasElement = { id: 't', t: 'text', x: 0.3, y: 0.3, v, size, w, h };
    const svg = renderBoardSvg('blank', [t], {});
    const lines = wrapTextForBox(v, boxW, size);
    const tsps = parseTspans(svg);
    const boxH = h * R.h;
    const y = 0.3 * R.h + R.y;
    // Se pintan TODAS las líneas (el cuadro creció) y sus glifos no se cortan.
    expect(tsps.length).toBe(lines.length);
    tspanBaselines(tsps).forEach((b) => {
      expect(b).toBeGreaterThanOrEqual(y);
      expect(b + under(size)).toBeLessThanOrEqual(y + boxH + 0.001);
    });
    // El contenido completo (cada línea) está presente.
    const rendered = tsps.map((t2) => t2.text).join('\n');
    for (const ln of lines) expect(rendered).toContain(ln);
  });

  it('auto-grow solo crece: un cuadro ya alto no encoge al acortar el texto', () => {
    const size = DEFAULT_TEXT_SIZE;
    const boxW = DEFAULT_TEXT_W * R.w;
    const h = autoTextBoxH('A\nB\nC', size, boxW); // 3 líneas
    const t: CanvasElement = {
      id: 't',
      t: 'text',
      x: 0.3,
      y: 0.3,
      v: 'A',
      size,
      w: DEFAULT_TEXT_W,
      h,
    };
    const svg = renderBoardSvg('blank', [t], {});
    // El texto cabe de sobra; ninguna línea se corta y queda todo visible.
    const tsps = parseTspans(svg);
    expect(tsps.length).toBe(1);
    expect(tsps[0].text).toBe('A');
  });

  it('textLayoutForBox devuelve líneas enteras y añade "…" cuando hay recorte', () => {
    const size = 3;
    const lines = ['A', 'B', 'C', 'D'];
    // Alto para 2 líneas: 3.15 ≤ boxH para la línea 1 (i=1 → 2.4+3.45+0.75 = 6.6).
    const boxH = 7.2;
    const layout = textLayoutForBox(lines, size, boxH);
    expect(layout.visibleCount).toBe(2);
    expect(layout.overflow).toBe(true);
    expect(layout.lines).toEqual(['A', 'B …']);
  });

  it('cuadro manual (fijo) más bajo que el contenido: recorta por líneas ENTERAS y muestra "…"', () => {
    const size = DEFAULT_TEXT_SIZE;
    const boxW = DEFAULT_TEXT_W * R.w;
    // Texto largo (se envuelve en varias líneas) en un cuadro FIJO y bajo.
    const v = 'Una línea muy larga que no cabe entera y debería cortarse sin partir un glifo';
    const h = 0.06; // fijo y bajo → normalmente no llega
    const t: CanvasElement = { id: 't', t: 'text', x: 0.3, y: 0.3, v, size, w: DEFAULT_TEXT_W, h };
    const svg = renderBoardSvg('blank', [t], {});
    const lines = wrapTextForBox(v, boxW, size);
    const boxH = h * R.h;
    const vc = visibleLines(lines, size, boxH);
    expect(vc).toBeGreaterThan(0);
    expect(vc).toBeLessThan(lines.length); // hay contenido oculto
    const tsps = parseTspans(svg);
    expect(tsps.length).toBe(vc);
    expect(tsps[tsps.length - 1].text.endsWith('…')).toBe(true);
    // Ninguna línea pintada se corta por abajo (líneas enteras).
    const y = 0.3 * R.h + R.y;
    tspanBaselines(tsps).forEach((b) =>
      expect(b + under(size)).toBeLessThanOrEqual(y + boxH + 0.001),
    );
  });

  it('el cuadro punteado NO sale en limpio/miniatura y sí cuando está seleccionado', () => {
    const t: CanvasElement = {
      id: 't',
      t: 'text',
      x: 0.4,
      y: 0.4,
      v: 'Texto',
      size: DEFAULT_TEXT_SIZE,
      w: DEFAULT_TEXT_W,
      h: DEFAULT_TEXT_H,
    };
    // Render limpio (es el que usan la miniatura al guardar y el PNG exportado).
    const clean = renderBoardSvg('full', [t], {});
    expect(clean).not.toContain('text-edit-rect');
    expect(clean).not.toContain('stroke-dasharray="1,0.7"');
    // Render con la selección activa.
    const sel = renderBoardSvg('full', [t], { selectedId: 't' });
    expect(sel).toContain('text-edit-rect');
    expect(sel).toContain('stroke-dasharray="1,0.7"');
  });

  it('texto junto a las cuatro esquinas queda dentro del campo y es seleccionable', () => {
    const size = DEFAULT_TEXT_SIZE;
    const spots: Array<[number, number]> = [
      [0.05, 0.05],
      [0.66, 0.05],
      [0.05, 0.82],
      [0.66, 0.82],
    ];
    for (const [sx, sy] of spots) {
      const t: CanvasElement = {
        id: `t-${sx}-${sy}`,
        t: 'text',
        x: sx,
        y: sy,
        v: 'Borde',
        size,
        w: DEFAULT_TEXT_W,
        h: DEFAULT_TEXT_H,
      };
      const svg = renderBoardSvg('blank', [t], {});
      const box = clipRect(svg);
      expect(box.x).toBeGreaterThanOrEqual(R.x - 0.001);
      expect(box.y).toBeGreaterThanOrEqual(R.y - 0.001);
      expect(box.x + box.w).toBeLessThanOrEqual(R.x + R.w + 0.001);
      expect(box.y + box.h).toBeLessThanOrEqual(R.y + R.h + 0.001);
      expect(hitTestElement({ x: sx + DEFAULT_TEXT_W / 2, y: sy + DEFAULT_TEXT_H / 2 }, [t])).toBe(
        t.id,
      );
    }
    // Un cuadro pegado al borde derecho NO desborda horizontalmente (clamp al campo).
    const edge: CanvasElement = {
      id: 'edge',
      t: 'text',
      x: 0.95,
      y: 0.1,
      v: 'Borde',
      size,
      w: DEFAULT_TEXT_W,
      h: DEFAULT_TEXT_H,
    };
    const boxE = clipRect(renderBoardSvg('blank', [edge], {}));
    expect(boxE.x + boxE.w).toBeLessThanOrEqual(R.x + R.w + 0.001);
  });

  it('hit-testing respeta la rotación (punto rotado al espacio local)', () => {
    const rect: CanvasElement = { id: 'r', t: 'rect', x: 0.3, y: 0.475, w: 0.4, h: 0.05, rot: 90 };
    // Punto que entra tras rotar 90° (fuera de la caja sin rotar).
    expect(hitTestElement({ x: 0.5, y: 0.4 }, [rect])).toBe('r');
    // Punto que queda fuera tras rotar (dentro de la caja sin rotar).
    expect(hitTestElement({ x: 0.55, y: 0.5 }, [rect])).toBeNull();
  });

  it('rota texto y curva en el render (rotWrap con su centro)', () => {
    const t: CanvasElement = {
      id: 't',
      t: 'text',
      x: 0.3,
      y: 0.3,
      w: 0.2,
      h: 0.1,
      v: 'X',
      rot: 45,
    };
    expect(renderBoardSvg('full', [t], {})).toContain('rotate(45 ');
    const c: CanvasElement = {
      id: 'c',
      t: 'curve',
      x1: 0.2,
      y1: 0.3,
      c1x: 0.5,
      c1y: 0.7,
      x2: 0.8,
      y2: 0.3,
      rot: 30,
    };
    expect(renderBoardSvg('full', [c], {})).toContain('rotate(30 ');
  });

  it('screenToNorm mapea las esquinas del campo en un host de la misma proporción', () => {
    const g = boardGeometry('horizontal'); // viewBox 100x80, rect 4,10,92,59.58
    const host = { left: 0, top: 0, width: 1000, height: 800 };
    // (0,0) = esquina superior-izquierda del campo (vbX=4, vbY=10) → pantalla (40,100).
    expect(screenToNorm(40, 100, host, g, 0, 0, 1)).toEqual({ x: 0, y: 0 });
    // (1,1) = esquina inferior-derecha del campo (vbX=96, vbY=69.58) → pantalla (960,695.8).
    const br = screenToNorm(960, 695.8, host, g, 0, 0, 1);
    expect(br.x).toBeCloseTo(1, 5);
    expect(br.y).toBeCloseTo(1, 2);
  });

  it('screenToNorm tiene en cuenta el letterboxing en un host móvil (campo centrado)', () => {
    const g = boardGeometry('horizontal');
    const host = { left: 0, top: 0, width: 390, height: 844 };
    // El campo (100x80) se ajusta con s=3.9 → ocupa 390x312, centrado verticalmente con offY=266.
    const c = screenToNorm(195, 266 + 40 * 3.9, host, g, 0, 0, 1);
    expect(c.x).toBeCloseTo(0.5, 2);
    expect(c.y).toBeCloseTo(0.5, 2);
  });

  it('screenToNorm en vertical invierte la rotación: la portería izquierda corresponde a la superior', () => {
    const g = boardGeometry('vertical'); // viewBox 80x100
    const host = { left: 0, top: 0, width: 640, height: 800 }; // 4:5 = 80:100
    // Un jugador junto a la portería IZQUIERDA (longitud≈0, anchura 0.5) se renderiza
    // ARRIBA (viewBox (40, 5.84)) al girar el contenido. Al hacer clic allí el modelo
    // debe dar longitud≈0 (junto a la portería) y anchura 0.5 → coherencia H/V.
    const n = screenToNorm(320, (5.84 / 100) * 800, host, g, 0, 0, 1);
    expect(n.x).toBeCloseTo(0.02, 1);
    expect(n.y).toBeCloseTo(0.5, 1);
  });

  it('round-trip norm→pantalla→norm es la identidad en HOST PANORÁMICO con fit=height (fix D1)', () => {
    // En hosts panorámicos (dar más el ancho) la escala de "Llenar pantalla" es COVER
    // (width-based), NO contain-height. Antes screenToNorm usaba hostH/dimVert y NO
    // coincidía con el render (fillScale), produciendo un error de ~36 px que la selección
    // estricta destapaba. Este test lo fija para que sean exactos en panorámico.
    const g = boardGeometry('horizontal');
    const host: HostRect = { left: 10, top: 98, width: 1346, height: 563 };
    for (const [panX, panY] of [
      [0, 0],
      [40, -30],
    ] as Array<[number, number]>) {
      for (const [nx, ny] of [
        [0.55, 0.5],
        [0.2, 0.8],
      ] as Array<[number, number]>) {
        const f = normToScreenPointFit(nx, ny, host, g, panX, panY, 1);
        const inv = screenToNorm(f.x, f.y, host, g, panX, panY, 1, 'height');
        expect(inv.x, `x para (${nx},${ny})`).toBeCloseTo(nx, 3);
        expect(inv.y, `y para (${nx},${ny})`).toBeCloseTo(ny, 3);
      }
    }
    // La escala es COVER: el contenido alcanza al menos la dimensión del host y una la supera.
    const s = Math.max(host.height / g.rect.h, host.width / g.rect.w);
    expect(g.rect.h * s >= host.height || g.rect.w * s >= host.width).toBe(true);
  });

  it('renderBoardSvg dibuja el overlay F7 cuando está activado (no cuando no)', () => {
    const on = renderBoardSvg('full', [], {
      f7: { enabled: true, color: '#2563eb', thickness: 0.8, opacity: 0.8 },
    });
    expect(on).toContain('stroke="#2563eb"');
    expect(on).toContain('stroke-opacity="0.8"');
    const off = renderBoardSvg('full', [], {
      f7: { enabled: false, color: '#2563eb', thickness: 0.8, opacity: 0.8 },
    });
    expect(off).not.toContain('stroke="#2563eb"');
  });

  it('el F7 real tiene límites, líneas de fuera de juego y SIN línea/círculo central', () => {
    // Campo en blanco para aislar el overlay F7 (sin las líneas/círculo del campo).
    const svg = renderBoardSvg('blank', [], {
      f7: { enabled: true, color: '#2563eb', thickness: 0.8, opacity: 0.8 },
    });
    // Los fondos del F7 coinciden con las bandas del F11: ancho completo 92.
    expect(svg).toContain('width="92"');
    // Las líneas interiores coinciden con los laterales del área grande F11.
    const areaSide = 4 + ((68 - 40.32) / (2 * 68)) * 92;
    expect(svg).toContain(`x1="${areaSide}`);
    // SIN línea central (ninguna <line> en el punto medio x = 4+0.5*92 = 50).
    expect(svg.match(/<line x1="50"/g)).toBeNull();
    // SIN círculo central: el único círculo es el punto central (r=0.35), sin ellipse.
    expect(svg).not.toContain('<ellipse');
    expect(svg).not.toContain('r="1.7"');
  });

  it('Fase 11: el campo base F7 (fondo F11) dibuja sus marcas en BLANCO, no en el color pedido', () => {
    // El campo base 'f7' (sin overlay) dibuja el fondo F11 siempre en blanco (Fase 11);
    // el color de contraste del F7 transversal es el de su propio overlay, no el de línea.
    const svg = renderBoardSvg('f7', [], { lineColor: '#ff0000', grid: false });
    // FASE 4/8b: el F7 usa el medio campo F11 APISAADO (68 m en X → 59,58 de ancho).
    const halfW = 68 * (92 / 105);
    const cont = /<rect x="4" y="4" width="([\d.]+)" height="([\d.]+)"[^>]*stroke="#ffffff"/.exec(
      svg,
    );
    expect(cont, 'el medio campo F11 apaisado dibuja su contorno').not.toBeNull();
    expect(parseFloat(cont![1])).toBeCloseTo(halfW, 3);
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).not.toContain('stroke="#ff0000"');
    // No dibuja círculo central ni ellipse.
    expect(svg).not.toContain('<ellipse');
  });

  it('el campo base F7 es la plantilla compuesta: medio campo F11 + F7 perpendicular', () => {
    const svg = renderBoardSvg('f7', [], {});
    // Marca del medio campo F11: portería (rect con relleno translúcido).
    expect(svg).toContain('rgba(255,255,255,0.25)');
    // Contorno del medio campo apaisado (68 m en X → 59,58 de ancho).
    const halfW = 68 * (92 / 105);
    const cont = /<rect x="4" y="4" width="([\d.]+)" height="([\d.]+)"[^>]*stroke="#ffffff"/.exec(
      svg,
    );
    expect(cont).not.toBeNull();
    expect(parseFloat(cont![1])).toBeCloseTo(halfW, 3);
    // El F7 transversal se dibuja en SU color de contraste, separado del fondo blanco.
    expect(svg).toContain(F7_LINE_COLOR);
    // Solo el punto central pequeño; sin ellipse de círculo central.
    expect(svg).not.toContain('<ellipse');
    expect(svg).toContain('r="0.35"');
  });

  it('el render con field f7 es puro (no muta el modelo) y no deforma en vertical', () => {
    // El render es una función pura: dos llamadas idénticas devuelven el MISMO SVG.
    const a = renderBoardSvg('f7', [], { orientation: 'vertical' });
    const b = renderBoardSvg('f7', [], { orientation: 'vertical' });
    expect(a).toBe(b);
    // Vertical rota TODO el contenido (F7 y F11 siguen perpendiculares sin deformar).
    expect(a).toContain('rotate(90)');
    // El F7 usa la geometría del medio campo (52,5×68), que en vertical encaja en el
    // alto del viewBox (58,47) y dibuja el rect del medio campo con su proporción.
    expect(a).toContain(F7_LINE_COLOR);
  });

  it('renderiza el marcador de entrenador C (coachC, SVG nativo rotable)', () => {
    const svg = renderBoardSvg('full', [{ id: 'c', t: 'coachC', x: 0.5, y: 0.5 }], {});
    expect(svg).toContain('>C</text>');
  });

  it('B2: la Mancuerna (dumbbell) se renderiza como SVG vectorial original, transparente', () => {
    const svg = renderBoardSvg('full', [{ id: 'd', t: 'dumbbell', x: 0.5, y: 0.5 }], {});
    expect(svg).toContain('data-el-type="dumbbell"');
    // Es un <g> nativo (no un <image> de PNG rasterizado).
    expect(svg).not.toContain('data-el-type="dumbbell" image');
    const el = svg.match(/<g[^>]*data-el-type="dumbbell"[^>]*>(.*?)<\/g>/);
    expect(el, 'el dumbbell se dibuja como <g> con barras').not.toBeNull();
    expect(el![1], 'la pesa tiene barras/platos').toContain('<rect');
  });

  it('B1: la Portería grande (goal) y la Barrera de maniquíes (mannequin_row) se renderizan como <g> vectorial', () => {
    const g = renderBoardSvg('full', [{ id: 'g', t: 'goal', x: 0.5, y: 0.5 }], {});
    expect(g).toContain('data-el-type="goal"');
    expect(g).not.toContain('data-el-type="goal" image');
    expect(g.match(/<g[^>]*data-el-type="goal"[^>]*>(.*?)<\/g>/)![1]).toContain('<rect');
    const mr = renderBoardSvg('full', [{ id: 'm', t: 'mannequin_row', x: 0.5, y: 0.5 }], {});
    expect(mr).toContain('data-el-type="mannequin_row"');
    expect(mr.match(/<g[^>]*data-el-type="mannequin_row"[^>]*>(.*?)<\/g>/)![1]).toContain(
      '<circle',
    );
  });

  it('FASE 2 (materiales): la escala del medio campo es MAYOR que la de campo completo', () => {
    const cone = (id: string): CanvasElement => ({ id, t: 'cone', x: 0.5, y: 0.5 });
    const get = (svg: string): number[] => {
      const re = /<g transform="translate\([^)]+\) scale\(([\d.]+)\)"/g;
      const out: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(svg))) out.push(Number(m[1]));
      return out;
    };
    const fullScale = get(renderBoardSvg('full', [cone('a')], {}))[0];
    const halfScale = get(renderBoardSvg('half', [cone('b')], {}))[0];
    expect(fullScale).toBeGreaterThan(0);
    // CAMBIO DE CONTRATO INTENCIONADO (encargo de materiales, FASE 2): antes el factor del medio
    // campo era 0,5, que dejaba el tamaño aparente IGUAL que en campo completo. Ahora es
    // 0,5 × 1,62 = 0,81, que hace que en medio campo se vea un 20 % MAYOR (política medida en
    // píxeles en `e2e/fase-materiales-escala.spec.ts`).
    expect(halfScale).toBeCloseTo(fullScale * 0.81, 5);
    // OJO: la escala en UNIDADES del viewBox es menor en medio campo (0,81) porque el campo también
    // es más corto; el tamaño APARENTE en píxeles es MAYOR (×1,20) porque el campo se ve más de
    // cerca. Esa parte se mide en píxeles en `e2e/fase-materiales-escala.spec.ts`, que es donde
    // tiene sentido medirla.
    // No se re-escribe `size` del documento (el modelo conserva el tamaño base).
    expect(cone('c').size).toBeUndefined();
  });

  it('renderiza el peto (SVG nativo) con el color elegido', () => {
    const svg = renderBoardSvg('full', [{ id: 'p', t: 'peto', x: 0.5, y: 0.5, c: '#1a73e8' }], {});
    expect(svg).toContain('fill="#1a73e8"');
  });

  it('renderiza el chaleco lastrado (SVG nativo)', () => {
    const svg = renderBoardSvg('full', [{ id: 'v', t: 'chaleco', x: 0.5, y: 0.5 }], {});
    expect(svg).toContain('M-1.6 2');
    expect(svg).toContain('#e74c3c');
  });

  it('renderiza el BOSU (SVG nativo)', () => {
    const svg = renderBoardSvg('full', [{ id: 'b', t: 'bosu', x: 0.5, y: 0.5 }], {});
    expect(svg).toContain('A1.6 1.6');
    expect(svg).toContain('#3056d3');
  });

  it('renderiza el fitball (SVG nativo)', () => {
    const svg = renderBoardSvg('full', [{ id: 'f', t: 'fitball', x: 0.5, y: 0.5 }], {});
    expect(svg).toContain('r="1.8"');
    expect(svg).toContain('#e67e22');
  });

  it('renderiza la flecha de doble sentido (dos puntas)', () => {
    const svg = renderBoardSvg(
      'full',
      [{ id: 'd', t: 'doubleArrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3 }],
      {},
    );
    expect(svg).toContain(`stroke="${DEFAULT_ELEMENT_COLOR}"`);
    expect(svg).toContain('<path');
  });

  it('el color por defecto del dibujo contrasta sobre el césped oficial (y antes no)', () => {
    const contrast = (a: string, b: string): number => {
      const lum = (hex: string): number => {
        const h = hex.replace('#', '');
        const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
        const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
      };
      const [hi, lo] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (hi + 0.05) / (lo + 0.05);
    };
    // El color por defecto es el MISMO blanco con el que el campo dibuja sus marcas.
    expect(DEFAULT_ELEMENT_COLOR).toBe('#ffffff');
    expect(
      contrast(DEFAULT_ELEMENT_COLOR, OFFICIAL_PITCH_COLOR),
      'el default debe superar 4:1 sobre el césped',
    ).toBeGreaterThan(4);
    // El default anterior (#1f2933) se quedaba en ~3,1:1: justo en el mínimo de WCAG
    // para objetos gráficos y por debajo en las franjas oscuras del césped.
    expect(
      contrast('#1f2933', OFFICIAL_PITCH_COLOR),
      'el default anterior no llegaba (motivo del cambio)',
    ).toBeLessThan(4);
  });

  it('renderiza la herramienta de medición con su etiqueta', () => {
    const svg = renderBoardSvg(
      'full',
      [{ id: 'm', t: 'measure', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3, v: '15 m' }],
      {},
    );
    expect(svg).toContain('15 m');
  });

  it('renderiza la pica (SVG nativo, coloreable)', () => {
    const svg = renderBoardSvg('full', [{ id: 'p', t: 'pica', x: 0.5, y: 0.5, c: '#1a73e8' }], {});
    expect(svg).toContain('fill="#1a73e8"');
  });

  it('screenToNorm en un host de escritorio (1340×750) y móvil (390×844) con zoom y pan en horizontal', () => {
    const g = boardGeometry('horizontal');
    const host = { left: 10, top: 87, width: 1340, height: 750 };
    // El cono colocó al pulsar en 40%/50% del host → letterboxing → norm (0.3446, 0.5035).
    const r = HORIZONTAL_RECT;
    const s = Math.min(host.width / g.vbW, host.height / g.vbH);
    const offX = (host.width - g.vbW * s) / 2;
    const offY = (host.height - g.vbH * s) / 2;
    // Punto de pantalla que corresponde al cono tras zoom2 + pan(30,20) (origen centro).
    const ox = host.width / 2;
    const oy = host.height / 2;
    const cxg = 0.3446 * r.w + r.x;
    const cyg = 0.5035 * r.h + r.y;
    const vbX = cxg;
    const vbY = cyg;
    const cx = offX + vbX * s;
    const cy = offY + vbY * s;
    const sx = host.left + ox + 30 + 2 * (cx - ox);
    const sy = host.top + oy + 20 + 2 * (cy - oy);
    // El centro visual del cono está DENTRO del host (y=482<837) y devuelve su norm.
    expect(sy).toBeLessThan(host.top + host.height);
    const inv = screenToNorm(sx, sy, host, g, 30, 20, 2);
    expect(inv.x).toBeCloseTo(0.3446, 2);
    expect(inv.y).toBeCloseTo(0.5035, 2);
  });

  it('round-trip norm→pantalla→norm es la identidad en horizontal (desktop + móvil)', () => {
    const hosts: HostRect[] = [
      { left: 10, top: 87, width: 1340, height: 750 },
      { left: 0, top: 0, width: 390, height: 844 },
    ];
    const zooms = [1, 1.5, 2, 3];
    const pans: Array<[number, number]> = [
      [0, 0],
      [30, 20],
      [-50, -35],
    ];
    const pts: Array<[number, number]> = [
      [0.4, 0.5],
      [0.1, 0.2],
      [0.9, 0.8],
    ];
    for (const host of hosts) {
      const g = boardGeometry('horizontal');
      for (const zoom of zooms) {
        for (const [panX, panY] of pans) {
          for (const [nx, ny] of pts) {
            const f = normToScreenPoint(nx, ny, host, g, panX, panY, zoom);
            const inv = screenToNorm(f.x, f.y, host, g, panX, panY, zoom);
            expect(inv.x).toBeCloseTo(nx, 3);
            expect(inv.y).toBeCloseTo(ny, 3);
          }
        }
      }
    }
  });

  it('round-trip norm→pantalla→norm es la identidad en VERTICAL (rotación invertida)', () => {
    const hosts: HostRect[] = [
      { left: 10, top: 87, width: 1340, height: 750 },
      { left: 0, top: 0, width: 640, height: 800 },
    ];
    const zooms = [1, 1.5, 2, 3];
    const pans: Array<[number, number]> = [
      [0, 0],
      [30, 20],
      [-50, -35],
    ];
    const pts: Array<[number, number]> = [
      [0.4, 0.5],
      [0.1, 0.2],
      [0.9, 0.8],
    ];
    for (const host of hosts) {
      const g = boardGeometry('vertical');
      for (const zoom of zooms) {
        for (const [panX, panY] of pans) {
          for (const [nx, ny] of pts) {
            const f = normToScreenPoint(nx, ny, host, g, panX, panY, zoom);
            const inv = screenToNorm(f.x, f.y, host, g, panX, panY, zoom);
            expect(inv.x).toBeCloseTo(nx, 3);
            expect(inv.y).toBeCloseTo(ny, 3);
          }
        }
      }
    }
  });

  it('en modo "Llenar pantalla" (fit=height) el CAMPO llEña la altura del host', () => {
    // El modo llenar pantalla escala a s = hostH / rect.h (la dimensión vertical del
    // contenido): el rect de contenido (el campo con sus marcas) llena la altura.
    for (const host of [
      { left: 0, top: 0, width: 360, height: 800 },
      { left: 8, top: 92, width: 390, height: 844 },
      { left: 5, top: 100, width: 430, height: 932 },
    ]) {
      const g = boardGeometry('horizontal');
      const s = host.height / g.rect.h;
      expect(g.rect.h * s).toBeCloseTo(host.height, 6); // el contenido llena la altura
      expect(g.rect.w * s, 'el campo sobrepasa el ancho (se panea en horizontal)').toBeGreaterThan(
        host.width,
      );
    }
  });

  it('en fit=height el centro del host mapea al centro del campo (sin deporta)', () => {
    const g = boardGeometry('horizontal');
    const host = { left: 0, top: 0, width: 390, height: 844 };
    const c = screenToNorm(
      host.left + host.width / 2,
      host.top + host.height / 2,
      host,
      g,
      0,
      0,
      1,
      'height',
    );
    expect(c.x).toBeCloseTo(0.5, 2);
    expect(c.y).toBeCloseTo(0.5, 2);
  });

  it('round-trip norm→pantalla→norm es la identidad en modo "Llenar pantalla" (fit=height)', () => {
    const g = boardGeometry('horizontal');
    const hosts: HostRect[] = [
      { left: 0, top: 0, width: 390, height: 844 },
      { left: 8, top: 92, width: 360, height: 620 },
    ];
    const zooms = [1, 1.5, 2, 3];
    const pans: Array<[number, number]> = [
      [0, 0],
      [30, 20],
      [-60, -45],
    ];
    const pts: Array<[number, number]> = [
      [0.4, 0.5],
      [0.1, 0.2],
      [0.9, 0.8],
    ];
    for (const host of hosts) {
      for (const zoom of zooms) {
        for (const [panX, panY] of pans) {
          for (const [nx, ny] of pts) {
            const f = normToScreenPointFit(nx, ny, host, g, panX, panY, zoom);
            const inv = screenToNorm(f.x, f.y, host, g, panX, panY, zoom, 'height');
            expect(inv.x).toBeCloseTo(nx, 3);
            expect(inv.y).toBeCloseTo(ny, 3);
          }
        }
      }
    }
  });

  it('round-trip norm→pantalla→norm es la identidad en VERTICAL con fit=height', () => {
    const g = boardGeometry('vertical');
    const host: HostRect = { left: 0, top: 0, width: 360, height: 800 };
    const pts: Array<[number, number]> = [
      [0.4, 0.5],
      [0.1, 0.2],
      [0.9, 0.8],
    ];
    for (const [panX, panY] of [
      [0, 0],
      [20, -10],
    ] as Array<[number, number]>) {
      for (const [nx, ny] of pts) {
        const f = normToScreenPointFit(nx, ny, host, g, panX, panY, 1.5);
        const inv = screenToNorm(f.x, f.y, host, g, panX, panY, 1.5, 'height');
        expect(inv.x).toBeCloseTo(nx, 3);
        expect(inv.y).toBeCloseTo(ny, 3);
      }
    }
  });

  // ---------- Fase 3 — escala normalizada del material + hit-test robusto ----------

  it('materialSize usa el tamaño explícito o la base normalizada del tipo (reducida a ~75 % en Fase 4)', () => {
    // Fase 4: la base por defecto (sin `size`) es 0.75 × la base antigua (cone 1.0 → 0.75).
    expect(
      materialSize({ id: 'a', t: 'cone', assetKind: 'cone_red', asset: '/x.png' }),
    ).toBeCloseTo(1.0 * MATERIAL_SIZE_RATIO, 6);
    expect(materialSize({ id: 'b', t: 'pole', assetKind: 'pole', asset: '/x.png' })).toBeCloseTo(
      1.6 * MATERIAL_SIZE_RATIO,
      6,
    );
    expect(
      materialSize({ id: 'c', t: 'cone', assetKind: 'cone_red', asset: '/x.png', size: 2 }),
    ).toBe(2);
  });

  it('el <image> del material escala con size y usa la base normalizada si no hay size', () => {
    const cone: CanvasElement = {
      id: 'c',
      t: 'cone',
      x: 0.5,
      y: 0.5,
      assetKind: 'cone_red',
      asset: '/assets/tactical/cone-red.png',
    };
    // Sin `size`: base normalizada cone_red = 0.75 → caja 5.2·0.75 (reducida en Fase 4).
    const coneW = MATERIAL_BOX * materialSize(cone);
    expect(renderBoardSvg('full', [cone], {})).toContain(`width="${coneW}"`);
    // Con `size` explícito: escala lineal (sin tocar el valor explícito).
    const big: CanvasElement = { ...cone, size: 2 };
    expect(renderBoardSvg('full', [big], {})).toContain(`width="${MATERIAL_BOX * 2}"`);
    expect(renderBoardSvg('full', [big], {})).toContain(`height="${MATERIAL_BOX * 2}"`);
    // Los elementos de longitud de campo (pértiga) nacen mayores que los compactos.
    const pole: CanvasElement = {
      id: 'p',
      t: 'pole',
      x: 0.5,
      y: 0.5,
      assetKind: 'pole',
      asset: '/assets/tactical/pole.png',
    };
    const poleW = MATERIAL_BOX * materialSize(pole);
    expect(renderBoardSvg('full', [pole], {})).toContain(`width="${poleW}"`);
    expect(materialSize(pole)).toBeCloseTo(TACTICAL_SIZE['pole'] * MATERIAL_SIZE_RATIO, 6);
  });

  it('hit-test de un material estrecho usa la caja (bbox) y respeta size/rot', () => {
    const pole: CanvasElement = {
      id: 'p',
      t: 'pole',
      x: 0.5,
      y: 0.5,
      assetKind: 'pole',
      asset: '/assets/tactical/pole.png',
    };
    // A mitad de altura del poste (dentro de la caja, fuera del radio antiguo 0.05).
    expect(hitTestElement({ x: 0.5, y: 0.5 - 0.06 }, [pole])).toBe('p');
    // Perpendicular (lado del poste estrecho): fuera del ancho táctil.
    expect(hitTestElement({ x: 0.5 - 0.09, y: 0.5 }, [pole])).toBeNull();
    // Espacio vacío lejos del poste: no se selecciona.
    expect(hitTestElement({ x: 0.5, y: 0.5 - 0.12 }, [pole])).toBeNull();
  });

  it('hit-test de una pértiga antigua con rot=90 respeta su nuevo dibujo vertical', () => {
    const pole: CanvasElement = {
      id: 'p',
      t: 'pole',
      x: 0.5,
      y: 0.5,
      assetKind: 'pole',
      asset: '/assets/tactical/pole.png',
      rot: 90,
    };
    // El contrato anterior permitía tumbar el poste. El dueño ahora exige que permanezca de pie:
    // la rotación antigua se ignora tanto en el render como en la selección.
    expect(hitTestElement({ x: 0.5, y: 0.5 - 0.06 }, [pole])).toBe('p');
    expect(hitTestElement({ x: 0.5 + 0.09, y: 0.5 }, [pole])).toBeNull();
  });

  it('en VERTICAL la caja táctil del material derecho va girada como su dibujo (no perpendicular)', () => {
    // El tablero en vertical contrarrota los materiales -90° para que queden DERECHOS por
    // pantalla: una escalera se ve ALTA, así que su caja táctil tiene que ser alta también.
    // Antes se usaba la caja sin girar: tocar los extremos visibles no seleccionaba y sí
    // seleccionaba césped vacío al lado. Se nota en los materiales GRANDES: a los pequeños los
    // cubre el mínimo táctil (una caja cuadrada de ~44 px por lado) y el intercambio no cambia
    // nada.
    const R = BOARD_CANON_RECT;
    const ladder: CanvasElement = {
      id: 'l',
      t: 'ladder',
      x: 0.5,
      y: 0.5,
      size: 2,
      assetKind: 'ladder',
      asset: '/assets/tactical/ladder.png',
    };
    const { hw, hh } = materialHitHalfExtents(ladder);
    // Semiejes de la caja GIRADA: el intercambio es en UNIDADES del viewBox, así que en norm hay
    // que reescalar por eje (norm X = 92 u, norm Y = 59,6 u). Intercambiar los norm sin más deja
    // el dibujo a medio cubrir.
    const hwV = (hh * R.h) / R.w;
    const hhV = (hw * R.w) / R.h;
    expect(hhV, 'el dibujo girado es alto').toBeGreaterThan(hh);
    expect(hwV, 'y estrecho').toBeLessThan(hw);
    // Puntos a medio camino entre la caja vieja y la nueva: dentro de una y fuera de la otra.
    const yMedio = (hh + hhV) / 2;
    const xMedio = (hw + hwV) / 2;
    // VERTICAL (último argumento `true`): la caja es ALTA → el extremo visible selecciona.
    expect(
      hitTestElement({ x: 0.5, y: 0.5 + yMedio }, [ladder], undefined, 1, undefined, true),
    ).toBe('l');
    expect(
      hitTestElement({ x: 0.5 + xMedio, y: 0.5 }, [ladder], undefined, 1, undefined, true),
    ).toBeNull();
    // HORIZONTAL (comportamiento de siempre): la caja es ANCHA.
    expect(hitTestElement({ x: 0.5 + xMedio, y: 0.5 }, [ladder])).toBe('l');
    expect(hitTestElement({ x: 0.5, y: 0.5 + yMedio }, [ladder])).toBeNull();
    // Y las dimensiones de la caja girada son las del dibujo girado, en unidades.
    const v = materialHitHalfExtents(ladder, R, 1, undefined, true);
    expect(v.hw * R.w).toBeCloseTo(hh * R.h, 6);
    expect(v.hh * R.h).toBeCloseTo(hw * R.w, 6);
  });

  it('la hit-box de un material crece con size (por encima del mínimo táctil)', () => {
    const small: CanvasElement = {
      id: 's',
      t: 'pole',
      x: 0.5,
      y: 0.5,
      assetKind: 'pole',
      asset: '/assets/tactical/pole.png',
      size: 1,
    };
    const big: CanvasElement = {
      id: 'b',
      t: 'pole',
      x: 0.5,
      y: 0.5,
      assetKind: 'pole',
      asset: '/assets/tactical/pole.png',
      size: 2,
    };
    // size=1: la mitad de la caja cae bajo el mínimo táctil → NO llega a 0.08.
    expect(hitTestElement({ x: 0.5, y: 0.42 }, [small])).toBeNull();
    // size=2: la caja crece y sí alcanza 0.08 (octava parte de la altura del campo).
    expect(hitTestElement({ x: 0.5, y: 0.42 }, [big])).toBe('b');
  });

  it('D1: dos objetos PRÓXIMOS se seleccionan por separado (la caja no crece con el zoom)', () => {
    // Con la tolerancia en px-sola (sin el floor legado de ~44 px), dos conos a 0.02 de
    // distancia se seleccionan individualmente: el punto que toca A elige A, no B, y un
    // punto claramente fuera (a medio camino vacío) no elige a ninguno.
    const r = BOARD_CANON_RECT;
    const pxScreen = { screenPx: 6, zoom: 1, scale: 14 };
    const a: CanvasElement = {
      id: 'a',
      t: 'cone',
      x: 0.4,
      y: 0.5,
      assetKind: 'cone_red',
      asset: '/assets/tactical/cone-red.png',
    };
    const b: CanvasElement = {
      id: 'b',
      t: 'cone',
      x: 0.42,
      y: 0.5,
      assetKind: 'cone_red',
      asset: '/assets/tactical/cone-red.png',
    };
    // Sobre A → A (A está más cerca; no devuelve B).
    expect(hitTestElement({ x: 0.4, y: 0.5 }, [a, b], r, 1, pxScreen)).toBe('a');
    // Sobre B → B (aunque esté a 0.02, su propia caja lo captura y es la de encima si pisa A).
    expect(hitTestElement({ x: 0.42, y: 0.5 }, [a, b], r, 1, pxScreen)).toBe('b');
    // Punto claramente fuera (a la izquierda de A): NO selecciona ninguno.
    expect(hitTestElement({ x: 0.3, y: 0.5 }, [a, b], r, 1, pxScreen)).toBeNull();
    // A zoom 2 la tolerancia NORM se reduce (misma zona de px de pantalla): los conos se
    // siguen seleccionando por separado.
    expect(
      hitTestElement({ x: 0.4, y: 0.5 }, [a, b], r, 1, { screenPx: 6, zoom: 2, scale: 14 }),
    ).toBe('a');
    expect(
      hitTestElement({ x: 0.42, y: 0.5 }, [a, b], r, 1, { screenPx: 6, zoom: 2, scale: 14 }),
    ).toBe('b');
  });

  it('materialHitHalfExtents nunca baja del mínimo táctil de ~44px y escala con size', () => {
    const cone: CanvasElement = {
      id: 'c',
      t: 'cone',
      x: 0.5,
      y: 0.5,
      assetKind: 'cone_red',
      asset: '/assets/tactical/cone-red.png',
    };
    const h = materialHitHalfExtents(cone);
    // Mínimo táctil: 4.4 unidades de viewBox → nunca por debajo.
    expect(h.hw).toBeGreaterThanOrEqual(4.4 / 92);
    expect(h.hh).toBeGreaterThanOrEqual(4.4 / (92 / (105 / 68)));
    const big: CanvasElement = { ...cone, size: 3 };
    const hb = materialHitHalfExtents(big);
    expect(hb.hh).toBeGreaterThan(h.hh);
  });

  it('screenPxToNormTolerance convierte px de pantalla a norm según zoom y reduce con la magnificación', () => {
    const r = BOARD_CANON_RECT;
    // 10 px/unidad de viewBox, zoom 1 (escala típica de escritorio).
    const t1 = screenPxToNormTolerance({ zoom: 1, scale: 10, rect: r }, 4);
    expect(t1.x).toBeCloseTo(4 / (1 * 10 * r.w), 10);
    expect(t1.y).toBeCloseTo(4 / (1 * 10 * r.h), 10);
    // Misma tolerancia de pantalla (4px) con zoom 2 → la mitad de norm (D1: no crece la
    // zona de selección al acercar).
    const t2 = screenPxToNormTolerance({ zoom: 2, scale: 10, rect: r }, 4);
    expect(t2.x).toBeCloseTo(t1.x / 2, 10);
    expect(t2.y).toBeCloseTo(t1.y / 2, 10);
    // El ratón (4px) es más estricto que el táctil (9px): mismo zoom → mayor norm.
    const touch = screenPxToNormTolerance({ zoom: 1, scale: 10, rect: r }, 9);
    expect(touch.x).toBeGreaterThan(t1.x);
    expect(touch.y).toBeGreaterThan(t1.y);
    // En un zoom alto la tolerancia NORM es menor, pero los px de pantalla son los mismos.
    const hi = screenPxToNormTolerance({ zoom: 3, scale: 10, rect: r }, 4);
    expect(hi.x).toBeLessThan(t1.x);
  });

  it('FASE 9: línea y texto se seleccionan con tolerancia en PANTALLA (por zoom), no con 0.03/0.09 fijo', () => {
    const r = BOARD_CANON_RECT;
    const px = { screenPx: 8, zoom: 1, scale: 11 }; // táctil ~8px
    const line: CanvasElement = { id: 'l', t: 'line', x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5 };
    // Cerca de la línea (dentro de la tolerancia en px) → se selecciona.
    expect(hitTestElement({ x: 0.5, y: 0.5 + 0.005 }, [line], r, 1, px)).toBe('l');
    // Lejos (más que la tolerancia táctil en px, ~0.012 norm) → NO.
    expect(hitTestElement({ x: 0.5, y: 0.5 + 0.06 }, [line], r, 1, px)).toBeNull();
    // A zoom 2 la tolerancia NORM se reduce (misma zona de px) → a la misma distancia NO.
    expect(
      hitTestElement({ x: 0.5, y: 0.5 + 0.06 }, [line], r, 1, { screenPx: 8, zoom: 2, scale: 11 }),
    ).toBeNull();
    // Texto con caja: se selecciona dentro de la caja y NO fuera por la radio por defecto.
    const text: CanvasElement = { id: 't', t: 'text', x: 0.4, y: 0.4, w: 0.2, h: 0.1, v: 'X' };
    expect(hitTestElement({ x: 0.5, y: 0.45 }, [text], r, 1, px)).toBe('t');
    expect(hitTestElement({ x: 0.5, y: 0.6 }, [text], r, 1, px)).toBeNull();
  });

  // ---------- Fase 2 — unidades humanas: % ↔ normalizado y ajuste al contenido ----------

  it('normalizedToPct redondea a UNA sola decimal sin mostrar long decimals', () => {
    expect(normalizedToPct(0.3)).toBe(30);
    expect(normalizedToPct(0.2886828644501278)).toBe(28.9);
    expect(normalizedToPct(0.17287404092071612)).toBe(17.3);
    expect(normalizedToPct(0)).toBe(0);
    expect(normalizedToPct(1)).toBe(100);
    expect(normalizedToPct(0.005)).toBe(0.5); // una sola decimal
    // Nunca más de una decimal.
    const s = String(normalizedToPct(0.2886828644501278));
    expect(s.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('pctToNormalized convierte % → 0..1 sin pérdida apreciable', () => {
    expect(pctToNormalized(30)).toBeCloseTo(0.3, 10);
    expect(pctToNormalized(28.9)).toBeCloseTo(0.289, 10);
    expect(pctToNormalized(100)).toBeCloseTo(1, 10);
    expect(pctToNormalized(0)).toBe(0);
    // Round-trip % → norma → % es estable (una decimal).
    expect(normalizedToPct(pctToNormalized(28.9))).toBe(28.9);
  });

  it('parseLocalizedNumber acepta coma y punto decimal como equivalentes', () => {
    expect(parseLocalizedNumber('28.9')).toBe(28.9);
    expect(parseLocalizedNumber('28,9')).toBe(28.9);
    expect(parseLocalizedNumber(' 30 ')).toBe(30);
    expect(parseLocalizedNumber('0.3')).toBe(0.3);
    expect(parseLocalizedNumber('0,3')).toBe(0.3);
    // Entradas inválidas → NaN (no rompen la edición).
    expect(Number.isNaN(parseLocalizedNumber('abc'))).toBe(true);
    expect(Number.isNaN(parseLocalizedNumber(''))).toBe(true);
    expect(Number.isNaN(parseLocalizedNumber('12a'))).toBe(true);
  });

  it('clampNorm recorta a [min,1] y respeta un mínimo distinto de 0', () => {
    expect(clampNorm(0.5)).toBe(0.5);
    expect(clampNorm(-0.2)).toBe(0);
    expect(clampNorm(2)).toBe(1);
    expect(clampNorm(0.005, 0.02)).toBe(0.02); // min del cuadro de texto
    expect(clampNorm(0.3, 0.02)).toBe(0.3);
  });

  it('roundToOne redondea a una décima sin perder el entero', () => {
    expect(roundToOne(28.86)).toBe(28.9);
    expect(roundToOne(30)).toBe(30);
    expect(roundToOne(28.94)).toBe(28.9);
    expect(roundToOne(0.05)).toBe(0.1);
    expect(roundToOne(17.32)).toBe(17.3);
  });

  it('fitTextToContent ajusta el cuadro EXACTAMENTE al texto corto (una línea)', () => {
    // 'Corto' (5 chars) size 3 → ancho natural 5*3*0.58=8.7 unidades (w≈0.0946).
    const fit = fitTextToContent('Corto', 3, 1);
    expect(fit.w).toBeCloseTo((5 * 3 * 0.58) / 92, 3);
    // Alto de UNA línea: size + 0.4 → h≈0.057.
    expect(fit.h).toBeCloseTo((3 + 0.4) / (92 / (105 / 68)), 3);
    // No supera el campo ni queda por debajo del mínimo del cuadro.
    expect(fit.w).toBeGreaterThan(0.02);
    expect(fit.h).toBeGreaterThan(0.02);
    expect(fit.w).toBeLessThanOrEqual(1);
    expect(fit.h).toBeLessThanOrEqual(1);
  });

  it('fitTextToContent puede ENCOGER si el texto se acortó', () => {
    // Texto largo limitado por maxW → se envuelve en muchas líneas (h alto).
    const largo = fitTextToContent('Un texto bastante largo que requiere mas anchura', 3, 0.15);
    const corto = fitTextToContent('Corto', 3, 0.15);
    expect(corto.w).toBeLessThan(largo.w); // corto ocupa menos ancho
    expect(corto.h).toBeLessThan(largo.h); // y menos alto (no se envuelve)
  });

  it('fitTextToContent respeta maxW (no desborda el campo por la derecha)', () => {
    const fit = fitTextToContent(
      'Un texto muy largo que debería recortarse al ancho máximo permitido',
      3,
      0.1,
    );
    expect(fit.w).toBeCloseTo(0.1, 2); // el ancho queda limitado a maxW=0.1
    // El alto crece porque el texto se envuelve en más líneas.
    expect(fit.h).toBeGreaterThan(0.02);
  });

  it('fitTextToContent con multilínea usa el mismo contenido que el render', () => {
    const v = 'Rondos 4v2\nConservación\nPase en superioridad';
    const fit = fitTextToContent(v, 3, 1);
    // El ancho es la línea más ancha en una sola pasada y el alto cubre las 3 líneas.
    const boxW = 20 * 3 * 0.58; // 'Pase en superioridad' = 20 chars
    expect(fit.w).toBeCloseTo(boxW / 92, 2);
    const h = (3 + 2 * 3 * 1.15 + 0.4) / (92 / (105 / 68));
    expect(fit.h).toBeCloseTo(h, 2);
    expect(fit.h).toBeGreaterThan(DEFAULT_TEXT_H); // crece frente al cuadro por defecto
  });
});

describe('geometría dinámica del medio campo (52,5×68) en render y screen↔norm', () => {
  it('renderBoardSvg dibuja el medio campo en un viewBox de proporción 52,5×68 (horizontal)', () => {
    const svg = renderBoardSvg('half', [], { orientation: 'horizontal' });
    const g = fieldGeometry('half', 'horizontal');
    expect(svg).toContain(`viewBox="0 0 ${g.vbW} ${g.vbH}"`);
    // El rect del campo (el más ancho del grupo de marcas) tiene proporción 52,5/68.
    const outer = [
      ...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g),
    ]
      .map((m) => ({ w: +m[3], h: +m[4] }))
      .find((r) => Math.abs(r.w - g.rect.w) < 0.01 && Math.abs(r.h - g.rect.h) < 0.01);
    expect(outer).toBeDefined();
    expect(outer!.w / outer!.h).toBeCloseTo(52.5 / 68, 4);
  });

  it('renderBoardSvg dibuja el medio campo vertical (portería arriba) sin deformar', () => {
    const svg = renderBoardSvg('half', [], { orientation: 'vertical' });
    const g = fieldGeometry('half', 'vertical');
    expect(svg).toContain(`viewBox="0 0 ${g.vbW} ${g.vbH}"`);
    expect(svg).toContain('rotate(90)');
    // El bbox del campo tras la rotación es ancho×alto = 68×52,5.
    const outer = [
      ...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g),
    ]
      .map((m) => ({ w: +m[3], h: +m[4] }))
      .find((r) => Math.abs(r.w - g.rect.w) < 0.01 && Math.abs(r.h - g.rect.h) < 0.01);
    expect(outer).toBeDefined();
    // Tras rotar (largo→Y), el ancho renderizado es la altura del rect y viceversa.
    expect(outer!.h / outer!.w).toBeCloseTo(68 / 52.5, 4);
  });

  it('round-trip norm→pantalla→norm es la identidad en el medio campo horizontal', () => {
    const hosts: HostRect[] = [
      { left: 10, top: 87, width: 1340, height: 750 },
      { left: 0, top: 0, width: 390, height: 844 },
    ];
    const zooms = [1, 1.5, 2, 3];
    const pans: Array<[number, number]> = [
      [0, 0],
      [30, 20],
      [-50, -35],
    ];
    const pts: Array<[number, number]> = [
      [0.4, 0.5],
      [0.1, 0.2],
      [0.9, 0.8],
    ];
    for (const host of hosts) {
      const g = fieldGeometry('half', 'horizontal');
      for (const zoom of zooms) {
        for (const [panX, panY] of pans) {
          for (const [nx, ny] of pts) {
            const f = normToScreenPoint(nx, ny, host, g, panX, panY, zoom);
            const inv = screenToNorm(f.x, f.y, host, g, panX, panY, zoom);
            expect(inv.x).toBeCloseTo(nx, 3);
            expect(inv.y).toBeCloseTo(ny, 3);
          }
        }
      }
    }
  });

  it('round-trip norm→pantalla→norm es la identidad en el medio campo vertical', () => {
    const host: HostRect = { left: 0, top: 0, width: 640, height: 800 };
    const zooms = [1, 1.5, 2, 3];
    const pans: Array<[number, number]> = [
      [0, 0],
      [30, 20],
      [-50, -35],
    ];
    const pts: Array<[number, number]> = [
      [0.4, 0.5],
      [0.1, 0.2],
      [0.9, 0.8],
    ];
    const g = fieldGeometry('half', 'vertical');
    for (const zoom of zooms) {
      for (const [panX, panY] of pans) {
        for (const [nx, ny] of pts) {
          const f = normToScreenPoint(nx, ny, host, g, panX, panY, zoom);
          const inv = screenToNorm(f.x, f.y, host, g, panX, panY, zoom);
          expect(inv.x).toBeCloseTo(nx, 3);
          expect(inv.y).toBeCloseTo(ny, 3);
        }
      }
    }
  });

  it('un punto junto a la portería del medio campo vertical mapea a longitud ≈0', () => {
    const g = fieldGeometry('half', 'vertical');
    const host: HostRect = { left: 0, top: 0, width: 640, height: 800 };
    // Punto en la portería (longitud≈0, anchura 0.5) → se renderiza ARRIBA (y pequeño).
    const f = normToScreenPoint(0.02, 0.5, host, g, 0, 0, 1);
    const inv = screenToNorm(f.x, f.y, host, g, 0, 0, 1);
    expect(inv.x).toBeCloseTo(0.02, 1);
    expect(inv.y).toBeCloseTo(0.5, 1);
  });
});

describe('Fase 3/4 — trazo táctico fino y tamaño inicial reducido', () => {
  it('el trazo por defecto de cada herramienta de dibujo es ~la mitad (0.4)', () => {
    const cases: Array<[string, CanvasElement]> = [
      ['line', { id: 'x', t: 'line', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.4 }],
      ['arrow', { id: 'x', t: 'arrow', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.4 }],
      ['doubleArrow', { id: 'x', t: 'doubleArrow', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.4 }],
      ['measure', { id: 'x', t: 'measure', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.4 }],
      ['dribble', { id: 'x', t: 'dribble', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.4 }],
    ];
    for (const [name, el] of cases) {
      const svg = renderBoardSvg('full', [el], {});
      expect(svg, `grosor por defecto de ${name}`).toContain(
        `stroke-width="${DEFAULT_STROKE_WIDTH}"`,
      );
    }
    const curve = renderBoardSvg(
      'full',
      [{ id: 'x', t: 'curve', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.4 }],
      {},
    );
    expect(curve).toContain(`stroke-width="${DEFAULT_STROKE_WIDTH}"`);
    const freehand = renderBoardSvg(
      'full',
      [
        {
          id: 'f',
          t: 'freehand',
          points: [
            [0.2, 0.2],
            [0.6, 0.4],
          ],
        },
      ],
      {},
    );
    expect(freehand).toContain(`stroke-width="${DEFAULT_STROKE_WIDTH}"`);
  });

  it('el contorno nuevo de rect/elipse/zona es 0.2', () => {
    for (const t of ['rect', 'ellipse', 'zone'] as const) {
      const el: CanvasElement = { id: 's', t, x: 0.2, y: 0.2, w: 0.3, h: 0.2, c: '#ffffff' };
      const svg = renderBoardSvg('full', [el], {});
      expect(svg, `contorno de ${t}`).toContain(`stroke-width="${DEFAULT_SHAPE_STROKE}"`);
    }
  });

  it('la punta de flecha es proporcional al grosor (0.8 → 2.8, default 0.2 → 0.7)', () => {
    expect(arrowHeadSize(0.8)).toBeCloseTo(2.8, 6);
    expect(arrowHeadSize(DEFAULT_STROKE_WIDTH)).toBeCloseTo(
      DEFAULT_STROKE_WIDTH * ARROW_HEAD_FACTOR,
      6,
    );
    expect(arrowHeadSize(DEFAULT_STROKE_WIDTH)).toBeCloseTo(0.7, 6);
    // Una flecha horizontal: la punta (polygon) usa size = dx_entre punta y base / cos(0.5).
    const headSize = (svg: string): number => {
      const m = /<polygon points="([^"]+)"/.exec(svg);
      expect(m, 'la punta de flecha (polygon) está en el SVG').not.toBeNull();
      const [tip, p1] = m![1].split(' ').map((pt) => pt.split(',').map(Number));
      // En horizontal, la base retrocede en X el mismo tamaño que en la Y de la base.
      const dx = Math.abs(tip[0] - p1[0]);
      return dx / Math.cos(0.5);
    };
    const thin = renderBoardSvg(
      'full',
      [{ id: 'a', t: 'arrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3 }],
      {},
    );
    const thick = renderBoardSvg(
      'full',
      [{ id: 'a', t: 'arrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3, strokeWidth: 0.8 }],
      {},
    );
    // El default (0.4) produce una punta más pequeña que la de un trazo 0.8 antiguo.
    expect(headSize(thin)).toBeLessThan(headSize(thick));
    expect(headSize(thin)).toBeCloseTo(arrowHeadSize(DEFAULT_STROKE_WIDTH), 5);
    expect(headSize(thick)).toBeCloseTo(arrowHeadSize(0.8), 5);
  });

  it('respeta el grosor EXPLÍCITO de un documento antiguo (no lo cambia)', () => {
    const arrow = renderBoardSvg(
      'full',
      [{ id: 'a', t: 'arrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3, strokeWidth: 1.2 }],
      {},
    );
    expect(arrow).toContain('stroke-width="1.2"');
  });

  it('el tamaño del texto es un valor fijo (Fase 3 reduce materiales/players, no el texto) y "Texto" cabe en una línea', () => {
    // Decisión del dueño (Fase 3): se reducen los objetos puntuales/materiales/players a
    // MATERIAL_SIZE_RATIO (0.60), pero el TEXTO usa un tamaño tipográfico propio constante
    // (2.25) para seguir siendo legible. Ya no se deriva de MATERIAL_SIZE_RATIO.
    expect(DEFAULT_TEXT_SIZE).toBe(3 * 0.75);
    const boxW = DEFAULT_TEXT_W * 92;
    expect(wrapTextForBox('Texto', boxW, DEFAULT_TEXT_SIZE)).toEqual(['Texto']);
  });
});

describe('Fase 4/6 — flecha normal, doble y zigzag (geometría de puntas)', () => {
  const g = fieldGeometry('full', 'horizontal').rect;
  /** Devuelve los polígonos de punta (tip, p1, p2) del SVG renderizado. */
  function heads(svg: string): Array<Array<[number, number]>> {
    const out: Array<Array<[number, number]>> = [];
    const re = /<polygon points="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) {
      out.push(m![1].split(' ').map((pt) => pt.split(',').map(Number) as [number, number]));
    }
    return out;
  }

  it('la flecha normal tiene EXACTAMENTE una punta en el extremo final', () => {
    const svg = renderBoardSvg(
      'full',
      [{ id: 'a', t: 'arrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3, c: '#e11d48' }],
      {},
    );
    const h = heads(svg);
    expect(h).toHaveLength(1);
    const [tip] = h[0];
    // El extremo final en píxeles: px(0.8)=0.8*92+4.
    expect(tip[0]).toBeCloseTo(0.8 * 92 + 4, 4);
    expect(tip[1]).toBeCloseTo(0.3 * g.h + g.y, 4);
  });

  it('la flecha doble tiene EXACTAMENTE dos puntas simétricas, una en cada extremo', () => {
    const svg = renderBoardSvg(
      'full',
      [{ id: 'd', t: 'doubleArrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3, c: '#e11d48' }],
      {},
    );
    const h = heads(svg);
    expect(h).toHaveLength(2);
    const tip0 = h[0][0];
    const tip1 = h[1][0];
    expect(tip0[0]).toBeCloseTo(0.8 * 92 + 4, 4); // punta en el extremo final
    expect(tip1[0]).toBeCloseTo(0.2 * 92 + 4, 4); // punta en el extremo inicial
    expect(tip0[1]).toBeCloseTo(tip1[1], 4); // misma Y → simétricas en horizontal
    // Simetría: la distancia tip↔base es la misma en ambas puntas.
    const size0 = Math.hypot(tip0[0] - h[0][1][0], tip0[1] - h[0][1][1]);
    const size1 = Math.hypot(tip1[0] - h[1][1][0], tip1[1] - h[1][1][1]);
    expect(size0).toBeCloseTo(size1, 4);
  });

  it('el tamaño de las puntas depende del grosor del trazo en ambos extremos', () => {
    const thin = renderBoardSvg(
      'full',
      [{ id: 'd', t: 'doubleArrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3 }],
      {},
    );
    const thick = renderBoardSvg(
      'full',
      [{ id: 'd', t: 'doubleArrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3, strokeWidth: 0.8 }],
      {},
    );
    const hs = heads(thin)[0];
    const hk = heads(thick)[0];
    const sizeThin = Math.hypot(hs[0][0] - hs[1][0], hs[0][1] - hs[1][1]);
    const sizeThick = Math.hypot(hk[0][0] - hk[1][0], hk[0][1] - hk[1][1]);
    expect(sizeThin).toBeLessThan(sizeThick);
  });

  it('el zigzag termina exactamente en x2/y2 y lleva punta orientada a su último tramo', () => {
    const svg = svgZigzag(0.2, 0.3, 0.8, 0.6, '#111111', false, DEFAULT_STROKE_WIDTH, 'solid', g);
    // El path debe terminar EXACTAMENTE en el punto final en píxeles (ax2,ay2).
    const path = /<path d="([^"]+)"/.exec(svg);
    expect(path).not.toBeNull();
    const coords =
      path![1].match(/[^ML ]+ [^ ]+/g)?.map((pt) => pt.trim().split(' ').map(Number)) ?? [];
    const last = coords[coords.length - 1];
    expect(last![0]).toBeCloseTo(0.8 * 92 + 4, 4);
    expect(last![1]).toBeCloseTo(0.6 * g.h + g.y, 4);
    // Hay una punta (polygon) unida al final.
    const h = heads(svg);
    expect(h).toHaveLength(1);
    expect(h[0][0][0]).toBeCloseTo(0.8 * 92 + 4, 4);
  });

  it('el zigzag funciona en cualquier dirección y trazo corto (sin punta descolgada)', () => {
    const cases: Array<[number, number, number, number]> = [
      [0.8, 0.6, 0.2, 0.6], // horizontal inverso
      [0.5, 0.2, 0.5, 0.8], // vertical
      [0.2, 0.2, 0.8, 0.8], // diagonal
      [0.49, 0.5, 0.51, 0.51], // trazo corto
    ];
    for (const [x1, y1, x2, y2] of cases) {
      const svg = svgZigzag(x1, y1, x2, y2, '#e11d48', false, 1.2, 'solid', g);
      const h = heads(svg);
      expect(h).toHaveLength(1);
      expect(h[0][0][0]).toBeCloseTo(x2 * 92 + 4, 2);
      expect(h[0][0][1]).toBeCloseTo(y2 * g.h + g.y, 2);
      // Color aplicado a punta y trazo.
      expect(svg).toContain('stroke="#e11d48"');
      expect(svg).toContain('fill="#e11d48"');
    }
  });

  it('un zigzag corto conserva al menos cuatro tramos y el discontinuo prioriza tinta', () => {
    const short = svgZigzag(0.49, 0.5, 0.51, 0.5, '#ffffff', false, 0.2, 'solid', g);
    const path = /<path d="([^"]+)"/.exec(short)!;
    expect((path[1].match(/L /g) ?? []).length).toBeGreaterThanOrEqual(4);
    const dashed = svgZigzag(0.2, 0.3, 0.8, 0.3, '#ffffff', false, 0.2, 'dashed', g);
    // CAMBIO DE CONTRATO VISUAL (encargo del dueño, 23/09/2026): el patrón discontinuo era
    // `2.4,0.7` (guion muy largo, hueco diminuto: la línea parecía casi continua). Ahora es
    // `1.2,0.8`, así que la discontinuidad se repite mucho más a menudo. El valor vive en
    // `DASH_PATTERN`, que es la FUENTE ÚNICA para línea, flecha, conducción, curva y preview.
    expect(dashed).toContain(`stroke-dasharray="${DASH_PATTERN}"`);
    expect(DASH_PATTERN, 'el guion es más corto que el hueco: se lee discontinuo de verdad').toBe(
      '1.2,0.8',
    );
  });

  it('la CURVA admite trazo discontinuo y de puntos; la continua no lleva dasharray', () => {
    // Encargo del dueño (23/09/2026): «la línea curva a izquierda y derecha pueda ponerse en línea
    // discontinua». Antes el `case 'curve'` dibujaba el `path` sin mirar `lineStyle`.
    const curva = (extra: Partial<CanvasElement>): CanvasElement => ({
      id: 'c1',
      t: 'curve',
      x1: 0.2,
      y1: 0.5,
      x2: 0.8,
      y2: 0.5,
      c1x: 0.5,
      c1y: 0.3,
      c: '#ffffff',
      ...extra,
    });
    const continuo = renderBoardSvg('full', [curva({})], {});
    expect(continuo, 'la curva continua no lleva dasharray').not.toMatch(
      /<path[^>]*stroke-dasharray/,
    );
    for (const estilo of ['dashed', 'dotted'] as const) {
      const svg = renderBoardSvg('full', [curva({ lineStyle: estilo })], {});
      expect(svg, `la curva con lineStyle ${estilo} lleva dasharray`).toMatch(
        /<path[^>]*stroke-dasharray/,
      );
      // Y usa el MISMO patrón que la línea: son la misma constante.
      const esperado = estilo === 'dashed' ? DASH_PATTERN : '0.6,1.4';
      expect(svg).toContain(`stroke-dasharray="${esperado}"`);
    }
    // Compatibilidad: los documentos antiguos guardan el estilo en `style`, no en `lineStyle`.
    const antiguo = renderBoardSvg('full', [curva({ style: 'dashed' })], {});
    expect(antiguo, 'la curva antigua con `style: dashed` también sale discontinua').toContain(
      `stroke-dasharray="${DASH_PATTERN}"`,
    );
  });

  it('el zigzag NUEVO (Fase 6) tiene ~el doble de picos que el anterior para una longitud representativa', () => {
    // Longitud representativa: 0.2..0.8 horizontal → len = 0.6*92 ≈ 55.2 px.
    const svg = svgZigzag(0.2, 0.3, 0.8, 0.3, '#111111', false, DEFAULT_STROKE_WIDTH, 'solid', g);
    const path = /<path d="([^"]+)"/.exec(svg)!;
    // Nº de vértices (M + L) = 1 + nº de picos intermedios. Antes: n=round(len/6)=9→cap 8;
    // ahora n=round(len/3)=18→cap 16. Para len≈55.2, n_new=round(18.4)=18→cap 16.
    const segs = (path[1].match(/L /g) ?? []).length;
    expect(segs, 'picos intermedios del zigzag nuevo').toBeGreaterThanOrEqual(14);
  });

  it('la punta del zigzag coincide EXACTAMENTE con el extremo final dibujado', () => {
    const svg = svgZigzag(0.2, 0.3, 0.8, 0.6, '#0f766e', false, 1.2, 'solid', g);
    const h = heads(svg);
    expect(h).toHaveLength(1);
    expect(h[0][0][0]).toBeCloseTo(0.8 * 92 + 4, 4);
    expect(h[0][0][1]).toBeCloseTo(0.6 * g.h + g.y, 4);
  });

  it('el zigzag no produce NaN/Infinity ni geometría degenerada (horizontal/vertical/diagonal/corto)', () => {
    const cases: Array<[number, number, number, number]> = [
      [0.2, 0.3, 0.8, 0.3], // horizontal
      [0.3, 0.2, 0.3, 0.8], // vertical
      [0.2, 0.2, 0.8, 0.8], // diagonal
      [0.49, 0.5, 0.51, 0.51], // muy corto
      [0.5, 0.5, 0.5, 0.5], // degenerada (punto)
    ];
    for (const [x1, y1, x2, y2] of cases) {
      const svg = svgZigzag(x1, y1, x2, y2, '#111111', false, 1.2, 'solid', g);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      // Los dos extremos del path deben ser finitos y coincidir con el punto final.
      const path = /<path d="([^"]+)"/.exec(svg)!;
      const coords =
        path[1].match(/[^ML ]+ [^ ]+/g)?.map((pt) => pt.trim().split(' ').map(Number)) ?? [];
      for (const c of coords) {
        expect(Number.isFinite(c[0])).toBe(true);
        expect(Number.isFinite(c[1])).toBe(true);
      }
    }
  });

  it('Bloque F #21 — línea y flecha con trazo DISCONTINUO se renderizan con stroke-dasharray; las continuas no', () => {
    const dashedLine: CanvasElement = {
      id: 'l1',
      t: 'line',
      x1: 0.2,
      y1: 0.4,
      x2: 0.8,
      y2: 0.4,
      style: 'dashed',
    };
    const solidArrow: CanvasElement = {
      id: 'a1',
      t: 'arrow',
      x1: 0.2,
      y1: 0.6,
      x2: 0.8,
      y2: 0.6,
      style: 'solid',
    };
    const dashedArrow: CanvasElement = {
      id: 'a2',
      t: 'arrow',
      x1: 0.2,
      y1: 0.7,
      x2: 0.8,
      y2: 0.7,
      style: 'dashed',
    };
    // Línea discontinua → dasharray.
    const svgLine = renderBoardSvg('full', [dashedLine], {});
    expect(svgLine, 'la línea discontinua lleva stroke-dasharray').toContain('stroke-dasharray');
    // Flecha SOLID (continua) → SIN dasharray.
    const svgArrowSolid = renderBoardSvg('full', [solidArrow], {});
    expect(svgArrowSolid, 'la flecha continua NO lleva dasharray').not.toMatch(
      /<line[^>]*stroke-dasharray/,
    );
    // Flecha discontinua → dasharray.
    const svgArrowDash = renderBoardSvg('full', [dashedArrow], {});
    expect(svgArrowDash, 'la flecha discontinua lleva dasharray').toMatch(
      /<line[^>]*stroke-dasharray/,
    );
  });

  // Pedido del dueño: los objetos NO deben salir girados al cambiar de campo. Un cono tiene
  // siempre la base hacia abajo en pantalla, y portería, miniportería, escalera y pica conservan
  // siempre su orientación, sea cual sea el tipo y la orientación del campo. Líneas, flechas y
  // figuras SÍ giran con el campo (son dibujo táctico, van pegadas al terreno).
  describe('materiales siempre derechos por pantalla (independiente del campo)', () => {
    const materiales: CanvasElement[] = [
      { id: 'c1', t: 'cone', x: 0.3, y: 0.4 },
      { id: 'g1', t: 'goal', x: 0.5, y: 0.4 },
      { id: 'm1', t: 'minigoal', x: 0.5, y: 0.6 },
      { id: 'l1', t: 'ladder', x: 0.7, y: 0.5 },
      { id: 'p1', t: 'pica', x: 0.4, y: 0.6 },
    ];

    it('cono, pica y maniquí ignoran la rotación antigua del objeto', () => {
      for (const t of ['cone', 'pole', 'pica', 'mannequin', 'mannequin_row'] as const) {
        const el: CanvasElement = { id: t, t, x: 0.5, y: 0.5, rot: 90 };
        const horizontal = renderBoardSvg('full', [el], { orientation: 'horizontal' });
        expect(horizontal, `${t} no debe quedar tumbado`).not.toContain('rotate(90 ');
        const vertical = renderBoardSvg('full', [el], { orientation: 'vertical' });
        const grupo = (vertical.match(new RegExp(`<g [^>]*data-el-type="${t}"[^>]*>`)) ?? [''])[0];
        expect(grupo, `${t} se endereza también con el campo vertical`).toMatch(/rotate\(-90 /);
      }
      const pngAntiguo: CanvasElement = {
        id: 'cono-png',
        t: 'cone',
        x: 0.5,
        y: 0.5,
        rot: 270,
        asset: 'assets/tactic/cone-red.png',
      };
      expect(renderBoardSvg('full', [pngAntiguo], {})).not.toContain('rotate(270 ');
    });

    it('en campo vertical cada material se contrarrota -90° sobre su punto', () => {
      const svg = renderBoardSvg('full', materiales, { orientation: 'vertical' });
      const grupos = svg.match(/<g [^>]*data-el-type[^>]*>/g) ?? [];
      expect(grupos, 'hay un grupo por material').toHaveLength(materiales.length);
      for (const g of grupos) {
        expect(g, `material derecho por pantalla: ${g.slice(0, 60)}`).toMatch(
          /rotate\(-90 [\d.]+ [\d.]+\)/,
        );
      }
      // Y en horizontal NO hay contrarrotación: el dibujo ya está derecho.
      const svgH = renderBoardSvg('full', materiales, {});
      for (const g of svgH.match(/<g [^>]*data-el-type[^>]*>/g) ?? []) {
        expect(g, 'en horizontal no se contrarrota').not.toMatch(/rotate\(-90/);
      }
    });

    it('líneas, flechas y figuras giran con el campo (no se contrarrotan)', () => {
      const geo: CanvasElement[] = [
        { id: 'l1', t: 'line', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.3 },
        { id: 'a1', t: 'arrow', x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5 },
        { id: 'r1', t: 'rect', x: 0.2, y: 0.6, w: 0.2, h: 0.1 },
        { id: 't1', t: 'zone', x: 0.5, y: 0.8, w: 0.2, h: 0.1 },
      ];
      const svg = renderBoardSvg('full', geo, { orientation: 'vertical' });
      for (const g of svg.match(/<g [^>]*data-el-type[^>]*>/g) ?? []) {
        expect(g, 'el dibujo táctico NO se contrarrota').not.toMatch(/rotate\(-90 [\d.]+ [\d.]+\)/);
      }
    });

    it('la contrarrotación no depende del TIPO de campo (medio campo, futsal, F7, lienzo)', () => {
      for (const campo of [
        'half',
        'third',
        'box',
        'futsal',
        'f7',
        'two_halves',
        'blank',
      ] as const) {
        const svg = renderBoardSvg(campo, [{ id: 'c1', t: 'cone', x: 0.5, y: 0.5 }], {
          orientation: 'vertical',
        });
        const grupo = (svg.match(/<g [^>]*data-el-type="cone"[^>]*>/) ?? [''])[0];
        expect(grupo, `el cono se ve derecho en ${campo}`).toMatch(/rotate\(-90 [\d.]+ [\d.]+\)/);
      }
    });
  });

  describe('FASE 8C — la portería grande es una portería FRONTAL, no una escalera', () => {
    const svgPorteria = () => {
      const svg = renderBoardSvg('full', [{ id: 'g1', t: 'goal', x: 0.5, y: 0.5 }], {});
      return (svg.match(/<g [^>]*data-el-type="goal"[^>]*>[\s\S]*?<\/g>/) ?? [''])[0];
    };
    /** Rectángulos del dibujo con sus medidas numéricas (los flotantes salen como 2.4800000000000004:
     *  comparar cadenas exactas hacía fallar la prueba por formateo, no por dibujo). */
    const rectangulos = (g: string) =>
      [...g.matchAll(/<rect ([^>]*?)\/>/g)].map((m) => {
        const attrs = m[1];
        const num = (name: string) =>
          Number(new RegExp(`${name}="([\\d.eE+-]+)"`).exec(attrs)?.[1] ?? NaN);
        return { x: num('x'), y: num('y'), w: num('width'), h: num('height'), relleno: attrs };
      });
    const caminos = (g: string) =>
      [...g.matchAll(/<path d="([^"]+)"([^>]*?)\/>/g)].map((m) => ({ d: m[1], attrs: m[2] }));

    it('tiene larguero y dos postes GRUESOS y su anchura es la REGLAMENTARIA del campo', () => {
      const g = svgPorteria();
      expect(g, 'se dibuja la portería').not.toBe('');
      const rects = rectangulos(g);
      // CAMBIO DE CONTRATO (encargo de materiales, FASE 3): la anchura ya no es la constante 6,6
      // heredada, sino la REGLAMENTARIA del campo activo (7,32 m × PX_PER_M ≈ 6,41 unidades en F11),
      // justo para que coincida con la portería dibujada en el campo. El marco es proporcionalmente
      // más grueso (antes 0,28 fijo).
      const larguero = rects.find((r) => r.w > 6 && r.h < 0.6);
      expect(larguero, 'larguero horizontal ancho y fino').toBeTruthy();
      const grosor = larguero!.h;
      const postes = rects.filter((r) => Math.abs(r.w - grosor) < 0.001 && r.h > 1.5);
      expect(postes.length, 'dos postes verticales').toBe(2);
      // Los postes bajan desde el larguero hasta la línea de suelo: mismo alto los dos.
      expect(Math.abs(postes[0].h - postes[1].h)).toBeLessThan(0.001);
      // Marco GRUESO respecto a la anchura (no una línea fina).
      expect(grosor / larguero!.w, 'marco grueso').toBeGreaterThan(0.04);
    });

    it('su anchura coincide con la portería del campo y cambia con el TIPO de campo', () => {
      // FASE 3: criterio medible — anchura de la portería de MATERIAL = anchura reglamentaria del
      // campo (7,32 m F11 · 6 m F7 · 3 m fútbol sala) × PX_PER_M. Aquí en unidades del viewBox.
      const ancho = (campo: 'full' | 'f7' | 'futsal'): number => {
        const svg = renderBoardSvg(campo, [{ id: 'g', t: 'goal', x: 0.5, y: 0.5 }], {});
        const g = (svg.match(/<g [^>]*data-el-type="goal"[^>]*>[\s\S]*?<\/g>/) ?? [''])[0];
        const fondo = rectangulos(g).find((r) => r.relleno.includes('#ffffff1f'));
        expect(fondo, `fondo de red en ${campo}`).toBeTruthy();
        // El rect va DENTRO del grupo escalado: la anchura DIBUJADA es atributo × escala del grupo.
        const escala = Number(/scale\(([\d.]+)\)/.exec(g)?.[1] ?? '1');
        return fondo!.w * escala;
      };
      const anchoF11 = ancho('full');
      expect(anchoF11, 'F11: 7,32 m').toBeCloseTo((7.32 * 92) / 105, 1);
      // En F7 la portería DIBUJADA es la del medio campo F11 que sirve de fondo (el diseño F7 dibuja
      // zonas, no una portería propia), así que la de material usa la MISMA anchura para coincidir.
      expect(ancho('f7'), 'F7: la portería visible es la del F11').toBeCloseTo(
        (7.32 * 92) / 105,
        1,
      );
      expect(ancho('futsal'), 'fútbol sala: 3 m (mucho más estrecha)').toBeCloseTo(
        (3 * 92) / 105,
        1,
      );
      expect(ancho('futsal'), 'la de fútbol sala es la menor').toBeLessThan(anchoF11);
    });

    it('tiene RED de malla legible (sin diagonales y sin masa de líneas)', () => {
      const g = svgPorteria();
      // Las dos capas de red: dos <path> con trazo fino proporcional a la anchura.
      const malla = caminos(g).filter((p) => /stroke-width="0\.1\d*"/.test(p.attrs));
      expect(malla.length, 'dos capas de red (verticales y horizontales)').toBe(2);
      const verticales = (malla[0].d.match(/M/g) ?? []).length;
      const horizontales = (malla[1].d.match(/M/g) ?? []).length;
      // Red LEGIBLE al reducirse: pocas líneas (antes 11 + 4 se convertían en una masa gris).
      expect(verticales, 'entre 4 y 8 verticales de red').toBeGreaterThanOrEqual(4);
      expect(verticales).toBeLessThanOrEqual(8);
      expect(horizontales, 'entre 2 y 3 horizontales de red').toBeGreaterThanOrEqual(2);
      expect(horizontales).toBeLessThanOrEqual(3);
      // Las líneas de red son AXIS-ALINEADAS: una escalera o el antiguo aspa en X tendrían
      // diagonales, que es justo lo que hacía que la portería se confundiera con una escalera.
      const coords = [
        ...malla
          .map((p) => p.d)
          .join(' ')
          .matchAll(/M([-\d.]+) ([-\d.]+) L([-\d.]+) ([-\d.]+)/g),
      ];
      expect(coords.length, 'la red tiene todas sus líneas').toBe(verticales + horizontales);
      for (const [, ax, ay, bx, by] of coords) {
        expect(ax === bx || ay === by, `sin diagonales (${ax},${ay}→${bx},${by})`).toBe(true);
      }
    });

    it('mantiene proporción realista (≈3:1), fondo transparente y sin relleno blanco grande', () => {
      const g = svgPorteria();
      const rects = rectangulos(g);
      const fondoRed = rects.find((r) => r.relleno.includes('#ffffff1f'));
      expect(fondoRed, 'fondo de red tenue').toBeTruthy();
      expect(fondoRed!.w / fondoRed!.h, 'proporción 3:1 de portería reglamentaria').toBeGreaterThan(
        2.8,
      );
      expect(fondoRed!.w / fondoRed!.h).toBeLessThan(3.2);
      // Ningún rectángulo blanco OPACO grande: los únicos blancos son larguero y postes.
      // CAMBIO DE CONTRATO (encargo de materiales, FASE 4): el marco es proporcionalmente más GRUESO
      // para que la portería no se confunda con una escalera al reducirse, así que el límite se mide
      // como fracción de la anchura (≤ 6 %) y no con la constante 0,28 de antes.
      const blancos = rects.filter((r) => /fill="#ffffff"/.test(r.relleno));
      expect(blancos.length, 'larguero y dos postes').toBe(3);
      for (const r of blancos)
        expect(
          Math.min(r.w, r.h) / fondoRed!.w,
          'marco fino respecto a la anchura',
        ).toBeLessThanOrEqual(0.06);
    });

    it('la caja táctil de la portería coincide con el marco REGLAMENTARIO', () => {
      // CAMBIO DE CONTRATO (encargo de materiales, FASE 3): la caja táctil de la portería ya no sale
      // del tamaño genérico (`TACTICAL_BBOX.goal`), sino de la caja reglamentaria del campo
      // (7,32 × 2,44 m → proporción 3:1), que es lo que se dibuja. Aquí se comprueba que con el
      // campo indicado la caja es la del dibujo; sin campo se mantiene la caja histórica.
      const R = BOARD_CANON_RECT;
      const porteria: CanvasElement = { id: 'g', t: 'goal', x: 0.5, y: 0.5 };
      // `pxTol` a cero: sin el MÍNIMO TÁCTIL, que es lo que interesa medir aquí (la caja de la
      // figura); con el mínimo, una portería pequeña se agranda hasta ~44 px de área táctil.
      const sinMinimo = { x: 0, y: 0 };
      const conCampo = materialHitHalfExtents(porteria, R, 1, sinMinimo, false, 'full');
      const dibujo = goalBoxUnits('full');
      // La caja se devuelve NORMALIZADA (0..1): para compararla con la geometría hay que volver a
      // unidades multiplicando por el rect del campo.
      expect(conCampo.hw * 2 * R.w, 'ancho de la caja = ancho reglamentario').toBeCloseTo(
        dibujo.w,
        5,
      );
      expect(conCampo.hh * 2 * R.h, 'alto de la caja = alto reglamentario').toBeCloseTo(
        dibujo.h,
        5,
      );
      // Y en fútbol sala la caja (y el dibujo) son más pequeños.
      const enFutsal = materialHitHalfExtents(porteria, R, 1, sinMinimo, false, 'futsal');
      expect(enFutsal.hw * 2 * R.w, 'portería de fútbol sala más estrecha').toBeLessThan(
        conCampo.hw * 2 * R.w,
      );
      expect(enFutsal.hw * 2 * R.w).toBeCloseTo(goalBoxUnits('futsal').w, 5);
      // Sin campo se conserva el comportamiento histórico (compatibilidad de llamadas antiguas).
      const sinCampo = materialHitHalfExtents(porteria, R, 1);
      expect(sinCampo.hw).toBeGreaterThan(0);
    });
  });
});
