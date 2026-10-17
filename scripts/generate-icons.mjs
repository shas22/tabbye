// Draws the toolbar icon as PNGs with no dependencies. Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function distance(x, y, ax, ay, bx, by) {
  const t = Math.max(
    0,
    Math.min(
      1,
      ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) /
        ((bx - ax) ** 2 + (by - ay) ** 2),
    ),
  );
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
}
const strokes = [
  [8, 11, 24, 11],
  [8, 11, 8, 25],
  [8, 25, 24, 25],
  [24, 25, 24, 11],
  [12, 7, 20, 7],
  [16, 14, 16, 21],
  [13, 18, 16, 21],
  [16, 21, 19, 18],
];
mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = ((x + (sx + 0.5) / 4) * 32) / size;
          const py = ((y + (sy + 0.5) / 4) * 32) / size;
          const dx = Math.max(6 - px, 0, px - 26);
          const dy = Math.max(6 - py, 0, py - 26);
          if (dx * dx + dy * dy > 36) continue;
          const white = strokes.some(
            ([ax, ay, bx, by]) => distance(px, py, ax, ay, bx, by) <= 1,
          );
          const color = white ? [255, 255, 255] : [56, 102, 76];
          for (let c = 0; c < 3; c++) sum[c] += color[c];
          sum[3] += 255;
        }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++)
        pixels[offset + c] = sum[3] ? Math.round(sum[c] / (sum[3] / 255)) : 0;
      pixels[offset + 3] = Math.round(sum[3] / 16);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    `public/icon/${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
