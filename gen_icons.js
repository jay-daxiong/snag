/* 零依赖生成 Snag 应用图标（PNG 192 / 512），用于 PWA 安装。
 * 仅用 Node 内置模块：纯像素绘制 + 手写 PNG 编码（RGBA, zlib 压缩）。
 * 运行：node gen_icons.js
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const SIZE = 512;
const RADIUS = 112;            // 圆角半径
const TOP = [15, 185, 126];    // 渐变顶部 #0FB97E
const BOT = [10, 143, 99];     // 渐变底部 #0A8F63
const FG = [255, 255, 255];    // 前景白色

// 经典地图“定位针”标记（圆头 + 三角尾），纯数学绘制，缩放清晰
function build(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / SIZE;
  const r = RADIUS * scale;
  const cx = size / 2;
  const rr = size * 0.235;          // 针头圆半径
  const cy0 = size * 0.40;           // 针头圆心
  const tipY = size * 0.80;          // 针尖
  const FG = [255, 255, 255];

  // 点在三角形内（针尾）：顶点 tip、底点 (cx-rr,cy0)、(cx+rr,cy0)
  function inTri(px, py) {
    const ax = cx - rr, ay = cy0, bx = cx + rr, by = cy0, cx2 = cx, cy2 = tipY;
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx2) * (by - cy2) - (bx - cx2) * (py - cy2);
    const d3 = (px - ax) * (cy2 - ay) - (cx2 - ax) * (py - ay);
    const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(neg && pos);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 圆角裁切
      let alpha = 255;
      const ddx = Math.max(r - x, x - (size - r), 0);
      const ddy = Math.max(r - y, y - (size - r), 0);
      if (ddx > 0 && ddy > 0 && Math.hypot(ddx, ddy) > r) alpha = 0;

      const onCircle = Math.hypot(x - cx, y - cy0) <= rr;
      const onTail = (y >= cy0) && inTri(x, y);
      const isPin = onCircle || onTail;

      const t = y / size;
      const rr2 = Math.round(TOP[0] + (BOT[0] - TOP[0]) * t);
      const gg = Math.round(TOP[1] + (BOT[1] - TOP[1]) * t);
      const bb = Math.round(TOP[2] + (BOT[2] - TOP[2]) * t);
      if (isPin && alpha) { buf[i]=FG[0]; buf[i+1]=FG[1]; buf[i+2]=FG[2]; buf[i+3]=alpha; }
      else { buf[i]=rr2; buf[i+1]=gg; buf[i+2]=bb; buf[i+3]=alpha; }
    }
  }
  return buf;
}

// ---- PNG 编码 ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  // 每行加 1 字节 filter(0)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

[192, 512].forEach((s) => {
  const raw = build(s);
  const png = encodePNG(s, raw);
  const file = path.join(__dirname, 'icon-' + s + '.png');
  fs.writeFileSync(file, png);
  console.log('wrote', file, png.length, 'bytes');
});
