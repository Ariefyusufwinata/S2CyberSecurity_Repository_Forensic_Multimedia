'use strict';
/* ============================================================================
 * huffman.js — Mathematical Formulas, Huffman (DHT) & 576-Feature Signature Engine
 * Reference: Eric Kee, Micah K. Johnson & Hany Farid,
 *            "Digital Image Authentication from JPEG Headers",
 *            IEEE Transactions on Information Forensics and Security, 6(3), 2011.
 * ============================================================================ */

/* ---------------- 1. Zig-Zag Permutation & 64-bit Hash Formula ----------------
 * JPEG stores 8x8 DQT matrices in zig-zag scan order Z[0..63].
 * ZZ maps zig-zag index i -> natural row-major index (r * 8 + c). */
const ZZ = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
];

const EDITORS = /photoshop|gimp|lightroom|paint\.net|pixelmator|affinity|snapseed|picsart|canva|corel|paintshop|capture one|darktable|rawtherapee|luminar|photoscape|fotor|facetune|vsco|adobe|acdsee|irfanview|imagemagick|photoworks|pixlr|sumopaint/i;

/* Dual 32-bit FNV-1a / Murmur-inspired hash -> 16-hex-digit (64-bit) signature ID:
 *   a_{k} = ((a_{k-1} XOR c_k) * 0x01000193) mod 2^32
 *   b_{k} = ((b_{k-1} XOR c_k) * 0x85ebca6b) mod 2^32 */
