// Génère les icônes PNG de l'extension (aucune dépendance : rendu SDF + zlib).
// Motif : carré arrondi sombre, disque vert acide et carré blanc qui se chevauchent
// (une image qui « se transforme »).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (size, rgba) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// Fonctions de distance signée (coordonnées normalisées 0..1).
const sdRoundBox = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

const BG_TOP = [27, 31, 23];
const BG_BOT = [11, 12, 10];
const LIME = [198, 242, 78];
const WHITE = [244, 246, 239];

function shade(x, y, small) {
  // retourne [r,g,b,a] pour un point
  const bg = sdRoundBox(x, y, 0.5, 0.5, 0.5, 0.5, 0.22);
  if (bg > 0) return [0, 0, 0, 0];
  const t = (x + y) / 2;
  let col = BG_TOP.map((c, i) => c + (BG_BOT[i] - c) * t);
  const circle = sdCircle(x, y, 0.4, 0.4, small ? 0.22 : 0.2);
  if (circle < 0) col = LIME;
  const stroke = small ? 0.075 : 0.055;
  const sq = Math.abs(sdRoundBox(x, y, 0.64, 0.64, 0.17, 0.17, 0.05)) - stroke / 2;
  if (sq < 0) col = WHITE;
  return [...col, 255];
}

for (const size of [16, 32, 48, 128]) {
  const ss = 6; // suréchantillonnage pour l'anticrénelage
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, size <= 32);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (py * size + px) * 4;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round(a / (ss * ss));
    }
  }
  writeFileSync(resolve(out, `icon-${size}.png`), png(size, buf));
}
console.log('Icônes générées dans', out);
