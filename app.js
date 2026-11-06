'use strict';
/* JPEG Signature Analyzer & Database — client-side only */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Mathematical & forensic signature formulas (parseJpeg, Huffman, DQT distance, 576-vector, equivalence classes)
 * are defined in huffman.js, loaded before app.js. */

let samples = [];          // active repository
let staged = [];           // latest ingestion screening results
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
     ['FocalLengthIn35mmFilm', 'Focal 35mm'], ['LensModel', 'Lens'], ['DateTimeOriginal', 'Date/Time Original'], ['Flash', 'Flash'],
     ['Orientation', 'Orientation'], ['ColorSpace', 'Color Space'], ['PixelXDimension', 'EXIF Width'], ['PixelYDimension', 'EXIF Height']]
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

/* ---------------- Normalisasi perangkat & resolusi kode model (SM-... / Firmware) ---------------- */
const MAKE_ALIAS = { EASTMAN: 'KODAK', HEWLETT: 'HP', 'HEWLETT-PACKARD': 'HP', FUJI: 'FUJIFILM', LGE: 'LG', MINOLTA: 'KONICA', ASUSTEK: 'ASUS', 'ONEPLUS': 'ONEPLUS', 'SONY-ERICSSON': 'SONY', 'SONYERICSSON': 'SONY', 'RESEARCH': 'BLACKBERRY', 'BBK': 'VIVO', 'TECNO': 'TECNO', 'INFINIX': 'INFINIX' };
const SAMSUNG_MODELS = {
  'SM-N985F': 'Galaxy Note20 Ultra (SM-N985F)',
  'SM-N986B': 'Galaxy Note20 Ultra 5G (SM-N986B)',
  'SM-N986U': 'Galaxy Note20 Ultra 5G (SM-N986U)',
  'SM-N986N': 'Galaxy Note20 Ultra 5G (SM-N986N)',
  'SM-N980F': 'Galaxy Note20 (SM-N980F)',
  'SM-N981B': 'Galaxy Note20 5G (SM-N981B)',
  'SM-N975F': 'Galaxy Note10+ (SM-N975F)',
  'SM-N970F': 'Galaxy Note10 (SM-N970F)',
  'SM-S721B': 'Galaxy S24 FE',
  'SM-S928B': 'Galaxy S24 Ultra (SM-S928B)',
  'SM-S926B': 'Galaxy S24+ (SM-S926B)',
  'SM-S921B': 'Galaxy S24 (SM-S921B)',
  'SM-S918B': 'Galaxy S23 Ultra (SM-S918B)',
  'SM-S916B': 'Galaxy S23+ (SM-S916B)',
  'SM-S911B': 'Galaxy S23 (SM-S911B)',
  'SM-S711B': 'Galaxy S23 FE (SM-S711B)',
  'SM-S908E': 'Galaxy S22 Ultra (SM-S908E)',
  'SM-S908B': 'Galaxy S22 Ultra (SM-S908B)',
  'SM-S906E': 'Galaxy S22+ (SM-S906E)',
  'SM-S901E': 'Galaxy S22 (SM-S901E)',
  'SM-G998B': 'Galaxy S21 Ultra (SM-G998B)',
  'SM-G996B': 'Galaxy S21+ (SM-G996B)',
  'SM-G991B': 'Galaxy S21 (SM-G991B)',
  'SM-G990E': 'Galaxy S21 FE (SM-G990E)',
  'SM-G988B': 'Galaxy S20 Ultra (SM-G988B)',
  'SM-G985F': 'Galaxy S20+ (SM-G985F)',
  'SM-G980F': 'Galaxy S20 (SM-G980F)',
  'SM-G780G': 'Galaxy S20 FE (SM-G780G)',
  'SM-A556E': 'Galaxy A55 5G (SM-A556E)',
  'SM-A546E': 'Galaxy A54 5G (SM-A546E)',
  'SM-A536E': 'Galaxy A53 5G (SM-A536E)',
  'SM-A528B': 'Galaxy A52s 5G (SM-A528B)',
  'SM-A356E': 'Galaxy A35 5G (SM-A356E)',
  'SM-A346E': 'Galaxy A34 5G (SM-A346E)',
  'SM-A566B': 'Galaxy A56 5G (SM-A566B)',
  'SM-A066B': 'Galaxy A06 5G (SM-A066B)'
};
const DEVICE_CODE_MODELS = {
  'M2103K19G': 'Redmi Note 10 5G (M2103K19G)',
  '23049PCD8G': 'POCO F5 (23049PCD8G)',
  '21061110AG': '11T (21061110AG)',
  'V2149': 'Y35 (V2149)'
};
function normMake(m) {
  m = (m || '').trim().replace(/\b(corporation|corp\.?|company|co\.?|inc\.?|ltd\.?|limited|electronics|imaging|digital)\b/gi, '').replace(/[,.]/g, '').trim();
  const w = (m.split(/\s+/)[0] || '').toUpperCase();
  return MAKE_ALIAS[w] || w;
}
function normModel(model, make, software = '') {
  let m = (model || '').trim();
  let mk = normMake(make);
  if (mk && m.toUpperCase().startsWith(mk)) m = m.slice(mk.length).trim();
  if (DEVICE_CODE_MODELS[m.toUpperCase()]) return DEVICE_CODE_MODELS[m.toUpperCase()];
  // Extract Samsung SM-XXXX code from model or firmware string (e.g. N985FXXSIHYH3 -> SM-N985F)
  const smMatch = m.toUpperCase().match(/^SM-([A-Z]\d{3}[A-Z0-9]*)/);
  const fwMatch = String(software || '').toUpperCase().match(/\b([A-Z]\d{3}[A-Z]{1,2})(?:XX|DX|ZS|OY|UE|KS)[U|S][0-9A-Z]{3,}\b/);
  const smCode = smMatch ? ('SM-' + smMatch[1].replace(/\/DS$/i, '')) : (fwMatch ? 'SM-' + fwMatch[1] : '');
  if (smCode) {
    if (SAMSUNG_MODELS[smCode]) return SAMSUNG_MODELS[smCode];
    if (!m) return 'Galaxy (' + smCode + ')';
    if (/^SM-/i.test(m)) return 'Galaxy ' + smCode;
  }
  return m;
}
function resolveDeviceMeta(rawMake, rawModel, software = '') {
  let make = normMake(rawMake);
  let model = normModel(rawModel, rawMake, software);
  if ((!make || !model) && software) {
    const fw = String(software).toUpperCase().match(/\b([A-Z]\d{3}[A-Z]{1,2})(?:XX|DX|ZS|OY|UE|KS)[U|S][0-9A-Z]{3,}\b/);
    if (fw) {
      if (!make) make = 'SAMSUNG';
      if (!model) model = normModel('SM-' + fw[1], 'SAMSUNG', software);
    }
    const sonyFw = String(software).match(/\b(ZV-[A-Z0-9]+|ILCE-[A-Z0-9]+|DSC-[A-Z0-9]+)\s+v\d/i);
    if (sonyFw) {
      if (!make) make = 'SONY';
      if (!model) model = sonyFw[1].toUpperCase();
    }
  }
  return { make, model, rawModel: (rawModel || '').trim(), device: make && model ? titleMake(make) + ' ' + model : '' };
}
const titleMake = m => m.charAt(0) + m.slice(1).toLowerCase();

/* ---------------- EXIF / TIFF Orientation Mapping ---------------- */
const ORIENTATION_MAP = {
  1: { num: 1, classic: 'Top-Left', exifTool: 'Horizontal (normal)', category: 'Landscape', label: 'Landscape', deg: 0 },
  2: { num: 2, classic: 'Top-Right', exifTool: 'Mirror horizontal', category: 'Landscape', label: 'Landscape', deg: 0, flipH: true },
  3: { num: 3, classic: 'Bottom-Right', exifTool: 'Rotate 180', category: 'Landscape', label: 'Landscape', deg: 180 },
  4: { num: 4, classic: 'Bottom-Left', exifTool: 'Mirror vertical', category: 'Landscape', label: 'Landscape', deg: 0, flipV: true },
  5: { num: 5, classic: 'Left-Top', exifTool: 'Mirror horizontal and rotate 270 CW', category: 'Portrait', label: 'Portrait', deg: 270, flipH: true },
  6: { num: 6, classic: 'Right-Top', exifTool: 'Rotate 90 CW', category: 'Portrait', label: 'Portrait', deg: 90 },
  7: { num: 7, classic: 'Right-Bottom', exifTool: 'Mirror horizontal and rotate 90 CW', category: 'Portrait', label: 'Portrait', deg: 90, flipH: true },
  8: { num: 8, classic: 'Left-Bottom', exifTool: 'Rotate 270 CW', category: 'Portrait', label: 'Portrait', deg: 270 }
};

