// =============================================================
// EntrenoLab — Inline de assets de material para exportación.
//
// Una imagen SVG embebida como data URL NO puede cargar subrecursos externos (por seguridad del
// navegador los SVG cargados vía <img> o data URL corren en modo "sin recursos externos"). Por
// tanto, los <image href="assets/tactical/*.png"> NUNCA se dibujaban en el PNG exportado ni en la
// miniatura. Esta utilidad sustituye cada href por un data URL base64 del PNG.
//
// DISEÑO CORREGIDO (revisión externa del informe): la primera versión sustituía un asset que no se
// podía leer por un PNG TRANSPARENTE de 1×1. Eso conseguía `naturalWidth > 0`, pero hacía
// DESAPARECER el material: una miniatura que cambia un cono por transparencia NO es correcta y no
// puede darse por buena. Ahora, si un asset no se puede leer:
//   · NO se sustituye por transparencia, y
//   · se dibuja un FALLBACK VECTORIAL reconocible (triángulo para los conos, rectángulo redondeado
//     para el resto) del color del propio material, en la MISMA caja donde estaba la imagen.
// Así la posición del material sigue representada, el SVG sigue siendo autocontenido (no queda
// ninguna referencia externa) y nunca se miente diciendo que hay una imagen que no existe.
//
// Los fallos NO se cachean: un corte transitorio (red, caché, despliegue a medias) no debe
// envenenar el resto de la sesión.
// =============================================================

import { TACTIC_ASSETS } from './tactic-assets';

/** `href`/`xlink:href` a un asset táctico, con comillas simples o dobles. */
const ATTR_RE = /((?:xlink:)?href)=(["'])(\/?assets\/tactical\/[^"']+\.png)\2/g;

/** Elemento `<image …>` completo (para poder sustituirlo entero por el fallback vectorial). */
const IMAGE_RE =
  /<image\b[^>]*?(?:xlink:)?href=(["'])(\/?assets\/tactical\/[^"']+\.png)\1[^>]*?\/?>/g;

/** Fetcher inyectable para poder probar el camino de fallo sin red. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; blob: () => Promise<Blob> }>;

interface AssetResuelto {
  ok: boolean;
  dataUrl?: string;
  motivo?: string;
}

const cache = new Map<string, string>();

function atributo(tag: string, nombre: string): number {
  const m = new RegExp(`${nombre}=["']([^"']+)["']`).exec(tag);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : 0;
}

const redondear = (n: number) => Number(n.toFixed(2));

/** Color del material a partir de su PNG (manifiesto táctico); gris claro si no se reconoce. */
function colorDelAsset(href: string): { color: string; esCono: boolean } {
  const fichero = href.split('/').pop() ?? '';
  const info = TACTIC_ASSETS.find((a) => a.asset.endsWith(fichero));
  return { color: info?.color ?? '#e8edf2', esCono: (info?.kind ?? '').startsWith('cone') };
}

/**
 * Fallback VECTORIAL y OPACO para un `<image>` cuyo asset no se pudo leer.
 * Ocupa exactamente la misma caja (`x`,`y`,`width`,`height`) que la imagen que sustituye.
 */
export function fallbackVectorialDeAsset(tag: string, href: string): string {
  const x = atributo(tag, 'x');
  const y = atributo(tag, 'y');
  const w = atributo(tag, 'width') || 5;
  const h = atributo(tag, 'height') || 5;
  const { color, esCono } = colorDelAsset(href);
  const trazo = `stroke="rgba(0,0,0,0.45)" stroke-width="${redondear(Math.max(w, h) * 0.06)}"`;
  if (esCono) {
    // Cono: triángulo con la base abajo, en el color de ese cono.
    const puntos = `${redondear(x)},${redondear(y + h)} ${redondear(x + w / 2)},${redondear(
      y,
    )} ${redondear(x + w)},${redondear(y + h)}`;
    return `<g data-asset-fallback="1"><polygon points="${puntos}" fill="${color}" ${trazo} /></g>`;
  }
  // Resto de materiales: bloque redondeado del color del material.
  const radio = redondear(Math.min(w, h) * 0.18);
  return `<g data-asset-fallback="1"><rect x="${redondear(x)}" y="${redondear(
    y,
  )}" width="${redondear(w)}" height="${redondear(h)}" rx="${radio}" fill="${color}" ${trazo} /></g>`;
}

async function resolverAsset(href: string, fetcher: Fetcher): Promise<AssetResuelto> {
  const hit = cache.get(href);
  if (hit) return { ok: true, dataUrl: hit };
  // `document.baseURI` incorpora `/CDMPLab/` en Pages. También normaliza el formato histórico
  // `/assets/...` para que no escape del subdirectorio.
  const relativeHref = href.replace(/^\/+/, '');
  const requestUrl =
    typeof document === 'undefined'
      ? relativeHref
      : new URL(relativeHref, document.baseURI).toString();
  try {
    const res = await fetcher(requestUrl);
    if (!res.ok) return { ok: false, motivo: `HTTP no OK: ${requestUrl}` };
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error('no se pudo leer ' + href));
      fr.readAsDataURL(blob);
    });
    cache.set(href, dataUrl);
    return { ok: true, dataUrl };
  } catch (err) {
    // Sin `catch` vacío: el motivo se conserva y se informa por consola (una vez por asset).
    return { ok: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sustituye los `assets/tactical/*.png` (incluido el formato histórico con barra inicial) por data
 * URLs base64. Los assets que no se pueden leer se sustituyen por un fallback VECTORIAL opaco en su
 * misma caja: nunca por transparencia y nunca dejando una referencia externa.
 *
 * @param opts.fetcher opcional, solo para pruebas (por defecto `fetch`).
 * @param opts.avisar  callback de aviso por asset no disponible (por defecto `console.warn`).
 */
export async function inlineSvgAssets(
  svg: string,
  opts: { fetcher?: Fetcher; avisar?: (mensaje: string) => void } = {},
): Promise<string> {
  const doFetch: Fetcher = opts.fetcher ?? ((url: string) => fetch(url) as never);
  const avisar = opts.avisar ?? ((m: string) => console.warn(`[asset-inline] ${m}`));
  const matches = [...svg.matchAll(IMAGE_RE)];
  if (matches.length === 0) return svg;

  let out = svg;
  const resueltos = new Map<string, AssetResuelto>();
  for (const m of matches) {
    const tag = m[0];
    const href = m[2];
    let res = resueltos.get(href);
    if (!res) {
      res = await resolverAsset(href, doFetch);
      resueltos.set(href, res);
    }
    if (res.ok && res.dataUrl) {
      out = out.replace(tag, tag.split(href).join(res.dataUrl));
    } else {
      avisar(
        `no se pudo leer ${href} (${res.motivo ?? 'motivo desconocido'}): se dibuja el fallback vectorial`,
      );
      out = out.replace(tag, fallbackVectorialDeAsset(tag, href));
    }
  }
  return out;
}

/** ¿Queda alguna referencia externa a assets en el SVG? (debe ser siempre `false`). */
export function tieneRefsExternas(svg: string): boolean {
  return /(?:xlink:)?href=["'](\/?assets\/|[^"']*\.png)["']/.test(svg);
}

/** Hrefs de asset que aparecen en un SVG (para pruebas y diagnóstico). */
export function hrefsDeAssets(svg: string): string[] {
  return [...svg.matchAll(ATTR_RE)].map((m) => m[3]);
}
