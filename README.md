<p align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/OpenSCAD.svg/128px-OpenSCAD.svg.png" alt="OpenSCAD AI Logo" width="96">
</p>

<h1 align="center">OpenSCAD AI</h1>

<p align="center">
  <strong>Transform natural language into 3D-printable OpenSCAD models — powered by AI.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#usage">Usage</a> •
  <a href="#supported-providers">Providers</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## ✨ Features

- 🗣️ **Natural Language → SCAD**: Describe what you want in plain text, get valid OpenSCAD code
- 🔄 **Auto-Repair**: Automatically retries and fixes code when OpenSCAD validation fails
- 📚 **Documentation Context**: Injects official OpenSCAD docs into prompts for accurate code generation
- 🖼️ **Image to Prompt**: Upload a reference image and let AI generate an OpenSCAD prompt from it
- 🖥️ **Desktop UI**: Full-featured Tkinter GUI with integrated preview, file management, and log viewer
- 🔌 **Multi-Provider**: Supports Gemini, OpenAI, Codex CLI, and local Ollama models
- 📦 **Zero Dependencies**: Pure Python — only uses the standard library (no pip install required)

## 🎬 Demo

```
You: "parametric phone stand with cable slot, 120mm height"
  ↓
AI generates OpenSCAD code
  ↓
OpenSCAD CLI validates the output
  ↓
✅ phone_stand.scad → ready for 3D printing!
```

## 🚀 Quick Start

### Prerequisites