function parseOrientation(val, w = 0, h = 0) {
  const s = String(val || '').toLowerCase().trim();
  const num = parseInt(s, 10);
  let base = (!isNaN(num) && ORIENTATION_MAP[num]) ? ORIENTATION_MAP[num] : null;
  if (!base) {
    if (s.includes('right-top') || s.includes('rotate 90')) base = ORIENTATION_MAP[6];
    else if (s.includes('left-bottom') || s.includes('rotate 270')) base = ORIENTATION_MAP[8];
    else if (s.includes('bottom-right') || s.includes('rotate 180')) base = ORIENTATION_MAP[3];
    else if (s.includes('top-right') || s.includes('mirror horizontal')) base = ORIENTATION_MAP[2];
    else if (s.includes('bottom-left') || s.includes('mirror vertical')) base = ORIENTATION_MAP[4];
    else if (s.includes('left-top')) base = ORIENTATION_MAP[5];
    else if (s.includes('right-bottom')) base = ORIENTATION_MAP[7];
    else if (s.includes('top-left') || s.includes('horizontal') || s.includes('normal')) base = ORIENTATION_MAP[1];
  }
  if (!base) base = ORIENTATION_MAP[1];
  if (base.deg === 0 && h > w && w > 0) {
    return { ...base, exifTool: 'Portrait (vertical sensor)', isHorizontal: false, category: 'Portrait', label: 'Portrait' };
  }
  const isHorizontal = base.exifTool.toLowerCase().startsWith('horizontal') || base.deg === 180 || base.num === 4;
  return { ...base, isHorizontal, category: isHorizontal ? 'Landscape' : 'Portrait', label: isHorizontal ? 'Landscape' : 'Portrait' };
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
  // 1. Valid data URI base64 thumbnail
  if (s.thumb && typeof s.thumb === 'string' && s.thumb.length > 50) return s.thumb;
  // 2. Lookup in DEFAULT_SIGNATURES if local s.thumb is empty
  if (window.DEFAULT_SIGNATURES && Array.isArray(window.DEFAULT_SIGNATURES.samples)) {
    const found = window.DEFAULT_SIGNATURES.samples.find(x => x.id === s.id || x.file === s.file);
    if (found && found.thumb && found.thumb.length > 50) {
      s.thumb = found.thumb;
      s.thumbSrc = found.thumbSrc || 'GENERATED';
      return s.thumb;
    }
  }
  // 3. Direct fallback to local image files under images/
  if (s.file && (s.file.startsWith('images/') || s.file.startsWith('./images/') || /\.(jpe?g|png|webp)$/i.test(s.file))) {
    return s.file;
  }
  // 4. Format placeholder
  return placeholder(s.format || 'JPEG');
}

function isHorizontalExifTool(s) {
  if (!s) return true;
  if (s.orientationExifTool) {
    const et = String(s.orientationExifTool).toLowerCase();
    const horiz = et.startsWith('horizontal') || et === 'mirror horizontal' || et === 'rotate 180' || et === 'mirror vertical';
    if (!horiz) return false;
    if (s.height > s.width && (!s.orientationDeg || s.orientationDeg === 0)) return false;
    return true;
  }
  return !(s.orientationCategory ? s.orientationCategory === 'Portrait' : (s.isPortrait || s.orientationDeg === 90 || s.orientationDeg === 270 || (s.height > s.width && !s.orientationDeg)));
}
const isSamplePortrait = s => !isHorizontalExifTool(s);

function imgTag(s, cls, extra = '') {
  const primary = thumbOf(s);
  const directPath = (s && s.file && (s.file.startsWith('images/') || s.file.startsWith('./images/'))) ? s.file : '';
  const altFallback = directPath && primary !== directPath ? directPath : placeholder(s && s.format);
  const oriCls = isSamplePortrait(s) ? 'portrait' : 'landscape';
  return `<img class="${cls} ${oriCls}" ${extra} src="${primary}" onerror="if(this.src!=='${altFallback}'){this.src='${altFallback}'}else{this.onerror=null;this.src='${placeholder(s && s.format)}'}">`;
}

/* ---------------- File Analysis ---------------- */
async function analyze(name, buf, size) {
  const j = parseJpeg(buf);
  const fmt = detectFormat(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
  const item = { name, size, valid: j.valid, format: fmt };
  if (!j.valid) { item.status = 'rejected'; item.rec = { format: fmt, file: name, device: '', software: '', thumb: await makePreview(buf, 'image/' + fmt.toLowerCase()) }; item.reason = fmt === 'UNKNOWN' ? 'Unrecognized format / not an image (header FF D8 FF not found)' : `Format ${fmt}, not JPEG (no JPEG DQT tables)`; return item; }
  const ex = readExif(buf);
  const rawW = j.sof ? j.sof.width : 0, rawH = j.sof ? j.sof.height : 0;
  const ori = (ex.params && (ex.params['Orientation'] || ex.params['Orientasi'])) || '';
  const oInfo = parseOrientation(ori, rawW, rawH);
  const preview = await makePreview(buf);
  if (preview) {
    ex.thumb = preview;
    ex.thumbSrc = 'GENERATED_COLOR_ROTATED';
  } else if (ex.thumb && oInfo.deg !== 0) {
    ex.thumb = await rotateDataUrl(ex.thumb, oInfo.deg);
  }
  const isPortrait = oInfo.category === 'Portrait';
  const displayW = isPortrait && rawW > rawH ? rawH : rawW;
  const displayH = isPortrait && rawW > rawH ? rawW : rawH;
  const tool = [ex.software, ex.xmpTool].filter(Boolean).join(' / ');
  const { make, model, rawModel, device } = resolveDeviceMeta(ex.make, ex.model, tool);
  const es = exifStruct(buf), th = thumbSigOf(es, buf);
  const exChk = exifChecksum(ex);
  item.rec = {
    id: name + '|' + size + '|' + j.dqtKey, file: name, size,
    format: 'JPEG', make, model, rawModel: rawModel || model, device,
    software: tool, width: rawW, height: rawH,
    displayWidth: displayW, displayHeight: displayH, displayDim: displayW + ' × ' + displayH,
    orientationNum: oInfo.num, orientationClassic: oInfo.classic,
    orientationExifTool: oInfo.exifTool, orientationCategory: oInfo.category,
    orientationLabel: oInfo.label, orientationDeg: oInfo.deg, isPortrait,
    dqtKey: j.dqtKey, dqt: j.dqt, jpegType: j.jpegType || '', subsampling: j.subsampling || '',
    precision: j.sof ? j.sof.precision : 0, dht: j.dht, dhtHash: j.dhtHash, dri: j.dri,
    markers: j.markers.map(m => m.toString(16).toUpperCase()), exif: ex.params || {}, thumb: ex.thumb, thumbSrc: ex.thumbSrc || '',
    huff: j.huff, exifStruct: es.counts, thumbSig: th,
    exifChecksum: exChk, exifHash: exChk
  };
  item.rec.fullKey = fullKeyOf(item.rec);
  item.edited = EDITORS.test(tool);
  const traces = editTraces(j, es, tool);
  if (!j.dqtKey) { item.status = 'rejected'; item.reason = 'No DQT tables found'; }
  else if (item.edited) { item.status = 'rejected'; item.reason = 'Edited with third-party software: ' + tool; }
  else if (traces.length) { item.status = 'rejected'; item.edited = true; item.reason = 'Edit traces without a Software tag: ' + traces.join('; '); }
  else if (isFlickrResize(rawW, rawH)) { item.status = 'rejected'; item.reason = 'Resized derivative (long side ' + Math.max(rawW, rawH) + ' px is a Flickr resize size)'; }
  else if (!item.rec.device) { item.status = 'rejected'; item.reason = 'EXIF Make/Model unavailable'; }
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
      } catch (e) { toast('Failed to read ZIP: ' + f.name); }
    } else if (IMG_EXT.test(f.name) || (f.type || '').startsWith('image/')) jobs.push({ name: nm, get: () => f.arrayBuffer() });
  }
  return jobs;
}

