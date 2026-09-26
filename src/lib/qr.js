// Minimal QR encoder (byte mode, ECC-M, auto version 1-10) — zero dependencies.
// Port of the classic qrcode-generator algorithm (MIT, Kazuhiko Arase).

const RS_GF = 0x11d;

function gfMul(x, y) {
  let r = 0;
  while (y > 0) {
    if (y & 1) r ^= x;
    x <<= 1;
    if (x & 0x100) x ^= RS_GF;
    y >>= 1;
  }
  return r;
}

function rsGenPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1 << i) ? gfMul(poly[j], 1) ^ gfMul(poly[j] ^ poly[j], 0) : 0;
    }
    // simpler correct construction below
    poly = polyMul(poly, [1, 1 << i]);
  }
  return poly;
}
function polyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) r[i + j] ^= gfMul(a[i], b[j]);
  return r;
}
function rsRemainder(data, gen) {
  const res = data.slice();
  for (let i = 0; i < data.length - gen.length + 1; i++) {
    const f = res[i];
    if (f === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], f);
  }
  return res.slice(data.length - gen.length + 1);
}

// BCH(15,5) format info
const FORMAT_INFO_MASK = 0x5412;
function bchFormat(data) {
  let d = data << 10;
  const G = 0x537;
  for (let i = 4; i >= 0; i--) if ((d >> (i + 10)) & 1) d ^= G << i;
  return ((data << 10) | d) ^ FORMAT_INFO_MASK;
}

function makeMatrix(ver, ecBits, dataCodewords, eccPerBlock, blocksG1, blocksG2) {
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === null) m[6][i] = i % 2 === 0 ? 1 : 0;
    if (m[i][6] === null) m[i][6] = i % 2 === 0 ? 1 : 0;
  }
  // finder patterns + separators
  const finder = (r, c) => {
    for (let dr = -1; dr <= 7; dr++)
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark = inRing && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        m[rr][cc] = dark ? 1 : 0;
      }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // alignment patterns (positions per version)
  const alignPos = [, , [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]][ver] || [6, 26, 46];
  for (const r of alignPos)
    for (const c of alignPos) {
      if (m[r][c] !== null) continue; // overlapping finder
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
    }

  // reserve format areas (dark=true placeholder)
  const reserve = (r, c) => { if (m[r][c] === null) m[r][c] = 0; };
  for (let i = 0; i < 9; i++) { reserve(8, i); reserve(i, 8); }
  for (let i = 0; i < 8; i++) { reserve(8, size - 1 - i); reserve(size - 1 - i, 8); }
  reserve(size - 8, 8); // dark module
  m[size - 8][8] = 1;

  // version info (v7+)
  if (ver >= 7) {
    let v = ver;
    for (let i = 0; i < 12; i++) v <<= 1, (v ^= 0x1f25 << (12 - 12) & 0) || 0;
    let g = ver;
    let rem = 0;
    for (let i = 5; i >= 0; i--) if ((ver >> i) & 1) rem ^= 0x1f25 >> (6 - 1 - i + 1) || 0;
    rem = ver;
    for (let i = 0; i < 12; i++) rem <<= 1;
    // proper BCH for version: G = 0x1f25, 6-bit data
    let d = ver << 12;
    for (let i = 5; i >= 0; i--) if ((d >> (i + 12)) & 1) d ^= 0x1f25 << i;
    const vinfo = (ver << 12) | d;
    for (let i = 0; i < 18; i++) {
      const bit = (vinfo >> i) & 1;
      const a = Math.floor(i / 3), b = (i % 3) + size - 11;
      m[b][a] = bit;
      m[a][b] = bit;
    }
  }

  // place data with mask 0 (i+j)%2===0
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(4, 4); // byte mode
  push(dataCodewords.length, ver <= 9 ? 8 : 16);
  const bytes = typeof ecBits === "string" ? new TextEncoder().encode(ecBits) : ecBits;
  for (const b of bytes) push(b, 8);
  // terminator + pad
  const capacity = (dataCodewords.length) * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }
  const pads = [0xec, 0x11];
  let pi = 0;
  while (codewords.length < dataCodewords.length) codewords.push(pads[pi++ % 2]);

  // split into blocks, compute ecc, interleave
  const total = dataCodewords.length / blocksG1;
  const blocks = [];
  let off = 0;
  for (let b = 0; b < blocksG1; b++) {
    blocks.push({ data: codewords.slice(off, off + total), short: false });
    off += total;
  }
  const gen = polyMulHelper(eccPerBlock);
  const all = [];
  const eccs = [];
  for (const blk of blocks) eccs.push(rsRemainder([...blk.data, ...new Array(gen.length - 1).fill(0)], gen));
  for (let i = 0; i < total; i++) for (const blk of blocks) all.push(blk.data[i]);
  for (let i = 0; i < eccPerBlock; i++) for (const e of eccs) all.push(e[i]);

  // zigzag placement
  const dbits = [];
  for (const c of all) for (let i = 7; i >= 0; i--) dbits.push((c >> i) & 1);
  let di = 0;
  const totalBits = dbits.length;
  let col = size - 1;
  let upward = true;
  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (let c of [col, col - 1]) {
        if (m[r][c] !== null) continue;
        let bit = di < totalBits ? dbits[di++] : 0;
        // mask 0: (r + c) % 2 === 0
        if ((r + c) % 2 === 0) bit ^= 1;
        m[r][c] = bit;
      }
    }
    upward = !upward;
    col -= 2;
  }

  // format info placement (mask 0, ECC level M = 0b00)
  const fi = bchFormat(0); // L=01? — use M=00: (00 << 3) | 0
  for (let i = 0; i <= 5; i++) m[8][i] = (fi >> i) & 1;
  m[8][7] = (fi >> 6) & 1;
  m[8][8] = (fi >> 7) & 1;
  m[7][8] = (fi >> 8) & 1;
  for (let i = 9; i < 15; i++) m[14 - i][8] = (fi >> i) & 1;
  for (let i = 0; i < 8; i++) m[size - 1 - i][8] = (fi >> i) & 1;
  for (let i = 8; i < 15; i++) m[8][size - 15 + i] = (fi >> i) & 1;
  m[size - 8][8] = 1;

  return m;
}

