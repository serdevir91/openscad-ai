# =====================================================================
# OpenSCAD AI - Windows Inno Setup Builder Script
# =====================================================================

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Resolve-Path "$scriptDir\.."

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Building OpenSCAD AI Windows Installer " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Verify / Locate ISCC.exe (Inno Setup Compiler)
$isccCandidates = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
)

$isccPath = $isccCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $isccPath) {
    Write-Error "Inno Setup 6 (ISCC.exe) was not found. Please install Inno Setup 6 from https://jrsoftware.org/isdl.php"
    exit 1
}

Write-Host "Using Inno Setup Compiler: $isccPath" -ForegroundColor Green

# 2. Check if OpenSCAD AI.exe exists; if not, build it
$appExe = Join-Path $rootDir "OpenSCAD AI.exe"
if (-not (Test-Path $appExe)) {
    Write-Host "OpenSCAD AI.exe not found in root. Building desktop application..." -ForegroundColor Yellow
    Push-Location $rootDir
    try {
        npm run build:app
        if (Test-Path "src-tauri\target\release\openscad-ai.exe") {
            Copy-Item "src-tauri\target\release\openscad-ai.exe" "OpenSCAD AI.exe" -Force
        }
    } finally {
        Pop-Location
    }
}

# 3. Run Inno Setup Compiler
$issFile = Join-Path $scriptDir "OpenSCAD-AI-Setup.iss"
Write-Host "Compiling Inno Setup script: $issFile" -ForegroundColor Cyan

& $isccPath $issFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nInstaller built successfully!" -ForegroundColor Green
    $distDir = Join-Path $rootDir "dist-installer"
    Get-ChildItem $distDir -Filter "*.exe" | ForEach-Object {
        Write-Host "Output: $($_.FullName) ($([math]::Round($_.Length / 1MB, 2)) MB)" -ForegroundColor Magenta
    }
} else {
    Write-Error "Inno Setup compilation failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}
