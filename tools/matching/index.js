#!/usr/bin/env node
'use strict';
/* ============================================================================
 * tools/matching/index.js — CLI & Module for JPEG Forensic Signature Matching
 * ============================================================================ */

const fs = require('fs');
const path = require('path');
const engine = require('./engine.js');

/* Terminal ANSI Colors */
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m\x1b[37m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgYellow: '\x1b[43m\x1b[30m',
  bgBlue: '\x1b[44m\x1b[37m'
};

function formatDqtMatrix(dqt) {
  if (!dqt) return '';
  const out = [];
  const names = { 0: 'Luminance (Tq0)', 1: 'Chrominance (Tq1)', 2: 'Chrominance-2 (Tq2)' };
  for (const [id, m] of Object.entries(dqt)) {
    out.push(`  ${c.cyan}--- ${names[id] || 'Table ' + id} ---${c.reset}`);
    for (let r = 0; r < 8; r++) {
      const row = m.slice(r * 8, r * 8 + 8).map(v => String(v).padStart(4)).join(' ');
      out.push(`   ${c.dim}${row}${c.reset}`);
    }
  }
  return out.join('\n');
}

function printCliReport(res, showMatrix = false) {
  const line = '═'.repeat(74);
  const sep = '─'.repeat(74);

  console.log(`\n${c.bold}${c.blue}${line}${c.reset}`);
  console.log(`${c.bold}${c.white}   🔍 JPEG FORENSIC SIGNATURE MATCHING REPORT (Kee, Johnson & Farid 2011)${c.reset}`);
  console.log(`${c.bold}${c.blue}${line}${c.reset}\n`);

  // Target Evidence File
  console.log(`${c.bold}${c.cyan}📁 TARGET EVIDENCE FILE:${c.reset}`);
  console.log(`   File:        ${c.bold}${res.file}${c.reset}`);
  console.log(`   Size:        ${(res.size / 1024).toFixed(1)} KB (${res.size.toLocaleString()} bytes)`);
  console.log(`   Resolution:  ${res.claimed.dimensions}`);
  console.log(`   Orientation: ${res.claimed.orientation} (${res.queryRecord.orientationCategory})`);

  // Claimed Device EXIF
  console.log(`\n${c.bold}${c.cyan}📷 CLAIMED DEVICE (EXIF METADATA):${c.reset}`);
  console.log(`   Device Name: ${c.bold}${res.claimed.device || c.yellow + 'Unknown / Not in EXIF' + c.reset}${c.reset}`);
  console.log(`   Make:        ${res.claimed.make || '-'}`);
  console.log(`   Model:       ${res.claimed.model || '-'} ${res.claimed.rawModel && res.claimed.rawModel !== res.claimed.model ? '[' + res.claimed.rawModel + ']' : ''}`);
  console.log(`   Firmware/SW: ${res.claimed.software || '-'}`);

  // 576-Feature Signature Vector
  console.log(`\n${c.bold}${c.cyan}🧬 COMPRESSION SIGNATURES (576 FEATURES):${c.reset}`);
  console.log(`   DQT Key (192):  ${c.bold}${c.magenta}${res.signatures.dqtKey}${c.reset}`);
  console.log(`   Full Key (576): ${c.bold}${c.magenta}${res.signatures.fullKey}${c.reset}`);
  console.log(`   EXIF Checksum:  ${c.bold}${c.magenta}${res.signatures.exifChecksum || '-'}${c.reset}`);
  console.log(`   Quality Factor: ${res.signatures.estimatedQuality}`);
  console.log(`   Subsampling:    ${res.signatures.subsampling} (${res.signatures.jpegType})`);
  console.log(`   Thumbnail JPEG: ${res.signatures.thumbnailPresent ? 'Present (284 features)' : 'Absent'}`);
  console.log(`   EXIF IFD Count: ${res.signatures.exifIFDCounts.join(', ')} (8 features)`);

  // Duplicate Check against catalog
  if (res.duplicate && res.duplicate.isDuplicate) {
    console.log(`\n${c.bgYellow}${c.bold} ℹ️  CATALOG DUPLICATE DETECTED ${c.reset}`);
    console.log(`   ${c.yellow}EXIF checksum matches existing sample in database: ${c.bold}${res.duplicate.duplicateOf}${c.reset}`);
  }

  // Anti-Tampering Check
  if (res.tampering.edited || (res.tampering.traces && res.tampering.traces.length)) {
    console.log(`\n${c.bgRed}${c.bold} ⚠️  ANTI-TAMPERING & RE-ENCODING TRACES FOUND ${c.reset}`);
    (res.tampering.traces || []).forEach(t => {
      console.log(`   ${c.red}• ${t}${c.reset}`);
    });
    console.log(`   ${c.dim}Note: Third-party editor detected; compression signatures reflect software rather than camera hardware.${c.reset}`);
  } else {
    console.log(`\n${c.green}✔ Anti-Tampering Screening: Clean (No third-party editor tags or Photoshop/Adobe/IJG traces)${c.reset}`);
  }

  // Forensic Match Verdict
  const v = res.verdict;
  const badgeColor = v.level === 'ok' ? c.bgGreen : v.level === 'warn' ? c.bgYellow : v.level === 'bad' ? c.bgRed : c.bgBlue;
  console.log(`\n${c.bold}${c.cyan}⚖️  FORENSIC AUTHENTICATION VERDICT:${c.reset}`);
  console.log(`   ${badgeColor}${c.bold} ${v.title} ${c.reset}`);
  console.log(`   ${c.bold}Detail:${c.reset} ${v.detail}`);
  if (v.matchedDevices.length) {
    console.log(`   ${c.bold}Matched Devices in Catalog:${c.reset} ${c.green}${v.matchedDevices.join(', ')}${c.reset}`);
  }

  // Nearest Candidate Devices Table
  console.log(`\n${c.bold}${c.cyan}📊 NEAREST CATALOG CANDIDATES (DQT L1 DISTANCE & SIMILARITY):${c.reset}`);
  console.log(`   ${'Device Name'.padEnd(38)} ${'Distance'.padEnd(12)} ${'Similarity'.padEnd(12)}`);
  console.log(`   ${sep.slice(0, 64)}`);
  (res.rankedCandidates || []).slice(0, 6).forEach(cand => {
    const isClaimed = cand.device === res.claimed.device;
    const devName = (isClaimed ? `★ ${cand.device}` : `  ${cand.device}`).padEnd(38);
    const distStr = cand.distance === Infinity ? '-' : cand.distance.toFixed(2);
    const simStr = `${cand.similarity.toFixed(1)}%`;
    const col = cand.distance <= 1.0 ? c.green : cand.distance <= 2.0 ? c.yellow : c.white;
    console.log(`   ${col}${devName} ${distStr.padEnd(12)} ${simStr.padEnd(12)}${c.reset}`);
  });

  // 5-Component Feature Verification Breakdown
  console.log(`\n${c.bold}${c.cyan}🔬 5-COMPONENT BREAKDOWN (576 FEATURES):${c.reset}`);
  res.componentComparison.forEach(comp => {
    const statusCol = comp.claimedDeviceStatus === 'exact match' ? c.green : comp.claimedDeviceStatus.includes('same make') ? c.yellow : c.dim;
    console.log(`   • ${comp.component.padEnd(36)} -> ${statusCol}${comp.claimedDeviceStatus}${c.reset} (${comp.matchingCatalogDevices.length} catalog devices match)`);
  });

  if (showMatrix) {
    console.log(`\n${c.bold}${c.cyan}🔢 QUANTIZATION MATRICES (DQT 8x8):${c.reset}`);
    console.log(formatDqtMatrix(res.dqt));
  }

  console.log(`\n${c.bold}${c.blue}${line}${c.reset}\n`);
}