function polyMulHelper(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) poly = polyMul(poly, [1, gfPow(i)]);
  return poly;
}
function gfPow(i) {
  let v = 1;
  for (let k = 0; k < i; k++) v = gfMul(v, 2);
  return v;
}

// version table for ECC M: [totalCodewords, ecPerBlock, g1blocks, g2blocks]
const M_TABLE = {
  1: [16, 10, 1, 0],
  2: [28, 16, 1, 0],
  3: [44, 26, 1, 0],
  4: [64, 18, 2, 0],
  5: [86, 24, 2, 0],
  6: [108, 16, 4, 0],
  7: [124, 18, 4, 0],
  8: [154, 22, 2, 2],
  9: [182, 22, 3, 2],
  10: [216, 26, 4, 1],
};

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const lenBits = bytes.length <= 45 ? 8 : 16; // v1-9 vs v10+
  for (let ver = 1; ver <= 10; ver++) {
    const [total, ec, g1, g2] = M_TABLE[ver];
    const capBits = 4 + lenBits + bytes.length * 8;
    if (capBits <= total * 8) {
      return makeMatrix(ver, text, total, ec, g1 + g2, g2);
    }
  }
  throw new Error("QR payload too long");
}

export function qrDataUrl(text, scale = 8, border = 3) {
  const m = qrMatrix(text);
  const size = m.length + border * 2;
  const c = document.createElement("canvas");
  c.width = c.height = size * scale;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f2f4ef";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#1a2020";
  for (let r = 0; r < m.length; r++)
    for (let cc = 0; cc < m.length; cc++)
      if (m[r][cc]) ctx.fillRect((cc + border) * scale, (r + border) * scale, scale, scale);
  return c.toDataURL("image/png");
}