function hash(str) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    a = Math.imul(a ^ str.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ str.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/* ---------------- 2. Huffman (DHT) Feature & Canonical Code Formulas ----------------
 * Every DHT table inside a JPEG header has the layout:
 *   - Tc/Th (1 byte)  : Tc = table class (0 = DC, 1 = AC), Th = table destination ID (0..3)
 *   - BITS[1..16]     : 16 bytes where BITS[L] = count of Huffman codes of bit-length L
 *   - HUFFVAL[1..M]   : M = sum_{L=1}^{16} BITS[L] symbol values in canonical code order
 *
 * Feature extraction formula (Kee, Johnson & Farid, 2011):
 *   1. Read the SOS (Start of Scan, 0xFFDA) component selector to bind each colour channel
 *      c in {Y, Cb, Cr} to its DC table ID Td(c) and AC table ID Ta(c).
 *   2. Order the 6 tables by channel role:
 *        (Y-DC, Y-AC, Cb-DC, Cb-AC, Cr-DC, Cr-AC)
 *   3. Extract the first 15 code-length counts BITS[1..15] from each of the 6 tables:
 *        f_huff = concat_{t=1..6} BITS_t[1..15]   (6 x 15 = 90 integer features)
 *
 * Canonical Huffman Code Generation (ITU-T T.81 / JPEG Annex C):
 *   code_1 = 0
 *   firstCode(L) = code_L
 *   code_{L+1}   = (code_L + BITS[L]) << 1
 *
 * Kraft's Inequality check (prefix-free completeness condition):
 *   sum_{L=1}^{16} BITS[L] * 2^{-L} <= 1   <=>   for all L: code_L + BITS[L] <= 2^L */
const HUFF_LABELS = ['Y-DC', 'Y-AC', 'Cb-DC', 'Cb-AC', 'Cr-DC', 'Cr-AC'];

function huffSets(p) {
  const tab = {};
  (p.dht || []).forEach(t => { if (t.counts) tab[t.cls + ':' + t.id] = t; });
  const comps = p.sof ? p.sof.comps : [], sos = {};
  (p.sos || []).forEach(s => { sos[s.cs] = s; });
  const sets = [];
  for (let c = 0; c < 3; c++) {
    const comp = comps[c], s = comp ? sos[comp.id] : null;
    const td = s ? s.td : (c ? 1 : 0), ta = s ? s.ta : (c ? 1 : 0);
    const dc = comp && tab['0:' + td], ac = comp && tab['1:' + ta];
    sets.push(dc ? dc.counts.slice(0, 15) : new Array(15).fill(0));
    sets.push(ac ? ac.counts.slice(0, 15) : new Array(15).fill(0));
  }
  return sets;
}

const huffVector = p => [].concat(...huffSets(p));

function huffInfo(counts) {
  let code = 0, total = 0, kraftSum = 0, valid = true;
  const first = [];
  for (let l = 1; l <= counts.length; l++) {
    const k = counts[l - 1];
    if (k) first.push(l + 'b:' + code.toString(2).padStart(l, '0') + (k > 1 ? ' (x' + k + ')' : ''));
    code += k;
    total += k;
    kraftSum += k / Math.pow(2, l);
    if (code > (1 << l)) valid = false;
    code <<= 1;
  }
  return { total, valid, kraftSum, first };
}

function huffRows(huff) {
  const h = huff && huff.length === 90 ? huff : new Array(90).fill(0);
  return HUFF_LABELS.map((label, i) => {
    const counts = h.slice(i * 15, i * 15 + 15);
    return { label, counts, ...huffInfo(counts) };
  });
}

/* ---------------- 3. Binary JPEG Header Parser (DQT, DHT, SOF, SOS, DRI) ---------------- */
function parseJpeg(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), n = u8.length;
  const out = { valid: false };
  if (n < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8 || u8[2] !== 0xFF) return out;
  out.valid = true;
  out.dqt = {}; out.dht = []; out.markers = []; out.sof = null; out.dri = 0;
  let p = 2, dhtStr = '';
  while (p < n - 1) {
    if (u8[p] !== 0xFF) { p++; continue; }
    while (p < n && u8[p] === 0xFF) p++;
    const m = u8[p++];
    if (m === 0x00 || m === 0x01 || (m >= 0xD0 && m <= 0xD8)) continue;
    if (m === 0xD9) break;
    if (p + 2 > n) break;
    const len = dv.getUint16(p), start = p + 2, end = Math.min(p + len, n);
    out.markers.push(m);
    const tag = k => String.fromCharCode(...u8.subarray(start, Math.min(start + k, end)));
    if (m === 0xED && tag(13) === 'Photoshop 3.0') out.photoshop = true;
    else if (m === 0xEE && tag(5) === 'Adobe') out.adobe = true;
    else if (m === 0xE1 && tag(28) === 'http://ns.adobe.com/xap/1.0/') {
      let x = ''; for (let i = start + 29; i < end; i++) x += String.fromCharCode(u8[i]);
      out.xmp = (out.xmp || '') + x;
    }
    if (m === 0xDB) {
      let q = start;
      while (q < end) {
        const pq = u8[q] >> 4, tq = u8[q] & 15; q++;
        const size = pq ? 128 : 64;
        if (q + size > end) break;
        const nat = new Array(64);
        for (let i = 0; i < 64; i++) nat[ZZ[i]] = pq ? dv.getUint16(q + i * 2) : u8[q + i];
        out.dqt[tq] = nat; q += size;
      }
    } else if (m === 0xC4) {
      let q = start;
      while (q + 17 <= end) {
        const cls = u8[q] >> 4, id = u8[q] & 15; q++;
        const counts = Array.from(u8.subarray(q, q + 16)); q += 16;
        const total = counts.reduce((a, b) => a + b, 0);
        if (q + total > end) break;
        dhtStr += cls + ':' + id + ':' + counts.join(',') + ':' + Array.from(u8.subarray(q, q + total)).join(',') + ';';
        out.dht.push({ cls, id, total, counts }); q += total;
      }
    } else if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      const nc = u8[start + 5], comps = [];
      for (let i = 0; i < nc; i++) {
        const o = start + 6 + i * 3;
        comps.push({ id: u8[o], h: u8[o + 1] >> 4, v: u8[o + 1] & 15, tq: u8[o + 2] });
      }
      out.sof = { type: m, precision: u8[start], height: dv.getUint16(start + 1), width: dv.getUint16(start + 3), comps };
    } else if (m === 0xDD) out.dri = dv.getUint16(start);
    else if (m === 0xDA) {
      const ns = u8[start]; out.sos = [];
      for (let i = 0; i < ns && start + 2 + i * 2 < n; i++)
        out.sos.push({ cs: u8[start + 1 + i * 2], td: u8[start + 2 + i * 2] >> 4, ta: u8[start + 2 + i * 2] & 15 });
      break;
    }
    p = end;
  }
  out.dhtHash = dhtStr ? hash(dhtStr) : '';
  out.huff = huffVector(out);
  const ids = Object.keys(out.dqt).map(Number).sort((a, b) => a - b);
  out.dqtKey = ids.length ? hash(ids.map(i => i + ':' + out.dqt[i].join(',')).join('|')) : '';
  if (out.sof) {
    const c = out.sof.comps, t = out.sof.type;
    out.jpegType = t === 0xC0 ? 'Baseline' : t === 0xC1 ? 'Extended Sequential' : t === 0xC2 ? 'Progressive' : 'SOF' + (t - 0xC0);
    const f = c[0] ? c[0].h + 'x' + c[0].v : '';
    out.subsampling = c.length === 1 ? 'Grayscale' : f === '2x2' ? '4:2:0' : f === '2x1' ? '4:2:2' : f === '1x1' ? '4:4:4' : f === '1x2' ? '4:4:0' : c.map(x => x.h + 'x' + x.v).join(',');
  }
  return out;
}

