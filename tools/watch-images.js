// Automatically watch images/ and rebuild signatures.json + dataset.js whenever files/folders change
// Run: node tools/watch-images.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '../images');
const builder = path.join(__dirname, 'build-signatures.js');

const listFiles = d => {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) return listFiles(full);
    if (/\.(jpe?g|jfif)$/i.test(e.name)) {
      const st = fs.statSync(full);
      return [`${full}:${st.size}:${Math.floor(st.mtimeMs)}`];
    }
    return [];
  }).sort();
};

let lastSig = listFiles(root).join('|');
let busy = false;

function checkAndRebuild() {
  if (busy) return;
  const curSig = listFiles(root).join('|');
  if (curSig === lastSig) return;
  busy = true;
  lastSig = curSig;
  console.log('[watch-images] Change detected in images/ — rebuilding signatures.json & dataset.js...');
  try {
    execFileSync(process.execPath, [builder], { stdio: 'inherit' });
    console.log('[watch-images] Rebuild complete.');
  } catch (e) {
    console.error('[watch-images] Rebuild failed:', e.message);
  }
  busy = false;
}

console.log('[watch-images] Watching', root, 'for new or modified JPEG files...');
setInterval(checkAndRebuild, 2500);

