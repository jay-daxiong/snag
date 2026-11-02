/* 极简 QR Code 生成器（前端，零依赖，字节模式 + 纠错等级 M）
 * 仅用于分享海报上的二维码，容量足够普通 URL。算法为标准 QR 规范实现。
 * 暴露：window.QR.generate(text) -> { size, modules: bool[][] }
 */
(function () {
  'use strict';
  var PAD0 = 0xEC, PAD1 = 0x11;
  var EXP = new Array(256), LOG = new Array(256);
  (function () { var x = 1; for (var i = 0; i < 256; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } })();
  function gexp(n) { while (n < 0) n += 255; while (n >= 255) n -= 255; return EXP[n]; }
  function glog(n) { return LOG[n]; }
  function rsPoly(ecLen) {
    var poly = [1];
    for (var i = 0; i < ecLen; i++) {
      var np = [], len = poly.length;
      np.length = len + 1;
      for (var j = 0; j < len; j++) np[j] = poly[j];
      for (var k = 0; k < np.length; k++) {
        np[k] = (np[k] || 0) ^ gexp(glog(poly[k] || 0) + i);
      }
      poly = np.filter(function (v, idx) { return v !== 0 || idx === np.length - 1; });
    }
    var res = []; for (var m = 0; m < ecLen; m++) res.push(poly[m] || 0); return res;
  }
  // 各版本(1-10) EC level M 的纠错码字数 与 数据容量(字节)
  var EC_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 24]; // version 1..10
  var CAP_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  function chooseVersion(len) {
    for (var v = 0; v < CAP_M.length; v++) if (len <= CAP_M[v]) return v + 1;
    return -1;
  }
  function bitBuf() { this.buf = []; this.len = 0; }
  bitBuf.prototype.put = function (num, len) { for (var i = 0; i < len; i++) this.buf.push((num >> (len - i - 1)) & 1); this.len += len; };
  bitBuf.prototype.putBit = function (b) { this.buf.push(b ? 1 : 0); this.len++; };
  function makeData(text) {
    var bytes = []; for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); if (c < 128) bytes.push(c); else { bytes.push(0xC0 | (c >> 6)); bytes.push(0x80 | (c & 0x3F)); } }
    var ver = chooseVersion(bytes.length); if (ver < 1) return null;
    var bb = new bitBuf();
    // 字节模式指示符 0100 + 字符计数(8/16位)
    bb.put(0x4, 4); if (ver < 10) bb.put(bytes.length, 8); else bb.put(bytes.length, 16);
    for (var k = 0; k < bytes.length; k++) bb.put(bytes[k], 8);
    var ecLen = EC_M[ver - 1];
    var totalDataBits = CAP_M[ver - 1] * 8;
    // 终止符
    var term = Math.min(4, totalDataBits - bb.len); bb.put(0, term);
    while (bb.len % 8 !== 0) bb.putBit(false);
    // 填充字节
    var pad = (bb.len / 8);
    var padded = []; for (var p = 0; p < pad; p++) padded.push(bb.buf.slice(p * 8, p * 8 + 8).reduce(function (a, b) { return (a << 1) | b; }, 0));
    for (var q = 0; q < 2 && (padded.length + (q % 2 === 0 ? 0 : 0)) < (totalDataBits / 8); q++) padded.push(q % 2 === 0 ? PAD0 : PAD1);
    // 分组交织
    var dataCodewords = padded;
    var ecCodewords = rsPoly(ecLen);
    var blocks = [dataCodewords], ecOut = [];
    for (var bi = 0; bi < blocks.length; bi++) {
      var data = blocks[bi], ec = [], lfsr = ecCodewords.slice();
      for (var dc = 0; dc < data.length; dc++) lfsr.unshift(data[dc]);
      while (lfsr.length > ecLen) { var cf = glog(lfsr.shift()); for (var e = 0; e < lfsr.length; e++) lfsr[e] ^= gexp(cf + glog(ecCodewords[e] || 1)); }
      for (var ei = 0; ei < ecLen; ei++) ec.push(lfsr[ei] || 0);
      ecOut = ecOut.concat(ec);
    }
    // 交织成比特流（单块）
    var all = dataCodewords.concat(ecOut);
    var stream = new bitBuf(); for (var ai = 0; ai < all.length; ai++) stream.put(all[ai], 8);
    return { ver: ver, bits: stream, ecLen: ecLen };
  }
  function buildMatrix(ver, bits) {
    var size = ver * 4 + 17;
    var m = []; for (var i = 0; i < size; i++) { m.push(new Array(size).fill(null)); }
    function setF(i, j, v) { m[i][j] = v; }
    function isF(i, j) { return m[i][j] !== null; }
    // 定位符
    function finder(r, c) {
      for (var i = 0; i < 7; i++) for (var j = 0; j < 7; j++) {
        var on = (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        setF(r + i, c + j, on);
      }
      for (var a = -1; a <= 7; a++) for (var b = -1; b <= 7; b++) {
        if (a >= 0 && a <= 6 && b >= 0 && b <= 6) continue;
        if (r + a < 0 || r + a >= size || c + b < 0 || c + b >= size) continue;
        if (Math.abs(a - 3) === 4 || Math.abs(b - 3) === 4) setF(r + a, c + b, false);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    // 校正图形（>= ver 2）
    if (ver >= 2) {
      var pos = ver === 2 ? [6, size - 7] : [6, Math.floor(size / 2) - 1, size - 7];
      for (var pi = 0; pi < pos.length; pi++) for (var pj = 0; pj < pos.length; pj++) {
        if ((pos[pi] <= 7 && pos[pj] <= 7) || (pos[pi] <= 7 && pos[pj] >= size - 8) || (pos[pi] >= size - 8 && pos[pj] <= 7)) continue;
        var cr = pos[pi], cc = pos[pj];
        for (var di = -2; di <= 2; di++) for (var dj = -2; dj <= 2; dj++) setF(cr + di, cc + dj, Math.max(Math.abs(di), Math.abs(dj)) !== 1);
      }
    }
    // 定时图案
    for (var t = 8; t < size - 8; t++) { if (!isF(6, t)) setF(6, t, t % 2 === 0); if (!isF(t, 6)) setF(t, 6, t % 2 === 0); }
    // 暗模块
    setF(size - 8, 8, true);
    // 格式信息占位（先留 null 由后续填）
    // 数据放置（掩码 0）
    var dir = -1, row = size - 1, col = size - 1;
    var bitIdx = 0, total = bits.len;
    while (col > 0) {
      if (col === 6) col--;
      var c2 = col;
      for (var cnt = 0; cnt < 2; cnt++) {
        var cc2 = c2 - cnt;
        if (!isF(row, cc2)) {
          var bit = bitIdx < total ? bits.buf[bitIdx++] : false;
          var mask = (row + cc2) % 2 === 0; // mask 0
          setF(row, cc2, bit !== mask);
        }
      }
      row += dir;
      if (row < 0 || row >= size) { dir = -dir; row += dir; col -= 2; }
    }
    return { m: m, size: size };
  }
  function formatBits(ecLevelBits, maskPattern) {
    var data = (ecLevelBits << 3) | maskPattern;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var arr = []; for (var b = 14; b >= 0; b--) arr.push((bits >> b) & 1);
    return arr;
  }
  function applyFormat(m, size) {
    var fb = formatBits(0, 0); // EC level M = 0, mask 0
    for (var i = 0; i < 15; i++) {
      var v = fb[i] === 1;
      if (i < 6) m[i][8] = v; else if (i < 8) m[i + 1][8] = v; else m[size - 15 + i][8] = v;
      if (i < 8) m[8][size - 1 - i] = v; else if (i < 9) m[8][15 - i] = v; else m[8][15 - i - 1] = v;
    }
  }
  function generate(text) {
    var d = makeData(text); if (!d) return null;
    var r = buildMatrix(d.ver, d.bits);
    applyFormat(r.m, r.size);
    return { size: r.size, modules: r.m };
  }
  window.QR = { generate: generate, chooseVersion: chooseVersion };
})();
