// One-time script to generate placeholder PNG icons for the PWA manifest.
// Run: node generate-icons.cjs
// User should replace these with real icons later.

const { writeFileSync, mkdirSync } = require('fs');
const { deflateSync } = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function makePNG(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const rowBytes = 1 + size * 3;
  const raw = Buffer.alloc(size * rowBytes);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const o = y * rowBytes + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });

// Kit purple #7c3aed
const [r, g, b] = [124, 58, 237];
writeFileSync('public/icons/icon-192.png', makePNG(192, r, g, b));
writeFileSync('public/icons/icon-512.png', makePNG(512, r, g, b));
writeFileSync('public/icons/icon-180.png', makePNG(180, r, g, b));

console.log('Placeholder icons created in public/icons/');
