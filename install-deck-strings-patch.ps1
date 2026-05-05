param(
    [string]$ZipPath = "$env:USERPROFILE\Downloads\ward_deck_strings_patch.zip",
    [string]$AppRoot = "C:\Users\brjar\Documents\ward-app"
)

$ErrorActionPreference = "Stop"

Write-Host "WARD patch installer starting..." -ForegroundColor Cyan
Write-Host "Zip:     $ZipPath"
Write-Host "AppRoot: $AppRoot"
Write-Host ""

if (-not (Test-Path $ZipPath)) {
    throw "Patch zip was not found at: $ZipPath"
}

if (-not (Test-Path $AppRoot)) {
    throw "WARD app folder was not found at: $AppRoot"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tempRoot = Join-Path $env:TEMP "ward-deck-strings-patch-$timestamp"
$backupRoot = Join-Path $AppRoot "_patch_backups\deck-strings-patch-$timestamp"

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

Write-Host "Extracting patch..." -ForegroundColor Yellow
Expand-Archive -Path $ZipPath -DestinationPath $tempRoot -Force

# Locate extracted patch root.
# Expected zip has apps/client/src/... directly, but this also handles one nested folder.
$patchAppsFolder = Get-ChildItem -Path $tempRoot -Directory -Recurse |
    Where-Object { $_.FullName -match "\\apps$" } |
    Select-Object -First 1

if (-not $patchAppsFolder) {
    throw "Could not find an 'apps' folder inside the extracted patch zip."
}

$sourceApps = $patchAppsFolder.FullName
$targetApps = Join-Path $AppRoot "apps"

if (-not (Test-Path $targetApps)) {
    throw "Could not find target apps folder at: $targetApps"
}

$filesToCopy = Get-ChildItem -Path $sourceApps -File -Recurse

if ($filesToCopy.Count -eq 0) {
    throw "No files found in patch apps folder: $sourceApps"
}

Write-Host "Backing up files that will be replaced..." -ForegroundColor Yellow

foreach ($file in $filesToCopy) {
    $relativePath = $file.FullName.Substring($sourceApps.Length).TrimStart("\")
    $targetFile = Join-Path $targetApps $relativePath

    if (Test-Path $targetFile) {
        $backupFile = Join-Path $backupRoot ("apps\" + $relativePath)
        $backupDir = Split-Path $backupFile -Parent

        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        Copy-Item -Path $targetFile -Destination $backupFile -Force
        Write-Host "Backed up: $relativePath"
    }
}

Write-Host ""
Write-Host "Installing patch files..." -ForegroundColor Yellow

foreach ($file in $filesToCopy) {
    $relativePath = $file.FullName.Substring($sourceApps.Length).TrimStart("\")
    $targetFile = Join-Path $targetApps $relativePath
    $targetDir = Split-Path $targetFile -Parent

    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    Copy-Item -Path $file.FullName -Destination $targetFile -Force

    Write-Host "Installed: apps\$relativePath" -ForegroundColor Green
}

Write-Host ""
Write-Host "Cleaning temp extraction folder..."
Remove-Item -Path $tempRoot -Recurse -Force

Write-Host ""
Write-Host "Patch installed successfully." -ForegroundColor Green
Write-Host "Backup saved to:"
Write-Host $backupRoot -ForegroundColor Cyan

Write-Host ""
Write-Host "Next commands:" -ForegroundColor Cyan
Write-Host "cd `"$AppRoot`""
Write-Host "pnpm.cmd check"
Write-Host "pnpm.cmd --filter @ward/server dev"
Write-Host "pnpm.cmd --filter @ward/client dev"