from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import http.server
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from typing import Any

import websockets

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.ai_provider import AiProvider, MODEL_ATTACHMENTS_KEY
    from backend.agent_tools import filter_agent_tools, parse_optional_float
    from backend.audio_handlers import AudioHandlersMixin
    from backend.calibration import DashboardCalibrationSession, load_config as load_droplogic_config, positive_float_or_none, resolve_config_path, save_config as save_droplogic_config
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
    from backend.pinned_context import (
        GUIDE_EXPANSION_CHAR_LIMIT,
        compact_pinned_context_file,
        guide_shard_catalog,
    )
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
    from .calibration import DashboardCalibrationSession, load_config as load_droplogic_config, positive_float_or_none, resolve_config_path, save_config as save_droplogic_config
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
    from .pinned_context import (
        GUIDE_EXPANSION_CHAR_LIMIT,
        compact_pinned_context_file,
        guide_shard_catalog,
    )
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
DEFAULT_AGENT_PLANNING_WAIT_SECONDS = 15.0
DASHBOARD_USER_TOOL_DEFAULT_TIMEOUT_SECONDS = 45.0
FRAME_DELAY_AGENT_TOOLS = {"start_plan", "execute_segment_to_breakpoint"}
MCP_STATEFUL_EXECUTION_TOOLS = {
    "cancel_execution_wait",
    "execute_segment_to_breakpoint",
    "execution_wait_status",
    "resume_plan",
    "start_plan",
}
MCP_HEALTH_GUARDED_TOOLS = {
    "calibration_stage_jog",
    "calibration_stage_move_to_target",
    "calibration_stage_set_speed",
    "capture_camera_image",
    "capture_droplet_images",
    "capture_microscope_image",
    "configure_camera_imaging",
    "configure_microscope_imaging",
    "execute_segment_to_breakpoint",
    "execution_wait_status",
    "move_stage",
    "resume_plan",
    "set_execution_view_mode",
    "set_light_state",
    "set_matrix_cells",
    "set_matrix_voltage",
    "set_stage_motion_params",
    "set_stage_motion_speed",
    "set_streamer_source",
    "set_temperature_target",
    "start_execute_until_breakpoint",
    "start_melting_curve_capture",
    "start_plan",
    "start_temperature_routine",
    "start_visualizer",
    "temperature_hold",
    "verify_droplets",
}
RUN_EVENT_WINDOW_LIMIT = 420
RUN_EVENT_OLDER_LIMIT = 260
FRONTEND_OMITTED_EVENT_TYPES = {
    "temperature_sample",
    "live_poll_error",
    "live_scene_error",
    "live_stream_error",
}


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
        self.live_clients: set[Any] = set()
        self._client_send_locks: dict[Any, asyncio.Lock] = {}
        self.now = "Idle"
        self.live: dict[str, Any] = {}
        self.streamer_frame_options: dict[str, Any] = {
            "max_width": 720,
            "max_height": 460,
        }
        self.calibration: DashboardCalibrationSession | None = None
        self._poll_task: asyncio.Task | None = None
        self._stream_task: asyncio.Task | None = None
        self._agent_task: asyncio.Task | None = None
        self._agent_queue: list[dict[str, Any]] = []
        self._direct_stream_available = False
        self._scene_task: asyncio.Task | None = None
        self._live_frame_sequences: dict[str, int] = {}
        self._melting_curve_monitor_tasks: dict[str, asyncio.Task] = {}
        self._melting_curve_seen_captures: set[str] = set()
        self._audio_transcriber: Any | None = None
        self._audio_transcriber_lock = threading.Lock()
        self._audio_preload_task: asyncio.Task | None = None
        self._last_temperature_record: dict[str, Any] = {}

    @staticmethod
    def should_background_temperature_hold(arguments: dict[str, Any]) -> bool:
        hold_seconds = parse_optional_float(arguments.get("hold_seconds")) or 0.0
        settle_timeout = parse_optional_float(arguments.get("settle_timeout_seconds"))
        require_settle = bool(arguments.get("require_settle"))
        if require_settle:
            return True
        if hold_seconds > DASHBOARD_USER_TOOL_DEFAULT_TIMEOUT_SECONDS:
            return True
        if settle_timeout is not None and settle_timeout > DASHBOARD_USER_TOOL_DEFAULT_TIMEOUT_SECONDS:
            return True
        return False

    @staticmethod
    def temperature_hold_as_routine_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
        step = dict(arguments or {})
        step.setdefault("hold_seconds", 0)
        return {
            "steps": [step],
            "tolerance_c": float(step.get("tolerance_c", 0.5) or 0.5),
            "settle_timeout_seconds": float(step.get("settle_timeout_seconds", 600.0) or 600.0),
            "sample_interval_seconds": float(step.get("sample_interval_seconds", 5.0) or 5.0),
            "require_settle": bool(step.get("require_settle", False)),
            "max_samples_per_step": int(step.get("max_samples", 20) or 20),
            "stop_on_error": True,
        }

    @staticmethod
    def annotate_routed_tool_result(result: Any, original_tool: str, actual_tool: str) -> Any:
        payload = compact_tool_payload(result)
        if not isinstance(payload, dict):
            return result
        payload = dict(payload)
        payload["dashboard_routed_from_tool"] = original_tool
        payload["dashboard_actual_tool"] = actual_tool
        payload["next"] = (
            "This long temperature hold was started as a background routine; "
            "poll temperature_routine_status() instead of keeping a blocking call open."
        )
        return replace_mcp_text_payload(result, payload)

    @staticmethod
    def dashboard_user_tool_timeout_seconds(tool: str, arguments: dict[str, Any]) -> float:
        tool = str(tool or "")
        if tool in {"load_system", "restart_system"}:
            return 180.0
        if tool in {"close_system", "capture_droplet_images", "verify_droplets"}:
            return 120.0
        if tool in {
            "plan_move",
            "plan_reservoir_extraction",
            "plan_isometric_split",
            "plan_mix",
            "plan_merge",
            "planning_job_status",
        }:
            return 180.0
        if tool in {"execute_segment_to_breakpoint", "start_execute_until_breakpoint"}:
            return 45.0
        if tool == "execution_wait_status":
            wait_seconds = parse_optional_float(arguments.get("wait_seconds")) or 0.0
            return min(60.0, max(10.0, wait_seconds + 5.0))
        if tool in {
            "set_light_state",
            "light_off",
            "configure_microscope_imaging",
            "configure_camera_imaging",
            "set_streamer_source",
            "start_visualizer",
            "stop_visualizer",
            "visualizer_frame",
            "move_stage",
            "temperature_hold",
        }:
            return 30.0
        return DASHBOARD_USER_TOOL_DEFAULT_TIMEOUT_SECONDS

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
                "preload": self.config.speech.preload,
                **self.audio_model_state(),
                "wake_enabled": self.config.speech.wake_enabled,
                "wake_auto_start": self.config.speech.wake_auto_start,
                "wake_word": self.config.speech.wake_word,
                "wake_language": self.config.speech.wake_language,
                "wake_auto_submit": self.config.speech.wake_auto_submit,
                "wake_command_max_seconds": self.config.speech.wake_command_max_seconds,
                "wake_silence_ms": self.config.speech.wake_silence_ms,
                "wake_initial_silence_ms": self.config.speech.wake_initial_silence_ms,
                "max_audio_seconds": self.config.speech.max_audio_seconds,
            },
            "timeline_control": self.dashboard_timeline_control(),
            "agent_busy": self._agent_task is not None and not self._agent_task.done(),
            "agent_queue_length": len(self._agent_queue),
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

    def dashboard_timeline_control(self) -> dict[str, Any] | None:
        scene = self.live.get("scene") if isinstance(self.live, dict) else None
        if isinstance(scene, dict):
            timeline = scene.get("timeline")
            if isinstance(timeline, dict) and isinstance(timeline.get("control"), dict):
                return timeline["control"]
            control = scene.get("timeline_control")
            if isinstance(control, dict):
                return control
        if not self.mcp.running:
            return {
                "paused": True,
                "paused_at": None,
                "paused_reason": "mcp_not_running",
                "paused_source": "system",
                "paused_after_frame_index": None,
                "active_duration_seconds": None,
                "interval_count": 0,
                "total_paused_seconds": 0,
                "intervals": [],
                "system_loaded": False,
                "reason": "mcp_not_running",
            }
        return None

    async def ensure_mcp_started_for_tool(self, via: str, tool: str | None = None) -> bool:
        if self.mcp.running:
            return False
        await self.mcp.start()
        self.ensure_live_polling()
        self.now = "MCP server auto-started"
        await self.record(
            "mcp_started",
            command=self.mcp.command_line(),
            via=via,
            reason="auto_start_for_tool",
            tool=tool,
        )
        await self.broadcast_json({"type": "status", "status": self.status()})
        return True

    @staticmethod
    def mcp_runtime_restarted_result(tool: str, via: str) -> dict[str, Any]:
        return {
            "ok": False,
            "isError": True,
            "reason": "mcp_runtime_restarted_state_lost",
            "tool_not_run": tool,
            "via": via,
            "error": (
                "The dashboard MCP process was not running and has just been restarted. "
                "The previous in-memory BoxMini system, executor, planning job, execution wait, "
                "and plan cannot be resumed from this process."
            ),
            "recovery_steps": [
                "Do not call execution_wait_status or execute_segment_to_breakpoint for the lost executor.",
                "Check runtime_status(detail='compact') and only load_system(system='boxmini', reset_matrix=false) if the physical state is safe to preserve.",
                "Inspect matrix_summary(source='state') or the matrix visualizer to reconstruct logical droplets from active electrodes.",
                "Create or reshape the logical droplets that match the physical state, then plan and execute a fresh segment.",
            ],
            "agent_guidance": (
                "Treat this as a runtime restart, not as a normal paused execution. "
                "Recover from the current physical/persisted matrix state before continuing."
            ),
        }

    @staticmethod
    def mcp_tool_requires_health(tool: str, arguments: dict[str, Any] | None = None) -> bool:
        if tool == "calibration_stage_jog" and isinstance(arguments, dict) and arguments.get("stop_all"):
            return False
        return tool in MCP_HEALTH_GUARDED_TOOLS

    async def mcp_health_guard_result(
        self,
        tool: str,
        via: str,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if not self.mcp_tool_requires_health(tool, arguments) or not self.mcp.running:
            return None
        health_result = await self.safe_tool("health_check", timeout_seconds=3.0)
        health = self.normalized_health_payload(health_result)
        if isinstance(health, dict) and health.get("ok") is True:
            return None
        if not isinstance(health, dict):
            health = {
                "ok": False,
                "error": "health_check did not return a structured payload",
                "raw": health,
            }
        return {
            "ok": False,
            "isError": True,
            "reason": "mcp_runtime_health_failed",
            "tool_not_run": tool,
            "via": via,
            "health": health,
            "error": (
                f"Refusing to run {tool}: the MCP runtime health check failed. "
                "Do not continue hardware execution until the BoxMini system is restarted "
                "or the queue workers are healthy."
            ),
            "recovery_steps": [
                "Inspect health.queue_workers and health.last_error.",
                "Use restart_system(reset_matrix=false) if the existing logical state can be discarded.",
                "After restart, re-load or rebuild the intended plan from the current physical state.",
            ],
        }

    def normalized_health_payload(self, health_result: Any) -> Any:
        raw_result = health_result.get("result") if isinstance(health_result, dict) and "result" in health_result else health_result
        roots: list[Any] = []

        def add(value: Any) -> None:
            if value is not None and not any(value is root for root in roots):
                roots.append(value)

        add(compact_tool_payload(health_result))
        for root in self.iter_payload_roots(raw_result):
            add(root)
        for root in roots:
            if isinstance(root, dict) and root.get("ok") is True:
                return root
        for root in roots:
            if isinstance(root, dict) and "ok" in root:
                return root
        for root in roots:
            if isinstance(root, dict):
                return root
        return None

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
            context_text, context_metadata = compact_pinned_context_file(clean_path, text)
            loaded.append(
                {
                    "path": clean_path,
                    "source": source,
                    "root": str(root),
                    "chars": len(text),
                    **context_metadata,
                }
            )
            sections.append(f"### {clean_path} ({source})\n{context_text.strip()}")

        metadata = {
            "files": loaded,
            "missing": missing,
            "total_chars": sum(item["chars"] for item in loaded),
            "sent_chars": sum(int(item.get("sent_chars") or item["chars"]) for item in loaded),
        }
        context = "\n\n".join(sections)
        return context, metadata

    def available_guide_shards(self) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        for source, root in self.pinned_context_roots():
            for item in guide_shard_catalog(root):
                path = str(item.get("path") or "")
                if path and path not in merged:
                    merged[path] = {**item, "source": source, "root": str(root.resolve())}
        return [merged[path] for path in sorted(merged)]

    def load_turn_guide_expansions(self, paths: list[str]) -> tuple[str, dict[str, Any]]:
        sections: list[str] = []
        loaded: list[dict[str, Any]] = []
        missing: list[str] = []
        current_chars = 0
        seen: set[str] = set()
        for raw_path in paths:
            clean_path = str(raw_path).strip().replace("\\", "/")
            if not clean_path or clean_path in seen:
                continue
            seen.add(clean_path)
            found = None
            for source, root in self.pinned_context_roots():
                candidate = (root / clean_path).resolve()
                try:
                    candidate.relative_to(root.resolve())
                except ValueError:
                    continue
                if candidate.is_file() and candidate.suffix.lower() == ".md":
                    found = (source, root.resolve(), candidate)
                    break
            if found is None:
                missing.append(clean_path)
                continue
            source, root, path = found
            text = path.read_text(encoding="utf-8").strip()
            section = f"### {clean_path}\n{text}"
            next_chars = len(section) + 2
            if sections and current_chars + next_chars > GUIDE_EXPANSION_CHAR_LIMIT:
                loaded.append({"path": clean_path, "omitted": True, "reason": "guide_expansion_char_limit"})
                break
            sections.append(section)
            current_chars += next_chars
            loaded.append({"path": clean_path, "source": source, "root": str(root), "chars": len(text), "sent_chars": len(section)})
        if not sections:
            return "", {"files": loaded, "missing": missing, "sent_chars": 0}
        context = (
            "# Turn-Scoped Detailed Guide Expansions\n"
            "These detailed guide files were selected for this model turn only. "
            "Re-evaluate guide needs on the next turn.\n\n"
            + "\n\n".join(sections)
        )
        return context, {
            "files": loaded,
            "missing": missing,
            "sent_chars": len(context),
        }

    async def select_turn_guide_shards(
        self,
        prompt: str,
        goal: dict[str, Any],
        events: list[dict[str, Any]],
        on_retry: Any,
        on_context_compacted: Any,
    ) -> dict[str, Any]:
        shards = self.available_guide_shards()
        if not shards:
            return {"paths": [], "reason": "no guide shards available", "catalog_count": 0}
        selector_prompt = prompt
        if goal.get("status") == "active" and goal.get("objective"):
            selector_prompt = f"{prompt}\n\nActive goal:\n{goal.get('objective')}"
        try:
            selection = await self.ai.select_guide_shards(
                selector_prompt,
                events,
                shards,
                max_files=5,
                on_retry=on_retry,
                on_context_compacted=on_context_compacted,
            )
        except Exception as exc:
            return {
                "paths": [],
                "reason": f"guide shard selector failed: {exc}",
                "catalog_count": len(shards),
                "error": str(exc),
            }
        selection["catalog_count"] = len(shards)
        return selection

    async def broadcast_event(self, event: dict[str, Any]) -> None:
        message = json.dumps({"type": "event", "event": event}, ensure_ascii=True)
        stale = []
        for client in list(self.clients):
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

    def maybe_start_melting_curve_monitor(
        self,
        tool: str,
        *payloads: Any,
        call_event_id: Any = None,
        via: str = "",
    ) -> None:
        if str(tool or "") != "start_melting_curve_capture":
            return
        reference = self.extract_melting_curve_status_reference(*payloads)
        if not reference:
            return
        routine_id = str(reference.get("routine_id") or "").strip()
        metadata_path = str(reference.get("metadata_path") or "").strip()
        task_key = routine_id or metadata_path
        if not task_key:
            return
        existing = self._melting_curve_monitor_tasks.get(task_key)
        if existing is not None and not existing.done():
            return
        task = asyncio.create_task(
            self.monitor_melting_curve_capture(
                routine_id=routine_id,
                metadata_path=metadata_path,
                call_event_id=call_event_id,
                via=via,
            )
        )
        self._melting_curve_monitor_tasks[task_key] = task

    def extract_melting_curve_status_reference(self, *payloads: Any) -> dict[str, Any] | None:
        for payload in payloads:
            for root in self.iter_payload_roots(payload):
                if not isinstance(root, dict):
                    continue
                candidate = root.get("result") if isinstance(root.get("result"), dict) else root
                routine_id = str(candidate.get("routine_id") or "").strip()
                metadata_path = str(candidate.get("metadata_path") or "").strip()
                if routine_id or metadata_path:
                    return {
                        "routine_id": routine_id,
                        "metadata_path": metadata_path,
                    }
        return None

    def iter_payload_roots(self, payload: Any) -> list[Any]:
        roots: list[Any] = []

        def add(value: Any) -> None:
            if value is not None:
                roots.append(value)

        add(payload)
        compact = compact_tool_payload(payload)
        add(compact)
        if isinstance(payload, dict):
            add(payload.get("result"))
            add(self.deep_get(payload, "result.result"))
            add(self.deep_get(payload, "structuredContent"))
            add(self.deep_get(payload, "structuredContent.result"))
            add(self.deep_get(payload, "result.structuredContent"))
            add(self.deep_get(payload, "result.structuredContent.result"))
            content = payload.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        parsed = self.parse_json_object(part["text"])
                        add(parsed)
        if isinstance(compact, dict):
            add(compact.get("result"))
        return roots

    @staticmethod
    def parse_json_object(text: str) -> Any:
        value = str(text or "").strip()
        if not value or value[0] not in "{[":
            return None
        try:
            return json.loads(value)
        except Exception:
            return None

    async def monitor_melting_curve_capture(
        self,
        routine_id: str,
        metadata_path: str,
        call_event_id: Any = None,
        via: str = "",
    ) -> None:
        path = Path(metadata_path) if metadata_path else None
        idle_after_finished = 0
        missing_since = time.monotonic()
        while self.mcp.running:
            try:
                status = None
                if path is not None and path.is_file():
                    with path.open("r", encoding="utf-8") as handle:
                        status = json.load(handle)
                elif time.monotonic() - missing_since > 20.0:
                    payload = compact_tool_payload(await self.safe_tool("melting_curve_capture_status", {}))
                    if isinstance(payload, dict):
                        status = payload.get("result") if isinstance(payload.get("result"), dict) else payload
                if isinstance(status, dict):
                    await self.emit_melting_curve_capture_events(
                        status,
                        routine_id=routine_id or str(status.get("routine_id") or ""),
                        call_event_id=call_event_id,
                        via=via,
                    )
                    if status.get("running") is False:
                        idle_after_finished += 1
                        if idle_after_finished >= 2:
                            await self.record(
                                "melting_curve_capture_finished",
                                tool="start_melting_curve_capture",
                                routine_id=routine_id or status.get("routine_id"),
                                ok=bool(status.get("ok")),
                                completed=bool(status.get("completed")),
                                completed_steps=status.get("completed_steps"),
                                requested_steps=status.get("requested_steps"),
                                output_dir=status.get("output_dir"),
                                metadata_path=status.get("metadata_path") or metadata_path,
                                parent_call_event_id=call_event_id,
                                via=via,
                            )
                            break
            except Exception as exc:
                await self.record(
                    "melting_curve_capture_monitor_error",
                    level="warning",
                    routine_id=routine_id,
                    metadata_path=metadata_path,
                    message=str(exc),
                    parent_call_event_id=call_event_id,
                    via=via,
                )
            await asyncio.sleep(1.0)

    async def emit_melting_curve_capture_events(
        self,
        status: dict[str, Any],
        routine_id: str = "",
        call_event_id: Any = None,
        via: str = "",
    ) -> None:
        results = status.get("results")
        if not isinstance(results, list):
            return
        for step in results:
            if not isinstance(step, dict):
                continue
            capture = step.get("capture")
            if not isinstance(capture, dict):
                continue
            paths = []
            if capture.get("path"):
                paths.append(capture.get("path"))
            for item in capture.get("paths_sample") or []:
                if item:
                    paths.append(item)
            for raw_path in dict.fromkeys(str(item) for item in paths if str(item or "").strip()):
                capture_key = f"{routine_id}:{raw_path}"
                if capture_key in self._melting_curve_seen_captures:
                    continue
                self._melting_curve_seen_captures.add(capture_key)
                image_path = Path(raw_path)
                captured_t = time.time()
                captured_ts = datetime.now(timezone.utc).isoformat()
                if image_path.is_file():
                    try:
                        captured_t = image_path.stat().st_mtime
                        captured_ts = datetime.fromtimestamp(captured_t, timezone.utc).isoformat()
                    except Exception:
                        pass
                capture_event = {
                    "path": raw_path,
                    "absolute_path": raw_path,
                    "mime_type": capture.get("mime_type") or "image/png",
                    "source": capture.get("source") or capture.get("capture_mode") or status.get("capture_mode"),
                    "temperature_label": capture.get("temperature_label"),
                    "target_c": step.get("target_c"),
                    "step_index": step.get("index"),
                    "output_dir": capture.get("output_dir"),
                    "metadata_path": capture.get("metadata_path") or status.get("metadata_path"),
                }
                await self.record(
                    "melting_curve_capture_photo",
                    t=captured_t,
                    ts=captured_ts,
                    tool="start_melting_curve_capture",
                    routine_id=routine_id or status.get("routine_id"),
                    step_index=step.get("index"),
                    target_c=step.get("target_c"),
                    temperature_label=capture.get("temperature_label"),
                    capture=capture_event,
                    result={"capture": capture_event},
                    parent_call_event_id=call_event_id,
                    via=via,
        )

    async def guarded_safe_tool(
        self,
        tool: str,
        arguments: dict[str, Any] | None = None,
        *,
        via: str,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        guard_result = await self.mcp_health_guard_result(tool, via=via, arguments=arguments)
        if guard_result is not None:
            return guard_result
        return await self.safe_tool(tool, arguments, timeout_seconds=timeout_seconds)

    async def call_stage_motion_tool(
        self,
        arguments: dict[str, Any],
        source: str,
        call_event_id: Any = None,
        preset_category: str = "stage",
    ) -> dict[str, Any]:
        guard_result = await self.mcp_health_guard_result("move_stage", via=source, arguments=arguments)
        if guard_result is not None:
            return guard_result
        await self.broadcast_stage_motion_start(
            arguments,
            source=source,
            call_event_id=call_event_id,
            preset_category=preset_category,
        )
        result = await self.safe_tool("move_stage", arguments)
        await self.broadcast_stage_motion_end(
            arguments,
            result=result,
            source=source,
            call_event_id=call_event_id,
            preset_category=preset_category,
        )
        return result

    def verify_droplet_ids_from_arguments(self, arguments: dict[str, Any]) -> list[int]:
        if not isinstance(arguments, dict):
            return []
        raw_ids = arguments.get("droplet_ids")
        if raw_ids is None:
            return []
        if isinstance(raw_ids, (str, int, float)):
            raw_ids = [raw_ids]
        if not isinstance(raw_ids, list):
            return []
        ids: list[int] = []
        for item in raw_ids:
            try:
                ids.append(int(item))
            except Exception:
                continue
        return ids

    def ensure_verify_droplets_save_path(
        self,
        arguments: dict[str, Any],
        source: str,
        call_event_id: Any = None,
    ) -> tuple[dict[str, Any], str | None]:
        call_arguments = dict(arguments or {})
        existing_path = str(call_arguments.get("save_frames_path") or "").strip()
        if existing_path:
            return call_arguments, None

        frame_idx = call_arguments.get("frame_idx")
        frame_label = f"frame_{frame_idx}" if frame_idx is not None else "frame_unknown"
        source_label = safe_filename(source or "verify")
        event_label = str(call_event_id).replace(".", "_") if call_event_id is not None else str(int(time.time() * 1000))
        output_dir = (
            self.recorder.run_dir
            / "artifacts"
            / "verify_droplets"
            / safe_filename(f"{source_label}_{frame_label}_{event_label}")
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        call_arguments["save_frames_path"] = str(output_dir)
        return call_arguments, str(output_dir)

    async def call_verify_droplets_observed(
        self,
        arguments: dict[str, Any],
        source: str,
        call_event_id: Any = None,
    ) -> Any:
        result, _timing = await self.call_verify_droplets_observed_timed(
            arguments,
            source=source,
            call_event_id=call_event_id,
        )
        return result

    async def call_verify_droplets_observed_timed(
        self,
        arguments: dict[str, Any],
        source: str,
        call_event_id: Any = None,
    ) -> tuple[Any, dict[str, float]]:
        arguments, auto_save_path = self.ensure_verify_droplets_save_path(
            arguments,
            source=source,
            call_event_id=call_event_id,
        )
        ids = self.verify_droplet_ids_from_arguments(arguments)
        if len(ids) <= 1:
            result, timing = await self.mcp.call_tool_timed("verify_droplets", arguments)
            await self.broadcast_verify_stage_movements(
                compact_tool_payload(result),
                source=source,
                call_event_id=call_event_id,
            )
            if ids:
                await self.refresh_live_after_stage_observation()
            payload = compact_tool_payload(result)
            if auto_save_path and isinstance(payload, dict):
                payload["dashboard_auto_save_frames_path"] = auto_save_path
                result = replace_mcp_text_payload(result, payload)
            return result, timing

        started = time.perf_counter()
        validation_results: dict[str, Any] = {}
        frame_files: dict[str, Any] = {}
        stage_movements: list[dict[str, Any]] = []
        sub_results: list[dict[str, Any]] = []
        timings: list[dict[str, float]] = []
        overall_ok = True

        for droplet_id in ids:
            sub_arguments = dict(arguments)
            sub_arguments["droplet_ids"] = [droplet_id]
            sub_result, sub_timing = await self.mcp.call_tool_timed("verify_droplets", sub_arguments)
            sub_payload = compact_tool_payload(sub_result)
            sub_ok = mcp_tool_call_succeeded(sub_result)
            overall_ok = overall_ok and sub_ok
            timings.append(sub_timing)

            step_event = await self.record(
                "verify_droplet_step",
                tool="verify_droplets",
                droplet_id=droplet_id,
                frame_idx=arguments.get("frame_idx"),
                ok=sub_ok,
                result=compact_tool_payload(sub_result),
                parent_call_event_id=call_event_id,
                via=source,
            )
            await self.broadcast_verify_stage_movements(
                sub_payload,
                source=source,
                call_event_id=call_event_id,
                step_event_id=step_event.get("t"),
            )
            await self.refresh_live_after_stage_observation()

            if isinstance(sub_payload, dict):
                extracted_validation = sub_payload.get("validation_results")
                extracted_files = sub_payload.get("frame_files")
                if extracted_validation is None and isinstance(sub_payload.get("result"), list):
                    result_list = sub_payload.get("result") or []
                    extracted_validation = result_list[0] if len(result_list) >= 1 else None
                    extracted_files = result_list[1] if len(result_list) >= 2 else extracted_files
                if isinstance(extracted_validation, dict):
                    for key, value in extracted_validation.items():
                        validation_results[str(key)] = value
                if isinstance(extracted_files, dict):
                    for key, value in extracted_files.items():
                        frame_files[str(key)] = value
                for movement in sub_payload.get("stage_movements") or []:
                    if isinstance(movement, dict):
                        stage_movements.append(movement)

            sub_results.append(
                {
                    "droplet_id": droplet_id,
                    "ok": sub_ok,
                    "payload": compact_tool_payload(sub_result),
                    "timing": sub_timing,
                }
            )

        timing = {
            "mcp_lock_wait_seconds": round(sum(item.get("mcp_lock_wait_seconds", 0.0) for item in timings), 4),
            "mcp_call_seconds": round(sum(item.get("mcp_call_seconds", 0.0) for item in timings), 4),
            "mcp_total_seconds": round(max(0.0, time.perf_counter() - started), 4),
            "dashboard_split_calls": len(sub_results),
        }
        payload = {
            "ok": overall_ok,
            "frame_idx": arguments.get("frame_idx"),
            "droplet_ids": ids,
            "validation_results": validation_results,
            "frame_files": frame_files,
            "save_frames_path": arguments.get("save_frames_path"),
            "dashboard_auto_save_frames_path": auto_save_path,
            "stage_movements": stage_movements,
            "result": [validation_results, frame_files],
            "split_by_dashboard": True,
            "sub_results": sub_results,
        }
        return payload, timing

    async def broadcast_verify_stage_movements(
        self,
        payload: Any,
        source: str,
        call_event_id: Any = None,
        step_event_id: Any = None,
    ) -> None:
        if not isinstance(payload, dict):
            return
        movements = payload.get("stage_movements")
        if not isinstance(movements, list):
            return
        for movement in movements:
            if not isinstance(movement, dict):
                continue
            actual = self.normalize_stage_position(movement.get("actual_position"))
            target = self.normalize_stage_position(movement.get("target_position")) or actual
            position = actual or target
            if not position:
                continue
            event = await self.record(
                "stage_position",
                source="verify_droplets",
                tool="verify_droplets",
                droplet_id=movement.get("droplet_id"),
                electrode_position=movement.get("electrode_position"),
                target_position=target,
                actual_position=actual,
                position=position,
                motion_complete=movement.get("motion_complete"),
                parent_call_event_id=call_event_id,
                step_event_id=step_event_id,
                via=source,
            )
            await self.broadcast_realtime_json(
                {
                    "type": "stage_motion",
                    "phase": "end",
                    "source": "verify_droplets",
                    "call_event_id": call_event_id,
                    "event_id": event.get("t"),
                    "target_position": target,
                    "actual_position": actual,
                    "position": position,
                    "ok": movement.get("motion_complete") is not False,
                }
            )

    async def refresh_live_after_stage_observation(self) -> None:
        if not self.mcp.running:
            return
        try:
            self.live = await self.collect_live_snapshot(include_state=True, include_streamer_frame=False, prefer_scene_file=True)
            await self.broadcast_live_json({"type": "live", "live": self.live})
        except Exception as exc:
            await self.record("live_poll_error", level="warning", message=f"verify_droplets live refresh failed: {exc}")

    async def broadcast_stage_motion_start(
        self,
        arguments: dict[str, Any],
        source: str,
        call_event_id: Any = None,
        preset_category: str = "stage",
    ) -> bool:
        target = self.stage_motion_target_from_arguments(arguments, preset_category=preset_category)
        if not target:
            return False
        start = self.current_stage_position()
        wait_timeout = parse_optional_float(arguments.get("wait_timeout_seconds")) if isinstance(arguments, dict) else None
        await self.broadcast_realtime_json(
            {
                "type": "stage_motion",
                "phase": "start",
                "source": source,
                "call_event_id": call_event_id,
                "start_position": start,
                "target_position": target,
                "position": target,
                "wait_timeout_seconds": wait_timeout,
                "duration_seconds": self.estimate_stage_motion_seconds(start, target, wait_timeout),
            }
        )
        return True

    async def broadcast_stage_motion_end(
        self,
        arguments: dict[str, Any],
        result: Any = None,
        source: str = "",
        call_event_id: Any = None,
        preset_category: str = "stage",
        error: str | None = None,
    ) -> None:
        target = self.stage_motion_target_from_arguments(arguments, preset_category=preset_category)
        actual = self.stage_position_from_result(result) or target
        if not actual and not error:
            return
        result_payload = compact_tool_payload(result)
        queued_only = bool(self.deep_get(result_payload, "queued_only") or self.deep_get(result_payload, "result.queued_only"))
        motion_complete = self.deep_get(result_payload, "motion_complete")
        if motion_complete is None:
            motion_complete = self.deep_get(result_payload, "result.motion_complete")
        payload: dict[str, Any] = {
            "type": "stage_motion",
            "phase": "queued" if queued_only or motion_complete is False else "end",
            "source": source,
            "call_event_id": call_event_id,
            "target_position": target,
            "actual_position": actual,
            "position": actual or target,
            "ok": not error and mcp_tool_call_succeeded(result),
        }
        if error:
            payload["error"] = error
            payload["ok"] = False
        await self.broadcast_realtime_json(payload)

    def current_stage_position(self) -> dict[str, int] | None:
        root = self.live.get("state") if isinstance(self.live, dict) else None
        state_value = self.deep_get(root, "value") or self.deep_get(root, "result.value") or root
        return self.normalize_stage_position(self.deep_get(state_value, "xy_stage.position"))

    def stage_motion_target_from_arguments(
        self,
        arguments: dict[str, Any] | None,
        preset_category: str = "stage",
    ) -> dict[str, int] | None:
        if not isinstance(arguments, dict):
            return None
        position = self.normalize_stage_position(arguments.get("position") or arguments.get("target_position"))
        if position:
            return position
        preset_name = str(arguments.get("preset") or "").strip()
        if not preset_name:
            return None
        for category in [preset_category, "stage", "imaging"]:
            if not category:
                continue
            try:
                preset, _, _ = self.load_preset(category, preset_name)
            except Exception:
                continue
            position = self.normalize_stage_position(preset.get("position") or preset.get("stage_position"))
            if position:
                return position
        return None

    def stage_position_from_result(self, result: Any) -> dict[str, int] | None:
        payload = compact_tool_payload(result)
        roots: list[Any] = [payload]
        if isinstance(payload, dict):
            roots.extend(
                item
                for item in [
                    payload.get("result"),
                    payload.get("move_stage"),
                    self.deep_get(payload, "result.result"),
                ]
                if item is not None
            )
        for root in roots:
            position = self.normalize_stage_position(
                self.deep_get(root, "actual_position")
                or self.deep_get(root, "target_position")
                or self.deep_get(root, "position")
            )
            if position:
                return position
        return None

    @staticmethod
    def normalize_stage_position(position: Any) -> dict[str, int] | None:
        if not isinstance(position, dict):
            return None
        normalized: dict[str, int] = {}
        for axis in ("X", "Y", "Z"):
            try:
                value = float(position[axis])
            except Exception:
                continue
            if value == value and value not in {float("inf"), float("-inf")}:
                normalized[axis] = int(value)
        return normalized or None

    @staticmethod
    def deep_get(root: Any, path: str) -> Any:
        current = root
        for part in path.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current

    @staticmethod
    def estimate_stage_motion_seconds(
        start: dict[str, int] | None,
        target: dict[str, int] | None,
        wait_timeout: float | None = None,
    ) -> float:
        if not start or not target:
            return 1.5
        dx = float(target.get("X", start.get("X", 0)) - start.get("X", 0))
        dy = float(target.get("Y", start.get("Y", 0)) - start.get("Y", 0))
        dz = float(target.get("Z", start.get("Z", 0)) - start.get("Z", 0))
        distance = (dx * dx + dy * dy) ** 0.5 + abs(dz) * 0.25
        seconds = distance / 35000.0 if distance > 0 else 0.35
        if wait_timeout is not None and wait_timeout > 0:
            seconds = min(seconds, wait_timeout)
        return round(max(0.35, min(seconds, 12.0)), 3)

    def dashboard_tool_timing(
        self,
        result: Any = None,
        call_event: dict[str, Any] | None = None,
        mcp_timing: dict[str, Any] | None = None,
        total_seconds: float | None = None,
    ) -> dict[str, Any]:
        timing: dict[str, Any] = {}
        if isinstance(mcp_timing, dict):
            timing.update(
                {
                    key: value
                    for key, value in mcp_timing.items()
                    if key.endswith("_seconds") and isinstance(value, (int, float))
                }
            )
        if total_seconds is not None:
            timing["tool_total_seconds"] = round(max(0.0, float(total_seconds)), 4)
        queue_timing = self.stage_queue_timing_from_result(result, call_event)
        if queue_timing:
            timing.update(queue_timing)
        return timing

    def stage_queue_timing_from_result(
        self,
        result: Any,
        call_event: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = compact_tool_payload(result)
        queue_wait = self.deep_get(payload, "queue_wait") or self.deep_get(payload, "result.queue_wait")
        high_queue = self.deep_get(queue_wait, "queues.HIGH")
        last_command = self.deep_get(high_queue, "last_command")
        if not isinstance(last_command, dict):
            return {}
        path = str(last_command.get("path") or "")
        if not path.startswith("xy_stage.position"):
            return {}
        queued_at = parse_optional_float(last_command.get("queued_at"))
        processed_at = parse_optional_float(last_command.get("processed_at"))
        call_at = parse_optional_float((call_event or {}).get("t"))
        now = time.time()
        timing: dict[str, Any] = {"stage_queue_path": path}
        if queued_at is not None and call_at is not None:
            timing["stage_call_to_queue_seconds"] = round(max(0.0, queued_at - call_at), 4)
        if queued_at is not None and processed_at is not None:
            timing["stage_queue_processing_seconds"] = round(max(0.0, processed_at - queued_at), 4)
        if processed_at is not None:
            timing["stage_queue_to_result_seconds"] = round(max(0.0, now - processed_at), 4)
        return timing

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
            self._client_send_locks.pop(websocket, None)

    async def handle_live_ws(self, websocket: Any) -> None:
        self.live_clients.add(websocket)
        try:
            if self.live:
                await self.safe_send(websocket, {"type": "live", "live": self.live})
            async for raw in websocket:
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if message.get("type") == "get_live" and self.live:
                    await self.safe_send(websocket, {"type": "live", "live": self.live})
        finally:
            self.live_clients.discard(websocket)
            self._client_send_locks.pop(websocket, None)

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
            await self.stop_timeline_for_new_run()
            await self.broadcast_run_loaded()
            return

        if msg_type == "select_run":
            run_id = str(message.get("run_id", "")).strip()
            self.recorder = self.recorder.open_run(run_id)
            self.now = f"Loaded run {run_id}"
            await self.broadcast_run_loaded()
            return

        if msg_type == "load_older_events":
            run_id = str(message.get("run_id") or self.recorder.run_id).strip()
            if run_id != self.recorder.run_id:
                raise ValueError("Can only page events for the active run.")
            before_t = parse_optional_float(message.get("before_t"))
            limit = int(message.get("limit") or RUN_EVENT_OLDER_LIMIT)
            window = self.recorder.event_window_for_run(
                run_id,
                before_t=before_t,
                limit=limit,
                omit_types=FRONTEND_OMITTED_EVENT_TYPES,
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "older_events",
                        "run_id": run_id,
                        "events": window["events"],
                        "event_window": window["meta"],
                    },
                    ensure_ascii=True,
                )
            )
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

        if msg_type == "presets_get":
            await websocket.send(json.dumps({"type": "presets_state", "presets": self.presets_state()}, ensure_ascii=True))
            return

        if msg_type == "preset_save":
            result = self.save_preset(
                category=str(message.get("category") or "").strip(),
                name=str(message.get("name") or "").strip(),
                value=message.get("value"),
                original_category=str(message.get("original_category") or "").strip(),
                original_name=str(message.get("original_name") or "").strip(),
            )
            await self.record(
                "preset_saved",
                category=result.get("category"),
                name=result.get("name"),
                config_path=result.get("config_path"),
            )
            await websocket.send(json.dumps({"type": "preset_save_result", "result": result}, ensure_ascii=True))
            await websocket.send(json.dumps({"type": "presets_state", "presets": self.presets_state()}, ensure_ascii=True))
            return

        if msg_type == "preset_apply":
            category = str(message.get("category") or "").strip()
            name = str(message.get("name") or "").strip()
            try:
                result = await self.apply_preset(category, name)
                level = None
            except Exception as exc:
                result = {
                    "ok": False,
                    "category": category,
                    "name": name,
                    "error": str(exc),
                }
                level = "error"
            event_fields = {
                "category": category,
                "name": name,
                "result": compact_tool_payload(result),
            }
            if level:
                event_fields["level"] = level
            await self.record("preset_applied", **event_fields)
            await websocket.send(json.dumps({"type": "preset_apply_result", "result": result}, ensure_ascii=True))
            if self.mcp.running and result.get("ok") is not False:
                self.live = await self.collect_live_snapshot(include_state=True)
                await self.broadcast_live_json({"type": "live", "live": self.live})
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "reveal_artifact":
            result = self.reveal_run_artifact(
                run_id=str(message.get("run_id") or self.recorder.run_id).strip(),
                path_value=str(message.get("path") or "").strip(),
                absolute_path_value=str(message.get("absolute_path") or "").strip(),
            )
            await websocket.send(json.dumps({"type": "artifact_reveal_result", "result": result}, ensure_ascii=True))
            return

        if msg_type == "mcp_tool":
            tool = str(message.get("tool", "")).strip()
            arguments = message.get("arguments") or {}
            actual_tool = tool
            actual_arguments = arguments
            routed_tool = False
            if tool == "temperature_hold" and self.should_background_temperature_hold(arguments):
                actual_tool = "start_temperature_routine"
                actual_arguments = self.temperature_hold_as_routine_arguments(arguments)
                routed_tool = True
            event = await self.record(
                "mcp_tool_call",
                tool=tool,
                arguments=arguments,
                via="dashboard_user",
                called_by_user=True,
                tool_invocation_origin="dashboard_user",
                **(
                    {
                        "dashboard_actual_tool": actual_tool,
                        "dashboard_actual_arguments": actual_arguments,
                    }
                    if routed_tool
                    else {}
                ),
            )
            stage_motion_invoked = False
            try:
                mcp_auto_started = await self.ensure_mcp_started_for_tool(
                    via="dashboard_user",
                    tool=actual_tool,
                )
                if mcp_auto_started and actual_tool in MCP_STATEFUL_EXECUTION_TOOLS:
                    result = self.mcp_runtime_restarted_result(actual_tool, via="dashboard_user")
                    mcp_timing = {}
                else:
                    guard_result = await self.mcp_health_guard_result(
                        actual_tool,
                        via="dashboard_user",
                        arguments=actual_arguments,
                    )
                    if guard_result is not None:
                        result = guard_result
                        mcp_timing = {}
                    else:
                        if actual_tool == "move_stage":
                            await self.broadcast_stage_motion_start(
                                actual_arguments,
                                source="dashboard_user",
                                call_event_id=event.get("t"),
                            )
                            stage_motion_invoked = True
                        if actual_tool == "verify_droplets":
                            result, mcp_timing = await self.call_verify_droplets_observed_timed(
                                actual_arguments,
                                source="dashboard_user",
                                call_event_id=event.get("t"),
                            )
                        else:
                            result, mcp_timing = await self.mcp.call_tool_timed(
                                actual_tool,
                                actual_arguments,
                                read_timeout_seconds=self.dashboard_user_tool_timeout_seconds(
                                    actual_tool,
                                    actual_arguments,
                                ),
                            )
                    if routed_tool:
                        result = self.annotate_routed_tool_result(result, tool, actual_tool)
                result = mark_failed_mcp_payload(result)
                if actual_tool == "move_stage" and stage_motion_invoked:
                    await self.broadcast_stage_motion_end(
                        actual_arguments,
                        result=result,
                        source="dashboard_user",
                        call_event_id=event.get("t"),
                    )
                event_result, _, _ = self.prepare_visual_tool_result_for_model(
                    actual_tool,
                    actual_arguments,
                    result,
                    attach_for_model=False,
                )
                ok = mcp_tool_call_succeeded(result)
                dashboard_timing = self.dashboard_tool_timing(
                    result=result,
                    call_event=event,
                    mcp_timing=mcp_timing,
                )
                result_fields = {
                    "tool": tool,
                    "ok": ok,
                    "result": event_result,
                    "call_event_id": event.get("t"),
                    "via": "dashboard_user",
                    "called_by_user": True,
                    "tool_invocation_origin": "dashboard_user",
                    **(
                        {
                            "dashboard_actual_tool": actual_tool,
                            "dashboard_actual_arguments": actual_arguments,
                        }
                        if routed_tool
                        else {}
                    ),
                    **tool_context_metrics(event_result),
                }
                if dashboard_timing:
                    result_fields["dashboard_timing"] = dashboard_timing
                result_event = await self.record(
                    "mcp_tool_result",
                    **result_fields,
                )
                self.maybe_start_melting_curve_monitor(
                    actual_tool,
                    result,
                    event_result,
                    call_event_id=event.get("t"),
                    via="dashboard_user",
                )
                await websocket.send(
                    json.dumps({"type": "tool_result", "event": result_event, "result": event_result})
                )
            except Exception as exc:
                if actual_tool == "move_stage" and stage_motion_invoked:
                    await self.broadcast_stage_motion_end(
                        actual_arguments,
                        source="dashboard_user",
                        call_event_id=event.get("t"),
                        error=str(exc),
                    )
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
                    **(
                        {
                            "dashboard_actual_tool": actual_tool,
                            "dashboard_actual_arguments": actual_arguments,
                        }
                        if routed_tool
                        else {}
                    ),
                )
                await websocket.send(
                    json.dumps({"type": "tool_result", "event": result_event, "result": {"error": str(exc)}})
                )
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "transcribe_audio":
            await self.handle_transcribe_audio(websocket, message)
            return

        if msg_type == "load_audio_model":
            await self.handle_load_audio_model(websocket, message)
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
            frame_meta = payload if isinstance(payload, dict) else {}
            await self.record(
                "visualizer_frame_downloaded",
                visualizer=visualizer,
                frame_source=frame_source,
                frame={
                    key: value
                    for key, value in frame_meta.items()
                    if key in {"visualizer", "frame_source", "format", "mime_type", "shape", "timestamp", "path"}
                },
            )
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
            restore_result = None
            if self.calibration is not None and self.mcp.running:
                previous_motion_params = self.calibration.previous_motion_params
                await self.guarded_safe_tool("calibration_stage_jog", {"stop_all": True}, via="calibration")
                if previous_motion_params:
                    restore_result = compact_tool_payload(
                        await self.guarded_safe_tool(
                            "set_stage_motion_params",
                            previous_motion_params,
                            via="calibration",
                        )
                    )
                    if isinstance(restore_result, dict) and restore_result.get("ok") is False:
                        fallback_result = compact_tool_payload(
                            await self.guarded_safe_tool(
                                "set_stage_motion_speed",
                                {"speed_key": "standard"},
                                via="calibration",
                            )
                        )
                        restore_result = {
                            "motion_params_restore": restore_result,
                            "fallback_restore": fallback_result,
                        }
                else:
                    restore_result = compact_tool_payload(
                        await self.guarded_safe_tool(
                            "set_stage_motion_speed",
                            {"speed_key": "standard"},
                            via="calibration",
                        )
                    )
            self.calibration = None
            self.streamer_frame_options = {"max_width": 720, "max_height": 460}
            self.now = "Calibration closed"
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_state",
                        "calibration": {"active": False},
                        "speed_restore_result": restore_result,
                    },
                    ensure_ascii=True,
                )
            )
            if self.mcp.running:
                self.live = await self.collect_live_snapshot(include_state=True)
                await self.broadcast_live_json({"type": "live", "live": self.live})
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        if msg_type == "calibration_set_speed":
            if self.calibration is None:
                raise RuntimeError("No calibration session is active.")
            speed_key = str(message.get("speed_key") or "2")
            self.calibration.set_speed(speed_key)
            result = compact_tool_payload(
                await self.guarded_safe_tool(
                    "calibration_stage_set_speed",
                    {"speed_key": self.calibration.speed_key},
                    via="calibration",
                )
            )
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_state",
                        "calibration": self.calibration.state(),
                        "speed_result": result,
                    },
                    ensure_ascii=True,
                )
            )
            return

        if msg_type == "calibration_jog":
            if self.calibration is None:
                raise RuntimeError("No calibration session is active.")
            arguments = {
                "axis": message.get("axis"),
                "direction": int(message.get("direction") or 0),
                "stop_all": bool(message.get("stop_all", False)),
            }
            result = compact_tool_payload(
                await self.guarded_safe_tool("calibration_stage_jog", arguments, via="calibration")
            )
            position = result.get("position") if isinstance(result, dict) else None
            if position:
                self.calibration.status_message = f"Adjusting {self.calibration.current_step['label']}" if self.calibration.current_step else "Adjusting"
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_jog_result",
                        "result": result,
                        "position": position,
                    },
                    ensure_ascii=True,
                )
            )
            return

        if msg_type == "calibration_move_stage":
            if self.calibration is None:
                raise RuntimeError("No calibration session is active.")
            position = message.get("position") or {}
            result = compact_tool_payload(
                await self.call_stage_motion_tool(
                    {
                        "position": position,
                        "wait_timeout_seconds": float(message.get("wait_timeout_seconds") or 1.2),
                        "poll_interval": 0.05,
                        "wait_for_queue": False,
                        "wait_for_completion": False,
                    },
                    source="calibration",
                )
            )
            move_failed = isinstance(result, dict) and (result.get("ok") is False or result.get("error"))
            response_position = None
            if isinstance(result, dict):
                response_position = result.get("actual_position") or result.get("position")
                if not move_failed:
                    response_position = response_position or result.get("target_position") or position
            elif not move_failed:
                response_position = position
            await websocket.send(
                json.dumps(
                    {
                        "type": "calibration_move_result",
                        "result": result,
                        "position": response_position,
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
            await self.guarded_safe_tool("calibration_stage_jog", {"stop_all": True}, via="calibration")
            fresh_position = compact_tool_payload(await self.safe_tool("calibration_stage_position"))
            position = (
                fresh_position.get("position")
                if isinstance(fresh_position, dict) and fresh_position.get("position")
                else message.get("position") or {}
            )
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
            raw_result = mark_failed_mcp_payload(
                await self.guarded_safe_tool("set_matrix_cells", arguments, via="dashboard_matrix")
            )
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
                await self.broadcast_live_json({"type": "live", "live": live})
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
                await self.broadcast_live_json({"type": "live", "live": live})
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
                            "background": True,
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
                await self.broadcast_live_json({"type": "live", "live": live})
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
                            "background": True,
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
                await self.broadcast_live_json({"type": "live", "live": live})
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
                await self.broadcast_live_json({"type": "live", "live": live})
            return

        if msg_type == "set_streamer_view":
            if message.get("full_resolution"):
                self.streamer_frame_options = {"full_resolution": True}
            else:
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

        if msg_type == "queue_agent":
            requested_run_id = str(message.get("run_id", "")).strip()
            prompt = str(message.get("prompt", "")).strip()
            await self.queue_agent_prompt(websocket, prompt, requested_run_id=requested_run_id)
            return

        if msg_type in {"stop_agent", "cancel_agent"}:
            await self.cancel_agent("Cancelled by user")
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
            return

        await self.record("unknown_message", level="warning", message=message)

    async def start_calibration_session(self, websocket: Any) -> None:
        self.calibration = DashboardCalibrationSession()
        self.streamer_frame_options = {"full_resolution": True}
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

        runtime_status = compact_tool_payload(await self.safe_tool("runtime_status", {"detail": "compact"}))
        system_loaded = bool(
            isinstance(runtime_status, dict)
            and (
                runtime_status.get("system", {}).get("loaded")
                or runtime_status.get("loaded")
                or runtime_status.get("system_loaded")
            )
        )
        load_result = None
        if not system_loaded:
            load_result = compact_tool_payload(await self.safe_tool("load_system", {"system": "boxmini"}))
        if self.calibration is not None:
            self.calibration.set_previous_motion_params(await self.read_stage_motion_params())

        prepare_result = await self.guarded_safe_tool(
            "configure_microscope_imaging",
            {
                "channel": "Brightfield",
                "exposure_time": 16000,
                "gain": 0,
                "coaxial_intensity": 10,
                "ring_intensity": 0,
                "auto_exposure": False,
                "restart_streamer": True,
                "bring_to_front": False,
                "stabilization_wait": 0.2,
                "queue_timeout_seconds": 10,
            },
            via="calibration",
        )
        streamer_result = compact_tool_payload(
            await self.guarded_safe_tool(
                "set_streamer_source",
                {
                    "source": "microscope",
                    "electrode_overlay": True,
                    "coordinates": True,
                    "bring_to_front": False,
                },
                via="calibration",
            )
        )
        speed_result = compact_tool_payload(
            await self.guarded_safe_tool(
                "calibration_stage_set_speed",
                {"speed_key": self.calibration.speed_key},
                via="calibration",
            )
        )
        if isinstance(prepare_result, dict) and prepare_result.get("ok") is False:
            self.calibration.status_message = "Preparation error"
            state = self.calibration.state(error=str(prepare_result.get("error") or prepare_result))
        else:
            state = self.calibration.state()
            try:
                move = await self.move_calibration_to_current_target(wait_timeout_seconds=20)
                state = self.calibration.state(position=move.get("position"))
            except Exception as exc:
                self.calibration.status_message = f"Target move failed: {exc}"
                state = self.calibration.state(error=str(exc))
        await websocket.send(
            json.dumps(
                {
                    "type": "calibration_state",
                    "calibration": state,
                    "load_result": load_result,
                    "prepare_result": compact_tool_payload(prepare_result),
                    "streamer_result": streamer_result,
                    "speed_result": speed_result,
                },
                ensure_ascii=True,
            )
        )
        if self.mcp.running:
            live = await self.collect_live_snapshot(include_state=True)
            self.live = live
            await self.broadcast_live_json({"type": "live", "live": live})
        await websocket.send(json.dumps({"type": "status", "status": self.status()}))

    async def read_stage_motion_params(self) -> dict[str, float] | None:
        payload = compact_tool_payload(await self.safe_tool("stage_motion_params", {}))
        params = self.normalize_stage_motion_params(payload)
        if params:
            return params

        fallback = compact_tool_payload(
            await self.safe_tool("state_summary", {"path": "xy_stage.motion_params"})
        )
        return self.normalize_stage_motion_params(fallback)

    @staticmethod
    def normalize_stage_motion_params(payload: Any) -> dict[str, float] | None:
        roots: list[Any] = [payload]
        if isinstance(payload, dict):
            roots.extend(
                [
                    payload.get("motion_params"),
                    payload.get("value"),
                    payload.get("result"),
                ]
            )
        for root in roots:
            if not isinstance(root, dict):
                continue
            velocity = positive_float_or_none(root.get("velocity") or root.get("dMaxV"))
            acceleration = positive_float_or_none(root.get("acceleration") or root.get("dMaxA"))
            if velocity is not None and acceleration is not None:
                return {
                    "velocity": velocity,
                    "acceleration": acceleration,
                }
        return None

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

        arguments = {
            "position": target,
            "speed_key": self.calibration.speed_key,
            "wait_timeout_seconds": wait_timeout_seconds,
            "poll_interval": 0.05,
        }
        guard_result = await self.mcp_health_guard_result(
            "calibration_stage_move_to_target",
            via="calibration_target",
            arguments=arguments,
        )
        if guard_result is not None:
            self.calibration.status_message = "Target move blocked"
            return {"result": compact_tool_payload(guard_result), "position": None}
        await self.broadcast_stage_motion_start(
            arguments,
            source="calibration_target",
        )
        result = compact_tool_payload(
            await self.safe_tool("calibration_stage_move_to_target", arguments)
        )
        await self.broadcast_stage_motion_end(
            arguments,
            result=result,
            source="calibration_target",
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

    def presets_state(self) -> dict[str, Any]:
        config_path = resolve_config_path()
        try:
            data = load_droplogic_config(config_path)
        except Exception as exc:
            return {
                "ok": False,
                "config_path": str(config_path),
                "presets": {},
                "error": str(exc),
            }
        presets = data.get("presets") if isinstance(data, dict) else {}
        if not isinstance(presets, dict):
            presets = {}
        presets = self.presets_with_defaults(data, presets)
        categories = []
        for category, entries in presets.items():
            if not isinstance(entries, dict):
                continue
            categories.append(
                {
                    "name": str(category),
                    "label": self.preset_category_label(category),
                    "count": len(entries),
                }
            )
        return {
            "ok": True,
            "config_path": str(config_path),
            "presets": presets,
            "categories": categories,
        }

    def presets_with_defaults(self, data: dict[str, Any], presets: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(presets)
        imaging = normalized.get("imaging")
        if not isinstance(imaging, dict):
            imaging = {}
        else:
            imaging = dict(imaging)
        for channel in self.microscope_preset_channels(data):
            key = f"microscope_{self.preset_slug(channel)}"
            imaging.setdefault(key, self.default_microscope_preset(data, channel))
        if imaging:
            normalized["imaging"] = imaging
        return normalized

    @staticmethod
    def microscope_preset_channels(data: dict[str, Any]) -> list[str]:
        settings = data.get("microscope_settings") if isinstance(data, dict) else {}
        channels = settings.get("total_channels") if isinstance(settings, dict) else []
        if not isinstance(channels, list):
            channels = []
        seen: set[str] = set()
        result: list[str] = []
        for channel in channels:
            name = str(channel or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            result.append(name)
        return result

    @staticmethod
    def default_microscope_preset(data: dict[str, Any], channel: str) -> dict[str, Any]:
        microscope = data.get("microscope_settings") if isinstance(data, dict) else {}
        light = data.get("light_settings") if isinstance(data, dict) else {}
        microscope = microscope if isinstance(microscope, dict) else {}
        light = light if isinstance(light, dict) else {}
        return {
            "streamer_source": "microscope",
            "channel": channel,
            "microscope_settings": {
                "auto_exposure": bool(microscope.get("auto_exposure", False)),
                "exposure_time": int(microscope.get("exposure_time", 12000) or 12000),
                "gain": int(microscope.get("gain", 0) or 0),
            },
            "light_settings": {
                "coaxial_intensity": int(light.get("coaxial_intensity", 30) or 30),
                "ring_intensity": int(light.get("ring_intensity", 0) or 0),
            },
            "notes": f"Microscope {channel} inspection preset.",
        }

    def save_preset(
        self,
        category: str,
        name: str,
        value: Any,
        original_category: str = "",
        original_name: str = "",
    ) -> dict[str, Any]:
        category = self.normalize_preset_key(category, "category")
        name = self.normalize_preset_key(name, "name")
        if not isinstance(value, dict):
            raise ValueError("Preset value must be a JSON object.")

        config_path = resolve_config_path()
        data = load_droplogic_config(config_path)
        presets = data.setdefault("presets", {})
        if not isinstance(presets, dict):
            presets = {}
            data["presets"] = presets

        original_category = str(original_category or "").strip()
        original_name = str(original_name or "").strip()
        if original_category and original_name and (original_category != category or original_name != name):
            old_entries = presets.get(original_category)
            if isinstance(old_entries, dict):
                old_entries.pop(original_name, None)

        entries = presets.setdefault(category, {})
        if not isinstance(entries, dict):
            entries = {}
            presets[category] = entries
        entries[name] = value
        save_droplogic_config(config_path, data)
        return {
            "ok": True,
            "category": category,
            "name": name,
            "config_path": str(config_path),
        }

    @staticmethod
    def normalize_preset_key(value: str, label: str) -> str:
        key = str(value or "").strip()
        if not key:
            raise ValueError(f"Preset {label} cannot be empty.")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", key):
            raise ValueError(f"Preset {label} may only contain letters, numbers, dot, dash, and underscore.")
        return key

    @staticmethod
    def preset_category_label(category: Any) -> str:
        text = str(category or "Presets").replace("_", " ").replace("-", " ").strip()
        return text[:1].upper() + text[1:] if text else "Presets"

    @staticmethod
    def preset_slug(value: Any) -> str:
        text = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "").strip()).strip("_.-")
        return text.lower() or "preset"

    def load_preset(self, category: str, name: str) -> tuple[dict[str, Any], dict[str, Any], str]:
        state = self.presets_state()
        if not state.get("ok"):
            raise RuntimeError(str(state.get("error") or "Could not load presets."))
        presets = state.get("presets") or {}
        entries = presets.get(category)
        if not isinstance(entries, dict) or name not in entries:
            raise ValueError(f"Preset not found: {category}.{name}")
        preset = entries[name]
        if not isinstance(preset, dict):
            raise ValueError(f"Preset {category}.{name} is not a JSON object.")
        return preset, state, str(state.get("config_path") or "")

    async def apply_preset(self, category: str, name: str) -> dict[str, Any]:
        category = self.normalize_preset_key(category, "category")
        name = self.normalize_preset_key(name, "name")
        preset, _, config_path = self.load_preset(category, name)
        if not self.mcp.running:
            await self.mcp.start()
            self.ensure_live_polling()

        actions: list[dict[str, Any]] = []
        position = preset.get("position")
        if category == "stage":
            result = await self.call_stage_motion_tool(
                {"preset": name, "wait_timeout_seconds": 20.0, "poll_interval": 0.1},
                source="preset.stage",
                preset_category="stage",
            )
            actions.append({"tool": "move_stage", "arguments": {"preset": name}, "result": compact_tool_payload(result)})
        elif category == "imaging":
            streamer_source = str(preset.get("streamer_source") or "microscope").lower()
            if isinstance(position, dict):
                result = await self.call_stage_motion_tool(
                    {"position": position, "wait_timeout_seconds": 20.0, "poll_interval": 0.1},
                    source="preset.imaging",
                    preset_category="imaging",
                )
                actions.append({"tool": "move_stage", "arguments": {"position": position}, "result": compact_tool_payload(result)})
            camera_settings = preset.get("camera_settings")
            microscope_settings = preset.get("microscope_settings")
            light_settings = preset.get("light_settings") if isinstance(preset.get("light_settings"), dict) else {}
            if streamer_source == "camera" or isinstance(camera_settings, dict):
                camera_settings = camera_settings if isinstance(camera_settings, dict) else {}
                streamer_args = {
                    "source": "camera",
                    "electrode_overlay": False,
                    "bring_to_front": False,
                }
                result = await self.guarded_safe_tool(
                    "set_streamer_source",
                    streamer_args,
                    via="preset.imaging",
                )
                actions.append({"tool": "set_streamer_source", "arguments": streamer_args, "result": compact_tool_payload(result)})
                args = {
                    "exposure_time": int(camera_settings.get("exposure_time", 72000)),
                    "gain": int(camera_settings.get("gain", 0)),
                    "auto_exposure": bool(camera_settings.get("auto_exposure", False)),
                    "queue_timeout_seconds": 10.0,
                }
                result = await self.guarded_safe_tool(
                    "configure_camera_imaging",
                    args,
                    via="preset.imaging",
                )
                actions.append({"tool": "configure_camera_imaging", "arguments": args, "result": compact_tool_payload(result)})
                if light_settings:
                    light_args = self.light_args_from_preset(light_settings)
                    result = await self.guarded_safe_tool(
                        "set_light_state",
                        light_args,
                        via="preset.imaging",
                    )
                    actions.append({"tool": "set_light_state", "arguments": light_args, "result": compact_tool_payload(result)})
                result = await self.guarded_safe_tool(
                    "start_visualizer",
                    {"visualizer": "streamer"},
                    via="preset.imaging",
                )
                actions.append({"tool": "start_visualizer", "arguments": {"visualizer": "streamer"}, "result": compact_tool_payload(result)})
            else:
                microscope_settings = microscope_settings if isinstance(microscope_settings, dict) else {}
                args = {
                    "channel": str(preset.get("channel") or microscope_settings.get("current_channel") or "Brightfield"),
                    "exposure_time": int(microscope_settings.get("exposure_time", preset.get("exposure_time", 72000))),
                    "gain": int(microscope_settings.get("gain", preset.get("gain", 0))),
                    "coaxial_intensity": int(light_settings.get("coaxial_intensity", preset.get("coaxial_intensity", 4))),
                    "ring_intensity": int(light_settings.get("ring_intensity", preset.get("ring_intensity", 0))),
                    "auto_exposure": bool(microscope_settings.get("auto_exposure", preset.get("auto_exposure", False))),
                    "restart_streamer": True,
                    "bring_to_front": False,
                    "stabilization_wait": 0.2,
                    "queue_timeout_seconds": 10.0,
                }
                result = await self.guarded_safe_tool(
                    "configure_microscope_imaging",
                    args,
                    via="preset.imaging",
                )
                actions.append({"tool": "configure_microscope_imaging", "arguments": args, "result": compact_tool_payload(result)})
        else:
            return {
                "ok": False,
                "category": category,
                "name": name,
                "config_path": config_path,
                "error": f"Preset category '{category}' can be saved but cannot be applied yet.",
            }

        ok = all(mcp_tool_call_succeeded(action.get("result")) for action in actions)
        return {
            "ok": ok,
            "category": category,
            "name": name,
            "config_path": config_path,
            "preset": preset,
            "actions": actions,
        }

    @staticmethod
    def light_args_from_preset(light_settings: dict[str, Any]) -> dict[str, Any]:
        coaxial = light_settings.get("coaxial_intensity")
        ring = light_settings.get("ring_intensity")
        light_on = light_settings.get("light_on")
        if light_on is None and (int(coaxial or 0) > 0 or int(ring or 0) > 0):
            light_on = True
        args = {
            "coaxial_intensity": int(coaxial or 0),
            "ring_intensity": int(ring or 0),
            "wait_for_queue": True,
            "queue_timeout_seconds": 10.0,
        }
        if light_on is not None:
            args["light_on"] = bool(light_on)
        return args

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
                "If `timeline_status()` shows the logical timeline paused and `system_loaded` is not false, call `resume_timeline(reason=...)` once before beginning active work. If `system_loaded=false`, load the DropLogic system first; the timeline is intentionally off while no system exists.",
                "Before acting on hardware, refresh live state with `execution_status_summary()` unless a fresher tool result already proves the needed state.",
                "For multi-step goals, verify every requested stage. A partial run is not complete if any requested branch, routing, execution, cleanup, or final state is missing.",
                "Do not count a planned-but-unexecuted segment as completed hardware work. Do not count a tool result with `ok=false`, `primitive_validation.ok=false`, `move_validation.ok=false`, or `planning_success=false` as successful progress.",
                "Before marking the goal complete, call `pause_timeline(reason=...)` unless hardware execution is still running. This records the idle gap before the next goal without adding plan frames.",
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
                    "and when no required work remains. Pause the timeline first when available. Do not call for partial completion."
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

    async def stop_timeline_for_new_run(self) -> None:
        if not self.mcp.running:
            await self.record(
                "timeline_default_off",
                reason="mcp_not_running",
                system_loaded=False,
                source="dashboard_run_start",
            )
            return

        status = compact_tool_payload(await self.safe_tool("timeline_status", {}))
        if isinstance(status, dict) and status.get("system_loaded") is False:
            await self.record(
                "timeline_default_off",
                reason=status.get("reason") or "no_system_loaded",
                system_loaded=False,
                source="dashboard_run_start",
                status=status,
            )
            return

        result = compact_tool_payload(
            await self.safe_tool(
                "pause_timeline",
                {"reason": "New dashboard run started; waiting for active work."},
            )
        )
        await self.record(
            "timeline_default_off",
            reason="new_run_started",
            system_loaded=True,
            source="dashboard_run_start",
            status=status if isinstance(status, dict) else None,
            result=result if isinstance(result, dict) else None,
            ok=not (isinstance(result, dict) and result.get("ok") is False),
        )

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
        await self.safe_send(websocket, {"type": "status", "status": self.status()})

    async def queue_agent_prompt(self, websocket: Any, prompt: str, requested_run_id: str = "") -> None:
        if not prompt:
            return
        run_id = requested_run_id or self.recorder.run_id
        if self._agent_task is None or self._agent_task.done():
            if run_id and run_id != self.recorder.run_id:
                self.recorder = self.recorder.open_run(run_id)
                self.now = f"Loaded run {run_id}"
                await self.broadcast_run_loaded()
            await self.start_agent_task(websocket, prompt, event_type="agent_prompt")
            return

        self._agent_queue.append(
            {
                "websocket": websocket,
                "prompt": prompt,
                "event_type": "agent_prompt",
                "run_id": run_id,
            }
        )
        await self.record(
            "agent_queued",
            prompt=prompt,
            queued_run_id=run_id,
            queue_length=len(self._agent_queue),
        )
        await self.broadcast_json({"type": "status", "status": self.status()})

    async def start_next_queued_agent_prompt(self) -> bool:
        while self._agent_queue:
            queued = self._agent_queue.pop(0)
            prompt = str(queued.get("prompt") or "").strip()
            if not prompt:
                continue
            run_id = str(queued.get("run_id") or "").strip()
            if run_id and run_id != self.recorder.run_id:
                self.recorder = self.recorder.open_run(run_id)
                self.now = f"Loaded run {run_id}"
                await self.broadcast_run_loaded()
            await self.record(
                "agent_dequeued",
                prompt=prompt,
                queued_run_id=run_id or self.recorder.run_id,
                queue_length=len(self._agent_queue),
            )
            self._agent_task = asyncio.create_task(
                self.run_agent_prompt(
                    queued.get("websocket"),
                    prompt,
                    str(queued.get("event_type") or "agent_prompt"),
                )
            )
            return True
        return False

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
            await self.ensure_mcp_started_for_tool(via="agent", tool="list_tools")
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
                stage_motion_invoked = False
                try:
                    tool_started = time.monotonic()
                    mcp_auto_started = await self.ensure_mcp_started_for_tool(
                        via="agent",
                        tool=tool,
                    )
                    if mcp_auto_started and tool in MCP_STATEFUL_EXECUTION_TOOLS:
                        result = self.mcp_runtime_restarted_result(tool, via="agent")
                    else:
                        guard_result = await self.mcp_health_guard_result(
                            tool,
                            via="agent",
                            arguments=call_arguments,
                        )
                        if guard_result is not None:
                            result = guard_result
                        else:
                            if tool == "move_stage":
                                await self.broadcast_stage_motion_start(
                                    call_arguments,
                                    source="agent",
                                    call_event_id=call_event.get("t"),
                                )
                                stage_motion_invoked = True
                            if tool == "verify_droplets":
                                result = await self.call_verify_droplets_observed(
                                    call_arguments,
                                    source="agent",
                                    call_event_id=call_event.get("t"),
                                )
                            else:
                                result = await self.call_agent_mcp_tool(tool, call_arguments)
                    tool_total_seconds = time.monotonic() - tool_started
                    result = mark_failed_mcp_payload(result)
                    if tool == "move_stage" and stage_motion_invoked:
                        await self.broadcast_stage_motion_end(
                            call_arguments,
                            result=result,
                            source="agent",
                            call_event_id=call_event.get("t"),
                        )
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
                    dashboard_timing = self.dashboard_tool_timing(
                        result=result,
                        call_event=call_event,
                        total_seconds=tool_total_seconds,
                    )
                    if dashboard_timing:
                        result_fields["dashboard_timing"] = dashboard_timing
                    if attachment_details:
                        result_fields["model_attachments"] = attachment_details
                        result_fields.update(tool_attachment_metrics(attachment_details))
                    result_event = await self.record(
                        "mcp_tool_result",
                        **result_fields,
                    )
                    self.maybe_start_melting_curve_monitor(
                        tool,
                        result,
                        event_result,
                        call_event_id=call_event.get("t"),
                        via="agent",
                    )
                    return model_result
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    if tool == "move_stage" and stage_motion_invoked:
                        await self.broadcast_stage_motion_end(
                            call_arguments,
                            source="agent",
                            call_event_id=call_event.get("t"),
                            error=str(exc),
                        )
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

            goal = self.goal_status()
            pinned_context, pinned_context_metadata = self.load_pinned_context()
            guide_selection = await self.select_turn_guide_shards(
                prompt,
                goal,
                model_context.events,
                logged_provider_retry,
                logged_context_compaction,
            )
            guide_context, guide_metadata = self.load_turn_guide_expansions(guide_selection.get("paths") or [])
            if guide_context:
                pinned_context = f"{pinned_context}\n\n{guide_context}" if pinned_context else guide_context
            await self.record(
                "guide_context_selected",
                message=(
                    "Turn-scoped detailed guide shards selected before the agent call. "
                    "These guide expansions are not retained across future turns."
                ),
                selected_paths=guide_selection.get("paths") or [],
                selector_reason=guide_selection.get("reason"),
                selector_error=guide_selection.get("error"),
                catalog_count=guide_selection.get("catalog_count"),
                **guide_metadata,
            )
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
                await self.start_next_queued_agent_prompt()
                await self.broadcast_json({"type": "status", "status": self.status()})

    async def call_agent_mcp_tool(self, tool: str, call_arguments: dict[str, Any]) -> Any:
        mcp_auto_started = await self.ensure_mcp_started_for_tool(via="agent", tool=tool)
        if mcp_auto_started and tool in MCP_STATEFUL_EXECUTION_TOOLS:
            return self.mcp_runtime_restarted_result(tool, via="agent")

        if tool == "temperature_hold" and self.should_background_temperature_hold(call_arguments):
            actual_tool = "start_temperature_routine"
            actual_arguments = self.temperature_hold_as_routine_arguments(call_arguments)
            result = await self.mcp.call_tool(
                actual_tool,
                actual_arguments,
                read_timeout_seconds=self.dashboard_user_tool_timeout_seconds(
                    actual_tool,
                    actual_arguments,
                ),
            )
            return self.annotate_routed_tool_result(result, tool, actual_tool)

        if tool == "executor_status":
            wait_result = await self.mcp.call_tool("execution_wait_status", {"wait_seconds": 0.0})
            wait_payload = compact_tool_payload(wait_result)
            if isinstance(wait_payload, dict) and wait_payload.get("running"):
                wait_seconds = parse_optional_float(wait_payload.get("recommended_wait_seconds"))
                if wait_seconds is None or wait_seconds <= 0:
                    wait_seconds = DEFAULT_AGENT_EXECUTION_WAIT_SECONDS
                result = await self.call_agent_execution_wait_status({"wait_seconds": wait_seconds})
                return self.annotate_execution_routed_tool_result(
                    result,
                    original_tool=tool,
                    actual_tool="execution_wait_status",
                )
            return await self.mcp.call_tool(tool, call_arguments)

        if tool == "planning_job_status":
            return await self.call_agent_planning_job_status(call_arguments)

        if tool != "execution_wait_status":
            return await self.mcp.call_tool(tool, call_arguments)

        return await self.call_agent_execution_wait_status(call_arguments)

    async def call_agent_planning_job_status(self, call_arguments: dict[str, Any]) -> Any:
        initial_result = await self.mcp.call_tool("planning_job_status", call_arguments)
        initial_payload = compact_tool_payload(initial_result)
        if not isinstance(initial_payload, dict) or not initial_payload.get("running"):
            return initial_result

        wait_seconds = parse_optional_float(initial_payload.get("recommended_wait_seconds"))
        if wait_seconds is None:
            wait_seconds = DEFAULT_AGENT_PLANNING_WAIT_SECONDS
        effective_wait = min(max(0.0, wait_seconds), DEFAULT_AGENT_PLANNING_WAIT_SECONDS)
        if effective_wait <= 0:
            return initial_result

        started_at = time.monotonic()
        await asyncio.sleep(effective_wait)
        mcp_auto_started = await self.ensure_mcp_started_for_tool(via="agent", tool="planning_job_status")
        if mcp_auto_started:
            return self.mcp_runtime_restarted_result("planning_job_status", via="agent")

        final_result = await self.mcp.call_tool("planning_job_status", call_arguments)
        final_payload = compact_tool_payload(final_result)
        return_reason = "timer_elapsed"
        if isinstance(final_payload, dict) and not final_payload.get("running"):
            return_reason = "planning_completed"
        return self.add_dashboard_wait_metadata(
            final_result,
            requested_wait=wait_seconds,
            effective_wait=effective_wait,
            started_at=started_at,
            return_reason=return_reason,
        )

    async def call_agent_execution_wait_status(self, call_arguments: dict[str, Any]) -> Any:
        requested_wait = parse_optional_float(call_arguments.get("wait_seconds"))
        if requested_wait is None or requested_wait <= 0:
            return await self.mcp.call_tool("execution_wait_status", call_arguments)

        effective_wait = min(
            max(0.0, requested_wait),
            DEFAULT_AGENT_EXECUTION_WAIT_SECONDS,
        )
        immediate_arguments = dict(call_arguments)
        immediate_arguments["wait_seconds"] = 0.0
        started_at = time.monotonic()

        initial_result = await self.mcp.call_tool("execution_wait_status", immediate_arguments)
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
        mcp_auto_started = await self.ensure_mcp_started_for_tool(via="agent", tool="execution_wait_status")
        if mcp_auto_started:
            return self.mcp_runtime_restarted_result("execution_wait_status", via="agent")

        final_result = await self.mcp.call_tool("execution_wait_status", immediate_arguments)
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

    def annotate_execution_routed_tool_result(self, result: Any, original_tool: str, actual_tool: str) -> Any:
        payload = compact_tool_payload(result)
        if not isinstance(payload, dict):
            return result
        payload = dict(payload)
        payload["dashboard_routed_from_tool"] = original_tool
        payload["dashboard_actual_tool"] = actual_tool
        if actual_tool == "execute_segment_to_breakpoint":
            payload["next"] = (
                "Dashboard routed this execution command through execute_segment_to_breakpoint with "
                "wait_mode='background'. Use the returned recommended_status_call, not executor_status polling."
            )
        elif actual_tool == "execution_wait_status":
            payload["next"] = (
                "Dashboard routed executor_status to execution_wait_status because a background wait is active. "
                "Use recommended_status_call or wait_seconds instead of immediate executor_status polling."
            )
        return replace_mcp_text_payload(result, payload)

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
        if tool == "execution_status_summary":
            for key, reason in {
                "include_visualizers": "Use visualizer_status only when visualizer metadata is specifically needed.",
                "include_planning_job": "Use planning_job_status only while a planning job is actively running.",
                "include_execution_wait": "Use execution_wait_status only while a background execution wait is actively running.",
            }.items():
                if call_arguments.get(key) is not False:
                    requested = call_arguments.get(key)
                    call_arguments[key] = False
                    overrides[key] = {
                        "from": requested,
                        "to": False,
                        "reason": reason,
                    }
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

    def reveal_run_artifact(
        self,
        run_id: str,
        path_value: str,
        absolute_path_value: str = "",
    ) -> dict[str, Any]:
        try:
            path = resolve_run_artifact_path(
                self.recorder.runs_dir,
                run_id or self.recorder.run_id,
                path_value,
                absolute_path_value,
            )
            reveal_path_in_file_manager(path)
            return {"ok": True, "path": str(path)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

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
        await self.broadcast_to_clients(self.clients, payload, timeout_seconds=5.0)

    async def broadcast_live_json(self, payload: dict[str, Any]) -> None:
        await self.broadcast_to_clients(self.live_clients, payload, timeout_seconds=1.0)

    async def broadcast_realtime_json(self, payload: dict[str, Any]) -> None:
        await asyncio.gather(
            self.broadcast_json(payload),
            self.broadcast_live_json(payload),
        )

    async def broadcast_to_clients(
        self,
        clients: set[Any],
        payload: dict[str, Any],
        timeout_seconds: float = 5.0,
    ) -> None:
        message = json.dumps(payload, ensure_ascii=True)
        snapshot = list(clients)
        if not snapshot:
            return

        async def send_one(client: Any) -> Any | None:
            try:
                await self.send_text(client, message, timeout_seconds=timeout_seconds)
                return None
            except Exception:
                return client

        stale = [item for item in await asyncio.gather(*(send_one(client) for client in snapshot)) if item is not None]
        for client in stale:
            clients.discard(client)
            self._client_send_locks.pop(client, None)

    async def safe_send(self, websocket: Any, payload: dict[str, Any]) -> None:
        try:
            await self.send_text(websocket, json.dumps(payload, ensure_ascii=True), timeout_seconds=None)
        except Exception as exc:
            if not websocket_closed_ok(exc):
                raise

    async def send_text(self, websocket: Any, message: str, timeout_seconds: float | None = None) -> None:
        lock = self._client_send_locks.get(websocket)
        if lock is None:
            lock = asyncio.Lock()
            self._client_send_locks[websocket] = lock
        async with lock:
            if timeout_seconds is None:
                await websocket.send(message)
            else:
                await asyncio.wait_for(websocket.send(message), timeout=max(0.05, float(timeout_seconds)))

    async def broadcast_run_loaded(self) -> None:
        await self.broadcast_json(self.run_loaded_payload())

    def run_loaded_payload(self) -> dict[str, Any]:
        temperature_history = self.recorder.read_temperature_history(
            self.recorder.run_id,
            max_samples=60000,
        )
        if not temperature_history.get("samples"):
            all_events = self.recorder.events_for_run(self.recorder.run_id)
            self.recorder.ensure_temperature_history_from_events(all_events)
            temperature_history = self.recorder.read_temperature_history(
                self.recorder.run_id,
                max_samples=60000,
            )
        window = self.recorder.event_window_for_run(
            self.recorder.run_id,
            limit=RUN_EVENT_WINDOW_LIMIT,
            omit_types=FRONTEND_OMITTED_EVENT_TYPES,
        )
        return {
            "type": "run_loaded",
            "status": self.status(),
            "events": window["events"],
            "event_window": window["meta"],
            "temperature_history": temperature_history,
            "runs": self.recorder.list_runs(),
        }

    async def run(self) -> None:
        await self.record("cockpit_started", host=self.config.host, port=self.config.port)
        if self.config.speech.enabled and self.config.speech.preload:
            self._audio_preload_task = asyncio.create_task(self.preload_audio_transcriber_background())
        httpd = None
        try:
            httpd = start_http_server(self.config.host, self.config.port, self.recorder.runs_dir)
            ws_port = self.config.port + 1
            live_ws_port = self.config.port + 2
            async with (
                websockets.serve(
                    self.handle_ws,
                    self.config.host,
                    ws_port,
                    max_size=None,
                ),
                websockets.serve(
                    self.handle_live_ws,
                    self.config.host,
                    live_ws_port,
                    max_size=None,
                ),
            ):
                print(f"DropLogic Dashboard: http://{self.config.host}:{self.config.port}")
                print(f"DropLogic Dashboard WS: ws://{self.config.host}:{ws_port}")
                print(f"DropLogic Dashboard Live WS: ws://{self.config.host}:{live_ws_port}")
                await asyncio.Future()
        finally:
            if self._audio_preload_task is not None:
                self._audio_preload_task.cancel()
            if httpd is not None:
                httpd.shutdown()
                httpd.server_close()


def path_is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def allowed_artifact_roots(runs_dir: Path, run_dir: Path) -> list[Path]:
    roots = [run_dir]
    capture_root = str(os.environ.get("DROPLOGIC_CAPTURE_ROOT") or "").strip()
    if capture_root:
        roots.append(Path(capture_root).expanduser())
    roots.append(Path.home() / "Documents" / "DropLogic" / "captures")
    unique: list[Path] = []
    for root in roots:
        try:
            resolved = root.resolve()
        except OSError:
            continue
        if any(resolved == existing for existing in unique):
            continue
        if path_is_relative_to(resolved, runs_dir) or resolved.exists():
            unique.append(resolved)
    return unique


ARTIFACT_REF_CONTAINER_KEYS = {"artifact", "artifacts", "artifact_ref", "artifact_refs", "_artifact_ref"}
CAPTURE_REF_CONTAINER_KEYS = {"capture", "captures"}
ARTIFACT_REF_SKIP_KEYS = {"arguments", "dashboard_actual_arguments", "argument_overrides"}
ARTIFACT_REF_TEXT_MAX_CHARS = 60000
RECORDED_ARTIFACT_PATH_KEYS_CACHE: dict[tuple[str, tuple[str, ...]], tuple[tuple[int, int], frozenset[str]]] = {}
RECORDED_ARTIFACT_PATH_KEYS_CACHE_LOCK = threading.Lock()


def artifact_path_key(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def recorded_artifact_path_keys_cache_key(run_dir: Path, allowed_roots: list[Path]) -> tuple[str, tuple[str, ...]]:
    return (
        artifact_path_key(run_dir),
        tuple(artifact_path_key(root) for root in allowed_roots),
    )


def add_recorded_artifact_path_key(
    keys: set[str],
    run_dir: Path,
    value: Any,
    allowed_roots: list[Path],
) -> None:
    text = unquote(str(value or "").strip())
    if not text:
        return
    candidate = Path(text)
    if not candidate.is_absolute():
        candidate = run_dir / text
    try:
        resolved = candidate.resolve()
    except OSError:
        return
    if any(path_is_relative_to(resolved, root) for root in allowed_roots):
        keys.add(artifact_path_key(resolved))


def add_artifact_container_path_keys(
    keys: set[str],
    run_dir: Path,
    container: dict[str, Any],
    allowed_roots: list[Path],
) -> None:
    for field in ("path", "absolute_path"):
        add_recorded_artifact_path_key(keys, run_dir, container.get(field), allowed_roots)


def parsed_artifact_text(value: str) -> Any:
    text = str(value or "").strip()
    if not text or len(text) > ARTIFACT_REF_TEXT_MAX_CHARS or text[0] not in "{[":
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def collect_recorded_artifact_path_keys(
    value: Any,
    run_dir: Path,
    allowed_roots: list[Path],
    keys: set[str],
    context_key: str = "",
) -> None:
    normalized_key = str(context_key or "").lower()
    if normalized_key in ARTIFACT_REF_CONTAINER_KEYS and not isinstance(value, (dict, list)):
        add_recorded_artifact_path_key(keys, run_dir, value, allowed_roots)
        return
    if isinstance(value, list):
        for item in value:
            collect_recorded_artifact_path_keys(item, run_dir, allowed_roots, keys, normalized_key)
        return
    if not isinstance(value, dict):
        return
    if normalized_key in ARTIFACT_REF_CONTAINER_KEYS or normalized_key in CAPTURE_REF_CONTAINER_KEYS:
        add_artifact_container_path_keys(keys, run_dir, value, allowed_roots)
    if normalized_key == "content":
        parsed = parsed_artifact_text(value.get("text")) if isinstance(value.get("text"), str) else None
        if parsed is not None:
            collect_recorded_artifact_path_keys(parsed, run_dir, allowed_roots, keys)
    for child_key, child_value in value.items():
        child_context_key = str(child_key or "").lower()
        if child_context_key in ARTIFACT_REF_SKIP_KEYS:
            continue
        collect_recorded_artifact_path_keys(child_value, run_dir, allowed_roots, keys, child_context_key)


def recorded_run_artifact_path_keys(run_dir: Path, allowed_roots: list[Path]) -> set[str]:
    events_path = run_dir / "events.jsonl"
    cache_key = recorded_artifact_path_keys_cache_key(run_dir, allowed_roots)
    try:
        stat = events_path.stat()
    except OSError:
        with RECORDED_ARTIFACT_PATH_KEYS_CACHE_LOCK:
            RECORDED_ARTIFACT_PATH_KEYS_CACHE.pop(cache_key, None)
        return set()
    fingerprint = (stat.st_mtime_ns, stat.st_size)
    with RECORDED_ARTIFACT_PATH_KEYS_CACHE_LOCK:
        cached = RECORDED_ARTIFACT_PATH_KEYS_CACHE.get(cache_key)
        if cached and cached[0] == fingerprint:
            return set(cached[1])
    try:
        with events_path.open("r", encoding="utf-8") as lines:
            keys: set[str] = set()
            for line in lines:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(event, dict):
                    collect_recorded_artifact_path_keys(event, run_dir, allowed_roots, keys)
    except OSError:
        return set()
    try:
        final_stat = events_path.stat()
    except OSError:
        return keys
    if (final_stat.st_mtime_ns, final_stat.st_size) == fingerprint:
        with RECORDED_ARTIFACT_PATH_KEYS_CACHE_LOCK:
            RECORDED_ARTIFACT_PATH_KEYS_CACHE[cache_key] = (fingerprint, frozenset(keys))
    return keys


def resolve_run_artifact_path(
    runs_dir: Path,
    run_id: str,
    path_value: str,
    absolute_path_value: str = "",
) -> Path:
    clean_run_id = safe_filename(str(run_id or "").strip())
    if not clean_run_id:
        raise ValueError("Missing run id.")
    runs_root = runs_dir.resolve()
    run_dir = (runs_root / clean_run_id).resolve()
    if not path_is_relative_to(run_dir, runs_root) or not run_dir.exists():
        raise ValueError("Run not found.")

    candidates: list[Path] = []
    for raw in (path_value, absolute_path_value):
        value = unquote(str(raw or "").strip())
        if not value:
            continue
        candidate = Path(value)
        candidates.append(candidate if candidate.is_absolute() else run_dir / value)

    allowed_roots = allowed_artifact_roots(runs_root, run_dir)
    recorded_external_keys: set[str] | None = None
    for candidate in candidates:
        resolved = candidate.resolve()
        if not any(path_is_relative_to(resolved, root) for root in allowed_roots):
            continue
        if not path_is_relative_to(resolved, run_dir):
            if recorded_external_keys is None:
                recorded_external_keys = recorded_run_artifact_path_keys(run_dir, allowed_roots)
            if artifact_path_key(resolved) not in recorded_external_keys:
                continue
        if resolved.exists() and resolved.is_file():
            return resolved
    raise ValueError("Artifact file not found.")


def reveal_path_in_file_manager(path: Path) -> None:
    resolved = path.resolve()
    if sys.platform.startswith("win"):
        subprocess.Popen(["explorer.exe", f"/select,{str(resolved)}"])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(resolved)])
    else:
        subprocess.Popen(["xdg-open", str(resolved.parent)])


def start_http_server(host: str, port: int, runs_dir: Path) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(FRONTEND), **kwargs)

        def log_message(self, format: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/run-artifact":
                self.serve_run_artifact(parsed.query)
                return
            super().do_GET()

        def serve_run_artifact(self, query: str) -> None:
            params = parse_qs(query, keep_blank_values=False)
            run_id = (params.get("run_id") or [""])[0]
            path_value = (params.get("path") or [""])[0]
            absolute_path_value = (params.get("absolute_path") or [""])[0]
            try:
                artifact_path = resolve_run_artifact_path(runs_dir, run_id, path_value, absolute_path_value)
                content_type = mimetypes.guess_type(str(artifact_path))[0] or "application/octet-stream"
                data = artifact_path.read_bytes()
            except Exception as exc:
                payload = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

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
            if app._stream_task is not None:
                app._stream_task.cancel()
            asyncio.run(app.mcp.stop())
        except Exception:
            pass


if __name__ == "__main__":
    main()
