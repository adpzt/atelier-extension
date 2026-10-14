// Réduction de couleurs rapide (PNG avec perte, GIF).
// Palette : PnnQuant de gifenc (sur histogramme réduit, très rapide).
// Application : plus proche couleur avec cache + tramage Floyd–Steinberg optionnel,
// le tout sur tableaux typés (pas d'objet par pixel).
import { quantize } from 'gifenc';

export interface Quantized {
  /** Couleurs [r, g, b, a]. */
  palette: number[][];
  /** Index de palette pour chaque pixel. */
  index: Uint8Array;
}

/**
 * @param withAlpha true : palette RGBA (PNG). false : on ignore l'alpha (GIF, géré à part).
 */
export function quantizeImage(img: ImageData, colors: number, dithering: boolean, withAlpha: boolean): Quantized {
  const { width, height } = img;
  const src = img.data;
  const max = Math.max(2, Math.min(256, colors));

  // gifenc travaille sur une copie (il peut modifier les pixels transparents).
  const work = new Uint8Array(src.length);
  work.set(src);
  if (!withAlpha) for (let i = 3; i < work.length; i += 4) work[i] = 255;
  const raw = quantize(work, max, { format: withAlpha ? 'rgba4444' : 'rgb565', clearAlpha: false });
  const palette = raw.map((c) => [c[0], c[1], c[2], withAlpha ? (c[3] ?? 255) : 255]);
  const n = palette.length;
  const pr = new Float32Array(n);
  const pg = new Float32Array(n);
  const pb = new Float32Array(n);
  const pa = new Float32Array(n);
  palette.forEach((c, i) => {
    pr[i] = c[0];
    pg[i] = c[1];
    pb[i] = c[2];
    pa[i] = c[3];
  });

  // Cache : couleur réduite à 5 bits par canal (+ 4 bits d'alpha) -> index de palette.
  const cache = new Int16Array(withAlpha ? 1 << 19 : 1 << 15).fill(-1);
  const nearest = (r: number, g: number, b: number, a: number): number => {
    const key = withAlpha ? ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4) : ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key];
    if (hit >= 0) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dr = r - pr[i];
      const dg = g - pg[i];
      const db = b - pb[i];
      const da = a - pa[i];
      // Pondération perceptuelle simple (le vert compte plus).
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db + 3 * da * da;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };

  const index = new Uint8Array(width * height);
  const c = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

  if (!dithering) {
    for (let p = 0, i = 0; p < index.length; p++, i += 4) {
      index[p] = nearest(src[i], src[i + 1], src[i + 2], withAlpha ? src[i + 3] : 255);
    }
    return { palette, index };
  }

  // Floyd–Steinberg en serpentin : erreurs de la ligne courante et de la suivante.
  const stride = width * 4;
  let cur = new Float32Array(stride + 8);
  let next = new Float32Array(stride + 8);
  for (let y = 0; y < height; y++) {
    const ltr = (y & 1) === 0;
    next.fill(0);
    for (let k = 0; k < width; k++) {
      const x = ltr ? k : width - 1 - k;
      const i = (y * width + x) * 4;
      const e = x * 4 + 4; // décalage de 4 pour pouvoir écrire en x-1 sans test
      const r = c(src[i] + cur[e]);
      const g = c(src[i + 1] + cur[e + 1]);
      const b = c(src[i + 2] + cur[e + 2]);
      const a = withAlpha ? c(src[i + 3] + cur[e + 3]) : 255;
      const idx = nearest(r, g, b, a);
      index[y * width + x] = idx;
      const er = r - pr[idx];
      const eg = g - pg[idx];
      const eb = b - pb[idx];
      const ea = withAlpha ? a - pa[idx] : 0;
      const fwd = ltr ? 4 : -4;
      // 7/16 en avant, 3/16 en arrière-bas, 5/16 en bas, 1/16 en avant-bas
      cur[e + fwd] += (er * 7) / 16;
      cur[e + fwd + 1] += (eg * 7) / 16;
      cur[e + fwd + 2] += (eb * 7) / 16;
      cur[e + fwd + 3] += (ea * 7) / 16;
      next[e - fwd] += (er * 3) / 16;
      next[e - fwd + 1] += (eg * 3) / 16;
      next[e - fwd + 2] += (eb * 3) / 16;
      next[e - fwd + 3] += (ea * 3) / 16;
      next[e] += (er * 5) / 16;
      next[e + 1] += (eg * 5) / 16;
      next[e + 2] += (eb * 5) / 16;
      next[e + 3] += (ea * 5) / 16;
      next[e + fwd] += er / 16;
      next[e + fwd + 1] += eg / 16;
      next[e + fwd + 2] += eb / 16;
      next[e + fwd + 3] += ea / 16;
    }
    const t = cur;
    cur = next;
    next = t;
  }
  return { palette, index };
}

/** Reconstruit des pixels RGBA à partir d'une image indexée. */
export function indexedToImageData(q: Quantized, width: number, height: number): ImageData {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, i = 0; p < q.index.length; p++, i += 4) {
    const c = q.palette[q.index[p]];
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
    out[i + 3] = c[3];
  }
  return new ImageData(out, width, height);
}
