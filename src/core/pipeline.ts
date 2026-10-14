// Pipeline de conversion, exécuté dans un Web Worker :
// décodage -> redimensionnement -> aplatissement (si pas d'alpha) -> encodage.
import resize from '@jsquash/resize';
import encodeJpeg from '@jsquash/jpeg/encode';
import encodeWebp from '@jsquash/webp/encode';
import encodeAvif from '@jsquash/avif/encode';
import optimisePng from '@jsquash/oxipng/optimise';
import { quantizeImage, indexedToImageData } from './quantize';
import { GIFEncoder } from 'gifenc';
import { FORMATS, qualityOf, usesTargetSize, type Settings } from './types';

export interface PipelineOutput {
  blob: Blob;
  width: number;
  height: number;
  quality: number | null;
  targetMet: boolean | null;
}

export async function decodeToImageData(source: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(source, { premultiplyAlpha: 'none' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D indisponible');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export function targetDimensions(w: number, h: number, s: Settings): { width: number; height: number } {
  const { mode, value, noUpscale } = s.resize;
  if (mode === 'none' || !(value > 0)) return { width: w, height: h };
  let scale = 1;
  if (mode === 'width') scale = value / w;
  else if (mode === 'height') scale = value / h;
  else if (mode === 'longest') scale = value / Math.max(w, h);
  else if (mode === 'percent') scale = value / 100;
  if (noUpscale && scale > 1) scale = 1;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

async function resizeIfNeeded(img: ImageData, s: Settings): Promise<ImageData> {
  const { width, height } = targetDimensions(img.width, img.height, s);
  if (width === img.width && height === img.height) return img;
  return resize(img, { width, height, method: 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: true });
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Compose l'image sur une couleur de fond (pour les formats sans transparence). */
function flatten(img: ImageData, background: string): ImageData {
  const [br, bg, bb] = hexToRgb(background);
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = src[i] * a + br * (1 - a);
    out[i + 1] = src[i + 1] * a + bg * (1 - a);
    out[i + 2] = src[i + 2] * a + bb * (1 - a);
    out[i + 3] = 255;
  }
  return new ImageData(out, img.width, img.height);
}

function hasTransparency(img: ImageData): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

async function encodePng(img: ImageData, s: Settings): Promise<ArrayBuffer> {
  // Avec ≤ 256 couleurs, oxipng écrit automatiquement un PNG à palette (8 bits).
  const pixels = s.colors > 0 ? indexedToImageData(quantizeImage(img, s.colors, s.dithering, true), img.width, img.height) : img;
  return optimisePng(pixels, { level: 2, interlace: false, optimiseAlpha: true });
}

function encodeGif(img: ImageData, s: Settings): Uint8Array {
  const { width, height } = img;
  const src = img.data;
  const transparent = hasTransparency(img);
  // La transparence GIF est binaire : on réserve un index pour elle.
  const maxColors = Math.min(256, s.colors > 0 ? s.colors : 256) - (transparent ? 1 : 0);
  const q = quantizeImage(img, maxColors, s.dithering, false);

  const palette = q.palette.map((c) => [c[0], c[1], c[2]]);
  const transparentIndex = transparent ? palette.length : 0;
  if (transparent) {
    palette.push([0, 0, 0]);
    for (let p = 0, i = 3; p < q.index.length; p++, i += 4) if (src[i] < 128) q.index[p] = transparentIndex;
  }
  // Taille de palette GIF : puissance de 2.
  let size = 2;
  while (size < palette.length) size *= 2;
  while (palette.length < size) palette.push([0, 0, 0]);

  const gif = GIFEncoder();
  gif.writeFrame(q.index, width, height, { palette, transparent, transparentIndex, repeat: -1 });
  gif.finish();
  return gif.bytes();
}

async function encodeLossy(img: ImageData, s: Settings, quality: number): Promise<ArrayBuffer> {
  switch (s.format) {
    case 'jpeg':
      return encodeJpeg(img, { quality });
    case 'webp':
      return s.lossless
        ? encodeWebp(img, { lossless: 1, quality: 75, method: 4, exact: 0 })
        : encodeWebp(img, { quality, method: 4 });
    case 'avif':
      return s.lossless ? encodeAvif(img, { lossless: true, speed: 6 }) : encodeAvif(img, { quality: avifQuality(quality), speed: 6 });
    default:
      throw new Error(`Format inattendu : ${s.format}`);
  }
}

/**
 * L'échelle de qualité AVIF est bien plus « généreuse » que celle du JPG/WebP :
 * on la recale pour qu'un même réglage donne un rendu visuel comparable
 * (75 JPG/WebP ≈ 50 AVIF, valeurs par défaut de Squoosh), 100 restant 100.
 */
function avifQuality(q: number): number {
  return Math.round(q <= 75 ? (q * 50) / 75 : 50 + (q - 75) * 2);
}

/** Meilleure qualité dont le poids reste <= cible (recherche dichotomique). */
async function encodeToTarget(img: ImageData, s: Settings): Promise<{ data: ArrayBuffer; quality: number; met: boolean }> {
  const target = Math.max(1, s.targetKB) * 1024;
  let lo = 1;
  let hi = 95;
  let best: { data: ArrayBuffer; quality: number } | null = null;
  let smallest: { data: ArrayBuffer; quality: number } | null = null;
  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    const data = await encodeLossy(img, s, mid);
    if (!smallest || data.byteLength < smallest.data.byteLength) smallest = { data, quality: mid };
    if (data.byteLength <= target) {
      best = { data, quality: mid };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best) return { ...best, met: true };
  // Même à qualité minimale on dépasse : on renvoie le plus léger obtenu.
  if (smallest && smallest.quality !== 1) {
    const data = await encodeLossy(img, s, 1);
    if (data.byteLength < smallest.data.byteLength) smallest = { data, quality: 1 };
  }
  return { ...smallest!, met: false };
}

export async function runPipeline(decoded: ImageData, s: Settings): Promise<PipelineOutput> {
  const format = FORMATS[s.format];
  let img = await resizeIfNeeded(decoded, s);
  if (!format.alpha) img = flatten(img, s.background);

  let data: ArrayBuffer | Uint8Array;
  let quality: number | null = null;
  let targetMet: boolean | null = null;

  if (usesTargetSize(s)) {
    const r = await encodeToTarget(img, s);
    data = r.data;
    quality = r.quality;
    targetMet = r.met;
  } else if (format.lossy) {
    quality = s.lossless && format.supportsLossless ? null : qualityOf(s);
    data = await encodeLossy(img, s, quality ?? 100);
  } else if (s.format === 'png') {
    data = await encodePng(img, s);
  } else {
    data = encodeGif(img, s);
  }

  return {
    blob: new Blob([data as BlobPart], { type: format.mime }),
    width: img.width,
    height: img.height,
    quality,
    targetMet,
  };
}