async function ingest(files) {
  const jobs = await collect([...files]);
  if (!jobs.length) { toast('No JPEG files found'); return; }
  staged = [];

  // Build index of existing EXIF checksums and IDs already in database (IndexedDB / samples)
  const existingExif = new Map();
  (samples || []).forEach(s => {
    const chk = s.exifChecksum || s.exifHash;
    if (chk) existingExif.set(chk, s);
    if (s.id) existingExif.set(s.id, s);
  });
  const batchExif = new Map();

  for (let i = 0; i < jobs.length; i++) {
    try {
      const buf = await jobs[i].get();
      const it = await analyze(jobs[i].name, buf, buf.byteLength);

      // Duplicate detection: check if EXIF checksum matches an existing sample or an earlier file in this batch
      if (it.status === 'accepted' && it.rec) {
        const chk = it.rec.exifChecksum;
        if (chk && existingExif.has(chk)) {
          const match = existingExif.get(chk);
          it.status = 'duplicate';
          it.duplicate = true;
          it.duplicateOf = match.file || match.id;
          it.reason = `Duplicate: EXIF checksum (${chk.slice(0, 10)}) matches existing sample in database ("${match.file || match.device}")`;
        } else if (existingExif.has(it.rec.id)) {
          const match = existingExif.get(it.rec.id);
          it.status = 'duplicate';
          it.duplicate = true;
          it.duplicateOf = match.file || match.id;
          it.reason = `Duplicate: File signature already exists in database ("${match.file || match.device}")`;
        } else if (chk && batchExif.has(chk)) {
          const match = batchExif.get(chk);
          it.status = 'duplicate';
          it.duplicate = true;
          it.duplicateOf = match.name;
          it.reason = `Duplicate: EXIF checksum (${chk.slice(0, 10)}) matches earlier file in this upload batch ("${match.name}")`;
        } else {
          if (chk) batchExif.set(chk, it);
          batchExif.set(it.rec.id, it);
        }
      }

      staged.push(it);
    } catch (e) { staged.push({ name: jobs[i].name, status: 'rejected', reason: 'Failed to read: ' + e.message }); }
    if (i % 5 === 0 || i === jobs.length - 1) {
      $('#bar').style.width = ((i + 1) / jobs.length * 100) + '%';
      $('#progText').textContent = `Processing ${i + 1} / ${jobs.length}`;
      await new Promise(r => setTimeout(r));
    }
  }

  /* Outlier screening against the catalog (needs the existing repository, so it runs after per-file analysis) */
  staged.forEach(it => {
    if (it.status !== 'accepted') return;
    const why = outlierCheck(it.rec);
    if (why) { it.status = 'rejected'; it.outlier = true; it.reason = why; }
  });

  /* Automatically save accepted samples (duplicates and rejected files are excluded) */
  const ids = new Set((samples || []).map(s => s.id));
  const exSet = new Set((samples || []).map(s => s.exifChecksum || s.exifHash).filter(Boolean));
  const fresh = [];
  staged.forEach(s => {
    if (s.status === 'accepted' && s.rec && !ids.has(s.rec.id) && !exSet.has(s.rec.exifChecksum)) {
      ids.add(s.rec.id);
      if (s.rec.exifChecksum) exSet.add(s.rec.exifChecksum);
      fresh.push(s.rec);
    }
  });
  if (fresh.length) {
    await DB.putMany(fresh);
    samples = samples.concat(fresh);
    renderAll();
    const dupCount = staged.filter(s => s.status === 'duplicate').length;
    toast(`Saved ${fresh.length} new accepted sample(s)${dupCount ? ` (${dupCount} duplicates skipped)` : ''}`);
  } else {
    const dupCount = staged.filter(s => s.status === 'duplicate').length;
    if (dupCount) toast(`${dupCount} duplicate sample(s) detected and skipped`);
  }
  renderIngest();
}

