@echo off
title OpenSCAD AI Desktop
cd /d "%~dp0"
if exist "OpenSCAD AI.exe" (
  start "" "OpenSCAD AI.exe"
  exit /b 0
)
if exist "src-tauri\target\release\openscad-ai.exe" (
  start "" "src-tauri\target\release\openscad-ai.exe"
  exit /b 0
)
echo Derlenmis uygulama bulunamadi. Gelistirme modu baslatiliyor...
call npm run desktop