function runCli() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(`
${c.bold}JPEG Forensic Signature Matching CLI Tool${c.reset}
Usage:
  node tools/matching.js <image-path> [options]
  node tools/matching <image-path> [options]

Options:
  --catalog <path>   Path to custom signatures.json catalog (default: signatures.json)
  --json             Output full forensic analysis result in JSON format
  --matrix           Print full 8x8 Quantization Tables (DQT) in terminal
  -h, --help         Show this help message

Examples:
  node tools/matching "images/DATASET INDAH/DSC_0803.JPG"
  node tools/matching "images/DATASET CIPUT/20261026_100806.jpg" --matrix
  node tools/matching "images/DATASET INDAH/MEITU_20260410_225449421.jpg"
  node tools/matching "images/Dataset Husni/Process_File Only_-_DSCF1025.jpg" --json
`);
    process.exit(0);
  }

  let imgPath = null, catPath = null, jsonOutput = false, showMatrix = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') jsonOutput = true;
    else if (a === '--matrix') showMatrix = true;
    else if (a === '--catalog' && args[i + 1]) { catPath = args[++i]; }
    else if (!imgPath && !a.startsWith('-')) { imgPath = a; }
  }

  if (!imgPath) {
    console.error(`${c.red}Error: Please specify an image path to analyze.${c.reset}`);
    process.exit(1);
  }

  try {
    const res = engine.matchFile(imgPath, catPath);
    if (res.valid === false) {
      console.error(`${c.red}Error analyzing file: ${res.error || 'Invalid JPEG or corrupted file'}${c.reset}`);
      process.exit(1);
    }
    if (jsonOutput) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      printCliReport(res, showMatrix);
    }
  } catch (err) {
    console.error(`${c.red}Execution failed: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

const isCli = require.main === module || (require.main && /matching(\.js)?$/.test(require.main.filename));
if (isCli) {
  runCli();
}

module.exports = {
  ...engine,
  runCli,
  printCliReport
};
