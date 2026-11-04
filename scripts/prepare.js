// Builds the app/ folder (page + fonts) and build/icon.png from the repo's index.html.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const fontsDir = path.join(appDir, 'fonts');
fs.mkdirSync(fontsDir, { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });

/* ---------- fonts (bundled so the app works offline) ---------- */
const FONT_FILES = [
  ['assistant', 'assistant-hebrew-400-normal.woff2'],
  ['assistant', 'assistant-hebrew-600-normal.woff2'],
  ['assistant', 'assistant-hebrew-700-normal.woff2'],
  ['assistant', 'assistant-latin-400-normal.woff2'],
  ['assistant', 'assistant-latin-600-normal.woff2'],
  ['assistant', 'assistant-latin-700-normal.woff2'],
  ['secular-one', 'secular-one-hebrew-400-normal.woff2'],
  ['secular-one', 'secular-one-latin-400-normal.woff2']
];
for (const [pkg, file] of FONT_FILES) {
  fs.copyFileSync(path.join(root, 'node_modules', '@fontsource', pkg, 'files', file), path.join(fontsDir, file));
}
const HEB = 'U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F';
const LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
function face(family, weight, file, range) {
  return '@font-face{font-family:"' + family + '";font-style:normal;font-weight:' + weight +
    ';font-display:swap;src:url("fonts/' + file + '") format("woff2");unicode-range:' + range + ';}';
}
const faces = [];
for (const w of [400, 600, 700]) {
  faces.push(face('Assistant', w, 'assistant-hebrew-' + w + '-normal.woff2', HEB));
  faces.push(face('Assistant', w, 'assistant-latin-' + w + '-normal.woff2', LAT));
}
faces.push(face('Secular One', 400, 'secular-one-hebrew-400-normal.woff2', HEB));
faces.push(face('Secular One', 400, 'secular-one-latin-400-normal.woff2', LAT));

/* ---------- page ---------- */
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const before = html.length;
html = html.replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, '');
if (html.length === before) throw new Error('Google Fonts links not found in index.html');
const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; connect-src 'none'";
const inject = '<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n<style>' + faces.join('\n') + '</style>\n';
if (html.indexOf('<meta charset="utf-8">') === -1) throw new Error('charset meta not found');
html = html.replace('<meta charset="utf-8">\n', () => '<meta charset="utf-8">\n' + inject);
fs.writeFileSync(path.join(appDir, 'index.html'), html);

/* ---------- icon (512x512 tomato, drawn without dependencies) ---------- */
function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
}
const CRC = crcTable();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function inEllipse(x, y, cx, cy, rx, ry, rot) {
  let dx = x - cx, dy = y - cy;
  if (rot) { const c = Math.cos(-rot), s = Math.sin(-rot); const nx = dx * c - dy * s; dy = dx * s + dy * c; dx = nx; }
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const SIZE = 512, K = 8; // SVG viewBox is 64, scale 8
const STAR = [[32,16],[35.5,22.5],[43,20],[38.5,26],[45,29.5],[36.5,29],[32,34],[27.5,29],[19,29.5],[25.5,26],[21,20],[28.5,22.5]].map(p => [p[0] * K, p[1] * K]);
function shade(x, y) {
  // returns [r,g,b,a] for a sample point, or null for transparent
  if (x >= 30.4 * K && x <= 33.6 * K && y >= 8 * K && y <= 17 * K) return [45, 107, 48, 1];
  if (inPoly(x, y, STAR)) return [62, 142, 65, 1];
  if (inEllipse(x, y, 22 * K, 31 * K, 6 * K, 3.5 * K, -35 * Math.PI / 180)) return [255, 255, 255, 0.38, true];
  if (inEllipse(x, y, 32 * K, 37 * K, 25 * K, 22 * K)) return [229, 64, 43, 1];
  return null;
}
const out = Buffer.alloc(SIZE * SIZE * 4);
const SS = 3;
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS;
      let c = shade(x, y);
      if (!c) continue;
      if (c[4]) { // highlight over body
        const base = inEllipse(x, y, 32 * K, 37 * K, 25 * K, 22 * K) ? [229, 64, 43] : null;
        if (!base) continue;
        c = [base[0] + (255 - base[0]) * 0.38, base[1] + (255 - base[1]) * 0.38, base[2] + (255 - base[2]) * 0.38, 1];
      }
      r += c[0]; g += c[1]; b += c[2]; a += c[3];
    }
    const n = SS * SS, i = (py * SIZE + px) * 4;
    if (a > 0) { out[i] = Math.round(r / a); out[i + 1] = Math.round(g / a); out[i + 2] = Math.round(b / a); out[i + 3] = Math.round((a / n) * 255); }
  }
}
fs.writeFileSync(path.join(root, 'build', 'icon.png'), encodePng(SIZE, SIZE, out));
console.log('prepared app/ and build/icon.png');
