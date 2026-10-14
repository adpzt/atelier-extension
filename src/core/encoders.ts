// Encodeurs « spéciaux » : BMP, ICO, TIFF, PDF, SVG (vectorisation), QOI, JPEG XL.
// Les bibliothèques lourdes sont chargées à la demande.
import resize from '@jsquash/resize';
import optimisePng from '@jsquash/oxipng/optimise';
import encodeJpeg from '@jsquash/jpeg/encode';

function hasAlpha(img: ImageData): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

// ---------- BMP ----------
/** BMP 24 bits, ou 32 bits avec transparence (en-tête V4 + masques). */
export function encodeBmp(img: ImageData): ArrayBuffer {
  const { width, height, data } = img;
  const alpha = hasAlpha(img);
  const bpp = alpha ? 4 : 3;
  const rowSize = alpha ? width * 4 : Math.ceil((width * 3) / 4) * 4;
  const headerSize = alpha ? 108 : 40;
  const offset = 14 + headerSize;
  const size = offset + rowSize * height;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint8(0, 0x42);
  v.setUint8(1, 0x4d);
  v.setUint32(2, size, true);
  v.setUint32(10, offset, true);
  v.setUint32(14, headerSize, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true); // positif : lignes de bas en haut
  v.setUint16(26, 1, true);
  v.setUint16(28, bpp * 8, true);
  v.setUint32(30, alpha ? 3 : 0, true); // BI_BITFIELDS : BI_RGB
  v.setUint32(34, rowSize * height, true);
  v.setInt32(38, 2835, true); // 72 dpi
  v.setInt32(42, 2835, true);
  if (alpha) {
    v.setUint32(54, 0x00ff0000, true);
    v.setUint32(58, 0x0000ff00, true);
    v.setUint32(62, 0x000000ff, true);
    v.setUint32(66, 0xff000000, true);
    v.setUint32(70, 0x73524742, true); // 'sRGB'
  }
  const out = new Uint8Array(buf);
  for (let y = 0; y < height; y++) {
    let o = offset + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[o++] = data[i + 2];
      out[o++] = data[i + 1];
      out[o++] = data[i];
      if (alpha) out[o++] = data[i + 3];
    }
  }
  return buf;
}

// ---------- ICO ----------
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Favicon multi-tailles : l'image est centrée dans un carré transparent, chaque taille en PNG. */
export async function encodeIco(img: ImageData): Promise<ArrayBuffer> {
  const side = Math.max(img.width, img.height);
  let square = img;
  if (img.width !== img.height) {
    const data = new Uint8ClampedArray(side * side * 4);
    const ox = Math.floor((side - img.width) / 2);
    const oy = Math.floor((side - img.height) / 2);
    for (let y = 0; y < img.height; y++) {
      data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + oy) * side + ox) * 4);
    }
    square = new ImageData(data, side, side);
  }
  const sizes = ICO_SIZES.filter((s) => s <= side);
  if (!sizes.length) sizes.push(16);
  const pngs: Uint8Array[] = [];
  for (const s of sizes) {
    const scaled = s === side ? square : await resize(square, { width: s, height: s, method: 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: true });
    pngs.push(new Uint8Array(await optimisePng(scaled, { level: 2 })));
  }
  const headerLen = 6 + 16 * pngs.length;
  const total = headerLen + pngs.reduce((a, p) => a + p.length, 0);
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  v.setUint16(2, 1, true); // type : icône
  v.setUint16(4, pngs.length, true);
  let offset = headerLen;
  pngs.forEach((png, i) => {
    const s = sizes[i];
    const e = 6 + i * 16;
    v.setUint8(e, s >= 256 ? 0 : s);
    v.setUint8(e + 1, s >= 256 ? 0 : s);
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, png.length, true);
    v.setUint32(e + 12, offset, true);
    new Uint8Array(buf, offset, png.length).set(png);
    offset += png.length;
  });
  return buf;
}

// ---------- TIFF ----------
export async function encodeTiff(img: ImageData): Promise<ArrayBuffer> {
  const UTIF = (await import('utif2')).default;
  return UTIF.encodeImage(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height);
}

// ---------- PDF ----------
/**
 * Une page aux dimensions de l'image (1 px = 1 pt, soit 72 dpi).
 * Avec perte : image JPEG à la qualité choisie. Sans perte : PNG.
 * Retourne aussi l'image intégrée (sert d'aperçu).
 */
export async function encodePdf(img: ImageData, quality: number | null): Promise<{ pdf: Uint8Array; embedded: Blob }> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setProducer('Kotak');
  doc.setCreator('Kotak');
  let image;
  let embedded: Blob;
  if (quality === null) {
    const png = await optimisePng(img, { level: 2 });
    image = await doc.embedPng(png);
    embedded = new Blob([png], { type: 'image/png' });
  } else {
    const jpg = await encodeJpeg(img, { quality });
    image = await doc.embedJpg(jpg);
    embedded = new Blob([jpg], { type: 'image/jpeg' });
  }
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(image, { x: 0, y: 0, width: img.width, height: img.height });
  return { pdf: await doc.save(), embedded };
}

// ---------- SVG (vectorisation) ----------
const TRACE_MAX = 1600;

/** Vectorisation par aplats de couleurs (ImageTracer, algorithme classique, pas d'IA). */
export async function encodeSvg(img: ImageData, colors: number): Promise<string> {
  const ImageTracer = (await import('imagetracerjs')).default;
  let src = img;
  const long = Math.max(img.width, img.height);
  if (long > TRACE_MAX) {
    // Au-delà, le tracé devient très lent pour un gain nul : on travaille en réduit
    // et on remet l'échelle d'origine dans le SVG.
    const k = TRACE_MAX / long;
    src = await resize(img, { width: Math.round(img.width * k), height: Math.round(img.height * k), method: 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: true });
  }
  const scale = img.width / src.width;
  const svg: string = ImageTracer.imagedataToSVG(src, {
    numberofcolors: Math.max(2, Math.min(64, colors || 16)),
    colorquantcycles: 3,
    colorsampling: 2,
    pathomit: 8,
    ltres: 1,
    qtres: 1,
    rightangleenhance: true,
    strokewidth: 0,
    linefilter: false,
    roundcoords: 1,
    scale,
    viewbox: true,
    desc: false,
  });
  return svg.replace('<svg ', `<svg width="${img.width}" height="${img.height}" `);
}

// ---------- QOI / JPEG XL ----------
export async function encodeQoi(img: ImageData): Promise<ArrayBuffer> {
  const { default: encode } = await import('@jsquash/qoi/encode');
  return encode(img);
}

export async function encodeJxl(img: ImageData, quality: number | null): Promise<ArrayBuffer> {
  const { default: encode } = await import('@jsquash/jxl/encode');
  return quality === null ? encode(img, { lossless: true, effort: 7 }) : encode(img, { quality, effort: 7 });
}

export async function decodeJxl(buf: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await import('@jsquash/jxl/decode');
  return decode(buf);
}

/** PNG rapide (encodeur natif du navigateur), pour les aperçus. */
export function pngPreview(img: ImageData): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
