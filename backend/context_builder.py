from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_MAX_CONTEXT_CHARS = 800_000
DEFAULT_TARGET_CONTEXT_CHARS = 60_000
DEFAULT_LARGE_EVENT_CHARS = 8_000
DEFAULT_RECENT_EVENT_TARGET = 120
DEFAULT_TOOL_OUTPUT_CHARS = 6_000
FORCED_EVENT_SUMMARY_CHARS = 1_500
MAX_STRING_CHARS = 2_000
MAX_COLLECTION_ITEMS = 12
STATE_SNAPSHOT_TOOLS = {
    "runtime_status",
    "health_check",
    "capabilities",
    "state_summary",
    "read_state",
    "matrix_summary",
    "execution_status_summary",
    "execution_scene",
    "visualizer_status",
    "executor_status",
    "plan_summary",
    "droplets_summary",
    "temperature_routine_status",
    "advanced_drop_job_status",
    "execution_wait_status",
    "module_busy_status",
    "timeline_status",
}
STATE_SNAPSHOT_KEEP_RECENT = 1
RECENT_TOOL_EVENT_ALWAYS_KEEP = 4
RECENT_TOOL_RESULT_MAX_AGE_EVENTS = 80
RECENT_PENDING_TOOL_CALL_MAX_AGE_EVENTS = 20
NOISY_LIVE_EVENT_TYPES = {
    "live_poll_error",
    "live_scene_error",
    "live_stream_error",
}


@dataclass
class ModelContext:
    events: list[dict[str, Any]]
    compacted: bool
    details: dict[str, Any]


def build_model_context(
    events: list[dict[str, Any]],
    run_dir: Path | None = None,
    max_chars: int = DEFAULT_MAX_CONTEXT_CHARS,
    target_chars: int | None = None,
    recent_event_target: int = DEFAULT_RECENT_EVENT_TARGET,
    large_event_chars: int = DEFAULT_LARGE_EVENT_CHARS,
    ai_summary: str | None = None,
    protect_latest_tool_result: bool = True,
) -> ModelContext:
    events = compact_repeated_noisy_live_events(events)
    before_chars = encoded_json_length(events)
    target_chars = normalize_target_chars(target_chars, max_chars)
    stale_state_indices = stale_state_snapshot_indices(events)
    old_tool_indices = old_tool_event_indices(events)
    artifact_count = 0
    large_events = 0
    stale_state_events = 0
    protected_tool_output_chars = 0
    compacted_events: list[dict[str, Any]] = []
    latest_tool_result_index = latest_tool_result_event_index(events) if protect_latest_tool_result else None

    for index, event in enumerate(events):
        if index in old_tool_indices:
            compacted_events.append(compact_old_tool_event(event))
            large_events += 1
            continue
        if index in stale_state_indices:
            stale_state_events += 1
            compacted_events.append(compact_stale_state_event(event))
            continue
        if latest_tool_result_index is not None and index == latest_tool_result_index:
            event_chars = encoded_json_length(event)
            if event_chars <= large_event_chars:
                copied = dict(event)
                copied["_protected_latest_tool_output"] = True
                copied["_protection_note"] = (
                    "Latest tool result is intentionally kept untrimmed for the next model turn."
                )
                protected_tool_output_chars = event_chars
                compacted_events.append(copied)
                continue
            compacted_event, stats = compact_event(
                event,
                event_index=index,
                run_dir=run_dir,
                large_event_chars=large_event_chars,
            )
            compacted_event["_latest_tool_output_compacted_for_model"] = True
            compacted_event["_protection_note"] = (
                "Latest tool result was large, so it was structurally summarized for the model. "
                "The complete output remains in events.jsonl/artifacts."
            )
            artifact_count += stats["artifact_count"]
            large_events += 1 if stats["was_large"] else 0
            compacted_events.append(compacted_event)
            continue
        compacted_event, stats = compact_event(
            event,
            event_index=index,
            run_dir=run_dir,
            large_event_chars=large_event_chars,
        )
        artifact_count += stats["artifact_count"]
        large_events += 1 if stats["was_large"] else 0
        compacted_events.append(compacted_event)

    after_compact_chars = encoded_json_length(compacted_events)
    selected_events = compacted_events
    omitted_events = 0
    memory: dict[str, Any] | None = None

    if should_summarize_event_history(after_compact_chars, len(compacted_events), target_chars, recent_event_target):
        memory = build_run_memory(events)
        selected_reversed: list[dict[str, Any]] = []
        budget = target_chars
        current_chars = encoded_json_length([memory])

        for event in reversed(compacted_events):
            event_chars = encoded_json_length(event) + 2
            if event.get("_stale_state_snapshot"):
                continue
            if selected_reversed and current_chars + event_chars > budget:
                break
            if len(selected_reversed) >= recent_event_target:
                break
            selected_reversed.append(event)
            current_chars += event_chars

        selected_events = list(reversed(selected_reversed))
        selected_events = carry_protected_latest_tool_result(
            compacted_events,
            selected_events,
            latest_tool_result_index,
            memory,
            target_chars,
            recent_event_target,
        )
        omitted_events = max(0, len(compacted_events) - len(selected_events))

    model_events = selected_events
    if memory is not None:
        memory["omitted_event_count"] = omitted_events
        memory["retained_recent_event_count"] = len(selected_events)
        model_events = [memory, *selected_events]
    if ai_summary:
        model_events = [build_ai_memory_event(ai_summary), *model_events]

    after_chars = encoded_json_length(model_events)
    compacted = large_events > 0 or omitted_events > 0 or before_chars > target_chars
    details = {
        "scope": "run_context",
        "message": "Model context compacted; full events.jsonl is unchanged.",
        "original_event_count": len(events),
        "model_event_count": len(model_events),
        "omitted_event_count": omitted_events,
        "large_event_count": large_events,
        "stale_state_event_count": stale_state_events,
        "artifact_count": artifact_count,
        "protected_latest_tool_output": protected_tool_output_chars > 0,
        "protected_latest_tool_output_chars": protected_tool_output_chars,
        "estimated_chars_before": before_chars,
        "estimated_chars_after": after_chars,
        "target_context_chars": target_chars,
        "max_context_chars": max_chars,
    }
    return ModelContext(events=model_events, compacted=compacted, details=details)


