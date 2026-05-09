#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import math
import mimetypes
import os
import queue
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Optional
from urllib import error, request

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import prompt_to_openscad as core

DEFAULT_MODELS = {
    "gemini": "gemini-3.1-flash-lite-preview",
    "openai": "gpt-4.1-mini",
    "codex": "gpt-5.3-codex",
    "ollama": "qwen2.5-coder:7b",
}
DEFAULT_PROMPT = "parametrik telefon standi, kablo gecisi olsun"
CONFIG_FILENAME = ".openscad_ai_ui_config.json"
MAX_PREVIEW_TRIANGLES = 6000


class OpenSCADAIUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("OpenSCAD AI UI")
        self.root.geometry("1240x780")
        self.root.minsize(820, 520)

        self.base_dir = Path(__file__).resolve().parent
        self.script_path = self.base_dir / "prompt_to_openscad.py"
        self.config_path = self.base_dir / CONFIG_FILENAME
        self.config_data = self._load_config()

        saved_provider = str(self.config_data.get("provider", "gemini")).strip().lower()
        if saved_provider not in DEFAULT_MODELS:
            saved_provider = "gemini"

        saved_output_dir = str(self.config_data.get("output_dir", "")).strip() or str(self.base_dir / "outputs")
        saved_keys = self.config_data.get("keys", {}) if isinstance(self.config_data.get("keys", {}), dict) else {}
        saved_models = self.config_data.get("models", {}) if isinstance(self.config_data.get("models", {}), dict) else {}

        self.outputs_dir_var = tk.StringVar(value=saved_output_dir)
        self.provider_var = tk.StringVar(value=saved_provider)
        self.model_var = tk.StringVar(value=str(saved_models.get(saved_provider, DEFAULT_MODELS[saved_provider])))
        self.name_var = tk.StringVar(value=str(self.config_data.get("name", "")).strip() or self._slug_from_prompt(DEFAULT_PROMPT))
        self.key_var = tk.StringVar(value=str(saved_keys.get(saved_provider, "")))
        self.auto_name_var = tk.BooleanVar(value=bool(self.config_data.get("auto_name", True)))
        self.reference_image_var = tk.StringVar(value=str(self.config_data.get("reference_image", "")).strip())
        self.status_var = tk.StringVar(value="Ready")

        self.current_provider = saved_provider
        self.log_queue: "queue.Queue[tuple[str, Any]]" = queue.Queue()
        self.is_running = False
        self.is_analyzing = False
        self.models_loading = False
        self.current_process: Optional[subprocess.Popen[str]] = None
        self.save_after_id: Optional[str] = None
        self.prompt_edit_after_id: Optional[str] = None

        self.openscad_path: Optional[str] = None
        self._detect_openscad_path()

        self.preview_mode = "none"
        self.preview_source_img: Optional[tk.PhotoImage] = None
        self.preview_render_img: Optional[tk.PhotoImage] = None
        self.preview_stl_path: Optional[Path] = None
        self.mesh_triangles: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]] = []
        self.mesh_rot_x = -0.55
        self.mesh_rot_y = 0.75
        self.mesh_zoom = 1.0
        self.drag_last_xy: Optional[tuple[int, int]] = None

        self._build_ui()
        self.refresh_outputs()
        self.root.after(250, self.refresh_models_async)

    def _load_config(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_config(self) -> None:
        try:
            self.config_path.write_text(json.dumps(self.config_data, indent=2), encoding="utf-8")
        except Exception as exc:
            self.append_log(f"WARNING: Config save failed: {exc}")

    def _save_current_provider_state(self) -> None:
        provider = self.current_provider
        keys = self.config_data.setdefault("keys", {})
        models = self.config_data.setdefault("models", {})
        if not isinstance(keys, dict):
            keys = {}
            self.config_data["keys"] = keys
        if not isinstance(models, dict):
            models = {}
            self.config_data["models"] = models

        keys[provider] = self.key_var.get().strip()
        model_text = self.model_var.get().strip()
        if model_text:
            models[provider] = model_text

        self.config_data["provider"] = self.provider_var.get().strip()
        self.config_data["output_dir"] = self.outputs_dir_var.get().strip()
        self.config_data["auto_name"] = bool(self.auto_name_var.get())
        self.config_data["name"] = self.name_var.get().strip()
        self.config_data["reference_image"] = self.reference_image_var.get().strip()
        self._save_config()

    def _resolved_key_for_provider(self, provider: str) -> str:
        raw = self.key_var.get().strip()
        if raw:
            return core.sanitize_api_key(raw)

        keys = self.config_data.get("keys", {})
        if not isinstance(keys, dict):
            keys = {}

        if provider == "gemini":
            return core.sanitize_api_key(
                str(keys.get("gemini", "")) or os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")
            )
        if provider == "codex":
            return core.sanitize_api_key(
                str(keys.get("codex", ""))
                or str(keys.get("openai", ""))
                or os.environ.get("CODEX_API_KEY", "")
                or os.environ.get("OPENAI_API_KEY", "")
            )
        if provider == "openai":
            return core.sanitize_api_key(
                str(keys.get("openai", ""))
                or str(keys.get("codex", ""))
                or os.environ.get("OPENAI_API_KEY", "")
                or os.environ.get("CODEX_API_KEY", "")
            )
        return core.sanitize_api_key(str(keys.get("ollama", "")))

    def _schedule_config_save(self) -> None:
        if self.save_after_id is not None:
            self.root.after_cancel(self.save_after_id)
        self.save_after_id = self.root.after(350, self._save_current_provider_state)

    def _detect_openscad_path(self) -> None:
        try:
            self.openscad_path = core.detect_openscad(None)
        except Exception:
            self.openscad_path = None

    def _build_ui(self) -> None:
        style = ttk.Style(self.root)
        style.configure("Header.TLabel", font=("Segoe UI", 14, "bold"))
        style.configure("Sub.TLabel", font=("Segoe UI", 10))

        main = ttk.Frame(self.root, padding=12)
        main.pack(fill=tk.BOTH, expand=True)

        header = ttk.Frame(main)
        header.pack(fill=tk.X)
        ttk.Label(header, text="OpenSCAD AI Control Panel", style="Header.TLabel").pack(side=tk.LEFT)
        ttk.Label(header, text=f"OpenSCAD: {self.openscad_path if self.openscad_path else 'Not found'}", style="Sub.TLabel").pack(side=tk.RIGHT)

        body = ttk.Panedwindow(main, orient=tk.HORIZONTAL)
        body.pack(fill=tk.BOTH, expand=True, pady=(10, 0))

        left = ttk.Frame(body, padding=10)
        right = ttk.Frame(body, padding=10)
        body.add(left, weight=2)
        body.add(right, weight=3)

        self._build_form(left)
        self._build_outputs(right)

        status = ttk.Frame(main)
        status.pack(fill=tk.X, pady=(8, 0))
        ttk.Label(status, textvariable=self.status_var).pack(side=tk.LEFT)
        self.progress = ttk.Progressbar(status, mode="indeterminate", length=180)
        self.progress.pack(side=tk.RIGHT)

    def _build_form(self, parent: ttk.Frame) -> None:
        ttk.Label(parent, text="Prompt", style="Sub.TLabel").pack(anchor=tk.W)
        self.prompt_text = tk.Text(parent, height=6, wrap=tk.WORD, font=("Consolas", 11))
        self.prompt_text.pack(fill=tk.X, pady=(4, 8))
        self.prompt_text.insert("1.0", DEFAULT_PROMPT)
        self.prompt_text.bind("<KeyRelease>", self._on_prompt_change)

        ref_row = ttk.Frame(parent)
        ref_row.pack(fill=tk.X, pady=(0, 8))
        ref_row.columnconfigure(0, weight=1)
        ttk.Entry(ref_row, textvariable=self.reference_image_var).grid(row=0, column=0, sticky=tk.EW)
        ttk.Button(ref_row, text="Image...", command=self.choose_reference_image).grid(row=0, column=1, padx=(6, 0))
        self.analyze_btn = ttk.Button(ref_row, text="Image -> Prompt", command=self.analyze_reference_image)
        self.analyze_btn.grid(row=0, column=2, padx=(6, 0))

        grid = ttk.Frame(parent)
        grid.pack(fill=tk.X)
        grid.columnconfigure(1, weight=1)

        ttk.Label(grid, text="Provider").grid(row=0, column=0, sticky=tk.W, pady=4)
        provider_combo = ttk.Combobox(grid, textvariable=self.provider_var, values=["gemini", "codex", "openai", "ollama"], state="readonly")
        provider_combo.grid(row=0, column=1, sticky=tk.EW, pady=4)
        provider_combo.bind("<<ComboboxSelected>>", self._on_provider_change)

        ttk.Label(grid, text="Model").grid(row=1, column=0, sticky=tk.W, pady=4)
        model_row = ttk.Frame(grid)
        model_row.grid(row=1, column=1, sticky=tk.EW, pady=4)
        model_row.columnconfigure(0, weight=1)
        self.model_combo = ttk.Combobox(model_row, textvariable=self.model_var, state="normal")
        self.model_combo.grid(row=0, column=0, sticky=tk.EW)
        self.model_combo.bind("<<ComboboxSelected>>", lambda _e: self._schedule_config_save())
        self.model_combo.bind("<KeyRelease>", lambda _e: self._schedule_config_save())
        ttk.Button(model_row, text="Refresh", command=self.refresh_models_async).grid(row=0, column=1, padx=(6, 0))

        ttk.Label(grid, text="Output Name").grid(row=2, column=0, sticky=tk.W, pady=4)
        self.name_entry = ttk.Entry(grid, textvariable=self.name_var)
        self.name_entry.grid(row=2, column=1, sticky=tk.EW, pady=4)
        self.name_entry.bind("<KeyRelease>", lambda _e: self._schedule_config_save())

        ttk.Checkbutton(grid, text="Auto name from prompt", variable=self.auto_name_var, command=self._on_auto_name_toggle).grid(row=3, column=1, sticky=tk.W, pady=2)

        ttk.Label(grid, text="API Key").grid(row=4, column=0, sticky=tk.W, pady=4)
        key_entry = ttk.Entry(grid, textvariable=self.key_var, show="*")
        key_entry.grid(row=4, column=1, sticky=tk.EW, pady=4)
        key_entry.bind("<KeyRelease>", lambda _e: self._schedule_config_save())
        key_entry.bind("<FocusOut>", lambda _e: self._schedule_config_save())

        ttk.Label(grid, text="Outputs Folder").grid(row=5, column=0, sticky=tk.W, pady=4)
        out_row = ttk.Frame(grid)
        out_row.grid(row=5, column=1, sticky=tk.EW, pady=4)
        out_row.columnconfigure(0, weight=1)
        out_entry = ttk.Entry(out_row, textvariable=self.outputs_dir_var)
        out_entry.grid(row=0, column=0, sticky=tk.EW)
        out_entry.bind("<FocusOut>", lambda _e: self._schedule_config_save())
        ttk.Button(out_row, text="...", width=4, command=self._pick_output_folder).grid(row=0, column=1, padx=(6, 0))

        button_row = ttk.Frame(parent)
        button_row.pack(fill=tk.X, pady=(12, 0))
        self.generate_btn = ttk.Button(button_row, text="Generate", command=self.start_generation)
        self.generate_btn.pack(side=tk.LEFT)
        ttk.Button(button_row, text="Refresh Outputs", command=self.refresh_outputs).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(button_row, text="Clear Log", command=self.clear_log).pack(side=tk.LEFT, padx=(8, 0))

        ttk.Label(parent, text="Logs", style="Sub.TLabel").pack(anchor=tk.W, pady=(12, 4))
        self.log_box = tk.Text(parent, height=12, wrap=tk.WORD, font=("Consolas", 10))
        self.log_box.pack(fill=tk.BOTH, expand=True)
        self._on_auto_name_toggle()

    def _build_outputs(self, parent: ttk.Frame) -> None:
        split = ttk.Panedwindow(parent, orient=tk.VERTICAL)
        split.pack(fill=tk.BOTH, expand=True)

        top = ttk.Frame(split, padding=0)
        bottom = ttk.Frame(split, padding=0)
        split.add(top, weight=3)
        split.add(bottom, weight=2)

        ttk.Label(top, text="Generated SCAD Files (double-click to open)", style="Sub.TLabel").pack(anchor=tk.W)

        columns = ("file", "type", "modified")
        self.outputs_tree = ttk.Treeview(top, columns=columns, show="headings", selectmode="extended")
        self.outputs_tree.heading("file", text="File")
        self.outputs_tree.heading("type", text="Type")
        self.outputs_tree.heading("modified", text="Modified")
        self.outputs_tree.column("file", width=430, anchor=tk.W)
        self.outputs_tree.column("type", width=80, anchor=tk.CENTER)
        self.outputs_tree.column("modified", width=170, anchor=tk.CENTER)
        self.outputs_tree.pack(fill=tk.BOTH, expand=True, pady=(6, 8))
        self.outputs_tree.bind("<Double-1>", self._on_double_click_output)
        self.outputs_tree.bind("<<TreeviewSelect>>", self._on_output_selection_changed)
        self.outputs_tree.bind("<Delete>", lambda _e: self.delete_selected_outputs())

        output_buttons = ttk.Frame(top)
        output_buttons.pack(fill=tk.X)
        ttk.Button(output_buttons, text="Open Selected", command=self.open_selected_output).pack(side=tk.LEFT)
        ttk.Button(output_buttons, text="Open Output Folder", command=self.open_output_folder).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(output_buttons, text="Delete Selected", command=self.delete_selected_outputs).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(output_buttons, text="Delete Model Set", command=self.delete_selected_model_sets).pack(side=tk.LEFT, padx=(8, 0))

        ttk.Label(bottom, text="Preview (legacy PNG/STL if available)", style="Sub.TLabel").pack(anchor=tk.W, pady=(2, 4))
        self.preview_canvas = tk.Canvas(bottom, background="#161616", highlightthickness=0)
        self.preview_canvas.pack(fill=tk.BOTH, expand=True)
        self.preview_canvas.bind("<Configure>", self._on_preview_resize)
        self.preview_canvas.bind("<ButtonPress-1>", self._on_preview_mouse_down)
        self.preview_canvas.bind("<B1-Motion>", self._on_preview_mouse_drag)
        self.preview_canvas.bind("<MouseWheel>", self._on_preview_wheel)
        self.preview_canvas.bind("<Button-4>", self._on_preview_wheel)
        self.preview_canvas.bind("<Button-5>", self._on_preview_wheel)

    def append_log(self, text: str) -> None:
        self.log_box.insert(tk.END, text.rstrip() + "\n")
        self.log_box.see(tk.END)

    def clear_log(self) -> None:
        self.log_box.delete("1.0", tk.END)

    def _on_prompt_change(self, _event: object) -> None:
        if not self.auto_name_var.get():
            return
        if self.prompt_edit_after_id is not None:
            self.root.after_cancel(self.prompt_edit_after_id)
        self.prompt_edit_after_id = self.root.after(220, self._sync_name_from_prompt)

    def _on_auto_name_toggle(self) -> None:
        if self.auto_name_var.get():
            self.name_entry.state(["disabled"])
            self._sync_name_from_prompt()
        else:
            self.name_entry.state(["!disabled"])
        self._schedule_config_save()

    def _sync_name_from_prompt(self) -> None:
        prompt = self.prompt_text.get("1.0", tk.END).strip()
        self.name_var.set(self._slug_from_prompt(prompt))
        self._schedule_config_save()

    def _slug_from_prompt(self, prompt: str) -> str:
        text = prompt or ""
        tr_map = str.maketrans({
            "i": "i", "I": "I", "s": "s", "S": "S", "g": "g", "G": "G",
            "c": "c", "C": "C", "o": "o", "O": "O", "u": "u", "U": "U",
            "?": "i", "?": "I", "?": "s", "?": "S", "?": "g", "?": "G",
            "?": "c", "?": "C", "?": "o", "?": "O", "?": "u", "?": "U",
        })
        text = text.translate(tr_map)
        normalized = unicodedata.normalize("NFKD", text)
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
        tokens = re.findall(r"[a-zA-Z0-9]+", ascii_text.lower())
        if not tokens:
            return "model"
        return "_".join(tokens[:8])[:64].strip("_") or "model"

    def _build_auto_generation_name(self, prompt: str, out_dir: Path) -> str:
        base = self._slug_from_prompt(prompt)
        candidate = f"{base}_{time.strftime('%Y%m%d_%H%M%S')}"
        n = 2
        while (out_dir / f"{candidate}.scad").exists():
            candidate = f"{base}_{time.strftime('%Y%m%d_%H%M%S')}_{n}"
            n += 1
        return candidate

    def _mask_cmd_for_log(self, cmd: list[str]) -> str:
        masked: list[str] = []
        skip_next = False
        for token in cmd:
            if skip_next:
                skip_next = False
                continue
            if token in ("--gemini-key", "--codex-key"):
                masked.extend([token, "***"])
                skip_next = True
                continue
            masked.append(token)
        return " ".join(masked)

    def _on_provider_change(self, _event: object) -> None:
        self._save_current_provider_state()
        self.current_provider = self.provider_var.get().strip()
        keys = self.config_data.get("keys", {}) if isinstance(self.config_data.get("keys", {}), dict) else {}
        models = self.config_data.get("models", {}) if isinstance(self.config_data.get("models", {}), dict) else {}
        self.key_var.set(str(keys.get(self.current_provider, "")))
        self.model_var.set(str(models.get(self.current_provider, DEFAULT_MODELS[self.current_provider])))
        self._save_current_provider_state()
        self.refresh_models_async()

    def choose_reference_image(self) -> None:
        picked = filedialog.askopenfilename(
            title="Select Reference Image",
            filetypes=[("Image files", "*.png;*.jpg;*.jpeg;*.webp;*.bmp"), ("All files", "*.*")],
            initialdir=str(self.base_dir),
        )
        if picked:
            self.reference_image_var.set(picked)
            self._save_current_provider_state()

    def _pick_output_folder(self) -> None:
        selected = filedialog.askdirectory(initialdir=self.outputs_dir_var.get() or str(self.base_dir))
        if selected:
            self.outputs_dir_var.set(selected)
            self._save_current_provider_state()
            self.refresh_outputs()

    def analyze_reference_image(self) -> None:
        if self.is_analyzing or self.is_running:
            return
        image_path = Path(self.reference_image_var.get().strip())
        if not image_path.exists():
            messagebox.showwarning("Missing Image", "Please select a valid image file.")
            return

        provider = self.provider_var.get().strip()
        model = self.model_var.get().strip() or DEFAULT_MODELS.get(provider, "")
        key = self._resolved_key_for_provider(provider)
        self._save_current_provider_state()

        if provider in ("gemini", "openai") and not key:
            messagebox.showwarning("Missing API Key", "Please enter API key for selected provider.")
            return

        self.is_analyzing = True
        self.status_var.set("Analyzing image...")
        self.progress.start(10)
        self.analyze_btn.state(["disabled"])
        self.append_log(f"Analyzing reference image with provider={provider}, model={model}")

        threading.Thread(target=self._analyze_image_worker, args=(provider, model, key, image_path), daemon=True).start()
        self.root.after(100, self._drain_log_queue)

    def _analyze_image_worker(self, provider: str, model: str, key: str, image_path: Path) -> None:
        try:
            prompt = self._generate_prompt_from_image(provider, model, key, image_path)
            self.log_queue.put(("prompt_generated", {"prompt": prompt, "error": ""}))
        except Exception as exc:
            self.log_queue.put(("prompt_generated", {"prompt": "", "error": str(exc)}))

    def _generate_prompt_from_image(self, provider: str, model: str, key: str, image_path: Path) -> str:
        mime = mimetypes.guess_type(str(image_path))[0] or "image/png"
        b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
        instruction = (
            "Bu resmi analiz et ve OpenSCAD ile modellenebilecek teknik bir prompt yaz. "
            "Sadece tek bir prompt cumlesi don. Olculeri tahmini mm cinsinden belirt."
        )

        if provider == "gemini":
            base = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com").rstrip("/")
            url = f"{base}/v1beta/models/{model}:generateContent?key={key}"
            payload = {
                "contents": [{"role": "user", "parts": [{"text": instruction}, {"inline_data": {"mime_type": mime, "data": b64}}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 350},
            }
            data = self._http_post_json(url, payload, {"Content-Type": "application/json"})
            parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
            if not text:
                raise RuntimeError(f"Gemini vision empty response: {data}")
            return text

        if provider == "openai":
            base = os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
            url = f"{base}/chat/completions"
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "Output one concise OpenSCAD-ready prompt sentence."},
                    {"role": "user", "content": [
                        {"type": "text", "text": instruction},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    ]},
                ],
            }
            data = self._http_post_json(url, payload, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if not isinstance(text, str) or not text.strip():
                raise RuntimeError(f"OpenAI vision empty response: {data}")
            return text.strip()

        if provider == "codex":
            return self._generate_prompt_from_image_codex_cli(model=model, image_path=image_path, instruction=instruction)

        base = os.environ.get("OLLAMA_BASE", "http://127.0.0.1:11434").rstrip("/")
        url = f"{base}/api/chat"
        payload = {"model": model, "messages": [{"role": "user", "content": instruction, "images": [b64]}], "stream": False}
        data = self._http_post_json(url, payload, {"Content-Type": "application/json"})
        text = data.get("message", {}).get("content", "")
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError(f"Ollama vision empty response: {data}")
        return text.strip()

    def _generate_prompt_from_image_codex_cli(self, model: str, image_path: Path, instruction: str) -> str:
        codex_bin = os.environ.get("CODEX_BIN", "codex")
        codex_path = shutil.which(codex_bin) if codex_bin == "codex" else codex_bin
        if not codex_path:
            raise RuntimeError(f"Codex CLI not found: {codex_bin}")

        out_file = Path(tempfile.gettempdir()) / f"codex_img_prompt_{uuid.uuid4().hex}.txt"
        cmd = [
            codex_path,
            "exec",
            "-m",
            model,
            "--skip-git-repo-check",
            "--output-last-message",
            str(out_file),
            "-i",
            str(image_path),
            "-",
        ]
        try:
            proc = subprocess.run(
                cmd,
                input=instruction,
                capture_output=True,
                text=True,
                cwd=str(self.base_dir),
                timeout=180,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Codex CLI image analysis timed out.") from exc
        if proc.returncode != 0:
            raise RuntimeError(f"Codex CLI image analysis failed ({proc.returncode}): {(proc.stderr or proc.stdout or '').strip()}")
        if not out_file.exists():
            raise RuntimeError("Codex CLI finished but did not return output message.")
        text = out_file.read_text(encoding="utf-8", errors="replace").strip()
        try:
            out_file.unlink()
        except OSError:
            pass
        if not text:
            raise RuntimeError("Codex CLI returned empty prompt from image.")
        return text

    def start_generation(self) -> None:
        if self.is_running or self.is_analyzing:
            return
        prompt = self.prompt_text.get("1.0", tk.END).strip()
        if not prompt:
            messagebox.showwarning("Missing Prompt", "Please enter a prompt.")
            return

        out_dir = Path(self.outputs_dir_var.get().strip() or str(self.base_dir / "outputs"))
        out_dir.mkdir(parents=True, exist_ok=True)

        if self.auto_name_var.get():
            name = self._build_auto_generation_name(prompt, out_dir)
            self.name_var.set(name)
        else:
            name = self.name_var.get().strip()
            if not name:
                messagebox.showwarning("Missing Name", "Please enter an output name.")
                return

        provider = self.provider_var.get().strip()
        model = self.model_var.get().strip() or DEFAULT_MODELS.get(provider, "")
        key = self._resolved_key_for_provider(provider)
        self._save_current_provider_state()

        cmd = [
            sys.executable, str(self.script_path), "--provider", provider, "--model", model,
            "--output-dir", str(out_dir), "--name", name,
        ]
        if provider == "gemini" and key:
            cmd.extend(["--gemini-key", key])
        cmd.append(prompt)

        env = os.environ.copy()
        if provider == "openai" and key:
            env["OPENAI_API_KEY"] = key

        self.set_running(True)
        self.append_log("> " + self._mask_cmd_for_log(cmd))
        self.status_var.set("Generating...")

        threading.Thread(target=self._run_generation_worker, args=(cmd, env), daemon=True).start()
        self.root.after(100, self._drain_log_queue)

    def _run_generation_worker(self, cmd: list[str], env: dict[str, str]) -> None:
        try:
            self.current_process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, cwd=str(self.base_dir))
            assert self.current_process.stdout is not None
            for line in self.current_process.stdout:
                self.log_queue.put(("line", line.rstrip("\n")))
            self.log_queue.put(("done", self.current_process.wait()))
        except Exception as exc:
            self.log_queue.put(("line", f"ERROR: {exc}"))
            self.log_queue.put(("done", 1))

    def _drain_log_queue(self) -> None:
        finished = False
        while True:
            try:
                kind, payload = self.log_queue.get_nowait()
            except queue.Empty:
                break

            if kind == "line":
                self.append_log(str(payload))
            elif kind == "done":
                finished = True
                rc = int(payload)
                if rc == 0:
                    self.status_var.set("Completed")
                    self.append_log("Generation completed successfully.")
                    self.refresh_outputs()
                else:
                    self.status_var.set("Failed")
                    self.append_log(f"Generation failed (exit code {rc}).")
                self.set_running(False)
            elif kind == "models":
                info = payload if isinstance(payload, dict) else {}
                provider = str(info.get("provider", ""))
                models = info.get("models", [])
                err = str(info.get("error", "")).strip()
                if provider == self.provider_var.get().strip():
                    if isinstance(models, list) and models:
                        self.model_combo["values"] = models
                        cur = self.model_var.get().strip()
                        if not cur or cur not in models:
                            self.model_var.set(models[0])
                            self._save_current_provider_state()
                    if err:
                        self.append_log(f"Model list warning ({provider}): {err}")
                        if not self.is_running and not self.is_analyzing:
                            self.status_var.set(f"Model fetch failed ({provider})")
                    if not self.is_running and not self.is_analyzing:
                        if not err:
                            self.status_var.set("Ready")
            elif kind == "prompt_generated":
                info = payload if isinstance(payload, dict) else {}
                gen_prompt = str(info.get("prompt", "")).strip()
                err = str(info.get("error", "")).strip()
                self.is_analyzing = False
                self.analyze_btn.state(["!disabled"])
                if not self.is_running:
                    self.progress.stop()
                if err:
                    self.append_log(f"Image analysis failed: {err}")
                    self.status_var.set("Image analysis failed")
                else:
                    self.prompt_text.delete("1.0", tk.END)
                    self.prompt_text.insert("1.0", gen_prompt)
                    if self.auto_name_var.get():
                        self._sync_name_from_prompt()
                    self.append_log("Prompt generated from image.")
                    self.status_var.set("Image prompt ready")

        if (self.is_running or self.models_loading or self.is_analyzing) and not finished:
            self.root.after(120, self._drain_log_queue)

    def set_running(self, running: bool) -> None:
        self.is_running = running
        if running:
            self.generate_btn.state(["disabled"])
            self.analyze_btn.state(["disabled"])
            self.progress.start(10)
        else:
            self.generate_btn.state(["!disabled"])
            if not self.is_analyzing:
                self.analyze_btn.state(["!disabled"])
                self.progress.stop()

    def refresh_models_async(self) -> None:
        if self.models_loading:
            return
        provider = self.provider_var.get().strip()
        key = self._resolved_key_for_provider(provider)
        self.models_loading = True
        if not self.is_running and not self.is_analyzing:
            self.status_var.set("Fetching models...")

        def worker() -> None:
            models: list[str] = []
            err_msg = ""
            try:
                models = self._fetch_models(provider, key)
            except Exception as exc:
                err_msg = str(exc)
            if not models:
                models = [DEFAULT_MODELS[provider]]
            self.log_queue.put(("models", {"provider": provider, "models": models, "error": err_msg}))
            self.models_loading = False

        threading.Thread(target=worker, daemon=True).start()
        self.root.after(100, self._drain_log_queue)

    def _fetch_models(self, provider: str, key: str) -> list[str]:
        if provider == "gemini":
            return self._fetch_gemini_models(key)
        if provider == "openai":
            return self._fetch_openai_models(key, DEFAULT_MODELS[provider])
        if provider == "codex":
            return self._fetch_codex_models()
        return self._fetch_ollama_models()

    def _fetch_codex_models(self) -> list[str]:
        # Codex CLI does not currently expose a machine-readable "list models" command.
        candidates = [
            "gpt-5.3-codex",
            "gpt-5.2-codex",
            "gpt-5.1-codex-max",
            "gpt-5.1-codex-mini",
        ]
        return self._prioritize_default(candidates, DEFAULT_MODELS["codex"])

    def _fetch_gemini_models(self, key: str) -> list[str]:
        if not key:
            return [DEFAULT_MODELS["gemini"]]
        base = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com").rstrip("/")
        data = self._http_get_json(f"{base}/v1beta/models?key={key}", {})
        models = []
        for item in data.get("models", []):
            name = str(item.get("name", ""))
            methods = item.get("supportedGenerationMethods", [])
            if name.startswith("models/") and isinstance(methods, list) and "generateContent" in methods:
                models.append(name.split("/", 1)[1])
        return self._prioritize_default(sorted(set(models)), DEFAULT_MODELS["gemini"])

    def _fetch_openai_models(self, key: str, default_model: str) -> list[str]:
        if not key:
            return [default_model]
        base = os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
        data = self._http_get_json(f"{base}/models", {"Authorization": f"Bearer {key}"})
        ids = sorted(set(str(i.get("id", "")).strip() for i in data.get("data", []) if str(i.get("id", "")).strip()))
        return self._prioritize_default(ids, default_model) if ids else [default_model]

    def _fetch_ollama_models(self) -> list[str]:
        base = os.environ.get("OLLAMA_BASE", "http://127.0.0.1:11434").rstrip("/")
        data = self._http_get_json(f"{base}/api/tags", {})
        names = sorted(set(str(i.get("name", "")).strip() for i in data.get("models", []) if str(i.get("name", "")).strip()))
        return self._prioritize_default(names, DEFAULT_MODELS["ollama"]) if names else [DEFAULT_MODELS["ollama"]]

    def _http_get_json(self, url: str, headers: dict[str, str]) -> dict[str, Any]:
        req = request.Request(url, method="GET", headers=headers)
        try:
            with request.urlopen(req, timeout=25) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Connection error: {exc}") from exc

    def _http_post_json(self, url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        req = request.Request(url, method="POST", data=json.dumps(payload).encode("utf-8"), headers=headers)
        try:
            with request.urlopen(req, timeout=90) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Connection error: {exc}") from exc

    def _prioritize_default(self, items: list[str], default: str) -> list[str]:
        clean = [x for x in items if x]
        if default in clean:
            clean.remove(default)
        return [default] + clean

    def refresh_outputs(self) -> None:
        selected_before = self.outputs_tree.selection()
        selected_path = Path(selected_before[0]) if selected_before else None

        for item in self.outputs_tree.get_children():
            self.outputs_tree.delete(item)

        out_dir = Path(self.outputs_dir_var.get().strip() or str(self.base_dir / "outputs"))
        out_dir.mkdir(parents=True, exist_ok=True)

        files = []
        for ext in ("*.scad",):
            files.extend(out_dir.glob(ext))
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

        chosen: Optional[Path] = None
        for p in files:
            mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(p.stat().st_mtime))
            ftype = p.suffix.lower().replace(".", "").upper()
            self.outputs_tree.insert("", tk.END, iid=str(p), values=(p.name, ftype, mtime))
            if selected_path and p == selected_path:
                chosen = p

        if chosen is None and files:
            chosen = files[0]
        if chosen is not None:
            self.outputs_tree.selection_set(str(chosen))
            self.outputs_tree.focus(str(chosen))
            self._show_preview_for_path(chosen)
        else:
            self.preview_mode = "none"
            self.preview_source_img = None
            self.mesh_triangles = []
            self._render_preview()

    def _on_output_selection_changed(self, _event: object) -> None:
        selected = self.outputs_tree.selection()
        if selected:
            self._show_preview_for_path(Path(selected[0]))

    def _show_preview_for_path(self, path: Path) -> None:
        if not path.exists():
            return
        suffix = path.suffix.lower()
        if suffix == ".stl":
            self._load_stl_preview(path)
        elif suffix == ".png":
            self._load_png_preview(path)
        elif suffix == ".scad":
            stl = path.with_suffix(".stl")
            png = path.with_suffix(".png")
            if stl.exists():
                self._load_stl_preview(stl)
            elif png.exists():
                self._load_png_preview(png)
            else:
                self.preview_mode = "none"
                self._render_preview("No preview for this SCAD yet")
        else:
            self.preview_mode = "none"
            self._render_preview("Preview unavailable")

    def _load_png_preview(self, png_path: Path) -> None:
        try:
            self.preview_source_img = tk.PhotoImage(file=str(png_path))
            self.preview_mode = "png"
            self._render_preview()
        except Exception:
            self.preview_mode = "none"
            self.preview_source_img = None
            self._render_preview(f"Preview unavailable: {png_path.name}")

    def _load_stl_preview(self, stl_path: Path) -> None:
        try:
            tris = self._parse_stl(stl_path)
            if not tris:
                raise RuntimeError("STL has no triangles")
            self.mesh_triangles = self._normalize_triangles(tris)
            self.preview_stl_path = stl_path
            self.mesh_rot_x, self.mesh_rot_y, self.mesh_zoom = -0.55, 0.75, 1.0
            self.preview_mode = "stl"
            self._render_preview()
        except Exception as exc:
            self.preview_mode = "none"
            self.mesh_triangles = []
            self._render_preview(f"3D preview failed: {exc}")

    def _parse_stl(self, path: Path) -> list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]:
        data = path.read_bytes()
        if len(data) >= 84:
            tri_count = struct.unpack("<I", data[80:84])[0]
            expected = 84 + tri_count * 50
            if expected == len(data):
                step = max(1, int(math.ceil(tri_count / MAX_PREVIEW_TRIANGLES)))
                out = []
                for i in range(0, tri_count, step):
                    base = 84 + i * 50
                    v1 = struct.unpack("<fff", data[base + 12:base + 24])
                    v2 = struct.unpack("<fff", data[base + 24:base + 36])
                    v3 = struct.unpack("<fff", data[base + 36:base + 48])
                    out.append((v1, v2, v3))
                return out

        txt = data.decode("utf-8", errors="ignore")
        verts = []
        for line in txt.splitlines():
            s = line.strip().lower()
            if s.startswith("vertex "):
                parts = s.split()
                if len(parts) >= 4:
                    try:
                        verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
                    except ValueError:
                        pass
        tris = []
        for i in range(0, len(verts) - 2, 3):
            tris.append((verts[i], verts[i + 1], verts[i + 2]))
        if len(tris) > MAX_PREVIEW_TRIANGLES:
            stride = int(math.ceil(len(tris) / MAX_PREVIEW_TRIANGLES))
            tris = tris[::stride]
        return tris

    def _normalize_triangles(self, tris):
        xs, ys, zs = [], [], []
        for a, b, c in tris:
            for x, y, z in (a, b, c):
                xs.append(x); ys.append(y); zs.append(z)
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        min_z, max_z = min(zs), max(zs)
        cx, cy, cz = (min_x + max_x) / 2.0, (min_y + max_y) / 2.0, (min_z + max_z) / 2.0
        extent = max(max_x - min_x, max_y - min_y, max_z - min_z)
        scale = extent if extent > 1e-9 else 1.0
        out = []
        for a, b, c in tris:
            na = ((a[0] - cx) / scale, (a[1] - cy) / scale, (a[2] - cz) / scale)
            nb = ((b[0] - cx) / scale, (b[1] - cy) / scale, (b[2] - cz) / scale)
            nc = ((c[0] - cx) / scale, (c[1] - cy) / scale, (c[2] - cz) / scale)
            out.append((na, nb, nc))
        return out

    def _on_preview_resize(self, _event: object) -> None:
        self._render_preview()

    def _on_preview_mouse_down(self, event: tk.Event[Any]) -> None:
        self.drag_last_xy = (int(event.x), int(event.y))

    def _on_preview_mouse_drag(self, event: tk.Event[Any]) -> None:
        if self.preview_mode != "stl" or not self.mesh_triangles or not self.drag_last_xy:
            return
        dx = int(event.x) - self.drag_last_xy[0]
        dy = int(event.y) - self.drag_last_xy[1]
        self.drag_last_xy = (int(event.x), int(event.y))
        self.mesh_rot_y += dx * 0.01
        self.mesh_rot_x += dy * 0.01
        self._render_preview()

    def _on_preview_wheel(self, event: tk.Event[Any]) -> None:
        if self.preview_mode != "stl":
            return
        delta = 0
        if hasattr(event, "delta") and event.delta:
            delta = 1 if event.delta > 0 else -1
        elif getattr(event, "num", None) == 4:
            delta = 1
        elif getattr(event, "num", None) == 5:
            delta = -1
        if delta == 0:
            return
        self.mesh_zoom *= 1.08 if delta > 0 else 0.92
        self.mesh_zoom = max(0.35, min(3.5, self.mesh_zoom))
        self._render_preview()

    def _render_preview(self, text: str = "No preview") -> None:
        if self.preview_mode == "stl" and self.mesh_triangles:
            self._render_stl_preview(); return
        if self.preview_mode == "png" and self.preview_source_img is not None:
            self._render_png_preview(); return
        c = self.preview_canvas
        c.delete("all")
        c.create_text(max(1, c.winfo_width()) // 2, max(1, c.winfo_height()) // 2, text=text, fill="#cfcfcf")

    def _render_png_preview(self) -> None:
        c = self.preview_canvas
        c.delete("all")
        w, h = max(1, c.winfo_width()), max(1, c.winfo_height())
        src = self.preview_source_img
        if src is None:
            c.create_text(w // 2, h // 2, text="No preview", fill="#cfcfcf"); return
        fit = max(src.width() / max(1, w - 12), src.height() / max(1, h - 12))
        factor = max(1, int(math.ceil(fit)))
        render = src.subsample(factor, factor) if factor > 1 else src
        self.preview_render_img = render
        c.create_image(w // 2, h // 2, image=self.preview_render_img, anchor=tk.CENTER)

    def _rotate_point(self, p, sinx, cosx, siny, cosy):
        x, y, z = p
        x1 = x * cosy + z * siny
        z1 = -x * siny + z * cosy
        y2 = y * cosx - z1 * sinx
        z2 = y * sinx + z1 * cosx
        return (x1, y2, z2)

    def _normal(self, a, b, c):
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        return (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)

    def _render_stl_preview(self) -> None:
        c = self.preview_canvas
        c.delete("all")
        w, h = max(1, c.winfo_width()), max(1, c.winfo_height())
        cx, cy = w / 2.0, h / 2.0
        f = min(w, h) * 0.92 * self.mesh_zoom
        cam = 3.2
        sinx, cosx = math.sin(self.mesh_rot_x), math.cos(self.mesh_rot_x)
        siny, cosy = math.sin(self.mesh_rot_y), math.cos(self.mesh_rot_y)
        lx, ly, lz = 0.35, -0.4, 0.85

        items = []
        for a, b, cc in self.mesh_triangles:
            ra = self._rotate_point(a, sinx, cosx, siny, cosy)
            rb = self._rotate_point(b, sinx, cosx, siny, cosy)
            rc = self._rotate_point(cc, sinx, cosx, siny, cosy)
            za, zb, zc = ra[2] + cam, rb[2] + cam, rc[2] + cam
            if za <= 0.05 or zb <= 0.05 or zc <= 0.05:
                continue
            pa = (cx + ra[0] * f / za, cy - ra[1] * f / za)
            pb = (cx + rb[0] * f / zb, cy - rb[1] * f / zb)
            pc = (cx + rc[0] * f / zc, cy - rc[1] * f / zc)
            nx, ny, nz = self._normal(ra, rb, rc)
            ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            shade = max(0.15, min(1.0, (nx / ln) * lx + (ny / ln) * ly + (nz / ln) * lz + 0.25))
            g = int(65 + 170 * shade)
            items.append(((ra[2] + rb[2] + rc[2]) / 3.0, pa, pb, pc, f"#{g:02x}{g:02x}{g:02x}"))

        items.sort(key=lambda x: x[0])
        for _, pa, pb, pc, color in items:
            c.create_polygon(pa[0], pa[1], pb[0], pb[1], pc[0], pc[1], fill=color, outline="#1f1f1f", width=0.4)

        tip = "3D STL Preview | Drag: rotate | Wheel: zoom"
        if self.preview_stl_path is not None:
            tip += f" | {self.preview_stl_path.name}"
        c.create_text(8, 8, text=tip, anchor=tk.NW, fill="#dddddd")

    def _on_double_click_output(self, _event: object) -> None:
        self.open_selected_output()

    def open_selected_output(self) -> None:
        selected = self.outputs_tree.selection()
        if selected:
            self.open_file(Path(selected[0]))

    def delete_selected_outputs(self) -> None:
        selected = self.outputs_tree.selection()
        if not selected:
            return
        paths = [Path(i) for i in selected]
        if not messagebox.askyesno("Delete files", f"Delete {len(paths)} selected file(s)?"):
            return
        deleted = 0
        for p in paths:
            try:
                if p.exists():
                    p.unlink(); deleted += 1
            except Exception as exc:
                self.append_log(f"Delete failed for {p.name}: {exc}")
        self.append_log(f"Deleted {deleted} file(s).")
        self.refresh_outputs()

    def delete_selected_model_sets(self) -> None:
        selected = self.outputs_tree.selection()
        if not selected:
            return
        stems = {Path(i).stem for i in selected}
        out_dir = Path(self.outputs_dir_var.get().strip() or str(self.base_dir / "outputs"))
        targets = []
        for stem in stems:
            for ext in (".scad", ".stl", ".png"):
                p = out_dir / f"{stem}{ext}"
                if p.exists():
                    targets.append(p)
            w = out_dir / f".open_{stem}.scad"
            if w.exists():
                targets.append(w)
        if not targets:
            return
        if not messagebox.askyesno("Delete model sets", f"Delete {len(targets)} related file(s)?"):
            return
        deleted = 0
        for p in targets:
            try:
                p.unlink(); deleted += 1
            except Exception as exc:
                self.append_log(f"Delete failed for {p.name}: {exc}")
        self.append_log(f"Deleted {deleted} file(s) from model set(s).")
        self.refresh_outputs()

    def open_file(self, path: Path) -> None:
        if not path.exists():
            messagebox.showerror("Missing file", f"File not found:\n{path}"); return
        suffix = path.suffix.lower()
        if suffix == ".scad":
            self._open_in_openscad(path)
        elif suffix == ".stl":
            self._open_stl_in_openscad(path)
        else:
            os.startfile(str(path))  # type: ignore[attr-defined]

    def _open_in_openscad(self, file_path: Path) -> None:
        if not self.openscad_path:
            self._detect_openscad_path()
        if not self.openscad_path:
            messagebox.showerror("OpenSCAD not found", "OpenSCAD executable was not found."); return
        subprocess.Popen([self.openscad_path, str(file_path)], cwd=str(self.base_dir))

    def _open_stl_in_openscad(self, stl_path: Path) -> None:
        wrapper = stl_path.with_name(f".open_{stl_path.stem}.scad")
        wrapper.write_text(f'import("{stl_path.resolve().as_posix()}");\n', encoding="ascii")
        self._open_in_openscad(wrapper)

    def open_output_folder(self) -> None:
        out_dir = Path(self.outputs_dir_var.get().strip() or str(self.base_dir / "outputs"))
        out_dir.mkdir(parents=True, exist_ok=True)
        os.startfile(str(out_dir))  # type: ignore[attr-defined]


def main() -> int:
    root = tk.Tk()
    OpenSCADAIUI(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
