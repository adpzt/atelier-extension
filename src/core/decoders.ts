// Décodage des formats que Chrome ne sait pas lire nativement.
// Exécuté dans un worker dédié (normalize.worker.ts), bibliothèques chargées à la demande.

export type SourceKind = 'native' | 'svg' | 'pdf' | 'raw' | 'heic' | 'tiff' | 'psd' | 'jxl' | 'qoi' | 'tga';

/** Bibliothèques CommonJS : selon l'interop, l'export utile est dans `default` ou à la racine. */
const cjs = <T>(mod: unknown): T => ((mod as { default?: T }).default ?? mod) as T;

const RAW_EXT = /\.(cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|rwl|pef|ptx|srw|x3f|3fr|fff|iiq|mos|mef|mrw|erf|kdc|dcr)$/i;

export const ACCEPTED_EXT =
  /\.(png|jpe?g|jfif|pjpeg|webp|avif|gif|bmp|dib|ico|cur|svgz?|heic|heif|hif|tiff?|psd|psb|jxl|qoi|tga|pdf|cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|rwl|pef|ptx|srw|x3f|3fr|fff|iiq|mos|mef|mrw|erf|kdc|dcr)$/i;

/** Identifie le format d'après les premiers octets (et l'extension pour RAW / TGA). */
export function sniff(head: Uint8Array, name: string, type: string): SourceKind {
  const str = (a: number, b: number) => String.fromCharCode(...head.subarray(a, b));
  if (type === 'image/svg+xml' || /\.svgz?$/i.test(name) || /^\s*(<\?xml|<svg)/i.test(str(0, 64))) return 'svg';
  if (str(0, 5) === '%PDF-') return 'pdf';
  if (RAW_EXT.test(name)) return 'raw';
  if (str(4, 8) === 'ftyp') {
    const brand = str(8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
  }
  if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0) || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 0x2a)) return 'tiff';
  if (str(0, 4) === '8BPS') return 'psd';
  if ((head[0] === 0xff && head[1] === 0x0a) || str(4, 8) === 'JXL ') return 'jxl';
  if (str(0, 4) === 'qoif') return 'qoi';
  if (/\.tga$/i.test(name)) return 'tga';
  return 'native';
}

export const KIND_LABEL: Record<SourceKind, string> = {
  native: '',
  svg: 'SVG',
  pdf: 'PDF',
  raw: 'RAW',
  heic: 'HEIC',
  tiff: 'TIFF',
  psd: 'PSD',
  jxl: 'JPEG XL',
  qoi: 'QOI',
  tga: 'TGA',
};

export async function decodeExotic(kind: SourceKind, buf: ArrayBuffer): Promise<ImageData> {
  switch (kind) {
    case 'heic':
      return decodeHeic(buf);
    case 'tiff':
      return decodeTiff(buf);
    case 'psd':
      return decodePsd(buf);
    case 'jxl': {
      const { default: decode } = await import('@jsquash/jxl/decode');
      return decode(buf);
    }
    case 'qoi': {
      const { default: decode } = await import('@jsquash/qoi/decode');
      return decode(buf);
    }
    case 'tga':
      return decodeTga(buf);
    case 'raw':
      return decodeRawPreview(buf);
    default:
      throw new Error(`Décodeur manquant : ${kind}`);
  }
}

// ---------- HEIC / HEIF (photos iPhone) ----------
interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (r: unknown) => void): void;
}

async function decodeHeic(buf: ArrayBuffer): Promise<ImageData> {
  const libheif = cjs<{ HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } }>(await import('libheif-js/wasm-bundle'));
  const images = new libheif.HeifDecoder().decode(new Uint8Array(buf));
  if (!images.length) throw new Error('HEIC sans image');
  const img = images[0]; // image principale
  const width = img.get_width();
  const height = img.get_height();
  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) =>
    img.display({ data, width, height }, (r) => (r ? resolve() : reject(new Error('HEIC illisible')))),
  );
  return new ImageData(data, width, height);
}

// ---------- TIFF ----------
interface Ifd {
  width: number;
  height: number;
  [k: string]: unknown;
}

async function decodeTiff(buf: ArrayBuffer): Promise<ImageData> {
  const UTIF = cjs<{
    decode(b: ArrayBuffer): Ifd[];
    decodeImage(b: ArrayBuffer, ifd: Ifd): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  }>(await import('utif2'));
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('TIFF vide');
  // La plus grande image du fichier (certains TIFF contiennent une vignette en premier).
  let best = ifds[0];
  let bestArea = 0;
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd);
    const area = (ifd.width || 0) * (ifd.height || 0);
    if (area > bestArea) {
      best = ifd;
      bestArea = area;
    }
  }
  const rgba = UTIF.toRGBA8(best);
  return new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, best.width * best.height * 4), best.width, best.height);
}

// ---------- PSD / PSB ----------
async function decodePsd(buf: ArrayBuffer): Promise<ImageData> {
  const agPsd = await import('ag-psd');
  agPsd.initializeCanvas(
    (w, h) => new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement,
    (w, h) => new ImageData(w, h),
  );
  const psd = agPsd.readPsd(buf, { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
  if (!psd.imageData) {
    throw new Error('PSD sans image composite : réenregistre-le avec « Maximiser la compatibilité »');
  }
  const { data, width, height } = psd.imageData;
  return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, width * height * 4), width, height);
}

