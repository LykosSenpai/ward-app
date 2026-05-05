# WARD Effect Action Catalog Patch

This patch adds an engine-level action catalog for every action type currently found in `data/cards/src/gen1`, `gen2`, and `gen3`.

It does not claim every card is fully Working. It creates a durable work queue and runtime-support metadata so every known card action has a family, support level, route, and next-step classification.

## Added

- `packages/engine/src/effectActionCatalog.ts`
- `tools/card-generation/audit-effect-runtime-coverage.mjs`
- `docs/effect-action-type-audit-20260505.md`
- `docs/effect-action-type-audit-20260505.csv`

## Updated

- `packages/engine/src/effectRuntimeSupport.ts`
- `packages/engine/src/index.ts`
- `package.json`

## New command

```powershell
pnpm.cmd effects:audit
```

This regenerates the audit docs from the split per-card source files.

## Validation after applying

```powershell
pnpm.cmd cards:check
pnpm.cmd effects:audit
pnpm.cmd check
```
