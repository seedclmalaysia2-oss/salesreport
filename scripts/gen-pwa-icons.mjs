// Render public/icon.svg's mark to the PNG app icons phones need (iOS ignores
// an SVG apple-touch-icon; Android's install prompt wants 192 + 512 PNGs).
//
//   node scripts/gen-pwa-icons.mjs
//
// The icon is just rounded rectangles, so this rasterises them directly with
// 4×4 supersampling — no image library needed (pure node:zlib PNG encoder).
// Keep the shapes in step with public/icon.svg.

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x0f, 0x17, 0x2a];
const BARS = [ // in the 512 viewBox, after translate(136 150)
  { x: 136, y: 282, w: 56, h: 80, r: 10, c: [0xe8, 0x63, 0x3b] },
  { x: 228, y: 222, w: 56, h: 140, r: 10, c: [0xe8, 0x63, 0x3b] },
  { x: 320, y: 150, w: 56, h: 212, r: 10, c: [0xf5, 0x9e, 0x0b] },
];

const inRound = (px, py, { x, y, w, h, r }) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

function render(size, { rounded }) {
  const S = 4, k = 512 / size;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
      const x = (i + (si + 0.5) / S) * k, y = (j + (sj + 0.5) / S) * k;
      // Rounded tile for the plain icon; full-bleed for apple/maskable, which the OS crops.
      if (rounded && !inRound(x, y, { x: 0, y: 0, w: 512, h: 512, r: 112 })) continue;
      const bar = BARS.find((s) => inRound(x, y, s));
      const c = bar ? bar.c : BG;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = S * S, o = (j * size + i) * 4, cov = a / 255 || 1;
    px[o] = r / cov; px[o + 1] = g / cov; px[o + 2] = b / cov; px[o + 3] = a / n;
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync("public/icon-192.png", render(192, { rounded: true }));
writeFileSync("public/icon-512.png", render(512, { rounded: true }));
writeFileSync("public/icon-maskable-512.png", render(512, { rounded: false }));
writeFileSync("public/apple-touch-icon.png", render(180, { rounded: false }));
console.log("Wrote public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png");