def compact_repeated_noisy_live_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    counts: dict[tuple[str, str], int] = {}
    first_event: dict[tuple[str, str], dict[str, Any]] = {}
    last_event: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        event_type = str(event.get("type") or "")
        if event_type not in NOISY_LIVE_EVENT_TYPES:
            compacted.append(event)
            continue
        message = str(event.get("message") or event.get("error") or "")
        key = (event_type, message)
        counts[key] = counts.get(key, 0) + 1
        first_event.setdefault(key, event)
        last_event[key] = event
    if not counts:
        return events
    for key, count in sorted(counts.items()):
        event_type, message = key
        first = first_event[key]
        last = last_event[key]
        compacted.append(
            {
                "type": "compacted_live_error",
                "source_event_type": event_type,
                "level": "warning",
                "message": message,
                "count": count,
                "t": last.get("t") or first.get("t"),
                "ts": last.get("ts") or first.get("ts"),
                "first_t": first.get("t"),
                "first_ts": first.get("ts"),
                "last_t": last.get("t"),
                "last_ts": last.get("ts"),
                "note": "Repeated live-dashboard errors were compacted for model context only; full events remain in events.jsonl.",
            }
        )
    return sorted(compacted, key=event_sort_time)


def event_sort_time(event: dict[str, Any]) -> float:
    try:
        return float(event.get("t") or event.get("last_t") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def normalize_target_chars(target_chars: int | None, max_chars: int) -> int:
    requested = int(target_chars or DEFAULT_TARGET_CONTEXT_CHARS)
    hard_max = max(20_000, int(max_chars or DEFAULT_MAX_CONTEXT_CHARS))
    return max(20_000, min(requested, hard_max))


def should_summarize_event_history(
    after_compact_chars: int,
    event_count: int,
    target_chars: int,
    recent_event_target: int,
) -> bool:
    if after_compact_chars > target_chars:
        return True
    return event_count > recent_event_target * 2


def carry_protected_latest_tool_result(
    compacted_events: list[dict[str, Any]],
    selected_events: list[dict[str, Any]],
    latest_tool_result_index: int | None,
    memory: dict[str, Any],
    budget: int,
    recent_event_target: int,
) -> list[dict[str, Any]]:
    if latest_tool_result_index is None:
        return selected_events
    if latest_tool_result_index < 0 or latest_tool_result_index >= len(compacted_events):
        return selected_events

    protected_event = compacted_events[latest_tool_result_index]
    if any(event is protected_event for event in selected_events):
        return selected_events

    event_indices = {id(event): index for index, event in enumerate(compacted_events)}
    selected = list(selected_events)
    insert_index = len(selected)
    for index, event in enumerate(selected):
        if event_indices.get(id(event), len(compacted_events)) > latest_tool_result_index:
            insert_index = index
            break
    selected.insert(insert_index, protected_event)

    def removable_index() -> int | None:
        for index, event in enumerate(selected):
            if event is not protected_event:
                return index
        return None

    while len(selected) > max(1, recent_event_target):
        index = removable_index()
        if index is None:
            break
        del selected[index]

    while len(selected) > 1 and encoded_json_length([memory, *selected]) > budget:
        index = removable_index()
        if index is None:
            break
        del selected[index]

    return selected


def compact_tool_output_for_model(
    tool: str,
    result: Any,
    max_chars: int = DEFAULT_TOOL_OUTPUT_CHARS,
) -> tuple[Any, dict[str, Any] | None]:
    before_chars = encoded_json_length(result)
    if before_chars <= max_chars:
        return result, None

    compacted = compact_value(result, path=f"tool_output.{tool}")
    after_chars = encoded_json_length(compacted)
    wrapped = {
        "_compacted_for_model": True,
        "_compaction_note": (
            "This tool output was summarized before sending it back to the model. "
            "The complete output remains in the dashboard event log."
        ),
        "tool": tool,
        "summary": compacted,
    }
    details = {
        "scope": "tool_output",
        "message": f"Tool output compacted for model context: {tool}.",
        "tool": tool,
        "estimated_chars_before": before_chars,
        "estimated_chars_after": encoded_json_length(wrapped),
        "max_context_chars": max_chars,
    }
    if after_chars >= before_chars:
        wrapped["summary"] = summarize_string(json.dumps(result, ensure_ascii=True, default=str))
        details["estimated_chars_after"] = encoded_json_length(wrapped)
    return wrapped, details


def stale_state_snapshot_indices(events: list[dict[str, Any]]) -> set[int]:
    """Find old state-observation events superseded by newer observations.

    This only prunes read-only observability tools. Action tools are not treated
    as state snapshots because their order is meaningful protocol history.
    """
    call_arguments_by_id = tool_call_arguments_by_event_id(events)
    by_key: dict[tuple[str, str], list[int]] = {}
    for index, event in enumerate(events):
        if event.get("type") != "mcp_tool_result":
            continue
        if event.get("level") == "error" or event.get("ok") is False or event.get("error"):
            continue
        tool = str(event.get("tool") or "")
        if tool not in STATE_SNAPSHOT_TOOLS:
            continue
        key = state_snapshot_key(event, call_arguments_by_id)
        if key is None:
            continue
        by_key.setdefault(key, []).append(index)

    stale: set[int] = set()
    for indices in by_key.values():
        if len(indices) <= STATE_SNAPSHOT_KEEP_RECENT:
            continue
        stale.update(indices[:-STATE_SNAPSHOT_KEEP_RECENT])
    return stale


def tool_call_arguments_by_event_id(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    calls: dict[str, dict[str, Any]] = {}
    for event in events:
        if event.get("type") != "mcp_tool_call":
            continue
        event_id = event.get("t")
        if event_id is None:
            continue
        args = event.get("arguments")
        calls[str(event_id)] = args if isinstance(args, dict) else {}
    return calls


def state_snapshot_key(
    event: dict[str, Any],
    call_arguments_by_id: dict[str, dict[str, Any]],
) -> tuple[str, str] | None:
    tool = str(event.get("tool") or "")
    if not tool:
        return None
    arguments = call_arguments_by_id.get(str(event.get("call_event_id") or ""), {})
    if tool in {"state_summary", "read_state"}:
        path = arguments.get("path")
        if path is None:
            path = extract_result_path(event)
        return (tool, str(path or "<root>"))
    if tool == "matrix_summary":
        source = arguments.get("source", "state")
        return (tool, str(source or "state"))
    if tool == "module_busy_status":
        return (tool, str(arguments.get("module") or "<all>"))
    if tool in {"temperature_routine_status", "advanced_drop_job_status", "execution_wait_status"}:
        return (tool, "<job>")
    return (tool, "<latest>")


def extract_result_path(event: dict[str, Any]) -> str | None:
    result = event.get("result")
    if isinstance(result, dict):
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            inner = structured.get("result")
            if isinstance(inner, dict) and "path" in inner:
                return str(inner.get("path"))
        content = result.get("content")
        if isinstance(content, list) and content:
            text = content[0].get("text") if isinstance(content[0], dict) else None
            if isinstance(text, str) and text.strip().startswith("{"):
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, dict) and "path" in parsed:
                    return str(parsed.get("path"))
    return None


def compact_stale_state_event(event: dict[str, Any]) -> dict[str, Any]:
    compacted = {
        "type": "stale_state_snapshot_omitted",
        "tool": event.get("tool"),
        "ts": event.get("ts"),
        "t": event.get("t"),
        "via": event.get("via"),
        "message": (
            "Older read-only state snapshot omitted from model context because a newer snapshot "
            "for the same tool/path is available. Full event remains in events.jsonl."
        ),
    }
    compacted.update(tool_origin_fields(event))
    return {key: value for key, value in compacted.items() if value not in (None, "", {})}


def old_tool_event_indices(events: list[dict[str, Any]]) -> set[int]:
    """Select tool chatter that should become a compact timeline marker.

    Tool calls/results dominate long dashboard histories. The complete event log
    stays on disk; model context gets at most one recent non-error result per
    tool, plus the matching call and any recent pending call.
    """
    tool_indices = [
        index
        for index, event in enumerate(events)
        if event.get("type") in {"mcp_tool_call", "mcp_tool_result"}
    ]
    if len(tool_indices) <= RECENT_TOOL_EVENT_ALWAYS_KEEP:
        return set()

    call_index_by_event_id = {
        str(event.get("t")): index
        for index, event in enumerate(events)
        if event.get("type") == "mcp_tool_call" and event.get("t") is not None
    }
    keep_indices: set[int] = set()
    kept_result_tools: set[str] = set()
    kept_pending_call_tools: set[str] = set()
    result_call_ids: set[str] = set()
    latest_result_index = latest_tool_result_event_index(events)
    if latest_result_index is not None:
        keep_indices.add(latest_result_index)

    for index in range(len(events) - 1, -1, -1):
        event = events[index]
        event_type = event.get("type")
        if event_type not in {"mcp_tool_call", "mcp_tool_result"}:
            continue
        if event.get("level") == "error" or event.get("ok") is False or event.get("error"):
            keep_indices.add(index)
            continue
        tool = str(event.get("tool") or "")
        if not tool:
            continue
        age = len(events) - 1 - index
        if event_type == "mcp_tool_result":
            call_id = str(event.get("call_event_id") or "")
            if call_id:
                result_call_ids.add(call_id)
            if tool not in kept_result_tools and age <= RECENT_TOOL_RESULT_MAX_AGE_EVENTS:
                keep_indices.add(index)
                kept_result_tools.add(tool)
                if call_id and call_id in call_index_by_event_id:
                    keep_indices.add(call_index_by_event_id[call_id])
            continue
        call_id = str(event.get("t") or "")
        if call_id and call_id in result_call_ids:
            continue
        if tool not in kept_pending_call_tools and age <= RECENT_PENDING_TOOL_CALL_MAX_AGE_EVENTS:
            keep_indices.add(index)
            kept_pending_call_tools.add(tool)

    return {index for index in tool_indices if index not in keep_indices}


def compact_old_tool_event(event: dict[str, Any]) -> dict[str, Any]:
    event_type = str(event.get("type") or "")
    compacted = {
        "type": f"old_{event_type}_omitted",
        "tool": event.get("tool"),
        "ts": event.get("ts"),
        "t": event.get("t"),
        "via": event.get("via"),
        "message": (
            "Older non-error tool call/result omitted from model context to keep the active "
            "context focused. Full details remain in events.jsonl/artifacts."
        ),
    }
    compacted.update(tool_origin_fields(event))
    if event_type == "mcp_tool_result":
        compacted["ok"] = event.get("ok")
        compacted["artifact"] = extract_artifact_ref(event)
        compacted["result_summary"] = summarize_tool_result_event(event)
    elif event_type == "mcp_tool_call":
        compacted["arguments_summary"] = compact_value(event.get("arguments") or {}, path="old_tool_call.arguments")
    return {key: value for key, value in compacted.items() if value not in (None, "", {})}


def extract_artifact_ref(event: dict[str, Any]) -> Any:
    result = event.get("result")
    payloads = []
    if isinstance(result, dict):
        payloads.append(result)
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            payloads.append(structured)
        content = result.get("content")
        if isinstance(content, list):
            for item in content:
                text = item.get("text") if isinstance(item, dict) else None
                if isinstance(text, str) and text.strip().startswith("{"):
                    try:
                        parsed = json.loads(text)
                    except json.JSONDecodeError:
                        parsed = None
                    if isinstance(parsed, dict):
                        payloads.append(parsed)
    for payload in payloads:
        artifact = payload.get("artifact") if isinstance(payload, dict) else None
        if artifact:
            return compact_value(artifact, path="old_tool_result.artifact")
    return None


def summarize_tool_result_event(event: dict[str, Any], max_chars: int = 600) -> Any:
    result = event.get("result")
    payload = compact_value(result, path="old_tool_result.result")
    if encoded_json_length(payload) <= max_chars:
        return payload
    text = json.dumps(payload, ensure_ascii=True, default=str)
    return {
        "type": "tool_result_summary",
        "chars": len(text),
        "preview": text[: max(120, max_chars - 120)],
    }


def compact_event(
    event: dict[str, Any],
    event_index: int,
    run_dir: Path | None,
    large_event_chars: int,
) -> tuple[dict[str, Any], dict[str, int | bool]]:
    original_chars = encoded_json_length(event)
    compacted = {key: compact_value(value, path=f"{event.get('type', 'event')}.{key}") for key, value in event.items()}
    was_large = original_chars > large_event_chars
    artifact_count = 0

    if was_large:
        compacted["_compacted_for_model"] = True
        compacted["_original_chars"] = original_chars
        artifact_ref = write_event_artifact(event, event_index, run_dir)
        if artifact_ref:
            compacted["_artifact_ref"] = artifact_ref
            artifact_count = 1
        if encoded_json_length(compacted) > large_event_chars:
            compacted = force_compact_large_event(
                event,
                compacted,
                max_chars=large_event_chars,
            )

    return compacted, {"was_large": was_large, "artifact_count": artifact_count}


def force_compact_large_event(
    event: dict[str, Any],
    compacted: dict[str, Any],
    max_chars: int,
) -> dict[str, Any]:
    """Apply a hard cap after structural compaction.

    Some valid tool outputs are broad rather than deeply nested, for example
    method docstring dictionaries. Recursive compaction alone can leave those
    too large for model context, so large events fall back to a small timeline
    marker plus artifact reference.
    """
    event_type = str(event.get("type") or "event")
    summary: dict[str, Any] = {
        "type": event_type,
        "ts": event.get("ts"),
        "t": event.get("t"),
        "level": event.get("level"),
        "tool": event.get("tool"),
        "ok": event.get("ok"),
        "via": event.get("via"),
        "_compacted_for_model": True,
        "_forced_event_summary": True,
        "_original_chars": encoded_json_length(event),
        "_compaction_note": (
            "This large event was reduced to a compact timeline marker for model context. "
            "The complete event remains in events.jsonl/artifacts."
        ),
    }
    summary.update(tool_origin_fields(event))
    if compacted.get("_artifact_ref"):
        summary["_artifact_ref"] = compacted["_artifact_ref"]
    if event.get("error"):
        summary["error"] = short_text(str(event.get("error")), 700)
    elif event_type == "mcp_tool_result":
        summary["result_summary"] = summarize_tool_result_event(event, max_chars=min(900, max_chars // 3))
    elif event_type == "mcp_tool_call":
        summary["arguments_summary"] = compact_value(event.get("arguments") or {}, path="large_tool_call.arguments")
    elif event.get("text"):
        summary["text"] = short_text(str(event.get("text")), min(900, max_chars // 2))
    elif event.get("message"):
        summary["message"] = short_text(str(event.get("message")), min(900, max_chars // 2))
    else:
        summary["event_summary"] = summarize_plain_json(event, min(FORCED_EVENT_SUMMARY_CHARS, max_chars // 2))

    summary = {key: value for key, value in summary.items() if value not in (None, "", {})}
    if encoded_json_length(summary) <= max_chars:
        return summary
    summary["event_summary"] = summarize_plain_json(event, 500)
    for key in ("result_summary", "arguments_summary", "text", "message"):
        if key in summary and encoded_json_length(summary) > max_chars:
            summary[key] = short_text(json.dumps(compact_value(summary[key]), ensure_ascii=True, default=str), 500)
    return summary


def tool_origin_fields(event: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if event.get("via"):
        fields["via"] = event.get("via")
    if event.get("called_by_user") is True:
        fields["called_by_user"] = True
    if event.get("tool_invocation_origin"):
        fields["tool_invocation_origin"] = event.get("tool_invocation_origin")
    return fields


def compact_value(value: Any, path: str = "") -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value

    if isinstance(value, str):
        return compact_string(value, path)

    if isinstance(value, list):
        matrix = summarize_matrix(value)
        if matrix is not None:
            return matrix
        if encoded_json_length(value) <= MAX_STRING_CHARS and len(value) <= MAX_COLLECTION_ITEMS:
            return [compact_value(item, path=f"{path}[]") for item in value]
        return {
            "type": "list_summary",
            "length": len(value),
            "sample_start": [compact_value(item, path=f"{path}[]") for item in value[:4]],
            "sample_end": [compact_value(item, path=f"{path}[]") for item in value[-2:]] if len(value) > 6 else [],
        }

    if isinstance(value, dict):
        parsed = compact_mcp_text_payload(value, path)
        if parsed is not None:
            return parsed
        if encoded_json_length(value) <= MAX_STRING_CHARS:
            return {key: compact_value(item, path=f"{path}.{key}") for key, item in value.items()}

        compacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if key_text.lower() in {"base64", "image_base64", "data_url"}:
                compacted[key_text] = summarize_string(str(item), label="base64")
            else:
                compacted[key_text] = compact_value(item, path=f"{path}.{key_text}")
        return compacted

    return summarize_string(str(value))


def compact_string(value: str, path: str = "") -> Any:
    text = value
    stripped = text.strip()
    if len(stripped) > 80 and stripped[0] in "[{":
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            parsed = None
        if parsed is not None:
            return {
                "type": "json_string_summary",
                "summary": compact_value(parsed, path=f"{path}.parsed_json"),
                "original_chars": len(text),
            }
    if len(text) <= MAX_STRING_CHARS:
        return text
    return summarize_string(text)


def compact_mcp_text_payload(value: dict[str, Any], path: str) -> Any | None:
    content = value.get("content")
    if not isinstance(content, list) or len(content) != 1:
        return None
    first = content[0]
    if not isinstance(first, dict):
        return None
    text = first.get("text")
    if not isinstance(text, str) or len(text) <= MAX_STRING_CHARS:
        return None
    compacted_text = compact_string(text, path=f"{path}.content.text")
    copy = {key: compact_value(item, path=f"{path}.{key}") for key, item in value.items() if key != "content"}
    copy["content"] = [{"type": first.get("type", "text"), "text": compacted_text}]
    return copy


def summarize_string(value: str, label: str = "string") -> dict[str, Any]:
    return {
        "type": f"{label}_summary",
        "chars": len(value),
        "start": value[:700],
        "end": value[-500:] if len(value) > 1_200 else "",
    }


def summarize_matrix(value: list[Any]) -> dict[str, Any] | None:
    if len(value) < 16 or not all(isinstance(row, list) for row in value):
        return None
    row_lengths = [len(row) for row in value if isinstance(row, list)]
    if not row_lengths or max(row_lengths) < 16:
        return None
    if len(set(row_lengths[: min(len(row_lengths), 20)])) > 1:
        return None

    active: list[tuple[int, int]] = []
    total_cells = 0
    for row_index, row in enumerate(value):
        if not isinstance(row, list):
            return None
        total_cells += len(row)
        for col_index, cell in enumerate(row):
            if is_active_cell(cell):
                active.append((row_index, col_index))

    if total_cells < 256:
        return None

    if not active:
        return {
            "type": "matrix_summary",
            "shape": [len(value), max(row_lengths)],
            "active_count": 0,
        }

    rows = [row for row, _ in active]
    cols = [col for _, col in active]
    return {
        "type": "matrix_summary",
        "shape": [len(value), max(row_lengths)],
        "active_count": len(active),
        "active_bbox": {
            "row_min": min(rows),
            "row_max": max(rows),
            "col_min": min(cols),
            "col_max": max(cols),
        },
        "active_row_ranges": ranges(rows, limit=16),
        "active_col_ranges": ranges(cols, limit=16),
        "sample_active_cells": [[row, col] for row, col in active[:32]],
    }


def is_active_cell(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return False


def ranges(values: list[int], limit: int = 16) -> list[list[int]]:
    result: list[list[int]] = []
    unique = sorted(set(values))
    if not unique:
        return result
    start = previous = unique[0]
    for value in unique[1:]:
        if value == previous + 1:
            previous = value
            continue
        result.append([start, previous])
        start = previous = value
        if len(result) >= limit:
            break
    if len(result) < limit:
        result.append([start, previous])
    return result


def build_run_memory(events: list[dict[str, Any]]) -> dict[str, Any]:
    type_counts: dict[str, int] = {}
    tool_counts: dict[str, int] = {}
    prompts: list[str] = []
    responses: list[str] = []
    errors: list[str] = []
    latest_tools: list[dict[str, Any]] = []
    latest_state_snapshots: dict[str, dict[str, Any]] = {}
    call_arguments_by_id = tool_call_arguments_by_event_id(events)

    for index, event in enumerate(events):
        event_type = str(event.get("type") or "event")
        type_counts[event_type] = type_counts.get(event_type, 0) + 1
        if event_type in {"agent_prompt", "agent_steer"} and event.get("prompt"):
            prompts.append(str(event.get("prompt")))
        if event_type == "agent_response" and (event.get("text") or event.get("error")):
            responses.append(str(event.get("text") or event.get("error")))
        if event.get("level") == "error" or event_type.endswith("_error") or event.get("error"):
            errors.append(summarize_event_line(event))
        if event_type in {"mcp_tool_call", "mcp_tool_result"}:
            tool = str(event.get("tool") or "")
            if tool:
                tool_counts[tool] = tool_counts.get(tool, 0) + 1
            if event_type == "mcp_tool_result" and tool in STATE_SNAPSHOT_TOOLS and not event.get("error"):
                key = state_snapshot_key(event, call_arguments_by_id)
                if key is not None:
                    latest_state_snapshots[f"{key[0]}:{key[1]}"] = {
                        "event_index": index,
                        "tool": tool,
                        "ok": event.get("ok"),
                        "summary": summarize_event_line(event),
                    }
            latest_tools.append(
                {
                    "type": event_type,
                    "tool": tool,
                    "ok": event.get("ok"),
                    "message": summarize_event_line(event),
                }
            )

    working_state = {
        "recent_user_goal": short_text(prompts[-1], 900) if prompts else "",
        "last_agent_response": short_text(responses[-1], 700) if responses else "",
        "last_error": errors[-1] if errors else "",
        "latest_state_snapshots": list(latest_state_snapshots.values())[-20:],
        "latest_tool_results_by_tool": latest_tool_results_by_tool(events)[-30:],
        "note": (
            "This working state is compact memory, not proof of live hardware state. "
            "Refresh physical state before hardware actions."
        ),
    }
    return {
        "type": "run_memory",
        "message": (
            "Earlier run history was compacted for the model context. "
            "The complete event log remains available in events.jsonl."
        ),
        "event_count": len(events),
        "event_type_counts": type_counts,
        "tool_counts": dict(sorted(tool_counts.items(), key=lambda item: item[1], reverse=True)[:20]),
        "recent_user_requests": [short_text(item, 700) for item in prompts[-6:]],
        "recent_agent_responses": [short_text(item, 700) for item in responses[-4:]],
        "recent_errors": errors[-8:],
        "latest_tool_events": latest_tools[-16:],
        "latest_state_snapshots": list(latest_state_snapshots.values())[-20:],
        "working_state": {key: value for key, value in working_state.items() if value not in ("", [], {})},
    }


def latest_tool_results_by_tool(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for index, event in enumerate(events):
        if event.get("type") != "mcp_tool_result" or event.get("error"):
            continue
        tool = str(event.get("tool") or "")
        if not tool:
            continue
        latest[tool] = {
            "event_index": index,
            "tool": tool,
            "ok": event.get("ok"),
            "summary": summarize_event_line(event),
        }
    return sorted(latest.values(), key=lambda item: item["event_index"])


def build_ai_memory_event(ai_summary: str) -> dict[str, Any]:
    return {
        "type": "run_ai_memory",
        "message": (
            "AI-generated narrative memory for orientation only. "
            "Do not treat this as proof of current hardware state."
        ),
        "text": ai_summary.strip(),
        "safety_note": (
            "Before hardware actions, refresh physical state with MCP tools such as "
            "execution_status_summary, execution_scene, or targeted module calls."
        ),
    }


def latest_tool_result_event_index(events: list[dict[str, Any]]) -> int | None:
    for index in range(len(events) - 1, -1, -1):
        event = events[index]
        if event.get("type") == "mcp_tool_result":
            return index
    return None


def summarize_event_line(event: dict[str, Any]) -> str:
    event_type = str(event.get("type") or "event")
    if event_type in {"mcp_tool_call", "mcp_tool_result"}:
        tool = event.get("tool") or "tool"
        if event.get("error"):
            return short_text(f"{tool}: {event.get('error')}", 500)
        return short_text(f"{tool}: ok={event.get('ok')} {event.get('message') or ''}", 500)
    for key in ("message", "prompt", "text", "error"):
        if event.get(key):
            return short_text(str(event[key]), 500)
    return short_text(json.dumps(compact_value(event), ensure_ascii=True, default=str), 500)


def summarize_plain_json(value: Any, max_chars: int) -> str:
    return short_text(json.dumps(compact_value(value), ensure_ascii=True, default=str), max_chars)


def short_text(value: str, limit: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return f"{text[: limit - 20]} ... {text[-16:]}"


def write_event_artifact(event: dict[str, Any], event_index: int, run_dir: Path | None) -> str | None:
    if run_dir is None:
        return None
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
        artifacts_dir = run_dir / "artifacts" / "model_context"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(event, ensure_ascii=True, default=str, sort_keys=True)
        digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]
        event_type = safe_name(str(event.get("type") or "event"))
        path = artifacts_dir / f"event_{event_index:06d}_{event_type}_{digest}.json"
        if not path.exists():
            path.write_text(payload, encoding="utf-8")
        return str(path.relative_to(run_dir)).replace("\\", "/")
    except Exception:
        return None


def safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value)[:60]


def encoded_json_length(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=True, default=str))
