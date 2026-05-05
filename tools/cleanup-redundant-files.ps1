# Run from the project root: C:\Users\brjar\Documents\ward-app
# Removes stale patch artifacts and local runtime/output junk that should not ship in source zips.

param(
  [switch]$IncludeSavedMatches
)

$ErrorActionPreference = "Stop"

function Remove-PathIfExists($Path) {
  if (Test-Path $Path) {
    Remove-Item $Path -Recurse -Force
    Write-Host "Deleted $Path"
  } else {
    Write-Host "Already gone: $Path"
  }
}

Write-Host "Cleaning stale patch folders..." -ForegroundColor Cyan
Remove-PathIfExists "_patch_backups"
Get-ChildItem -Path . -Directory -Filter "_patch_effect_block*" -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-PathIfExists $_.FullName
}

Write-Host ""
Write-Host "Cleaning stale backup files..." -ForegroundColor Cyan
$backupPatterns = @(
  "*.before-*",
  "*.bak*",
  "*.orig",
  "*.tmp",
  "README_*PATCH*.md",
  "README_DOT_*PATCH*.md",
  "README_RULE_*PATCH*.md",
  "README.mdgit"
)

foreach ($pattern in $backupPatterns) {
  Get-ChildItem -Path . -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-Host "Deleted $($_.FullName)"
  }
}

Write-Host ""
Write-Host "Cleaning generated LLM reports..." -ForegroundColor Cyan
Remove-PathIfExists "data\dev\llm-phase4-reports"

if ($IncludeSavedMatches) {
  Write-Host ""
  Write-Host "Cleaning saved matches..." -ForegroundColor Cyan
  Remove-PathIfExists "data\matches"
} else {
  Write-Host ""
  Write-Host "Saved matches were kept. Use -IncludeSavedMatches to delete data\matches."
}

Write-Host ""
Write-Host "Cleanup complete. Run: pnpm.cmd check"
