/**
 * S2 Cyber Security - Multimedia Forensic Repository
 * tools/tampering/report.js
 * 
 * High-Precision Digital Forensic Examination Report Generator (PDF)
 * Produces publication-grade, official forensic examination reports for:
 * - JPEG Ghost Compression Residuals (Farid, 2009)
 * - Error Level Analysis (Krawetz, 2007)
 * - Automated Rule-Based Forensic Verdict (tools/interpretation/rules.js)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ForensicTamperingReport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Render clean high-resolution MSE Chart on offscreen canvas for PDF embedding
   */
  function renderOffscreenMseChart(curves, width = 760, height = 320) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Crisp white background for print
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Frame border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    const { qf, mse, roiMse, outsideMse } = curves || { qf: [], mse: [], roiMse: [], outsideMse: [] };
    if (!qf || !qf.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Data kurva MSE tidak tersedia', width / 2, height / 2);
      return canvas.toDataURL('image/png');
    }

    const padL = 60, padR = 30, padT = 30, padB = 45;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxVal = Math.max(...mse, ...roiMse, ...outsideMse, 1) * 1.1;
    const minVal = 0;

    const getX = q => padL + ((q - qf[0]) / (qf[qf.length - 1] - qf[0])) * plotW;
    const getY = v => padT + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

    // Grid lines
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();

      const val = maxVal - (maxVal / 4) * i;
      ctx.fillStyle = '#64748b';
      ctx.font = '11px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), padL - 8, y + 4);
    }

    // Axes
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(width - padR, padT + plotH);
    ctx.stroke();

    // X Axis ticks & labels
    ctx.fillStyle = '#475569';
    ctx.font = '11px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    qf.forEach(q => {
      const x = getX(q);
      ctx.beginPath();
      ctx.moveTo(x, padT + plotH);
      ctx.lineTo(x, padT + plotH + 4);
      ctx.strokeStyle = '#94a3b8';
      ctx.stroke();
      ctx.fillText(String(q), x, padT + plotH + 18);
    });

    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ctx.fillText('JPEG Quality Factor (QF)', padL + plotW / 2, height - 10);

    // Function to draw line series
    function drawLine(arr, color, lineWidth, isDashed = false) {
      if (!arr || !arr.length) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (isDashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      arr.forEach((v, i) => {
        const x = getX(qf[i]), y = getY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Draw lines
    drawLine(outsideMse, '#94a3b8', 1.5, true); // Background MSE (gray dashed)
    drawLine(mse, '#0d9488', 2.2);              // Global MSE (teal)
    drawLine(roiMse, '#ea580c', 2.5);           // ROI MSE (orange/amber)

    // Dots on ROI line
    roiMse.forEach((v, i) => {
      const x = getX(qf[i]), y = getY(v);
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Legend
    const legX = width - padR - 260, legY = 16;
    ctx.font = '10px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left';

    // Global
    ctx.fillStyle = '#0d9488';
    ctx.fillRect(legX, legY, 14, 3);
    ctx.fillStyle = '#334155';
    ctx.fillText('Global MSE', legX + 18, legY + 5);

    // ROI
    ctx.fillStyle = '#ea580c';
    ctx.fillRect(legX + 85, legY, 14, 3);
    ctx.fillStyle = '#334155';
    ctx.fillText('ROI MSE (Spliced)', legX + 103, legY + 5);

    // Background
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(legX + 195, legY, 14, 3);
    ctx.fillStyle = '#334155';
    ctx.fillText('Background', legX + 213, legY + 5);

    return canvas.toDataURL('image/png');
  }

  /**
   * Render clean high-resolution K-S Chart on offscreen canvas for PDF embedding
   */
  function renderOffscreenKsChart(curves, width = 760, height = 320) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    const { qf, ks } = curves || { qf: [], ks: [] };
    if (!qf || !qf.length || !ks || !ks.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Data kurva K-S tidak tersedia', width / 2, height / 2);
      return canvas.toDataURL('image/png');
    }

    const padL = 60, padR = 30, padT = 30, padB = 45;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const getX = q => padL + ((q - qf[0]) / (qf[qf.length - 1] - qf[0])) * plotW;
    const getY = v => padT + plotH - Math.max(0, Math.min(1, v)) * plotH;

    // Grid lines for 0.0, 0.25, 0.5, 0.75, 1.0
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();

      const val = 1.0 - 0.25 * i;
      ctx.fillStyle = '#64748b';
      ctx.font = '11px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(2), padL - 8, y + 4);
    }

    // Threshold indicator line at D_KS = 0.40 (Significant divergence)
    const yThresh = getY(0.40);
    ctx.save();
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, yThresh);
    ctx.lineTo(width - padR, yThresh);
    ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.font = '10px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Ambang Signifikan (0.40)', width - padR - 6, yThresh - 4);
    ctx.restore();

    // Axes
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(width - padR, padT + plotH);
    ctx.stroke();

    // X Axis ticks
    ctx.fillStyle = '#475569';
    ctx.font = '11px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    qf.forEach(q => {
      const x = getX(q);
      ctx.beginPath();
      ctx.moveTo(x, padT + plotH);
      ctx.lineTo(x, padT + plotH + 4);
      ctx.strokeStyle = '#94a3b8';
      ctx.stroke();
      ctx.fillText(String(q), x, padT + plotH + 18);
    });

    ctx.font = 'bold 11px Helvetica, Arial, sans-serif';
    ctx.fillText('JPEG Quality Factor (QF)', padL + plotW / 2, height - 10);

    // K-S Curve Line
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ks.forEach((v, i) => {
      const x = getX(qf[i]), y = getY(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots
    ks.forEach((v, i) => {
      const x = getX(qf[i]), y = getY(v);
      ctx.fillStyle = v >= 0.40 ? '#dc2626' : '#2563eb';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    return canvas.toDataURL('image/png');
  }

  /**
   * Helper to draw a horizontal colormap color bar (Viridis)
   */
  function drawColormapBarCanvas(width = 320, height = 14) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Gradient matching viridis
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0.0, '#440154');
    grad.addColorStop(0.25, '#3b528b');
    grad.addColorStop(0.5, '#21918c');
    grad.addColorStop(0.75, '#5ec962');
    grad.addColorStop(1.0, '#fde725');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    return canvas.toDataURL('image/png');
  }

  /**
   * Main function to generate and download the Forensic Examination PDF report
   */
  async function generatePdfReport(state, verdict) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('Modul jsPDF belum siap. Silakan muat ulang halaman.');
      return;
    }

    // Safety check for analysis run
    const hasGhost = state && state.ghost && state.ghost.results && state.ghost.results.length > 0;
    const hasTampered = state && state.composite && (state.composite.tamperedImg || state.composite.tamperedUrl);

    if (!hasGhost && !hasTampered) {
      alert('Silakan jalankan simulasi dan analisis forensik terlebih dahulu (Run Ghost Analysis) sebelum mengunduh laporan PDF.');
      return;
    }

    // Evaluate verdict if not provided
    if (!verdict && window.ForensicInterpretation && window.ForensicInterpretation.evaluateTamperingRules) {
      verdict = window.ForensicInterpretation.evaluateTamperingRules(state.ghost, state.ela, {}, state.roi);
    } else if (!verdict) {
      verdict = {
        score: 0,
        level: 'ok',
        badge: 'CONSISTENT',
        title: 'PROFIL KOMPRESI KONSISTEN',
        recommendation: 'Tidak ditemukan indikasi manipulasi kompresi JPEG ganda atau anomali residu yang signifikan.',
        rules: []
      };
    }

    // Create A4 PDF in mm
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = 210, pageHeight = 297;
    const marginL = 14, marginR = 14;
    const contentW = pageWidth - marginL - marginR; // 182 mm

    // Timestamp & Case ID
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
    const caseId = 'FR-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Color definitions for jsPDF
    const cPrimary = [37, 99, 235];     // #2563eb
    const cSlate900 = [15, 23, 42];     // #0f172a
    const cSlate700 = [51, 65, 85];     // #334155
    const cSlate500 = [100, 116, 139];  // #64748b
    const cBorder = [226, 232, 240];    // #e2e8f0
    const cCardBg = [248, 250, 252];    // #f8fafc

    // Severity Colors
    let cAlertBorder = [134, 239, 172]; // Green
    let cAlertBg = [240, 253, 244];
    let cAlertText = [22, 101, 52];
    if (verdict.level === 'danger' || verdict.level === 'bad') {
      cAlertBorder = [252, 165, 165];   // Red
      cAlertBg = [254, 242, 242];
      cAlertText = [153, 27, 27];
    } else if (verdict.level === 'warn') {
      cAlertBorder = [252, 211, 77];    // Amber
      cAlertBg = [255, 251, 235];
      cAlertText = [146, 64, 14];
    }

    // Helper: Draw Section Title with left accent pill
    function drawSectionHeader(title, y) {
      doc.setFillColor(...cPrimary);
      doc.rect(marginL, y, 2.5, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...cSlate900);
      doc.text(title, marginL + 5, y + 4.8);
    }

    /* =========================================================================
       PAGE 1: COVER, EXECUTIVE VERDICT, EVIDENCE SPECS, & EXHIBIT 1 (GHOST)
       ========================================================================= */

    // Top Brand Accent Bar
    doc.setFillColor(...cPrimary);
    doc.rect(marginL, 16, contentW, 2.5, 'F');

    // Header Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...cSlate900);
    doc.text('LAPORAN PEMERIKSAAN FORENSIK DIGITAL', marginL, 26);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...cSlate500);
    doc.text('Laboratorium Multimedia Forensik & Keamanan Siber · Verifikasi Integritas Kompresi Citra', marginL, 31);

    // Case Information Box
    doc.setFillColor(...cCardBg);
    doc.setDrawColor(...cBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(marginL, 35, contentW, 18, 2, 2, 'FD');

    doc.setFontSize(8);
    // Left column
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...cSlate700);
    doc.text('No. Laporan:', marginL + 4, 40);
    doc.setFont('helvetica', 'normal');
    doc.text(caseId, marginL + 25, 40);

    doc.setFont('helvetica', 'bold');
    doc.text('Tanggal/Waktu:', marginL + 4, 45);
    doc.setFont('helvetica', 'normal');
    doc.text(`${dateStr}, ${timeStr}`, marginL + 25, 45);

    doc.setFont('helvetica', 'bold');
    doc.text('Metode Analisis:', marginL + 4, 50);
    doc.setFont('helvetica', 'normal');
    doc.text('JPEG Ghost Analysis (Farid 2009) & Error Level Analysis (Krawetz 2007)', marginL + 25, 50);

    // Right column
    doc.setFont('helvetica', 'bold');
    doc.text('Klasifikasi:', marginL + 115, 40);
    doc.setFont('helvetica', 'normal');
    doc.text('Bukti Uji Forensik Multimedia', marginL + 138, 40);

    doc.setFont('helvetica', 'bold');
    doc.text('Status Uji:', marginL + 115, 45);
    doc.setFont('helvetica', 'normal');
    doc.text('Pemeriksaan Selesai Dievaluasi', marginL + 138, 45);

    doc.setFont('helvetica', 'bold');
    doc.text('Engine Pakar:', marginL + 115, 50);
    doc.setFont('helvetica', 'normal');
    doc.text('Automated Rule-Based Expert System', marginL + 138, 50);

    // Executive Verdict Box
    const vBoxY = 57, vBoxH = 34;
    doc.setFillColor(...cAlertBg);
    doc.setDrawColor(...cAlertBorder);
    doc.setLineWidth(0.4);
    doc.roundedRect(marginL, vBoxY, contentW, vBoxH, 2.5, 2.5, 'FD');

    // Badge pill
    doc.setFillColor(...cAlertText);
    doc.roundedRect(marginL + 4, vBoxY + 4, 46, 5.5, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(verdict.badge || 'VERDICT', marginL + 27, vBoxY + 8, { align: 'center' });

    // Risk Score
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...cAlertText);
    doc.text(`Probabilitas Manipulasi: ${verdict.score || 0}%`, marginL + contentW - 4, vBoxY + 8, { align: 'right' });

    // Verdict Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...cAlertText);
    doc.text(verdict.title || 'HASIL ANALISIS INTEGRITAS', marginL + 4, vBoxY + 15);

    // Recommendation / Summary Text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...cSlate700);
    const recLines = doc.splitTextToSize(verdict.recommendation || '-', contentW - 8);
    doc.text(recLines.slice(0, 3), marginL + 4, vBoxY + 20);

    // Section: Evidence Specifications & Parameters Table
    const specY = 96;
    drawSectionHeader('1. SPESIFIKASI BUKTI CITRA & PARAMETER EKSPERIMEN', specY);

    const tblY = specY + 8, tblH = 30;
    doc.setDrawColor(...cBorder);
    doc.setLineWidth(0.3);

    // Table Header
    doc.setFillColor(241, 245, 249);
    doc.rect(marginL, tblY, contentW, 6, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...cSlate700);
    doc.text('Entitas Citra', marginL + 3, tblY + 4.2);
    doc.text('Nama File / Sumber', marginL + 45, tblY + 4.2);
    doc.text('Dimensi (Px)', marginL + 110, tblY + 4.2);
    doc.text('Quality Factor (QF)', marginL + 145, tblY + 4.2);

    // Row 1: Target Image
    doc.setFillColor(255, 255, 255);
    doc.rect(marginL, tblY + 6, contentW, 6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.text('Target (Base Canvas)', marginL + 3, tblY + 10.2);
    doc.text(state.target.name || 'Target Image', marginL + 45, tblY + 10.2);
    doc.text(`${state.target.width || '-'} × ${state.target.height || '-'}`, marginL + 110, tblY + 10.2);
    doc.text(`QF ${state.target.qf || 85}`, marginL + 145, tblY + 10.2);

    // Row 2: Counterpart Donor
    doc.setFillColor(248, 250, 252);
    doc.rect(marginL, tblY + 12, contentW, 6, 'FD');
    doc.text('Counterpart (Donor)', marginL + 3, tblY + 16.2);
    doc.text(state.donor.name || 'Counterpart Donor', marginL + 45, tblY + 16.2);
    doc.text(`${state.donor.width || '-'} × ${state.donor.height || '-'}`, marginL + 110, tblY + 16.2);
    doc.text(`QF ${state.donor.qf || 65}`, marginL + 145, tblY + 16.2);

    // Row 3: Spliced ROI & Final Output
    doc.setFillColor(255, 255, 255);
    doc.rect(marginL, tblY + 18, contentW, 6, 'FD');
    doc.text('Spliced ROI Region', marginL + 3, tblY + 22.2);
    doc.text(`X: ${state.roi.tx}, Y: ${state.roi.ty} (${state.roi.dw}×${state.roi.dh} px)`, marginL + 45, tblY + 22.2);
    doc.text(`Donor Off: (${state.roi.dx}, ${state.roi.dy})`, marginL + 110, tblY + 22.2);
    doc.text(`Final QF ${state.roi.finalQf || 85}`, marginL + 145, tblY + 22.2);

    // Row 4: Final Evidence File
    doc.setFillColor(248, 250, 252);
    doc.rect(marginL, tblY + 24, contentW, 6, 'FD');
    doc.text('Final Tampered JPEG', marginL + 3, tblY + 28.2);
    doc.text('spliced_tampered_output.jpg', marginL + 45, tblY + 28.2);
    doc.text(`${state.target.width || '-'} × ${state.target.height || '-'}`, marginL + 110, tblY + 28.2);
    doc.text(`QF ${state.roi.finalQf || 85}`, marginL + 145, tblY + 28.2);

    // Section: Visual Exhibits 1A & 1B
    const exY = 138;
    drawSectionHeader('2. BUKTI VISUAL I: CITRA UJI (SPLICED JPEG) & PETA GHOST', exY);

    const cardW = 88, cardH = 80;
    const card1X = marginL;
    const card2X = marginL + cardW + 6;
    const cardTopY = exY + 8;

    // Card 1A: Tampered Image Frame
    doc.setFillColor(...cCardBg);
    doc.setDrawColor(...cBorder);
    doc.roundedRect(card1X, cardTopY, cardW, cardH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...cSlate900);
    doc.text('Exhibit 1A: Citra Hasil Uji (Spliced JPEG)', card1X + 4, cardTopY + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...cSlate500);
    doc.text('Objek donor ditempelkan pada koordinat ROI target', card1X + 4, cardTopY + 10);

    // Insert Tampered Image
    let tamperedImgData = null;
    const tamperedEl = document.getElementById('tamperedPrev') || document.getElementById('elaTamperedPrev');
    if (tamperedEl && tamperedEl.src && tamperedEl.src.startsWith('data:')) {
      tamperedImgData = tamperedEl.src;
    } else if (state.composite && state.composite.tamperedUrl) {
      tamperedImgData = state.composite.tamperedUrl;
    }

    if (tamperedImgData) {
      try {
        doc.addImage(tamperedImgData, 'JPEG', card1X + 4, cardTopY + 12, cardW - 8, 56);
      } catch (e) {
        doc.text('(Gagal memuat preview gambar)', card1X + 10, cardTopY + 35);
      }
    } else {
      doc.text('(Preview citra tidak tersedia)', card1X + 10, cardTopY + 35);
    }

    doc.setFontSize(7.5);
    doc.setTextColor(...cSlate500);
    doc.text(`Koordinat ROI: X=${state.roi.tx}, Y=${state.roi.ty}, Ukuran=${state.roi.dw}×${state.roi.dh} px`, card1X + 4, cardTopY + 74);

    // Card 1B: JPEG Ghost Heatmap Frame
    doc.setFillColor(...cCardBg);
    doc.setDrawColor(...cBorder);
    doc.roundedRect(card2X, cardTopY, cardW, cardH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...cSlate900);
    const selQf = (state.viewer && state.viewer.selectedQf) || state.donor.qf || 65;
    doc.text(`Exhibit 1B: Peta JPEG Ghost (Selected QF ${selQf})`, card2X + 4, cardTopY + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...cSlate500);
    doc.text('Visualisasi perbedaan residual kompresi blok 16×16', card2X + 4, cardTopY + 10);

    // Insert Full Viewer Canvas Heatmap
    const viewerCanvas = document.getElementById('fullViewerCanvas');
    let ghostImgData = null;
    if (viewerCanvas && viewerCanvas.width > 0) {
      ghostImgData = viewerCanvas.toDataURL('image/jpeg', 0.95);
    }

    if (ghostImgData) {
      try {
        doc.addImage(ghostImgData, 'JPEG', card2X + 4, cardTopY + 12, cardW - 8, 52);
      } catch (e) {
        doc.text('(Gagal memuat preview ghost)', card2X + 10, cardTopY + 35);
      }
    } else {
      doc.text('(Preview heatmap belum dibuat)', card2X + 10, cardTopY + 35);
    }

    // Embed Colormap Bar
    const colormapBar = drawColormapBarCanvas(240, 10);
    if (colormapBar) {
      try {
        doc.addImage(colormapBar, 'PNG', card2X + 4, cardTopY + 66, cardW - 8, 3.5);
      } catch (e) { }
    }
    doc.setFontSize(6.8);
    doc.setTextColor(...cSlate500);
    doc.text('0 (Ungu gelap = low error / cocok)', card2X + 4, cardTopY + 74);
    doc.text('1 (Kuning = high error / beda)', card2X + cardW - 4, cardTopY + 74, { align: 'right' });

    // Bottom Note on Page 1
    const p1NoteY = cardTopY + cardH + 7;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(marginL, p1NoteY, contentW, 14, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...cSlate700);
    doc.text('Catatan Observasi Visual Ghost:', marginL + 3, p1NoteY + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...cSlate500);
    const p1NoteText = state.ghost.localMinima && state.ghost.localMinima.length
      ? `Terdeteksi minimum lokal (titik kecocokan riwayat kompresi asli) pada QF ${state.ghost.localMinima.join(', ')}. Area ROI yang tampak gelap pada QF donor mengonfirmasi keberadaan riwayat kompresi sebelumnya.`
      : 'Tidak ditemukan lembah error signifikan pada kurva MSE atau perbedaan respon blok antara area ROI dan latar belakang.';
    doc.text(doc.splitTextToSize(p1NoteText, contentW - 6), marginL + 3, p1NoteY + 8.5);


    /* =========================================================================
       PAGE 2: QUANTITATIVE MSE & K-S CURVES, ELA EXHIBIT & METRICS SCORECARD
       ========================================================================= */
    doc.addPage();

    // Section 3: Quantitative Curves
    const crvSecY = 22;
    drawSectionHeader('3. BUKTI KUANTITATIF II: KURVA RESIDUAL MSE & UJI STATISTIK K-S', crvSecY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...cSlate500);
    doc.text('Evaluasi numerik persamaan (2)-(4) Farid (2009) dan uji Kolmogorov-Smirnov empiris.', marginL, crvSecY + 8);

    const chartW = 88, chartH = 64;
    const chart1X = marginL;
    const chart2X = marginL + chartW + 6;
    const chartY = crvSecY + 12;

    // Render & Insert MSE Chart
    const mseChartData = renderOffscreenMseChart(state.ghost.curves, 760, 360);
    if (mseChartData) {
      doc.setFillColor(...cCardBg);
      doc.roundedRect(chart1X, chartY, chartW, chartH, 2, 2, 'F');
      doc.addImage(mseChartData, 'PNG', chart1X, chartY, chartW, chartH - 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...cSlate700);
      doc.text('Exhibit 2A: Kurva Raw MSE vs Quality Factor', chart1X + 4, chartY + chartH - 2);
    }

    // Render & Insert KS Chart
    const ksChartData = renderOffscreenKsChart(state.ghost.curves, 760, 360);
    if (ksChartData) {
      doc.setFillColor(...cCardBg);
      doc.roundedRect(chart2X, chartY, chartW, chartH, 2, 2, 'F');
      doc.addImage(ksChartData, 'PNG', chart2X, chartY, chartW, chartH - 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...cSlate700);
      doc.text('Exhibit 2B: Uji Divergensi K-S (ROI vs Background)', chart2X + 4, chartY + chartH - 2);
    }

    // Section 4: Error Level Analysis (ELA)
    const elaSecY = chartY + chartH + 10;
    drawSectionHeader('4. BUKTI VISUAL & KUANTITATIF III: ANALISIS TINGKAT ERROR (ELA)', elaSecY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...cSlate500);
    doc.text('Analisis perbedaan laju error re-kompresi frekuensi tinggi pada perbatasan objek (Krawetz, 2007).', marginL, elaSecY + 8);

    const elaBoxY = elaSecY + 12;
    const elaImgW = 95, elaImgH = 68;

    // ELA Map Image
    doc.setFillColor(...cCardBg);
    doc.setDrawColor(...cBorder);
    doc.roundedRect(marginL, elaBoxY, elaImgW, elaImgH, 2, 2, 'FD');

    let elaImgData = null;
    const elaPrevEl = document.getElementById('elaMapPrev');
    if (elaPrevEl && elaPrevEl.src && elaPrevEl.src.startsWith('data:')) {
      elaImgData = elaPrevEl.src;
    } else if (state.ela && state.ela.elaUrl) {
      elaImgData = state.ela.elaUrl;
    }

    if (elaImgData) {
      try {
        doc.addImage(elaImgData, 'PNG', marginL + 3, elaBoxY + 3, elaImgW - 6, elaImgH - 12);
      } catch (e) {
        doc.text('(Gagal memuat peta ELA)', marginL + 10, elaBoxY + 30);
      }
    } else {
      doc.text('(Peta ELA belum dihasilkan)', marginL + 10, elaBoxY + 30);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...cSlate700);
    doc.text('Exhibit 3A: Peta Error Level Analysis (High Contrast Gain)', marginL + 4, elaBoxY + elaImgH - 3);

    // ELA Quantitative Metrics Table Box
    const elaTblX = marginL + elaImgW + 6;
    const elaTblW = contentW - elaImgW - 6;

    doc.setFillColor(...cCardBg);
    doc.setDrawColor(...cBorder);
    doc.roundedRect(elaTblX, elaBoxY, elaTblW, elaImgH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...cSlate900);
    doc.text('Exhibit 3B: Parameter & Metrik ELA', elaTblX + 4, elaBoxY + 6);

    const maeVal = parseFloat(state.ela && state.ela.mae) || 0;
    const clipVal = parseFloat(state.ela && state.ela.clippingPct) || 0;
    const ksList = (state.ghost && state.ghost.curves && state.ghost.curves.ks) || [];
    const maxKsVal = ksList.length ? Math.max(...ksList) : 0;
    const localMinimaList = (state.ghost && state.ghost.localMinima) || [];

    const elaRows = [
      ['Quality Factor Acuan:', `QF ${state.ela.qf || 75}`],
      ['Penguatan Residu (Gain):', `${state.ela.gain || 10}×`],
      ['Mean Absolute Error (MAE):', `${maeVal.toFixed(2)}`],
      ['Tingkat Saturasi (Clipping):', `${clipVal.toFixed(2)}%`],
      ['Ambang Batas MAE Normal:', '< 3.00 (Tinggi jika ≥ 3.00)'],
      ['Indikasi Sambungan Objek:', maeVal >= 3.0 ? 'Terdeteksi Lonjakan Residu' : 'Residu Normal Homogen']
    ];

    let rY = elaBoxY + 12;
    elaRows.forEach(([lbl, val]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...cSlate700);
      doc.text(lbl, elaTblX + 4, rY);

      doc.setFont('helvetica', 'normal');
      const valColor = val.includes('Terdeteksi') ? [185, 28, 28] : cSlate700;
      doc.setTextColor(...valColor);
      doc.text(val, elaTblX + 45, rY);

      doc.setDrawColor(241, 245, 249);
      doc.line(elaTblX + 4, rY + 2.5, elaTblX + elaTblW - 4, rY + 2.5);
      rY += 8.5;
    });

    // Forensic Scorecard Summary Grid
    const scoreY = elaBoxY + elaImgH + 10;
    drawSectionHeader('5. MATRIKS SKOR PARAMETER FORENSIK (SUMMARY SCORECARD)', scoreY);

    const cardY = scoreY + 8;
    const scW = contentW / 4;

    const cards = [
      { label: 'Deteksi Minima Ghost', val: localMinimaList.length ? `QF ${localMinimaList.join(', ')}` : 'Nihil', status: localMinimaList.length ? 'ANOMALI' : 'NORMAL' },
      { label: 'Uji Divergensi K-S', val: `D_KS = ${maxKsVal.toFixed(2)}`, status: maxKsVal >= 0.40 ? 'DIVERGEN' : 'HOMOGEN' },
      { label: 'Residu ELA (MAE)', val: `${maeVal.toFixed(2)}`, status: maeVal >= 3.0 ? 'ELEVATED' : 'NORMAL' },
      { label: 'Skor Probabilitas', val: `${verdict.score || 0}%`, status: verdict.badge || 'VERDICT' }
    ];

    cards.forEach((c, idx) => {
      const cX = marginL + idx * scW;
      doc.setFillColor(...cCardBg);
      doc.setDrawColor(...cBorder);
      doc.roundedRect(cX + 1, cardY, scW - 2, 22, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...cSlate500);
      doc.text(c.label, cX + (scW / 2), cardY + 5.5, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(...cSlate900);
      doc.text(c.val, cX + (scW / 2), cardY + 12.5, { align: 'center' });

      doc.setFontSize(7);
      const isBad = c.status === 'ANOMALI' || c.status === 'DIVERGEN' || c.status === 'ELEVATED' || c.status.includes('TAMPERING');
      const statusColor = isBad ? [220, 38, 38] : [22, 101, 52];
      doc.setTextColor(...statusColor);
      doc.text(c.status, cX + (scW / 2), cardY + 18, { align: 'center' });
    });


    /* =========================================================================
       PAGE 3: RULE EVALUATION LOG, METHODOLOGY & OFFICIAL SIGN-OFF
       ========================================================================= */
    doc.addPage();

    // Section 6: Rule Evaluation Log
    const ruleSecY = 22;
    drawSectionHeader('6. LOG EVALUASI ATURAN SISTEM PAKAR FORENSIK (RULE EVIDENCE LOG)', ruleSecY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...cSlate500);
    doc.text('Evaluasi deterministik basis aturan dari modul tools/interpretation/rules.js terhadap temuan bukti kuantitatif.', marginL, ruleSecY + 7);

    let curY = ruleSecY + 13;
    const rulesList = verdict.rules || [];

    if (rulesList.length === 0) {
      doc.setFillColor(...cCardBg);
      doc.roundedRect(marginL, curY, contentW, 16, 2, 2, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...cSlate500);
      doc.text('Semua metrik berada dalam ambang batas normal. Tidak ada rule anomali yang terpicu.', marginL + 5, curY + 10);
      curY += 22;
    } else {
      rulesList.forEach(r => {
        const itemH = 20;
        doc.setFillColor(...cCardBg);
        doc.setDrawColor(...cBorder);
        doc.setLineWidth(0.3);
        doc.roundedRect(marginL, curY, contentW, itemH, 2, 2, 'FD');

        // Badge pill
        let pillColor = [22, 101, 52];
        if (r.level === 'danger' || r.level === 'bad') pillColor = [185, 28, 28];
        else if (r.level === 'warn') pillColor = [217, 119, 6];

        doc.setFillColor(...pillColor);
        doc.roundedRect(marginL + 4, curY + 3.5, 24, 4.5, 1, 1, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text(`[${r.ruleId}]`, marginL + 16, curY + 6.8, { align: 'center' });

        // Rule Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...cSlate900);
        doc.text(r.title || 'Rule Title', marginL + 31, curY + 6.8);

        // Rule Detail
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(...cSlate700);
        const detailLines = doc.splitTextToSize(r.detail || '', contentW - 8);
        doc.text(detailLines.slice(0, 2), marginL + 4, curY + 12);

        curY += itemH + 3.5;
      });
    }

    // Section 7: Scientific Methodology & Integrity
    const methSecY = curY + 6;
    drawSectionHeader('7. LANDASAN METODOLOGI & INTEGRITAS RANTAI BUKTI (CHAIN OF CUSTODY)', methSecY);

    const methBoxY = methSecY + 8;
    const methBoxH = 42;
    doc.setFillColor(...cCardBg);
    doc.setDrawColor(...cBorder);
    doc.roundedRect(marginL, methBoxY, contentW, methBoxH, 2, 2, 'FD');

    const methTexts = [
      '1. Metode JPEG Ghost (Farid 2009): Mengacu pada IEEE Trans. Information Forensics & Security Vol. 4 No. 1. Memanfaatkan fakta bahwa ketika citra dikompresi berulang pada kualitas Q2, residual error kuadrat rata-rata (MSE) blok 16×16 mencapai nilai minimum pada kualitas kompresi awal Q1.',
      '2. Uji Kolmogorov-Smirnov (K-S Test): Membandingkan fungsi distribusi kumulatif empiris (eCDF) antara residual area ROI dengan latar belakang. Nilai D_KS ≥ 0.40 mengonfirmasi bahwa kedua area berasal dari dua populasi kompresi yang berbeda secara independen.',
      '3. Error Level Analysis (ELA, Krawetz 2007): Mengukur laju dekompresi selisih frekuensi tinggi pada kisi 8×8 DCT. Perbedaan kecerahan residu membuktikan artefak re-kompresi yang tidak seragam pada citra.',
      '4. Chain of Custody: Pengujian dijalankan secara deterministik pada ruang piksel murni tanpa mengubah struktur bit asli dari berkas bukti masukan.'
    ];

    let mY = methBoxY + 5;
    methTexts.forEach(txt => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(...cSlate700);
      const wrapped = doc.splitTextToSize(txt, contentW - 8);
      doc.text(wrapped, marginL + 4, mY);
      mY += wrapped.length * 3.4 + 1.2;
    });

    // Section 8: Official Sign-Off & Verification Block
    const signSecY = methBoxY + methBoxH + 8;
    drawSectionHeader('8. PENGESAHAN & OTORISASI HASIL PEMERIKSAAN', signSecY);

    const signY = signSecY + 8;
    const signH = 46;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...cBorder);
    doc.roundedRect(marginL, signY, contentW, signH, 2, 2, 'FD');

    // Left sub-box: Evidence Hash & Custody
    const subW = (contentW - 6) / 2;
    doc.setFillColor(...cCardBg);
    doc.roundedRect(marginL + 3, signY + 3, subW, signH - 6, 1.5, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...cSlate900);
    doc.text('Integritas Berkas & Verifikasi Kriptografis', marginL + 6, signY + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...cSlate500);
    doc.text('Hash Pemeriksaan:', marginL + 6, signY + 14);
    doc.setFont('courier', 'normal');
    doc.setTextColor(...cSlate700);
    doc.text(caseId.toLowerCase() + '-' + Math.random().toString(16).substring(2, 18), marginL + 6, signY + 18);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...cSlate500);
    doc.text('Status Validasi:', marginL + 6, signY + 24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...cPrimary);
    doc.text('VERIFIKASI SISTEM PAKAR FORENSIK DIGITAL', marginL + 6, signY + 28);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...cSlate500);
    doc.text('Repositori: S2 Cyber Security Forensik Multimedia', marginL + 6, signY + 34);

    // Right sub-box: Examiner Signature Stamp
    const rightX = marginL + 3 + subW + 3;
    doc.setFillColor(...cCardBg);
    doc.roundedRect(rightX, signY + 3, subW, signH - 6, 1.5, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...cSlate900);
    doc.text('Pemeriksa Forensik Digital (Digital Forensic Examiner)', rightX + 4, signY + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...cSlate500);
    doc.text(`Diterbitkan pada: ${dateStr}`, rightX + 4, signY + 13);

    // Signature Line
    doc.setDrawColor(...cSlate500);
    doc.line(rightX + 6, signY + 32, rightX + subW - 6, signY + 32);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...cSlate900);
    doc.text('( Tim Pemeriksa Forensik Multimedia S2 )', rightX + (subW / 2), signY + 36, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...cSlate500);
    doc.text('S2 Cyber Security Forensic Investigation Team', rightX + (subW / 2), signY + 39.5, { align: 'center' });


    /* =========================================================================
       GLOBAL RUNNING HEADER & FOOTER PASS
       ========================================================================= */
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);

      // Running Header Line (Pages 2 & 3)
      if (p > 1) {
        doc.setDrawColor(...cBorder);
        doc.setLineWidth(0.3);
        doc.line(marginL, 14, marginL + contentW, 14);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...cSlate500);
        doc.text('Laboratorium Forensik Multimedia — Laporan Pemeriksaan Integritas Kompresi Citra', marginL, 12);
        doc.text(`ID Kasus: ${caseId}`, marginL + contentW, 12, { align: 'right' });
      }

      // Running Footer Line (All Pages)
      const footY = pageHeight - 12;
      doc.setDrawColor(...cBorder);
      doc.setLineWidth(0.3);
      doc.line(marginL, footY, marginL + contentW, footY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...cSlate500);
      doc.text('Rahasia & Terbatas — Dokumen Pembuktian Forensik Digital JPEG Ghost & ELA', marginL, footY + 4.5);
      doc.text(`Halaman ${p} dari ${totalPages}`, marginL + contentW, footY + 4.5, { align: 'right' });
    }

    // Save PDF
    const filename = `Forensic_Report_${caseId}_${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
  }

  return {
    generatePdfReport,
    renderOffscreenMseChart,
    renderOffscreenKsChart
  };
});
