from __future__ import annotations

import re
from typing import Any

from .tool_payloads import compact_tool_payload


GOAL_MAX_CHARS = 4000


def action_goal_completion_blocker(objective: str, events: list[dict[str, Any]]) -> str:
    """Require run-local MCP evidence for concrete BoxMini action claims."""
    objective_text = str(objective or "").lower()
    start_index = 0
    for index, event in enumerate(events):
        if event.get("type") in {"goal_set", "goal_updated"}:
            start_index = index + 1
    current_events = events[start_index:]

    call_arguments: dict[Any, dict[str, Any]] = {}
    for event in current_events:
        if event.get("type") != "mcp_tool_call":
            continue
        event_id = event.get("t")
        arguments = event.get("arguments")
        if event_id is not None and isinstance(arguments, dict):
            call_arguments[event_id] = arguments

    successful_calls: list[tuple[str, dict[str, Any]]] = []
    successful_events: list[tuple[int, str, dict[str, Any]]] = []
    for event_index, event in enumerate(current_events):
        if event.get("type") != "mcp_tool_result" or event.get("ok") is not True or event.get("error"):
            continue
        name = str(event.get("tool") or "")
        arguments = call_arguments.get(event.get("call_event_id"), {})
        successful_calls.append((name, arguments))
        payload = compact_tool_payload(event.get("result"))
        # MCP envelopes commonly put the actual status below structuredContent.result.
        while isinstance(payload, dict) and "executor" not in payload and isinstance(payload.get("result"), dict):
            payload = payload["result"]
        successful_events.append((event_index, name, payload))
    successful_tools = {name for name, _arguments in successful_calls if name}

    def mentions(*terms: str) -> bool:
        return any(re.search(rf"\b{re.escape(term)}\b", objective_text) for term in terms)

    missing: list[str] = []
    if mentions("initialize", "initialise", "restart") and not successful_tools.intersection(
        {"load_system", "restart_system"}
    ):
        missing.append("system initialization")

    asks_for_clear = mentions("clear", "reset") and mentions("matrix", "state", "electrodes")
    clear_confirmed = any(
        (name in {"load_system", "restart_system"} and arguments.get("reset_matrix") is True)
        or (name == "set_matrix_cells" and arguments.get("value") in {0, False})
        for name, arguments in successful_calls
    )
    if asks_for_clear and not clear_confirmed:
        missing.append("matrix reset")

    droplet_subject = mentions("droplet", "droplets", "block", "blocks")
    if droplet_subject and mentions("create", "inject") and not successful_tools.intersection(
        {"create_droplet", "inject_droplet", "advanced_drop_call"}
    ):
        missing.append("droplet creation")

    asks_for_motion = droplet_subject and mentions("move", "route", "path", "cross", "target", "targets")
    if asks_for_motion:
        if not successful_tools.intersection({"plan_move", "advanced_drop_call"}):
            missing.append("movement planning")
        if not successful_tools.intersection(
            {
                "execute_segment_to_breakpoint",
                "start_execute_until_breakpoint",
                "start_plan",
                "resume_plan",
                "advanced_drop_call",
            }
        ):
            missing.append("movement execution")
        motion_event_indices = [
            index
            for index, name, _payload in successful_events
            if name
            in {
                "plan_move",
                "advanced_drop_call",
                "execute_segment_to_breakpoint",
                "start_execute_until_breakpoint",
                "start_plan",
                "resume_plan",
            }
        ]
        status_events = [
            (index, payload)
            for index, name, payload in successful_events
            if name == "execution_status_summary" and isinstance(payload, dict)
        ]
        latest_status = status_events[-1] if status_events else None
        if not latest_status or (motion_event_indices and latest_status[0] < max(motion_event_indices)):
            missing.append("terminal execution status")
        elif isinstance(latest_status[1], dict):
            status = latest_status[1]
            executor = status.get("executor")
            plan = status.get("plan")
            droplets = status.get("droplets")
            progress = executor.get("progress") if isinstance(executor, dict) else None
            terminal_ok = (
                isinstance(executor, dict)
                and executor.get("is_executing") is False
                and isinstance(progress, (int, float))
                and progress >= 100
                and isinstance(plan, dict)
                and plan.get("planning_success") is True
            )
            if isinstance(droplets, dict) and isinstance(droplets.get("droplets"), list):
                terminal_ok = terminal_ok and all(
                    item.get("at_target") is True
                    for item in droplets["droplets"]
                    if isinstance(item, dict) and item.get("active", True)
                )
            if not terminal_ok:
                missing.append("confirmed completed execution")

    asks_for_whole_view = (
        ("whole cartridge" in objective_text or "whole chip" in objective_text)
        and mentions("show", "display", "view")
    )
    if asks_for_whole_view and "set_execution_view_mode" not in successful_tools:
        missing.append("whole-cartridge view")

    if not missing:
        return ""
    return "Run-local MCP evidence is missing for: " + ", ".join(missing) + "."


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
