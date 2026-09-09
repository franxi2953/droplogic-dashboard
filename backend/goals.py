from __future__ import annotations

from typing import Any

GOAL_MAX_CHARS = 4000


def goal_status_from_events(events: list[dict[str, Any]], agent_busy: bool = False) -> dict[str, Any]:
    objective = ""
    status = "none"
    created_at = None
    updated_at = None
    last_event_type = None
    revision = 0
    for event in events:
        event_type = str(event.get("type") or "")
        if event_type in {"goal_set", "goal_updated"}:
            next_objective = str(event.get("objective") or "").strip()
            if not next_objective:
                continue
            objective = next_objective
            status = "active"
            created_at = created_at or event.get("ts")
            updated_at = event.get("ts")
            last_event_type = event_type
            revision += 1
        elif event_type == "goal_paused" and objective:
            status = "paused"
            updated_at = event.get("ts")
            last_event_type = event_type
            revision += 1
        elif event_type == "goal_resumed" and objective:
            status = "active"
            updated_at = event.get("ts")
            last_event_type = event_type
            revision += 1
        elif event_type == "goal_cleared":
            objective = ""
            status = "none"
            created_at = None
            updated_at = event.get("ts")
            last_event_type = event_type
            revision += 1
        elif event_type == "goal_completed" and objective:
            status = "complete"
            updated_at = event.get("ts")
            last_event_type = event_type
            revision += 1

    return {
        "objective": objective,
        "status": status,
        "active": bool(objective and status == "active"),
        "paused": bool(objective and status == "paused"),
        "complete": bool(objective and status == "complete"),
        "agent_busy": bool(agent_busy),
        "created_at": created_at,
        "updated_at": updated_at,
        "last_event_type": last_event_type,
        "revision": revision,
        "max_chars": GOAL_MAX_CHARS,
    }
