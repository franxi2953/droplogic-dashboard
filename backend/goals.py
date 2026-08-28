from __future__ import annotations

from typing import Any

from .tool_payloads import compact_tool_payload


GOAL_MAX_CHARS = 4000


def latest_goal_completion_blocker(events: list[dict[str, Any]]) -> str:
    for event in reversed(events):
        if event.get("type") != "mcp_tool_result":
            continue
        tool = str(event.get("tool") or "")
        tool_is_relevant = goal_completion_relevant_tool(tool)
        if tool_is_relevant and (
            event.get("level") == "error" or event.get("ok") is False or event.get("error")
        ):
            return f"Latest relevant tool result for {tool} is failed; resolve it before completing the goal."
        payload = compact_tool_payload(event.get("result"))
        if not isinstance(payload, dict):
            continue
        relevant = False
        plan = payload.get("plan")
        if isinstance(plan, dict):
            relevant = True
        if isinstance(plan, dict) and plan.get("planning_success") is False:
            return "Latest relevant state has planning_success=false."
        planning_job = payload.get("planning_job")
        if isinstance(planning_job, dict):
            relevant = True
        if isinstance(planning_job, dict) and planning_job.get("ok") is False:
            method = planning_job.get("method") or "planning job"
            return f"Latest relevant planning job failed ({method})."
        for key in ("primitive_validation", "move_validation"):
            validation = payload.get(key)
            if isinstance(validation, dict):
                relevant = True
            if isinstance(validation, dict) and validation.get("ok") is False:
                return f"Latest relevant tool result has {key}.ok=false."
        if relevant:
            return ""
    return ""


def melting_goal_completion_blocker(objective: str, events: list[dict[str, Any]]) -> str:
    """Require terminal thermal evidence before completing a melting objective."""
    if "melting" not in str(objective or "").lower():
        return ""

    completed_capture = [
        event
        for event in events
        if event.get("type") == "melting_curve_capture_finished"
        and bool(event.get("ok"))
        and bool(event.get("completed"))
    ]
    for event in reversed(completed_capture):
        requested = int(event.get("requested_steps") or 0)
        completed = int(event.get("completed_steps") or 0)
        if requested and completed < requested:
            return "Melting capture ended before all requested temperature steps completed."
        photos = [
            item
            for item in events
            if item.get("type") == "melting_curve_capture_photo"
            and item.get("routine_id") == event.get("routine_id")
        ]
        if requested and len(photos) < requested:
            return "Melting capture completed without a recorded image checkpoint for every temperature step."
        return ""

    for event in reversed(events):
        tool = str(event.get("tool") or "")
        if event.get("type") == "mcp_tool_call" and tool in {
            "cancel_melting_curve_capture",
            "cancel_temperature_routine",
        }:
            return f"{tool} was called before the melting objective completed."
        if event.get("type") != "mcp_tool_result":
            continue
        if tool == "start_melting_curve_capture" and event.get("ok") is False:
            return "start_melting_curve_capture failed; a melting objective cannot be completed without a successful capture run."
        if tool in {"melting_curve_capture_status", "temperature_routine_status"}:
            status = terminal_temperature_status(event.get("result"))
            if status and status.get("completed") is False and status.get("running") is False:
                return "The temperature routine ended without completing the melting schedule."

    return "Melting objective has no completed temperature-and-image capture evidence."


def terminal_temperature_status(result: Any) -> dict[str, Any] | None:
    """Extract a terminal routine status from MCP result envelopes."""
    payload = compact_tool_payload(result)
    candidates = [payload]
    while candidates:
        candidate = candidates.pop()
        if not isinstance(candidate, dict):
            continue
        if "completed" in candidate and "running" in candidate:
            return candidate
        for key in ("result", "structuredContent"):
            nested = candidate.get(key)
            if isinstance(nested, dict):
                candidates.append(nested)
    return None


def goal_completion_relevant_tool(tool: str) -> bool:
    name = str(tool or "")
    return (
        name.startswith("plan_")
        or name in {
            "advanced_drop_call",
            "planning_job_status",
            "execute_segment_to_breakpoint",
            "start_plan",
            "resume_plan",
            "start_execute_until_breakpoint",
            "execution_wait_status",
            "execution_status_summary",
            "executor_status",
            "plan_summary",
            "droplets_summary",
            "matrix_summary",
        }
    )


def goal_completion_missing_terms(objective: str, summary: str, evidence: str) -> list[str]:
    objective_text = str(objective or "").lower()
    completion_text = f"{summary}\n{evidence}".lower()
    required_groups = [
        ("merge/combine", ("merge", "merged", "combine", "combined")),
        ("mix/cycle", ("mix", "mixed", "cycle", "cycled")),
        ("route final products", ("route", "routed", "output", "park")),
        ("cleanup leftovers", ("clear leftover", "cleared leftover", "park leftover", "parked leftover", "cleanup", "cleaned")),
    ]
    missing = []
    for label, terms in required_groups:
        if not any(term in objective_text for term in terms):
            continue
        if not any(term in completion_text for term in terms):
            missing.append(label)
    return missing


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
