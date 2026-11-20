// Build signatures.json from all JPEGs in images/ directory (run: node tools/dataset/build-signatures.js)
const fs = require('fs'), path = require('path');
const ROOT_DIR = path.resolve(__dirname, '../..');

global.window = global;
global.ExifReader = require(path.join(ROOT_DIR, 'vendor/exif-reader.js'));
require(path.join(ROOT_DIR, 'huffman.js'));
let src = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
src = src.slice(0, src.indexOf('const isJpegName'))
  .replace(/^const \$ =.*$/m, '').replace(/^const esc =.*$/m, '')
  .replace(/^let (samples|staged|lastVerify).*$/gm, '');
eval(src + ';global.analyze=analyze;global.parseOrientation=parseOrientation;global.ORIENTATION_MAP=ORIENTATION_MAP;');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jpe?g|jfif)$/i.test(e.name) ? [path.join(d, e.name)] : []);

// Strip APP1 Exif from the already-rotated sips thumbnail so browsers do not apply EXIF Orientation a second time
function stripExifApp1(u8) {
  if (u8[0] !== 0xFF || u8[1] !== 0xD8) return u8;
  const chunks = [u8.subarray(0, 2)];
  let p = 2, n = u8.length;
  while (p + 4 <= n && u8[p] === 0xFF) {
    const m = u8[p + 1];
    if (m === 0xDA || m === 0xD9) { chunks.push(u8.subarray(p)); break; }
    const len = (u8[p + 2] << 8) | u8[p + 3], end = Math.min(p + 2 + len, n);
    const isExif = m === 0xE1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66;
    if (!isExif) chunks.push(u8.subarray(p, end));
    p = end;
  }
  return Buffer.concat(chunks);
}
(async () => {
  const sigPath = path.join(ROOT_DIR, 'signatures.json');
  const prevThumb = new Map();
  if (fs.existsSync(sigPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
      for (const s of (prev.samples || [])) {
        if (s.file && s.thumb && s.thumbSrc === 'GENERATED_COLOR_ROTATED') {
          prevThumb.set(s.file + '|' + s.size + '|' + (s.orientationDeg || 0), s.thumb);
        }
      }
    } catch (e) {}
  }

  const root = path.join(ROOT_DIR, 'images'), out = [], rej = [];
  for (const f of walk(root).sort()) {
    const b = fs.readFileSync(f);
    const rel = path.relative(ROOT_DIR, f);
    const it = await analyze(rel, b.buffer.slice(b.byteOffset, b.byteOffset + b.length), b.length);
    if (it.rec && it.status === 'accepted') {
      const ori = (it.rec.exif && (it.rec.exif['Orientation'] || it.rec.exif['Orientasi'])) || '';
      const oInfo = parseOrientation(ori, it.rec.width, it.rec.height);
      it.rec.orientationNum = oInfo.num;
      it.rec.orientationClassic = oInfo.classic;
      it.rec.orientationExifTool = oInfo.exifTool;
      it.rec.orientationCategory = oInfo.category;
      it.rec.orientationLabel = oInfo.label;
      it.rec.orientationDeg = oInfo.deg;
      it.rec.isPortrait = oInfo.category === 'Portrait';
      
      const rawW = it.rec.width, rawH = it.rec.height;
      it.rec.displayWidth = it.rec.isPortrait && rawW > rawH ? rawH : rawW;
      it.rec.displayHeight = it.rec.isPortrait && rawW > rawH ? rawW : rawH;
      it.rec.displayDim = `${it.rec.displayWidth} × ${it.rec.displayHeight}`;

      // Check cache first
      const cacheKey = it.rec.file + '|' + it.rec.size + '|' + it.rec.orientationDeg;
      if (prevThumb.has(cacheKey)) {
        it.rec.thumb = prevThumb.get(cacheKey);
        it.rec.thumbSrc = 'GENERATED_COLOR_ROTATED';
      } else {
        // macOS sips downscale to max 512px with proper color management, rotation applied, and progressive jpeg
        const tmpIn = `/tmp/sig_in_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const tmpOut = `/tmp/sig_out_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        try {
          fs.writeFileSync(tmpIn, b);
          const sipsArgs = ['-Z', '512', '-s', 'format', 'jpeg', '-s', 'formatOptions', '75'];
          if (oInfo.deg !== 0) sipsArgs.push('-r', String(oInfo.deg));
          sipsArgs.push(tmpIn, '--out', tmpOut);
          require('child_process').execFileSync('sips', sipsArgs, { stdio: 'ignore' });
          if (fs.existsSync(tmpOut)) {
            const rawThumbBuf = fs.readFileSync(tmpOut);
            const cleanThumbBuf = stripExifApp1(rawThumbBuf);
            it.rec.thumb = 'data:image/jpeg;base64,' + cleanThumbBuf.toString('base64');
            it.rec.thumbSrc = 'GENERATED_COLOR_ROTATED';
          }
        } catch (err) {
          // Fallback to analyze() thumbnail if sips fails or not macOS
        } finally {
          try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch (e) {}
          try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (e) {}
        }
      }
      out.push(it.rec);
    } else {
      rej.push({ file: rel, reason: it.reason || 'Rejected' });
    }
  }
  const payload = { format: 'jpeg-signature-repository', version: 1, build: Date.now(), samples: out };
  fs.writeFileSync(sigPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(ROOT_DIR, 'dataset.js'), 'window.DEFAULT_SIGNATURES = ' + JSON.stringify(payload) + ';');
  console.log(`Curated ${out.length} forensic signatures into signatures.json & dataset.js`);
  if (rej.length) console.log(`Skipped ${rej.length} non-JPEG/invalid files.`);
})();
