# OpenSCAD AI Contributor Guide

## Architecture

- `src/ai/`: provider registry, prompts, plan checks, generation loop, and desktop/browser transport.
- `src/cad/`: mesh measurement, CSG tree, B-rep, STEP, 3MF, rendered views, and diagnostics.
- `src/workers/`: OpenSCAD and STEP WebAssembly workers.
- `src/`: React 19 and TypeScript desktop interface, including the Connections and Verification panels.
- `src-tauri/src/ai/`: HTTP and CLI provider adapters (`mod.rs`, `http.rs`, `cli.rs`).
- `src-tauri/src/openscad.rs`: OpenSCAD discovery and process execution.
- `src-tauri/src/config.rs`: atomic local settings persistence.
- `src-tauri/src/files.rs`: output listing, guarded reads, and native save dialogs.

## Required checks

Run these before committing:

```powershell
rtk npm test
rtk npm run build
rtk cargo test --manifest-path src-tauri/Cargo.toml
```

Optional: `npm run eval` runs `eval/design.eval.ts` with a real model and OpenSCAD. It spends provider quota and is not part of `npm test`.

Live CLI adapter tests run only when requested:

```powershell
rtk cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_
```

## Security rules

- Never commit API keys, tokens, credentials, runtime configuration, or generated models.
- Never print provider keys in logs or errors.
- Keep API keys in the local app-data config file or browser `localStorage`, and send them only to the chosen provider.
- Keep CLI provider execution shell-free and sandboxed.
- Keep output-file reads constrained to the configured output directory.
- Preserve process timeouts and cancellation behavior.
- Prefer environment variables for optional Gemini and OpenAI keys.

## UI rules

- All user-facing text is English.
- Preserve dark, light, and AMOLED theme support.
- Keep the assistant and code editor independently collapsible.
- Maintain keyboard access, visible focus states, dialog focus trapping, and descriptive labels.

## Core data

- `Config`: provider, model, models, keys, base URLs, paths, OpenSCAD path, output directory, theme, max repairs, mode, render timeout, and onboarding state. Legacy `gemini_key`, `openai_key`, and `codex_path` fields are migrated on load.
- `Request`: prompt, current code, optional reference image, and active design rules.
- `Artifact`: validated SCAD code, base64 STL preview, and generated name.

Python is not part of the application or build process.
