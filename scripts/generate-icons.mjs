/**
 * Generates PWA icons for public/icon-192.png and public/icon-512.png.
 * Brand color: #e58a3a (orange)
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crcBuf]);
}

function createIconPNG(size) {
  // Brand orange: #e58a3a
  const R = 229, G = 138, B = 58;
  // Background: white
  const BG_R = 255, BG_G = 255, BG_B = 255;

  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.44;    // outer circle radius
  const innerR = size * 0.28;    // inner circle (tiffin lid hole)
  const rimH  = size * 0.06;     // rim strip height

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte + RGB
    row[0] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const normY = (y - cy) / outerR;

      let r = BG_R, g = BG_G, b = BG_B;

      if (dist <= outerR) {
        // Base orange fill
        r = R; g = G; b = B;

        // Darker rim band near top (tiffin container detail)
        if (normY >= -0.55 && normY <= -0.38) {
          r = Math.round(R * 0.75);
          g = Math.round(G * 0.75);
          b = Math.round(B * 0.75);
        }

        // Inner circle cutout for tiffin lid detail (lighter)
        if (dist <= innerR && normY < -0.1) {
          r = Math.min(255, Math.round(R * 1.2));
          g = Math.min(255, Math.round(G * 1.2));
          b = Math.min(255, Math.round(B * 1.1));
        }

        // Bottom shadow
        if (normY > 0.6) {
          r = Math.round(R * 0.82);
          g = Math.round(G * 0.82);
          b = Math.round(B * 0.82);
        }
      }

      const off = 1 + x * 3;
      row[off] = r;
      row[off + 1] = g;
      row[off + 2] = b;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(publicDir, { recursive: true });

writeFileSync(join(publicDir, "icon-192.png"), createIconPNG(192));
console.log("✓ public/icon-192.png");

writeFileSync(join(publicDir, "icon-512.png"), createIconPNG(512));
console.log("✓ public/icon-512.png");
