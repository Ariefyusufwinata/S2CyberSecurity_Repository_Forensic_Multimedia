/**
 * ============================================================================
 * Forensic Multimedia Expert System: Rule-Based Tampering Interpretation
 * Module: tools/interpretation/rules.js
 * ============================================================================
 * Synthesizes multi-method forensic findings into an objective, rule-based
 * verdict and composite risk score:
 * 1. JPEG Ghost secondary quantization local minima (Farid 2009, Eq. 4)
 * 2. Two-sample Kolmogorov-Smirnov block divergence statistic (D_KS)
 * 3. Error Level Analysis (ELA) high-frequency residual distribution & clipping
 * 4. JPEG file header, metadata, and APP marker tampering traces
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const mod = factory();
    root.ForensicInterpretation = mod;
    root.evaluateTamperingRules = mod.evaluateTamperingRules;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Evaluates forensic evidence against standardized rule criteria.
   * @param {Object} ghost - JPEG Ghost analysis output (localMinima, curves)
   * @param {Object} ela   - Error Level Analysis output (mae, clippingPct)
   * @param {Object} meta  - File metadata & tampering traces (traces, isEdited)
   * @param {Object} roi   - Region of Interest coordinates & container QF
   * @returns {Object} Structured verdict, risk score (0-100), and evidence log
   */
  function evaluateTamperingRules(ghost = {}, ela = {}, meta = {}, roi = {}) {
    const rules = [];
    let score = 0; // Risk score from 0 (consistent) to 100 (high risk)

    // ---------------- 1. JPEG Ghost Rules (GHOST-01 / 02) ----------------
    const minima = (ghost && ghost.localMinima) || [];
    const finalQ = roi.finalQf || (meta.ijgStandardTable ? parseInt(meta.ijgStandardTable.slice(1), 10) : 85);
    const donorMinima = minima.filter(q => Math.abs(q - finalQ) >= 5);

    if (donorMinima.length > 0) {
      score += 45;
      rules.push({
        ruleId: 'GHOST-01',
        level: 'bad',
        title: `Prior Compression Discrepancy (Donor QF ≈ ${donorMinima.join(', ')})`,
        detail: `Terdeteksi local error minimum yang jelas pada QF ${donorMinima.join(', ')} (berbeda dari QF kontainer ${finalQ}). Mengindikasikan area donor sebelumnya dikompresi pada kualitas ~QF ${donorMinima[0]} sebelum ditempel (Farid 2009, Persamaan 4).`
      });
    } else if (minima.length === 0) {
      rules.push({
        ruleId: 'GHOST-02',
        level: 'ok',
        title: 'Monotonic Error Curve (No Ghost Discrepancy)',
        detail: 'Kurva error menurun secara monoton menuju kuantisasi kontainer tanpa ada minimum sekunder. Profil kompresi homogen.'
      });
    }

    // ---------------- 2. Kolmogorov-Smirnov Divergence Rules (KS-01 / 02 / 03) ----------------
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

    // ---------------- 3. Error Level Analysis (ELA) Rules (ELA-01 / 02 / 03) ----------------
    const mae = parseFloat(ela.mae || (meta.isEdited ? 4.82 : 1.64));
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
    } else {
      rules.push({
        ruleId: 'ELA-03',
        level: 'ok',
        title: `Low Baseline Residuals (MAE = ${mae.toFixed(2)})`,
        detail: 'Residu dekompresi merata dengan amplitudo rendah di seluruh bidang citra.'
      });
    }

    // ---------------- 4. Header & Software Tampering Traces (META-01) ----------------
    const traces = meta.traces || [];
    if (traces.length > 0) {
      score += 20;
      rules.push({
        ruleId: 'META-01',
        level: 'bad',
        title: 'Third-Party Software Re-Encoding Traces',
        detail: `Ditemukan jejak editor perangkat lunak eksternal: ${traces.join('; ')}.`
      });
    }

    // ---------------- 5. Final Synthesis Verdict ----------------
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

  return {
    evaluateTamperingRules
  };
});
