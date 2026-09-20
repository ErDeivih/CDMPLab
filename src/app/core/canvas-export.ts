import { CanvasDocument, CanvasElement, FieldType } from './models';
import { renderBoardSvg } from './render';
import { inlineSvgAssets } from './asset-inline';
import { fieldSurface } from './field';

// =============================================================
// EntrenoLab — Exportación de imágenes de la pizarra (PNG / miniatura).
// Antes este módulo se llamaba `animation` y también contenía la exportación
// de GIF y la interpolación de frames. La animación quedó DIFERIDA por decisión
// del dueño: la pizarra es solo estática. Aquí solo vive lo que aún se usa:
// exportar un PNG y generar la miniatura del ejercicio al guardar.
// =============================================================

/**
 * Fondo del lienzo que se exporta (PNG o miniatura).
 *
 * CORRECCIÓN URGENTE (dueño): el fútbol sala tiene superficie AZUL LISA impuesta por el render
 * (`fieldSurface`), así que el lienzo NO puede rellenarse con el césped verde que traía el
 * documento: quedaba un marco verde de césped alrededor del campo azul. Para el fútbol sala el
 * fondo es siempre su superficie; en el resto se respeta el color pedido (comportamiento anterior).
 */
function fondoDeExport(fieldType: FieldType, pedido?: string): string {
  if (fieldType === 'futsal') return fieldSurface('futsal').color;
  return pedido ?? fieldSurface(fieldType).color;
}

export interface ExportPngOptions {
  width: number;
  height: number;
  backgroundColor?: string;
  lineColor?: string;
  transparent?: boolean;
  orientation?: 'horizontal' | 'vertical';
  grid?: boolean;
  guide?: 'none' | '2x2' | '3x3' | 'thirds' | 'lanes';
  grass?: 'stripes' | 'plain' | 'checker';
}

/**
 * ¿La imagen del SVG se puede dibujar? Puro y probable.
 *
 * DEFECTO CORREGIDO: antes se comprobaba `img.complete && naturalWidth > 0` y, si NO se
 * cumplía, se pintaba igualmente el canvas (solo con el fondo). El resultado era una
 * miniatura con el campo y SIN los objetos colocados, indistinguible de una miniatura
 * buena. Ahora se lanza un error para que `generateThumbnail` devuelva `null` y la tarjeta
 * use el diagrama SVG en vivo (que siempre muestra los objetos).
 */
export function imageCargada(img: { complete: boolean; naturalWidth: number }): boolean {
  return img.complete && img.naturalWidth > 0;
}

/** Exporta un frame estático a dataURL de imagen PNG. */
export async function exportPng(
  fieldType: FieldType,
  elements: CanvasElement[],
  opts: ExportPngOptions
): Promise<string> {
  const svg = await inlineSvgAssets(
    renderBoardSvg(fieldType, elements, {
      backgroundColor: opts.transparent ? undefined : opts.backgroundColor,
      lineColor: opts.lineColor,
      orientation: opts.orientation,
      grid: opts.grid,
      guide: opts.guide,
      grass: opts.grass,
      transparent: opts.transparent,
    }).replace(
      'class="entrenolab-board"',
      `width="${opts.width}" height="${opts.height}" class="entrenolab-board"`
    )
  );
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  // Nunca devolver una imagen con solo el fondo: mejor `null` (fallback limpio en la UI).
  if (!imageCargada(img)) throw new Error('svg_no_cargado');
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no ctx');
  if (opts.transparent) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = fondoDeExport(fieldType, opts.backgroundColor);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, opts.width, opts.height);
  return canvas.toDataURL('image/png');
}

/** Genera una miniatura PNG (dataURL) del primer frame de un documento. */
export async function generateThumbnail(doc: CanvasDocument | null): Promise<string | null> {
  if (!doc || !doc.frames?.length) return null;
  const els = doc.frames[0].elements ?? [];
  if (els.length === 0) return null;
  try {
    // Miniatura en la orientación del documento (vertical → retrato), no siempre paisaje.
    const isVertical = doc.orientation === 'vertical';
    return await exportPng(doc.field, els, {
      width: isVertical ? 384 : 480,
      height: isVertical ? 480 : 384,
      backgroundColor: fondoDeExport(doc.field, doc.backgroundColor),
      lineColor: doc.lineColor ?? '#ffffff',
      orientation: doc.orientation,
      grid: Boolean(doc.grid),
      guide: doc.guide ?? 'none',
    });
  } catch {
    return null;
  }
}
