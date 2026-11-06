'use strict';

const fs = require('fs');
const path = require('path');

// Ensure ExifReader and huffman.js formulas are available
const ExifReader = require('../../vendor/exif-reader.js');
require('../../huffman.js');

/* ---------------- Device Normalization & Model Resolvers ---------------- */
const MAKE_ALIAS = {
  EASTMAN: 'KODAK', HEWLETT: 'HP', 'HEWLETT-PACKARD': 'HP', FUJI: 'FUJIFILM',
  LGE: 'LG', MINOLTA: 'KONICA', ASUSTEK: 'ASUS', ONEPLUS: 'ONEPLUS',
  'SONY-ERICSSON': 'SONY', SONYERICSSON: 'SONY', RESEARCH: 'BLACKBERRY',
  BBK: 'VIVO', TECNO: 'TECNO', INFINIX: 'INFINIX'
};

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
  'SM-A566B': 'Galaxy A56 5G (SM-A566B)',
  'SM-A556E': 'Galaxy A55 5G (SM-A556E)',
  'SM-A546E': 'Galaxy A54 5G (SM-A546E)',
  'SM-A536E': 'Galaxy A53 5G (SM-A536E)',
  'SM-A528B': 'Galaxy A52s 5G (SM-A528B)',
  'SM-A356E': 'Galaxy A35 5G (SM-A356E)',
  'SM-A346E': 'Galaxy A34 5G (SM-A346E)',
  'SM-A066B': 'Galaxy A06 5G (SM-A066B)'
};

const DEVICE_CODE_MODELS = {
  'M2103K19G': 'Redmi Note 10 5G (M2103K19G)',
  '23049PCD8G': 'POCO F5 (23049PCD8G)',
  '21061110AG': '11T (21061110AG)',
  'V2149': 'Y35 (V2149)'
};

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

function titleMake(m) {
  if (!m) return '';
  return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
}

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

function parseOrientation(val, w = 0, h = 0) {
  const s = String(val || '').toLowerCase().trim();
  const num = parseInt(s, 10);
  let base = (!isNaN(num) && ORIENTATION_MAP[num]) ? ORIENTATION_MAP[num] : null;
  if (!base) {
    if (s.includes('rotate 90') || s.includes('90 cw') || s.includes('right-top')) base = ORIENTATION_MAP[6];
    else if (s.includes('rotate 270') || s.includes('270 cw') || s.includes('left-bottom')) base = ORIENTATION_MAP[8];
    else if (s.includes('rotate 180') || s.includes('180') || s.includes('bottom-right')) base = ORIENTATION_MAP[3];
    else if (s.includes('horizontal') || s.includes('top-left')) base = ORIENTATION_MAP[1];
    else if (h > w && w > 0) base = ORIENTATION_MAP[6];
    else base = ORIENTATION_MAP[1];
  }
  return { ...base };
}

function readExif(buf) {
  const r = { tags: {}, params: {}, make: '', model: '', software: '', xmpTool: '' };
  try {
    const t = ExifReader.load(buf, { expanded: true });
    for (const g of ['file', 'exif', 'gps']) Object.assign(r.tags, t[g] || {});
    const d = k => r.tags[k] && (r.tags[k].description ?? r.tags[k].value);
    r.make = String(d('Make') || '').trim();
    r.model = String(d('Model') || '').trim();
    r.software = String(d('Software') || '').trim();
    r.xmpTool = t.xmp && t.xmp.CreatorTool ? String(t.xmp.CreatorTool.value || t.xmp.CreatorTool.description || '') : '';
    [['ExposureTime', 'Exposure'], ['FNumber', 'F-Number'], ['ISOSpeedRatings', 'ISO'], ['FocalLength', 'Focal Length'],
     ['FocalLengthIn35mmFilm', 'Focal 35mm'], ['LensModel', 'Lens'], ['DateTimeOriginal', 'Date/Time Original'], ['Flash', 'Flash'],
     ['Orientation', 'Orientation'], ['ColorSpace', 'Color Space'], ['PixelXDimension', 'EXIF Width'], ['PixelYDimension', 'EXIF Height']]
      .forEach(([k, label]) => { const v = d(k); if (v !== undefined && v !== '') r.params[label] = String(v); });
  } catch (e) { r.err = String(e.message || e); }
  return r;
}

