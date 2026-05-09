#!/usr/bin/env python3
"""Utilities for syncing and retrieving official OpenSCAD documentation context.

This module keeps a local cache of public OpenSCAD documentation pages and
builds a prompt-focused context block for LLM code generation.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional
from urllib import error, request

DOC_CACHE_VERSION = 1
DEFAULT_DOC_INDEX_URL = "https://openscad.org/documentation.html"
DEFAULT_MAX_AGE_HOURS = 24 * 7


@dataclass(frozen=True)
class DocSource:
    """Official documentation source and topic tags for matching."""

    url: str
    tags: tuple[str, ...]


DOC_SOURCES: tuple[DocSource, ...] = (
    DocSource(DEFAULT_DOC_INDEX_URL, ("documentation", "tutorial", "manual", "reference", "cheatsheet")),
    DocSource("https://openscad.org/cheatsheet/index.html", ("cheatsheet", "syntax", "quick", "reference")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/General", ("general", "language", "syntax", "variables")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Primitive_Solids", ("cube", "sphere", "cylinder", "primitives", "3d")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/2D_Primitives", ("circle", "square", "polygon", "2d", "primitives")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/2D_to_3D_Extrusion", ("extrude", "linear_extrude", "rotate_extrude", "height")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations", ("translate", "rotate", "scale", "mirror", "multmatrix")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/CSG_Modelling", ("union", "difference", "intersection", "boolean")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Conditional_and_Iterator_Functions", ("if", "for", "each", "iterator", "list")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/User-Defined_Functions_and_Modules", ("module", "function", "parameters", "library")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Text", ("text", "font", "size", "halign", "valign")),
    DocSource("https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Importing_Geometry", ("import", "stl", "dxf", "svg", "geometry")),
)

STOPWORDS: set[str] = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "your",
    "model",
    "make",
    "want",
    "need",
    "please",
    "open",
    "scad",
}

FALLBACK_GUIDANCE = (
    "Official OpenSCAD coding guidance:\n"
    "- Use valid OpenSCAD syntax with semicolons after statements.\n"
    "- Prefer clear parameters at top-level and reusable modules for repeated geometry.\n"
    "- Use CSG operations intentionally: union for merge, difference for cut, intersection for overlap.\n"
    "- Build 3D geometry from 2D profiles with linear_extrude/rotate_extrude when possible.\n"
    "- Keep transforms explicit: translate, rotate, scale, mirror; avoid hidden side effects.\n"
)


class _HtmlTextExtractor(HTMLParser):
    """Extract readable text while ignoring script/style content."""

    def __init__(self) -> None:
        super().__init__()
        self._ignore_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag.lower() in {"script", "style"}:
            self._ignore_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"} and self._ignore_depth > 0:
            self._ignore_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._ignore_depth > 0:
            return
        text = data.strip()
        if text:
            self._parts.append(text)

    def as_text(self) -> str:
        return "\n".join(self._parts)


def _clean_text(raw: str) -> str:
    text = raw.replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _extract_title(html: str) -> str:
    match = re.search(r"<title>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return "Untitled"
    title = re.sub(r"\s+", " ", match.group(1)).strip()
    return title or "Untitled"


def _fetch_html(url: str, timeout: float) -> str:
    req = request.Request(
        url,
        headers={
            "User-Agent": "OpenSCAD-AI-DocsSync/1.0",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.read().decode(charset, errors="replace")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail[:220]}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Connection error for {url}: {exc}") from exc


def _page_to_text(html: str) -> str:
    parser = _HtmlTextExtractor()
    parser.feed(html)
    return _clean_text(parser.as_text())


def sync_docs_cache(cache_path: Path, timeout: float = 20.0, max_chars_per_source: int = 18000) -> dict:
    """Download official docs pages and write a local JSON cache."""

    sources: list[dict[str, str]] = []
    errors: list[str] = []

    for source in DOC_SOURCES:
        try:
            html = _fetch_html(source.url, timeout=timeout)
            title = _extract_title(html)
            text = _page_to_text(html)
            if not text:
                raise RuntimeError("Empty extracted text")
            if len(text) > max_chars_per_source:
                text = text[:max_chars_per_source].rstrip() + "\n..."
            sources.append(
                {
                    "url": source.url,
                    "title": title,
                    "text": text,
                    "tags": " ".join(source.tags),
                }
            )
        except Exception as exc:
            errors.append(str(exc))

    if not sources:
        raise RuntimeError("Failed to fetch all documentation sources.")

    payload = {
        "version": DOC_CACHE_VERSION,
        "synced_at_utc": datetime.now(timezone.utc).isoformat(),
        "index_url": DEFAULT_DOC_INDEX_URL,
        "source_count": len(sources),
        "sources": sources,
        "errors": errors,
    }

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    return payload


def load_docs_cache(cache_path: Path) -> Optional[dict]:
    """Load docs cache from disk if present and valid."""

    if not cache_path.exists():
        return None
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if not isinstance(data, dict):
        return None
    if data.get("version") != DOC_CACHE_VERSION:
        return None
    if not isinstance(data.get("sources"), list):
        return None
    return data


def _cache_age_hours(cache_data: dict) -> Optional[float]:
    raw = cache_data.get("synced_at_utc")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt.astimezone(timezone.utc)
    return max(0.0, delta.total_seconds() / 3600.0)


def maybe_refresh_docs_cache(
    cache_path: Path,
    max_age_hours: int = DEFAULT_MAX_AGE_HOURS,
    timeout: float = 12.0,
) -> tuple[Optional[dict], str]:
    """Refresh cache only if missing or older than max_age_hours."""

    current = load_docs_cache(cache_path)
    if current is None:
        try:
            new_data = sync_docs_cache(cache_path=cache_path, timeout=timeout)
            return new_data, "synced_new"
        except Exception:
            return None, "missing_and_sync_failed"

    age = _cache_age_hours(current)
    if age is None or age <= float(max_age_hours):
        return current, "fresh"

    try:
        new_data = sync_docs_cache(cache_path=cache_path, timeout=timeout)
        return new_data, "synced_stale"
    except Exception:
        return current, "stale_sync_failed"


def _tokenize(text: str) -> list[str]:
    parts = re.findall(r"[a-zA-Z_][a-zA-Z0-9_\-]{2,}", text.lower())
    unique: list[str] = []
    seen: set[str] = set()
    for token in parts:
        if token in STOPWORDS:
            continue
        if token in seen:
            continue
        seen.add(token)
        unique.append(token)
    return unique


def _extract_snippet(text: str, tokens: list[str], max_len: int = 720) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= max_len:
        return compact

    best_idx = -1
    best_token_len = 0
    low = compact.lower()
    for token in tokens:
        idx = low.find(token)
        if idx < 0:
            continue
        if best_idx < 0 or len(token) > best_token_len:
            best_idx = idx
            best_token_len = len(token)

    if best_idx < 0:
        return compact[:max_len].rstrip() + "..."

    start = max(0, best_idx - 220)
    end = min(len(compact), start + max_len)
    snippet = compact[start:end].strip()
    if start > 0:
        snippet = "..." + snippet
    if end < len(compact):
        snippet = snippet + "..."
    return snippet


def _score_source(source: dict[str, str], tokens: list[str]) -> int:
    text = (source.get("text") or "").lower()
    tags = (source.get("tags") or "").lower()

    score = 0
    for token in tokens:
        if token in tags:
            score += 4
        if token in text:
            score += 1
    return score


def _default_summary(cache_data: Optional[dict]) -> str:
    if cache_data and isinstance(cache_data.get("source_count"), int):
        return (
            f"Official OpenSCAD docs index: {cache_data.get('index_url', DEFAULT_DOC_INDEX_URL)}\n"
            f"Cached sources: {cache_data.get('source_count', 0)}\n"
        )
    return f"Official OpenSCAD docs index: {DEFAULT_DOC_INDEX_URL}\n"


def build_docs_context(user_prompt: str, cache_data: Optional[dict], max_chars: int = 3500) -> str:
    """Build prompt-specific documentation context for model calls."""

    tokens = _tokenize(user_prompt)
    header = _default_summary(cache_data)
    guidance = FALLBACK_GUIDANCE

    if not cache_data:
        context = header + guidance
        return context[:max_chars]

    raw_sources = cache_data.get("sources")
    if not isinstance(raw_sources, list) or not raw_sources:
        context = header + guidance
        return context[:max_chars]

    ranked = []
    for source in raw_sources:
        if not isinstance(source, dict):
            continue
        score = _score_source(source, tokens)
        ranked.append((score, source))

    ranked.sort(key=lambda x: x[0], reverse=True)
    selected = [item for item in ranked if item[0] > 0][:4]
    if not selected:
        selected = ranked[:3]

    blocks: list[str] = [header.rstrip(), guidance.rstrip(), "Relevant official documentation snippets:"]

    for _, source in selected:
        title = str(source.get("title", "Untitled")).strip()
        url = str(source.get("url", "")).strip()
        text = str(source.get("text", "")).strip()
        if not text:
            continue
        snippet = _extract_snippet(text, tokens)
        block = f"- {title} ({url})\n  {snippet}"
        blocks.append(block)
        joined = "\n".join(blocks)
        if len(joined) >= max_chars:
            return joined[:max_chars].rstrip()

    final_context = "\n".join(blocks).strip()
    if len(final_context) > max_chars:
        return final_context[:max_chars].rstrip()
    return final_context
