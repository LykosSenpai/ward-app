# WARD Project Cleanup - 2026-05-03

Cleaned from source zip: `ward-app-20260503-212533.zip`.

## Removed from the clean package

- `_patch_backups/` and `_patch_effect_block*` patch staging folders.
- One-off backup/source-history files such as `*.before-*`, `*.bak*`, and duplicate repaired card-pack copies.
- Root patch-note README files that were already superseded by the current source state.
- Volatile local runtime data under `data/matches/`.
- Generated LLM phase report outputs under `data/dev/llm-phase4-reports/`.
- Unused Vite starter assets under `apps/client/src/assets/`.

## Preserved

- Current app source under `apps/`.
- Current shared and engine source under `packages/`.
- Current card packs for Gen 1, Gen 2, and Gen 3.
- Deck JSON, collection ownership JSON, effect runtime status JSON, and effect-test scenarios.
- Card-generation docs/output files because they are useful for future effect parsing and audit work.
- Project tooling and package scripts.

## Audit result

- Removed entries: 261
- Removed uncompressed bytes: 7,567,084

## Local validation run after cleanup

These checks were run in the cleanup environment:

```powershell
node tools/check-project-files.mjs
node tools/check-css-braces.mjs
node tools/check-engine-exports.mjs
```

Full `pnpm.cmd check` still needs to be run locally after extracting because this environment does not have pnpm/node_modules installed.
