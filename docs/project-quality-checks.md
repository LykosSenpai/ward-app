# Project Quality Checks

## Main Command

From the project root:

```powershell
pnpm.cmd check
```

This runs:

1. Project file audit.
2. CSS brace/syntax check.
3. Engine barrel export check.
4. Shared package type check.
5. Engine package type check.
6. Server package type check.
7. Client package type check.

## Common Fixes

### Engine export error

Check:

```text
packages/engine/src/index.ts
```

Every relative export should use `.js`:

```ts
export * from "./actions.js";
```

### CSS unclosed block

Run:

```powershell
pnpm.cmd check:css
```

Then fix the reported file and line.

### Redundant files

Run:

```powershell
pnpm.cmd check:files
```

Then remove stale pasted/refactor artifacts. Keep `node_modules` locally if desired, but do not include it in zipped project backups.

## Recommended Before Sending a Zip

```powershell
pnpm.cmd check
```

Then zip the project **without** any `node_modules` folders.
