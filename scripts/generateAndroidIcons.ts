import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blendOver(dst: Rgba, src: Rgba, alphaScale = 1): Rgba {
  const sa = clamp(src.a * alphaScale, 0, 1);
  if (sa <= 0) return dst;
  const inv = 1 - sa;
  return {
    r: src.r * sa + dst.r * inv,
    g: src.g * sa + dst.g * inv,
    b: src.b * sa + dst.b * inv,
    a: sa + dst.a * inv,
  };
}

function sdRoundedBox(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  r: number
): number {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - r;
}

function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay || 1;
  const h = clamp((pax * bax + pay * bay) / denom, 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/**
 * Evaluates a single sample point (u, v) in normalized [0..512] icon coordinates.
 * Matches the official T2C Clermont-Ferrand brand identity:
 *   - Signature T2C Crimson (#AB161B / #C41C22 -> #7B0D11)
 *   - Volvic Charcoal (#1A1B1F)
 *   - Crisp Pure White (#FFFFFF)
 * When `maskable` is true, renders full-bleed T2C crimson background and scales the
 * core tramway emblem into the central 72% Android Adaptive Icon safe zone.
 */
function sampleIcon(uRaw: number, vRaw: number, maskable: boolean, pixelSize: number): Rgba {
  const aa = Math.max(0.95, (512 / pixelSize) * 0.72);

  // 1. Official T2C Crimson diagonal gradient (#C41C22 -> #AB161B -> #7B0D11)
  const diagT = clamp(((uRaw - 60) * 0.65 + (vRaw - 30) * 0.85) / 590, 0, 1);
  let rBg: number;
  let gBg: number;
  let bBg: number;
  if (diagT < 0.52) {
    const k = diagT / 0.52;
    rBg = mix(196, 171, k);
    gBg = mix(28, 22, k);
    bBg = mix(34, 27, k);
  } else {
    const k = (diagT - 0.52) / 0.48;
    rBg = mix(171, 123, k);
    gBg = mix(22, 13, k);
    bBg = mix(27, 17, k);
  }

  let color: Rgba = { r: rBg, g: gBg, b: bBg, a: 1 };

  // Subtle warm top-left radial glow
  const glowDist = Math.hypot((uRaw - 180) / 330, (vRaw - 115) / 330);
  const glowAlpha = (1 - smoothstep(0, 1, glowDist)) * 0.2;
  color = blendOver(color, { r: 255, g: 112, b: 116, a: glowAlpha });

  // Scale core artwork into safe zone for maskable / Android adaptive icons
  const scale = maskable ? 0.72 : 0.94;
  const u = (uRaw - 256) / scale + 256;
  const v = (vRaw - 256) / scale + 256;

  // 2. Subtle full-bleed diagonal Tramway A corridor ribbon
  const dCorr1 = sdSegment(u, v, -260, 614, 172, 192);
  const dCorr2 = sdSegment(u, v, 172, 192, 340, 192);
  const dCorr3 = sdSegment(u, v, 340, 192, 772, -230);
  const dCorr = Math.min(dCorr1, dCorr2, dCorr3);

  color = blendOver(
    color,
    { r: 87, g: 8, b: 11, a: 0.34 },
    1 - smoothstep(-aa, aa, dCorr - 32)
  );
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 0.16 },
    1 - smoothstep(-aa, aa, dCorr - 2.2)
  );

  // 3. Twin perspective rails + Translohr central guide rail
  const dCrossTie = sdSegment(u, v, 176, 406, 336, 406) - 4;
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 0.45 },
    1 - smoothstep(-aa, aa, dCrossTie)
  );

  const dCenterRailBg = sdSegment(u, v, 256, 366, 256, 432) - 6;
  color = blendOver(
    color,
    { r: 26, g: 27, b: 31, a: 0.55 },
    1 - smoothstep(-aa, aa, dCenterRailBg)
  );
  const dCenterRailCore = sdSegment(u, v, 256, 366, 256, 430) - 2.5;
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 0.72 },
    1 - smoothstep(-aa, aa, dCenterRailCore)
  );

  const dRailL = sdSegment(u, v, 196, 364, 152, 438) - 7;
  const dRailR = sdSegment(u, v, 316, 364, 360, 438) - 7;
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 0.94 },
    1 - smoothstep(-aa, aa, Math.min(dRailL, dRailR))
  );

  // 4. Roof pantograph collector
  const dPantoArmL = sdSegment(u, v, 234, 86, 256, 114) - 4;
  const dPantoArmR = sdSegment(u, v, 278, 86, 256, 114) - 4;
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 0.84 },
    1 - smoothstep(-aa, aa, Math.min(dPantoArmL, dPantoArmR))
  );
  const dPantoBar = sdSegment(u, v, 210, 86, 302, 86) - 5.5;
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 0.96 },
    1 - smoothstep(-aa, aa, dPantoBar)
  );

  // 5. Soft drop shadow beneath central tramway cab
  const dShadow = sdRoundedBox(u, v, 256, 252, 122, 128, 56);
  const shadowAlpha = (1 - smoothstep(-4, 28, dShadow)) * 0.4;
  color = blendOver(color, { r: 62, g: 5, b: 7, a: shadowAlpha });

  // 6. Outer Volvic Charcoal chassis rim (#1A1B1F)
  const dChassis = sdRoundedBox(u, v, 256, 240, 120, 126, 56);
  color = blendOver(
    color,
    { r: 26, g: 27, b: 31, a: 1 },
    1 - smoothstep(-aa, aa, dChassis)
  );

  // 7. Pure White sculpted tram body (#FFFFFF -> #E8ECEF)
  const dCab = sdRoundedBox(u, v, 256, 240, 108, 114, 46);
  const cabMask = 1 - smoothstep(-aa, aa, dCab);
  const cabGrad = clamp((v - 126) / 228, 0, 1);
  color = blendOver(
    color,
    {
      r: mix(255, 232, cabGrad),
      g: mix(255, 236, cabGrad),
      b: mix(255, 239, cabGrad),
      a: 1,
    },
    cabMask
  );

  // 8. Signature T2C Crimson front livery stripe clipped cleanly to the cab body
  if (cabMask > 0.001) {
    const dStripe = Math.abs(v - 288) - 10;
    const stripeMask = (1 - smoothstep(-aa, aa, dStripe)) * cabMask;
    color = blendOver(color, { r: 171, g: 22, b: 27, a: 1 }, stripeMask);
  }

  // 9. Top destination display sign (Volvic Charcoal + T2C Crimson indicator)
  const dSignOuter = sdRoundedBox(u, v, 256, 151, 46, 9, 9);
  color = blendOver(
    color,
    { r: 26, g: 27, b: 31, a: 1 },
    1 - smoothstep(-aa, aa, dSignOuter)
  );
  const dSignInner = sdRoundedBox(u, v, 256, 151, 28, 4, 4);
  color = blendOver(
    color,
    { r: 171, g: 22, b: 27, a: 1 },
    1 - smoothstep(-aa, aa, dSignInner)
  );

  // 10. Panoramic Volvic Charcoal Windshield + subtle diagonal reflection
  const dGlass = sdRoundedBox(u, v, 256, 218, 84, 46, 22);
  const glassMask = 1 - smoothstep(-aa, aa, dGlass);
  const glassGrad = clamp((u - 172 + (v - 172)) / 260, 0, 1);
  color = blendOver(
    color,
    {
      r: mix(39, 20, glassGrad),
      g: mix(42, 21, glassGrad),
      b: mix(48, 25, glassGrad),
      a: 1,
    },
    glassMask
  );

  if (glassMask > 0.001) {
    // Crisp diagonal window sheen bars
    const dSheen1 = sdSegment(u, v, 204, 246, 254, 184) - 9;
    const dSheen2 = sdSegment(u, v, 238, 246, 280, 194) - 4.5;
    color = blendOver(
      color,
      { r: 255, g: 255, b: 255, a: 0.16 },
      (1 - smoothstep(-aa, aa, dSheen1)) * glassMask
    );
    color = blendOver(
      color,
      { r: 255, g: 255, b: 255, a: 0.09 },
      (1 - smoothstep(-aa, aa, dSheen2)) * glassMask
    );
  }

  // 11. Dual headlights (Volvic charcoal bezel + pure white lens)
  const dHeadDarkL = sdCircle(u, v, 192, 322, 17);
  const dHeadDarkR = sdCircle(u, v, 320, 322, 17);
  color = blendOver(
    color,
    { r: 26, g: 27, b: 31, a: 1 },
    1 - smoothstep(-aa, aa, Math.min(dHeadDarkL, dHeadDarkR))
  );
  const dHeadLitL = sdCircle(u, v, 192, 322, 9.5);
  const dHeadLitR = sdCircle(u, v, 320, 322, 9.5);
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 1 },
    1 - smoothstep(-aa, aa, Math.min(dHeadLitL, dHeadLitR))
  );

  // 12. Center T2C Crimson front badge bar
  const dCenterBar = sdRoundedBox(u, v, 256, 322, 28, 9, 9);
  color = blendOver(
    color,
    { r: 171, g: 22, b: 27, a: 1 },
    1 - smoothstep(-aa, aa, dCenterBar)
  );
  const dCenterHighlight = sdRoundedBox(u, v, 256, 322, 14, 3, 3);
  color = blendOver(
    color,
    { r: 255, g: 255, b: 255, a: 0.92 },
    1 - smoothstep(-aa, aa, dCenterHighlight)
  );

  return color;
}

