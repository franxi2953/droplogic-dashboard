from __future__ import annotations

from typing import Any


DASHBOARD_INTERNAL_TOOLS = {"dashboard_scene"}


def filter_agent_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    visible = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or "")
        description = str(tool.get("description") or "")
        if name in DASHBOARD_INTERNAL_TOOLS:
            continue
        if description.lower().startswith("dashboard internal:"):
            continue
        visible.append(tool)
    return visible


def parse_optional_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed or parsed in {float("inf"), float("-inf")}:
        return None
    return parsed
