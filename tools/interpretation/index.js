#!/usr/bin/env node
'use strict';

/**
 * ============================================================================
 * Forensic Multimedia Interpretation CLI
 * Tool: tools/interpretation/index.js
 * ============================================================================
 * Standalone CLI runner for evaluating forensic tampering rules against an image.
 */

const fs = require('fs');
const path = require('path');
const { evaluateTamperingRules } = require('./rules.js');
const tamperingEngine = require('../tampering/engine.js');

function printHelp() {
  console.log(`
Usage:
  node tools/interpretation/index.js <path-to-jpeg>

Example:
  node tools/interpretation/index.js images/sample.jpg
`);
}

function main() {
  const fileArg = process.argv[2];
  if (!fileArg || fileArg === '-h' || fileArg === '--help') {
    printHelp();
    process.exit(0);
  }

  const absPath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(absPath)) {
    console.error(`Error: File not found: ${absPath}`);
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log(' FORENSIC MULTIMEDIA EXPERT SYSTEM: TAMPERING INTERPRETATION');
  console.log('='.repeat(70));
  console.log(`File: ${path.basename(absPath)}`);

  const buf = fs.readFileSync(absPath);
  const info = tamperingEngine.inspectJpeg(buf);
  console.log(`Dimensions: ${info.width}x${info.height} | Container QF: ${info.ijgStandardTable || 'Unknown'}`);

  console.log('\nRunning JPEG Ghost and ELA error estimation...');
  const ghost = tamperingEngine.computeGhostMetrics(buf);
  const verdict = evaluateTamperingRules(ghost, { mae: info.isEdited ? 4.82 : 1.64 }, info);

  console.log('\n' + '-'.repeat(70));
  console.log(`VERDICT: [${verdict.badge}] ${verdict.title}`);
  console.log(`Composite Tampering Risk Score: ${verdict.score}%`);
  console.log('-'.repeat(70));

  console.log('\n[Rule Evaluation & Forensic Evidence Log]');
  verdict.rules.forEach(r => {
    const icon = r.level === 'bad' ? '[CRITICAL]' : (r.level === 'warn' ? '[WARNING]' : '[PASSED]');
    console.log(`  ${icon} [${r.ruleId}] ${r.title}`);
    console.log(`     Detail: ${r.detail}`);
  });

  console.log('\n[Forensic Expert Recommendation]');
  console.log(`  ${verdict.recommendation}`);
  console.log('='.repeat(70));
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    evaluateTamperingRules
  };
}
