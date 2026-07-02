from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import http.server
import json
import re
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import websockets

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.ai_provider import AiProvider, MODEL_ATTACHMENTS_KEY
    from backend.agent_tools import filter_agent_tools, parse_optional_float
    from backend.audio_handlers import AudioHandlersMixin
    from backend.calibration import DashboardCalibrationSession
    from backend.config import COCKPIT_ROOT, DROPLOGIC_ROOT, CockpitConfig, load_config
    from backend.context_builder import build_model_context
    from backend.context_memory import ContextMemoryMixin
    from backend.goals import (
        GOAL_MAX_CHARS,
        goal_completion_missing_terms,
        goal_status_from_events,
        latest_goal_completion_blocker,
    )
    from backend.live_snapshot import LiveSnapshotMixin
    from backend.mcp_client import McpStdioClient
    from backend.recorder import RunRecorder
    from backend.runtime_utils import safe_filename, websocket_closed_ok
    from backend.tool_payloads import (
        compact_tool_payload,
        mark_failed_mcp_payload,
        mcp_tool_call_succeeded,
        replace_mcp_text_payload,
        tool_attachment_metrics,
        tool_context_metrics,
        visualizer_attachment_label,
    )
else:
    from .ai_provider import AiProvider, MODEL_ATTACHMENTS_KEY
    from .agent_tools import filter_agent_tools, parse_optional_float
    from .audio_handlers import AudioHandlersMixin
    from .calibration import DashboardCalibrationSession
    from .config import COCKPIT_ROOT, DROPLOGIC_ROOT, CockpitConfig, load_config
    from .context_builder import build_model_context
    from .context_memory import ContextMemoryMixin
    from .goals import (
        GOAL_MAX_CHARS,
        goal_completion_missing_terms,
        goal_status_from_events,
        latest_goal_completion_blocker,
    )
    from .live_snapshot import LiveSnapshotMixin
    from .mcp_client import McpStdioClient
    from .recorder import RunRecorder
    from .runtime_utils import safe_filename, websocket_closed_ok
    from .tool_payloads import (
        compact_tool_payload,
        mark_failed_mcp_payload,
        mcp_tool_call_succeeded,
        replace_mcp_text_payload,
        tool_attachment_metrics,
        tool_context_metrics,
        visualizer_attachment_label,
    )


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
GOAL_COMPLETE_TOOL = "dashboard_complete_goal"
DEFAULT_AGENT_FRAME_DELAY_SECONDS = 1.0
DEFAULT_AGENT_EXECUTION_WAIT_SECONDS = 30.0
FRAME_DELAY_AGENT_TOOLS = {"start_plan", "execute_segment_to_breakpoint"}