/* ---------------- Analyze Single JPEG Image ---------------- */
function analyzeImage(name, buf, size = 0) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof ArrayBuffer)) {
    throw new TypeError('Expected Buffer or ArrayBuffer');
  }
  const ab = Buffer.isBuffer(buf) ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) : buf;
  const byteLength = size || buf.byteLength || buf.length;
  const j = parseJpeg(ab);
  if (!j.valid) {
    return {
      valid: false,
      name,
      file: name,
      size: byteLength,
      error: 'Not a valid JPEG file (header FF D8 FF not found or missing DQT tables)'
    };
  }

  const ex = readExif(ab);
  const rawW = j.sof ? j.sof.width : 0, rawH = j.sof ? j.sof.height : 0;
  const ori = (ex.params && (ex.params['Orientation'] || ex.params['Orientasi'])) || '';
  const oInfo = parseOrientation(ori, rawW, rawH);
  const isPortrait = oInfo.category === 'Portrait';
  const dispW = isPortrait && rawW > rawH ? rawH : rawW;
  const dispH = isPortrait && rawW > rawH ? rawW : rawH;
  const tool = [ex.software, ex.xmpTool].filter(Boolean).join(' / ');
  const { make, model, rawModel, device } = resolveDeviceMeta(ex.make, ex.model, tool);
  const es = exifStruct(ab), th = thumbSigOf(es, ab);

  const qRec = {
    id: name + '|' + byteLength + '|' + j.dqtKey,
    file: name,
    size: byteLength,
    format: 'JPEG',
    make,
    model,
    rawModel: rawModel || model,
    device,
    software: tool,
    width: rawW,
    height: rawH,
    displayWidth: dispW,
    displayHeight: dispH,
    displayDim: dispW + ' × ' + dispH,
    orientationNum: oInfo.num,
    orientationClassic: oInfo.classic,
    orientationExifTool: oInfo.exifTool,
    orientationCategory: oInfo.category,
    orientationLabel: oInfo.label,
    orientationDeg: oInfo.deg,
    isPortrait,
    dqtKey: j.dqtKey,
    dqt: j.dqt,
    jpegType: j.jpegType || '',
    subsampling: j.subsampling || '',
    precision: j.sof ? j.sof.precision : 0,
    dht: j.dht,
    dhtHash: j.dhtHash,
    dri: j.dri,
    markers: j.markers.map(m => m.toString(16).toUpperCase()),
    exif: ex.params || {},
    huff: j.huff,
    exifStruct: es.counts,
    thumbSig: th,
    exifChecksum: exifChecksum(ex),
    exifHash: exifChecksum(ex)
  };
  qRec.fullKey = fullKeyOf(qRec);

  const edited = EDITORS.test(tool);
  const traces = editTraces(j, es, tool);

  return {
    valid: true,
    rec: qRec,
    j,
    ex,
    es,
    th,
    tool,
    edited,
    traces,
    isFlickrResize: isFlickrResize(rawW, rawH)
  };
}

