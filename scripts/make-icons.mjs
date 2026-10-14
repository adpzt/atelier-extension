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

// Spectre RVB (rouge → orange → jaune → vert → cyan → bleu → violet), en dégradé conique.
const STOPS = [[255, 59, 92], [255, 138, 0], [255, 208, 0], [34, 208, 122], [0, 184, 255], [75, 92, 255], [194, 59, 255], [255, 59, 92]];
const spectrum = (t) => {
  const p = (((t % 1) + 1) % 1) * (STOPS.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  return STOPS[i].map((c, k) => c + (STOPS[i + 1][k] - c) * f);
};
const INNER = [14, 14, 19];

// Kotak (« boîte ») : carré arrondi au contour spectre, intérieur sombre, petite boîte centrale.
function shade(x, y, small) {
  const outer = sdRoundBox(x, y, 0.5, 0.5, 0.5, 0.5, 0.24);
  if (outer > 0) return [0, 0, 0, 0];
  const angle = Math.atan2(y - 0.5, x - 0.5) / (2 * Math.PI) + 0.5 + 0.15;
  const ring = small ? 0.17 : 0.13;
  const inner = sdRoundBox(x, y, 0.5, 0.5, 0.5 - ring, 0.5 - ring, 0.24 - ring * 0.8);
  if (inner > 0) return [...spectrum(angle), 255];
  // Petit carré central, lui aussi en spectre (inversé).
  const core = sdRoundBox(x, y, 0.5, 0.5, small ? 0.13 : 0.11, small ? 0.13 : 0.11, 0.04);
  if (core < 0) return [...spectrum(angle + 0.5), 255];
  return [...INNER, 255];
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