/* ---------------- 4. 576-Feature Camera Signature Vector ----------------
 * S = [ DQT_main (192) | Huffman_main (90) | Dims_sorted (2) | Thumb (2 + 192 + 90 = 284) | EXIF_IFD (8) ]
 * Total dimension = 192 + 90 + 2 + 284 + 8 = 576 features. */
const pad = (a, n) => { const o = Array.from(a || []).slice(0, n); while (o.length < n) o.push(0); return o; };
const dqt192 = d => [0, 1, 2].flatMap(i => pad(d && d[i], 64));

function sigParts(r) {
  const th = r.thumbSig || {}, w = r.width || 0, h = r.height || 0;
  return [
    { id: 'dqt', label: 'Quantization tables Tq0-Tq2', vals: dqt192(r.dqt) },
    { id: 'huff', label: 'Huffman code-length counts (6 x 15)', vals: pad(r.huff, 90) },
    { id: 'dims', label: 'Image dimensions (min, max)', vals: [Math.min(w, h), Math.max(w, h)] },
    { id: 'thumb', label: 'Embedded thumbnail (dims + DQT + Huffman)', vals: [th.w || 0, th.h || 0, ...pad(th.dqt, 192), ...pad(th.huff, 90)] },
    { id: 'exif', label: 'EXIF structure (IFD entry counts)', vals: pad(r.exifStruct, 8) }
  ];
}

const sigVector = r => [].concat(...sigParts(r).map(p => p.vals));
const fullKeyOf = r => r.fullKey || (r.fullKey = hash(sigVector(r).join(',')));

/* ---------------- 5. EXIF IFD Structure Counter & Embedded Thumbnail Parser ----------------
 * Counts entries in 5 standard IFDs (IFD0, Exif, Interoperability, IFD1/Thumbnail, GPS),
 * plus extra IFD count, extra IFD entries, and parser errors = 8 features. */
