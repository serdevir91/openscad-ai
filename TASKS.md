# OpenSCAD AI 0.5.0 Status

Last updated: 2026-11-06

## Complete

- [x] Tauri 2 desktop shell and Rust application core
- [x] React, TypeScript, Monaco Editor, and Three.js workspace
- [x] OpenSCAD detection, compilation, and STL validation
- [x] Bundled OpenSCAD WebAssembly fallback when no installed OpenSCAD is found
- [x] "Precise" pipeline: measurable plan, parametric SCAD, mesh measurement, plan comparison, exact-failure repair, and four-view vision review
- [x] "Fast" mode: single pass that repairs compile errors only
- [x] Verification panel, viewport X/Y/Z size readout, bounding box toggle, and editor error markers
- [x] 16 providers: five sign-in CLIs, API-key providers, and local or custom endpoints
- [x] Connections screen with status, key fields, install commands, sign-in, and connection tests
- [x] First-launch provider selection from the CLIs found on the machine, with Connections opened when none is found
- [x] Automatic compiler-error repair loop with a default of 3 repairs and a maximum setting of 5
- [x] True B-rep STEP export through OpenCascade WebAssembly, with exact, mixed, and faceted output
- [x] Application-written 3MF export from the mesh
- [x] SCAD, STL, 3MF, STEP, and PNG export in the desktop app and Web Studio
- [x] Reference-image analysis
- [x] Official OpenSCAD documentation cache and context selection
- [x] Parametric variables with editable range metadata
- [x] Collapsible assistant and code panels
- [x] Persistent dark, light, and AMOLED themes
- [x] User-selectable persistent output directory
- [x] Custom design skills and rules
- [x] Native export dialogs and saved-model browser
- [x] Windows, macOS, and Linux support
- [x] Update check at startup and in Settings against GitHub Releases
- [x] Star prompt after the third passing design, plus a Rate button in Settings
- [x] English interface and error messages
- [x] Shell-free CLI execution in temporary folders with timeouts and cancellation
- [x] Configuration migration for legacy `gemini_key`, `openai_key`, and `codex_path` fields
- [x] Design evaluation script and live CLI adapter tests
- [x] CI tests and secret scanning
- [x] GitHub-ready documentation and ignore rules

## Open

- [ ] Signed macOS builds
- [ ] Vision review check in the evaluation

## Release checks

```powershell
rtk npm test
rtk npm run build
rtk cargo test --manifest-path src-tauri/Cargo.toml
rtk npm run build:app
```

Optional, spends provider quota:

```powershell
EVAL_PROVIDER=opencode npm run eval
```
