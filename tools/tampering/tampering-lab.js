/* ============================================================================
 * tampering-lab.js — Tampering Analysis Lab (JPEG Ghost & ELA Splicing Simulation)
 *
 * Implements:
 * 1. Step 01: Controlled dual-source acquisition & dual-QF JPEG quantization.
 * 2. Step 02: Interactive sub-grid donor extraction, 16px block-aligned splicing,
 *             ground-truth mask generation, and un-spliced control synthesis.
 * 3. Step 03: Multi-QF JPEG Ghost analysis (Hany Farid 2009, Eq. 2-4) with
 *             cross-QF normalization, non-overlapping block averaging,
 *             Viridis colormap heatmaps, Raw MSE curves, and two-sample
 *             Kolmogorov-Smirnov (K-S) distribution divergence.
 * 4. Step 03: Error Level Analysis (ELA) with fixed-gain absolute RGB divergence.
 * 5. Full experiment export to ZIP (JSZip) with individual PNG/JPEG artifacts
 *    and reproducible experiment manifest JSON.
 * ============================================================================ */

'use strict';

(function () {
  // State container for the Tampering Lab experiment
  const state = {
    // Step 01
    target: {
      file: null,
      name: 'Target Image',
      img: null,
      width: 0,
      height: 0,
      qf: 85,
      jpegBlob: null,
      jpegDataUrl: null,
      jpegSize: 0,
      decodedImg: null
    },
    donor: {
      file: null,
      name: 'Counterpart Donor',
      img: null,
      width: 0,
      height: 0,
      qf: 65,
      jpegBlob: null,
      jpegDataUrl: null,
      jpegSize: 0,
      decodedImg: null
    },
    // Step 02
    roi: {
      dx: 160,
      dy: 200,
      dw: 256,
      dh: 320,
      tx: 256,
      ty: 320,
      finalQf: 85,
      snap16: true
    },
    composite: {
      tamperedBlob: null,
      tamperedUrl: null,
      tamperedImg: null,
      controlBlob: null,
      controlUrl: null,
      maskBlob: null,
      maskUrl: null,
      intermediateBlob: null,
      intermediateUrl: null
    },
    // Step 03
    ghost: {
      minQf: 15,
      maxQf: 90,
      step: 5,
      blockSize: 16,
      offsetX: 0,
      offsetY: 0,
      results: [],
      curves: { qf: [], mse: [], roiMse: [], outsideMse: [], ks: [] },
      localMinima: []
    },
    ela: {
      qf: 75,
      gain: 10,
      mae: 0,
      clippingPct: 0,
      elaBlob: null,
      elaUrl: null
    }
  };

  /* ---------------- Viridis Colormap Implementation ---------------- */
  // Perceptually uniform viridis color stops for scientific forensic rendering
  const VIRIDIS_STOPS = [
    { p: 0.00, r: 68,  g: 1,   b: 84  }, // #440154 (dark purple/low error)
    { p: 0.15, r: 72,  g: 40,  b: 120 }, // #482878
    { p: 0.30, r: 49,  g: 104, b: 142 }, // #31688e (navy blue)
    { p: 0.50, r: 33,  g: 145, b: 140 }, // #21918c (neutral cyan ~ 0.5)
    { p: 0.70, r: 53,  g: 183, b: 121 }, // #35b779 (green)
    { p: 0.85, r: 144, g: 215, b: 67  }, // #90d743 (lime)
    { p: 1.00, r: 253, g: 231, b: 37  }  // #fde725 (bright yellow/high error)
  ];

  function viridis(t) {
    if (isNaN(t) || t <= 0) return [68, 1, 84];
    if (t >= 1) return [253, 231, 37];
    for (let i = 0; i < VIRIDIS_STOPS.length - 1; i++) {
      const s0 = VIRIDIS_STOPS[i];
      const s1 = VIRIDIS_STOPS[i + 1];
      if (t >= s0.p && t <= s1.p) {
        const frac = (t - s0.p) / (s1.p - s0.p);
        return [
          Math.round(s0.r + frac * (s1.r - s0.r)),
          Math.round(s0.g + frac * (s1.g - s0.g)),
          Math.round(s0.b + frac * (s1.b - s0.b))
        ];
      }
    }
    return [253, 231, 37];
  }

  /* ---------------- Helpers ---------------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  function fmtBytes(b) {
    if (!b || b === 0) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image from ' + url));
      img.src = url;
    });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => resolve({ img, dataUrl: e.target.result });
        img.onerror = () => reject(new Error('Failed to decode image file'));
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), type, quality);
    });
  }

  function downloadBlob(blob, filename) {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------------- Step 01: Source Images & JPEG Conversion ---------------- */
  async function convertSource(kind) {
    const src = state[kind];
    if (!src.img) return;

    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src.img, 0, 0);

    const q = Math.max(1, Math.min(100, src.qf)) / 100;
    const blob = await canvasToBlob(canvas, 'image/jpeg', q);
    src.jpegBlob = blob;
    src.jpegSize = blob.size;
    if (src.jpegDataUrl) URL.revokeObjectURL(src.jpegDataUrl);
    src.jpegDataUrl = URL.createObjectURL(blob);
    src.decodedImg = await loadImageFromUrl(src.jpegDataUrl);

    renderSourceCard(kind);
    updateStepStatus();
  }

  function renderSourceCard(kind) {
    const src = state[kind];
    const prefix = kind === 'target' ? 'tgt' : 'dnr';

    $(`#${prefix}Info`).textContent = src.img
      ? `${src.name} · ${src.width} × ${src.height}`
      : 'No image selected';

    const origPrev = $(`#${prefix}OrigPreview`);
    const jpegPrev = $(`#${prefix}JpegPreview`);
    const jpegBox = $(`#${prefix}JpegBox`);

    if (src.img) {
      origPrev.src = src.img.src;
      origPrev.style.display = 'block';
      $(`#${prefix}OrigMeta`).textContent = `${src.width} × ${src.height}`;
    } else {
      origPrev.style.display = 'none';
      $(`#${prefix}OrigMeta`).textContent = '-';
    }

    if (src.decodedImg) {
      jpegPrev.src = src.decodedImg.src;
      jpegPrev.style.display = 'block';
      $(`#${prefix}JpegMeta`).textContent = `QF ${src.qf} · ${fmtBytes(src.jpegSize)}`;
      $(`#${prefix}DownloadBtn`).style.display = 'inline-flex';
      jpegBox.classList.remove('pending');
    } else {
      jpegPrev.style.display = 'none';
      $(`#${prefix}JpegMeta`).textContent = 'Pending conversion';
      $(`#${prefix}DownloadBtn`).style.display = 'none';
      jpegBox.classList.add('pending');
    }
  }

  /* ---------------- Step 02: Interactive Splicing & Placement ---------------- */
  let donorSelectActive = false;
  let targetPlaceActive = false;
  let dragStart = null;

  function initInteractiveCanvases() {
    const donorCanvas = $('#donorCanvas');
    const targetCanvas = $('#targetCanvas');

    // Donor Canvas Selection
    donorCanvas.addEventListener('mousedown', e => {
      if (!state.donor.decodedImg) return;
      donorSelectActive = true;
      const rect = donorCanvas.getBoundingClientRect();
      const scaleX = donorCanvas.width / rect.width;
      const scaleY = donorCanvas.height / rect.height;
      dragStart = {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    });

    window.addEventListener('mousemove', e => {
      if (!donorSelectActive || !dragStart) return;
      const rect = donorCanvas.getBoundingClientRect();
      const scaleX = donorCanvas.width / rect.width;
      const scaleY = donorCanvas.height / rect.height;
      const curX = Math.max(0, Math.min(donorCanvas.width, (e.clientX - rect.left) * scaleX));
      const curY = Math.max(0, Math.min(donorCanvas.height, (e.clientY - rect.top) * scaleY));

      let x = Math.min(dragStart.x, curX);
      let y = Math.min(dragStart.y, curY);
      let w = Math.abs(curX - dragStart.x);
      let h = Math.abs(curY - dragStart.y);

      if (state.roi.snap16) {
        x = Math.floor(x / 16) * 16;
        y = Math.floor(y / 16) * 16;
        w = Math.max(16, Math.floor(w / 16) * 16);
        h = Math.max(16, Math.floor(h / 16) * 16);
      }

      state.roi.dx = Math.round(x);
      state.roi.dy = Math.round(y);
      state.roi.dw = Math.round(w);
      state.roi.dh = Math.round(h);
      syncRoiInputs();
      drawDonorOverlay();
      drawTargetOverlay();
    });

    window.addEventListener('mouseup', () => {
      if (donorSelectActive) {
        donorSelectActive = false;
        dragStart = null;
        drawDonorOverlay();
        drawTargetOverlay();
      }
      if (targetPlaceActive) {
        targetPlaceActive = false;
      }
    });

    // Target Canvas Placement
    targetCanvas.addEventListener('mousedown', e => {
      if (!state.target.decodedImg) return;
      targetPlaceActive = true;
      moveTargetPlacement(e);
    });

    targetCanvas.addEventListener('mousemove', e => {
      if (!targetPlaceActive) return;
      moveTargetPlacement(e);
    });

    function moveTargetPlacement(e) {
      const rect = targetCanvas.getBoundingClientRect();
      const scaleX = targetCanvas.width / rect.width;
      const scaleY = targetCanvas.height / rect.height;
      let tx = (e.clientX - rect.left) * scaleX - state.roi.dw / 2;
      let ty = (e.clientY - rect.top) * scaleY - state.roi.dh / 2;

      tx = Math.max(0, Math.min(targetCanvas.width - state.roi.dw, tx));
      ty = Math.max(0, Math.min(targetCanvas.height - state.roi.dh, ty));

      if (state.roi.snap16) {
        tx = Math.floor(tx / 16) * 16;
        ty = Math.floor(ty / 16) * 16;
      }

      state.roi.tx = Math.round(tx);
      state.roi.ty = Math.round(ty);
      syncRoiInputs();
      drawTargetOverlay();
    }
  }

  function syncRoiInputs() {
    $('#roiDx').value = state.roi.dx;
    $('#roiDy').value = state.roi.dy;
    $('#roiDw').value = state.roi.dw;
    $('#roiDh').value = state.roi.dh;
    $('#roiTx').value = state.roi.tx;
    $('#roiTy').value = state.roi.ty;
  }

  function readRoiInputs() {
    state.roi.dx = Math.max(0, parseInt($('#roiDx').value, 10) || 0);
    state.roi.dy = Math.max(0, parseInt($('#roiDy').value, 10) || 0);
    state.roi.dw = Math.max(16, parseInt($('#roiDw').value, 10) || 128);
    state.roi.dh = Math.max(16, parseInt($('#roiDh').value, 10) || 128);
    state.roi.tx = Math.max(0, parseInt($('#roiTx').value, 10) || 0);
    state.roi.ty = Math.max(0, parseInt($('#roiTy').value, 10) || 0);
    state.roi.finalQf = Math.max(1, Math.min(100, parseInt($('#roiFinalQf').value, 10) || 85));
    state.roi.snap16 = $('#roiSnap16').checked;

    if (state.roi.snap16) {
      state.roi.dx = Math.floor(state.roi.dx / 16) * 16;
      state.roi.dy = Math.floor(state.roi.dy / 16) * 16;
      state.roi.dw = Math.floor(state.roi.dw / 16) * 16;
      state.roi.dh = Math.floor(state.roi.dh / 16) * 16;
      state.roi.tx = Math.floor(state.roi.tx / 16) * 16;
      state.roi.ty = Math.floor(state.roi.ty / 16) * 16;
      syncRoiInputs();
    }

    drawDonorOverlay();
    drawTargetOverlay();
  }

  function drawDonorOverlay() {
    const canvas = $('#donorCanvas');
    const ctx = canvas.getContext('2d');
    if (!state.donor.decodedImg) {
      canvas.width = 400;
      canvas.height = 300;
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select Counterpart Donor in Step 01', canvas.width / 2, canvas.height / 2);
      return;
    }

    canvas.width = state.donor.width;
    canvas.height = state.donor.height;
    ctx.drawImage(state.donor.decodedImg, 0, 0);

    const { dx, dy, dw, dh } = state.roi;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fde047'; // Solid amber dashed border
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(dx, dy, dw, dh);

    // Corner grab markers
    ctx.setLineDash([]);
    ctx.fillStyle = '#3b82f6';
    const s = 10;
    ctx.fillRect(dx - s / 2, dy - s / 2, s, s);
    ctx.fillRect(dx + dw - s / 2, dy - s / 2, s, s);
    ctx.fillRect(dx - s / 2, dy + dh - s / 2, s, s);
    ctx.fillRect(dx + dw - s / 2, dy + dh - s / 2, s, s);
    ctx.restore();
  }

  function drawTargetOverlay() {
    const canvas = $('#targetCanvas');
    const ctx = canvas.getContext('2d');
    if (!state.target.decodedImg) {
      canvas.width = 400;
      canvas.height = 300;
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select Target Image in Step 01', canvas.width / 2, canvas.height / 2);
      return;
    }

    canvas.width = state.target.width;
    canvas.height = state.target.height;
    ctx.drawImage(state.target.decodedImg, 0, 0);

    const { dx, dy, dw, dh, tx, ty } = state.roi;
    if (state.donor.decodedImg && dw > 0 && dh > 0) {
      // Draw donor patch preview
      ctx.drawImage(state.donor.decodedImg, dx, dy, dw, dh, tx, ty, dw, dh);

      // Placement border
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#3b82f6';
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(tx, ty, dw, dh);
      ctx.setLineDash([]);

      // Solid Badge Label
      ctx.fillStyle = '#18181b';
      ctx.fillRect(tx, Math.max(0, ty - 22), 160, 20);
      ctx.fillStyle = '#fafafa';
      ctx.font = 'bold 11px system-ui';
      ctx.fillText(`Pasted ROI: ${dw}×${dh}`, tx + 6, Math.max(14, ty - 7));
    }
  }

  async function generateTamperedImage() {
    if (!state.target.decodedImg || !state.donor.decodedImg) {
      alert('Please complete Step 01 by providing both Target and Donor images.');
      return;
    }

    readRoiInputs();
    const { dx, dy, dw, dh, tx, ty, finalQf } = state.roi;

    // 1. Intermediate Composite Canvas (Uncompressed)
    const compCanvas = document.createElement('canvas');
    compCanvas.width = state.target.width;
    compCanvas.height = state.target.height;
    const compCtx = compCanvas.getContext('2d');
    compCtx.drawImage(state.target.decodedImg, 0, 0);
    compCtx.drawImage(state.donor.decodedImg, dx, dy, dw, dh, tx, ty, dw, dh);

    state.composite.intermediateBlob = await canvasToBlob(compCanvas, 'image/png');
    if (state.composite.intermediateUrl) URL.revokeObjectURL(state.composite.intermediateUrl);
    state.composite.intermediateUrl = URL.createObjectURL(state.composite.intermediateBlob);

    // 2. Final Tampered JPEG (Quantized at finalQf)
    const finalBlob = await canvasToBlob(compCanvas, 'image/jpeg', finalQf / 100);
    state.composite.tamperedBlob = finalBlob;
    if (state.composite.tamperedUrl) URL.revokeObjectURL(state.composite.tamperedUrl);
    state.composite.tamperedUrl = URL.createObjectURL(finalBlob);
    state.composite.tamperedImg = await loadImageFromUrl(state.composite.tamperedUrl);

    // 3. Control Image (Target re-quantized at finalQf without splice)
    const ctrlCanvas = document.createElement('canvas');
    ctrlCanvas.width = state.target.width;
    ctrlCanvas.height = state.target.height;
    const ctrlCtx = ctrlCanvas.getContext('2d');
    ctrlCtx.drawImage(state.target.decodedImg, 0, 0);
    const ctrlBlob = await canvasToBlob(ctrlCanvas, 'image/jpeg', finalQf / 100);
    state.composite.controlBlob = ctrlBlob;
    if (state.composite.controlUrl) URL.revokeObjectURL(state.composite.controlUrl);
    state.composite.controlUrl = URL.createObjectURL(ctrlBlob);

    // 4. Ground-Truth Mask (Black background, White pasted region)
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = state.target.width;
    maskCanvas.height = state.target.height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.fillStyle = '#ffffff';
    maskCtx.fillRect(tx, ty, dw, dh);
    const maskBlob = await canvasToBlob(maskCanvas, 'image/png');
    state.composite.maskBlob = maskBlob;
    if (state.composite.maskUrl) URL.revokeObjectURL(state.composite.maskUrl);
    state.composite.maskUrl = URL.createObjectURL(maskBlob);

    // Update UI Previews
    $('#tamperedPrev').src = state.composite.tamperedUrl;
    $('#tamperedPrevMeta').textContent = `Final QF ${finalQf} · ${fmtBytes(finalBlob.size)}`;
    $('#controlPrev').src = state.composite.controlUrl;
    $('#controlPrevMeta').textContent = `Target QF ${state.target.qf} → ${finalQf} · ${fmtBytes(ctrlBlob.size)}`;
    $('#maskPrev').src = state.composite.maskUrl;
    $('#maskPrevMeta').textContent = `ROI ${tx}, ${ty}, ${dw}, ${dh} (w=${dw}, h=${dh})`;

    $('#step02MetaLine').textContent =
      `Target ${state.target.qf} / donor ${state.donor.qf} → final ${finalQf} · ROI ${tx}, ${ty}, ${dw}, ${dh} (x, y, w, h)`;
    $('#step02SummaryBox').style.display = 'block';

    updateStepStatus();

    // Auto trigger forensic preview if requested
    runForensicPreview();
  }

  /* ---------------- Step 03: JPEG Ghost (Farid 2009, Eq. 2-4) ---------------- */
  async function runJpegGhost() {
    const inputImg = state.composite.tamperedImg;
    if (!inputImg) {
      alert('Please generate the tampered composite in Step 02 first.');
      return;
    }

    const minQf = parseInt($('#ghostMinQf').value, 10) || 15;
    const maxQf = parseInt($('#ghostMaxQf').value, 10) || 90;
    const step = parseInt($('#ghostStep').value, 10) || 5;
    const blockSize = parseInt($('#ghostBlockSize').value, 10) || 16;
    const offX = parseInt($('#ghostOffX').value, 10) || 0;
    const offY = parseInt($('#ghostOffY').value, 10) || 0;

    state.ghost.minQf = minQf;
    state.ghost.maxQf = maxQf;
    state.ghost.step = step;
    state.ghost.blockSize = blockSize;
    state.ghost.offsetX = offX;
    state.ghost.offsetY = offY;

    // Quality factor list
    const qList = [];
    for (let q = minQf; q <= maxQf; q += step) qList.push(q);

    // Downscale slightly if image is massive for swift responsiveness
    const maxDim = 1200;
    let w = inputImg.naturalWidth || inputImg.width;
    let h = inputImg.naturalHeight || inputImg.height;
    let scale = 1;
    if (Math.max(w, h) > maxDim) {
      scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const origCanvas = document.createElement('canvas');
    origCanvas.width = w;
    origCanvas.height = h;
    const origCtx = origCanvas.getContext('2d');
    origCtx.drawImage(inputImg, 0, 0, w, h);
    const origData = origCtx.getImageData(0, 0, w, h).data;

    // Ground-truth ROI scaled coordinates
    const { tx, ty, dw, dh } = state.roi;
    const rx = Math.round(tx * scale);
    const ry = Math.round(ty * scale);
    const rw = Math.round(dw * scale);
    const rh = Math.round(dh * scale);

    const bCols = Math.floor((w - offX) / blockSize);
    const bRows = Math.floor((h - offY) / blockSize);

    // Compute raw displacements for all QFs
    const qMaps = [];
    const qMse = [];
    const qRoiMse = [];
    const qOutMse = [];
    const qKs = [];

    const progBar = $('#ghostProg');
    if (progBar) { progBar.style.width = '0%'; progBar.style.display = 'block'; }

    for (let idx = 0; idx < qList.length; idx++) {
      const q = qList[idx];
      const reCanvas = document.createElement('canvas');
      reCanvas.width = w;
      reCanvas.height = h;
      const reCtx = reCanvas.getContext('2d');

      // Re-encode at quality q
      const reBlob = await canvasToBlob(origCanvas, 'image/jpeg', q / 100);
      const reImg = await loadImageFromUrl(URL.createObjectURL(reBlob));
      reCtx.drawImage(reImg, 0, 0, w, h);
      const reData = reCtx.getImageData(0, 0, w, h).data;

      // Block-averaged displacement
      const grid = new Float32Array(bCols * bRows);
      let totalMse = 0;
      let totalCount = 0;
      let roiMseSum = 0;
      let roiCount = 0;
      let outMseSum = 0;
      let outCount = 0;

      const roiBlockVals = [];
      const outBlockVals = [];

      for (let by = 0; by < bRows; by++) {
        for (let bx = 0; bx < bCols; bx++) {
          const startX = offX + bx * blockSize;
          const startY = offY + by * blockSize;

          let blockDiff = 0;
          let pxCount = 0;
          const isRoiBlock =
            startX + blockSize / 2 >= rx &&
            startX + blockSize / 2 < rx + rw &&
            startY + blockSize / 2 >= ry &&
            startY + blockSize / 2 < ry + rh;

          for (let py = 0; py < blockSize; py++) {
            const y = startY + py;
            if (y >= h) break;
            const rowOffset = y * w * 4;
            for (let px = 0; px < blockSize; px++) {
              const x = startX + px;
              if (x >= w) break;
              const pos = rowOffset + x * 4;
              const dr = origData[pos] - reData[pos];
              const dg = origData[pos + 1] - reData[pos + 1];
              const db = origData[pos + 2] - reData[pos + 2];
              const d = (dr * dr + dg * dg + db * db) / 3;
              blockDiff += d;
              pxCount++;

              totalMse += d;
              totalCount++;
              if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) {
                roiMseSum += d;
                roiCount++;
              } else {
                outMseSum += d;
                outCount++;
              }
            }
          }

          const avgB = pxCount > 0 ? blockDiff / pxCount : 0;
          grid[by * bCols + bx] = avgB;
          if (isRoiBlock) roiBlockVals.push(avgB);
          else outBlockVals.push(avgB);
        }
      }

      qMaps.push({ q, grid, bCols, bRows, w, h, blockSize, offX, offY });
      qMse.push(totalCount > 0 ? totalMse / totalCount : 0);
      qRoiMse.push(roiCount > 0 ? roiMseSum / roiCount : 0);
      qOutMse.push(outCount > 0 ? outMseSum / outCount : 0);
      qKs.push(computeKs(roiBlockVals, outBlockVals));

      if (progBar) progBar.style.width = Math.round(((idx + 1) / qList.length) * 100) + '%';
    }

    if (progBar) progBar.style.display = 'none';

    // Cross-QF Normalization (Farid 2009, Eq. 4):
    // E_norm(bx, by) = (E_q(bx, by) - min_k E_k) / (max_k E_k - min_k E_k)
    const numBlocks = bCols * bRows;
    const minGrid = new Float32Array(numBlocks);
    const maxGrid = new Float32Array(numBlocks);

    for (let i = 0; i < numBlocks; i++) {
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (let j = 0; j < qMaps.length; j++) {
        const val = qMaps[j].grid[i];
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
      minGrid[i] = minVal;
      maxGrid[i] = maxVal;
    }

    // Render normalized heatmaps onto individual canavses
    state.ghost.results = [];
    for (let idx = 0; idx < qMaps.length; idx++) {
      const qItem = qMaps[idx];
      const normGrid = new Float32Array(numBlocks);
      for (let i = 0; i < numBlocks; i++) {
        const span = maxGrid[i] - minGrid[i];
        if (span < 1e-4) {
          normGrid[i] = 0.5; // neutral cyan for uninformative low-variance blocks
        } else {
          normGrid[i] = (qItem.grid[i] - minGrid[i]) / span;
        }
      }

      // Draw Viridis Heatmap
      const mapCanvas = document.createElement('canvas');
      mapCanvas.width = qItem.bCols * blockSize;
      mapCanvas.height = qItem.bRows * blockSize;
      const mCtx = mapCanvas.getContext('2d');
      const imgData = mCtx.createImageData(mapCanvas.width, mapCanvas.height);
      const buf = imgData.data;

      for (let by = 0; by < qItem.bRows; by++) {
        for (let bx = 0; bx < qItem.bCols; bx++) {
          const val = normGrid[by * qItem.bCols + bx];
          const [vr, vg, vb] = viridis(val);
          const startX = bx * blockSize;
          const startY = by * blockSize;

          for (let py = 0; py < blockSize; py++) {
            const y = startY + py;
            const rOffset = y * mapCanvas.width * 4;
            for (let px = 0; px < blockSize; px++) {
              const x = startX + px;
              const p = rOffset + x * 4;
              buf[p] = vr;
              buf[p + 1] = vg;
              buf[p + 2] = vb;
              buf[p + 3] = 255;
            }
          }
        }
      }
      mCtx.putImageData(imgData, 0, 0);

      const blob = await canvasToBlob(mapCanvas, 'image/png');
      const url = URL.createObjectURL(blob);
      state.ghost.results.push({
        q: qItem.q,
        canvas: mapCanvas,
        blob,
        url,
        mse: qMse[idx],
        roiMse: qRoiMse[idx],
        outsideMse: qOutMse[idx],
        ks: qKs[idx]
      });
    }

    state.ghost.curves = {
      qf: qList,
      mse: qMse,
      roiMse: qRoiMse,
      outsideMse: qOutMse,
      ks: qKs
    };

    // Detect Local Minima in ROI MSE curve
    const locMin = [];
    for (let i = 1; i < qRoiMse.length - 1; i++) {
      if (qRoiMse[i] < qRoiMse[i - 1] && qRoiMse[i] <= qRoiMse[i + 1]) {
        locMin.push(qList[i]);
      }
    }
    state.ghost.localMinima = locMin;

    renderGhostGrid();
    renderCharts();
  }

  // Two-sample Kolmogorov-Smirnov distance statistic D in [0, 1]
  function computeKs(arrA, arrB) {
    if (!arrA.length || !arrB.length) return 0;
    const a = arrA.slice().sort((x, y) => x - y);
    const b = arrB.slice().sort((x, y) => x - y);
    const nA = a.length;
    const nB = b.length;

    let i = 0, j = 0;
    let dMax = 0;
    while (i < nA && j < nB) {
      const vA = a[i];
      const vB = b[j];
      const c = vA <= vB ? vA : vB;
      while (i < nA && a[i] <= c) i++;
      while (j < nB && b[j] <= c) j++;
      const cdfA = i / nA;
      const cdfB = j / nB;
      const diff = Math.abs(cdfA - cdfB);
      if (diff > dMax) dMax = diff;
    }
    return parseFloat(dMax.toFixed(4));
  }

  function renderGhostGrid() {
    const grid = $('#ghostGrid');
    grid.innerHTML = '';

    state.ghost.results.forEach(res => {
      const card = document.createElement('div');
      card.className = 'lab-ghost-card';
      card.innerHTML = `
        <div class="lab-ghost-head">
          <b>QF ${res.q}</b>
          <button class="lab-link-btn" data-q="${res.q}">PNG ↓</button>
        </div>
        <div class="lab-ghost-body">
          <img src="${res.url}" alt="JPEG Ghost QF ${res.q}" class="lab-ghost-img">
        </div>
      `;
      card.querySelector('button').onclick = () => downloadBlob(res.blob, `ghost_qf${res.q}.png`);
      grid.appendChild(card);
    });

    $('#ghostResultSection').style.display = 'block';
    renderInterpretation();
  }

  /* ---------------- Step 03: Error Level Analysis (ELA) ---------------- */
  async function runEla() {
    const inputImg = state.composite.tamperedImg;
    if (!inputImg) {
      alert('Please generate the tampered composite in Step 02 first.');
      return;
    }

    const elaQf = parseInt($('#elaQuality').value, 10) || 75;
    const gain = parseInt($('#elaGain').value, 10) || 10;
    state.ela.qf = elaQf;
    state.ela.gain = gain;

    const w = inputImg.naturalWidth || inputImg.width;
    const h = inputImg.naturalHeight || inputImg.height;

    const origCanvas = document.createElement('canvas');
    origCanvas.width = w;
    origCanvas.height = h;
    const oCtx = origCanvas.getContext('2d');
    oCtx.drawImage(inputImg, 0, 0, w, h);
    const oData = oCtx.getImageData(0, 0, w, h).data;

    // Recompress at ELA Quality
    const reBlob = await canvasToBlob(origCanvas, 'image/jpeg', elaQf / 100);
    const reImg = await loadImageFromUrl(URL.createObjectURL(reBlob));
    const reCanvas = document.createElement('canvas');
    reCanvas.width = w;
    reCanvas.height = h;
    const rCtx = reCanvas.getContext('2d');
    rCtx.drawImage(reImg, 0, 0, w, h);
    const rData = rCtx.getImageData(0, 0, w, h).data;

    // Absolute Difference * Gain
    const elaCanvas = document.createElement('canvas');
    elaCanvas.width = w;
    elaCanvas.height = h;
    const eCtx = elaCanvas.getContext('2d');
    const eImgData = eCtx.createImageData(w, h);
    const eData = eImgData.data;

    let totalDiff = 0;
    let clippedChannels = 0;
    const totalPixels = w * h;

    for (let i = 0; i < oData.length; i += 4) {
      const dr = Math.abs(oData[i] - rData[i]) * gain;
      const dg = Math.abs(oData[i + 1] - rData[i + 1]) * gain;
      const db = Math.abs(oData[i + 2] - rData[i + 2]) * gain;

      totalDiff += (Math.abs(oData[i] - rData[i]) + Math.abs(oData[i + 1] - rData[i + 1]) + Math.abs(oData[i + 2] - rData[i + 2])) / 3;

      if (dr >= 255) clippedChannels++;
      if (dg >= 255) clippedChannels++;
      if (db >= 255) clippedChannels++;

      eData[i] = Math.min(255, dr);
      eData[i + 1] = Math.min(255, dg);
      eData[i + 2] = Math.min(255, db);
      eData[i + 3] = 255;
    }

    eCtx.putImageData(eImgData, 0, 0);

    const mae = totalPixels > 0 ? (totalDiff / totalPixels).toFixed(4) : 0;
    const clipPct = totalPixels > 0 ? ((clippedChannels / (totalPixels * 3)) * 100).toFixed(2) : 0;

    state.ela.mae = mae;
    state.ela.clippingPct = clipPct;

    const blob = await canvasToBlob(elaCanvas, 'image/png');
    if (state.ela.elaUrl) URL.revokeObjectURL(state.ela.elaUrl);
    state.ela.elaBlob = blob;
    state.ela.elaUrl = URL.createObjectURL(blob);

    $('#elaResultSection').style.display = 'block';
    $('#elaTamperedPrev').src = state.composite.tamperedUrl;
    $('#elaMapPrev').src = state.ela.elaUrl;
    $('#elaSubtitle').textContent = `QF ${elaQf} · Fixed gain ×${gain} · MAE ${mae}`;
    $('#elaClippingText').textContent = `Clipping setelah gain: ${clipPct}% nilai channel.`;
    renderInterpretation();
  }

  /* ---------------- SVG Charts ---------------- */
  function renderCharts() {
    renderMseChart();
    renderKsChart();
  }

  function renderMseChart() {
    const { qf, mse, roiMse, outsideMse } = state.ghost.curves;
    if (!qf.length) return;

    const maxVal = Math.max(...mse, ...roiMse, ...outsideMse, 1) * 1.1;
    const minVal = 0;

    const W = 680, H = 220, padL = 50, padR = 20, padT = 20, padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const getX = q => padL + ((q - qf[0]) / (qf[qf.length - 1] - qf[0])) * plotW;
    const getY = v => padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

    const ptsMse = qf.map((q, i) => `${getX(q)},${getY(mse[i])}`).join(' ');
    const ptsRoi = qf.map((q, i) => `${getX(q)},${getY(roiMse[i])}`).join(' ');
    const ptsOut = qf.map((q, i) => `${getX(q)},${getY(outsideMse[i])}`).join(' ');

    const svg = `
      <svg viewBox="0 0 ${W} ${H}" class="lab-chart-svg">
        <!-- Axes -->
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#27272a" stroke-width="1.5" />
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#27272a" stroke-width="1.5" />
        
        <!-- Y Grid Lines -->
        <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="#18181b" stroke-dasharray="3,3" />
        <line x1="${padL}" y1="${padT + plotH / 2}" x2="${W - padR}" y2="${padT + plotH / 2}" stroke="#18181b" stroke-dasharray="3,3" />
        <text x="${padL - 8}" y="${padT + 4}" fill="#a1a1aa" font-size="10" text-anchor="end">${maxVal.toFixed(1)}</text>
        <text x="${padL - 8}" y="${padT + plotH / 2 + 3}" fill="#a1a1aa" font-size="10" text-anchor="end">${(maxVal / 2).toFixed(1)}</text>
        <text x="${padL - 8}" y="${padT + plotH}" fill="#a1a1aa" font-size="10" text-anchor="end">0.0</text>
        
        <!-- X Axis Labels -->
        <text x="${padL}" y="${H - 12}" fill="#a1a1aa" font-size="11" text-anchor="start">${qf[0]}</text>
        <text x="${padL + plotW / 2}" y="${H - 12}" fill="#a1a1aa" font-size="11" text-anchor="middle">${qf[Math.floor(qf.length / 2)]}</text>
        <text x="${W - padR}" y="${H - 12}" fill="#a1a1aa" font-size="11" text-anchor="end">${qf[qf.length - 1]}</text>
        <text x="${padL + plotW / 2}" y="${H - 2}" fill="#a1a1aa" font-size="11" text-anchor="middle">JPEG quality factor</text>

        <!-- Curves -->
        <polyline fill="none" stroke="#21918c" stroke-width="2.5" points="${ptsMse}" />
        <polyline fill="none" stroke="#d97706" stroke-width="2.5" points="${ptsRoi}" />
        <polyline fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-dasharray="4,2" points="${ptsOut}" />

        <!-- Data markers on ROI line -->
        ${qf.map((q, i) => `<circle cx="${getX(q)}" cy="${getY(roiMse[i])}" r="3" fill="#d97706" />`).join('')}
      </svg>
    `;

    $('#mseChartBox').innerHTML = svg;
  }

  function renderKsChart() {
    const { qf, ks } = state.ghost.curves;
    if (!qf.length) return;

    const W = 680, H = 200, padL = 50, padR = 20, padT = 20, padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const getX = q => padL + ((q - qf[0]) / (qf[qf.length - 1] - qf[0])) * plotW;
    const getY = v => padT + plotH - v * plotH;

    const ptsKs = qf.map((q, i) => `${getX(q)},${getY(ks[i])}`).join(' ');

    const svg = `
      <svg viewBox="0 0 ${W} ${H}" class="lab-chart-svg">
        <!-- Axes -->
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#27272a" stroke-width="1.5" />
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#27272a" stroke-width="1.5" />

        <!-- Grid Lines -->
        <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="#18181b" stroke-dasharray="3,3" />
        <line x1="${padL}" y1="${padT + plotH * 0.25}" x2="${W - padR}" y2="${padT + plotH * 0.25}" stroke="#18181b" stroke-dasharray="3,3" />
        <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${W - padR}" y2="${padT + plotH * 0.5}" stroke="#18181b" stroke-dasharray="3,3" />
        <line x1="${padL}" y1="${padT + plotH * 0.75}" x2="${W - padR}" y2="${padT + plotH * 0.75}" stroke="#18181b" stroke-dasharray="3,3" />
        
        <text x="${padL - 8}" y="${padT + 4}" fill="#a1a1aa" font-size="10" text-anchor="end">1.00</text>
        <text x="${padL - 8}" y="${padT + plotH * 0.5 + 3}" fill="#a1a1aa" font-size="10" text-anchor="end">0.50</text>
        <text x="${padL - 8}" y="${padT + plotH}" fill="#a1a1aa" font-size="10" text-anchor="end">0.00</text>

        <!-- X Axis Labels -->
        <text x="${padL}" y="${H - 12}" fill="#a1a1aa" font-size="11" text-anchor="start">${qf[0]}</text>
        <text x="${padL + plotW / 2}" y="${H - 12}" fill="#a1a1aa" font-size="11" text-anchor="middle">${qf[Math.floor(qf.length / 2)]}</text>
        <text x="${W - padR}" y="${H - 12}" fill="#a1a1aa" font-size="11" text-anchor="end">${qf[qf.length - 1]}</text>
        <text x="${padL + plotW / 2}" y="${H - 2}" fill="#a1a1aa" font-size="11" text-anchor="middle">JPEG quality factor</text>

        <!-- Curve -->
        <polyline fill="none" stroke="#3b82f6" stroke-width="2.5" points="${ptsKs}" />
        ${qf.map((q, i) => `<circle cx="${getX(q)}" cy="${getY(ks[i])}" r="3.5" fill="#60a5fa" />`).join('')}
      </svg>
    `;

    $('#ksChartBox').innerHTML = svg;

    const minText = state.ghost.localMinima.length
      ? state.ghost.localMinima.join(', ')
      : 'None distinctly detected';
    $('#ksMinimaText').textContent = `ROI local minima: ${minText}. K-S deskriptif, bukan probabilitas manipulasi. Area bertekstur berbeda dapat memengaruhi respons.`;
  }

  async function runForensicPreview() {
    await runJpegGhost();
    await runEla();
    renderInterpretation();
  }

  /* ---------------- Rule-Based Forensic Interpretation Engine ---------------- */
  function evaluateTamperingRules() {
    const ghost = state.ghost;
    const ela = state.ela;
    const roi = state.roi;
    const rules = [];
    let score = 0;

    // 1. JPEG Ghost Rule
    const minima = ghost.localMinima || [];
    const finalQ = roi.finalQf || 85;
    const donorMinima = minima.filter(q => Math.abs(q - finalQ) >= 5);

    if (donorMinima.length > 0) {
      score += 45;
      rules.push({
        ruleId: 'GHOST-01',
        level: 'bad',
        title: `Prior Compression Discrepancy (Donor QF ≈ ${donorMinima.join(', ')})`,
        detail: `Terdeteksi local error minimum yang jelas pada QF ${donorMinima.join(', ')} (berbeda dari QF kontainer ${finalQ}). Hal ini membuktikan area donor sebelumnya pernah dikompresi pada kualitas ~QF ${donorMinima[0]} sebelum ditempel (Farid 2009, Persamaan 4).`
      });
    } else if (minima.length === 0) {
      rules.push({
        ruleId: 'GHOST-02',
        level: 'ok',
        title: 'Monotonic Error Curve (No Ghost Discrepancy)',
        detail: 'Kurva error menurun secara monoton menuju kuantisasi kontainer tanpa ada minimum sekunder. Profil kompresi homogen.'
      });
    }

    // 2. Kolmogorov-Smirnov Divergence Rule
    const ksList = (ghost && ghost.curves && ghost.curves.ks) || [0];
    const maxKs = Math.max(...ksList, 0);
    if (maxKs >= 0.40) {
      score += 25;
      rules.push({
        ruleId: 'KS-01',
        level: 'bad',
        title: `High Distribution Divergence (D_KS = ${maxKs.toFixed(4)})`,
        detail: `Divergensi statistik blok ROI vs Background sangat tinggi (D_KS = ${maxKs.toFixed(4)} >= 0.40). Distribusi error blok membuktikan kedua area berasal dari distribusi kompresi berbeda.`
      });
    } else if (maxKs >= 0.20) {
      score += 15;
      rules.push({
        ruleId: 'KS-02',
        level: 'warn',
        title: `Moderate Distribution Divergence (D_KS = ${maxKs.toFixed(4)})`,
        detail: `Divergensi statistik sedang (0.20 <= D_KS < 0.40). Kemungkinan akibat variasi kontras tekstur lokal atau re-kompresi ringan.`
      });
    } else {
      rules.push({
        ruleId: 'KS-03',
        level: 'ok',
        title: `Consistent Block Distribution (D_KS = ${maxKs.toFixed(4)})`,
        detail: 'Divergensi statistik rendah (D_KS < 0.20). Karakteristik statistik error blok konsisten di seluruh citra.'
      });
    }

    // 3. Error Level Analysis (ELA) Rule
    const mae = parseFloat(ela.mae || 0);
    const clip = parseFloat(ela.clippingPct || 0);
    if (mae >= 3.8 || clip >= 0.5) {
      score += 20;
      rules.push({
        ruleId: 'ELA-01',
        level: 'bad',
        title: `Elevated High-Frequency Residuals (MAE = ${mae.toFixed(2)}, Clipping = ${clip.toFixed(2)}%)`,
        detail: `Residu error kompresi melampaui batas normal. Tepi sambungan atau objek tempelan memicu lonjakan selisih frekuensi tinggi terhadap area sekitarnya.`
      });
    } else if (mae >= 2.4) {
      score += 10;
      rules.push({
        ruleId: 'ELA-02',
        level: 'warn',
        title: `Moderate Error Activity (MAE = ${mae.toFixed(2)})`,
        detail: `Tingkat error residu sedang. Perhatikan disparitas tekstur: tepi berkontras tinggi secara alami menunjukkan kecerahan ELA lebih tinggi dibanding bidang halus.`
      });
    } else if (mae > 0) {
      rules.push({
        ruleId: 'ELA-03',
        level: 'ok',
        title: `Low Baseline Residuals (MAE = ${mae.toFixed(2)})`,
        detail: 'Residu dekompresi merata dengan amplitudo rendah di seluruh bidang citra.'
      });
    }

    // 4. Final Verdict Synthesis
    let level, badge, title, recommendation;
    if (score >= 60) {
      level = 'bad';
      badge = 'TAMPERING CONFIRMED';
      title = 'STRONG EVIDENCE OF IMAGE SPLICING & MANIPULATION';
      recommendation = 'Terdeteksi anomali ganda signifikan (local minimum JPEG Ghost pada QF berbeda, divergensi K-S tinggi, dan/atau residu ELA asimetris). Citra ini hampir pasti merupakan hasil splicing (tempelan dari dua sumber JPEG berbeda).';
    } else if (score >= 30) {
      level = 'warn';
      badge = 'SUSPICIOUS ANOMALY';
      title = 'COMPRESSION IRREGULARITY DETECTED';
      recommendation = 'Terdeteksi ketidakteraturan pada kurva kompresi atau residu ELA. Kemungkinan terdapat manipulasi lokal, modifikasi grafis parsial, atau perbedaan tekstur ekstrem pada area yang diuji.';
    } else {
      level = 'ok';
      badge = 'CONSISTENT';
      title = 'CONSISTENT COMPRESSION PROFILE';
      recommendation = 'Karakteristik kompresi citra homogen di seluruh area. Tidak ditemukan indikasi ghost kompresi donor maupun anomali residu frekuensi tinggi.';
    }

    return {
      score: Math.min(100, score),
      level,
      badge,
      title,
      recommendation,
      rules
    };
  }

  function renderInterpretation() {
    const v = evaluateTamperingRules();
    const sec = $('#ruleInterpretationSection');
    if (!sec) return;

    sec.style.display = 'block';
    const alert = $('#ruleVerdictAlert');
    alert.className = `alert ${v.level}`;
    const badge = $('#ruleVerdictBadge');
    badge.className = `badge ${v.level}`;
    badge.textContent = v.badge;
    $('#ruleRiskScore').textContent = `Tampering Probability: ${v.score}%`;
    $('#ruleVerdictTitle').textContent = v.title;
    $('#ruleVerdictRec').textContent = v.recommendation;

    const list = $('#ruleEvaluationList');
    list.innerHTML = v.rules.map(r => `
      <div class="lab-rule-item">
        <div class="lab-rule-head">
          <span class="badge ${r.level}">[${r.ruleId}]</span>
          <span>${r.title}</span>
        </div>
        <div class="lab-rule-detail">${r.detail}</div>
      </div>
    `).join('');
  }

  /* ---------------- Experiment ZIP Export ---------------- */
  async function downloadExperimentZip() {
    if (!window.JSZip) {
      alert('JSZip library is not loaded.');
      return;
    }
    const zip = new JSZip();

    if (state.target.jpegBlob) zip.file(`01_target_QF${state.target.qf}.jpg`, state.target.jpegBlob);
    if (state.donor.jpegBlob) zip.file(`01_counterpart_donor_QF${state.donor.qf}.jpg`, state.donor.jpegBlob);
    if (state.composite.tamperedBlob) zip.file(`02_tampered_final_QF${state.roi.finalQf}.jpg`, state.composite.tamperedBlob);
    if (state.composite.controlBlob) zip.file(`02_control_no_splice_QF${state.roi.finalQf}.jpg`, state.composite.controlBlob);
    if (state.composite.maskBlob) zip.file('02_ground_truth_mask.png', state.composite.maskBlob);
    if (state.ela.elaBlob) zip.file(`03_ela_QF${state.ela.qf}.png`, state.ela.elaBlob);

    const ghostFolder = zip.folder('03_jpeg_ghost_maps');
    state.ghost.results.forEach(res => {
      ghostFolder.file(`ghost_QF${res.q}.png`, res.blob);
    });

    const manifest = {
      experiment: 'JPEG Trace · Tampering Analysis Lab',
      date: new Date().toISOString(),
      target: {
        name: state.target.name,
        width: state.target.width,
        height: state.target.height,
        qf: state.target.qf
      },
      donor: {
        name: state.donor.name,
        width: state.donor.width,
        height: state.donor.height,
        qf: state.donor.qf
      },
      roi: { ...state.roi },
      ghost: {
        minQf: state.ghost.minQf,
        maxQf: state.ghost.maxQf,
        step: state.ghost.step,
        blockSize: state.ghost.blockSize,
        detectedLocalMinima: state.ghost.localMinima
      },
      ela: {
        qf: state.ela.qf,
        gain: state.ela.gain,
        mae: state.ela.mae,
        clippingPct: state.ela.clippingPct
      }
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `tampering_experiment_${Date.now()}.zip`);
  }

  function resetExperiment() {
    if (!confirm('Start a new experiment? This will reset the current tampering simulation.')) return;
    state.target.img = null;
    state.target.decodedImg = null;
    state.donor.img = null;
    state.donor.decodedImg = null;
    state.composite.tamperedImg = null;
    state.ghost.results = [];

    renderSourceCard('target');
    renderSourceCard('donor');
    drawDonorOverlay();
    drawTargetOverlay();

    $('#step02SummaryBox').style.display = 'none';
    $('#ghostResultSection').style.display = 'none';
    $('#elaResultSection').style.display = 'none';
    updateStepStatus();
  }

  function updateStepStatus() {
    const s1Ok = Boolean(state.target.decodedImg && state.donor.decodedImg);
    const s2Ok = Boolean(state.composite.tamperedImg);

    $('#pillStep1').className = 'lab-step-pill ' + (s1Ok ? 'completed' : 'active');
    $('#pillStep2').className = 'lab-step-pill ' + (s2Ok ? 'completed' : s1Ok ? 'active' : 'disabled');
    $('#pillStep3').className = 'lab-step-pill ' + (s2Ok ? 'active' : 'disabled');

    $('#btnGenTampered').disabled = !s1Ok;
    $('#btnGhostPrev').disabled = !s2Ok;
    $('#btnElaPrev').disabled = !s2Ok;
    $('#btnExpZip').disabled = !s2Ok;
  }

  /* ---------------- Catalog Population & Setup ---------------- */
  function populateCatalogDropdowns() {
    const tgtSel = $('#tgtSampleSelect');
    const dnrSel = $('#dnrSampleSelect');
    if (!tgtSel || !dnrSel) return;

    tgtSel.innerHTML = '<option value="">-- Choose from Catalog Samples --</option>';
    dnrSel.innerHTML = '<option value="">-- Choose from Catalog Samples --</option>';

    const samplesList = window.samples || (window.DEFAULT_SIGNATURES && window.DEFAULT_SIGNATURES.samples) || [];
    samplesList.slice(0, 100).forEach(s => {
      const opt1 = document.createElement('option');
      opt1.value = s.file || s.id;
      opt1.textContent = `${s.device || 'Camera'} (${s.file ? s.file.split('/').pop() : s.id})`;
      tgtSel.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = s.file || s.id;
      opt2.textContent = `${s.device || 'Camera'} (${s.file ? s.file.split('/').pop() : s.id})`;
      dnrSel.appendChild(opt2);
    });
  }

  async function loadSampleInto(kind, filePath) {
    if (!filePath) return;
    try {
      const img = await loadImageFromUrl(filePath);
      const name = filePath.split('/').pop();
      state[kind].file = null;
      state[kind].name = name;
      state[kind].img = img;
      state[kind].width = img.naturalWidth || img.width;
      state[kind].height = img.naturalHeight || img.height;
      await convertSource(kind);
      drawDonorOverlay();
      drawTargetOverlay();
    } catch (e) {
      alert(`Could not load image ${filePath}. Ensure images are served via web server or upload directly.`);
    }
  }

  /* ---------------- Initialization ---------------- */
  function init() {
    // Populate dropdowns when catalog is loaded
    populateCatalogDropdowns();
    setTimeout(populateCatalogDropdowns, 1000);

    // Step 01 Event Listeners
    $('#tgtSampleSelect').onchange = e => loadSampleInto('target', e.target.value);
    $('#dnrSampleSelect').onchange = e => loadSampleInto('donor', e.target.value);

    $('#tgtUploadInput').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      const { img } = await loadImageFromFile(f);
      state.target.file = f;
      state.target.name = f.name;
      state.target.img = img;
      state.target.width = img.naturalWidth || img.width;
      state.target.height = img.naturalHeight || img.height;
      await convertSource('target');
      drawTargetOverlay();
      e.target.value = '';
    };

    $('#dnrUploadInput').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      const { img } = await loadImageFromFile(f);
      state.donor.file = f;
      state.donor.name = f.name;
      state.donor.img = img;
      state.donor.width = img.naturalWidth || img.width;
      state.donor.height = img.naturalHeight || img.height;
      await convertSource('donor');
      drawDonorOverlay();
      drawTargetOverlay();
      e.target.value = '';
    };

    // Quality factor changes
    $('#tgtQfSlider').oninput = e => {
      state.target.qf = parseInt(e.target.value, 10);
      $('#tgtQfVal').textContent = state.target.qf;
    };
    $('#tgtQfSlider').onchange = () => convertSource('target');

    $('#dnrQfSlider').oninput = e => {
      state.donor.qf = parseInt(e.target.value, 10);
      $('#dnrQfVal').textContent = state.donor.qf;
    };
    $('#dnrQfSlider').onchange = () => convertSource('donor');

    $('#tgtDownloadBtn').onclick = () => downloadBlob(state.target.jpegBlob, `target_QF${state.target.qf}.jpg`);
    $('#dnrDownloadBtn').onclick = () => downloadBlob(state.donor.jpegBlob, `counterpart_donor_QF${state.donor.qf}.jpg`);

    // Step 02 Event Listeners
    ['#roiDx', '#roiDy', '#roiDw', '#roiDh', '#roiTx', '#roiTy', '#roiFinalQf', '#roiSnap16'].forEach(id => {
      $(id).addEventListener('input', readRoiInputs);
    });

    $('#btnGenTampered').onclick = generateTamperedImage;
    $('#btnDownloadTampered').onclick = () => downloadBlob(state.composite.tamperedBlob, `tampered_final_QF${state.roi.finalQf}.jpg`);

    // Step 03 Event Listeners
    $('#btnGhostPrev').onclick = runJpegGhost;
    $('#btnElaPrev').onclick = runEla;
    $('#btnRunBothForensic').onclick = runForensicPreview;

    $('#elaDownloadBtn').onclick = () => downloadBlob(state.ela.elaBlob, `ela_QF${state.ela.qf}.png`);

    // Top action buttons
    $('#btnNewExperiment').onclick = resetExperiment;
    $('#btnExpZip').onclick = downloadExperimentZip;

    // Direct Pre-Tampered Image Upload option in Step 03
    $('#directTamperedUpload').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      const { img } = await loadImageFromFile(f);
      state.composite.tamperedImg = img;
      state.composite.tamperedBlob = f;
      state.composite.tamperedUrl = img.src;

      // Fill mock ROI if not set
      state.roi.tx = Math.round(img.width * 0.25);
      state.roi.ty = Math.round(img.height * 0.25);
      state.roi.dw = Math.round(img.width * 0.5);
      state.roi.dh = Math.round(img.height * 0.5);

      updateStepStatus();
      runForensicPreview();
      e.target.value = '';
    };

    initInteractiveCanvases();
    updateStepStatus();
  }

  // Bind to DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export module to global scope for interoperability
  window.TamperingLab = {
    state,
    convertSource,
    generateTamperedImage,
    runJpegGhost,
    runEla,
    downloadExperimentZip,
    resetExperiment,
    populateCatalog: populateCatalogDropdowns,
    loadSampleInto
  };
})();
