$projectRoot = $PSScriptRoot
$releaseExe = Join-Path $projectRoot "src-tauri\target\release\openscad-ai.exe"
$portableExe = Join-Path $projectRoot "OpenSCAD AI.exe"

if (Test-Path -LiteralPath $portableExe) {
    Start-Process -FilePath $portableExe -WorkingDirectory $projectRoot
    exit 0
}
if (Test-Path -LiteralPath $releaseExe) {
    Start-Process -FilePath $releaseExe -WorkingDirectory $projectRoot
    exit 0
}

Write-Host "Derlenmis uygulama bulunamadi; Tauri gelistirme modu baslatiliyor..." -ForegroundColor Cyan
npm run desktop