class CockpitApp(AudioHandlersMixin, LiveSnapshotMixin, ContextMemoryMixin):
    def __init__(self, config: CockpitConfig):
        self.config = config
        runs_dir = Path(config.runs_dir)
        if not runs_dir.is_absolute():
            runs_dir = COCKPIT_ROOT / runs_dir
        self.recorder = RunRecorder.open_latest_or_create(runs_dir)
        self.ai = AiProvider(config.ai)
        self.mcp = McpStdioClient(
            command=config.mcp.command,
            args=config.mcp.args,
            env=config.mcp.env,
            cwd=str(DROPLOGIC_ROOT),
        )
        self.clients: set[Any] = set()
        self.now = "Idle"
        self.live: dict[str, Any] = {}
        self.streamer_frame_options: dict[str, int] = {
            "max_width": 720,
            "max_height": 460,
        }
        self.calibration: DashboardCalibrationSession | None = None
        self._poll_task: asyncio.Task | None = None
        self._agent_task: asyncio.Task | None = None
        self._audio_transcriber: Any | None = None

    def status(self) -> dict[str, Any]:
        return {
            "run_id": self.recorder.run_id,
            "runs": self.recorder.list_runs(),
            "now": self.now,
            "goal": self.goal_status(),
            "calibration": self.calibration.state() if self.calibration else {"active": False},
            "mcp": {
                "running": self.mcp.running,
                "command": self.mcp.command_line(),
            },
            "ai": self.ai.status(),
            "speech": {
                "enabled": self.config.speech.enabled,
                "engine": self.config.speech.engine,
                "model": self.config.speech.model,
                "language": self.config.speech.language,
                "beam_size": self.config.speech.beam_size,
                "best_of": self.config.speech.best_of,
                "temperature": self.config.speech.temperature,
                "max_audio_seconds": self.config.speech.max_audio_seconds,
            },
            "agent_busy": self._agent_task is not None and not self._agent_task.done(),
            "live": {
                "has_runtime": bool(self.live.get("runtime")),
                "has_state": bool(self.live.get("state")),
                "has_scene": bool(self.live.get("scene", {}).get("available")),
                "has_matrix_frame": bool(self.live.get("frames", {}).get("matrix")),
                "has_streamer_frame": bool(self.live.get("frames", {}).get("streamer")),
                "streamer_frame_options": self.streamer_frame_options,
                "updated_at": self.live.get("updated_at"),
            },
        }

    def pinned_context_roots(self) -> list[tuple[str, Path]]:
        roots: list[tuple[str, Path]] = []
        override = Path(self.config.mcp.env.get("DROPLOGIC_MCP_CONTEXT_DIR", ""))
        if override:
            roots.append(("override", override if override.is_absolute() else (COCKPIT_ROOT / override).resolve()))
        roots.append(("default", DROPLOGIC_ROOT / "droplogic" / "mcp" / "context" / "boxmini"))
        return roots

    def load_pinned_context(self) -> tuple[str, dict[str, Any]]:
        sections: list[str] = []
        loaded: list[dict[str, Any]] = []
        missing: list[str] = []
        for relative_path in self.config.ai.pinned_context_files:
            clean_path = str(relative_path).strip().replace("\\", "/")
            if not clean_path:
                continue
            found = None
            for source, root in self.pinned_context_roots():
                candidate = (root / clean_path).resolve()
                try:
                    candidate.relative_to(root.resolve())
                except ValueError:
                    continue
                if candidate.is_file():
                    found = (source, candidate, root.resolve())
                    break
            if found is None:
                missing.append(clean_path)
                continue
            source, path, root = found
            text = path.read_text(encoding="utf-8")
            loaded.append(
                {
                    "path": clean_path,
                    "source": source,
                    "root": str(root),
                    "chars": len(text),
                }
            )
            sections.append(f"### {clean_path} ({source})\n{text.strip()}")

        metadata = {
            "files": loaded,
            "missing": missing,
            "total_chars": sum(item["chars"] for item in loaded),
        }
        context = "\n\n".join(sections)
        return context, metadata

    async def broadcast_event(self, event: dict[str, Any]) -> None:
        message = json.dumps({"type": "event", "event": event}, ensure_ascii=True)
        stale = []
        for client in self.clients:
            try:
                await client.send(message)
            except Exception:
                stale.append(client)
        for client in stale:
            self.clients.discard(client)

    async def record(self, event_type: str, **fields: Any) -> dict[str, Any]:
        event = self.recorder.append(event_type, **fields)
        await self.broadcast_event(event)
        return event

    async def handle_ws(self, websocket: Any) -> None:
        self.clients.add(websocket)
        try:
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            await self.safe_send(websocket, self.run_loaded_payload())
            if self.live:
                await self.safe_send(websocket, {"type": "live", "live": self.live})

            async for raw in websocket:
                try:
                    message = json.loads(raw)
                    await self.handle_message(websocket, message)
                except Exception as exc:
                    if websocket_closed_ok(exc):
                        break
                    event = await self.record("ui_error", level="error", message=str(exc))
                    await websocket.send(json.dumps({"type": "event", "event": event}))
        finally:
            self.clients.discard(websocket)

    async def handle_message(self, websocket: Any, message: dict[str, Any]) -> None:
        msg_type = message.get("type")
        if msg_type == "get_status":
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "list_runs":
            await websocket.send(json.dumps({"type": "runs", "runs": self.recorder.list_runs()}))
            return

        if msg_type == "set_ai_profile":
            if self._agent_task is not None and not self._agent_task.done():
                raise RuntimeError("Cannot switch AI model while the agent is running.")
            profile_id = str(message.get("profile_id", "")).strip()
            profile = self.ai.set_profile(profile_id)
            self.now = f"AI model: {profile.get('label') or profile_id}"
            await self.record("ai_profile_selected", profile=profile)
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "new_run":
            self.recorder = RunRecorder(self.recorder.runs_dir)
            self.now = "New run"
            await self.record("cockpit_run_created")
            await self.broadcast_run_loaded()
            return

        if msg_type == "select_run":
            run_id = str(message.get("run_id", "")).strip()
            self.recorder = self.recorder.open_run(run_id)
            self.now = f"Loaded run {run_id}"
            await self.broadcast_run_loaded()
            return

        if msg_type == "delete_run":
            run_id = str(message.get("run_id", "")).strip()
            self.recorder.delete_run(run_id)
            await websocket.send(json.dumps({"type": "runs", "runs": self.recorder.list_runs()}))
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "delete_runs":
            run_ids = [str(item).strip() for item in message.get("run_ids", []) if str(item).strip()]
            self.recorder.delete_runs(run_ids)
            await websocket.send(json.dumps({"type": "runs", "runs": self.recorder.list_runs()}))
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "rename_run":
            run_id = str(message.get("run_id", "")).strip()
            name = str(message.get("name", "")).strip()
            self.recorder.rename_run(run_id, name)
            await websocket.send(json.dumps({"type": "runs", "runs": self.recorder.list_runs()}))
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "goal_set":
            objective = str(message.get("objective", "")).strip()
            if not objective:
                raise ValueError("Goal objective cannot be empty.")
            if len(objective) > GOAL_MAX_CHARS:
                raise ValueError(f"Goal objective is too long ({len(objective)} > {GOAL_MAX_CHARS} characters).")
            previous = self.goal_status()
            event_type = "goal_updated" if previous.get("objective") else "goal_set"
            self.now = "Goal active"
            await self.record(
                event_type,
                objective=objective,
                previous_status=previous.get("status"),
            )
            if message.get("start_agent"):
                await self.start_agent_task(websocket, objective, event_type="agent_prompt")
                return
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "goal_pause":
            goal = self.goal_status()
            if not goal.get("objective"):
                raise RuntimeError("No goal is set.")
            self.now = "Goal paused"
            await self.record("goal_paused", objective=goal.get("objective"))
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "goal_resume":
            goal = self.goal_status()
            if not goal.get("objective"):
                raise RuntimeError("No goal is set.")
            self.now = "Goal active"
            await self.record("goal_resumed", objective=goal.get("objective"))
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "goal_clear":
            goal = self.goal_status()
            self.now = "Goal cleared"
            await self.record("goal_cleared", objective=goal.get("objective"))
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "auto_name_run":
            run_id = str(message.get("run_id", "")).strip()
            events = self.recorder.events_for_run(run_id)
            if not events:
                raise ValueError("Run has no events to name.")
            run_dir = self.recorder.runs_dir / run_id
            model_context = build_model_context(
                events,
                run_dir=run_dir,
                max_chars=min(self.config.ai.max_context_chars, 60_000),
                target_chars=min(self.config.ai.target_context_chars, 40_000),
                recent_event_target=min(self.config.ai.recent_event_target, 80),
                large_event_chars=self.config.ai.large_event_chars,
            )
            await websocket.send(json.dumps({"type": "run_naming", "run_id": run_id, "busy": True}))
            try:
                name = await self.ai.name_run(model_context.events)
                self.recorder.rename_run(run_id, name)
                if run_id == self.recorder.run_id:
                    await self.record("run_auto_named", run_id=run_id, name=name)
                await websocket.send(
                    json.dumps(
                        {
                            "type": "run_named",
                            "run_id": run_id,
                            "name": name,
                            "runs": self.recorder.list_runs(),
                            "status": self.status(),
                        }
                    )
                )
            finally:
                await websocket.send(json.dumps({"type": "run_naming", "run_id": run_id, "busy": False}))
            return

        if msg_type == "start_mcp":
            await self.mcp.start()
            self.ensure_live_polling()
            self.now = "MCP server running"
            event = await self.record("mcp_started", command=self.mcp.command_line())
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "stop_mcp":
            await self.stop_live_polling()
            await self.mcp.stop()
            self.now = "MCP server stopped"
            await self.record("mcp_stopped")
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "mcp_tool":
            tool = str(message.get("tool", "")).strip()
            arguments = message.get("arguments") or {}
            event = await self.record(
                "mcp_tool_call",
                tool=tool,
                arguments=arguments,
                via="dashboard_user",
                called_by_user=True,
                tool_invocation_origin="dashboard_user",
            )
            try:
                result = await self.mcp.call_tool(tool, arguments)
                result = mark_failed_mcp_payload(result)
                event_result, _, _ = self.prepare_visual_tool_result_for_model(
                    tool,
                    arguments,
                    result,
                    attach_for_model=False,
                )
                ok = mcp_tool_call_succeeded(result)
                result_event = await self.record(
                    "mcp_tool_result",
                    tool=tool,
                    ok=ok,
                    result=event_result,
                    call_event_id=event.get("t"),
                    via="dashboard_user",
                    called_by_user=True,
                    tool_invocation_origin="dashboard_user",
                    **tool_context_metrics(event_result),
                )
                await websocket.send(
                    json.dumps({"type": "tool_result", "event": result_event, "result": event_result})
                )
            except Exception as exc:
                result_event = await self.record(
                    "mcp_tool_result",
                    level="error",
                    tool=tool,
                    ok=False,
                    error=str(exc),
                    call_event_id=event.get("t"),
                    via="dashboard_user",
                    called_by_user=True,
                    tool_invocation_origin="dashboard_user",
                )
                await websocket.send(
                    json.dumps({"type": "tool_result", "event": result_event, "result": {"error": str(exc)}})
                )
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "transcribe_audio":
            await self.handle_transcribe_audio(websocket, message)
            return

        if msg_type == "download_visualizer_frame":
            visualizer = str(message.get("visualizer", "")).strip()
            frame_source = str(message.get("frame_source") or "snapshot").strip()
            result = await self.safe_tool(
                "visualizer_frame",
                {
                    "visualizer": visualizer,
                    "frame_source": frame_source,
                    "image_format": "png",
                    "include_base64": True,
                },
            )
            payload = compact_tool_payload(result)
            await websocket.send(
                json.dumps(
                    {
                        "type": "visualizer_download",
                        "visualizer": visualizer,
                        "frame_source": frame_source,
                        "frame": payload,
                    },
                    ensure_ascii=True,
                )
            )
            return

        if msg_type == "calibration_start":
            await self.start_calibration_session(websocket)
            return

        if msg_type == "calibration_close":
            self.calibration = None
            self.streamer_frame_options = {"max_width": 720, "max_height": 460}
            self.now = "Calibration closed"
            await websocket.send(json.dumps({"type": "calibration_state", "calibration": {"active": False}}))
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "calibration_move_stage":
            if self.calibration is None:
                raise RuntimeError("No calibration session is active.")
            position = message.get("position") or {}
            result = compact_tool_payload(
                await self.safe_tool(
                    "move_stage",
                    {
                        "position": position,
                        "wait_timeout_seconds": float(message.get("wait_timeout_seconds") or 1.2),
                        "poll_interval": 0.05,
                    },
                )
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_move_result",
                        "result": result,
                        "position": position,
                    },
                    ensure_ascii=True,
                )
            )
            return

        if msg_type == "calibration_move_to_target":
            if self.calibration is None:
                raise RuntimeError("No calibration session is active.")
            move = await self.move_calibration_to_current_target(wait_timeout_seconds=20)
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_move_result",
                        "result": move.get("result"),
                        "position": move.get("position"),
                    },
                    ensure_ascii=True,
                )
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_state",
                        "calibration": self.calibration.state(position=move.get("position")),
                    },
                    ensure_ascii=True,
                )
            )
            return

        if msg_type == "calibration_record":
            if self.calibration is None:
                raise RuntimeError("No calibration session is active.")
            position = message.get("position") or {}
            calibration = self.calibration.record_current_step(position)
            apply_result = None
            move = None
            if calibration.get("workflow_complete"):
                apply_result = await self.apply_calibration_to_runtime()
            else:
                move = await self.move_calibration_to_current_target(wait_timeout_seconds=20)
                calibration = self.calibration.state(position=move.get("position"))
            await self.record(
                "calibration_recorded",
                step=calibration.get("guided_index"),
                position=position,
                workflow_complete=calibration.get("workflow_complete"),
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_state",
                        "calibration": calibration,
                        "apply_result": compact_tool_payload(apply_result) if apply_result else None,
                        "move_result": move.get("result") if move else None,
                    },
                    ensure_ascii=True,
                )
            )
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "calibration_save":
            if self.calibration is None:
                raise RuntimeError("No calibration session is active.")
            self.calibration.save()
            apply_result = await self.apply_calibration_to_runtime()
            await self.record("calibration_saved", config_path=str(self.calibration.config_path))
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_state",
                        "calibration": self.calibration.state(),
                        "apply_result": compact_tool_payload(apply_result),
                    },
                    ensure_ascii=True,
                )
            )
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "paint_matrix_rect":
            arguments = {
                "value": int(message.get("value", 0)),
                "row_min": int(message.get("row_min", 0)),
                "row_max": int(message.get("row_max", 0)),
                "col_min": int(message.get("col_min", 0)),
                "col_max": int(message.get("col_max", 0)),
                "wait_for_queue": False,
            }
            raw_result = mark_failed_mcp_payload(await self.safe_tool("set_matrix_cells", arguments))
            result = compact_tool_payload(raw_result)
            droplet_update_results: list[dict[str, Any]] = []
            if arguments["value"] == 0 and mcp_tool_call_succeeded(raw_result):
                droplet_update_results = await self.apply_matrix_erase_droplet_updates(
                    message.get("droplet_updates") or []
                )
                if isinstance(result, dict):
                    result["droplet_updates"] = droplet_update_results
            await websocket.send(
                json.dumps(
                    {
                        "type": "matrix_paint_result",
                        "result": result,
                    },
                    ensure_ascii=True,
                )
            )
            if self.mcp.running:
                live = await self.collect_live_snapshot(include_state=True)
                self.live = live
                await self.broadcast_json({"type": "live", "live": live})
            return

        if msg_type == "matrix_update_droplet_position":
            droplet_id = int(message.get("droplet_id"))
            raw_position = message.get("position") or []
            if not isinstance(raw_position, list) or len(raw_position) < 2:
                raise RuntimeError("Droplet position must be [row, col].")
            position = [int(raw_position[0]), int(raw_position[1])]
            result = compact_tool_payload(
                await self.safe_tool(
                    "update_droplet_position",
                    {
                        "droplet_id": droplet_id,
                        "position": position,
                    },
                )
            )
            await self.record("matrix_droplet_position_updated", droplet_id=droplet_id, position=position)
            await websocket.send(
                json.dumps(
                    {
                        "type": "matrix_droplet_update_result",
                        "droplet_id": droplet_id,
                        "position": position,
                        "result": result,
                    },
                    ensure_ascii=True,
                )
            )
            if self.mcp.running:
                live = await self.collect_live_snapshot(include_state=True)
                self.live = live
                await self.broadcast_json({"type": "live", "live": live})
            return

        if msg_type == "matrix_plan_waypoint_paths":
            droplet_id = int(message.get("droplet_id"))
            mode = str(message.get("mode") or "sipp").strip() or "sipp"
            raw_waypoints = message.get("waypoints") or []
            if not isinstance(raw_waypoints, list) or not raw_waypoints:
                raise RuntimeError("At least one waypoint is required.")
            waypoints: list[list[int]] = []
            for raw in raw_waypoints:
                if not isinstance(raw, list) or len(raw) < 2:
                    raise RuntimeError("Each waypoint must be [row, col].")
                waypoints.append([int(raw[0]), int(raw[1])])

            await self.record(
                "matrix_waypoint_plan_requested",
                droplet_id=droplet_id,
                waypoints=waypoints,
                mode=mode,
            )
            result: dict[str, Any] = {
                "ok": True,
                "droplet_id": droplet_id,
                "mode": mode,
                "waypoints": waypoints,
                "steps": [],
            }
            for index, waypoint in enumerate(waypoints, start=1):
                target_result = mark_failed_mcp_payload(
                    await self.safe_tool(
                        "update_droplet_target",
                        {"droplet_id": droplet_id, "target": waypoint},
                    )
                )
                target_payload = compact_tool_payload(target_result)
                target_ok = mcp_tool_call_succeeded(target_result)
                step: dict[str, Any] = {
                    "index": index,
                    "target": waypoint,
                    "target_ok": target_ok,
                    "target_result": target_payload,
                }
                if not target_ok:
                    result["steps"].append(step)
                    result.update(
                        {
                            "ok": False,
                            "error": "Could not update droplet target.",
                            "failed_step": step,
                        }
                    )
                    break

                plan_result = mark_failed_mcp_payload(
                    await self.safe_tool(
                        "plan_move",
                        {
                            "mode": mode,
                            "remove_duplicate_frames": False,
                            "planning_timeout": 120.0,
                            "background": False,
                            "allow_long_sync": True,
                        },
                    )
                )
                plan_payload = compact_tool_payload(plan_result)
                plan_ok = mcp_tool_call_succeeded(plan_result)
                step.update(
                    {
                        "plan_ok": plan_ok,
                        "plan_result": plan_payload,
                    }
                )
                result["steps"].append(step)
                if not plan_ok:
                    reason = "SIPP planning failed."
                    if isinstance(plan_payload, dict):
                        reason = str(plan_payload.get("error") or plan_payload.get("reason") or reason)
                    result.update(
                        {
                            "ok": False,
                            "error": reason,
                            "failed_step": step,
                        }
                    )
                    break

            await self.record(
                "matrix_waypoint_plan_result",
                droplet_id=droplet_id,
                ok=bool(result.get("ok")),
                waypoint_count=len(waypoints),
                error=result.get("error"),
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "matrix_waypoint_plan_result",
                        "droplet_id": droplet_id,
                        "result": result,
                    },
                    ensure_ascii=True,
                )
            )
            if self.mcp.running:
                live = await self.collect_live_snapshot(include_state=True)
                self.live = live
                await self.broadcast_json({"type": "live", "live": live})
            return

        if msg_type == "matrix_plan_selection_move":
            mode = str(message.get("mode") or "sipp").strip() or "sipp"
            raw_targets = message.get("targets") or []
            if not isinstance(raw_targets, list) or not raw_targets:
                raise RuntimeError("At least one selected droplet target is required.")
            targets: list[dict[str, Any]] = []
            for index, item in enumerate(raw_targets):
                if not isinstance(item, dict):
                    raise RuntimeError(f"Target {index + 1} must be an object.")
                droplet_id = int(item.get("droplet_id", item.get("id")))
                raw_target = item.get("target") or []
                if not isinstance(raw_target, list) or len(raw_target) < 2:
                    raise RuntimeError(f"Target for droplet {droplet_id} must be [row, col].")
                targets.append(
                    {
                        "id": droplet_id,
                        "target": [int(raw_target[0]), int(raw_target[1])],
                    }
                )

            await self.record(
                "matrix_selection_plan_requested",
                targets=targets,
                mode=mode,
            )
            result: dict[str, Any] = {
                "ok": True,
                "mode": mode,
                "targets": targets,
            }
            target_result = mark_failed_mcp_payload(
                await self.safe_tool(
                    "update_droplet_targets",
                    {
                        "targets": targets,
                        "include_summary": False,
                    },
                )
            )
            target_payload = compact_tool_payload(target_result)
            target_ok = mcp_tool_call_succeeded(target_result)
            if isinstance(target_payload, dict) and target_payload.get("ok") is False:
                target_ok = False
            result["target_result"] = target_payload
            if not target_ok:
                result.update(
                    {
                        "ok": False,
                        "error": "Could not update selected droplet targets.",
                    }
                )
            else:
                plan_result = mark_failed_mcp_payload(
                    await self.safe_tool(
                        "plan_move",
                        {
                            "mode": mode,
                            "remove_duplicate_frames": False,
                            "planning_timeout": 120.0,
                            "background": False,
                            "allow_long_sync": True,
                        },
                    )
                )
                plan_payload = compact_tool_payload(plan_result)
                plan_ok = mcp_tool_call_succeeded(plan_result)
                result["plan_result"] = plan_payload
                if not plan_ok:
                    reason = "SIPP planning failed."
                    if isinstance(plan_payload, dict):
                        reason = str(plan_payload.get("error") or plan_payload.get("reason") or reason)
                    result.update(
                        {
                            "ok": False,
                            "error": reason,
                        }
                    )

            await self.record(
                "matrix_selection_plan_result",
                ok=bool(result.get("ok")),
                target_count=len(targets),
                error=result.get("error"),
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "matrix_selection_plan_result",
                        "result": result,
                    },
                    ensure_ascii=True,
                )
            )
            if self.mcp.running:
                live = await self.collect_live_snapshot(include_state=True)
                self.live = live
                await self.broadcast_json({"type": "live", "live": live})
            return

        if msg_type == "matrix_trim_plan_tail":
            keep_frames = int(message.get("keep_frames"))
            raw_result = mark_failed_mcp_payload(
                await self.safe_tool(
                    "trim_plan_tail",
                    {"keep_frames": keep_frames},
                )
            )
            result = compact_tool_payload(raw_result)
            await self.record(
                "matrix_plan_tail_trimmed",
                keep_frames=keep_frames,
                ok=mcp_tool_call_succeeded(raw_result),
                error=result.get("error") if isinstance(result, dict) else None,
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "matrix_plan_trim_result",
                        "result": result,
                    },
                    ensure_ascii=True,
                )
            )
            if self.mcp.running:
                live = await self.collect_live_snapshot(include_state=True)
                self.live = live
                await self.broadcast_json({"type": "live", "live": live})
            return

        if msg_type == "set_streamer_view":
            max_width = self.frame_option_int(message.get("max_width"), default=720, minimum=360, maximum=3200)
            max_height = self.frame_option_int(message.get("max_height"), default=460, minimum=240, maximum=2200)
            self.streamer_frame_options = {
                "max_width": max_width,
                "max_height": max_height,
            }
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "ask_agent":
            requested_run_id = str(message.get("run_id", "")).strip()
            if requested_run_id and requested_run_id != self.recorder.run_id:
                self.recorder = self.recorder.open_run(requested_run_id)
                self.now = f"Loaded run {requested_run_id}"
                await self.broadcast_run_loaded()
            prompt = str(message.get("prompt", "")).strip()
            await self.start_agent_task(websocket, prompt, event_type="agent_prompt")
            return

        if msg_type == "steer_agent":
            requested_run_id = str(message.get("run_id", "")).strip()
            if requested_run_id and requested_run_id != self.recorder.run_id:
                self.recorder = self.recorder.open_run(requested_run_id)
                self.now = f"Loaded run {requested_run_id}"
                await self.broadcast_run_loaded()
            prompt = str(message.get("prompt", "")).strip()
            if self._agent_task is not None and not self._agent_task.done():
                await self.cancel_agent("Steered by user")
            await self.start_agent_task(websocket, prompt, event_type="agent_steer")
            return

        if msg_type in {"stop_agent", "cancel_agent"}:
            await self.cancel_agent("Cancelled by user")
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        await self.record("unknown_message", level="warning", message=message)

    async def start_calibration_session(self, websocket: Any) -> None:
        self.calibration = DashboardCalibrationSession()
        self.streamer_frame_options = {"max_width": 3200, "max_height": 2200}
        self.now = "Cartridge calibration"
        await self.mcp.start()
        self.ensure_live_polling()
        await websocket.send(
            json.dumps(
                {
                    "type": "calibration_state",
                    "calibration": self.calibration.state(preparing=True),
                },
                ensure_ascii=True,
            )
        )
        await self.record("calibration_started", config_path=str(self.calibration.config_path))

        prepare_result = await self.safe_tool(
            "configure_microscope_imaging",
            {
                "channel": "Brightfield",
                "exposure_time": 10000,
                "gain": 0,
                "coaxial_intensity": 10,
                "ring_intensity": 0,
                "auto_exposure": False,
                "restart_streamer": True,
                "bring_to_front": False,
                "stabilization_wait": 0.2,
                "queue_timeout_seconds": 10,
            },
        )
        if isinstance(prepare_result, dict) and prepare_result.get("ok") is False:
            self.calibration.status_message = "Preparation error"
            state = self.calibration.state(error=str(prepare_result.get("error") or prepare_result))
        else:
            state = self.calibration.state()
        await websocket.send(
            json.dumps(
                {
                    "type": "calibration_state",
                    "calibration": state,
                    "prepare_result": compact_tool_payload(prepare_result),
                },
                ensure_ascii=True,
            )
        )
        if self.mcp.running:
            live = await self.collect_live_snapshot(include_state=True)
            self.live = live
            await self.broadcast_json({"type": "live", "live": live})
        await websocket.send(json.dumps({"type": "status", "status": self.status()}))

    async def send_calibration_state(self, websocket: Any) -> None:
        await websocket.send(
            json.dumps(
                {
                    "type": "calibration_state",
                    "calibration": self.calibration.state() if self.calibration else {"active": False},
                },
                ensure_ascii=True,
            )
        )

    async def move_calibration_to_current_target(self, wait_timeout_seconds: float = 20.0) -> dict[str, Any]:
        if self.calibration is None:
            raise RuntimeError("No calibration session is active.")
        target = self.calibration.target_for_current_step()
        if not target:
            raise RuntimeError("No calibration target is active.")

        result = compact_tool_payload(
            await self.safe_tool(
                "move_stage",
                {
                    "position": target,
                    "wait_timeout_seconds": wait_timeout_seconds,
                    "poll_interval": 0.1,
                },
            )
        )
        position = None
        if isinstance(result, dict):
            position = result.get("actual_position") or result.get("target_position") or target
            if result.get("ok") is False or result.get("error"):
                position = result.get("actual_position")
                self.calibration.status_message = "Target move failed"
            elif self.calibration.current_step:
                self.calibration.status_message = f"Ready to adjust {self.calibration.current_step['label']}"
        return {"result": result, "position": position}

    async def apply_calibration_to_runtime(self) -> dict[str, Any] | None:
        if self.calibration is None or not self.mcp.running:
            return None
        return await self.safe_tool(
            "set_calibration",
            {"calibration": self.calibration.config_data.get("calibration") or {}},
        )

    def frame_option_int(self, value: Any, default: int, minimum: int, maximum: int) -> int:
        try:
            parsed = int(float(value))
        except (TypeError, ValueError):
            parsed = default
        return max(minimum, min(maximum, parsed))

    def goal_status(self) -> dict[str, Any]:
        return goal_status_from_events(
            self.recorder.events_for_run(self.recorder.run_id),
            self._agent_task is not None and not self._agent_task.done(),
        )

    def goal_pinned_context(self, goal: dict[str, Any]) -> str:
        if goal.get("status") != "active" or not goal.get("objective"):
            return ""
        return "\n".join(
            [
                "## Active Dashboard Goal",
                "",
                str(goal.get("objective") or "").strip(),
                "",
                "Treat this as the durable objective and completion criteria for this run.",
                "Before acting on hardware, refresh live state with `execution_status_summary()` unless a fresher tool result already proves the needed state.",
                "For multi-step goals, verify every requested stage. A partial run is not complete if any requested branch, routing, execution, cleanup, or final state is missing.",
                "Do not count a planned-but-unexecuted segment as completed hardware work. Do not count a tool result with `ok=false`, `primitive_validation.ok=false`, `move_validation.ok=false`, or `planning_success=false` as successful progress.",
                f"If and only if the whole goal is complete, call `{GOAL_COMPLETE_TOOL}` with concise evidence covering the requested stages.",
                "If progress is blocked, say what input or external state is needed.",
            ]
        )

    def goal_completion_tool(self, goal: dict[str, Any]) -> list[dict[str, Any]]:
        if goal.get("status") != "active" or not goal.get("objective"):
            return []
        return [
            {
                "name": GOAL_COMPLETE_TOOL,
                "description": (
                    "Dashboard internal: mark the active run goal complete when the objective has been satisfied. "
                    "Only call this after checking relevant state/results, after requested hardware execution has finished, "
                    "and when no required work remains. Do not call for partial completion."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "Short user-facing summary of what was completed.",
                        },
                        "evidence": {
                            "type": "string",
                            "description": "Brief evidence that the goal is satisfied, such as observed state, files, or tests.",
                        },
                    },
                    "required": ["summary"],
                    "additionalProperties": False,
                },
            }
        ]

    async def complete_goal_from_agent(self, arguments: dict[str, Any]) -> dict[str, Any]:
        goal = self.goal_status()
        if goal.get("status") != "active" or not goal.get("objective"):
            return {"ok": False, "error": "No active goal to complete.", "isError": True}
        summary = str(arguments.get("summary") or "").strip()
        evidence = str(arguments.get("evidence") or "").strip()
        if not summary:
            return {"ok": False, "error": "summary is required.", "isError": True}
        blocker = latest_goal_completion_blocker(
            self.recorder.events_for_run(self.recorder.run_id)
        )
        missing_terms = goal_completion_missing_terms(
            str(goal.get("objective") or ""),
            summary,
            evidence,
        )
        if blocker or missing_terms:
            reasons = []
            if blocker:
                reasons.append(blocker)
            if missing_terms:
                reasons.append(
                    "Completion evidence does not cover requested stage(s): "
                    + ", ".join(missing_terms)
                )
            message = "Goal completion rejected: " + " ".join(reasons)
            await self.record(
                "goal_completion_rejected",
                level="warning",
                objective=goal.get("objective"),
                summary=summary,
                evidence=evidence,
                reasons=reasons,
                via="agent",
            )
            return {"ok": False, "error": message, "isError": True}
        await self.record(
            "goal_completed",
            objective=goal.get("objective"),
            summary=summary,
            evidence=evidence,
            via="agent",
        )
        self.now = "Goal complete"
        await self.broadcast_json({"type": "status", "status": self.status()})
        return {
            "ok": True,
            "status": "complete",
            "summary": summary,
            "evidence": evidence,
            "message": "Goal marked complete and cleared from active context.",
        }

    async def start_agent_task(self, websocket: Any, prompt: str, event_type: str) -> None:
        if not prompt:
            return
        if self._agent_task is not None and not self._agent_task.done():
            await self.safe_send(
                websocket,
                {"type": "agent_result", "text": "Agent is already running. Stop or steer first."},
            )
            return
        self._agent_task = asyncio.create_task(self.run_agent_prompt(websocket, prompt, event_type))
        await websocket.send(json.dumps({"type": "status", "status": self.status()}))

    async def cancel_agent(self, message: str) -> None:
        task = self._agent_task
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await self.record("agent_finished", level="warning", message=message)

    async def run_agent_prompt(self, websocket: Any, prompt: str, event_type: str) -> None:
        current_task = asyncio.current_task()
        await self.record(event_type, prompt=prompt)
        await self.record("agent_started", message="Thinking", ai_profile=self.ai.status().get("profile"))
        try:
            await self.mcp.start()
            self.ensure_live_polling()
            tools_result = await self.mcp.list_tools()
            tools = tools_result.get("tools", []) if isinstance(tools_result, dict) else []
            tools = filter_agent_tools(tools)

            async def logged_tool_call(tool: str, arguments: dict[str, Any]) -> Any:
                if tool == GOAL_COMPLETE_TOOL:
                    call_event = await self.record(
                        "dashboard_tool_call",
                        tool=tool,
                        arguments=arguments,
                        via="agent",
                    )
                    result = await self.complete_goal_from_agent(arguments)
                    await self.record(
                        "dashboard_tool_result",
                        tool=tool,
                        ok=bool(result.get("ok")),
                        result=result,
                        call_event_id=call_event.get("t"),
                        via="agent",
                        **tool_context_metrics(result),
                    )
                    return result

                call_arguments, argument_overrides = self.agent_tool_arguments(tool, arguments, prompt)
                call_fields = {"tool": tool, "arguments": call_arguments, "via": "agent"}
                if argument_overrides:
                    call_fields["argument_overrides"] = argument_overrides
                call_event = await self.record("mcp_tool_call", **call_fields)
                try:
                    result = await self.call_agent_mcp_tool(tool, call_arguments)
                    result = mark_failed_mcp_payload(result)
                    event_result, model_result, attachment_details = self.prepare_visual_tool_result_for_model(
                        tool,
                        call_arguments,
                        result,
                    )
                    ok = mcp_tool_call_succeeded(result)
                    result_fields = {
                        "tool": tool,
                        "ok": ok,
                        "result": event_result,
                        "call_event_id": call_event.get("t"),
                        "via": "agent",
                        **tool_context_metrics(model_result),
                    }
                    if attachment_details:
                        result_fields["model_attachments"] = attachment_details
                        result_fields.update(tool_attachment_metrics(attachment_details))
                    await self.record(
                        "mcp_tool_result",
                        **result_fields,
                    )
                    return model_result
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    await self.record(
                        "mcp_tool_result",
                        level="error",
                        tool=tool,
                        ok=False,
                        error=str(exc),
                        call_event_id=call_event.get("t"),
                        via="agent",
                    )
                    return {"error": str(exc), "isError": True}

            async def logged_reasoning(text: str, round_index: int) -> None:
                await self.record("agent_thinking", text=text, round=round_index)

            async def logged_text(text: str, round_index: int) -> None:
                await self.record("agent_message", text=text, round=round_index)

            async def logged_model_response(metrics: dict[str, Any]) -> None:
                metrics["ai_profile"] = self.ai.status().get("profile")
                await self.record("agent_model_response", **metrics)

            async def logged_provider_retry(details: dict[str, Any]) -> None:
                level = "error" if int(details.get("attempt") or 0) == 1 else "warning"
                await self.record("agent_provider_retry", level=level, **details)

            async def logged_context_compaction(details: dict[str, Any]) -> None:
                await self.record("context_compacted", **details)

            all_events = self.recorder.events_for_run(self.recorder.run_id)
            checkpoint = await self.ensure_context_checkpoint(
                all_events,
                logged_provider_retry,
                logged_context_compaction,
            )
            model_events, checkpoint_details = self.events_for_model_from_checkpoint(all_events, checkpoint)
            model_context = build_model_context(
                model_events,
                run_dir=self.recorder.run_dir,
                max_chars=self.config.ai.max_context_chars,
                target_chars=self.config.ai.target_context_chars,
                recent_event_target=min(self.config.ai.recent_event_target, 80),
                large_event_chars=self.config.ai.large_event_chars,
                protect_latest_tool_result=True,
            )
            if checkpoint_details is not None:
                await self.record("context_checkpoint_used", **checkpoint_details)
            if model_context.compacted:
                await self.record("context_compacted", **model_context.details)

            pinned_context, pinned_context_metadata = self.load_pinned_context()
            goal = self.goal_status()
            goal_context = self.goal_pinned_context(goal)
            if goal_context:
                tools = [*tools, *self.goal_completion_tool(goal)]
                pinned_context = f"{goal_context}\n\n{pinned_context}" if pinned_context else goal_context
                await self.record(
                    "goal_context_used",
                    status=goal.get("status"),
                    objective_chars=len(str(goal.get("objective") or "")),
                    message="Active goal was sent outside the compactable event log.",
                )
            await self.record(
                "pinned_context_used",
                message="Pinned operating context was sent outside the compactable event log.",
                **pinned_context_metadata,
            )

            response = await self.ai.ask_with_tools(
                prompt,
                model_context.events,
                tools,
                logged_tool_call,
                pinned_context=pinned_context,
                on_reasoning=logged_reasoning,
                on_text=logged_text,
                on_model_response=logged_model_response,
                on_retry=logged_provider_retry,
                max_tool_output_chars=self.config.ai.max_tool_output_chars,
                on_context_compacted=logged_context_compaction,
            )
            text = str(response.get("text", ""))
            recent_events = self.recorder.events_for_run(self.recorder.run_id, limit=20)
            already_emitted = any(
                event.get("type") == "agent_message" and str(event.get("text", "")) == text
                for event in recent_events
            )
            event = await self.record(
                "agent_response",
                text=text,
                hidden=already_emitted,
            )
            await self.record("agent_finished", message="Done")
            await self.safe_send(websocket, {"type": "agent_result", "event": event, "text": text})
        except asyncio.CancelledError:
            await self.safe_send(websocket, {"type": "agent_result", "text": "Stopped by user."})
            raise
        except Exception as exc:
            if websocket_closed_ok(exc):
                return
            event = await self.record("agent_response", level="error", error=str(exc))
            await self.record("agent_finished", level="error", message=str(exc))
            await self.safe_send(websocket, {"type": "agent_result", "event": event, "text": str(exc)})
        finally:
            if self._agent_task is current_task:
                self._agent_task = None
                await self.broadcast_json({"type": "status", "status": self.status()})

    async def call_agent_mcp_tool(self, tool: str, call_arguments: dict[str, Any]) -> Any:
        if tool != "execution_wait_status":
            return await self.mcp.call_tool(tool, call_arguments)

        requested_wait = parse_optional_float(call_arguments.get("wait_seconds"))
        if requested_wait is None or requested_wait <= 0:
            return await self.mcp.call_tool(tool, call_arguments)

        effective_wait = min(
            max(0.0, requested_wait),
            DEFAULT_AGENT_EXECUTION_WAIT_SECONDS,
        )
        immediate_arguments = dict(call_arguments)
        immediate_arguments["wait_seconds"] = 0.0
        started_at = time.monotonic()

        initial_result = await self.mcp.call_tool(tool, immediate_arguments)
        initial_payload = compact_tool_payload(initial_result)
        if not isinstance(initial_payload, dict) or not initial_payload.get("running"):
            return self.add_dashboard_wait_metadata(
                initial_result,
                requested_wait=requested_wait,
                effective_wait=effective_wait,
                started_at=started_at,
                return_reason="no_running_wait",
            )

        await asyncio.sleep(effective_wait)
        final_result = await self.mcp.call_tool(tool, immediate_arguments)
        final_payload = compact_tool_payload(final_result)
        return_reason = "timer_elapsed"
        if isinstance(final_payload, dict) and not final_payload.get("running"):
            return_reason = "wait_completed"
        return self.add_dashboard_wait_metadata(
            final_result,
            requested_wait=requested_wait,
            effective_wait=effective_wait,
            started_at=started_at,
            return_reason=return_reason,
        )

    def add_dashboard_wait_metadata(
        self,
        result: Any,
        requested_wait: float,
        effective_wait: float,
        started_at: float,
        return_reason: str,
    ) -> Any:
        payload = compact_tool_payload(result)
        if not isinstance(payload, dict):
            return result
        payload = dict(payload)
        status_wait = dict(payload.get("status_wait") or {})
        status_wait.update(
            {
                "requested_seconds": round(max(0.0, requested_wait), 3),
                "effective_seconds": round(max(0.0, effective_wait), 3),
                "elapsed_seconds": round(max(0.0, time.monotonic() - started_at), 3),
                "return_reason": return_reason,
                "frontend_friendly": True,
                "mcp_lock_released_during_wait": True,
            }
        )
        payload["status_wait"] = status_wait
        return replace_mcp_text_payload(result, payload)

    async def apply_matrix_erase_droplet_updates(self, updates: Any) -> list[dict[str, Any]]:
        if not isinstance(updates, list) or not updates:
            return []

        results: list[dict[str, Any]] = []
        for item in updates:
            if not isinstance(item, dict):
                results.append({"ok": False, "error": "droplet update must be an object"})
                continue
            try:
                droplet_id = int(item.get("droplet_id"))
            except Exception:
                results.append({"ok": False, "error": "droplet_id must be an integer"})
                continue

            action = str(item.get("action") or "").strip().lower()
            if action not in {"delete", "reshape"}:
                results.append({"ok": False, "droplet_id": droplet_id, "error": f"unsupported action {action!r}"})
                continue

            if action == "delete":
                delete_result = mark_failed_mcp_payload(
                    await self.safe_tool(
                        "delete_droplet",
                        {
                            "droplet_id": droplet_id,
                            "persist_electrodes": False,
                        },
                    )
                )
                results.append(
                    {
                        "ok": mcp_tool_call_succeeded(delete_result),
                        "droplet_id": droplet_id,
                        "action": "delete",
                        "delete_result": compact_tool_payload(delete_result),
                    }
                )
                continue

            try:
                origin = self.normalize_matrix_pair(item.get("origin"), "origin")
                target = self.normalize_matrix_pair(item.get("target") or origin, "target")
                shape = self.normalize_matrix_shape(item.get("shape"))
                priority = int(item.get("priority", 0) or 0)
                vital_space = int(item.get("vital_space", 1) or 1)
            except Exception as exc:
                results.append(
                    {
                        "ok": False,
                        "droplet_id": droplet_id,
                        "action": "reshape",
                        "error": str(exc),
                    }
                )
                continue

            if not shape:
                delete_result = mark_failed_mcp_payload(
                    await self.safe_tool(
                        "delete_droplet",
                        {
                            "droplet_id": droplet_id,
                            "persist_electrodes": False,
                        },
                    )
                )
                results.append(
                    {
                        "ok": mcp_tool_call_succeeded(delete_result),
                        "droplet_id": droplet_id,
                        "action": "delete_empty_shape",
                        "delete_result": compact_tool_payload(delete_result),
                    }
                )
                continue

            delete_result = mark_failed_mcp_payload(
                await self.safe_tool(
                    "delete_droplet",
                    {
                        "droplet_id": droplet_id,
                        "persist_electrodes": False,
                    },
                )
            )
            delete_ok = mcp_tool_call_succeeded(delete_result)
            entry: dict[str, Any] = {
                "ok": delete_ok,
                "droplet_id": droplet_id,
                "action": "reshape",
                "origin": origin,
                "target": target,
                "shape_size": len(shape),
                "delete_result": compact_tool_payload(delete_result),
            }
            if delete_ok:
                create_result = mark_failed_mcp_payload(
                    await self.safe_tool(
                        "create_droplet",
                        {
                            "droplet_id": droplet_id,
                            "origin": origin,
                            "target": target,
                            "shape": shape,
                            "priority": priority,
                            "vital_space": vital_space,
                        },
                    )
                )
                entry["create_result"] = compact_tool_payload(create_result)
                entry["ok"] = mcp_tool_call_succeeded(create_result)
            results.append(entry)

        await self.record(
            "matrix_erase_droplets_updated",
            updates=[
                {
                    "droplet_id": result.get("droplet_id"),
                    "action": result.get("action"),
                    "ok": result.get("ok"),
                    "shape_size": result.get("shape_size"),
                    "error": result.get("error"),
                }
                for result in results
            ],
        )
        return results

    @staticmethod
    def normalize_matrix_pair(value: Any, label: str) -> list[int]:
        if not isinstance(value, list) or len(value) < 2:
            raise ValueError(f"{label} must be [row, col].")
        return [int(value[0]), int(value[1])]

    @staticmethod
    def normalize_matrix_shape(value: Any) -> list[list[int]]:
        if not isinstance(value, list):
            raise ValueError("shape must be a list of [row_offset, col_offset] cells.")
        shape: list[list[int]] = []
        seen: set[tuple[int, int]] = set()
        for cell in value:
            if not isinstance(cell, list) or len(cell) < 2:
                raise ValueError("shape cells must be [row_offset, col_offset].")
            row = int(cell[0])
            col = int(cell[1])
            key = (row, col)
            if key in seen:
                continue
            seen.add(key)
            shape.append([row, col])
        return shape

    def agent_tool_arguments(
        self,
        tool: str,
        arguments: dict[str, Any],
        prompt: str = "",
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        call_arguments = dict(arguments or {})
        overrides: dict[str, Any] = {}
        if tool == "visualizer_frame":
            if call_arguments.get("include_base64") is not True:
                call_arguments["include_base64"] = True
                overrides["include_base64"] = True
            if not call_arguments.get("image_format"):
                call_arguments["image_format"] = "png"
                overrides["image_format"] = "png"
        if tool == "plan_move":
            if call_arguments.get("background") is not True:
                call_arguments["background"] = True
                overrides["background"] = True
            if call_arguments.get("planning_timeout") is None:
                call_arguments["planning_timeout"] = 120.0
                overrides["planning_timeout"] = 120.0
        if tool == "execute_segment_to_breakpoint":
            requested_wait_mode = call_arguments.get("wait_mode")
            if requested_wait_mode != "background":
                call_arguments["wait_mode"] = "background"
                overrides["wait_mode"] = {
                    "from": requested_wait_mode,
                    "to": "background",
                    "reason": (
                        "Dashboard execution should not hold the MCP call lock while "
                        "frames are playing; wait with execution_wait_status instead."
                    ),
                }
        if tool == "execution_wait_status" and call_arguments.get("wait_seconds") is None:
            call_arguments["wait_seconds"] = DEFAULT_AGENT_EXECUTION_WAIT_SECONDS
            overrides["wait_seconds"] = {
                "to": DEFAULT_AGENT_EXECUTION_WAIT_SECONDS,
                "reason": (
                    "Execution waits should use a timer instead of repeated immediate "
                    "status polling."
                ),
            }
        if tool in FRAME_DELAY_AGENT_TOOLS and "frame_delay" in call_arguments:
            requested_delay = call_arguments.get("frame_delay")
            parsed_delay = parse_optional_float(requested_delay)
            custom_delay_allowed = self.agent_prompt_allows_custom_frame_delay(prompt)
            if parsed_delay is None or (
                abs(parsed_delay - DEFAULT_AGENT_FRAME_DELAY_SECONDS) > 1e-9
                and not custom_delay_allowed
            ):
                call_arguments["frame_delay"] = DEFAULT_AGENT_FRAME_DELAY_SECONDS
                overrides["frame_delay"] = {
                    "from": requested_delay,
                    "to": DEFAULT_AGENT_FRAME_DELAY_SECONDS,
                    "reason": "Default frame delay is 1.0s unless the user explicitly requests another value.",
                }
        return call_arguments, overrides

    def agent_prompt_allows_custom_frame_delay(self, prompt: str) -> bool:
        goal = self.goal_status()
        text = "\n".join(
            [
                str(prompt or ""),
                str(goal.get("objective") or ""),
            ]
        ).lower()
        patterns = [
            r"\b(?:use|set|run|execute|move|play)\b[^.\n\r]{0,80}\bframe[_\s-]*delay\b[^.\n\r]{0,40}\b\d+(?:\.\d+)?\b",
            r"\bframe[_\s-]*delay\b[^.\n\r]{0,40}\b(?:to|at|of|=)\s*\d+(?:\.\d+)?\b",
            r"\b(?:use|set|run|execute|move|play)\b[^.\n\r]{0,80}\b\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds)\s*(?:/|per)\s*frame\b",
            r"\b(?:use|set|run|execute|move|play)\b[^.\n\r]{0,80}\b\d+(?:\.\d+)?\s*(?:fps|hz)\b",
        ]
        return any(re.search(pattern, text) for pattern in patterns)

    def prepare_visual_tool_result_for_model(
        self,
        tool: str,
        arguments: dict[str, Any],
        result: Any,
        attach_for_model: bool = True,
    ) -> tuple[Any, Any, list[dict[str, Any]]]:
        if tool != "visualizer_frame":
            return result, result, []
        frame = compact_tool_payload(result)
        if not isinstance(frame, dict) or not isinstance(frame.get("base64"), str):
            return result, result, []

        artifact, image_bytes = self.write_visualizer_artifact(frame, arguments)
        event_frame = dict(frame)
        event_frame.pop("base64", None)
        event_frame["artifact"] = artifact
        event_frame["available_as_artifact"] = True
        if attach_for_model:
            event_frame["sent_to_model_as_image"] = True
        event_result = replace_mcp_text_payload(result, event_frame)

        model_frame = dict(event_frame)
        model_frame["model_image_attachment"] = {
            "type": "input_image",
            "delivery": "one_shot_data_url",
            "artifact": artifact,
            "mime_type": frame.get("mime_type") or "image/png",
            "bytes": len(image_bytes),
        }
        model_result = replace_mcp_text_payload(result, model_frame)
        attachment_details = []
        if attach_for_model:
            model_result[MODEL_ATTACHMENTS_KEY] = [
                {
                    "type": "input_image",
                    "label": visualizer_attachment_label(frame, artifact),
                    "mime_type": frame.get("mime_type") or "image/png",
                    "base64": frame["base64"],
                    "artifact": artifact,
                }
            ]
            attachment_details = [
                {
                    "type": "input_image",
                    "delivery": "one_shot_data_url",
                    "artifact": artifact,
                    "mime_type": frame.get("mime_type") or "image/png",
                    "bytes": len(image_bytes),
                }
            ]
        return event_result, model_result, attachment_details

    def write_visualizer_artifact(self, frame: dict[str, Any], arguments: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
        try:
            image_bytes = base64.b64decode(str(frame.get("base64") or ""), validate=True)
        except Exception as exc:
            raise ValueError("visualizer_frame returned invalid base64") from exc
        digest = hashlib.sha256(image_bytes).hexdigest()
        visualizer = safe_filename(str(frame.get("visualizer") or arguments.get("visualizer") or "visualizer"))
        source = safe_filename(str(frame.get("frame_source") or arguments.get("frame_source") or "snapshot"))
        ext = safe_filename(str(frame.get("format") or arguments.get("image_format") or "png").lstrip("."))
        if ext not in {"png", "jpg", "jpeg"}:
            ext = "png"
        artifacts_dir = self.recorder.run_dir / "artifacts" / "visualizers"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        path = artifacts_dir / f"{stamp}_{visualizer}_{source}_{digest[:10]}.{ext}"
        path.write_bytes(image_bytes)
        try:
            relative_path = path.relative_to(self.recorder.run_dir)
        except ValueError:
            relative_path = path
        artifact = {
            "path": str(relative_path).replace("\\", "/"),
            "absolute_path": str(path),
            "sha256": digest,
            "bytes": len(image_bytes),
            "visualizer": frame.get("visualizer") or arguments.get("visualizer"),
            "frame_source": frame.get("frame_source") or arguments.get("frame_source"),
            "shape": frame.get("shape"),
            "mime_type": frame.get("mime_type") or "image/png",
        }
        return artifact, image_bytes

    async def broadcast_json(self, payload: dict[str, Any]) -> None:
        message = json.dumps(payload, ensure_ascii=True)
        stale = []
        for client in self.clients:
            try:
                await client.send(message)
            except Exception:
                stale.append(client)
        for client in stale:
            self.clients.discard(client)

    async def safe_send(self, websocket: Any, payload: dict[str, Any]) -> None:
        try:
            await websocket.send(json.dumps(payload, ensure_ascii=True))
        except Exception as exc:
            if not websocket_closed_ok(exc):
                raise

    async def broadcast_run_loaded(self) -> None:
        await self.broadcast_json(self.run_loaded_payload())

    def run_loaded_payload(self) -> dict[str, Any]:
        return {
            "type": "run_loaded",
            "status": self.status(),
            "events": self.recorder.events_for_run(self.recorder.run_id),
            "runs": self.recorder.list_runs(),
        }

    async def run(self) -> None:
        await self.record("cockpit_started", host=self.config.host, port=self.config.port)
        httpd = start_http_server(self.config.host, self.config.port)
        ws_port = self.config.port + 1
        async with websockets.serve(
            self.handle_ws,
            self.config.host,
            ws_port,
            max_size=None,
        ):
            print(f"DropLogic Dashboard: http://{self.config.host}:{self.config.port}")
            print(f"DropLogic Dashboard WS: ws://{self.config.host}:{ws_port}")
            try:
                await asyncio.Future()
            finally:
                httpd.shutdown()


def start_http_server(host: str, port: int) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(FRONTEND), **kwargs)

        def log_message(self, format: str, *args: Any) -> None:
            return

        def end_headers(self) -> None:
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    httpd = http.server.ThreadingHTTPServer((host, port), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True, name="CockpitHTTP")
    thread.start()
    return httpd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the DropLogic Dashboard.")
    parser.add_argument("--config", help="Path to cockpit config JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config(args.config)
    app = CockpitApp(config)
    try:
        asyncio.run(app.run())
    except KeyboardInterrupt:
        pass
    finally:
        try:
            if app._poll_task is not None:
                app._poll_task.cancel()
            asyncio.run(app.mcp.stop())
        except Exception:
            pass


if __name__ == "__main__":
    main()
