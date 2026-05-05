param(
  [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path $ProjectRoot).Path

if (!(Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "package.json was not found in $ProjectRoot. Run this from the ward-app root folder."
}

$RootNodeModules = Join-Path $ProjectRoot "node_modules"

if (Test-Path $RootNodeModules) {
  Write-Host "node_modules already exists. Nothing to install." -ForegroundColor Green
  exit 0
}

Write-Host "node_modules is missing. Running pnpm install..." -ForegroundColor Cyan

Push-Location $ProjectRoot
try {
  pnpm.cmd install
}
finally {
  Pop-Location
}

Write-Host "Dependencies installed." -ForegroundColor Green
