param(
  [string]$ProjectRoot = (Get-Location).Path,
  [switch]$Reinstall
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path $ProjectRoot).Path

if (!(Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "package.json was not found in $ProjectRoot. Run this from the ward-app root folder."
}

$NodeModulePaths = @(
  "node_modules",
  "apps/client/node_modules",
  "apps/server/node_modules",
  "packages/engine/node_modules",
  "packages/shared/node_modules"
)

foreach ($RelativePath in $NodeModulePaths) {
  $FullPath = Join-Path $ProjectRoot $RelativePath

  if (Test-Path $FullPath) {
    Write-Host "Deleting $RelativePath" -ForegroundColor Yellow
    Remove-Item $FullPath -Recurse -Force
  }
}

if ($Reinstall) {
  Write-Host "Running pnpm install..." -ForegroundColor Cyan

  Push-Location $ProjectRoot
  try {
    pnpm.cmd install
  }
  finally {
    Pop-Location
  }

  Write-Host "Dependencies reinstalled." -ForegroundColor Green
}
else {
  Write-Host ""
  Write-Host "node_modules deleted. Reinstall later with:" -ForegroundColor Green
  Write-Host "pnpm.cmd install"
}