function exifStruct(buf) {
  const r = { counts: [0, 0, 0, 0, 0, 0, 0, 0], thumb: null, makerNote: false };
  const u8 = new Uint8Array(buf), dv = new DataView(buf), n = u8.length;
  let tiff = -1, end = 0, p = 2;
  while (p + 4 <= n && u8[p] === 0xFF) {
    const m = u8[p + 1];
    if (m === 0xDA || m === 0xD9) break;
    const len = dv.getUint16(p + 2);
    if (m === 0xE1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) {
      tiff = p + 10; end = Math.min(p + 2 + len, n); break;
    }
    p += 2 + len;
  }
  if (tiff < 0) return r;
  let errors = 0;
  try {
    const le = dv.getUint16(tiff) === 0x4949;
    const g16 = o => dv.getUint16(o, le), g32 = o => dv.getUint32(o, le), seen = new Set();
    const readIfd = off => {
      if (!off || tiff + off + 2 > end || seen.has(off)) { if (off) errors++; return null; }
      seen.add(off);
      const cnt = g16(tiff + off), endE = tiff + off + 2 + cnt * 12;
      if (endE > end) { errors++; return null; }
      const tags = {};
      for (let i = 0; i < cnt; i++) { const e = tiff + off + 2 + i * 12; tags[g16(e)] = g32(e + 8); }
      return { cnt, tags, next: endE + 4 <= end ? g32(endE) : 0 };
    };
    const ifd0 = readIfd(g32(tiff + 4));
    if (ifd0) {
      r.counts[0] = ifd0.cnt;
      const ex = ifd0.tags[0x8769] !== undefined ? readIfd(ifd0.tags[0x8769]) : null;
      if (ex) {
        r.counts[1] = ex.cnt;
        r.makerNote = ex.tags[0x927C] !== undefined;
        const io = ex.tags[0xA005] !== undefined ? readIfd(ex.tags[0xA005]) : null;
        if (io) r.counts[2] = io.cnt;
      }
      const gps = ifd0.tags[0x8825] !== undefined ? readIfd(ifd0.tags[0x8825]) : null;
      if (gps) r.counts[4] = gps.cnt;
      let nxt = ifd0.next, i1 = null;
      while (nxt) {
        const ifd = readIfd(nxt); if (!ifd) break;
        if (!i1) { i1 = ifd; r.counts[3] = ifd.cnt; }
        else { r.counts[5]++; r.counts[6] += ifd.cnt; }
        nxt = ifd.next;
      }
      if (i1 && i1.tags[0x0201] !== undefined && i1.tags[0x0202] !== undefined) {
        const s = tiff + i1.tags[0x0201], l = i1.tags[0x0202];
        if (l > 4 && s + l <= n && u8[s] === 0xFF && u8[s + 1] === 0xD8) r.thumb = [s, s + l];
      }
    }
  } catch (e) { errors++; }
  r.counts[7] = errors;
  return r;
}

function thumbSigOf(es, buf) {
  const th = { present: 0, w: 0, h: 0, dqt: new Array(192).fill(0), huff: new Array(90).fill(0) };
  if (es.thumb) {
    const tj = parseJpeg(buf.slice(es.thumb[0], es.thumb[1]));
    if (tj.valid) {
      th.present = 1;
      th.w = tj.sof ? tj.sof.width : 0;
      th.h = tj.sof ? tj.sof.height : 0;
      th.dqt = dqt192(tj.dqt);
      th.huff = tj.huff;
    }
  }
  return th;
}

/* ---------------- 6. Quantization Distance, IJG Quality & Editing Trace Formulas ----------------
 * IJG Annex K scaling formula for quality factor Q in [1..100]:
 *   scale(Q) = 5000 / Q  (if Q < 50),   200 - 2*Q  (if Q >= 50)
 *   T_Q[i]   = clamp( floor((T_std[i] * scale(Q) + 50) / 100), 1, 255 )
 *
 * Inter-signature DQT distance (L1 mean step difference across shared tables):
 *   D(A, B)  = (1 / (64 * |T|)) * sum_{t in T} sum_{i=0..63} |A_t[i] - B_t[i]|
 *   Sim(d)   = 100 / (1 + d) */
const FLICKR_SIZES = [75, 100, 150, 240, 320, 500, 640, 800, 1024, 1600, 2048];
const isFlickrResize = (w, h) => FLICKR_SIZES.includes(Math.max(w, h));

const STD_LUM = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const STD_CHR = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99].concat(new Array(32).fill(99));
const scaleQ = (std, q) => { const sc = q < 50 ? 5000 / q : 200 - 2 * q; return std.map(v => Math.min(255, Math.max(1, Math.floor((v * sc + 50) / 100)))); };
const SOFTWARE_BASELINES = [];   // [{ name, lum:[64], chr:[64] }]

