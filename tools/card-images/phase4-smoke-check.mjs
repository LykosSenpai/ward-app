#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../');

async function ensureIncludes(file, patterns) {
  const content = await readFile(path.join(ROOT, file), 'utf-8');
  const missing = patterns.filter(pattern => !content.includes(pattern));
  if (missing.length > 0) {
    throw new Error(`${file} missing required markers: ${missing.join(', ')}`);
  }
}

async function main() {
  await ensureIncludes('apps/client/src/components/CardImagePreview.tsx', [
    'getRemoteImageCandidates',
    'filterCardImageCandidates',
    'excelRemote'
  ]);

  await ensureIncludes('apps/client/src/components/MatchCardImage.tsx', [
    'getRemoteMatchCardCandidates',
    'getBoardCardImageUrls',
    'textureValidated === true',
    'canvasValidated === true'
  ]);

  await ensureIncludes('apps/client/src/components/boardPreview3d/BoardPreview3DWebGLCards.tsx', [
    'getBoardCardImageUrls',
    'createCardBackTexture'
  ]);

  console.log('Phase 4 smoke checks passed.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
