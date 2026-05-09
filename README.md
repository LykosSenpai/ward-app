# WARD Battle Resolver Modifiers Patch

Apply from the project root:

```powershell
cd C:\Users\brjar\Documents\ward-app
Unblock-File "$env:USERPROFILE\Downloads\ward-battle-modifiers-resolver-patch.zip"
Expand-Archive -Path "$env:USERPROFILE\Downloads\ward-battle-modifiers-resolver-patch.zip" -DestinationPath . -Force
pnpm.cmd check
```

Restart:

```powershell
pnpm.cmd --filter @ward/server dev
pnpm.cmd --filter @ward/client dev
```

Adds speed modifiers, first-strike override, per-strike hit modifiers, damage modifiers, damage multipliers, force hit/miss, and prevent attack damage controls to the Manual Battle Resolver.

## 3D board and embed integration docs

- 3D integration review: `docs/3d-board-integration-review.md`
- Engine/effects to 3D method: `docs/3d-board-engine-effects-integration-method.md`
- Embed API contract: `docs/embed-api.md`
- Embed auth bootstrap strategy: `docs/embed-auth-bootstrap.md`
- Local embed host harness: `apps/client/public/embed-host-harness.html`
- Embed verification checklist: `docs/embed-verification-checklist.md`
- Embed batch-3 validation status: `docs/embed-batch3-status.md`
