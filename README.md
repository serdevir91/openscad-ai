<p align="center">
  <img src="src-tauri/icons/icon.png" alt="OpenSCAD AI" width="96">
</p>

<h1 align="center">OpenSCAD AI v0.5.0</h1>

<p align="center">
  A native AI-assisted parametric CAD studio built with Tauri 2, Rust, Three.js, and Monaco Editor.
</p>

<p align="center">
  <a href="https://serdevir91.github.io/openscad-ai/"><strong>Launch the live web studio</strong></a> ·
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#connections">Connections</a> ·
  <a href="#build">Build</a> ·
  <a href="#security">Security</a>
</p>

<p align="center">
  <a href="https://serdevir91.github.io/openscad-ai/"><img alt="Live demo" src="https://img.shields.io/badge/demo-open_in_browser-0284c7?style=for-the-badge"></a>
  <a href="https://github.com/serdevir91/openscad-ai/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/serdevir91/openscad-ai/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/serdevir91/openscad-ai/actions/workflows/pages.yml"><img alt="Web studio" src="https://github.com/serdevir91/openscad-ai/actions/workflows/pages.yml/badge.svg"></a>
</p>

## Live web studio

Open the **[interactive browser demo](https://serdevir91.github.io/openscad-ai/)** to generate 3D CAD designs from text or reference sketches, adjust detected parameters, compile real geometry with OpenSCAD WebAssembly, inspect it in Three.js, and export SCAD, STL, 3MF, STEP, or PNG files.

- Web Studio offers six provider options: Google Gemini, OpenAI, Anthropic, OpenRouter, Ollama, and a custom OpenAI-compatible endpoint. API keys are stored in browser `localStorage` and sent directly to the chosen provider.
- The official headless OpenSCAD engine runs via WebAssembly inside web workers. Geometry is compiled and validated locally in the browser tab.
- Code that fails compilation is fed back to the model for repair before the result is shown.

Sign-in CLI providers (Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity), the remaining API-key providers, native OpenSCAD detection, native save dialogs, and the update check are available in the desktop application.

## Features

- Natural-language and reference-image design generation
- "Precise" pipeline, the default: the model writes a measurable plan, writes parametric OpenSCAD, compiles and measures the mesh, compares the result against the plan, repairs exact failures, and optionally reviews four rendered views with a vision model
- "Fast" mode: a single pass that only repairs compile errors
- Verification panel listing every check, viewport X/Y/Z size readout with a bounding box toggle, and OpenSCAD errors shown as editor markers
- 16 providers, including five sign-in CLIs that need no API key and local or custom endpoints
- OpenSCAD compile and validation through an installed OpenSCAD binary or the bundled WebAssembly build
- Exports to SCAD, STL, 3MF, STEP, and PNG in both the desktop app and Web Studio
- STEP export as true B-rep: analytic faces where possible, meshed features joined, and a faceted fallback when the exact solid fails validation
- Three.js viewport with orbit, pan, zoom, camera presets, materials, and wireframe mode
- Monaco Editor with OpenSCAD syntax highlighting and `Ctrl+Enter` compilation
- Collapsible assistant and code panels for a focused full-width viewport
- Parametric controls generated from top-level OpenSCAD variables and `// [min:step:max]` metadata
- Selectable persistent output folder
- Update check at startup and in Settings against GitHub Releases
- Star prompt after the third design that passes, plus a Rate button in Settings
- Dark, light, and pure-black AMOLED themes
- Official OpenSCAD documentation cache with prompt-relevant context
- Persistent custom CAD rules for print tolerances and modeling conventions

## Architecture

```text
React + TypeScript
├── src/ai: provider registry, prompts, plan checks, pipeline loop, transport
├── src/cad: mesh, CSG tree, B-rep, STEP, 3MF, rendered views, diagnostics
├── src/workers: OpenSCAD and STEP WebAssembly workers
├── Monaco OpenSCAD editor
├── Three.js viewport and verification panel
└── Typed Tauri IPC client
            │
            ▼
Rust + Tauri 2
├── OpenSCAD process runner and validation
├── HTTP and CLI provider adapters
├── Generation transport and cancellation
├── Documentation cache and context selection
└── Safe configuration, output-file management, and dialogs
```

Python is not required by the application or its build process.

## Precision pipeline

"Precise" mode is the default. It runs these steps:

1. The model writes a measurable plan: dimensions, holes, bodies, and assumptions.
2. The model writes parametric OpenSCAD for that plan.
3. The app compiles the model and measures the mesh: bounding box, volume, watertight state, body count, and through holes.
4. The measured result is compared against the plan, and exact failures are fed back for repair. Three repairs are allowed by default; the setting accepts up to five.
5. When a vision model is available, four rendered views are inspected.

The best model seen during the run is kept. "Fast" mode is a single pass that only repairs compile errors.

## Exports

The desktop app and Web Studio both export SCAD, STL, 3MF, STEP, and PNG. 3MF is written by the application from the mesh because the OpenSCAD WebAssembly build writes empty 3MF files.

### STEP

STEP export produces a true B-rep, not a mesh wrapper. The OpenSCAD `.csg` tree is rebuilt in OpenCascade (WebAssembly, in a worker) and written as AP214 STEP.

- Cylinders, cones, spheres, extrusions, and revolves become analytic faces. The log reports this result as "exact".
- Features with no analytic form, such as hull, minkowski, and text, are meshed and joined. The log reports this result as "mixed".
- If the exact solid fails validation against the mesh, the whole model is exported as a faceted solid. The log reports this result as "faceted".
- Circles with `$fn` below 16 stay polygons on purpose, such as hex nuts.

## Desktop app

### Windows Installer (Inno Setup)

A Windows installer is built from an Inno Setup script under `installer/`:
- Bundles the native **OpenSCAD AI** desktop application.
- Detects an existing OpenSCAD installation and offers an optional download and silent install of the official **OpenSCAD 3D Engine** when none is found.
- Offers an optional checkbox to install **Codex CLI** (`@openai/codex`) via npm.
- Creates Start Menu, Web Studio, and Desktop shortcuts with bilingual support (Turkish and English).

To build the setup executable:
```powershell
npm run build:installer
# Or double-click installer\build-installer.bat
```
Output: `dist-installer/OpenSCAD-AI-Setup-<version>.exe`, where `<version>` is set in `installer/OpenSCAD-AI-Setup.iss`.

## Quick start

### Requirements

- Windows 10 or 11, macOS, or Linux
- Node.js 20 or newer
- Current stable Rust toolchain
- One AI provider: a sign-in CLI, an API key, or a local endpoint
- OpenSCAD is optional. The desktop app uses an installed OpenSCAD when it finds one, including the standard macOS application locations, and enables the Manifold backend on releases from 2024. Otherwise it falls back to the bundled WebAssembly build.

### Clone and run

```powershell
git clone https://github.com/serdevir91/openscad-ai.git
cd openscad-ai
npm install
npm run desktop
```

To run the browser studio locally:

```powershell
npm run web
```

The first web run downloads a checksum-pinned OpenSCAD WebAssembly build from the official OpenSCAD file host. The generated runtime directory is ignored by Git.

On Windows, after a release build, double-click `run-app.bat`. It opens the release executable when one is available and falls back to development mode otherwise.

## Connections

The **Connections** screen is opened from the header button. It shows each provider's status, a key field where applicable, a **Get a key** link, the install command for CLIs, a **Sign in** action for CLIs, and a **Test connection** action. On first launch the desktop app selects the first CLI it finds; if none is found, it opens Connections.

Sign-in CLIs need no API key. Install the CLI, sign in with its own tool, then test the connection in the app. Authentication remains owned by the local CLI installation.

The app launches CLI processes without a shell, in a temporary folder, with tools disabled or read-only where the CLI supports it, and with process timeouts and cancellation. The design prompt is passed over standard input.

## Using the workspace

1. Describe the object in the assistant panel or attach a PNG, JPEG, or WebP reference.
2. Choose a provider and model. Enabled design rules are added to the generation request.
3. Generate the design. The pipeline validates the returned SCAD, measures the mesh, and repairs failures up to the configured limit.
4. Review the Verification panel and the X/Y/Z size readout in the viewport. Hide the code editor when you want a full-width geometry view.
5. Edit code directly or change detected parameters. Press `Ctrl+Enter` to compile.
6. Export SCAD, STL, 3MF, STEP, or PNG, or open an automatically saved model from the selected output folder.

## Output folder

Open **Settings → Files & rendering → Output folder** and select any writable local folder. The choice persists between launches. Restoring the application default stores generated files under the operating system application-data directory.

## Providers

There are 16 providers in the desktop app.

| Provider | Authentication | Notes |
|---|---|---|
| Claude Code | Existing CLI sign-in | Local process, no API key |
| Codex CLI | Existing CLI sign-in | Local process, no API key |
| Gemini CLI | Existing CLI sign-in | Local process, no API key |
| OpenCode | Existing CLI sign-in | Local process, no API key |
| Antigravity | Existing CLI sign-in | Local process, no API key |
| Google Gemini | API key | Gemini API |
| OpenAI | API key | OpenAI API |
| Anthropic | API key | Anthropic API |
| OpenRouter | API key | OpenRouter API |
| Groq | API key | Groq API |
| DeepSeek | API key | DeepSeek API |
| Mistral | API key | Mistral API |
| xAI | API key | xAI API |
| Ollama | None | `http://127.0.0.1:11434` by default |
| LM Studio | None | Local server |
| Custom | None or API key | Any OpenAI-compatible endpoint |

Web Studio offers only Gemini, OpenAI, Anthropic, OpenRouter, Ollama, and Custom.

Environment variables are preferred for optional cloud-provider keys:

```powershell
$env:GEMINI_API_KEY = "your-key"
$env:OPENAI_API_KEY = "your-key"
```

Do not put real values in `.env.example` or commit local settings files.

## Build

```powershell
# Frontend checks
npm test
npm run build

# GitHub Pages web build with OpenSCAD WASM
npm run build:web

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Optional evaluation with a real model and OpenSCAD (spends provider quota)
EVAL_PROVIDER=opencode npm run eval

# Optimized executable without an installer
npm run build:app

# Inno Setup Windows installer (optional OpenSCAD download + optional Codex CLI)
npm run build:installer
# Or run installer\build-installer.bat

# Standard Tauri build
npm run tauri build
```

The optimized executable is written to:

```text
src-tauri/target/release/openscad-ai.exe
```

## Configuration

Settings are saved atomically to `.openscad_ai_config.json` in the operating system application-data directory. The file holds:

- `provider`, `model`, `models`
- `keys`, `base_urls`, `paths`
- `openscad_path`, `output_dir`
- `theme`, `max_repairs`, `mode`, `render_timeout`, `onboarded`

The legacy `gemini_key`, `openai_key`, and `codex_path` fields are migrated on load. The project directory never receives runtime API keys.

## Updates and support

The desktop app checks GitHub Releases for updates at startup and from Settings. After the third design that passes, it offers a star prompt; Settings also has a Rate button. There is no in-app purchase: OpenSCAD AI is free GPL software.

## Security

- Runtime configuration, `.env` files, key material, generated models, build output, and executables are ignored by Git.
- API keys live only in the local app-data config file (owner-only permissions on Unix) or in browser `localStorage` for Web Studio, and are sent directly to the chosen provider.
- Errors scrub keys. Keys are never printed to the operation log.
- Sign-in CLI providers and local endpoints such as Ollama require no API key in this application.
- Every CLI runs without a shell, in a temporary folder, with tools disabled or read-only where the CLI allows it, and with process timeouts and cancellation.
- Browser calls send Gemini keys in the `x-goog-api-key` header, not in the URL.
- Links open through a command that accepts `https` only.
- Output-file reads validate names and remain inside the selected output directory.
- GitHub Actions runs frontend tests, Rust tests, production builds, and a Gitleaks scan.
- The web build downloads OpenSCAD WASM from the official OpenSCAD host and rejects it unless its SHA-256 checksum matches the pinned value.

Enable the repository's local pre-commit secret check once after cloning:

```powershell
git config core.hooksPath .githooks
```

See [SECURITY.md](SECURITY.md) for reporting instructions and the repository's secret-handling policy.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the OpenSCAD WebAssembly runtime attribution and source links.

## Development notes

Code layout:

- `src/ai/`: `providers.ts` (provider registry), `prompts.ts`, `spec.ts` (plan checks), `pipeline.ts` (generation loop), `transport.ts` (desktop and browser calls).
- `src/cad/`: `mesh.ts`, `csg.ts`, `brep.ts`, `step.ts`, `stepClient.ts`, `threeMf.ts`, `views.ts`, `diagnostics.ts`.
- `src/workers/`: `openscad.worker.ts`, `step.worker.ts`.
- `src-tauri/src/ai/`: `mod.rs`, `http.rs`, `cli.rs`.
- `src-tauri/src/openscad.rs`: OpenSCAD discovery and process execution.
- `src-tauri/src/config.rs`: atomic settings persistence.
- `src-tauri/capabilities/default.json`: minimal Tauri capability set.

Tests:

```powershell
# Unit and integration tests; the evaluation is not part of this run
npm test

# Optional evaluation with a real model and OpenSCAD; spends provider quota
EVAL_PROVIDER=opencode npm run eval

# Live CLI adapter tests
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_
```

`dist/`, `node_modules/`, `src-tauri/target/`, generated outputs, and all local configuration are intentionally excluded from version control.

## License

This project is licensed under the **GNU General Public License v3.0 or later** ([GPL-3.0-or-later](LICENSE)). See the [LICENSE](LICENSE) file for the full license text.
