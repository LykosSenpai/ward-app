# WARD Zip / Dependency Tools

Put these scripts in:

```text
tools/
```

## Recommended: zip project without deleting node_modules

From the project root:

```powershell
.\tools\package-project.ps1
```

This creates:

```text
_exports\ward-app-YYYYMMDD-HHMMSS.zip
```

It excludes:

```text
node_modules
.git
dist
build
coverage
.vite
_exports
_zip_temp
logs
old zip files
.env files
```

## Zip and install dependencies if missing

```powershell
.\tools\package-project.ps1 -InstallIfMissing
```

## Reinstall dependencies only if node_modules is missing

```powershell
.\tools\ensure-deps.ps1
```

## Delete node_modules

Only use this if you really want to remove dependencies locally:

```powershell
.\tools\clean-node-modules.ps1
```

Delete and immediately reinstall:

```powershell
.\tools\clean-node-modules.ps1 -Reinstall
```

## Best workflow before sending a zip

```powershell
pnpm.cmd check
.\tools\package-project.ps1
```