function renderIngest() {
  const acc = staged.filter(s => s.status === 'accepted').length;
  const dupes = staged.filter(s => s.status === 'duplicate').length;
  const inval = staged.filter(s => s.valid === false).length;
  const ed = staged.filter(s => s.edited).length;
  const reasonIs = (s, p) => s.status === 'rejected' && (s.reason || '').startsWith(p);
  const resized = staged.filter(s => reasonIs(s, 'Resized')).length;
  const outliers = staged.filter(s => s.outlier).length;
  const nometa = staged.filter(s => s.valid && !s.edited && s.status === 'rejected').length - resized - outliers;
  $('#ingestTiles').innerHTML = [
    ['Total', staged.length],
    ['Accepted', acc],
    ['Duplicate (Skipped)', dupes],
    ['Invalid JPEG', inval],
    ['Edited (tag or traces)', ed],
    ['Resized (Flickr)', resized],
    ['Signature Outlier', outliers],
    ['Missing Metadata/DQT', nometa]
  ].map(([l, v]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

  $('#btnAddAccepted').disabled = !acc;
  const f = $('#filterStatus').value;
  const rows = staged.map((s, idx) => ({ s, idx })).filter(({ s }) => f === 'all' || s.status === f);
  $('#ingestBody').innerHTML = rows.length ? rows.map(({ s, idx }) => `<tr class="${s.rec && s.rec.dqt ? 'click' : ''}" data-ingest-idx="${idx}" title="Click to view full forensic analysis">
    <td>${s.rec ? imgTag(s.rec, 'thumb') : ''}</td>
    <td class="small">${esc(s.name)}</td>
    <td><b>${esc(s.rec ? s.rec.device : '-')}</b>${s.rec && s.rec.rawModel && s.rec.rawModel !== s.rec.model ? `<div class="small muted">EXIF Model: ${esc(s.rec.rawModel)}</div>` : ''}</td>
    <td class="small mono">${esc(s.rec ? s.rec.software : '')}</td>
    <td>${s.status === 'accepted'
      ? `<span class="badge ok">Accepted &amp; Saved</span> ${s.rec ? `<button class="btn sec" data-sample-pdf="${esc(s.rec.id)}" style="padding:3px 8px;font-size:11px;margin-left:6px">PDF</button>` : ''}`
      : s.status === 'duplicate'
      ? `<span class="badge warn">Duplicate</span> <span class="small muted">${esc(s.reason)}</span>`
      : `<span class="badge bad">Rejected</span> <span class="small muted">${esc(s.reason)}</span>`}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No data available.</td></tr>';
}

/* ---------------- Catalog & Classification ---------------- */
function eqHtml() {
  const rows = EQ_SETS.map(([l, f]) => ({ l, st: eqStats(f) }));
  const cs = configStats();
  return `<div class="scroll"><table><thead><tr><th>Feature set</th><th>Classes</th><th>n=1</th><th>n=2</th><th>n=3</th><th>n=4</th><th>n ≥ 5</th><th>Median n</th><th>Max n</th><th>Devices uniquely identified</th></tr></thead><tbody>` +
    rows.map(({ l, st }) => `<tr><td>${l}</td><td>${st.classes}</td>${st.dist.map(x => `<td>${x}</td>`).join('')}<td>${st.median}</td><td>${st.max}</td><td>${st.uniq} / ${st.devs} (${st.devs ? (100 * st.uniq / st.devs).toFixed(1) : 0}%)</td></tr>`).join('') +
    `</tbody></table></div><p class="small muted">Class size n = number of devices (Make + Model) sharing the same signature. Configurations (device + full signature) with at least ${MIN_CONFIG_SAMPLES} samples, as required by the reference paper: ${cs.ok} of ${cs.total}.</p>`;
}

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

/* ---------------- Photo Gallery ---------------- */
function initGalleryFilters() {
  const devs = [...new Set(samples.map(s => s.device))].sort();
  const selDev = $('#galFilterDev');
  const curDev = selDev.value;
  selDev.innerHTML = '<option value="all">All Devices</option>' + devs.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  if (devs.includes(curDev)) selDev.value = curDev;

  const folders = [...new Set(samples.map(s => s.file.split('/')[1] || 'root'))].sort();
  const selFolder = $('#galFilterFolder');
  const curFolder = selFolder.value;
  selFolder.innerHTML = '<option value="all">All Folders</option>' + folders.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
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
    if (oriF !== 'all' && (isSamplePortrait(s) ? 'Portrait' : 'Landscape') !== oriF) return false;
    if (q) {
      const hay = (s.file + ' ' + s.device + ' ' + s.dqtKey + ' ' + (s.software || '') + ' ' + (s.orientationLabel || '') + ' ' + (s.orientationExifTool || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  $('#galCount').textContent = filtered.length;
  const grid = $('#galGrid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="muted" style="grid-column:1/-1;padding:20px;text-align:center">No photos match the selected filter.</div>';
    return;
  }

  grid.innerHTML = filtered.map(s => {
    const filename = s.file.split('/').pop();
    const folder = s.file.split('/')[1] || '';
    const imgHtml = imgTag(s, 'gal-img', 'loading="lazy"');
    const isPortrait = isSamplePortrait(s);
    const oriText = isPortrait ? 'Portrait' : 'Landscape';
    const exifDesc = s.orientationExifTool || (isPortrait ? 'Rotate 90 CW' : 'Horizontal (normal)');
    const oriBadge = `<span class="${isPortrait ? 'photo-badge portrait' : 'photo-badge'}" title="ExifTool: ${esc(exifDesc)}">${oriText}</span>`;
    const dimText = s.displayDim || (isPortrait && s.width > s.height ? `${s.height}×${s.width}` : `${s.width}×${s.height}`);
    return `<div class="photo-card ${isPortrait ? 'portrait' : 'landscape'}" data-gal-id="${esc(s.id)}">
      <div class="photo-img-wrap">
        ${imgHtml}
        ${oriBadge}
      </div>
      <div class="photo-info">
        <div class="photo-name" title="${esc(filename)}">${esc(filename)}</div>
        <div class="photo-dev">${esc(s.device)}</div>
        <div class="small muted">${dimText} · ${esc(exifDesc)}</div>
        <div class="small muted">${esc(folder)} · <span class="mono" title="DQT Key: ${s.dqtKey}">${s.dqtKey}</span></div>
        <button class="btn sec" data-sample-pdf="${esc(s.id)}" style="margin-top:6px;padding:4px 8px;font-size:11px;width:100%">Download Forensic PDF</button>
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
  $('#catBody').innerHTML = rows.join('') || '<tr><td colspan="4" class="muted">Repository is empty. Ingest samples in the Ingestion tab or Import JSON.</td></tr>';
  $('#detailCard').style.display = 'none';
}

function showDevice(dev) {
  const arr = samples.filter(s => s.device === dev);
  $('#detailCard').style.display = '';
  $('#detailTitle').textContent = dev;
  $('#detailBody').innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn" data-dev-pdf="${esc(dev)}">Download Device Samples PDF (${arr.length} files)</button></div>
    <div class="scroll"><table><thead><tr><th>Thumbnail</th><th>File</th><th>Dimensions</th><th>Signature</th><th>Action</th></tr></thead><tbody>` +
    arr.map(s => `<tr><td>${imgTag(s, 'thumb')}</td><td class="small">${esc(s.file)}</td>
      <td>${s.displayDim || (s.width + '×' + s.height)}</td><td class="mono small">${s.dqtKey}</td>
      <td><button class="btn sec" data-sample="${esc(s.id)}">Details</button> <button class="btn" data-sample-pdf="${esc(s.id)}">PDF</button> <button class="btn danger" data-del="${esc(s.id)}">Delete</button></td></tr>`).join('') +
    `</tbody></table></div><div id="sampleDetail"></div>`;
  $('#detailCard').scrollIntoView({ behavior: 'smooth' });
}

function sampleDetailHtml(s) {
  const kv = o => '<div class="kv">' + Object.entries(o).map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('') + '</div>';
  const isPortrait = isSamplePortrait(s);
  const isHoriz = !isPortrait;
  const oriLabel = isPortrait ? 'Portrait' : 'Landscape';
  const exifDesc = s.orientationExifTool || (isPortrait ? 'Rotate 90 CW' : 'Horizontal (normal)');
  const displayDim = s.displayDim || (isPortrait && s.width > s.height ? `${s.height} × ${s.width} (Portrait)` : `${s.width} × ${s.height} (Landscape)`);
  const th = s.thumbSig || {}, hRows = huffRows(s.huff);
  return `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">${esc(s.file)}</h3>
      <button class="btn" data-sample-pdf="${esc(s.id)}">Download Sample Forensic PDF</button>
    </div>
    <div class="grid2"><div>
    <div class="thumb-detail-box ${isPortrait ? 'portrait' : 'landscape'}">${imgTag(s, 'thumb-lg')}</div>
    <p class="small muted">${!s.thumb ? 'No thumbnail — format placeholder ' + (s.format || 'JPEG') : s.thumbSrc === 'GENERATED' || s.thumbSrc === 'GENERATED_COLOR_ROTATED' ? 'Full-color preview from source image' : 'Embedded thumbnail (' + (s.thumbSrc || 'EXIF') + ')'} · <b>${oriLabel}</b> (${esc(exifDesc)})</p>
    <h3>Camera Orientation (EXIF / TIFF)</h3>
    ${kv({
      'ExifTool Description': exifDesc,
      'Is Horizontal (ExifTool)': isHoriz ? 'Yes — Horizontal / Landscape' : 'No (' + exifDesc + ') — Portrait',
      'Display Category': oriLabel,
      'EXIF Tag Value': s.orientationNum ? String(s.orientationNum) : '1 (Default)',
      'TIFF/EXIF Classic Name': s.orientationClassic || 'Top-Left',
      'Display Dimensions': displayDim,
      'Native Sensor Dimensions': `${s.width} × ${s.height}`
    })}
    <h3>Camera Metadata</h3>${kv({ Make: s.make, 'Resolved Model': s.model, ...(s.rawModel && s.rawModel !== s.model ? { 'EXIF Model Code': s.rawModel } : {}), Software: s.software || '-', ...s.exif })}</div>
    <div><h3>Compression &amp; 576-Feature Signature</h3>${kv({
      Type: s.jpegType, Subsampling: s.subsampling, Precision: s.precision + ' bits',
      'DHT Tables': s.dht.length + ' (hash ' + (s.dhtHash || '-') + ')',
      'Restart Interval': s.dri, Markers: s.markers.join(' '),
      'DQT Signature (192)': s.dqtKey,
      'Full Signature (576)': fullKeyOf(s),
      'Embedded Thumbnail (284)': th.present ? `${th.w} × ${th.h}` : 'absent (zeros)',
      'EXIF IFD Counts (8)': (s.exifStruct || []).join(', ') || '-',
      'Estimated Quality': qualityText(s.dqt)
    })}</div></div>
    <h3>8×8 DQT Quantization Matrix</h3>${dqtHtml(s.dqt)}
    <h3>Huffman Tables (DHT): BITS[1..15] Code-Length Counts (90 features)</h3>
    <div class="scroll"><table><thead><tr><th>Table</th><th>BITS[1..15]</th><th>Symbols</th><th>Kraft Sum</th><th>Kraft Valid</th></tr></thead><tbody>${hRows.map(r => `<tr><td>${r.label}</td><td class="mono small">${r.counts.join(' ')}</td><td>${r.total}</td><td>${r.kraftSum.toFixed(4)}</td><td>${r.valid ? 'yes' : 'NO'}</td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn" data-sample-pdf="${esc(s.id)}">Download Sample Forensic PDF</button></div>`;
}

function renderClassify(groups) {
  const list = { unique: [], same: [], multi: [] };
  groups.forEach(g => list[g.cat].push(g));
  $('#classTiles').innerHTML = [['Total Signatures', groups.size], ['Unique', list.unique.length], ['Shared (Same Manufacture)', list.same.length], ['Shared (Multi-Device)', list.multi.length]]
    .map(([l, v]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
  const card = g => {
    const devs = [...g.devices.keys()].sort();
    return `<details><summary><span class="mono">${g.key}</span> · ${devs.length} device${devs.length === 1 ? '' : 's'} · ${g.samples.length} sample${g.samples.length === 1 ? '' : 's'}
      ${g.variants.length > 1 ? `<span class="badge navy">${g.variants.length} table variants</span>` : ''}
      ${g.cat === 'multi' ? `<span class="badge navy">${devs.length >= 5 ? '5+' : devs.length} devices</span>` : ''}</summary>
      <div class="chips" style="margin:8px 0">${devs.map(d => `<span>${esc(d)}</span>`).join('')}</div>
      <div class="small muted">Estimated Quality: ${qualityText(g.dqt)}${g.variants.length > 1 ? ' · variants: ' + g.variants.join(', ') : ''}</div>${dqtHtml(g.dqt)}</details>`;
  };
  for (const [c, id] of [['unique', '#clsUnique'], ['same', '#clsSame'], ['multi', '#clsMulti']])
    $(id).innerHTML = list[c].map(card).join('') || '<span class="muted">None.</span>';
  if ($('#eqStats')) $('#eqStats').innerHTML = eqHtml();
}

/* ---------------- Verification ---------------- */
async function verify(file) {
  const buf = await file.arrayBuffer();
  const j = parseJpeg(buf);
  const box = $('#verifyResult');
  if (!j.valid) { const fmt = detectFormat(new Uint8Array(buf, 0, Math.min(16, buf.byteLength))); box.innerHTML = `<div class="alert bad">Not a JPEG file (detected format: ${esc(fmt)}).<small>DQT signatures are unique to JPEG; this file cannot be verified.</small></div><div class="card">${imgTag({ format: fmt }, 'thumb-lg')}</div>`; lastVerify = null; return; }
  const ex = readExif(buf);
  const rawW = j.sof ? j.sof.width : 0, rawH = j.sof ? j.sof.height : 0;
  const ori = (ex.params && (ex.params['Orientation'] || ex.params['Orientasi'])) || '';
  const oInfo = parseOrientation(ori, rawW, rawH);
  const isPortrait = oInfo.category === 'Portrait';
  const dispW = isPortrait && rawW > rawH ? rawH : rawW, dispH = isPortrait && rawW > rawH ? rawW : rawH;
  const preview = await makePreview(buf);
  if (preview) ex.thumb = preview;
  else if (ex.thumb && oInfo.deg !== 0) ex.thumb = await rotateDataUrl(ex.thumb, oInfo.deg);
  const tool = [ex.software, ex.xmpTool].filter(Boolean).join(' / ');
  const { make, model, rawModel, device: claimed } = resolveDeviceMeta(ex.make, ex.model, tool);
  const edited = EDITORS.test(tool);
  const groups = groupSignatures();
  /* Full 576-feature signature of the query image, compared component by component with every catalog sample */
  const es = exifStruct(buf), th = thumbSigOf(es, buf);
  const qRec = {
    id: file.name + '|' + (file.size || buf.byteLength) + '|' + j.dqtKey,
    file: file.name, size: file.size || buf.byteLength,
    format: 'JPEG', make, model, rawModel: rawModel || model, device: claimed,
    software: tool, width: rawW, height: rawH,
    displayWidth: dispW, displayHeight: dispH, displayDim: dispW + ' × ' + dispH,
    orientationNum: oInfo.num, orientationClassic: oInfo.classic,
    orientationExifTool: oInfo.exifTool, orientationCategory: oInfo.category,
    orientationLabel: oInfo.label, orientationDeg: oInfo.deg, isPortrait,
    dqtKey: j.dqtKey, dqt: j.dqt, jpegType: j.jpegType || '', subsampling: j.subsampling || '',
    precision: j.sof ? j.sof.precision : 0, dht: j.dht, dhtHash: j.dhtHash, dri: j.dri,
    markers: j.markers.map(m => m.toString(16).toUpperCase()), exif: ex.params || {},
    thumb: ex.thumb, thumbSrc: ex.thumbSrc || 'GENERATED_COLOR_ROTATED',
    huff: j.huff, exifStruct: es.counts, thumbSig: th
  };
  qRec.fullKey = fullKeyOf(qRec);
  const qParts = sigParts(qRec), qFull = qRec.fullKey;
  const catSigs = samples.map(s => ({ s, parts: sigParts(s), full: fullKeyOf(s) }));
  const compRows = qParts.map((p, i) => {
    const k = p.vals.join(','), devs = new Set(), makes = new Set();
    catSigs.forEach(c => { if (c.parts[i].vals.join(',') === k) { devs.add(c.s.device); makes.add(c.s.make); } });
    return { label: p.label, n: p.vals.length, devs: [...devs].sort(), makes: [...makes] };
  });
  const fullDevs = [...new Set(catSigs.filter(c => c.full === qFull).map(c => c.s.device))].sort();
  const claimedKnown = !!(claimed && samples.some(s => s.device === claimed || (rawModel && s.rawModel === rawModel)));
  const dimKey = Math.min(qRec.width, qRec.height) + 'x' + Math.max(qRec.width, qRec.height);
  const natSet = new Set(samples.filter(s => s.device === claimed).map(s => Math.min(s.width, s.height) + 'x' + Math.max(s.width, s.height)));
  const nativeText = isFlickrResize(qRec.width, qRec.height) ? 'Flickr resize size (likely re-compressed)' : !claimed ? '-' : !natSet.size ? `New model (${claimed} not yet in catalog; sensor ${qRec.width}×${qRec.height})` : natSet.has(dimKey) ? 'Seen in catalog for claimed device' : 'NOT seen in catalog for claimed device (possible resize / converter)';
  const ijg = ijgMatch(j.dqt), traces = editTraces(j, es);
  const hRows = huffRows(j.huff);
  let fullLevel, fullText;
  if (!samples.length) { fullLevel = 'info'; fullText = 'Catalog is empty.'; }
  else if (!fullDevs.length) { fullLevel = 'info'; fullText = claimed && !claimedKnown ? `Model ${claimed} is not yet registered in the catalog. Click "Register ${claimed} in Catalog" below to add its 576-feature signature.` : 'No catalog sample shares the complete 576-feature signature (resolution and thumbnail are part of the signature, so a new resolution yields no full match; see the component table).'; }
  else if (claimed && !fullDevs.includes(claimed)) { fullLevel = 'bad'; fullText = `Full signature matches ${fullDevs.join('; ')}, but EXIF claims ${claimed}.`; }
  else if (claimed) { fullLevel = fullDevs.length === 1 ? 'ok' : 'warn'; fullText = fullDevs.length === 1 ? `Full signature matches only ${claimed}.` : `Full signature matches ${claimed} but is shared with: ${fullDevs.filter(d => d !== claimed).join('; ')}.`; }
  else { fullLevel = 'info'; fullText = `Full signature matches: ${fullDevs.join('; ')}.`; }
  /* Matching logic: exact hash -> similar variant (dist <= NEAR) -> nearest candidate */
  const cands = new Map(); let nearestKey = null, nearestD = Infinity;
  if (j.dqtKey) groups.exact.forEach(e => {
    const d = e.key === j.dqtKey ? 0 : dqtDist(j.dqt, e.dqt);
    if (d < nearestD) { nearestD = d; nearestKey = e.key; }
    e.samples.forEach(s => { const c = cands.get(s.device); if (!c || d < c.d) cands.set(s.device, { d, make: s.make }); });
  });
  const ranked = [...cands.entries()].sort((a, b) => a[1].d - b[1].d);
  let g = groups.byKey.get(j.dqtKey), matchType = g ? 'exact' : null;
  if (!g && nearestKey && nearestD <= NEAR) { g = groups.byKey.get(nearestKey); matchType = 'near'; }
  const nearNote = matchType === 'near' ? ` (similar variant, distance ${nearestD.toFixed(2)})` : '';
  const matches = g ? [...g.devices.entries()] : [];
  let level, title, detail;
  if (!j.dqtKey) { level = 'warn'; title = 'No DQT tables found'; detail = 'Compression signature could not be extracted.'; }
  else if (!samples.length) { level = 'info'; title = 'Catalog is empty'; detail = 'Load signatures.json / Import JSON or ingest sample images first.'; }
  else if (!g) {
    const near = ranked[0] ? `${ranked[0][0]} (distance ${ranked[0][1].d.toFixed(2)})` : '-';
    if (claimedKnown) {
      const dc = cands.get(claimed).d;
      if (dc <= CLOSE) { level = 'warn'; title = 'SIMILAR but not identical to claimed device signature'; detail = `EXIF claims ${claimed}; nearest DQT distance is ${dc.toFixed(2)}. Possible new quantization variant or reprocessed image. Closest candidate: ${near}.`; }
      else { level = 'bad'; title = 'MISMATCH — signature does not match EXIF claim'; detail = `EXIF claims ${claimed}, which exists in the catalog, but its distance is ${dc.toFixed(2)} from this image signature. Closest candidate: ${near}.`; }
    } else if (claimed && ranked[0] && ranked[0][1].make === make && ranked[0][1].d <= CLOSE) {
      level = 'ok';
      title = `AUTHENTIC ${make} ENCODER PROFILE — ${claimed} (New Model)`;
      detail = `EXIF model ${claimed}${rawModel && rawModel !== model ? ' [' + rawModel + ']' : ''} (Firmware: ${tool || '-'}) is a valid ${titleMake(make)} device not yet in the catalog. Its DQT profile closely matches ${ranked[0][0]} (distance ${ranked[0][1].d.toFixed(2)}, ${simPct(ranked[0][1].d).toFixed(1)}% similarity).`;
    } else { level = 'info'; title = `New Device Signature — ${claimed || 'Unknown Model'}`; detail = `Model ${claimed || '-'} is not yet in the catalog. Closest catalog candidate: ${near}. Click "Register in Catalog" below to add this model.`; }
  } else if (!claimed) { level = 'info'; title = 'Candidate device found (EXIF Make/Model empty)' + nearNote; detail = 'Signature matches the devices listed below.'; }
  else if (g.devices.has(claimed)) { level = g.devices.size === 1 ? 'ok' : 'warn'; title = (g.devices.size === 1 ? 'MATCH — signature consistent with EXIF claim' : 'Consistent with EXIF claim, but signature is shared') + nearNote; detail = g.devices.size === 1 ? `Signature is verified for ${claimed}.` : `Signature is shared across ${g.devices.size} devices, so identification is not definitive.`; }
  else if ([...g.devices.values()].includes(make) && !claimedKnown && matchType === 'near') {
    level = 'ok';
    title = `AUTHENTIC ${make} ENCODER FAMILY — ${claimed} (Model Analyzed)` + nearNote;
    detail = `Detected ${claimed}${rawModel && rawModel !== model ? ' [EXIF code: ' + rawModel + ']' : ''} (Firmware: ${tool || '-'}). This specific model is not yet in the catalog, but its DQT matrix (${simPct(nearestD).toFixed(1)}% similarity, distance ${nearestD.toFixed(2)}) and Huffman tables match the ${titleMake(make)} hardware encoder family (${matches.map(m => m[0]).join(', ')}). Click "Register ${claimed} in Catalog" below to add this model.`;
  }
  else if ([...g.devices.values()].includes(make)) { level = 'warn'; title = 'SAME MANUFACTURER, DIFFERENT MODEL' + nearNote; detail = `EXIF claims ${claimed}, while the catalog signature is registered to ${matches.map(m => m[0]).join(', ')} (${titleMake(make)}).`; }
  else { level = 'bad'; title = 'MISMATCH — EXIF claim differs from compression signature' + nearNote; detail = `EXIF claims ${claimed}, but the DQT signature matches a completely different device (${matches.map(m => m[0]).join(', ')}).`; }

  lastVerify = { file: file.name, claimed, rawModel, make, model, level, title, detail, matches: matches.map(m => m[0]), cat: g ? g.cat : null, j, ex, tool, edited, key: j.dqtKey, isPortrait, dims: j.sof ? `${dispW} × ${dispH} (${isPortrait ? 'Portrait' : 'Landscape'})` : '-',
    qRec, sig: { qFull, compRows, fullDevs, fullLevel, fullText, hRows, nativeText, ijg, traces, th, exif: es.counts } };
  const compHtml = `<h3>Full Signature Components (576 features)</h3><div class="scroll"><table><thead><tr><th>Component</th><th>Features</th><th>Catalog devices with identical values</th><th>Claimed device (${esc(claimed || '-')})</th></tr></thead><tbody>${compRows.map(r => {
    const status = !claimed ? '-' : r.devs.includes(claimed) ? 'exact match' : (!claimedKnown && r.makes.includes(make)) ? `same make (${titleMake(make)})` : !claimedKnown ? 'new model' : 'differs';
    return `<tr><td>${r.label}</td><td>${r.n}</td><td class="small">${r.devs.length ? esc(r.devs.slice(0, 4).join('; ')) + (r.devs.length > 4 ? ' +' + (r.devs.length - 4) + ' more' : '') : 'none (unique to query)'}</td><td>${esc(status)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  const huffHtml = `<h3>Huffman Tables (DHT): code-length counts BITS[1..15]</h3><p class="small muted">Each DHT stores BITS[L] = number of Huffman codes of bit-length L. Features = BITS[1..15] of the six tables used by Y, Cb and Cr (6 x 15 = 90 values). First canonical code of each length: start with code = 0; for each length L the first code is code, then code = (code + BITS[L]) &lt;&lt; 1.</p><div class="scroll"><table><thead><tr><th>Table</th><th>BITS[1..15]</th><th>Symbols</th><th>Kraft valid</th></tr></thead><tbody>${hRows.map(r => `<tr><td>${r.label}</td><td class="mono small">${r.counts.join(' ')}</td><td>${r.total}</td><td>${r.valid ? 'yes' : 'NO'}</td></tr>`).join('')}</tbody></table></div>`;
  const kv = o => '<div class="kv">' + Object.entries(o).map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('') + '</div>';
  box.innerHTML = `<div class="alert ${level}">${esc(title)}<small>${esc(detail)}</small></div>
    ${edited ? `<div class="alert warn">Warning: software metadata indicates third-party editing (${esc(tool)}). Results may be unreliable.<small>DQT signature may originate from image editing software rather than the camera.</small></div>` : ''}
    ${traces.length ? `<div class="alert bad">Editing traces found${tool ? '' : ' (no Software tag present)'}: ${esc(traces.join('; '))}.<small>These traces survive deleting the EXIF Software tag, so this file was probably processed after capture; the catalog match is not reliable evidence of the camera.</small></div>` : ''}
    <div class="card"><div class="grid2"><div>
      <div class="thumb-detail-box ${isPortrait ? 'portrait' : 'landscape'}">${imgTag({ thumb: ex.thumb, format: 'JPEG', isPortrait, orientationExifTool: oInfo.exifTool }, 'thumb-lg')}</div>
      <p class="small muted">${ex.thumb ? (ex.thumbSrc ? 'Embedded thumbnail' : 'Source image preview') : 'JPEG Placeholder'} · <b>${isPortrait ? 'Portrait' : 'Landscape'}</b> (${esc(oInfo.exifTool)})</p>
      <h3>EXIF Claim &amp; Device Identification</h3>${kv({ File: file.name, Make: make || '-', 'Resolved Model': model || '-', 'EXIF Model Code': rawModel || '-', 'Device Name': claimed || '-', 'Firmware / Software': tool || '-', Dimensions: lastVerify.dims, ...(ex.params || {}) })}</div>
      <div><h3>Match &amp; Signature Analysis</h3>${kv({ 'Analyzed Device': claimed || '-', 'Catalog Status': claimedKnown ? 'Registered in Catalog' : 'New Model (Not Yet in Catalog)', 'DQT Signature': j.dqtKey || '-', Category: g ? CAT_LABEL[g.cat] : 'Unique (New)', 'Match Type': matchType === 'exact' ? 'Exact (identical hash)' : matchType === 'near' ? `Same-Make Encoder Family (dist ${nearestD.toFixed(2)})` : 'New Signature', 'Estimated Quality': qualityText(j.dqt), Type: j.jpegType || '-', Subsampling: j.subsampling || '-',
        'Full Signature (576)': qFull, 'Embedded Thumbnail': th.present ? th.w + ' x ' + th.h : 'absent',
        'EXIF IFD Counts': es.counts.join(', '), 'IJG Standard Tables': ijg ? 'Exact match (Q' + ijg + ')' : 'No', 'Native Resolution': nativeText })}
      <h3>Matching / Family Devices in Catalog</h3>
      <div class="chips">${claimed && !claimedKnown ? `<span><b>${esc(claimed)}</b> (Analyzed Query Model)</span>` : ''}${matches.map(([d]) => `<span>${esc(d)}${!claimedKnown && d !== claimed ? ' (Family Match)' : ''}</span>`).join('') || (!claimed ? '<span class="muted">None</span>' : '')}</div></div></div>
      <h3>Nearest Candidates (DQT distance)</h3>
      <div class="scroll" style="max-height:220px"><table><thead><tr><th>Device</th><th>Distance</th><th>Similarity</th></tr></thead><tbody>${ranked.slice(0, 8).map(([d, c]) => `<tr><td>${esc(d)}${d === claimed ? ' <span class="badge navy">EXIF claim</span>' : (c.make === make ? ' <span class="badge navy">Same Make (' + esc(make) + ')</span>' : '')}</td><td>${c.d === Infinity ? '-' : c.d.toFixed(2)}</td><td>${simPct(c.d).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="3" class="muted">-</td></tr>'}</tbody></table></div>
      <h3>Full-Signature Result</h3><div class="alert ${fullLevel}" style="margin:6px 0">${esc(fullText)}</div>
      ${compHtml}${huffHtml}
      <h3>DQT Matrix</h3>${dqtHtml(j.dqt)}
      <div class="row" style="margin-top:12px">
        <button class="btn" id="btnVerifyPdf">Download PDF Report</button>
        ${claimed && !edited && !traces.length && !claimedKnown ? `<button class="btn secondary" id="btnVerifyRegister">Register ${esc(claimed)} in Catalog</button>` : ''}
      </div></div>`;
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
    img(d, w, h) { try { api.need(h + 2); doc.addImage(d, 'JPEG', 15, y, w, h); y += h + 3; } catch (e) { /* ignore */ } },
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

function pdfMethod(p) {
  p.line('Signature Extraction Method (Kee, Johnson & Farid, 2011)', 12, true);
  [
    '1. Parse JPEG markers sequentially with DataView (SOI, APPn, DQT, SOF, DHT, DRI) until the first SOS.',
    '2. DQT: each table = Pq/Tq byte + 64 entries stored in zig-zag order; entries are un-zig-zagged to natural order. Tq0, Tq1, Tq2 give 3 x 64 = 192 features (missing tables are zero).',
    '3. Huffman (DHT): every table holds a Tc/Th byte (class DC/AC and table id), BITS[1..16] and HUFFVAL. BITS[L] is the number of codes of bit-length L. SOS assigns a DC table (Td) and AC table (Ta) to each component, so the six tables Y-DC, Y-AC, Cb-DC, Cb-AC, Cr-DC, Cr-AC are selected. Features = BITS[1..15] of each: 6 x 15 = 90.',
    '4. Dimensions: (width, height) sorted to (min, max), so portrait and landscape of the same camera give the same 2 features.',
    '5. Thumbnail: IFD1 tags 0x0201 (offset) and 0x0202 (length) locate the embedded JPEG, which is parsed by the same code: dimensions 2 + DQT 192 + Huffman 90 = 284 features. A missing thumbnail gives zeros.',
    '6. EXIF structure: entry counts of IFD0, Exif IFD, Interoperability IFD, IFD1 (thumbnail), GPS IFD, then number of extra IFDs, entries in extra IFDs and parser errors = 8 features. Independent of tag values such as Make/Model.',
    'Total = 192 + 90 + 2 + 284 + 8 = 576 features. The full-signature ID is a 64-bit hash of the 576-value vector.'
  ].forEach(t => p.line(t, 9));
  p.gap();
  p.line('Huffman Computation', 12, true);
  [
    'Feature of table t, length L:  f[t][L] = BITS_t[L], L = 1..15   (BITS_t is read directly from the 16 count bytes after the Tc/Th byte).',
    'Canonical code check (JPEG Annex C): code = 0; for L = 1..16 { first code of length L = code; code = (code + BITS[L]) << 1 }. A table is valid only if code never exceeds 2^L (Kraft inequality).',
    'Number of symbols of a table = sum of BITS[L]; HUFFVAL (the symbols) is not part of the 90 features but is included in the separate DHT hash.'
  ].forEach(t => p.line(t, 9));
  p.gap();
}
function pdfHuff(p, rows) {
  rows.forEach(r => {
    p.line(r.label + '  BITS[1..15] = [' + r.counts.join(' ') + ']  symbols(L<=15) = ' + r.total + '  Kraft valid: ' + (r.valid ? 'yes' : 'NO'), 9);
    p.line('   first canonical codes: ' + (r.first.join(', ') || '-'), 8);
  });
  p.gap();
}

function verifyPdf() {
  const v = lastVerify; if (!v) return;
  const p = pdfDoc(), s = v.sig;
  p.line('JPEG Signature Verification Report', 16, true);
  p.line('Generated: ' + new Date().toLocaleString('en-US'), 9); p.gap();
  p.line('File: ' + v.file); p.line('EXIF Claim: ' + (v.claimed || '-')); p.line('Software: ' + (v.tool || '-') + (v.edited ? '  [INDICATES EDITING]' : ''));
  p.line('Dimensions: ' + v.dims); p.line('DQT Signature: ' + (v.key || '-')); p.line('Full Signature (576 features): ' + s.qFull);
  p.line('Type / Subsampling: ' + (v.j.jpegType || '-') + ' / ' + (v.j.subsampling || '-')); p.gap();
  p.line('Conclusion (DQT): ' + v.title, 12, true); p.line(v.detail);
  p.line('Matching devices in catalog (DQT): ' + (v.matches.join(', ') || '-')); p.gap();
  p.line('Full-signature result: ' + s.fullText, 10, true);
  p.line('Native resolution: ' + s.nativeText, 9);
  p.line('IJG standard tables: ' + (s.ijg ? 'exact match Q' + s.ijg + ' (libjpeg-style encoder)' : 'no'), 9);
  p.line('Editing traces without Software tag: ' + (s.traces.length ? s.traces.join('; ') : 'none found (APP13/APP14 markers, XMP history, IJG tables)'), 9); p.gap();
  p.line('Signature Components', 12, true);
  s.compRows.forEach(r => p.line(r.label + ' [' + r.n + ' features] -> identical in catalog devices: ' + (r.devs.slice(0, 6).join('; ') || 'none') + (r.devs.length > 6 ? ' (+' + (r.devs.length - 6) + ' more)' : ''), 9));
  p.line('Thumbnail: ' + (s.th.present ? s.th.w + ' x ' + s.th.h : 'absent') + '   EXIF IFD counts [IFD0, Exif, Interop, IFD1, GPS, extra IFDs, extra entries, errors]: ' + s.exif.join(', '), 9); p.gap();
  pdfMethod(p);
  p.line('Huffman Tables of This Image', 12, true);
  pdfHuff(p, s.hRows);
  if (v.ex.thumb) p.img(v.ex.thumb, v.isPortrait ? 30 : 40, v.isPortrait ? 40 : 30);
  p.dqt(v.j.dqt);
  Object.entries(v.ex.params || {}).forEach(([k, val]) => p.line(k + ': ' + val, 9));
  p.doc.save('verification-' + v.file.replace(/\.[^.]+$/, '') + '.pdf');
}

function samplePdf(s) {
  if (!s) return;
  const groups = groupSignatures(), g = groups.byKey.get(s.dqtKey);
  const isPortrait = isSamplePortrait(s);
  const exifDesc = s.orientationExifTool || (isPortrait ? 'Rotate 90 CW' : 'Horizontal (normal)');
  const dispDim = s.displayDim || (isPortrait && s.width > s.height ? `${s.height} x ${s.width}` : `${s.width} x ${s.height}`);
  const th = s.thumbSig || {}, hRows = huffRows(s.huff), fKey = fullKeyOf(s);
  const p = pdfDoc();
  p.line('JPEG Forensic Sample Report (Repository Evidence)', 15, true);
  p.line('Generated: ' + new Date().toLocaleString('en-US'), 9); p.gap();
  if (s.thumb && s.thumb.startsWith('data:image/jpeg')) p.img(s.thumb, isPortrait ? 30 : 40, isPortrait ? 40 : 30);

  p.line('1. Evidence File & Device Identity', 12, true);
  [
    'File Path: ' + s.file,
    'Collection Folder: ' + (s.file.split('/')[1] || 'root'),
    'File Size: ' + (s.size ? s.size.toLocaleString('en-US') + ' bytes' : '-'),
    'Manufacturer (Make): ' + (s.make || '-'),
    'Resolved Model: ' + (s.model || '-'),
    ...(s.rawModel && s.rawModel !== s.model ? ['EXIF Model Code: ' + s.rawModel] : []),
    'Device Name: ' + (s.device || '-'),
    'Firmware / Software: ' + (s.software || '-')
  ].forEach(t => p.line(t, 9));
  p.gap();

  p.line('2. Camera Orientation (EXIF / TIFF)', 12, true);
  [
    'ExifTool Description: ' + exifDesc,
    'Is Horizontal (ExifTool): ' + (!isPortrait ? 'Yes — Horizontal / Landscape' : 'No (' + exifDesc + ') — Portrait'),
    'Display Category: ' + (isPortrait ? 'Portrait' : 'Landscape'),
    'EXIF Orientation Tag Value: ' + (s.orientationNum ? String(s.orientationNum) : '1 (Default)'),
    'TIFF/EXIF Classic Name: ' + (s.orientationClassic || 'Top-Left'),
    'Display Dimensions: ' + dispDim,
    'Native Sensor Dimensions (SOF): ' + s.width + ' x ' + s.height
  ].forEach(t => p.line(t, 9));
  p.gap();

  p.line('3. Compression Parameters & 576-Feature Signature', 12, true);
  const sharedDevs = g ? [...g.devices.keys()].sort().join('; ') : s.device;
  [
    'JPEG Type / Subsampling: ' + (s.jpegType || '-') + ' / ' + (s.subsampling || '-') + ' (' + (s.precision || 8) + ' bits)',
    'DHT Tables: ' + (s.dht ? s.dht.length : 0) + ' (hash ' + (s.dhtHash || '-') + ') | Restart Interval (DRI): ' + (s.dri || 0),
    'JPEG Markers (hex): ' + ((s.markers || []).join(' ') || '-'),
    'DQT Signature Hash (192 features): ' + (s.dqtKey || '-'),
    'Full Signature Hash (576 features): ' + fKey,
    'Signature Classification: ' + (g ? CAT_LABEL[g.cat] : 'Unique') + ' (shared across: ' + sharedDevs + ')',
    'Estimated IJG Quality: ' + qualityText(s.dqt),
    'Embedded Thumbnail (284 features): ' + (th.present ? th.w + ' x ' + th.h : 'absent (zeros)'),
    'EXIF IFD Entry Counts [IFD0, Exif, Interop, IFD1, GPS, extra IFDs, extra entries, errors]: ' + ((s.exifStruct || []).join(', ') || '-')
  ].forEach(t => p.line(t, 9));
  p.gap();

  p.line('4. Camera Shooting Metadata (EXIF)', 12, true);
  const exifEntries = Object.entries(s.exif || {});
  if (exifEntries.length) exifEntries.forEach(([k, val]) => p.line(k + ': ' + val, 9));
  else p.line('(No additional EXIF shooting tags recorded)', 9);
  p.gap();

  p.line('5. 8x8 DQT Quantization Matrices (192 features)', 12, true);
  p.dqt(s.dqt);
  p.gap();

  p.line('6. Huffman Tables (DHT): BITS[1..15] Code-Length Counts (90 features)', 12, true);
  pdfHuff(p, hRows);
  pdfMethod(p);

  const baseName = s.file.split('/').pop().replace(/\.[^.]+$/, '');
  p.doc.save('sample-forensic-' + baseName + '.pdf');
}

function devicePdf(dev) {
  const arr = samples.filter(s => s.device === dev);
  if (!arr.length) return;
  const groups = groupSignatures(), p = pdfDoc();
  p.line('Device Forensic Profile & Sample Inventory: ' + dev, 15, true);
  p.line('Generated: ' + new Date().toLocaleString('en-US'), 9);
  const dqtKeys = [...new Set(arr.map(s => s.dqtKey))];
  const fullKeys = [...new Set(arr.map(s => fullKeyOf(s)))];
  p.line(`Total Samples: ${arr.length} | Distinct DQT Signatures: ${dqtKeys.length} | Distinct 576-Feature Signatures: ${fullKeys.length}`, 9);
  p.gap();

  p.line('1. Quantization & Huffman Profile Summary', 12, true);
  dqtKeys.forEach(k => {
    const g = groups.byKey.get(k);
    const rep = arr.find(s => s.dqtKey === k);
    p.line(`DQT Key: ${k} | Category: ${g ? CAT_LABEL[g.cat] : 'Unique'} | Quality: ${qualityText(rep.dqt)} | Samples: ${arr.filter(s => s.dqtKey === k).length}`, 9, true);
    p.dqt(rep.dqt);
  });
  p.line('Representative Huffman Tables (BITS[1..15]):', 11, true);
  pdfHuff(p, huffRows(arr[0].huff));

  p.line('2. Complete Sample Inventory (' + arr.length + ' files)', 12, true);
  arr.forEach((s, i) => {
    const isP = isSamplePortrait(s);
    const exifDesc = s.orientationExifTool || (isP ? 'Rotate 90 CW' : 'Horizontal (normal)');
    const th = s.thumbSig || {};
    p.line(`${i + 1}. ${s.file}`, 9, true);
    p.line(`   Size: ${s.size || '-'} B | Sensor: ${s.width}x${s.height} | Orientation: ${isP ? 'Portrait' : 'Landscape'} (${exifDesc}) | Software: ${s.software || '-'}`, 8);
    p.line(`   DQT(192): ${s.dqtKey} | Full(576): ${fullKeyOf(s)} | Thumb: ${th.present ? th.w + 'x' + th.h : 'none'} | EXIF IFDs: ${(s.exifStruct || []).join(',')}`, 8);
  });
  p.gap();
  pdfMethod(p);
  p.doc.save('device-' + dev.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf');
}

function catalogPdf() {
  const groups = groupSignatures(), p = pdfDoc();
  p.line('JPEG Signature Catalog & Repository Evidence Report', 16, true);
  p.line('Generated: ' + new Date().toLocaleString('en-US'), 9);
  p.line(`Samples: ${samples.length} | Devices: ${new Set(samples.map(s => s.device)).size} | DQT signature families: ${groups.size}`); p.gap();
  p.line('Equivalence Class Analysis', 12, true);
  p.line('Class size n = number of devices (Make + Model) sharing one signature.', 9);
  EQ_SETS.forEach(([l, f]) => {
    const st = eqStats(f);
    p.line(`${l}: classes ${st.classes} | n=1: ${st.dist[0]}, n=2: ${st.dist[1]}, n=3: ${st.dist[2]}, n=4: ${st.dist[3]}, n>=5: ${st.dist[4]} | median n ${st.median} | max n ${st.max} | devices uniquely identified ${st.uniq}/${st.devs}`, 9);
  });
  const cs = configStats();
  p.line(`Configurations (device + full signature) with >= ${MIN_CONFIG_SAMPLES} samples: ${cs.ok} of ${cs.total}`, 9); p.gap();
  pdfMethod(p);
  ['unique', 'same', 'multi'].forEach(c => {
    p.line(CAT_LABEL[c], 12, true);
    const l = [...groups.values()].filter(g => g.cat === c);
    if (!l.length) p.line('(empty)', 9);
    l.forEach(g => p.line(g.key + '  ->  ' + [...g.devices.keys()].sort().join('; '), 9));
    p.gap();
  });
  p.line('Repository Sample Inventory (' + samples.length + ' files)', 12, true);
  samples.forEach((s, i) => {
    const isP = isSamplePortrait(s);
    const exifDesc = s.orientationExifTool || (isP ? 'Rotate 90 CW' : 'Horizontal (normal)');
    const th = s.thumbSig || {};
    p.line(`${i + 1}. ${s.file} [${s.device}]`, 8, true);
    p.line(`   Sensor: ${s.width}x${s.height} | ${isP ? 'Portrait' : 'Landscape'} (${exifDesc}) | DQT: ${s.dqtKey} | Full(576): ${fullKeyOf(s)} | Thumb: ${th.present ? th.w + 'x' + th.h : 'none'} | IFDs: ${(s.exifStruct || []).join(',')}`, 8);
  });
  p.doc.save('signature-catalog.pdf');
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
    if (!Array.isArray(arr) || arr.some(s => !s.id || !s.dqtKey || !s.dqt)) throw new Error('Invalid signature format');
    const ids = new Set(samples.map(s => s.id));
    const fresh = arr.filter(s => !ids.has(s.id));
    await DB.putMany(fresh); samples = samples.concat(fresh); renderAll();
    toast(`Import: ${fresh.length} new samples (${arr.length - fresh.length} duplicates skipped)`);
  } catch (e) { toast('Import failed: ' + e.message); }
}
/* Merge the bundled dataset into the local repository. Bundled records overwrite local copies with the same
 * file path, so newly added signature fields (Huffman, thumbnail, EXIF structure) reach existing IndexedDB data. */
async function loadBundled(url = 'signatures.json', replace = false) {
  let d = window.DEFAULT_SIGNATURES || null;
  if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
    try {
      const r = await fetch((url || 'signatures.json') + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const live = await r.json();
        if (!d || (live && live.samples && (!d.samples || live.samples.length >= d.samples.length || (live.build || 0) >= (d.build || 0)))) {
          d = live;
          window.DEFAULT_SIGNATURES = live;
        }
      }
    } catch (e) { /* fallback to DEFAULT_SIGNATURES */ }
  }
  if (!d) { toast(`Failed to load ${url}`); return 0; }
  if (replace) { await DB.clear(); samples = []; }
  const map = new Map();
  (samples || []).forEach(s => map.set(s.file || s.id, s));
  (d.samples || []).forEach(n => {
    const key = n.file || n.id, ex = map.get(key);
    if (ex) Object.assign(ex, n, { bundled: true });
    else { n.bundled = true; map.set(key, n); }
  });
  samples = Array.from(map.values());
  await DB.putMany(samples);
  renderAll();
  return samples.length;
}

/* Automatically discover newly added folders/files under images/ when running on a local HTTP server with directory listing */
async function autoDiscoverImagesFolder() {
  if (typeof location === 'undefined' || !/^https?:/.test(location.protocol)) return 0;
  const parseHrefList = html => [...html.matchAll(/href=["']([^"'?#]+)["']/gi)].map(m => decodeURIComponent(m[1])).filter(h => h && !h.startsWith('..') && !h.startsWith('/') && !h.startsWith('http'));
  try {
    const res = await fetch('images/?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return 0;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return 0;
    const rootHtml = await res.text();
    const entries = parseHrefList(rootHtml);
    const knownFiles = new Set((samples || []).map(s => s.file));
    const discovered = [];
    for (const entry of entries) {
      const clean = entry.replace(/\/+$/, '');
      if (!clean || clean.startsWith('.')) continue;
      if (/\.(jpe?g|jfif)$/i.test(clean)) {
        const rel = 'images/' + clean;
        if (!knownFiles.has(rel)) discovered.push(rel);
      } else {
        try {
          const subRes = await fetch('images/' + encodeURIComponent(clean) + '/?t=' + Date.now(), { cache: 'no-store' });
          if (subRes.ok && (subRes.headers.get('content-type') || '').includes('text/html')) {
            const subFiles = parseHrefList(await subRes.text());
            for (const sf of subFiles) {
              const sfName = sf.split('/').pop();
              if (/\.(jpe?g|jfif)$/i.test(sfName) && !sfName.startsWith('.')) {
                const rel = `images/${clean}/${sfName}`;
                if (!knownFiles.has(rel)) discovered.push(rel);
              }
            }
          }
        } catch (e) { /* ignore subfolder error */ }
      }
    }
    if (!discovered.length) return 0;
    const fresh = [];
    for (const relPath of discovered) {
      try {
        const r = await fetch(relPath);
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        const it = await analyze(relPath, buf, buf.byteLength);
        if (it.status === 'accepted' && it.rec) {
          const chk = it.rec.exifChecksum;
          if (chk && samples.some(s => (s.exifChecksum || s.exifHash) === chk)) continue;
          it.rec.bundled = true;
          fresh.push(it.rec);
        }
      } catch (e) { /* skip unreadable file */ }
    }
    if (fresh.length) {
      await DB.putMany(fresh);
      samples = samples.concat(fresh);
      renderAll();
      toast(`Auto-discovered ${fresh.length} new image(s) from images/ folder`);
    }
    return fresh.length;
  } catch (e) {
    return 0;
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
  $('#ingestBody').onclick = e => {
    const tr = e.target.closest('tr[data-ingest-idx]');
    if (!tr) return;
    const item = staged[Number(tr.dataset.ingestIdx)];
    if (item && item.rec && item.rec.dqt) {
      $('#modalTitle').textContent = item.name.split('/').pop();
      $('#modalBody').innerHTML = sampleDetailHtml(item.rec);
      $('#photoModal').style.display = 'flex';
    }
  };
  $('#btnAddAccepted').onclick = async () => {
    const ids = new Set((samples || []).map(s => s.id));
    const exSet = new Set((samples || []).map(s => s.exifChecksum || s.exifHash).filter(Boolean));
    const fresh = [];
    staged.forEach(s => {
      if (s.status === 'accepted' && s.rec && !ids.has(s.rec.id) && !exSet.has(s.rec.exifChecksum)) {
        ids.add(s.rec.id);
        if (s.rec.exifChecksum) exSet.add(s.rec.exifChecksum);
        fresh.push(s.rec);
      }
    });
    if (fresh.length) {
      await DB.putMany(fresh);
      samples = samples.concat(fresh);
      renderAll();
      toast(`${fresh.length} samples saved to repository`);
    } else {
      toast('No new samples to save (all duplicates or already in repository)');
    }
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
  $('#btnReset').onclick = async () => { if (confirm('Replace local repository with default signatures.json?')) { const n = await loadBundled('signatures.json', true); toast(`Loaded ${n} samples from signatures.json`); } };
  $('#btnClear').onclick = async () => { if (confirm('Clear the entire local repository?')) { await DB.clear(); samples = []; renderAll(); } };
  $('#btnCatalogPdf').onclick = catalogPdf;
  $('#inVerify').onchange = e => { if (e.target.files[0]) verify(e.target.files[0]); e.target.value = ''; };
  $('#verifyResult').onclick = async e => {
    if (e.target.id === 'btnVerifyPdf') verifyPdf();
    if (e.target.id === 'btnVerifyRegister' && lastVerify && lastVerify.qRec) {
      const rec = lastVerify.qRec;
      const isDup = samples.some(s => s.id === rec.id || (s.exifChecksum && rec.exifChecksum && s.exifChecksum === rec.exifChecksum));
      if (isDup) {
        toast('Duplicate: this image or its EXIF checksum already exists in catalog');
        e.target.disabled = true;
        e.target.textContent = 'Already in Catalog (Duplicate)';
      } else {
        await DB.putMany([rec]);
        samples.push(rec);
        renderAll();
        toast(`Registered ${rec.device} (${rec.dqtKey}) in catalog`);
        e.target.disabled = true;
        e.target.textContent = `Registered ${rec.device} in Catalog`;
      }
    }
  };

  // Global handler for per-sample PDF and per-device PDF buttons across all views/modals
  document.addEventListener('click', e => {
    const pdfBtn = e.target.closest('[data-sample-pdf]');
    if (pdfBtn) {
      e.stopPropagation();
      const id = pdfBtn.dataset.samplePdf;
      const found = samples.find(s => s.id === id) || (staged.map(x => x.rec).find(r => r && r.id === id));
      if (found) samplePdf(found);
      return;
    }
    const devPdfBtn = e.target.closest('[data-dev-pdf]');
    if (devPdfBtn) {
      e.stopPropagation();
      devicePdf(devPdfBtn.dataset.devPdf);
    }
  });

  // Gallery events
  $('#galSearch').oninput = renderGallery;
  $('#galFilterDev').onchange = renderGallery;
  $('#galFilterFolder').onchange = renderGallery;
  if ($('#galFilterOri')) $('#galFilterOri').onchange = renderGallery;
  $('#galGrid').onclick = e => {
    if (e.target.closest('[data-sample-pdf]')) return;
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
    toast('IndexedDB is not available; data is stored in memory only');
    DB.putMany = DB.clear = async () => {};
    DB.tx = async () => {};
  }

  // Check if database is empty, has legacy thumbnails, or if signatures.json has newer/more samples
  await loadBundled('signatures.json', false);
  const bundle = window.DEFAULT_SIGNATURES;
  if (bundle && bundle.build) {
    try { localStorage.setItem('jsa-build', String(bundle.build)); } catch (e) { /* ignore */ }
  }
  await autoDiscoverImagesFolder();
})();
