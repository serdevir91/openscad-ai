<p align="center">
  <img src="src-tauri/icons/icon.png" alt="OpenSCAD AI" width="96">
</p>

<h1 align="center">OpenSCAD AI v0.2</h1>

<p align="center">
  A native AI-assisted parametric CAD studio built with Tauri 2, Rust, Three.js, and Monaco Editor.
</p>

<p align="center">
  <a href="https://serdevir91.github.io/openscad-ai/"><strong>Launch the live web studio</strong></a> ·
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#codex-cli-without-an-api-key">Codex CLI</a> ·
  <a href="#build">Build</a> ·
  <a href="#security">Security</a>
</p>

<p align="center">
  <a href="https://serdevir91.github.io/openscad-ai/"><img alt="Live demo" src="https://img.shields.io/badge/demo-open_in_browser-0284c7?style=for-the-badge"></a>
  <a href="https://github.com/serdevir91/openscad-ai/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/serdevir91/openscad-ai/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/serdevir91/openscad-ai/actions/workflows/pages.yml"><img alt="Web studio" src="https://github.com/serdevir91/openscad-ai/actions/workflows/pages.yml/badge.svg"></a>
</p>

## Live web studio

Open the **[interactive browser demo](https://serdevir91.github.io/openscad-ai/)** to edit OpenSCAD, change detected parameters, compile real geometry, inspect it in Three.js, and download SCAD or STL files. The official headless OpenSCAD engine runs as WebAssembly inside a background browser worker. Designs stay in the browser and no API key is requested.

GitHub Pages is static hosting, so local process integrations are intentionally available only in the desktop build: Codex CLI, Ollama, OpenSCAD desktop PNG export, selectable output folders, and cloud AI providers.

## Features

- Natural-language and reference-image design generation
- Local Codex CLI integration using your existing sign-in, with no API key required
- Gemini, OpenAI, and local Ollama provider support
- OpenSCAD compilation, geometry validation, STL generation, and automatic repair
- GPU-accelerated Three.js STL viewport with orbit, pan, zoom, camera presets, materials, and wireframe mode
- Monaco Editor with OpenSCAD syntax highlighting and `Ctrl+Enter` compilation
- Collapsible assistant and code panels for a focused full-width viewport
- Parametric controls generated from top-level OpenSCAD variables and `// [min:step:max]` metadata
- Selectable persistent output folder
- Native SCAD, STL, and PNG export dialogs
- GitHub Pages web studio with real in-browser OpenSCAD WebAssembly compilation and SCAD/STL downloads
- Dark, light, and pure-black AMOLED themes
- Official OpenSCAD documentation cache with prompt-relevant context
- Persistent custom CAD rules for print tolerances and modeling conventions

## Architecture

```text
React + TypeScript
├── Prompt, image, provider, model, and CAD-rule controls
├── Monaco OpenSCAD editor
├── Three.js STL viewport
└── Typed Tauri IPC client
            │
            ▼
Rust + Tauri 2
├── OpenSCAD process runner and validation
├── Generation and auto-repair pipeline
├── Gemini / OpenAI / Ollama HTTP clients
├── Local Codex CLI process adapter
├── Documentation cache and context selection
└── Safe configuration and output-file management
```

Python is not required by the application or its build process.

## Desktop app

## Quick start

### Requirements

- Windows 10 or 11
- [OpenSCAD](https://openscad.org/downloads.html)
- Node.js 20 or newer
- Current stable Rust toolchain
- One AI provider:
  - Codex CLI with an existing login
  - Ollama running locally
  - Gemini API key
  - OpenAI API key

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

After a release build, double-click `run-app.bat`. It automatically opens the release executable when one is available and falls back to development mode otherwise.

## Codex CLI without an API key

OpenSCAD AI can call the locally installed Codex CLI directly. It does not need an OpenAI API key for this provider.

1. Install the Codex CLI.
2. Run `codex login` in a terminal and complete the normal sign-in flow.
3. Open **Settings → Codex CLI** and click **Check connection**.
4. Select **Codex** in the design assistant.
5. Enter a model ID available to your Codex account.

The app launches `codex exec` with an ephemeral, read-only sandbox and passes the design prompt over standard input. Authentication remains owned by the local Codex CLI installation.

## Using the workspace

1. Describe the object in the assistant panel or attach a PNG, JPEG, or WebP reference.
2. Choose a provider and model. Enabled design rules are added to the generation request.
3. Generate the design. The Rust core validates the returned SCAD with OpenSCAD and repairs compiler failures up to the configured limit.
4. Inspect the STL in the viewport. Hide the code editor when you want a full-width geometry view.
5. Edit code directly or change detected parameters. Press `Ctrl+Enter` to compile.
6. Export SCAD, STL, or PNG, or open an automatically saved model from the selected output folder.

## Output folder

Open **Settings → Files & rendering → Output folder** and select any writable local folder. The choice persists between launches. Restoring the application default stores generated files under the operating system application-data directory.

## Providers

| Provider | Authentication | Endpoint or process |
|---|---|---|
| Codex CLI | Existing local `codex login` session | Local `codex exec` process |
| Ollama | None | `http://127.0.0.1:11434` |
| Gemini | `GEMINI_API_KEY` or local Settings | Google Gemini REST API |
| OpenAI | `OPENAI_API_KEY` or local Settings | OpenAI Chat Completions API |

Environment variables are preferred for cloud-provider keys:

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

# Optimized executable without an installer
npm run build:app

# Windows installer
npm run tauri build
```

The optimized executable is written to:

```text
src-tauri/target/release/openscad-ai.exe
```

## Configuration

Settings are saved atomically to `.openscad_ai_config.json` in the operating system application-data directory. The project directory never receives runtime API keys. Theme, output folder, provider, model, executable paths, and repair limits persist across launches.

## Security

- Runtime configuration, `.env` files, key material, generated models, build output, and executables are ignored by Git.
- API keys are never printed to the operation log.
- Codex CLI and Ollama require no API key in this application.
- Output-file reads validate names and remain inside the selected output directory.
- External processes have explicit timeouts and are terminated when cancelled.
- GitHub Actions runs frontend tests, Rust tests, production builds, and a Gitleaks scan.
- The web build downloads OpenSCAD WASM from the official OpenSCAD host and rejects it unless its SHA-256 checksum matches the pinned value.

Enable the repository's local pre-commit secret check once after cloning:

```powershell
git config core.hooksPath .githooks
```

See [SECURITY.md](SECURITY.md) for reporting instructions and the repository's secret-handling policy.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the OpenSCAD WebAssembly runtime attribution and source links.

## Development notes

- `src/` contains the React application.
- `src-tauri/src/` contains Rust commands and services.
- `src-tauri/capabilities/default.json` contains the minimal Tauri capability set.
- `dist/`, `node_modules/`, `src-tauri/target/`, generated outputs, and all local configuration are intentionally excluded from version control.

## License

No license has been granted yet. Add an explicit license before accepting external contributions or redistributing modified builds.
