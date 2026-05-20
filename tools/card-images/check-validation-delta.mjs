#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../');
const reportPath = path.join(ROOT, 'data', 'card-images', 'image-validation.json');
const baselinePath = path.join(ROOT, 'data', 'card-images', 'image-validation.baseline.json');

function pickTotals(report) {
  const totals = report?.totals ?? {};
  return {
    cardsScanned: Number(totals.cardsScanned ?? 0),
    cardsWithImageMetadata: Number(totals.cardsWithImageMetadata ?? 0),
    remoteCandidateCount: Number(totals.remoteCandidateCount ?? 0),
    unresolvedCards: Number(totals.unresolvedCards ?? 0)
  };
}

async function loadJson(file) {
  const raw = await readFile(file, 'utf-8');
  return JSON.parse(raw);
}

async function main() {
  const current = pickTotals(await loadJson(reportPath));
  let baseline;
  try {
    baseline = pickTotals(await loadJson(baselinePath));
  } catch {
    console.log('No baseline found. Add data/card-images/image-validation.baseline.json to enable delta checks.');
    console.log(JSON.stringify({ current }, null, 2));
    return;
  }

  const delta = {
    cardsScanned: current.cardsScanned - baseline.cardsScanned,
    cardsWithImageMetadata: current.cardsWithImageMetadata - baseline.cardsWithImageMetadata,
    remoteCandidateCount: current.remoteCandidateCount - baseline.remoteCandidateCount,
    unresolvedCards: current.unresolvedCards - baseline.unresolvedCards
  };

  console.log(JSON.stringify({ baseline, current, delta }, null, 2));

  if (current.unresolvedCards > baseline.unresolvedCards) {
    console.error(`Unresolved cards regressed: baseline=${baseline.unresolvedCards} current=${current.unresolvedCards}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
