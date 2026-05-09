#!/usr/bin/env python3
"""
Prompt -> OpenSCAD SCAD generation pipeline.

Requires:
  - OpenSCAD CLI installed
  - For provider=openai: OPENAI_API_KEY
  - For provider=codex: CODEX_API_KEY (or OPENAI_API_KEY)
  - For provider=ollama: running local Ollama server
  - For provider=gemini: GEMINI_API_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Optional
from urllib import error, request

import openscad_docs_context as docs_context_lib


def sanitize_api_key(raw: str) -> str:
    key = (raw or "").strip()
    if len(key) >= 2 and ((key[0] == '"' and key[-1] == '"') or (key[0] == "'" and key[-1] == "'")):
        key = key[1:-1].strip()
    return key


def detect_openscad(explicit_path: Optional[str]) -> str:
    if explicit_path:
        if Path(explicit_path).exists():
            return explicit_path
        raise FileNotFoundError(f"OpenSCAD path not found: {explicit_path}")

    candidates = [
        r"C:\Program Files\OpenSCAD\openscad.exe",
        r"C:\Program Files (x86)\OpenSCAD\openscad.exe",
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "OpenSCAD" / "openscad.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate

    which_path = shutil.which("openscad")
    if which_path:
        return which_path

    raise FileNotFoundError(
        "OpenSCAD executable not found. Use --openscad-path to specify it."
    )


def strip_code_fences(text: str) -> str:
    text = text.strip().lstrip("\ufeff")
    match = re.search(r"```(?:scad)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text


def build_messages(user_prompt: str, repair_context: Optional[str], docs_context: str) -> list[dict[str, str]]:
    system_prompt = (
        "You are an expert OpenSCAD engineer.\n"
        "Return ONLY valid OpenSCAD code.\n"
        "No markdown. No explanations. No code fences.\n"
        "Use clear parameters and avoid undefined variables.\n"
        "Output must be directly runnable by OpenSCAD CLI.\n"
        "Prefer canonical OpenSCAD syntax and documented modules/functions."
    )

    user_content = f"User request:\n{user_prompt}\n"
    if docs_context.strip():
        user_content += (
            "\nOfficial OpenSCAD documentation context (use this as authoritative reference):\n"
            f"{docs_context.strip()}\n"
        )
    if repair_context:
        user_content += (
            "\nFix the previous OpenSCAD code using this OpenSCAD error/output context.\n"
            f"{repair_context}\n"
            "Return corrected full OpenSCAD file content only."
        )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


def call_openai_chat(
    api_key: str,
    model: str,
    user_prompt: str,
    repair_context: Optional[str],
    docs_context: str,
    api_base: str,
) -> str:
    messages = build_messages(
        user_prompt=user_prompt,
        repair_context=repair_context,
        docs_context=docs_context,
    )

    payload = {
        "model": model,
        "messages": messages,
    }

    body = json.dumps(payload).encode("utf-8")
    url = api_base.rstrip("/") + "/chat/completions"
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP error {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"OpenAI connection error: {exc}") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected OpenAI response: {data}") from exc

    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Model returned empty content.")
    return strip_code_fences(content)


def call_ollama_chat(
    model: str,
    user_prompt: str,
    repair_context: Optional[str],
    docs_context: str,
    ollama_base: str,
) -> str:
    payload = {
        "model": model,
        "messages": build_messages(
            user_prompt=user_prompt,
            repair_context=repair_context,
            docs_context=docs_context,
        ),
        "stream": False,
    }
    body = json.dumps(payload).encode("utf-8")
    url = ollama_base.rstrip("/") + "/api/chat"
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with request.urlopen(req, timeout=240) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama HTTP error {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Ollama connection error: {exc}") from exc

    content = (
        data.get("message", {}).get("content")
        if isinstance(data, dict)
        else None
    )
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError(f"Unexpected Ollama response: {data}")
    return strip_code_fences(content)


def call_gemini_chat(
    api_key: str,
    model: str,
    user_prompt: str,
    repair_context: Optional[str],
    docs_context: str,
    gemini_base: str,
) -> str:
    messages = build_messages(
        user_prompt=user_prompt,
        repair_context=repair_context,
        docs_context=docs_context,
    )
    system_text = messages[0]["content"]
    user_text = messages[1]["content"]

    payload = {
        "systemInstruction": {"parts": [{"text": system_text}]},
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_text}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.95,
            "maxOutputTokens": 4096,
        },
    }

    body = json.dumps(payload).encode("utf-8")
    base = gemini_base.rstrip("/")
    url = f"{base}/v1beta/models/{model}:generateContent?key={api_key}"
    req = request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini HTTP error {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Gemini connection error: {exc}") from exc

    candidates = data.get("candidates", []) if isinstance(data, dict) else []
    if not candidates:
        raise RuntimeError(f"Unexpected Gemini response: {data}")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
    if not text.strip():
        raise RuntimeError(f"Gemini returned empty content: {data}")
    return strip_code_fences(text)


def call_codex_cli(
    model: str,
    user_prompt: str,
    repair_context: Optional[str],
    docs_context: str,
    codex_bin: str,
) -> str:
    codex_path = shutil.which(codex_bin) if codex_bin == "codex" else codex_bin
    if not codex_path:
        raise RuntimeError(f"Codex CLI not found: {codex_bin}")

    instruction = (
        "You are an expert OpenSCAD engineer.\n"
        "Return ONLY valid OpenSCAD code.\n"
        "No markdown. No explanations. No code fences.\n"
        "Use clear parameters and avoid undefined variables.\n"
        "Output must be directly runnable by OpenSCAD CLI.\n\n"
        f"User request:\n{user_prompt}\n"
    )
    if docs_context.strip():
        instruction += (
            "\nOfficial OpenSCAD documentation context (use this as authoritative reference):\n"
            f"{docs_context.strip()}\n"
        )
    if repair_context:
        instruction += (
            "\nFix the previous OpenSCAD code using this OpenSCAD error/output context.\n"
            f"{repair_context}\n"
            "Return corrected full OpenSCAD file content only."
        )

    out_file = Path(tempfile.gettempdir()) / f"codex_last_{uuid.uuid4().hex}.txt"
    schema_file = Path(tempfile.gettempdir()) / f"codex_schema_{uuid.uuid4().hex}.json"
    schema = {
        "type": "object",
        "properties": {"scad": {"type": "string"}},
        "required": ["scad"],
        "additionalProperties": False,
    }
    schema_file.write_text(json.dumps(schema), encoding="utf-8")
    cmd = [
        codex_path,
        "exec",
        "-m",
        model,
        "--skip-git-repo-check",
        "--output-schema",
        str(schema_file),
        "--output-last-message",
        str(out_file),
        "-",
    ]
    try:
        proc = subprocess.run(cmd, input=instruction, capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired as exc:
        try:
            schema_file.unlink()
        except OSError:
            pass
        raise RuntimeError("Codex CLI timed out while generating OpenSCAD.") from exc
    if proc.returncode != 0:
        raise RuntimeError(
            f"Codex CLI failed (exit {proc.returncode}). "
            f"stderr: {(proc.stderr or '').strip()} stdout: {(proc.stdout or '').strip()}"
        )

    if not out_file.exists():
        try:
            schema_file.unlink()
        except OSError:
            pass
        raise RuntimeError("Codex CLI finished but did not produce output message file.")

    raw = out_file.read_text(encoding="utf-8", errors="replace")
    try:
        out_file.unlink()
    except OSError:
        pass
    try:
        schema_file.unlink()
    except OSError:
        pass

    if not raw.strip():
        raise RuntimeError("Codex CLI returned empty content.")

    content = raw
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            scad = parsed.get("scad")
            if isinstance(scad, str) and scad.strip():
                content = scad
    except Exception:
        # Fallback to raw output when schema parsing fails.
        pass

    return strip_code_fences(content)


def run_openscad(openscad_path: str, args: list[str]) -> subprocess.CompletedProcess[str]:
    cmd = [openscad_path] + args
    return subprocess.run(cmd, capture_output=True, text=True)


def validate_scad(openscad_path: str, scad_file: Path) -> subprocess.CompletedProcess[str]:
    # OpenSCAD 2021 on Windows may not support "-o null" reliably.
    tmp_out = scad_file.parent / f".validate_{uuid.uuid4().hex}.stl"
    result = run_openscad(openscad_path, ["-o", str(tmp_out), str(scad_file)])
    try:
        if tmp_out.exists():
            tmp_out.unlink()
    except OSError:
        pass
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate validated OpenSCAD SCAD code from prompt using AI.")
    parser.add_argument("prompt", nargs="*", help="Model description prompt")
    parser.add_argument("--provider", choices=["openai", "codex", "ollama", "gemini"], default="gemini", help="AI provider")
    parser.add_argument("--openscad-path", default=None, help="Path to openscad executable")
    parser.add_argument("--api-base", default=os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1"))
    parser.add_argument("--ollama-base", default=os.environ.get("OLLAMA_BASE", "http://127.0.0.1:11434"))
    parser.add_argument("--gemini-base", default=os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com"))
    parser.add_argument("--gemini-key", default=None, help="Gemini API key (overrides env)")
    parser.add_argument("--codex-key", default=None, help="Unused in codex CLI mode; kept for compatibility")
    parser.add_argument("--codex-bin", default=os.environ.get("CODEX_BIN", "codex"), help="Codex CLI binary path")
    parser.add_argument("--model", default=None, help="Model name for selected provider")
    parser.add_argument("--output-dir", default="outputs", help="Directory for generated files")
    parser.add_argument("--name", default="model", help="Base filename")
    parser.add_argument("--max-fix-attempts", type=int, default=2, help="Auto-fix attempts on OpenSCAD error")
    parser.add_argument(
        "--docs-cache",
        default=".openscad_docs_cache.json",
        help="Path to local cache file for official OpenSCAD docs",
    )
    parser.add_argument(
        "--sync-docs",
        action="store_true",
        help="Force refresh of official OpenSCAD docs cache before generation",
    )
    parser.add_argument(
        "--docs-max-age-hours",
        type=int,
        default=24 * 7,
        help="Re-sync docs cache when older than this value",
    )
    parser.add_argument(
        "--docs-context-chars",
        type=int,
        default=3500,
        help="Maximum number of documentation context characters to inject",
    )
    parser.add_argument(
        "--no-doc-context",
        action="store_true",
        help="Disable official documentation context injection",
    )
    parser.add_argument(
        "--sync-docs-only",
        action="store_true",
        help="Sync official docs cache and exit without AI generation",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.prompt and not args.sync_docs_only:
        print("ERROR: prompt is required unless --sync-docs-only is used.", file=sys.stderr)
        return 2

    prompt_text = " ".join(args.prompt).strip()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    docs_cache_path = Path(args.docs_cache)
    if not docs_cache_path.is_absolute():
        docs_cache_path = (Path(__file__).resolve().parent / docs_cache_path).resolve()

    docs_cache_data: Optional[dict] = None
    if args.sync_docs:
        try:
            docs_cache_data = docs_context_lib.sync_docs_cache(cache_path=docs_cache_path)
            print(
                f"Docs cache synced: {docs_cache_path} "
                f"({docs_cache_data.get('source_count', 0)} sources)"
            )
        except Exception as exc:
            print(f"WARNING: Official docs sync failed: {exc}", file=sys.stderr)

    if docs_cache_data is None:
        docs_cache_data, docs_status = docs_context_lib.maybe_refresh_docs_cache(
            cache_path=docs_cache_path,
            max_age_hours=max(1, int(args.docs_max_age_hours)),
        )
        if docs_status in {"synced_new", "synced_stale"} and docs_cache_data is not None:
            print(
                f"Docs cache refreshed: {docs_cache_path} "
                f"({docs_cache_data.get('source_count', 0)} sources)"
            )
        elif docs_status == "missing_and_sync_failed":
            print(
                "WARNING: Official docs cache is missing and sync failed. "
                "Generation will continue with built-in guidance.",
                file=sys.stderr,
            )
        elif docs_status == "stale_sync_failed":
            print(
                "WARNING: Official docs cache sync failed. "
                "Using existing stale docs cache.",
                file=sys.stderr,
            )

    if args.sync_docs_only:
        if docs_cache_data is None:
            print("ERROR: Docs cache sync failed and no valid cache is available.", file=sys.stderr)
            return 1
        print(
            f"Docs cache ready: {docs_cache_path} "
            f"({docs_cache_data.get('source_count', 0)} sources)."
        )
        return 0

    docs_context = ""
    if not args.no_doc_context:
        docs_context = docs_context_lib.build_docs_context(
            user_prompt=prompt_text,
            cache_data=docs_cache_data,
            max_chars=max(1000, int(args.docs_context_chars)),
        )
        if docs_context.strip():
            print(f"Docs context enabled ({len(docs_context)} chars).")

    if args.provider == "openai":
        api_key = sanitize_api_key(os.environ.get("OPENAI_API_KEY", ""))
        if not api_key:
            print("ERROR: OPENAI_API_KEY is not set.", file=sys.stderr)
            return 1
        model = args.model or os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")
    elif args.provider == "codex":
        api_key = ""
        model = args.model or os.environ.get("CODEX_MODEL", "gpt-5.3-codex")
    elif args.provider == "gemini":
        api_key = sanitize_api_key(
            args.gemini_key
            or os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", "")
        )
        if not api_key:
            print("ERROR: GEMINI_API_KEY/GOOGLE_API_KEY is not set.", file=sys.stderr)
            return 1
        model = args.model or os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")
    else:
        api_key = ""
        model = args.model or os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:7b")

    scad_file = output_dir / f"{args.name}.scad"

    try:
        openscad_path = detect_openscad(args.openscad_path)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    repair_context = None
    scad_code = ""
    attempts = max(args.max_fix_attempts, 0) + 1

    for attempt in range(1, attempts + 1):
        try:
            if args.provider == "openai":
                scad_code = call_openai_chat(
                    api_key=api_key,
                    model=model,
                    user_prompt=prompt_text,
                    repair_context=repair_context,
                    docs_context=docs_context,
                    api_base=args.api_base,
                )
            elif args.provider == "codex":
                scad_code = call_codex_cli(
                    model=model,
                    user_prompt=prompt_text,
                    repair_context=repair_context,
                    docs_context=docs_context,
                    codex_bin=args.codex_bin,
                )
            elif args.provider == "gemini":
                scad_code = call_gemini_chat(
                    api_key=api_key,
                    model=model,
                    user_prompt=prompt_text,
                    repair_context=repair_context,
                    docs_context=docs_context,
                    gemini_base=args.gemini_base,
                )
            else:
                scad_code = call_ollama_chat(
                    model=model,
                    user_prompt=prompt_text,
                    repair_context=repair_context,
                    docs_context=docs_context,
                    ollama_base=args.ollama_base,
                )
        except Exception as exc:
            print(f"ERROR: AI request failed: {exc}", file=sys.stderr)
            return 1

        scad_file.write_text(scad_code, encoding="utf-8")

        check = validate_scad(openscad_path, scad_file)
        if check.returncode == 0:
            break

        if attempt == attempts:
            print("ERROR: OpenSCAD validation failed after retries.", file=sys.stderr)
            print(check.stderr, file=sys.stderr)
            return 1

        repair_context = (
            "Previous code:\n"
            + scad_code
            + "\n\nOpenSCAD stderr:\n"
            + (check.stderr or "(empty)")
            + "\n\nOpenSCAD stdout:\n"
            + (check.stdout or "(empty)")
        )

    print(f"SCAD: {scad_file}")
    print("Validation: OpenSCAD syntax/evaluation passed")
    print(f"OpenSCAD: {openscad_path}")
    print(f"Provider: {args.provider} | Model: {model}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