// ---------- TGA ----------
function decodeTga(buf: ArrayBuffer): ImageData {
  const b = new Uint8Array(buf);
  const idLen = b[0];
  const cmapType = b[1];
  const type = b[2];
  const cmapLen = b[5] | (b[6] << 8);
  const cmapDepth = b[7];
  const width = b[12] | (b[13] << 8);
  const height = b[14] | (b[15] << 8);
  const depth = b[16];
  const desc = b[17];
  const rle = type >= 9;
  const base = rle ? type - 8 : type;
  if (![1, 2, 3].includes(base) || !width || !height) throw new Error('TGA non pris en charge');
  let p = 18 + idLen;
  const palette: number[][] = [];
  if (cmapType === 1) {
    const bpe = Math.ceil(cmapDepth / 8);
    for (let i = 0; i < cmapLen; i++, p += bpe) palette.push([b[p + 2], b[p + 1], b[p], bpe === 4 ? b[p + 3] : 255]);
  }
  const bpp = depth / 8;
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const read = (o: number, px: number) => {
    let r: number, g: number, bl: number, a = 255;
    if (base === 3) r = g = bl = b[o];
    else if (base === 1) [r, g, bl, a] = palette[bpp === 2 ? b[o] | (b[o + 1] << 8) : b[o]] ?? [0, 0, 0, 255];
    else if (bpp === 2) {
      const v = b[o] | (b[o + 1] << 8);
      r = ((v >> 10) & 31) << 3;
      g = ((v >> 5) & 31) << 3;
      bl = (v & 31) << 3;
    } else {
      bl = b[o];
      g = b[o + 1];
      r = b[o + 2];
      if (bpp === 4) a = b[o + 3];
    }
    out[px * 4] = r;
    out[px * 4 + 1] = g;
    out[px * 4 + 2] = bl;
    out[px * 4 + 3] = a;
  };
  let px = 0;
  if (!rle) {
    for (; px < n; px++, p += bpp) read(p, px);
  } else {
    while (px < n && p < b.length) {
      const h = b[p++];
      const count = (h & 0x7f) + 1;
      if (h & 0x80) {
        for (let i = 0; i < count && px < n; i++) read(p, px++);
        p += bpp;
      } else {
        for (let i = 0; i < count && px < n; i++, p += bpp) read(p, px++);
      }
    }
  }
  // Origine en bas à gauche (cas par défaut) : on retourne verticalement.
  if (!(desc & 0x20)) {
    const row = width * 4;
    const tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < height >> 1; y++) {
      const a = y * row;
      const z = (height - 1 - y) * row;
      tmp.set(out.subarray(a, a + row));
      out.copyWithin(a, z, z + row);
      out.set(tmp, z);
    }
  }
  // Fichiers 32 bits dont l'alpha est entièrement à 0 : on l'ignore.
  if (bpp === 4) {
    let any = false;
    for (let i = 3; i < out.length; i += 4) if (out[i]) { any = true; break; }
    if (!any) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  }
  return new ImageData(out, width, height);
}

// ---------- RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2…) ----------
// On extrait le plus grand aperçu JPEG intégré par l'appareil (pleine résolution chez
// Canon / Nikon, souvent réduite chez Sony / Fuji). Rapide et fidèle au rendu boîtier.
async function decodeRawPreview(buf: ArrayBuffer): Promise<ImageData> {
  const b = new Uint8Array(buf);
  let best: { offset: number; area: number } | null = null;
  for (let i = 0; i < b.length - 4; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
    const size = jpegSize(b, i);
    if (size && (!best || size.w * size.h > best.area)) best = { offset: i, area: size.w * size.h };
  }
  if (!best) throw new Error('aucun aperçu exploitable dans ce RAW');
  // Le décodeur s'arrête au marqueur de fin : inutile de couper la fin du fichier.
  const bitmap = await createImageBitmap(new Blob([b.subarray(best.offset)], { type: 'image/jpeg' }));
  const orientation = tiffOrientation(b);
  const swap = orientation >= 5;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // Matrices EXIF standard (1 = normal, 3 = 180°, 6 = 90° horaire, 8 = 90° antihoraire…)
  const t: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, w, 0],
    7: [0, -1, -1, 0, w, h],
    8: [0, -1, 1, 0, 0, h],
  };
  if (t[orientation]) ctx.setTransform(...t[orientation]);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h);
}

/** Dimensions d'un JPEG classique (baseline / progressif) commençant à `start`, sinon null. */
function jpegSize(b: Uint8Array, start: number): { w: number; h: number } | null {
  let p = start + 2;
  for (let guard = 0; guard < 64 && p + 9 < b.length; guard++) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null; // SOS avant SOF : invalide
    const len = (b[p + 2] << 8) | b[p + 3];
    // SOF0 / SOF1 / SOF2 uniquement (SOF3 = JPEG sans perte des données capteur, illisible ici)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const h = (b[p + 5] << 8) | b[p + 6];
      const w = (b[p + 7] << 8) | b[p + 8];
      return w && h ? { w, h } : null;
    }
    if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return null;
    p += 2 + len;
  }
  return null;
}

/** Orientation EXIF (tag 0x0112) dans l'IFD0 d'un RAW de structure TIFF. */
function tiffOrientation(b: Uint8Array): number {
  const le = b[0] === 0x49 && b[1] === 0x49;
  const be = b[0] === 0x4d && b[1] === 0x4d;
  if (!le && !be) return 1;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 2 ** 24 : b[o] * 2 ** 24 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
  const ifd = u32(4);
  if (ifd + 2 > b.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}
