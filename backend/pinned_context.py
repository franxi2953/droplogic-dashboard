from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


PINNED_CONTEXT_INLINE_LIMIT = 12_000
GUIDE_EXPANSION_CHAR_LIMIT = 28_000
JSON_CONTEXT_SUMMARY_MAX_LINES = 140
JSON_CONTEXT_CHILD_LIMIT = 16
JSON_CONTEXT_MAX_DEPTH = 4
JSON_CONTEXT_VALUE_LIMIT = 240
JSON_CONTEXT_IMPORTANT_KEYWORDS = (
    "cartridge",
    "geometry",
    "matrix",
    "electrode",
    "row",
    "column",
    "col",
    "width",
    "height",
    "shape",
    "hole",
    "injection",
    "reservoir",
    "stage",
    "camera",
    "preset",
    "origin",
    "spacing",
    "pitch",
    "offset",
)


def compact_pinned_context_file(
    relative_path: str,
    text: str,
) -> tuple[str, dict[str, Any]]:
    clean_path = str(relative_path).replace("\\", "/")
    original_chars = len(text)
    basename = Path(clean_path).name.lower()
    if original_chars > PINNED_CONTEXT_INLINE_LIMIT:
        compacted = build_large_context_index(clean_path, text)
    else:
        compacted = text.strip()
    return compacted, {
        "original_chars": original_chars,
        "sent_chars": len(compacted),
        "compacted": compacted != text.strip(),
    }


def guide_shard_catalog(root: Path, directory: str = "agent-guide") -> list[dict[str, Any]]:
    shard_dir = root / directory
    if not shard_dir.is_dir():
        return []
    shards: list[dict[str, Any]] = []
    for path in sorted(shard_dir.glob("*.md")):
        if path.name == "index.md":
            continue
        text = path.read_text(encoding="utf-8")
        title = first_markdown_heading(text) or path.stem.replace("-", " ").title()
        preview = " ".join(line.strip() for line in text.splitlines()[1:8] if line.strip())
        shards.append(
            {
                "path": f"{directory}/{path.name}",
                "title": title,
                "chars": len(text),
                "preview": preview[:700],
            }
        )
    return shards


def first_markdown_heading(text: str) -> str:
    match = re.search(r"^##?\s+(.+?)\s*$", text, flags=re.MULTILINE)
    return " ".join(match.group(1).split()) if match else ""


def build_guide_expansion_context(root: Path, paths: list[str], max_chars: int = GUIDE_EXPANSION_CHAR_LIMIT) -> tuple[str, list[dict[str, Any]]]:
    sections: list[str] = []
    loaded: list[dict[str, Any]] = []
    current_chars = 0
    for raw_path in paths:
        clean_path = str(raw_path).strip().replace("\\", "/")
        if not clean_path:
            continue
        if clean_path in {item["path"] for item in loaded}:
            continue
        candidate = (root / clean_path).resolve()
        try:
            candidate.relative_to(root.resolve())
        except ValueError:
            continue
        if not candidate.is_file() or candidate.suffix.lower() != ".md":
            continue
        text = candidate.read_text(encoding="utf-8").strip()
        section = f"### {clean_path}\n{text}"
        next_chars = len(section) + 2
        if sections and current_chars + next_chars > max_chars:
            loaded.append({"path": clean_path, "omitted": True, "reason": "guide_expansion_char_limit"})
            break
        sections.append(section)
        current_chars += next_chars
        loaded.append({"path": clean_path, "chars": len(text), "sent_chars": len(section)})
    if not sections:
        return "", loaded
    return "# Turn-Scoped Detailed Guide Expansions\nThese detailed guide files were selected for this model turn only. Re-evaluate guide needs on the next turn.\n\n" + "\n\n".join(sections), loaded


def parse_guide_shard_selection(text: str, allowed_paths: list[str], max_files: int) -> dict[str, Any]:
    raw_text = str(text or "").strip()
    parsed: Any = None
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw_text, flags=re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                parsed = None
    if isinstance(parsed, list):
        parsed = {"paths": parsed, "reason": ""}
    if not isinstance(parsed, dict):
        return {"paths": [], "reason": "guide shard selector returned non-JSON", "raw_text": raw_text[:500]}

    allowed = set(allowed_paths)
    paths: list[str] = []
    raw_paths = parsed.get("paths")
    if isinstance(raw_paths, list):
        for item in raw_paths:
            path = str(item).strip().replace("\\", "/")
            if path in allowed and path not in paths:
                paths.append(path)
            if len(paths) >= max_files:
                break
    return {
        "paths": paths,
        "reason": str(parsed.get("reason") or "")[:700],
        "raw_text": raw_text[:500],
    }