/* ---------------- Match Analyzed Query Record against Catalog ---------------- */
function matchRecord(qRec, rawAnalysis, catalogSamples) {
  const samples = Array.isArray(catalogSamples) ? catalogSamples : [];
  const groups = groupSignatures(samples);
  const claimed = qRec.device;
  const make = qRec.make;
  const model = qRec.model;
  const rawModel = qRec.rawModel;
  const tool = qRec.software;
  const edited = rawAnalysis.edited;
  const traces = rawAnalysis.traces || [];
  const j = rawAnalysis.j;
  const es = rawAnalysis.es;
  const th = rawAnalysis.th;

  // 1. Full 576-feature component comparison
  const qParts = sigParts(qRec), qFull = qRec.fullKey;
  const catSigs = samples.map(s => ({ s, parts: sigParts(s), full: fullKeyOf(s) }));
  const compRows = qParts.map((p, i) => {
    const k = p.vals.join(','), devs = new Set(), makes = new Set();
    catSigs.forEach(c => { if (c.parts[i].vals.join(',') === k) { devs.add(c.s.device); makes.add(c.s.make); } });
    return { label: p.label, n: p.vals.length, devs: [...devs].sort(), makes: [...makes] };
  });
  const fullDevs = [...new Set(catSigs.filter(c => c.full === qFull).map(c => c.s.device))].sort();
  const claimedKnown = !!(claimed && samples.some(s => s.device === claimed || (rawModel && s.rawModel === rawModel)));

  // 2. Native resolution sensor check
  const dimKey = Math.min(qRec.width, qRec.height) + 'x' + Math.max(qRec.width, qRec.height);
  const natSet = new Set(samples.filter(s => s.device === claimed).map(s => Math.min(s.width, s.height) + 'x' + Math.max(s.width, s.height)));
  const nativeText = isFlickrResize(qRec.width, qRec.height)
    ? 'Flickr resize derivative (re-compressed)'
    : !claimed ? '-'
    : !natSet.size ? `New model (${claimed} not yet in catalog; sensor ${qRec.width}×${qRec.height})`
    : natSet.has(dimKey) ? 'Seen in catalog for claimed device'
    : 'NOT seen in catalog for claimed device (possible resize / converter)';

  // 3. Hierarchical DQT Distance & Nearest Candidate Ranking
  const cands = new Map();
  let nearestKey = null, nearestD = Infinity;
  if (j.dqtKey && groups.exact) {
    groups.exact.forEach(e => {
      const d = e.key === j.dqtKey ? 0 : dqtDist(j.dqt, e.dqt);
      if (d < nearestD) { nearestD = d; nearestKey = e.key; }
      e.samples.forEach(s => {
        const c = cands.get(s.device);
        if (!c || d < c.d) cands.set(s.device, { d, make: s.make });
      });
    });
  }
  const ranked = [...cands.entries()]
    .map(([device, data]) => ({ device, make: data.make, distance: data.d, similarity: simPct(data.d) }))
    .sort((a, b) => a.distance - b.distance);

  // 4. Exact vs. Near Adaptive Cluster Lookup
  let g = groups.byKey.get(j.dqtKey), matchType = g ? 'exact' : null;
  if (!g && nearestKey && nearestD <= NEAR) {
    g = groups.byKey.get(nearestKey);
    matchType = 'near';
  }
  const nearNote = matchType === 'near' ? ` (similar variant, distance ${nearestD.toFixed(2)})` : '';
  const matches = g ? [...g.devices.entries()].map(([d, m]) => ({ device: d, make: m })) : [];

  // 5. Forensic Verdict Decision Tree
  let level, verdict, title, detail;
  if (!j.dqtKey) {
    level = 'warn'; verdict = 'NO_DQT'; title = 'No DQT tables found';
    detail = 'Compression signature could not be extracted from the JPEG stream.';
  } else if (!samples.length) {
    level = 'info'; verdict = 'CATALOG_EMPTY'; title = 'Catalog is empty';
    detail = 'The reference signature catalog contains 0 samples. Load signatures.json first.';
  } else if (!g) {
    const near = ranked[0] ? `${ranked[0].device} (distance ${ranked[0].distance.toFixed(2)}, ${ranked[0].similarity.toFixed(1)}% similarity)` : '-';
    if (claimedKnown) {
      const dc = cands.get(claimed) ? cands.get(claimed).d : Infinity;
      if (dc <= CLOSE) {
        level = 'warn'; verdict = 'SIMILAR_VARIANT';
        title = 'SIMILAR but not identical to claimed device signature';
        detail = `EXIF claims ${claimed}; nearest DQT distance is ${dc.toFixed(2)}. Possible new quantization variant or reprocessed image. Closest candidate: ${near}.`;
      } else {
        level = 'bad'; verdict = 'MISMATCH_KNOWN_DEVICE';
        title = 'MISMATCH — signature does not match EXIF claim';
        detail = `EXIF claims ${claimed}, which exists in the catalog, but its distance is ${dc.toFixed(2)} from this image signature. Closest candidate: ${near}.`;
      }
    } else if (claimed && ranked[0] && ranked[0].make === make && ranked[0].distance <= CLOSE) {
      level = 'ok'; verdict = 'AUTHENTIC_NEW_MODEL';
      title = `AUTHENTIC ${make} ENCODER PROFILE — ${claimed} (New Model)`;
      detail = `EXIF model ${claimed}${rawModel && rawModel !== model ? ' [' + rawModel + ']' : ''} (Firmware: ${tool || '-'}) is a valid ${titleMake(make)} device not yet in the catalog. Its DQT profile closely matches ${ranked[0].device} (distance ${ranked[0].distance.toFixed(2)}, ${ranked[0].similarity.toFixed(1)}% similarity).`;
    } else {
      level = 'info'; verdict = 'NEW_SIGNATURE';
      title = `New Device Signature — ${claimed || 'Unknown Model'}`;
      detail = `Model ${claimed || '-'} is not yet in the catalog. Closest catalog candidate: ${near}.`;
    }
  } else if (!claimed) {
    level = 'info'; verdict = 'MATCH_NO_EXIF';
    title = 'Candidate device found (EXIF Make/Model empty)' + nearNote;
    detail = `Signature matches the devices: ${matches.map(m => m.device).join(', ')}.`;
  } else if (g.devices.has(claimed)) {
    const isUniq = g.devices.size === 1;
    level = isUniq ? 'ok' : 'warn';
    verdict = isUniq ? 'MATCH_UNIQUE' : 'MATCH_SHARED';
    title = (isUniq ? 'MATCH — signature consistent with EXIF claim' : 'Consistent with EXIF claim, but signature is shared') + nearNote;
    detail = isUniq
      ? `Signature is verified exclusively for ${claimed}.`
      : `Signature is shared across ${g.devices.size} devices (${matches.map(m => m.device).join(', ')}), so identification is not definitive.`;
  } else if ([...g.devices.values()].includes(make) && !claimedKnown && matchType === 'near') {
    level = 'ok'; verdict = 'AUTHENTIC_FAMILY_ADAPTIVE';
    title = `AUTHENTIC ${make} ENCODER FAMILY — ${claimed} (Model Analyzed)` + nearNote;
    detail = `Detected ${claimed}${rawModel && rawModel !== model ? ' [EXIF code: ' + rawModel + ']' : ''} (Firmware: ${tool || '-'}). This model is not yet in the catalog, but its DQT matrix (${simPct(nearestD).toFixed(1)}% similarity, distance ${nearestD.toFixed(2)}) and Huffman tables match the ${titleMake(make)} hardware encoder family (${matches.map(m => m.device).join(', ')}).`;
  } else if ([...g.devices.values()].includes(make)) {
    level = 'warn'; verdict = 'SAME_MAKE_DIFFERENT_MODEL';
    title = 'SAME MANUFACTURER, DIFFERENT MODEL' + nearNote;
    detail = `EXIF claims ${claimed}, while the catalog signature is registered to ${matches.map(m => m.device).join(', ')} (${titleMake(make)}).`;
  } else {
    level = 'bad'; verdict = 'MISMATCH_BRAND';
    title = 'MISMATCH — EXIF claim differs from compression signature' + nearNote;
    detail = `EXIF claims ${claimed}, but the DQT signature matches a completely different device (${matches.map(m => m.device).join(', ')}).`;
  }

  // Full-signature text
  let fullLevel, fullText;
  if (!samples.length) { fullLevel = 'info'; fullText = 'Catalog is empty.'; }
  else if (!fullDevs.length) { fullLevel = 'info'; fullText = claimed && !claimedKnown ? `Model ${claimed} is not yet registered in catalog.` : 'No catalog sample shares the complete 576-feature signature.'; }
  else if (claimed && !fullDevs.includes(claimed)) { fullLevel = 'bad'; fullText = `Full signature matches ${fullDevs.join('; ')}, but EXIF claims ${claimed}.`; }
  else if (claimed) { fullLevel = fullDevs.length === 1 ? 'ok' : 'warn'; fullText = fullDevs.length === 1 ? `Full signature matches only ${claimed}.` : `Full signature matches ${claimed} but is shared with: ${fullDevs.filter(d => d !== claimed).join('; ')}.`; }
  else { fullLevel = 'info'; fullText = `Full signature matches: ${fullDevs.join('; ')}.`; }

  const ijg = ijgMatch(j.dqt);
  const dupMatch = samples.find(s => (s.exifChecksum && s.exifChecksum === qRec.exifChecksum) || s.id === qRec.id);

  return {
    valid: true,
    file: qRec.file,
    size: qRec.size,
    duplicate: {
      isDuplicate: Boolean(dupMatch),
      duplicateOf: dupMatch ? (dupMatch.file || dupMatch.id) : null,
      exifChecksum: qRec.exifChecksum
    },
    claimed: {
      make,
      model,
      rawModel,
      device: claimed,
      software: tool,
      firmware: tool,
      dimensions: `${qRec.width} × ${qRec.height} (${qRec.isPortrait ? 'Portrait' : 'Landscape'})`,
      orientation: qRec.orientationExifTool
    },
    signatures: {
      dqtKey: qRec.dqtKey,
      fullKey: qRec.fullKey,
      exifChecksum: qRec.exifChecksum,
      dhtHash: qRec.dhtHash,
      estimatedQuality: qualityText(j.dqt),
      subsampling: qRec.subsampling,
      jpegType: qRec.jpegType,
      thumbnailPresent: Boolean(th.present),
      exifIFDCounts: es.counts,
      ijgStandardTable: ijg ? `Q${ijg}` : null
    },
    tampering: {
      edited,
      traces,
      isFlickrResize: rawAnalysis.isFlickrResize,
      nativeResolutionText: nativeText
    },
    verdict: {
      level,
      code: verdict,
      title,
      detail,
      matchType: matchType || (ranked[0] && ranked[0].distance <= CLOSE ? 'close_candidate' : 'new_signature'),
      matchedDevices: matches.map(m => m.device),
      nearestDistance: nearestD === Infinity ? null : nearestD,
      fullSignature: {
        level: fullLevel,
        text: fullText,
        matchingDevices: fullDevs
      }
    },
    rankedCandidates: ranked.slice(0, 8),
    componentComparison: compRows.map(r => ({
      component: r.label,
      featuresCount: r.n,
      matchingCatalogDevices: r.devs,
      claimedDeviceStatus: !claimed ? '-' : r.devs.includes(claimed) ? 'exact match' : (!claimedKnown && r.makes.includes(make)) ? `same make (${titleMake(make)})` : !claimedKnown ? 'new model' : 'differs'
    })),
    huffmanRows: huffRows(j.huff),
    dqt: j.dqt,
    queryRecord: qRec
  };
}

