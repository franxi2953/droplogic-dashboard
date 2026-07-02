from __future__ import annotations

import json
from typing import Any

from .ai_provider import MODEL_ATTACHMENTS_KEY


def compact_tool_payload(result: Any) -> Any:
    if not isinstance(result, dict):
        return result
    if not result.get("ok", True) and "result" not in result:
        return result
    payload = result.get("result", result)
    if not isinstance(payload, dict):
        return payload
    content = payload.get("content")
    if isinstance(content, list) and content:
        first = content[0]
        text = first.get("text") if isinstance(first, dict) else None
        if isinstance(text, str):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"text": text}
    structured = payload.get("structuredContent")
    if structured is not None:
        return structured
    return payload


def mcp_tool_call_succeeded(result: Any) -> bool:
    if not isinstance(result, dict):
        return True
    if result.get("isError"):
        return False
    payload = compact_tool_payload(result)
    if isinstance(payload, dict):
        if payload.get("isError") is True:
            return False
        if payload.get("ok") is False:
            return False
        for key in ("primitive_validation", "move_validation"):
            validation = payload.get(key)
            if isinstance(validation, dict) and validation.get("ok") is False:
                return False
        plan = payload.get("plan")
        if isinstance(plan, dict) and plan.get("planning_success") is False:
            return False
    return True


def mark_failed_mcp_payload(result: Any) -> Any:
    if not isinstance(result, dict):
        return result
    if result.get("isError"):
        return result
    if mcp_tool_call_succeeded(result):
        return result
    payload = compact_tool_payload(result)
    if not isinstance(payload, dict):
        return result
    marked = dict(payload)
    marked["isError"] = True
    marked.setdefault("ok", False)
    marked.setdefault(
        "error",
        "Tool returned an internal failure payload; do not treat this as successful progress.",
    )
    return replace_mcp_text_payload(result, marked)


def replace_mcp_text_payload(result: Any, payload: dict[str, Any]) -> Any:
    encoded = json.dumps(payload, ensure_ascii=True, default=str)
    if not isinstance(result, dict):
        return payload
    copy = dict(result)
    if "structuredContent" in copy:
        copy["structuredContent"] = payload
    content = copy.get("content")
    if isinstance(content, list) and content:
        first = content[0]
        if isinstance(first, dict) and "text" in first:
            new_first = dict(first)
            new_first["text"] = encoded
            copy["content"] = [new_first, *content[1:]]
            return copy
    if "structuredContent" in copy:
        return copy
    return payload


def visualizer_attachment_label(frame: dict[str, Any], artifact: dict[str, Any]) -> str:
    visualizer = frame.get("visualizer") or artifact.get("visualizer") or "visualizer"
    source = frame.get("frame_source") or artifact.get("frame_source") or "frame"
    shape = frame.get("shape") or artifact.get("shape")
    shape_text = f" shape={shape}" if shape else ""
    return f"{visualizer}/{source}{shape_text}"


def tool_context_metrics(result: Any) -> dict[str, Any]:
    output = json.dumps(tool_metric_payload(result), ensure_ascii=True, default=str)
    chars = len(output)
    return {
        "model_output_chars": chars,
        "estimated_model_output_tokens": max(1, (chars + 3) // 4),
    }


def tool_metric_payload(result: Any) -> Any:
    if not isinstance(result, dict) or MODEL_ATTACHMENTS_KEY not in result:
        return result
    copy = dict(result)
    copy.pop(MODEL_ATTACHMENTS_KEY, None)
    return copy


def tool_attachment_metrics(attachments: list[dict[str, Any]]) -> dict[str, Any]:
    image_count = 0
    byte_count = 0
    for attachment in attachments:
        if attachment.get("type") != "input_image":
            continue
        image_count += 1
        try:
            byte_count += int(attachment.get("bytes") or 0)
        except (TypeError, ValueError):
            pass
    if not image_count and not byte_count:
        return {}
    return {
        "model_attachment_count": len(attachments),
        "model_image_count": image_count,
        "model_attachment_bytes": byte_count,
    }
