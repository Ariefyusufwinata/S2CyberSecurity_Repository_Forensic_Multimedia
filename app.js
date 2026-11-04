'use strict';
/* JPEG Signature Analyzer & Database — client-side only */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ZZ = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63];
const EDITORS = /photoshop|gimp|lightroom|paint\.net|pixelmator|affinity|snapseed|picsart|canva|corel|paintshop|capture one|darktable|rawtherapee|luminar|photoscape|fotor|facetune|vsco|adobe|acdsee|irfanview|imagemagick|photoworks|pixlr|sumopaint/i;

let samples = [];          // repositori aktif
let staged = [];           // hasil penyaringan terakhir
let lastVerify = null;

/* ---------------- IndexedDB ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('jpegsig', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('samples', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('samples', mode), st = t.objectStore('samples');
      const out = fn(st);
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()); },
  putMany(arr) { return this.tx('readwrite', s => { arr.forEach(x => s.put(x)); }); },
  clear() { return this.tx('readwrite', s => s.clear()); }
};

/* ---------------- JPEG parser (DataView) ---------------- */
function hash(str) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    a = Math.imul(a ^ str.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ str.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

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
        out.dht.push({ cls, id, total }); q += total;
      }
    } else if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      const nc = u8[start + 5], comps = [];
      for (let i = 0; i < nc; i++) { const o = start + 6 + i * 3; comps.push({ id: u8[o], h: u8[o + 1] >> 4, v: u8[o + 1] & 15, tq: u8[o + 2] }); }
      out.sof = { type: m, precision: u8[start], height: dv.getUint16(start + 1), width: dv.getUint16(start + 3), comps };
    } else if (m === 0xDD) out.dri = dv.getUint16(start);
    else if (m === 0xDA) break;
    p = end;
  }
  out.dhtHash = dhtStr ? hash(dhtStr) : '';
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

/* ---------------- EXIF ---------------- */
function readExif(buf) {
  const r = { tags: {}, thumb: '', xmpTool: '' };
  try {
    const t = ExifReader.load(buf, { expanded: true });
    for (const g of ['file', 'exif', 'gps']) Object.assign(r.tags, t[g] || {});
    const d = k => r.tags[k] && (r.tags[k].description ?? r.tags[k].value);
    r.make = String(d('Make') || '').trim();
    r.model = String(d('Model') || '').trim();
    r.software = String(d('Software') || '').trim();
    r.xmpTool = t.xmp && t.xmp.CreatorTool ? String(t.xmp.CreatorTool.value || t.xmp.CreatorTool.description || '') : '';
    r.params = {};
    [['ExposureTime', 'Exposure'], ['FNumber', 'F-Number'], ['ISOSpeedRatings', 'ISO'], ['FocalLength', 'Focal Length'],
     ['FocalLengthIn35mmFilm', 'Focal 35mm'], ['LensModel', 'Lens'], ['DateTimeOriginal', 'Tanggal Ambil'], ['Flash', 'Flash'],
     ['Orientation', 'Orientasi'], ['ColorSpace', 'Color Space'], ['PixelXDimension', 'EXIF Width'], ['PixelYDimension', 'EXIF Height']]
      .forEach(([k, label]) => { const v = d(k); if (v !== undefined && v !== '') r.params[label] = String(v); });
    const th = t.Thumbnail || t.thumbnail;
    if (th) {
      let b64 = th.base64;
      if (!b64 && th.image) { let s = ''; const a = new Uint8Array(th.image); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); b64 = btoa(s); }
      if (b64 && b64.length < 150000) { r.thumb = 'data:image/jpeg;base64,' + b64; r.thumbSrc = 'EXIF'; }
    }
  } catch (e) { r.err = String(e.message || e); }
  return r;
}

/* ---------------- Normalisasi perangkat ---------------- */
const MAKE_ALIAS = { EASTMAN: 'KODAK', HEWLETT: 'HP', 'HEWLETT-PACKARD': 'HP', FUJI: 'FUJIFILM', LGE: 'LG', MINOLTA: 'KONICA', ASUSTEK: 'ASUS', 'ONEPLUS': 'ONEPLUS', 'SONY-ERICSSON': 'SONY', 'SONYERICSSON': 'SONY', 'RESEARCH': 'BLACKBERRY', 'BBK': 'VIVO', 'TECNO': 'TECNO', 'INFINIX': 'INFINIX' };
function normMake(m) {
  m = (m || '').trim().replace(/\b(corporation|corp\.?|company|co\.?|inc\.?|ltd\.?|limited|electronics|imaging|digital)\b/gi, '').replace(/[,.]/g, '').trim();
  const w = (m.split(/\s+/)[0] || '').toUpperCase();
  return MAKE_ALIAS[w] || w;
}
function normModel(model, make) {
  let m = (model || '').trim();
  const mk = normMake(make);
  if (mk && m.toUpperCase().startsWith(mk)) m = m.slice(mk.length).trim();
  return m;
}
const titleMake = m => m.charAt(0) + m.slice(1).toLowerCase();

/* ---------------- Pemetaan Orientasi EXIF / TIFF ---------------- */
const ORIENTATION_MAP = {
  1: { num: 1, classic: 'Top-Left', exifTool: 'Horizontal (normal)', category: 'Landscape', label: 'Landscape', deg: 0 },
  2: { num: 2, classic: 'Top-Right', exifTool: 'Mirror horizontal', category: 'Landscape', label: 'Landscape', deg: 0, flipH: true },
  3: { num: 3, classic: 'Bottom-Right', exifTool: 'Rotate 180', category: 'Landscape', label: 'Landscape', deg: 180 },
  4: { num: 4, classic: 'Bottom-Left', exifTool: 'Mirror vertical', category: 'Landscape', label: 'Landscape', deg: 0, flipV: true },
  5: { num: 5, classic: 'Left-Top', exifTool: 'Mirror horizontal and rotate 270 CW', category: 'Portrait', label: 'Portrait', deg: 270, flipH: true },
  6: { num: 6, classic: 'Right-Top', exifTool: 'Rotate 90 CW', category: 'Portrait', label: 'Portrait (Kamera diputar ke kanan)', deg: 90 },
  7: { num: 7, classic: 'Right-Bottom', exifTool: 'Mirror horizontal and rotate 90 CW', category: 'Portrait', label: 'Portrait', deg: 90, flipH: true },
  8: { num: 8, classic: 'Left-Bottom', exifTool: 'Rotate 270 CW', category: 'Portrait', label: 'Portrait (Kamera diputar ke kiri)', deg: 270 }
};

