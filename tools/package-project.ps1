param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$OutputDirectory = "",
  [switch]$InstallIfMissing,
  [switch]$CleanTempOnly
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Test-CommandExists($CommandName) {
  $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

$ProjectRoot = (Resolve-Path $ProjectRoot).Path

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $ProjectRoot "_exports"
}

$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ProjectName = Split-Path $ProjectRoot -Leaf
$TempRoot = Join-Path $ProjectRoot "_zip_temp"
$StagePath = Join-Path $TempRoot $ProjectName
$ZipPath = Join-Path $OutputDirectory "$ProjectName-$Timestamp.zip"

if ($CleanTempOnly) {
  Write-Step "Cleaning temporary zip folder"
  if (Test-Path $TempRoot) {
    Remove-Item $TempRoot -Recurse -Force
  }
  Write-Host "Done."
  exit 0
}

Write-Step "Checking project root"
if (!(Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "package.json was not found in $ProjectRoot. Run this from the ward-app root folder."
}

if (!(Test-Path (Join-Path $ProjectRoot "pnpm-workspace.yaml"))) {
  throw "pnpm-workspace.yaml was not found in $ProjectRoot. Run this from the ward-app root folder."
}

if ($InstallIfMissing) {
  $RootNodeModules = Join-Path $ProjectRoot "node_modules"

  if (!(Test-Path $RootNodeModules)) {
    Write-Step "node_modules missing. Running pnpm install"

    if (!(Test-CommandExists "pnpm.cmd") -and !(Test-CommandExists "pnpm")) {
      throw "pnpm was not found. Install pnpm first, then rerun this script."
    }

    Push-Location $ProjectRoot
    try {
      pnpm.cmd install
    }
    finally {
      Pop-Location
    }
  }
  else {
    Write-Step "node_modules exists. Skipping install"
  }
}

Write-Step "Preparing export folders"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

if (Test-Path $TempRoot) {
  Remove-Item $TempRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $StagePath | Out-Null

Write-Step "Copying project files without node_modules"

$ExcludeDirectories = @(
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".vite",
  ".vite-temp",
  "_exports",
  "_zip_temp",
  "_patch_backups",
  "_patch_effect_blocks",
  "_patch_effect_block_*",
  "data\matches",
  "data\dev\llm-phase4-reports"
)

$ExcludeFiles = @(
  "*.zip",
  "*.log",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.bmp",
  "*.tsbuildinfo",
  "*.before-*",
  "*.bak*",
  "*.orig",
  "*.tmp",
  "README_*PATCH*.md",
  "README_DOT_*PATCH*.md",
  "README_RULE_*PATCH*.md",
  "README.mdgit",
  ".env",
  ".env.*",
  "pnpm-debug.log*",
  "npm-debug.log*",
  "yarn-debug.log*"
)

$RoboArgs = @(
  $ProjectRoot,
  $StagePath,
  "/MIR",
  "/XD"
) + $ExcludeDirectories + @(
  "/XF"
) + $ExcludeFiles + @(
  "/R:1",
  "/W:1",
  "/NFL",
  "/NDL",
  "/NJH",
  "/NJS",
  "/NP"
)

$RoboCopy = Start-Process -FilePath "robocopy.exe" -ArgumentList $RoboArgs -NoNewWindow -Wait -PassThru

# Robocopy exit codes 0-7 are success/warnings. 8+ means failure.
if ($RoboCopy.ExitCode -ge 8) {
  throw "robocopy failed with exit code $($RoboCopy.ExitCode)."
}

Write-Step "Creating zip"
if (Test-Path $ZipPath) {
  Remove-Item $ZipPath -Force
}

Compress-Archive -Path (Join-Path $StagePath "*") -DestinationPath $ZipPath -Force

Write-Step "Cleaning temp folder"
Remove-Item $TempRoot -Recurse -Force

Write-Host ""
Write-Host "Created zip:" -ForegroundColor Green
Write-Host $ZipPath
Write-Host ""
Write-Host "This zip excludes node_modules, .git, build outputs, logs, previous zip exports, patch backup folders, one-off backup files, saved matches, and generated LLM reports."
