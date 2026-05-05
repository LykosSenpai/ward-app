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
