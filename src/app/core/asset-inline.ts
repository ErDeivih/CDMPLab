// =============================================================
// EntrenoLab — Inline de assets de material para exportación.
//
// Una imagen SVG embebida como data URL NO puede cargar subrecursos
// externos (por seguridad del navegador los SVG cargados vía <img> o
// data URL corren en modo "sin recursos externos"). Por tanto, los
// <image href="assets/tactical/*.png"> NUNCA se dibujaban en el PNG/GIF
// exportado ni en la miniatura: faltaban los conos, banderines, etc.
// Esta utilidad sustituye cada href por un data URL base64 del PNG.
// =============================================================

const ASSET_RE = /href="(\/?assets\/tactical\/[^"]+\.png)"/g;
const cache = new Map<string, string>();

async function assetToDataUrl(href: string): Promise<string> {
  const hit = cache.get(href);
  if (hit) return hit;
  // `document.baseURI` incorpora `/CDMPLab/` en Pages. También normaliza el
  // formato histórico `/assets/...` para que no escape del subdirectorio.
  const relativeHref = href.replace(/^\/+/, '');
  const requestUrl = new URL(relativeHref, document.baseURI).toString();
  const res = await fetch(requestUrl);
  if (!res.ok) return href; // si falta el asset, se deja el href tal cual (no rompe)
  const blob = await res.blob();
  const url = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('read ' + href));
    fr.readAsDataURL(blob);
  });
  cache.set(href, url);
  return url;
}

/**
 * Sustituye los `assets/tactical/*.png` (incluido el formato histórico con
 * barra inicial) por data URLs base64 en un SVG.
 * Idempotente y cacheado: los assets repetidos en varios frames no se
 * vuelven a descargar.
 */
export async function inlineSvgAssets(svg: string): Promise<string> {
  const hrefs = [...svg.matchAll(ASSET_RE)].map((m) => m[1]);
  const unique = [...new Set(hrefs)];
  if (unique.length === 0) return svg;
  const pairs = await Promise.all(unique.map(async (h) => [h, await assetToDataUrl(h)] as const));
  let out = svg;
  for (const [h, d] of pairs) out = out.split(h).join(d);
  return out;
}