/* ---------------- High-Level API ---------------- */
function matchFile(filePath, catalogPathOrArray = null) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
  const buf = fs.readFileSync(fullPath);
  const relName = path.relative(process.cwd(), fullPath);
  const analysis = analyzeImage(relName, buf, buf.length);
  if (!analysis.valid) return analysis;

  let samples = [];
  if (Array.isArray(catalogPathOrArray)) {
    samples = catalogPathOrArray;
  } else {
    const defaultCatalogPath = catalogPathOrArray
      ? path.resolve(process.cwd(), catalogPathOrArray)
      : path.join(__dirname, '../../signatures.json');
    if (fs.existsSync(defaultCatalogPath)) {
      try {
        const cat = JSON.parse(fs.readFileSync(defaultCatalogPath, 'utf8'));
        samples = cat.samples || [];
      } catch (e) {}
    }
  }

  return matchRecord(analysis.rec, analysis, samples);
}

function matchBuffer(name, buf, catalogSamples = []) {
  const analysis = analyzeImage(name, buf, buf.length);
  if (!analysis.valid) return analysis;
  return matchRecord(analysis.rec, analysis, catalogSamples);
}

module.exports = {
  analyzeImage,
  matchRecord,
  matchFile,
  matchBuffer,
  resolveDeviceMeta,
  normMake,
  normModel,
  parseOrientation,
  ORIENTATION_MAP,
  SAMSUNG_MODELS,
  DEVICE_CODE_MODELS
};