// CRC-32 table for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIconPng(size: number, maskable: boolean): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  // 2x2 rotated-grid supersampling for crisp anti-aliased edges
  const offsets = [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [ox, oy] of offsets) {
        const u = ((x + 0.5 + ox) / size) * 512;
        const v = ((y + 0.5 + oy) / size) * 512;
        const s = sampleIcon(u, v, maskable, size);
        r += s.r;
        g += s.g;
        b += s.b;
        a += s.a;
      }
      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(clamp(r / 4, 0, 255));
      rgba[idx + 1] = Math.round(clamp(g / 4, 0, 255));
      rgba[idx + 2] = Math.round(clamp(b / 4, 0, 255));
      rgba[idx + 3] = Math.round(clamp((a / 4) * 255, 0, 255));
    }
  }

  return encodePng(size, size, rgba);
}

function writeIcon(filePath: string, size: number, maskable: boolean): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const png = renderIconPng(size, maskable);
  fs.writeFileSync(filePath, png);
  console.log(
    `[Icons] Generated ${path.relative(ROOT_DIR, filePath)} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`
  );
}

function main(): void {
  // Web / PWA / iOS / Android Chrome icons in public/
  writeIcon(path.join(PUBLIC_DIR, 'pwa-192x192.png'), 192, false);
  writeIcon(path.join(PUBLIC_DIR, 'pwa-512x512.png'), 512, false);
  writeIcon(path.join(PUBLIC_DIR, 'pwa-maskable-512x512.png'), 512, true);
  writeIcon(path.join(PUBLIC_DIR, 'apple-touch-icon.png'), 180, false);

  // Populate native Capacitor Android launcher mipmaps
  const androidResDir = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res');
  if (fs.existsSync(androidResDir)) {
    const mipmaps: Array<{ dir: string; size: number; foregroundSize: number }> = [
      { dir: 'mipmap-mdpi', size: 48, foregroundSize: 108 },
      { dir: 'mipmap-hdpi', size: 72, foregroundSize: 162 },
      { dir: 'mipmap-xhdpi', size: 96, foregroundSize: 216 },
      { dir: 'mipmap-xxhdpi', size: 144, foregroundSize: 324 },
      { dir: 'mipmap-xxxhdpi', size: 192, foregroundSize: 432 },
    ];
    for (const m of mipmaps) {
      const targetDir = path.join(androidResDir, m.dir);
      if (!fs.existsSync(targetDir)) continue;
      writeIcon(path.join(targetDir, 'ic_launcher.png'), m.size, false);
      writeIcon(path.join(targetDir, 'ic_launcher_round.png'), m.size, true);
      writeIcon(path.join(targetDir, 'ic_launcher_foreground.png'), m.foregroundSize, true);
    }
  }
}

main();
