// Conversions de couleurs et export de nuancier Adobe (.ase).

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexOf({ r, g, b }: RGB): string {
  return [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function parseHex(input: string): RGB | null {
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * CMJN « naïf » (sans profil ICC) : proche des valeurs Photoshop, pas identique,
 * car Photoshop applique le profil d'impression du document (Fogra, SWOP…).
 */
export function cmykOf({ r, g, b }: RGB): [number, number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - rr - k) / (1 - k);
  const m = (1 - gg - k) / (1 - k);
  const y = (1 - bb - k) / (1 - k);
  return [c, m, y, k].map((v) => Math.round(v * 100)) as [number, number, number, number];
}

export function hslOf({ r, g, b }: RGB): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** Luminance relative : sert à choisir un texte clair ou foncé sur la pastille. */
export function isLight({ r, g, b }: RGB): boolean {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

/** Nuancier Adobe Swatch Exchange (Photoshop, Illustrator, InDesign). */
export function buildAse(colors: { name: string; rgb: RGB }[]): Blob {
  const blocks = colors.map(({ name, rgb }) => {
    const nameLen = name.length + 1;
    const len = 2 + nameLen * 2 + 4 + 12 + 2;
    const buf = new ArrayBuffer(6 + len);
    const v = new DataView(buf);
    v.setUint16(0, 0x0001); // bloc couleur
    v.setUint32(2, len);
    v.setUint16(6, nameLen);
    let o = 8;
    for (const ch of name) {
      v.setUint16(o, ch.charCodeAt(0));
      o += 2;
    }
    v.setUint16(o, 0);
    o += 2;
    [0x52, 0x47, 0x42, 0x20].forEach((c) => v.setUint8(o++, c)); // 'RGB '
    v.setFloat32(o, rgb.r / 255);
    v.setFloat32(o + 4, rgb.g / 255);
    v.setFloat32(o + 8, rgb.b / 255);
    v.setUint16(o + 12, 2); // couleur « normale »
    return new Uint8Array(buf);
  });
  const header = new ArrayBuffer(12);
  const hv = new DataView(header);
  [0x41, 0x53, 0x45, 0x46].forEach((c, i) => hv.setUint8(i, c)); // 'ASEF'
  hv.setUint16(4, 1);
  hv.setUint16(6, 0);
  hv.setUint32(8, blocks.length);
  return new Blob([header, ...blocks], { type: 'application/octet-stream' });
}