| Requirement | Details |
|---|---|
| **Python** | 3.9 or higher |
| **OpenSCAD** | [Download here](https://openscad.org/downloads.html) — CLI must be accessible |
| **AI Provider** | At least one: Gemini API key, OpenAI API key, Codex CLI, or local Ollama |

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/openscad-ai.git
cd openscad-ai
```

No pip dependencies — the project uses only Python standard library modules.

### Set Up Your API Key

Choose your provider and set the environment variable:

**Gemini** (recommended):
```bash
# Linux / macOS
export GEMINI_API_KEY="your-key-here"

# Windows PowerShell
$env:GEMINI_API_KEY="your-key-here"
```

**OpenAI**:
```bash
export OPENAI_API_KEY="your-key-here"
```

**Ollama** (local, no key needed):
```bash
# Just make sure Ollama is running
ollama serve
```

### Launch the UI

```bash
python openscad_ai_ui.py
```

Or on Windows:
```powershell
.\run-openscad-ai-ui.ps1
```

## 📖 Usage

### Desktop UI (Recommended)

The UI provides the full experience:

- **Prompt Editor** — Write your model description
- **Provider Selection** — Switch between Gemini, OpenAI, Codex, Ollama
- **Model Picker** — Auto-fetches available models from your provider
- **Image → Prompt** — Upload a reference image for automatic prompt generation
- **Output Browser** — Double-click `.scad` files to open in OpenSCAD
- **3D Preview** — Built-in STL/PNG preview with rotate & zoom
- **File Management** — Delete individual files or entire model sets
- **Auto Naming** — Generates descriptive filenames from your prompt
- **API Key Masking** — Keys are masked in all log output

### Command Line

```bash
# Basic generation
python prompt_to_openscad.py --provider gemini --model gemini-3.1-flash-lite-preview \
  "table leg with rounded base, height 120mm"

# With documentation sync
python prompt_to_openscad.py --sync-docs --provider gemini \
  "parametric desk organizer with pen slots"

# Sync docs cache only (no generation)
python prompt_to_openscad.py --sync-docs-only

# Using Ollama (local)
python prompt_to_openscad.py --provider ollama --model qwen2.5-coder:7b \
  "phone stand with cable slot"

# Using Codex CLI
python prompt_to_openscad.py --provider codex --model gpt-5.3-codex \
  "parametric phone stand"

# Disable doc context (debug)
python prompt_to_openscad.py --no-doc-context --provider gemini \
  "simple cube 20mm"
```

### PowerShell Wrapper

```powershell
.\run-openscad-ai.ps1 -Prompt "parametric phone stand with cable hole" -Name "phone_stand"

# Sync docs only
.\run-openscad-ai.ps1 -SyncDocsOnly
```

## 🔌 Supported Providers

| Provider | Default Model | API Key Required | Notes |
|---|---|---|---|
| **Gemini** | `gemini-3.1-flash-lite-preview` | ✅ `GEMINI_API_KEY` | Recommended, fast and accurate |
| **OpenAI** | `gpt-4.1-mini` | ✅ `OPENAI_API_KEY` | Full GPT-4 series support |
| **Codex CLI** | `gpt-5.3-codex` | Via CLI login | Requires `codex` CLI installed |
| **Ollama** | `qwen2.5-coder:7b` | ❌ Local only | Runs fully offline |

## 📁 Project Structure

```
openscad-ai/
├── prompt_to_openscad.py      # Core CLI pipeline
├── openscad_docs_context.py   # Official docs sync & context builder
├── openscad_ai_ui.py          # Desktop GUI (Tkinter)
├── run-openscad-ai.ps1        # PowerShell CLI wrapper
├── run-openscad-ai-ui.ps1     # PowerShell UI launcher
├── .gitignore
├── AGENT.md                   # AI agent reference doc
├── TASKS.md                   # Development task tracker
└── outputs/                   # Generated .scad files (gitignored)
```

## ⚙️ Configuration

### UI Configuration

The UI automatically saves your settings (provider, model, output directory) to `.openscad_ai_ui_config.json`. This file is **gitignored** to prevent accidental API key leaks.

### CLI Options

| Flag | Default | Description |
|---|---|---|
| `--provider` | `gemini` | AI provider (`gemini`, `openai`, `codex`, `ollama`) |
| `--model` | Provider default | Model name |
| `--output-dir` | `outputs` | Output directory for generated files |
| `--name` | `model` | Base filename for output |
| `--max-fix-attempts` | `2` | Auto-fix retry count on validation errors |
| `--openscad-path` | Auto-detect | Path to OpenSCAD executable |
| `--sync-docs` | off | Force refresh official docs cache |
| `--sync-docs-only` | off | Only sync docs, skip generation |
| `--no-doc-context` | off | Disable documentation context injection |
| `--docs-cache` | `.openscad_docs_cache.json` | Cache file path |
| `--docs-max-age-hours` | `168` (7 days) | Auto-refresh interval |
| `--docs-context-chars` | `3500` | Max doc context characters |

## 🔒 Security

- **API keys** are stored locally in `.openscad_ai_ui_config.json` (gitignored)
- Keys are **masked** in all UI log output
- No keys are hardcoded in source code
- The project uses environment variables as the primary key source

## 🔧 How It Works

```
┌─────────────┐     ┌─────────────────┐     ┌───────────────┐
│  User Prompt │────▶│  Docs Context   │────▶│  AI Provider  │
│  (text/image)│     │  (auto-cached)  │     │  (API call)   │
└─────────────┘     └─────────────────┘     └───────┬───────┘
                                                     │
                                                     ▼
                                            ┌───────────────┐
                                            │  SCAD Code    │
                                            │  (generated)  │
                                            └───────┬───────┘
                                                     │
                                                     ▼
                                            ┌───────────────┐
                                            │  OpenSCAD CLI │
                                            │  (validate)   │
                                            └───────┬───────┘
                                                     │
                                              ┌──────┴──────┐
                                              │             │
                                           ✅ Pass      ❌ Fail
                                              │             │
                                              ▼             ▼
                                         Save .scad    Auto-repair
                                                       (retry up to
                                                        N times)
```

1. **Prompt Enrichment** — Your prompt is combined with relevant official OpenSCAD documentation
2. **AI Generation** — The enriched prompt is sent to your chosen AI provider
3. **Validation** — Generated code is validated using OpenSCAD CLI
4. **Auto-Repair** — If validation fails, the error context is fed back to the AI for automatic fixing
5. **Output** — Validated `.scad` file is saved, ready to open in OpenSCAD or slice for 3D printing

## 📝 Notes

- Official docs cache auto-refreshes every 7 days
- OpenSCAD path is auto-detected on Windows; use `--openscad-path` if needed
- Large documentation context increases token usage — adjust with `--docs-context-chars`
- The `openscad/` directory (if present) contains the upstream OpenSCAD source and is gitignored

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is open source. See the repository for license details.

---

<p align="center">
  Made with ❤️ for the 3D printing & OpenSCAD community
</p>
