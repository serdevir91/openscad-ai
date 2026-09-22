@echo off
setlocal
cd /d "%~dp0\.."
echo Building OpenSCAD AI Windows Installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1"
if %errorlevel% neq 0 (
    echo [ERROR] Installer build failed.
    pause
    exit /b %errorlevel%
)
echo [SUCCESS] Installer build complete.
pause
