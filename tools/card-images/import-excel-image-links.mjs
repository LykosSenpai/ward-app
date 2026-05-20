#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../');
const EXCEL_PATH = path.join(ROOT, 'ward gen3 pics + links.xlsx');
const REPORT_PATH = path.join(ROOT, 'docs', 'card-images', 'image-link-import-report.csv');
const OVERRIDES_PATH = path.join(ROOT, 'tools', 'card-images', 'import-excel-image-overrides.json');
const SKIP_PATH = path.join(ROOT, 'tools', 'card-images', 'import-excel-image-skip.json');

const SHEETS = ['legacy', 'g1e1', 'g1e2', 'gen1e3', 'g2e1', 'gen2e2', 'gen3e1', 'promo'];
const WIDTHS = [480, 720, 960, 1440];
const SHEET_TARGETS = {
  legacy: { generation: undefined, edition: undefined },
  g1e1: { generation: '1', edition: '1st edition' },
  g1e2: { generation: '1', edition: '2nd edition' },
  gen1e3: { generation: '1', edition: '3rd edition' },
  g2e1: { generation: '2', edition: '1st edition' },
  gen2e2: { generation: '2', edition: '2nd edition' },
  gen3e1: { generation: '3', edition: '1st edition' },
  promo: { generation: undefined, edition: undefined }
};

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEdition(value) {
  return String(value ?? '').trim().toLowerCase();
}

function upgradeWixImageUrl(url, targetWidth) {
  const match = String(url).match(/w_(\d+),h_(\d+)/);
  if (!match) return String(url);
  const originalWidth = Number(match[1]);
  const originalHeight = Number(match[2]);
  if (!Number.isFinite(originalWidth) || !Number.isFinite(originalHeight) || originalWidth <= 0) return String(url);
  const targetHeight = Math.round(targetWidth * (originalHeight / originalWidth));
  return String(url).replace(/w_\d+,h_\d+/, `w_${targetWidth},h_${targetHeight}`);
}

async function loadXlsxRows() {
  let XLSX;
  try {
    const module = await import('xlsx');
    XLSX = module.default ?? module;
  } catch {
    throw new Error('Missing dependency: xlsx. Install with `pnpm add -D xlsx` at repo root to run importer.');
  }

  const workbook = XLSX.readFile(EXCEL_PATH);
  const rows = [];
  for (const sheet of SHEETS) {
    const ws = workbook.Sheets[sheet];
    if (!ws) continue;
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    for (const row of json) {
      const values = Object.values(row);
      const rawName = values.find(v => typeof v === 'string' && /[a-z]/i.test(v)) ?? '';
      const rawUrl = values.find(v => typeof v === 'string' && /^https?:\/\//i.test(v)) ?? '';
      if (!rawName || !rawUrl) continue;
      rows.push({ sheet, rawName: String(rawName), rawUrl: String(rawUrl) });
    }
  }
  return rows;
}

async function loadCardSources() {
  const glob = await import('fast-glob');
  const files = await glob.default(['data/cards/src/gen1/*.json', 'data/cards/src/gen2/*.json', 'data/cards/src/gen3/*.json'], { cwd: ROOT });
  const cards = [];
  for (const relative of files) {
    const full = path.join(ROOT, relative);
    const raw = await readFile(full, 'utf-8');
    const card = JSON.parse(raw);
    cards.push({ relative, full, card, key: normalizeName(card.name) });
  }
  return cards;
}

async function loadOverrides() {
  try {
    const raw = await readFile(OVERRIDES_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function loadSkipList() {
  try {
    const raw = await readFile(SKIP_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(value => normalizeName(value)) : []);
  } catch {
    return new Set();
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = await loadXlsxRows();
  const cards = await loadCardSources();
  const overrides = await loadOverrides();
  const skipSet = await loadSkipList();

  const byName = new Map();
  for (const card of cards) {
    if (!byName.has(card.key)) byName.set(card.key, []);
    byName.get(card.key).push(card);
  }

  let matched = 0;
  let unmatched = 0;
  const reportRows = ['sheet,card_name,url,status,card_file,note'];

  for (const row of rows) {
    const key = normalizeName(row.rawName);
    if (skipSet.has(key)) {
      reportRows.push(`${row.sheet},"${row.rawName.replace(/"/g, '""')}","${row.rawUrl}",SKIPPED_KNOWN,,skip-list`);
      continue;
    }
    const overrideName = typeof overrides[key] === 'string' ? overrides[key] : '';
    const resolvedKey = overrideName ? normalizeName(overrideName) : key;
    const sheetTarget = SHEET_TARGETS[row.sheet] ?? { generation: undefined, edition: undefined };
    const nameMatches = byName.get(resolvedKey) ?? [];
    const filteredMatches = nameMatches.filter(candidate => {
      if (sheetTarget.generation && String(candidate.card.generation ?? '') !== sheetTarget.generation) return false;
      if (sheetTarget.edition && normalizeEdition(candidate.card.edition) !== sheetTarget.edition) return false;
      return true;
    });
    const matches = filteredMatches.length > 0 ? filteredMatches : nameMatches;
    if (matches.length !== 1) {
      unmatched += 1;
      reportRows.push(`${row.sheet},"${row.rawName.replace(/"/g, '""')}","${row.rawUrl}",UNMATCHED,,matches=${matches.length}`);
      continue;
    }

    matched += 1;
    const cardRef = matches[0];
    const remoteCandidates = WIDTHS.map(width => ({
      kind: 'remote',
      source: 'WIX',
      url: upgradeWixImageUrl(row.rawUrl, width),
      width
    }));

    cardRef.card.image = {
      ...(cardRef.card.image ?? {}),
      provider: 'excel-wix',
      originalUrl: row.rawUrl,
      remotePrimaryUrl: remoteCandidates.find(c => c.width === 960)?.url ?? row.rawUrl,
      remoteCandidates
    };

    reportRows.push(`${row.sheet},"${row.rawName.replace(/"/g, '""')}","${row.rawUrl}",MATCHED,${cardRef.relative},${overrideName ? `override=${overrideName}` : 'updated'}`);
  }

  if (!dryRun) {
    for (const cardRef of cards) {
      await writeFile(cardRef.full, `${JSON.stringify(cardRef.card, null, 2)}\n`, 'utf-8');
    }
  }

  await writeFile(REPORT_PATH, `${reportRows.join('\n')}\n`, 'utf-8');
  console.log(`Import complete. matched=${matched} unmatched=${unmatched} dryRun=${dryRun}`);
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