function ijgMatch(dqt) {
  if (!dqt || !dqt[0] || !dqt[1]) return null;
  for (let q = 1; q <= 100; q++) {
    const l = scaleQ(STD_LUM, q), c = scaleQ(STD_CHR, q);
    if (l.every((v, i) => v === dqt[0][i]) && c.every((v, i) => v === dqt[1][i])) return q;
  }
  return null;
}

function editTraces(j, es) {
  const t = [];
  if (j.photoshop) t.push('Photoshop resource block (APP13 "Photoshop 3.0" / 8BIM)');
  if (j.adobe) t.push('Adobe APP14 marker');
  const x = j.xmp || '';
  if (/xmpMM:History|stEvt:action|photoshop:History/i.test(x)) t.push('XMP edit history');
  const c = x.match(/CreatorTool(?:>|=")([^<"]+)/i);
  if (c && EDITORS.test(c[1])) t.push('XMP CreatorTool: ' + c[1].trim());
  const q = ijgMatch(j.dqt);
  if (q && !(es && es.makerNote)) t.push('Quantization tables exactly equal IJG standard Q' + q + ' (libjpeg-style encoder)');
  return t;
}

const NEAR = 1.0;   // <= NEAR  : adaptive quantization variant of the same signature family
const CLOSE = 2.0;  // <= CLOSE : similar quantization profile, not identical

function dqtDist(a, b) {
  let t = 0, n = 0;
  for (const id of Object.keys(a)) {
    if (!b[id]) return Infinity;
    for (let i = 0; i < 64; i++) { t += Math.abs(a[id][i] - b[id][i]); n++; }
  }
  return n ? t / n : Infinity;
}

const simPct = d => d === Infinity ? 0 : 100 / (1 + d);

function estimateQuality(dqt) {
  const t = dqt && dqt[0]; if (!t) return null;
  let best = null;
  for (let q = 1; q <= 100; q++) {
    const sc = q < 50 ? 5000 / q : 200 - 2 * q; let err = 0;
    for (let i = 0; i < 64; i++) err += Math.abs(Math.min(255, Math.max(1, Math.floor((STD_LUM[i] * sc + 50) / 100))) - t[i]);
    if (!best || err < best.err) best = { q, err: err / 64 };
  }
  return best;
}

const qualityText = dqt => {
  const e = estimateQuality(dqt);
  return e ? `≈ Q${e.q} (error ${e.err.toFixed(2)}${e.err > 1 ? ', non-standard table' : ''})` : '-';
};

/* ---------------- 7. Equivalence Class & Single-Linkage Clustering Formulas ----------------
 * Equivalence class for feature function k(s):
 *   C_v = { s.device | k(s) = v },   class size n = |C_v|
 * Device d is uniquely identified iff for all samples s of d, |C_{k(s)}| = 1. */
function eqStats(keyFn, list) {
  const arr = list || (typeof samples !== 'undefined' ? samples : []);
  const cls = new Map();
  arr.forEach(s => { const k = keyFn(s); if (!cls.has(k)) cls.set(k, new Set()); cls.get(k).add(s.device); });
  const sizes = [...cls.values()].map(x => x.size).sort((a, b) => a - b), L = sizes.length;
  const dist = [1, 2, 3, 4, 5].map(n => sizes.filter(x => n === 5 ? x >= 5 : x === n).length);
  const median = !L ? 0 : L % 2 ? sizes[(L - 1) / 2] : (sizes[L / 2 - 1] + sizes[L / 2]) / 2;
  const devs = [...new Set(arr.map(s => s.device))];
  const uniq = devs.filter(d => arr.filter(s => s.device === d).every(s => cls.get(keyFn(s)).size === 1)).length;
  return { classes: L, dist, median, max: L ? sizes[L - 1] : 0, devs: devs.length, uniq };
}

