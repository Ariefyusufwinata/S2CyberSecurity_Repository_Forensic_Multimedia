// Build signatures.json from all JPEGs in images/ directory (run: node tools/build-signatures.js)
const fs = require('fs'), path = require('path');
global.window = global;
global.ExifReader = require('../vendor/exif-reader.js');
require('../huffman.js');
let src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
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
  const root = path.join(__dirname, '../images'), out = [], rej = [];
  for (const f of walk(root).sort()) {
    const b = fs.readFileSync(f);
    const it = await analyze(path.relative(path.join(__dirname, '..'), f), b.buffer.slice(b.byteOffset, b.byteOffset + b.length), b.length);
    if (it.rec) {
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
      it.rec.displayDim = it.rec.displayWidth + ' × ' + it.rec.displayHeight;

      // Ensure full-color RGB preview rotated upright
      const tmp = '/tmp/_prev.jpg';
      const sipsArgs = ['-Z', '360', '-s', 'formatOptions', '80'];
      if (oInfo.deg !== 0) sipsArgs.push('-r', String(oInfo.deg));
      sipsArgs.push(f, '--out', tmp);
      try {
        require('child_process').execFileSync('sips', sipsArgs, { stdio: 'ignore' });
        it.rec.thumb = 'data:image/jpeg;base64,' + stripExifApp1(fs.readFileSync(tmp)).toString('base64');
        it.rec.thumbSrc = 'GENERATED_COLOR_ROTATED';
      } catch (e) {}
      it.rec.bundled = true;
    }
    (it.status === 'accepted' ? out : rej).push(it.status === 'accepted' ? it.rec : it);
  }
  const seen = new Set(), samples = out.filter(s => !seen.has(s.id) && seen.add(s.id));
  fs.writeFileSync(path.join(__dirname, '../signatures.json'), JSON.stringify({ format: 'jpeg-signature-repository', version: 1, build: Date.now(), samples }));
  fs.writeFileSync(path.join(__dirname, '../dataset.js'), 'window.DEFAULT_SIGNATURES = ' + fs.readFileSync(path.join(__dirname, '../signatures.json'), 'utf8') + ';\n');
  console.log('Accepted:', samples.length, 'Rejected:', rej.length);
  rej.slice(0, 5).forEach(r => console.log(' -', r.name, r.reason));
  const g = {}; samples.forEach(s => (g[s.device + ' | ' + s.dqtKey] = (g[s.device + ' | ' + s.dqtKey] || 0) + 1));
  console.log(g);
})();
