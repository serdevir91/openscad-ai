# OpenSCAD AI 2.0 Status

Last updated: 2026-09-21

## Complete

- [x] Tauri 2 desktop shell and Rust application core
- [x] React, TypeScript, Monaco Editor, and Three.js workspace
- [x] OpenSCAD detection, compilation, STL validation, and PNG export
- [x] Gemini, OpenAI, Ollama, and API-key-free local Codex CLI providers
- [x] Automatic compiler-error repair loop
- [x] Reference-image analysis
- [x] Official OpenSCAD documentation cache and context selection
- [x] Parametric variables with editable range metadata
- [x] Collapsible assistant and code panels
- [x] Persistent dark, light, and AMOLED themes
- [x] User-selectable persistent output directory
- [x] Custom design skills and rules
- [x] Native export dialogs and saved-model browser
- [x] English interface and error messages
- [x] CI tests and secret scanning
- [x] GitHub-ready documentation and ignore rules

## Release checks

```powershell
rtk npm test
rtk npm run build
rtk cargo test --manifest-path src-tauri/Cargo.toml
rtk npm run build:app
```
