#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../');
const EXCEL_PATH = path.join(ROOT, 'ward gen3 pics + links.xlsx');
const REPORT_PATH = path.join(ROOT, 'docs', 'card-images', 'image-link-import-report.csv');
const OVERRIDES_PATH = path.join(ROOT, 'tools', 'card-images', 'import-excel-image-overrides.json');
const SKIP_PATH = path.join(ROOT, 'tools', 'card-images', 'import-excel-image-skip.json');

const BASE_SHEETS = ['gen1e3', 'gen2e2', 'gen3e1'];
const PROMO_SHEET = 'promo';
const SHEETS = [...BASE_SHEETS, PROMO_SHEET];
const WIDTHS = [480, 720, 960, 1440];
const OUTPUT_EOL = process.platform === 'win32' ? '\r\n' : '\n';
const SHEET_TARGETS = {
  gen1e3: { generation: '1', edition: '3rd edition' },
  gen2e2: { generation: '2', edition: '2nd edition' },
  gen3e1: { generation: '3', edition: '1st edition' },
  promo: { promo: true }
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

function normalizeSourcePath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

function isPromoCard(cardRef) {
  const relative = normalizeSourcePath(cardRef.relative);
  const cardId = String(cardRef.card.id ?? '').toLowerCase();
  const generation = normalizeEdition(cardRef.card.generation);
  return relative.includes('/promos/') || cardId.startsWith('promo_') || generation === 'promo';
}

function targetMatchesCard(cardRef, sheetTarget) {
  if (sheetTarget.promo === true) return isPromoCard(cardRef);
  if (isPromoCard(cardRef)) return false;
  if (sheetTarget.generation && String(cardRef.card.generation ?? '') !== sheetTarget.generation) return false;
  if (sheetTarget.edition && normalizeEdition(cardRef.card.edition) !== sheetTarget.edition) return false;
  return true;
}

function formatSheetTarget(sheetTarget) {
  if (sheetTarget.promo === true) return 'promo-only';
  const parts = [];
  if (sheetTarget.generation) parts.push(`generation=${sheetTarget.generation}`);
  if (sheetTarget.edition) parts.push(`edition=${sheetTarget.edition}`);
  return parts.length > 0 ? parts.join(';') : 'any';
}

function clearExcelWixImage(cardRef) {
  const image = cardRef.card.image;
  if (!image || image.provider !== 'excel-wix') return false;

  const {
    provider: _provider,
    originalUrl: _originalUrl,
    remotePrimaryUrl: _remotePrimaryUrl,
    remoteCandidates: _remoteCandidates,
    ...remainingImage
  } = image;

  if (Object.keys(remainingImage).length > 0) {
    cardRef.card.image = remainingImage;
  } else {
    delete cardRef.card.image;
  }

  return true;
}

function withOutputLineEndings(value) {
  return OUTPUT_EOL === '\n' ? value : value.replace(/\n/g, OUTPUT_EOL);
}

function serializeJson(value) {
  return `${withOutputLineEndings(JSON.stringify(value, null, 2))}${OUTPUT_EOL}`;
}

function serializeCsv(rows) {
  return `${withOutputLineEndings(rows.join('\n'))}${OUTPUT_EOL}`;
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
  const files = await glob.default([
    'data/cards/src/gen1/*.json',
    'data/cards/src/gen2/*.json',
    'data/cards/src/gen3/*.json',
    'data/cards/src/promos/*.json'
  ], { cwd: ROOT });
  const cards = [];
  for (const relative of files) {
    if (path.basename(relative).startsWith('_')) continue;
    const full = path.join(ROOT, relative);
    const raw = await readFile(full, 'utf-8');
    const card = JSON.parse(raw);
    if (!card || typeof card !== 'object' || typeof card.name !== 'string') continue;
    cards.push({ relative, full, card, key: normalizeName(card.name) });
  }
  return cards;
}

async function loadOverrides() {
  try {
    const raw = await readFile(OVERRIDES_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry) => typeof entry[1] === 'string')
        .map(([key, value]) => [normalizeName(key), value])
    );
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
  let staleCleared = 0;
  const updatedCardFiles = new Set();
  const reportRows = ['sheet,card_name,url,status,card_file,note'];

  for (const row of rows) {
    const key = normalizeName(row.rawName);
    const isKnownSkip = skipSet.has(key);
    const overrideName = typeof overrides[key] === 'string' ? overrides[key] : '';
    const resolvedKey = overrideName ? normalizeName(overrideName) : key;
    const sheetTarget = SHEET_TARGETS[row.sheet];
    const nameMatches = byName.get(resolvedKey) ?? [];
    const matches = nameMatches.filter(candidate => targetMatchesCard(candidate, sheetTarget));
    const targetNote = formatSheetTarget(sheetTarget);
    if (isKnownSkip && matches.length === 0) {
      reportRows.push(`${row.sheet},"${row.rawName.replace(/"/g, '""')}","${row.rawUrl}",SKIPPED_KNOWN,,skip-list;target=${targetNote}`);
      continue;
    }
    if (matches.length !== 1) {
      unmatched += 1;
      reportRows.push(`${row.sheet},"${row.rawName.replace(/"/g, '""')}","${row.rawUrl}",UNMATCHED,,target=${targetNote};nameMatches=${nameMatches.length};targetMatches=${matches.length}`);
      continue;
    }

    matched += 1;
    const cardRef = matches[0];
    updatedCardFiles.add(cardRef.relative);
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

    reportRows.push(`${row.sheet},"${row.rawName.replace(/"/g, '""')}","${row.rawUrl}",MATCHED,${cardRef.relative},${overrideName ? `override=${overrideName};` : ''}target=${targetNote}`);
  }

  for (const cardRef of cards) {
    if (updatedCardFiles.has(cardRef.relative) || cardRef.card.image?.provider !== 'excel-wix') continue;
    staleCleared += 1;
    reportRows.push(`cleanup,"${cardRef.card.name.replace(/"/g, '""')}","",${dryRun ? 'WOULD_CLEAR_STALE' : 'CLEARED_STALE'},${cardRef.relative},targeted-import-only`);
    if (!dryRun) clearExcelWixImage(cardRef);
  }

  if (!dryRun) {
    for (const cardRef of cards) {
      await writeFile(cardRef.full, serializeJson(cardRef.card), 'utf-8');
    }
  }

  await writeFile(REPORT_PATH, serializeCsv(reportRows), 'utf-8');
  console.log(`Import complete. matched=${matched} unmatched=${unmatched} staleCleared=${staleCleared} dryRun=${dryRun}`);
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
