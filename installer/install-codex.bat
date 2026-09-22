@echo off
setlocal
where npm >nul 2>nul
if %errorlevel% equ 0 (
    echo Installing Codex CLI globally via npm...
    call npm install -g @openai/codex
) else (
    echo [OpenSCAD AI] Node.js and npm were not detected on this system.
    echo To use Codex CLI, please install Node.js from https://nodejs.org/
)
exit /b 0
