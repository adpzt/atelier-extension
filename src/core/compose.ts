// Mise en page d'une déclinaison (exécutée dans le worker d'encodage).
import resize from '@jsquash/resize';
import { coverCrop, type Compose } from './variants';

const lanczos = (img: ImageData, width: number, height: number) =>
  width === img.width && height === img.height
    ? Promise.resolve(img)
    : resize(img, { width, height, method: 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: true });

function cropImageData(img: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * img.width + x) * 4;
    out.set(img.data.subarray(start, start + w * 4), row * w * 4);
  }
  return new ImageData(out, w, h);
}

async function cover(img: ImageData, c: Compose): Promise<ImageData> {
  const r = coverCrop(img.width, img.height, c.width, c.height, c.focal);
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.max(1, Math.min(img.width - x, Math.round(r.w)));
  const h = Math.max(1, Math.min(img.height - y, Math.round(r.h)));
  return lanczos(cropImageData(img, x, y, w, h), c.width, c.height);
}

export async function composeImage(img: ImageData, c: Compose): Promise<ImageData> {
  if (c.fit === 'cover') return cover(img, c);

  // Image entière centrée, sur un fond flou (version recadrée de l'image) ou uni.
  const k = Math.min(c.width / img.width, c.height / img.height);
  const fw = Math.max(1, Math.round(img.width * k));
  const fh = Math.max(1, Math.round(img.height * k));
  const fg = await lanczos(img, fw, fh);
  const canvas = new OffscreenCanvas(c.width, c.height);
  const ctx = canvas.getContext('2d')!;
  if (c.background === 'blur') {
    const bg = await createImageBitmap(await cover(img, { ...c, fit: 'cover', focal: { x: 0.5, y: 0.5 } }));
    const blur = Math.max(8, Math.round(Math.max(c.width, c.height) / 40));
    ctx.filter = `blur(${blur}px) brightness(0.85)`;
    // Léger débord pour éviter les bords transparents du flou.
    const m = blur * 2;
    ctx.drawImage(bg, -m, -m, c.width + 2 * m, c.height + 2 * m);
    ctx.filter = 'none';
    bg.close();
  } else {
    ctx.fillStyle = c.background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  const fgBitmap = await createImageBitmap(fg);
  ctx.drawImage(fgBitmap, Math.round((c.width - fw) / 2), Math.round((c.height - fh) / 2));
  fgBitmap.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}