function parseOrientation(val, w = 0, h = 0) {
  if (!val) {
    if (h > w && w > 0) return { num: 1, classic: 'Top-Left', exifTool: 'Portrait (sensor)', category: 'Portrait', label: 'Portrait', deg: 0 };
    return ORIENTATION_MAP[1];
  }
  const s = String(val).toLowerCase().trim();
  const num = parseInt(s, 10);
  if (!isNaN(num) && ORIENTATION_MAP[num]) return ORIENTATION_MAP[num];
  if (s.includes('right-top') || s.includes('rotate 90')) return ORIENTATION_MAP[6];
  if (s.includes('left-bottom') || s.includes('rotate 270')) return ORIENTATION_MAP[8];
  if (s.includes('bottom-right') || s.includes('rotate 180')) return ORIENTATION_MAP[3];
  if (s.includes('top-right') || s.includes('mirror horizontal')) return ORIENTATION_MAP[2];
  if (s.includes('bottom-left') || s.includes('mirror vertical')) return ORIENTATION_MAP[4];
  if (s.includes('left-top')) return ORIENTATION_MAP[5];
  if (s.includes('right-bottom')) return ORIENTATION_MAP[7];
  if (s.includes('top-left') || s.includes('horizontal') || s.includes('normal')) return ORIENTATION_MAP[1];
  return ORIENTATION_MAP[1];
}

async function rotateDataUrl(dataUrl, deg) {
  if (!deg || deg % 360 === 0) return dataUrl;
  if (typeof Image === 'undefined' || typeof document === 'undefined') return dataUrl;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      if (deg === 90 || deg === 270) {
        c.width = img.naturalHeight || img.height;
        c.height = img.naturalWidth || img.width;
      } else {
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
      }
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function makePreview(buf, type) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return '';
  try {
    const bmp = await createImageBitmap(new Blob([buf], { type: type || 'image/jpeg' }), { imageOrientation: 'from-image' });
    const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch (e) {
    try {
      const bmp2 = await createImageBitmap(new Blob([buf], { type: type || 'image/jpeg' }));
      const k = Math.min(1, 320 / Math.max(bmp2.width, bmp2.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp2.width * k)); c.height = Math.max(1, Math.round(bmp2.height * k));
      c.getContext('2d').drawImage(bmp2, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8);
    } catch (err) { return ''; }
  }
}

/* ---------------- Format gambar & placeholder ---------------- */
function detectFormat(u) {
  const a = (...b) => b.every((x, i) => u[i] === x);
  const str = (o, t) => t.split('').every((c, i) => u[o + i] === c.charCodeAt(0));
  if (a(0xFF, 0xD8, 0xFF)) return 'JPEG';
  if (a(0x89, 0x50, 0x4E, 0x47)) return 'PNG';
  if (str(0, 'GIF8')) return 'GIF';
  if (str(0, 'RIFF') && str(8, 'WEBP')) return 'WEBP';
  if (str(0, 'BM')) return 'BMP';
  if (a(0x49, 0x49, 0x2A, 0) || a(0x4D, 0x4D, 0, 0x2A)) return 'TIFF';
  if (a(0, 0, 1, 0)) return 'ICO';
  if (str(0, '8BPS')) return 'PSD';
  if (str(4, 'ftyp')) { const br = String.fromCharCode(...u.slice(8, 12)); return /avif|avis/.test(br) ? 'AVIF' : /hei|hev|mif1|msf1/.test(br) ? 'HEIC' : 'MP4'; }
  if (str(0, '<svg') || str(0, '<?xml')) return 'SVG';
  return 'UNKNOWN';
}
const phCache = {};
function placeholder(fmt) {
  fmt = (fmt || 'JPEG').toUpperCase();
  return phCache[fmt] || (phCache[fmt] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180"><rect width="240" height="180" fill="#0b1328"/>` +
    `<rect x="70" y="35" width="100" height="72" rx="8" fill="#172c6b"/><circle cx="96" cy="58" r="9" fill="#6f9bff"/>` +
    `<path d="M76 100 L108 70 L128 90 L146 74 L164 100 Z" fill="#6f9bff"/>` +
    `<text x="120" y="147" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#e6ebf7" text-anchor="middle">${fmt}</text></svg>`));
}
function thumbOf(s) {
  if (!s) return placeholder('JPEG');
  // 1. Data URI base64 thumbnail yang valid
  if (s.thumb && typeof s.thumb === 'string' && s.thumb.length > 50) return s.thumb;
  // 2. Cari di DEFAULT_SIGNATURES jika s.thumb lokal masih kosong
  if (window.DEFAULT_SIGNATURES && Array.isArray(window.DEFAULT_SIGNATURES.samples)) {
    const found = window.DEFAULT_SIGNATURES.samples.find(x => x.id === s.id || x.file === s.file);
    if (found && found.thumb && found.thumb.length > 50) {
      s.thumb = found.thumb;
      s.thumbSrc = found.thumbSrc || 'GENERATED';
      return s.thumb;
    }
  }
  // 3. Fallback langsung ke file gambar lokal di images/
  if (s.file && (s.file.startsWith('images/') || s.file.startsWith('./images/') || /\.(jpe?g|png|webp)$/i.test(s.file))) {
    return s.file;
  }
  // 4. Placeholder
  return placeholder(s.format || 'JPEG');
}

function imgTag(s, cls, extra = '') {
  const primary = thumbOf(s);
  const directPath = (s && s.file && (s.file.startsWith('images/') || s.file.startsWith('./images/'))) ? s.file : '';
  const altFallback = directPath && primary !== directPath ? directPath : placeholder(s && s.format);
  return `<img class="${cls}" ${extra} src="${primary}" onerror="if(this.src!=='${altFallback}'){this.src='${altFallback}'}else{this.onerror=null;this.src='${placeholder(s && s.format)}'}">`;
}