const EQ_SETS = [
  ['DQT only (192 features)', s => s.dqtKey],
  ['DQT + Huffman (282 features)', s => s.dqtKey + '|' + hash((s.huff || []).join(','))],
  ['Full signature (576 features)', s => fullKeyOf(s)]
];

const MIN_CONFIG_SAMPLES = 25;

function configStats(list) {
  const arr = list || (typeof samples !== 'undefined' ? samples : []);
  const cfg = new Map();
  arr.forEach(s => { const k = s.device + '|' + fullKeyOf(s); cfg.set(k, (cfg.get(k) || 0) + 1); });
  const v = [...cfg.values()];
  return { total: v.length, ok: v.filter(n => n >= MIN_CONFIG_SAMPLES).length };
}

function outlierCheck(rec, list) {
  const arr = list || (typeof samples !== 'undefined' ? samples : []);
  const ref = arr.filter(s => s.device === rec.device);
  if (ref.length < 3) return '';
  const d = Math.min(...ref.map(s => dqtDist(rec.dqt, s.dqt)));
  return d > CLOSE ? `Signature outlier: DQT distance ${d === Infinity ? 'n/a' : d.toFixed(2)} from ${ref.length} catalogued ${rec.device} samples (limit ${CLOSE})` : '';
}

function groupSignatures(list) {
  const arr = list || (typeof samples !== 'undefined' ? samples : []);
  const exact = new Map();
  arr.forEach(s => {
    if (!exact.has(s.dqtKey)) exact.set(s.dqtKey, { key: s.dqtKey, dqt: s.dqt, samples: [], devs: new Set() });
    const e = exact.get(s.dqtKey);
    e.samples.push(s);
    e.devs.add(s.device);
  });
  const ex = [...exact.values()].sort((a, b) => b.samples.length - a.samples.length);
  const parent = ex.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const sameDevs = (a, b) => a.size === b.size && [...a].every(d => b.has(d));
  for (let i = 0; i < ex.length; i++) for (let j = i + 1; j < ex.length; j++)
    if (find(i) !== find(j) && sameDevs(ex[i].devs, ex[j].devs) && dqtDist(ex[i].dqt, ex[j].dqt) <= NEAR) parent[find(j)] = find(i);
  const map = new Map(); map.byKey = new Map(); map.exact = ex;
  ex.forEach((e, i) => {
    const r = find(i);
    if (!map.has(ex[r].key)) map.set(ex[r].key, { key: ex[r].key, dqt: ex[r].dqt, devices: new Map(), samples: [], variants: [] });
    const g = map.get(ex[r].key);
    g.variants.push(e.key); g.samples.push(...e.samples);
    e.samples.forEach(s => { if (!g.devices.has(s.device)) g.devices.set(s.device, s.make); });
    map.byKey.set(e.key, g);
  });
  map.forEach(g => {
    const makes = new Set(g.devices.values()), n = g.devices.size;
    g.cat = n === 1 ? 'unique' : (n === 2 && makes.size === 1) ? 'same' : 'multi';
  });
  return map;
}

const CAT_LABEL = { unique: 'Unique', same: 'Shared (Same Manufacture)', multi: 'Shared (Multi-Device)' };
const CAT_CLASS = { unique: 'ok', same: 'warn', multi: 'bad' };

/* Export to globalThis for Node.js build/test scripts while remaining plain browser globals */
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    ZZ, EDITORS, hash, HUFF_LABELS, huffSets, huffVector, huffInfo, huffRows,
    parseJpeg, pad, dqt192, sigParts, sigVector, fullKeyOf, exifStruct, thumbSigOf,
    FLICKR_SIZES, isFlickrResize, STD_LUM, STD_CHR, scaleQ, SOFTWARE_BASELINES,
    ijgMatch, editTraces, NEAR, CLOSE, dqtDist, simPct, estimateQuality, qualityText,
    eqStats, EQ_SETS, MIN_CONFIG_SAMPLES, configStats, outlierCheck, groupSignatures,
    CAT_LABEL, CAT_CLASS
  });
}

