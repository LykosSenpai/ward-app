#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../');
const REPORT_PATH = path.join(ROOT, 'data', 'card-images', 'image-validation.json');

const CARD_SOURCE_GLOBS = ['data/cards/src/gen1/*.json', 'data/cards/src/gen2/*.json', 'data/cards/src/gen3/*.json'];

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function deriveValidation(candidate = {}) {
  const width = Number(candidate.width ?? 0);
  const height = Number(candidate.height ?? 0);
  const hasValidUrl = isHttpUrl(candidate.url);
  const imageValidated = candidate.imageValidated ?? hasValidUrl;
  const textureValidated = candidate.textureValidated ?? (hasValidUrl && width >= 480);
  const canvasValidated = candidate.canvasValidated ?? (hasValidUrl && (!height || height >= 300));
  return {
    imageValidated: Boolean(imageValidated),
    textureValidated: Boolean(textureValidated),
    canvasValidated: Boolean(canvasValidated)
  };
}

async function loadCards() {
  const glob = await import('fast-glob');
  const files = await glob.default(CARD_SOURCE_GLOBS, { cwd: ROOT });
  const cards = [];
  for (const relative of files) {
    const full = path.join(ROOT, relative);
    const raw = await readFile(full, 'utf-8');
    const card = JSON.parse(raw);
    cards.push({ relative, card });
  }
  return cards;
}

async function main() {
  const cards = await loadCards();
  const createdAt = new Date().toISOString();

  const details = [];
  let cardsWithImageMetadata = 0;
  let remoteCandidateCount = 0;
  let bucketCandidateCount = 0;
  let localCandidateCount = 0;
  let textureSafeRemoteCount = 0;
  let canvasSafeRemoteCount = 0;
  let unresolvedCards = 0;

  for (const { relative, card } of cards) {
    const image = card.image;
    if (!image) continue;
    cardsWithImageMetadata += 1;

    const remoteCandidates = Array.isArray(image.remoteCandidates) ? image.remoteCandidates : [];
    const bucketCandidates = Array.isArray(image.bucketCandidates) ? image.bucketCandidates : [];
    const localCandidates = Array.isArray(image.localCandidates) ? image.localCandidates : [];

    remoteCandidateCount += remoteCandidates.length;
    bucketCandidateCount += bucketCandidates.length;
    localCandidateCount += localCandidates.length;

    const remoteValidation = remoteCandidates.map(deriveValidation);
    textureSafeRemoteCount += remoteValidation.filter(item => item.textureValidated).length;
    canvasSafeRemoteCount += remoteValidation.filter(item => item.canvasValidated).length;

    const hasUsableRemote = remoteValidation.some(item => item.textureValidated && item.canvasValidated);
    const hasUsableBucket = bucketCandidates.some(item => isHttpUrl(item.url) || typeof item.objectKey === 'string');
    const hasUsableLocal = localCandidates.some(item => typeof item.fileName === 'string' || isHttpUrl(item.url));

    const unresolved = !hasUsableRemote && !hasUsableBucket && !hasUsableLocal && !image.localBackupUrl;
    if (unresolved) unresolvedCards += 1;

    details.push({
      cardId: card.id,
      name: card.name,
      file: relative,
      provider: image.provider ?? null,
      remoteCandidates: remoteCandidates.length,
      bucketCandidates: bucketCandidates.length,
      localCandidates: localCandidates.length,
      hasUsableRemote,
      hasUsableBucket,
      hasUsableLocal,
      unresolved
    });
  }

  const report = {
    createdAt,
    totals: {
      cardsScanned: cards.length,
      cardsWithImageMetadata,
      remoteCandidateCount,
      bucketCandidateCount,
      localCandidateCount,
      textureSafeRemoteCount,
      canvasSafeRemoteCount,
      unresolvedCards
    },
    details
  };

  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`cardsWithImageMetadata=${cardsWithImageMetadata} unresolvedCards=${unresolvedCards}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