/* ---------------- Analisis berkas ---------------- */
async function analyze(name, buf, size) {
  const j = parseJpeg(buf);
  const fmt = detectFormat(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
  const item = { name, size, valid: j.valid, format: fmt };
  if (!j.valid) { item.status = 'rejected'; item.rec = { format: fmt, file: name, device: '', software: '', thumb: await makePreview(buf, 'image/' + fmt.toLowerCase()) }; item.reason = fmt === 'UNKNOWN' ? 'Format tidak dikenali / bukan gambar (header FF D8 FF tidak ditemukan)' : `Format ${fmt}, bukan JPEG (tidak punya tabel DQT JPEG)`; return item; }
  const ex = readExif(buf);
  const rawW = j.sof ? j.sof.width : 0, rawH = j.sof ? j.sof.height : 0;
  const ori = (ex.params && (ex.params['Orientasi'] || ex.params['Orientation'])) || '';
  const oInfo = parseOrientation(ori, rawW, rawH);
  if (!ex.thumb) {
    ex.thumb = await makePreview(buf);
    if (ex.thumb) ex.thumbSrc = 'GENERATED_COLOR';
  } else if (oInfo.deg !== 0) {
    ex.thumb = await rotateDataUrl(ex.thumb, oInfo.deg);
  }
  const isPortrait = oInfo.category === 'Portrait';
  const displayW = isPortrait && rawW > rawH ? rawH : rawW;
  const displayH = isPortrait && rawW > rawH ? rawW : rawH;
  const tool = [ex.software, ex.xmpTool].filter(Boolean).join(' / ');
  const make = normMake(ex.make), model = normModel(ex.model, ex.make);
  item.rec = {
    id: name + '|' + size + '|' + j.dqtKey, file: name, size,
    format: 'JPEG', make, model, device: make && model ? titleMake(make) + ' ' + model : '',
    software: tool, width: rawW, height: rawH,
    displayWidth: displayW, displayHeight: displayH, displayDim: displayW + ' × ' + displayH,
    orientationNum: oInfo.num, orientationClassic: oInfo.classic,
    orientationExifTool: oInfo.exifTool, orientationCategory: oInfo.category,
    orientationLabel: oInfo.label, orientationDeg: oInfo.deg, isPortrait,
    dqtKey: j.dqtKey, dqt: j.dqt, jpegType: j.jpegType || '', subsampling: j.subsampling || '',
    precision: j.sof ? j.sof.precision : 0, dht: j.dht, dhtHash: j.dhtHash, dri: j.dri,
    markers: j.markers.map(m => m.toString(16).toUpperCase()), exif: ex.params || {}, thumb: ex.thumb, thumbSrc: ex.thumbSrc || ''
  };
  item.edited = EDITORS.test(tool);
  if (!j.dqtKey) { item.status = 'rejected'; item.reason = 'Tidak ada tabel DQT'; }
  else if (item.edited) { item.status = 'rejected'; item.reason = 'Diedit software pihak ketiga: ' + tool; }
  else if (!item.rec.device) { item.status = 'rejected'; item.reason = 'EXIF Make/Model tidak tersedia'; }
  else item.status = 'accepted';
  return item;
}

const IMG_EXT = /\.(jpe?g|jfif|png|gif|webp|bmp|tiff?|heic|heif|avif|ico|psd|svg)$/i;
const isJpegName = n => IMG_EXT.test(n) && !/(^|\/)(__MACOSX|\._)/.test(n) && !/\/\._/.test(n);

async function collect(files) {
  const jobs = [];
  for (const f of files) {
    const nm = f.webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      try {
        const z = await JSZip.loadAsync(f);
        z.forEach((path, entry) => { if (!entry.dir && isJpegName(path)) jobs.push({ name: f.name + ':' + path, get: () => entry.async('arraybuffer') }); });
      } catch (e) { toast('ZIP gagal dibaca: ' + f.name); }
    } else if (IMG_EXT.test(f.name) || (f.type || '').startsWith('image/')) jobs.push({ name: nm, get: () => f.arrayBuffer() });
  }
  return jobs;
}

async function ingest(files) {
  const jobs = await collect([...files]);
  if (!jobs.length) { toast('Tidak ada berkas JPEG ditemukan'); return; }
  staged = [];
  for (let i = 0; i < jobs.length; i++) {
    try {
      const buf = await jobs[i].get();
      staged.push(await analyze(jobs[i].name, buf, buf.byteLength));
    } catch (e) { staged.push({ name: jobs[i].name, status: 'rejected', reason: 'Gagal dibaca: ' + e.message }); }
    if (i % 5 === 0 || i === jobs.length - 1) {
      $('#bar').style.width = ((i + 1) / jobs.length * 100) + '%';
      $('#progText').textContent = `Memproses ${i + 1} / ${jobs.length}`;
      await new Promise(r => setTimeout(r));
    }
  }
  renderIngest();
}

