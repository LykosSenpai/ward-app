# Card Images Phase 4 Rollout Checklist

Last updated: 2026-05-20

## Goal
Complete rollout controls + QA for remote card image usage.

## Step 1 — Gate remote-first behavior
- Remote image priorities are controlled by `imageSourceControls` and can now be globally disabled via:
  - `VITE_ENABLE_REMOTE_CARD_IMAGES=false`
  - or browser localStorage key `ward:image-source-remote-enabled:v1=0`.
- When disabled, `excelRemote`, `githubCdn`, and `railwayBucket` are removed from all priorities.

## Step 2 — Smoke checks
Run:

```bash
pnpm images:smoke:phase4
```

This validates wiring for:
- library preview remote candidates
- match/board remote candidates
- strict board WebGL-safe filtering

## Step 3 — Validation deltas each run
1. Refresh report:

```bash
pnpm images:validate
```

2. Compare against baseline:

```bash
pnpm images:delta
```

`images:delta` fails if unresolved cards regress.

## Step 4 — Baseline management
- Baseline file: `data/card-images/image-validation.baseline.json`
- Update baseline only when intended changes are accepted.

