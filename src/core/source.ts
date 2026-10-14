// Préparation des sources côté page (thread principal).
// Les SVG ne peuvent pas être décodés dans un worker : on les rastérise ici en PNG.

export interface SourceInfo {
  width: number;
  height: number;
  isSvg: boolean;
}

export function isSvg(blob: Blob, name: string): boolean {
  return blob.type === 'image/svg+xml' || /\.svgz?$/i.test(name);
}

export async function probe(blob: Blob, name: string): Promise<SourceInfo> {
  if (isSvg(blob, name)) {
    const img = await loadSvg(blob);
    return { width: img.width, height: img.height, isSvg: true };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('Format non pris en charge');
  }
  const info = { width: bitmap.width, height: bitmap.height, isSvg: false };
  bitmap.close();
  return info;
}

async function loadSvg(blob: Blob): Promise<{ el: HTMLImageElement; width: number; height: number }> {
  const svgBlob = blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const el = new Image();
    el.decoding = 'async';
    el.src = url;
    await el.decode().catch(() => {
      throw new Error('SVG illisible');
    });
    // Chrome invente une taille (ex. 250×150) pour un SVG qui n'a qu'un viewBox :
    // on lit d'abord les dimensions déclarées dans le fichier.
    const declared = svgDeclaredSize(await blob.text());
    const width = declared?.width || el.naturalWidth || 512;
    const height = declared?.height || el.naturalHeight || 512;
    return { el, width: Math.round(width), height: Math.round(height) };
  } finally {
    // L'élément est déjà décodé, l'URL peut être libérée après usage.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Dimensions déclarées par la racine <svg> (width/height en px, sinon viewBox). */
function svgDeclaredSize(text: string): { width: number; height: number } | null {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (root?.localName !== 'svg') return null;
  const px = (v: string | null) => {
    const m = v && /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v);
    return m ? parseFloat(m[1]) : 0;
  };
  const w = px(root.getAttribute('width'));
  const h = px(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const [vw, vh] = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? [vb[2], vb[3]] : [0, 0];
  if (w && h) return { width: w, height: h };
  if (w && vw) return { width: w, height: (w * vh) / vw };
  if (h && vh) return { width: (h * vw) / vh, height: h };
  if (vw) return { width: vw, height: vh };
  return null;
}

/** Rastérise un SVG en PNG (sans perte) au facteur demandé. */
export async function rasterizeSvg(blob: Blob, scale: number): Promise<Blob> {
  const { el, width, height } = await loadSvg(blob);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  ctx.drawImage(el, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/png' });
}