function renderIngest() {
  const acc = staged.filter(s => s.status === 'accepted').length;
  const inval = staged.filter(s => s.valid === false).length;
  const ed = staged.filter(s => s.edited).length;
  const nometa = staged.filter(s => s.valid && !s.edited && s.status === 'rejected').length;
  $('#ingestTiles').innerHTML = [['Total', staged.length], ['Lolos', acc], ['Bukan JPEG valid', inval], ['Diedit software', ed], ['Tanpa Make/Model/DQT', nometa]]
    .map(([l, v]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#btnAddAccepted').disabled = !acc;
  const f = $('#filterStatus').value;
  const rows = staged.filter(s => f === 'all' || s.status === f);
  $('#ingestBody').innerHTML = rows.length ? rows.map(s => `<tr>
    <td>${s.rec ? imgTag(s.rec, 'thumb') : ''}</td>
    <td class="small">${esc(s.name)}</td>
    <td>${esc(s.rec ? s.rec.device : '')}</td>
    <td class="small">${esc(s.rec ? s.rec.software : '')}</td>
    <td>${s.status === 'accepted' ? '<span class="badge ok">Lolos</span>' : `<span class="badge bad">Ditolak</span> <span class="small muted">${esc(s.reason)}</span>`}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">Tidak ada data.</td></tr>';
}

/* ---------------- Katalog & klasifikasi ---------------- */
/* Jarak antar-signature: rata-rata selisih absolut seluruh elemen tabel DQT (satuan step kuantisasi). */
const NEAR = 1.0;   // <= NEAR : dianggap varian signature yang sama (mis. Samsung dengan tabel adaptif)
const CLOSE = 2.0;  // <= CLOSE : mirip tapi tidak identik
function dqtDist(a, b) {
  let t = 0, n = 0;
  for (const id of Object.keys(a)) {
    if (!b[id]) return Infinity;
    for (let i = 0; i < 64; i++) { t += Math.abs(a[id][i] - b[id][i]); n++; }
  }
  return n ? t / n : Infinity;
}
const simPct = d => d === Infinity ? 0 : 100 / (1 + d);

/* Estimasi faktor kualitas IJG dari tabel luminance (Annex K) */
const STD_LUM = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
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
const qualityText = dqt => { const e = estimateQuality(dqt); return e ? `≈ Q${e.q} (galat ${e.err.toFixed(2)}${e.err > 1 ? ', tabel non-standar' : ''})` : '-'; };

/* Signature dikelompokkan menjadi keluarga: varian dengan jarak <= NEAR digabung (single-linkage). */
function groupSignatures() {
  const exact = new Map();
  samples.forEach(s => {
    if (!exact.has(s.dqtKey)) exact.set(s.dqtKey, { key: s.dqtKey, dqt: s.dqt, samples: [] });
    exact.get(s.dqtKey).samples.push(s);
  });
  const ex = [...exact.values()].sort((a, b) => b.samples.length - a.samples.length);
  const parent = ex.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < ex.length; i++) for (let j = i + 1; j < ex.length; j++)
    if (find(i) !== find(j) && dqtDist(ex[i].dqt, ex[j].dqt) <= NEAR) parent[find(j)] = find(i);
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

function dqtHtml(dqt) {
  return Object.keys(dqt).sort().map(id => {
    const v = dqt[id], max = Math.max(...v), min = Math.min(...v);
    const name = id == 0 ? 'Luminance (Tq0)' : id == 1 ? 'Chrominance (Tq1)' : 'Tq' + id;
    let h = `<div style="display:inline-block;vertical-align:top"><div class="small muted">${name}</div><table class="dqt">`;
    for (let r = 0; r < 8; r++) {
      h += '<tr>';
      for (let c = 0; c < 8; c++) {
        const x = v[r * 8 + c], t = max === min ? 0 : (x - min) / (max - min);
        h += `<td style="background:hsl(222,${45 + t * 30}%,${18 + t * 30}%)">${x}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table></div>';
  }).join('');
}

function renderAll() {
  const groups = groupSignatures();
  const devs = new Set(samples.map(s => s.device));
  $('#statSamples').textContent = samples.length;
  $('#statDevices').textContent = devs.size;
  $('#statSigs').textContent = groups.size;
  renderCatalog(groups);
  renderClassify(groups);
  initGalleryFilters();
  renderGallery();
}

/* ---------------- Galeri Foto ---------------- */
function initGalleryFilters() {
  const devs = [...new Set(samples.map(s => s.device))].sort();
  const selDev = $('#galFilterDev');
  const curDev = selDev.value;
  selDev.innerHTML = '<option value="all">Semua Perangkat</option>' + devs.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  if (devs.includes(curDev)) selDev.value = curDev;

  const folders = [...new Set(samples.map(s => s.file.split('/')[1] || 'root'))].sort();
  const selFolder = $('#galFilterFolder');
  const curFolder = selFolder.value;
  selFolder.innerHTML = '<option value="all">Semua Folder</option>' + folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  if (folders.includes(curFolder)) selFolder.value = curFolder;
}

function renderGallery() {
  const q = ($('#galSearch').value || '').toLowerCase().trim();
  const devF = $('#galFilterDev').value;
  const folF = $('#galFilterFolder').value;
  const oriF = $('#galFilterOri') ? $('#galFilterOri').value : 'all';

  const filtered = samples.filter(s => {
    if (devF !== 'all' && s.device !== devF) return false;
    const folder = s.file.split('/')[1] || 'root';
    if (folF !== 'all' && folder !== folF) return false;
    if (oriF !== 'all' && (s.orientationCategory || (s.isPortrait ? 'Portrait' : 'Landscape')) !== oriF) return false;
    if (q) {
      const hay = (s.file + ' ' + s.device + ' ' + s.dqtKey + ' ' + (s.software || '') + ' ' + (s.orientationLabel || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  $('#galCount').textContent = filtered.length;
  const grid = $('#galGrid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="muted" style="grid-column:1/-1;padding:20px;text-align:center">Tidak ada foto yang cocok dengan filter.</div>';
    return;
  }

  grid.innerHTML = filtered.map(s => {
    const filename = s.file.split('/').pop();
    const folder = s.file.split('/')[1] || '';
    const imgHtml = imgTag(s, 'gal-img', 'loading="lazy"');
    const isPortrait = s.orientationCategory ? s.orientationCategory === 'Portrait' : (s.isPortrait || (s.orientationDeg === 90 || s.orientationDeg === 270) || (s.height > s.width && !s.orientationDeg));
    const oriText = isPortrait ? 'Portrait' : 'Landscape';
    const oriBadge = `<span class="${isPortrait ? 'photo-badge portrait' : 'photo-badge'}">${oriText}</span>`;
    const dimText = s.displayDim || (isPortrait && s.width > s.height ? `${s.height}×${s.width}` : `${s.width}×${s.height}`);
    return `<div class="photo-card ${isPortrait ? 'portrait' : 'landscape'}" data-gal-id="${esc(s.id)}">
      <div class="photo-img-wrap">
        ${imgHtml}
        ${oriBadge}
      </div>
      <div class="photo-info">
        <div class="photo-name" title="${esc(filename)}">${esc(filename)}</div>
        <div class="photo-dev">${esc(s.device)}</div>
        <div class="small muted">${dimText} · ${esc(folder)}</div>
        <div class="small mono muted" style="overflow:hidden;text-overflow:ellipsis" title="DQT Key: ${s.dqtKey}">${s.dqtKey}</div>
      </div>
    </div>`;
  }).join('');
}

function openPhotoModal(sampleId) {
  const s = samples.find(item => item.id === sampleId);
  if (!s) return;
  $('#modalTitle').textContent = s.file.split('/').pop();
  $('#modalBody').innerHTML = sampleDetailHtml(s);
  $('#photoModal').style.display = 'flex';
}

function closePhotoModal() {
  $('#photoModal').style.display = 'none';
}

function renderCatalog(groups) {
  const by = new Map();
  samples.forEach(s => { if (!by.has(s.device)) by.set(s.device, []); by.get(s.device).push(s); });
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, arr]) => {
    const keys = [...new Set(arr.map(s => s.dqtKey))];
    const cats = [...new Set(keys.map(k => groups.byKey.get(k).cat))];
    return `<tr class="click" data-dev="${esc(d)}"><td>${esc(d)}</td><td>${arr.length}</td><td>${keys.length}</td>
      <td>${cats.map(c => `<span class="badge ${CAT_CLASS[c]}">${CAT_LABEL[c]}</span>`).join(' ')}</td></tr>`;
  });
  $('#catBody').innerHTML = rows.join('') || '<tr><td colspan="4" class="muted">Repositori kosong. Unggah sampel di tab Akuisisi atau Import JSON.</td></tr>';
  $('#detailCard').style.display = 'none';
}

function showDevice(dev) {
  const arr = samples.filter(s => s.device === dev);
  $('#detailCard').style.display = '';
  $('#detailTitle').textContent = dev;
  $('#detailBody').innerHTML = `<div class="scroll"><table><thead><tr><th>Thumb</th><th>Berkas</th><th>Dimensi</th><th>Signature</th><th></th></tr></thead><tbody>` +
    arr.map(s => `<tr><td>${imgTag(s, 'thumb')}</td><td class="small">${esc(s.file)}</td>
      <td>${s.displayDim || (s.width + '×' + s.height)}</td><td class="mono small">${s.dqtKey}</td>
      <td><button class="btn sec" data-sample="${esc(s.id)}">Detail</button> <button class="btn danger" data-del="${esc(s.id)}">Hapus</button></td></tr>`).join('') +
    `</tbody></table></div><div id="sampleDetail"></div>`;
  $('#detailCard').scrollIntoView({ behavior: 'smooth' });
}

function sampleDetailHtml(s) {
  const kv = o => '<div class="kv">' + Object.entries(o).map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('') + '</div>';
  const isPortrait = s.orientationCategory ? s.orientationCategory === 'Portrait' : (s.isPortrait || (s.orientationDeg === 90 || s.orientationDeg === 270) || (s.height > s.width && !s.orientationDeg));
  const oriLabel = isPortrait ? 'Portrait' : 'Landscape';
  const displayDim = s.displayDim || (isPortrait && s.width > s.height ? `${s.height} × ${s.width} (Portrait)` : `${s.width} × ${s.height} (Landscape)`);
  return `<h3>${esc(s.file)}</h3><div class="grid2"><div>
    <div class="thumb-detail-box ${isPortrait ? 'portrait' : 'landscape'}">${imgTag(s, 'thumb-lg')}</div>
    <p class="small muted">${!s.thumb ? 'Tidak ada thumbnail — placeholder format ' + (s.format || 'JPEG') : s.thumbSrc === 'GENERATED' || s.thumbSrc === 'GENERATED_COLOR_ROTATED' ? 'Preview berwarna dari berkas asli' : 'Embedded thumbnail (' + (s.thumbSrc || 'EXIF') + ')'} · <b>${oriLabel}</b></p>
    <h3>Orientasi Kamera (EXIF / TIFF)</h3>
    ${kv({
      'Kategori Tampilan': isPortrait ? 'Portrait' : 'Landscape',
      'Deskripsi Orientasi': s.orientationLabel || oriLabel,
      'Nilai Angka EXIF': s.orientationNum ? String(s.orientationNum) : '1 (Default)',
      'Penamaan TIFF/EXIF': s.orientationClassic || 'Top-Left',
      'Deskripsi ExifTool': s.orientationExifTool || 'Horizontal (normal)',
      'Dimensi Tampilan': displayDim,
      'Dimensi Sensor Asli': `${s.width} × ${s.height}`
    })}
    <h3>Metadata Kamera</h3>${kv({ Make: s.make, Model: s.model, Software: s.software || '-', ...s.exif })}</div>
    <div><h3>Struktur Kompresi</h3>${kv({ Tipe: s.jpegType, Subsampling: s.subsampling, 'Presisi': s.precision + ' bit', 'Tabel DHT': s.dht.length + ' (hash ' + (s.dhtHash || '-') + ')', 'Restart Interval': s.dri, Marker: s.markers.join(' '), 'DQT Signature': s.dqtKey, 'Estimasi Kualitas': qualityText(s.dqt) })}</div></div>
    <h3>Matriks Kuantisasi DQT 8×8</h3>${dqtHtml(s.dqt)}`;
}

function renderClassify(groups) {
  const list = { unique: [], same: [], multi: [] };
  groups.forEach(g => list[g.cat].push(g));
  $('#classTiles').innerHTML = [['Total signature', groups.size], ['Unique', list.unique.length], ['Shared (Same Manufacture)', list.same.length], ['Shared (Multi-Device)', list.multi.length]]
    .map(([l, v]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
  const card = g => {
    const devs = [...g.devices.keys()].sort();
    return `<details><summary><span class="mono">${g.key}</span> · ${devs.length} perangkat · ${g.samples.length} sampel
      ${g.variants.length > 1 ? `<span class="badge navy">${g.variants.length} varian tabel</span>` : ''}
      ${g.cat === 'multi' ? `<span class="badge navy">${devs.length >= 5 ? '5+' : devs.length} perangkat</span>` : ''}</summary>
      <div class="chips" style="margin:8px 0">${devs.map(d => `<span>${esc(d)}</span>`).join('')}</div>
      <div class="small muted">Estimasi kualitas: ${qualityText(g.dqt)}${g.variants.length > 1 ? ' · varian: ' + g.variants.join(', ') : ''}</div>${dqtHtml(g.dqt)}</details>`;
  };
  for (const [c, id] of [['unique', '#clsUnique'], ['same', '#clsSame'], ['multi', '#clsMulti']])
    $(id).innerHTML = list[c].map(card).join('') || '<span class="muted">Belum ada.</span>';
}

/* ---------------- Verifikasi ---------------- */
async function verify(file) {
  const buf = await file.arrayBuffer();
  const j = parseJpeg(buf);
  const box = $('#verifyResult');
  if (!j.valid) { const fmt = detectFormat(new Uint8Array(buf, 0, Math.min(16, buf.byteLength))); box.innerHTML = `<div class="alert bad">Bukan berkas JPEG (format terdeteksi: ${esc(fmt)}).<small>Signature DQT hanya ada pada JPEG, sehingga berkas ini tidak dapat diverifikasi.</small></div><div class="card">${imgTag({ format: fmt }, 'thumb-lg')}</div>`; lastVerify = null; return; }
  const ex = readExif(buf);
  if (!ex.thumb) ex.thumb = await makePreview(buf);
  const make = normMake(ex.make), model = normModel(ex.model, ex.make);
  const claimed = make && model ? titleMake(make) + ' ' + model : '';
  const tool = [ex.software, ex.xmpTool].filter(Boolean).join(' / ');
  const edited = EDITORS.test(tool);
  const groups = groupSignatures();
  /* Pencocokan: exact hash -> varian mirip (jarak <= NEAR) -> kandidat terdekat */
  const cands = new Map(); let nearestKey = null, nearestD = Infinity;
  if (j.dqtKey) groups.exact.forEach(e => {
    const d = e.key === j.dqtKey ? 0 : dqtDist(j.dqt, e.dqt);
    if (d < nearestD) { nearestD = d; nearestKey = e.key; }
    e.samples.forEach(s => { const c = cands.get(s.device); if (!c || d < c.d) cands.set(s.device, { d, make: s.make }); });
  });
  const ranked = [...cands.entries()].sort((a, b) => a[1].d - b[1].d);
  let g = groups.byKey.get(j.dqtKey), matchType = g ? 'exact' : null;
  if (!g && nearestKey && nearestD <= NEAR) { g = groups.byKey.get(nearestKey); matchType = 'near'; }
  const nearNote = matchType === 'near' ? ` (varian mirip, jarak ${nearestD.toFixed(2)})` : '';
  const matches = g ? [...g.devices.entries()] : [];
  const claimedKnown = claimed && samples.some(s => s.device === claimed);
  let level, title, detail;
  if (!j.dqtKey) { level = 'warn'; title = 'Tidak ada tabel DQT'; detail = 'Signature kompresi tidak dapat diekstrak.'; }
  else if (!samples.length) { level = 'info'; title = 'Katalog kosong'; detail = 'Muat signatures.json / Import JSON atau tambahkan sampel terlebih dahulu.'; }
  else if (!g) {
    const near = ranked[0] ? `${ranked[0][0]} (jarak ${ranked[0][1].d.toFixed(2)})` : '-';
    if (claimedKnown) {
      const dc = cands.get(claimed).d;
      if (dc <= CLOSE) { level = 'warn'; title = 'MIRIP tetapi tidak identik dengan signature perangkat yang diklaim'; detail = `EXIF mengklaim ${claimed}; jarak DQT terdekat ${dc.toFixed(2)}. Mungkin varian tabel baru perangkat tersebut atau gambar diproses ulang. Kandidat terdekat: ${near}.`; }
      else { level = 'bad'; title = 'MISMATCH — signature tidak cocok dengan klaim EXIF'; detail = `EXIF mengklaim ${claimed}, perangkat itu ada di katalog tetapi jaraknya ${dc.toFixed(2)} dari signature gambar ini. Kandidat terdekat: ${near}.`; }
    } else { level = 'info'; title = 'Signature tidak ada di katalog'; detail = `Tidak dapat diidentifikasi pasti. Kandidat terdekat: ${near}.` + (claimed ? ` Klaim EXIF: ${claimed} (belum ada di katalog).` : ''); }
  } else if (!claimed) { level = 'info'; title = 'Kandidat perangkat ditemukan (EXIF Make/Model kosong)' + nearNote; detail = 'Signature cocok dengan perangkat di bawah.'; }
  else if (g.devices.has(claimed)) { level = g.devices.size === 1 ? 'ok' : 'warn'; title = (g.devices.size === 1 ? 'COCOK — signature konsisten dengan klaim EXIF' : 'Konsisten dengan klaim EXIF, namun signature dipakai bersama') + nearNote; detail = g.devices.size === 1 ? 'Signature unik untuk perangkat ini.' : `Signature dipakai ${g.devices.size} perangkat, sehingga identifikasi tidak definitif.`; }
  else if ([...g.devices.values()].includes(make)) { level = 'bad'; title = 'MISMATCH — merek cocok, model berbeda' + nearNote; detail = `EXIF mengklaim ${claimed}, signature milik model lain dari merek yang sama.`; }
  else { level = 'bad'; title = 'MISMATCH — klaim EXIF berbeda dengan signature kompresi' + nearNote; detail = `EXIF mengklaim ${claimed}, tetapi signature DQT cocok dengan perangkat lain.`; }

  lastVerify = { file: file.name, claimed, level, title, detail, matches: matches.map(m => m[0]), cat: g ? g.cat : null, j, ex, tool, edited, key: j.dqtKey, dims: j.sof ? j.sof.width + ' x ' + j.sof.height : '-' };
  const kv = o => '<div class="kv">' + Object.entries(o).map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('') + '</div>';
  box.innerHTML = `<div class="alert ${level}">${esc(title)}<small>${esc(detail)}</small></div>
    ${edited ? `<div class="alert warn">Peringatan: tag software menunjukkan editing pihak ketiga (${esc(tool)}). Hasil kurang dapat diandalkan.<small>Signature DQT bisa berasal dari aplikasi editor, bukan kamera.</small></div>` : ''}
    <div class="card"><div class="grid2"><div>
      ${imgTag({ thumb: ex.thumb, format: 'JPEG' }, 'thumb-lg')}<p class="small muted">${ex.thumb ? (ex.thumbSrc ? 'Embedded thumbnail' : 'Preview dari gambar') : 'Placeholder JPEG'}</p>
      <h3>Klaim EXIF &amp; Metadata</h3>${kv({ Berkas: file.name, 'Make / Model': claimed || '-', Software: tool || '-', Dimensi: lastVerify.dims, ...(ex.params || {}) })}</div>
      <div><h3>Hasil Pencocokan</h3>${kv({ 'DQT Signature': j.dqtKey || '-', Kategori: g ? CAT_LABEL[g.cat] : '-', 'Jenis Kecocokan': matchType === 'exact' ? 'Exact (hash identik)' : matchType === 'near' ? 'Varian mirip' : 'Tidak ada', 'Estimasi Kualitas': qualityText(j.dqt), Tipe: j.jpegType || '-', Subsampling: j.subsampling || '-' })}
      <h3>Perangkat Cocok di Katalog</h3>
      <div class="chips">${matches.map(([d]) => `<span>${esc(d)}</span>`).join('') || '<span class="muted">Tidak ada</span>'}</div></div></div>
      <h3>Kandidat Terdekat (jarak DQT)</h3>
      <div class="scroll" style="max-height:220px"><table><thead><tr><th>Perangkat</th><th>Jarak</th><th>Kemiripan</th></tr></thead><tbody>${ranked.slice(0, 8).map(([d, c]) => `<tr><td>${esc(d)}${d === claimed ? ' <span class="badge navy">klaim EXIF</span>' : ''}</td><td>${c.d === Infinity ? '-' : c.d.toFixed(2)}</td><td>${simPct(c.d).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="3" class="muted">-</td></tr>'}</tbody></table></div>
      <h3>Matriks DQT</h3>${dqtHtml(j.dqt)}
      <p><button class="btn" id="btnVerifyPdf">Unduh Laporan PDF</button></p></div>`;
}

/* ---------------- PDF ---------------- */
function pdfDoc() {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  let y = 15;
  const api = {
    doc,
    line(t, size = 10, bold = false) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
      doc.splitTextToSize(String(t), 180).forEach(l => { if (y > 282) { doc.addPage(); y = 15; } doc.text(l, 15, y); y += size * 0.5 + 1; });
    },
    gap(h = 3) { y += h; },
    need(h) { if (y + h > 282) { doc.addPage(); y = 15; } },
    img(d, w, h) { try { api.need(h + 2); doc.addImage(d, 'JPEG', 15, y, w, h); y += h + 3; } catch (e) { /* abaikan */ } },
    dqt(dqt) {
      Object.keys(dqt).sort().forEach(id => {
        api.need(50); api.line('DQT Tq' + id + (id == 0 ? ' (Luminance)' : id == 1 ? ' (Chrominance)' : ''), 9, true);
        doc.setFont('courier', 'normal'); doc.setFontSize(8);
        for (let r = 0; r < 8; r++) { doc.text(dqt[id].slice(r * 8, r * 8 + 8).map(v => String(v).padStart(4)).join(' '), 15, y); y += 4; }
        y += 2;
      });
    }
  };
  return api;
}

function verifyPdf() {
  const v = lastVerify; if (!v) return;
  const p = pdfDoc();
  p.line('Laporan Verifikasi JPEG Signature', 16, true);
  p.line('Dibuat: ' + new Date().toLocaleString(), 9); p.gap();
  p.line('Berkas: ' + v.file); p.line('Klaim EXIF: ' + (v.claimed || '-')); p.line('Software: ' + (v.tool || '-') + (v.edited ? '  [TERINDIKASI DIEDIT]' : ''));
  p.line('Dimensi: ' + v.dims); p.line('DQT Signature: ' + (v.key || '-')); p.line('Tipe / Subsampling: ' + (v.j.jpegType || '-') + ' / ' + (v.j.subsampling || '-')); p.gap();
  p.line('Kesimpulan: ' + v.title, 12, true); p.line(v.detail);
  p.line('Perangkat cocok di katalog: ' + (v.matches.join(', ') || '-')); p.gap();
  if (v.ex.thumb) p.img(v.ex.thumb, 40, 30);
  p.dqt(v.j.dqt);
  Object.entries(v.ex.params || {}).forEach(([k, val]) => p.line(k + ': ' + val, 9));
  p.doc.save('verifikasi-' + v.file.replace(/\.[^.]+$/, '') + '.pdf');
}

function catalogPdf() {
  const groups = groupSignatures(), p = pdfDoc();
  p.line('Laporan Katalog JPEG Signature', 16, true);
  p.line('Dibuat: ' + new Date().toLocaleString(), 9);
  p.line(`Sampel: ${samples.length} | Perangkat: ${new Set(samples.map(s => s.device)).size} | Signature: ${groups.size}`); p.gap();
  ['unique', 'same', 'multi'].forEach(c => {
    p.line(CAT_LABEL[c], 12, true);
    const l = [...groups.values()].filter(g => g.cat === c);
    if (!l.length) p.line('(kosong)', 9);
    l.forEach(g => p.line(g.key + '  ->  ' + [...g.devices.keys()].sort().join('; '), 9));
    p.gap();
  });
  p.doc.save('katalog-signature.pdf');
}

/* ---------------- Export / Import ---------------- */
function exportJson() {
  const data = { format: 'jpeg-signature-repository', version: 1, exported: new Date().toISOString(), samples };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'signatures.json'; a.click(); URL.revokeObjectURL(a.href);
}
async function importJson(file) {
  try {
    const d = JSON.parse(await file.text());
    const arr = Array.isArray(d) ? d : d.samples;
    if (!Array.isArray(arr) || arr.some(s => !s.id || !s.dqtKey || !s.dqt)) throw new Error('Format tidak valid');
    const ids = new Set(samples.map(s => s.id));
    const fresh = arr.filter(s => !ids.has(s.id));
    await DB.putMany(fresh); samples = samples.concat(fresh); renderAll();
    toast(`Import: ${fresh.length} sampel baru (${arr.length - fresh.length} duplikat dilewati)`);
  } catch (e) { toast('Import gagal: ' + e.message); }
}
async function loadBundled(url = 'signatures.json', replace = false) {
  try {
    let d = null;
    if (window.DEFAULT_SIGNATURES && (!url || url === 'signatures.json')) {
      d = window.DEFAULT_SIGNATURES;
    } else {
      const r = await fetch(url, { cache: 'no-cache' });
      d = await r.json();
    }
    if (replace) { await DB.clear(); samples = []; }

    const map = new Map();
    (samples || []).forEach(s => map.set(s.file || s.id, s));

    (d.samples || []).forEach(newItem => {
      const key = newItem.file || newItem.id;
      const existing = map.get(key) || samples.find(s => s.file === newItem.file || s.id === newItem.id);
      if (existing) {
        // Force update thumbnail base64 terbaru
        if (newItem.thumb && newItem.thumb.length > 50) {
          existing.thumb = newItem.thumb;
          existing.thumbSrc = newItem.thumbSrc || 'GENERATED';
        }
        existing.bundled = true;
      } else {
        newItem.bundled = true;
        map.set(key, newItem);
      }
    });

    samples = Array.from(map.values());
    await DB.putMany(samples);
    renderAll();
    return samples.length;
  } catch (e) {
    if (window.DEFAULT_SIGNATURES) {
      const d = window.DEFAULT_SIGNATURES;
      if (replace) { await DB.clear(); samples = []; }
      const map = new Map();
      (samples || []).forEach(s => map.set(s.file || s.id, s));
      (d.samples || []).forEach(newItem => {
        const key = newItem.file || newItem.id;
        const existing = map.get(key) || samples.find(s => s.file === newItem.file || s.id === newItem.id);
        if (existing) {
          if (newItem.thumb && newItem.thumb.length > 50) {
            existing.thumb = newItem.thumb;
            existing.thumbSrc = newItem.thumbSrc || 'GENERATED';
          }
          existing.bundled = true;
        } else {
          newItem.bundled = true;
          map.set(key, newItem);
        }
      });
      samples = Array.from(map.values());
      await DB.putMany(samples);
      renderAll();
      return samples.length;
    }
    toast(`${url} tidak dapat dimuat`); return 0;
  }
}

let toastTimer;
function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.display = 'none', 3500); }

/* ---------------- Wiring ---------------- */
function init() {
  $('#tabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('nav button, .tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); $('#' + b.dataset.tab).classList.add('active'); window.scrollTo(0, 0);
  };
  for (const id of ['#inFiles', '#inFolder', '#inZip']) $(id).onchange = e => { ingest(e.target.files); e.target.value = ''; };
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async e => {
    const items = e.dataTransfer.items, files = [];
    const walk = async en => {
      if (en.isFile) await new Promise(r => en.file(f => { Object.defineProperty(f, 'webkitRelativePath', { value: en.fullPath.replace(/^\//, '') }); files.push(f); r(); }, r));
      else if (en.isDirectory) {
        const rd = en.createReader();
        for (;;) { const ents = await new Promise(r => rd.readEntries(r, () => r([]))); if (!ents.length) break; for (const x of ents) await walk(x); }
      }
    };
    if (items && items[0] && items[0].webkitGetAsEntry) { const ens = [...items].map(i => i.webkitGetAsEntry()).filter(Boolean); for (const en of ens) await walk(en); }
    else files.push(...e.dataTransfer.files);
    ingest(files);
  });
  $('#filterStatus').onchange = renderIngest;
  $('#btnAddAccepted').onclick = async () => {
    const ids = new Set(samples.map(s => s.id));
    const fresh = []; staged.forEach(s => { if (s.status === 'accepted' && !ids.has(s.rec.id)) { ids.add(s.rec.id); fresh.push(s.rec); } });
    await DB.putMany(fresh); samples = samples.concat(fresh); renderAll();
    toast(`${fresh.length} sampel disimpan ke repositori`);
  };
  $('#catBody').onclick = e => { const tr = e.target.closest('tr[data-dev]'); if (tr) showDevice(tr.dataset.dev); };
  $('#detailBody').onclick = async e => {
    const d = e.target.closest('[data-sample]'), x = e.target.closest('[data-del]');
    if (d) { const s = samples.find(s => s.id === d.dataset.sample); $('#sampleDetail').innerHTML = sampleDetailHtml(s); }
    if (x) {
      const id = x.dataset.del, s = samples.find(s => s.id === id);
      await DB.tx('readwrite', st => st.delete(id)); samples = samples.filter(s => s.id !== id); renderAll();
      if (samples.some(t => t.device === s.device)) showDevice(s.device);
    }
  };
  $('#btnExport').onclick = exportJson;
  $('#fileImport').onchange = e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; };
  $('#btnReset').onclick = async () => { if (confirm('Ganti repositori lokal dengan isi signatures.json?')) { const n = await loadBundled('signatures.json', true); toast(`Dimuat ${n} sampel dari signatures.json`); } };
  $('#btnClear').onclick = async () => { if (confirm('Hapus seluruh repositori lokal?')) { await DB.clear(); samples = []; renderAll(); } };
  $('#btnCatalogPdf').onclick = catalogPdf;
  $('#inVerify').onchange = e => { if (e.target.files[0]) verify(e.target.files[0]); e.target.value = ''; };
  $('#verifyResult').onclick = e => { if (e.target.id === 'btnVerifyPdf') verifyPdf(); };

  // Gallery events
  $('#galSearch').oninput = renderGallery;
  $('#galFilterDev').onchange = renderGallery;
  $('#galFilterFolder').onchange = renderGallery;
  if ($('#galFilterOri')) $('#galFilterOri').onchange = renderGallery;
  $('#galGrid').onclick = e => {
    const card = e.target.closest('[data-gal-id]');
    if (card) openPhotoModal(card.dataset.galId);
  };
  $('#btnCloseModal').onclick = closePhotoModal;
  $('#photoModal').onclick = e => {
    if (e.target.id === 'photoModal') closePhotoModal();
  };
}

(async function main() {
  init();
  try {
    await DB.open();
    samples = await DB.all();
  } catch (e) {
    toast('IndexedDB tidak tersedia; data hanya di memori');
    DB.putMany = DB.clear = async () => {};
    DB.tx = async () => {};
  }

  // Periksa apakah database kosong ATAU ada sampel yang thumbnail-nya belum ada/rusak/grayscale MPF lama
  const needUpdate = !samples || !samples.length || samples.some(s => !s.thumb || s.thumb.length < 50 || s.thumbSrc === 'MPF' || !s.orientationLabel);
  const bundle = window.DEFAULT_SIGNATURES;
  const build = bundle && bundle.build ? String(bundle.build) : '';
  let stored = ''; try { stored = localStorage.getItem('jsa-build') || ''; } catch (e) { /* abaikan */ }

  if (bundle && (needUpdate || (build && stored !== build) || (bundle.samples && samples.length < bundle.samples.length))) {
    await loadBundled('signatures.json', false);
    try { localStorage.setItem('jsa-build', build); } catch (e) { /* abaikan */ }
  } else {
    renderAll();
  }
})();
