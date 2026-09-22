# OpenSCAD AI Contributor Guide

## Architecture

- `src/`: React 19 and TypeScript desktop interface.
- `src-tauri/src/`: Rust core and Tauri IPC commands.
- `src-tauri/src/ai/`: Gemini, OpenAI, Ollama, and local Codex CLI adapters.
- `src-tauri/src/pipeline.rs`: generation, OpenSCAD validation, and auto-repair.
- `src-tauri/src/config.rs`: atomic local settings persistence.
- `src-tauri/src/files.rs`: output listing, guarded reads, and native save dialogs.

## Required checks

Run these before committing:

```powershell
rtk npm test
rtk npm run build
rtk cargo test --manifest-path src-tauri/Cargo.toml
```

## Security rules

- Never commit API keys, tokens, credentials, runtime configuration, or generated models.
- Never print provider keys in logs or errors.
- Keep Codex CLI execution shell-free and sandboxed.
- Keep output-file reads constrained to the configured output directory.
- Preserve process timeouts and cancellation behavior.
- Prefer environment variables for optional Gemini and OpenAI keys.

## UI rules

- All user-facing text is English.
- Preserve dark, light, and AMOLED theme support.
- Keep the assistant and code editor independently collapsible.
- Maintain keyboard access, visible focus states, dialog focus trapping, and descriptive labels.

## Core data

- `Config`: provider, model, optional cloud keys, OpenSCAD path, Codex path, output directory, theme, and repair limit.
- `Request`: prompt, current code, optional reference image, and active design rules.
- `Artifact`: validated SCAD code, base64 STL preview, and generated name.

Python is not part of the application or build process.
