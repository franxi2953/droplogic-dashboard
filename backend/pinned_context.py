from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


PINNED_CONTEXT_INLINE_LIMIT = 12_000
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


BOXMINI_TURN_MANUAL = """# BoxMini Turn Manual

This is a compact per-turn manual distilled from agent-guide.md. The full guide is still available through read_context_file("agent-guide.md"); read the relevant section before unusual, risky, or uncertain hardware actions.

Core operating rules:
- Control BoxMini through top-level MCP tools. Avoid generic AdvancedDrop/module/raw calls unless explicitly debugging.
- Start with runtime_status(); load_system(system="boxmini") only when needed. Do not reset the matrix unless the user clearly asks.
- Before hardware actions, use a fresh execution_status_summary() or a targeted status tool unless a recent tool result already proves the needed state.
- Do not claim physical success unless execution/status/vision/user feedback confirms it.
- Use logical matrix coordinates [row, column]. Do not mix electrode, stage, and camera coordinates.
- Use presets for stage and imaging. Do not invent absolute stage coordinates, exposure/gain/light values, or calibration math.

Cockpit/dashboard mode:
- The browser is the visual surface. Do not raise OpenCV windows unless asked.
- Use visualizer_status and visualizer_frame for what the dashboard sees. Image bytes are attached once; after inspection rely on artifact metadata and written observations.
- Tool events marked called_by_user or tool_invocation_origin="dashboard_user" are user actions.
- If runtime health fails, stop hardware execution and inspect health before continuing.

Planning and execution:
- Planning changes logical state only. Hardware moves through execute_segment_to_breakpoint, start_plan/resume_plan, or explicit hardware tools.
- Default rhythm: plan one physical segment, inspect plan_summary(), execute to breakpoint, wait using recommended wait_seconds, verify/inspect, then plan the next segment.
- Prefer execute_segment_to_breakpoint. If it starts a background wait, call execution_wait_status(wait_seconds=<recommended>) once; repeat only with the returned recommendation.
- Do not plan all legs of multi-step physical work at once. Plan to the next check, injection confirmation, extraction validation, user decision, or risky transition.
- For a clean new protocol, use emergency_stop(deactivate_electrodes=true) when needed, then clear_droplet_state(reset_executor=true), and confirm no active old plan/droplets.
- Do not start_plan to continue a partial run. Treat restart-from-frame-0 warnings as safety stops.
- If planning_success=false, primitive_validation.ok=false, result=null, or ok=false, do not execute that primitive.

Droplets and routing:
- Use create_droplet/add_droplets, update_droplet_targets, plan_move, plan_reservoir_extraction, plan_isometric_split, plan_mix, and plan_merge.
- Retarget droplets instead of deleting/recreating them.
- For real hardware, keep plan_move batches to 5-10 droplets, prefer 5 for 2x2 droplets, dense layouts, crossings, or reordering.
- plan_move moves every active droplet whose target differs from current position, not only recently retargeted droplets.
- For swaps/crossings/overlaps, use staged parking moves. Do not expect SIPP to move one droplet into another active start footprint in one call.
- After each segment, trust targets_reached only for the droplets reported in that segment.

Reservoirs and injection:
- Injection holes and matrix geometry come from cartridge.default.json.
- Before asking the user to inject, create/activate the reservoir on the real matrix, execute activation, verify/inspect, then move_stage(preset="manual_injection").
- Wait for user confirmation after manual injection.
- Before extraction, relocate an injected reservoir 5-10 electrodes from the edge, execute, and verify.
- Size reservoirs for consumed area plus at least 20 electrodes. Example: 20 droplets of 2x2 consume 80 electrodes, so use at least 100 electrodes.

Extraction:
- Use plan_reservoir_extraction. Default split_mode="linear" for fast batches; use 1to2/1to3 for validation or hard liquids.
- Plan only the next extraction batch, inspect, execute, then verify before routing unless user explicitly allows unattended work.
- For 2x2 linear extraction, use linear_drop_shape=[2,2], linear_space_per_row>=4, linear_space_per_col>=4, linear_vital_space=2, linear_post_separation_steps=3, and stagger with linear_offset when possible.
- Do not reduce 2x2 row/column spacing below 4 on BoxMini hardware just to make a batch fit.
- Verify extracted droplets. If vision is inconclusive or frames are missing, inspect saved frames or ask instead of deleting logical droplets.

Views, imaging, and temperature:
- Use set_execution_view_mode(mode="whole_chip_camera") or execute_segment_to_breakpoint(execution_view_mode="whole_chip_camera", verify_positions=false) for whole-cartridge overview.
- Use follow_droplets/microscope for droplet checks. whole_chip_camera and follow_droplets are mutually exclusive during execution.
- In whole_chip_camera fixed execution, keep verify_positions=false; verification moves the stage and changes imaging.
- Use capture_droplet_images for repeated droplet imaging and start_melting_curve_capture for temperature curves with photos at each step.
- Use temperature_hold for short single setpoints and start_temperature_routine only for temperature-only routines with no per-step imaging.

Fault handling:
- Use emergency_stop for urgent stop/deactivation.
- Do not continue after visual/vision mismatch without correction or user confirmation.
- Do not automatically restart/reinitialize real hardware after a fault.
- If MCP restarts and state is lost, reload only after physical state is safe, then reconstruct logical droplets from current physical/visual state.
"""


def compact_pinned_context_file(relative_path: str, text: str) -> tuple[str, dict[str, Any]]:
    clean_path = str(relative_path).replace("\\", "/")
    original_chars = len(text)
    basename = Path(clean_path).name.lower()
    if basename == "agent-guide.md":
        compacted = build_agent_guide_context(clean_path, text)
    elif original_chars > PINNED_CONTEXT_INLINE_LIMIT:
        compacted = build_large_context_index(clean_path, text)
    else:
        compacted = text.strip()
    return compacted, {
        "original_chars": original_chars,
        "sent_chars": len(compacted),
        "compacted": compacted != text.strip(),
    }


def build_agent_guide_context(relative_path: str, text: str) -> str:
    headings = extract_markdown_headings(text)
    index = "\n".join(f"- {item}" for item in headings[:40])
    if len(headings) > 40:
        index += f"\n- ... {len(headings) - 40} more headings"
    return (
        BOXMINI_TURN_MANUAL.strip()
        + "\n\n# Full Guide Index\n"
        + f"Source file: {relative_path}. Use read_context_file when details beyond this manual matter.\n"
        + index
    )


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