def build_large_context_index(relative_path: str, text: str) -> str:
    if Path(relative_path).suffix.lower() == ".json":
        json_summary = build_large_json_context_summary(relative_path, text)
        if json_summary is not None:
            return json_summary

    headings = extract_markdown_headings(text)
    heading_text = "\n".join(f"- {item}" for item in headings[:60]) or "- No markdown headings found."
    return (
        f"# Compacted Pinned Context: {relative_path}\n"
        f"The full file has {len(text)} characters and is available through read_context_file.\n"
        "Read it before acting on details that are not present in the compact run context.\n\n"
        f"## Headings\n{heading_text}"
    )


def build_large_json_context_summary(relative_path: str, text: str) -> str | None:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None

    lines = [
        f"# Compacted JSON Pinned Context: {relative_path}",
        f"The full JSON file has {len(text)} characters and is available through read_context_file.",
        "Read it before acting on details that are not present in the compact run context.",
        "",
        f"JSON root: {describe_json_value(payload)}",
    ]
    if isinstance(payload, dict):
        keys = list(payload)
        lines.append(f"Top-level keys ({len(keys)}): {format_key_list(keys)}")
    lines.extend(["", "## Structured Summary"])
    append_json_summary_lines(lines, "$", payload, depth=0)
    return "\n".join(lines)


def append_json_summary_lines(lines: list[str], path: str, value: Any, *, depth: int) -> None:
    if len(lines) >= JSON_CONTEXT_SUMMARY_MAX_LINES:
        return
    lines.append(f"- {path}: {describe_json_value(value)}")
    if depth >= JSON_CONTEXT_MAX_DEPTH or len(lines) >= JSON_CONTEXT_SUMMARY_MAX_LINES:
        return
    if isinstance(value, dict):
        items = prioritized_json_items(value)
        shown = 0
        for key, child in items:
            if shown >= JSON_CONTEXT_CHILD_LIMIT or len(lines) >= JSON_CONTEXT_SUMMARY_MAX_LINES:
                break
            append_json_summary_lines(lines, f"{path}.{key}", child, depth=depth + 1)
            shown += 1
        if len(value) > shown and len(lines) < JSON_CONTEXT_SUMMARY_MAX_LINES:
            lines.append(f"- {path}: ... {len(value) - shown} more fields")
    elif isinstance(value, list) and depth < 2:
        for index, child in enumerate(value[:3]):
            if len(lines) >= JSON_CONTEXT_SUMMARY_MAX_LINES:
                break
            append_json_summary_lines(lines, f"{path}[{index}]", child, depth=depth + 1)
        if len(value) > 3 and len(lines) < JSON_CONTEXT_SUMMARY_MAX_LINES:
            lines.append(f"- {path}: ... {len(value) - 3} more items")


def prioritized_json_items(value: dict[str, Any]) -> list[tuple[str, Any]]:
    items = list(value.items())
    important = [(key, child) for key, child in items if is_important_json_key(key)]
    other = [(key, child) for key, child in items if not is_important_json_key(key)]
    return important + other


def is_important_json_key(key: str) -> bool:
    normalized = key.lower().replace("_", " ").replace("-", " ")
    return any(keyword in normalized for keyword in JSON_CONTEXT_IMPORTANT_KEYWORDS)


def describe_json_value(value: Any) -> str:
    if isinstance(value, dict):
        keys = list(value)
        return f"object with {len(keys)} keys ({format_key_list(keys[:10])})"
    if isinstance(value, list):
        if not value:
            return "array[0]"
        sample = ", ".join(format_json_scalar(item) for item in value[:3])
        extra = f", ... {len(value) - 3} more" if len(value) > 3 else ""
        return f"array[{len(value)}] sample [{sample}{extra}]"
    return format_json_scalar(value)


def format_key_list(keys: list[str]) -> str:
    if not keys:
        return "none"
    key_text = ", ".join(keys[:80])
    if len(keys) > 80:
        key_text += f", ... {len(keys) - 80} more"
    return key_text


def format_json_scalar(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=True, sort_keys=True)
    if len(text) > JSON_CONTEXT_VALUE_LIMIT:
        return text[: JSON_CONTEXT_VALUE_LIMIT - 3] + "..."
    return text


def extract_markdown_headings(text: str) -> list[str]:
    headings: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if not match:
            continue
        level = len(match.group(1))
        title = " ".join(match.group(2).split())
        headings.append(f"{'  ' * (level - 1)}{title}")
    return headings
