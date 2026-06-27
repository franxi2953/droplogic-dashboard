from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import http.server
import json
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import websockets

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.ai_provider import AiProvider, MODEL_ATTACHMENTS_KEY
    from backend.config import COCKPIT_ROOT, DROPLOGIC_ROOT, CockpitConfig, load_config
    from backend.context_builder import build_model_context, encoded_json_length
    from backend.mcp_client import McpStdioClient
    from backend.recorder import RunRecorder
else:
    from .ai_provider import AiProvider, MODEL_ATTACHMENTS_KEY
    from .config import COCKPIT_ROOT, DROPLOGIC_ROOT, CockpitConfig, load_config
    from .context_builder import build_model_context, encoded_json_length
    from .mcp_client import McpStdioClient
    from .recorder import RunRecorder


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
CHECKPOINT_NEW_EVENT_TRIGGER = 40
CHECKPOINT_NEW_CHARS_TRIGGER = 40_000


class CockpitApp:
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
        self._poll_task: asyncio.Task | None = None
        self._agent_task: asyncio.Task | None = None

    def status(self) -> dict[str, Any]:
        return {
            "run_id": self.recorder.run_id,
            "runs": self.recorder.list_runs(),
            "now": self.now,
            "mcp": {
                "running": self.mcp.running,
                "command": self.mcp.command_line(),
            },
            "ai": self.ai.status(),
            "agent_busy": self._agent_task is not None and not self._agent_task.done(),
            "live": {
                "has_runtime": bool(self.live.get("runtime")),
                "has_state": bool(self.live.get("state")),
                "has_matrix_frame": bool(self.live.get("frames", {}).get("matrix")),
                "has_streamer_frame": bool(self.live.get("frames", {}).get("streamer")),
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
            event = await self.record("mcp_tool_call", tool=tool, arguments=arguments)
            try:
                result = await self.mcp.call_tool(tool, arguments)
                event_result, _, _ = self.prepare_visual_tool_result_for_model(
                    tool,
                    arguments,
                    result,
                    attach_for_model=False,
                )
                ok = not bool(result.get("isError")) if isinstance(result, dict) else True
                result_event = await self.record(
                    "mcp_tool_result",
                    tool=tool,
                    ok=ok,
                    result=event_result,
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
                )
                await websocket.send(
                    json.dumps({"type": "tool_result", "event": result_event, "result": {"error": str(exc)}})
                )
            await websocket.send(json.dumps({"type": "status", "status": self.status()}))
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
        await self.record("agent_started", message="Thinking")
        try:
            await self.mcp.start()
            self.ensure_live_polling()
            tools_result = await self.mcp.list_tools()
            tools = tools_result.get("tools", []) if isinstance(tools_result, dict) else []

            async def logged_tool_call(tool: str, arguments: dict[str, Any]) -> Any:
                call_arguments, argument_overrides = self.agent_tool_arguments(tool, arguments)
                call_fields = {"tool": tool, "arguments": call_arguments, "via": "agent"}
                if argument_overrides:
                    call_fields["argument_overrides"] = argument_overrides
                call_event = await self.record("mcp_tool_call", **call_fields)
                try:
                    result = await self.mcp.call_tool(tool, call_arguments)
                    event_result, model_result, attachment_details = self.prepare_visual_tool_result_for_model(
                        tool,
                        call_arguments,
                        result,
                    )
                    ok = not bool(result.get("isError")) if isinstance(result, dict) else True
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

    def agent_tool_arguments(self, tool: str, arguments: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        call_arguments = dict(arguments or {})
        overrides: dict[str, Any] = {}
        if tool == "visualizer_frame":
            if call_arguments.get("include_base64") is not True:
                call_arguments["include_base64"] = True
                overrides["include_base64"] = True
            if not call_arguments.get("image_format"):
                call_arguments["image_format"] = "png"
                overrides["image_format"] = "png"
        return call_arguments, overrides

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

    def should_make_ai_context_summary(self, events: list[dict[str, Any]]) -> bool:
        if not self.config.ai.ai_context_summary_enabled:
            return False
        if not self.ai.configured:
            return False
        if not events:
            return False
        chars = encoded_json_length(events)
        if chars < self.config.ai.ai_context_summary_trigger_chars:
            return False
        last_summary_index = None
        for index in range(len(events) - 1, -1, -1):
            if events[index].get("type") == "context_ai_summary":
                last_summary_index = index
                break
        if last_summary_index is None:
            return True
        events_since_summary = len(events) - last_summary_index - 1
        if events_since_summary >= max(20, self.config.ai.recent_event_target // 2):
            return True
        chars_since_summary = encoded_json_length(events[last_summary_index + 1 :])
        return chars_since_summary >= max(20_000, self.config.ai.ai_context_summary_trigger_chars // 3)

    async def ensure_context_checkpoint(
        self,
        events: list[dict[str, Any]],
        on_retry: Any,
        on_context_compacted: Any,
    ) -> dict[str, Any] | None:
        checkpoint = self.valid_context_checkpoint(events)
        if not self.should_update_context_checkpoint(events, checkpoint):
            return checkpoint
        if not self.config.ai.ai_context_summary_enabled or not self.ai.configured:
            return checkpoint

        target_count = self.context_checkpoint_target_count(events)
        if target_count <= 0:
            return checkpoint

        previous_summary = str((checkpoint or {}).get("summary") or "").strip()
        previous_covered = int((checkpoint or {}).get("covered_event_count") or 0) if previous_summary else 0
        events_to_summarize = events[previous_covered:target_count] if previous_summary else events[:target_count]
        if not events_to_summarize and previous_summary:
            return checkpoint
        summary_context = build_model_context(
            self.checkpoint_summary_events(events_to_summarize, previous_summary),
            run_dir=self.recorder.run_dir,
            max_chars=min(self.config.ai.max_context_chars, self.config.ai.ai_context_summary_trigger_chars),
            target_chars=min(self.config.ai.target_context_chars, 60_000),
            recent_event_target=min(self.config.ai.recent_event_target, 100),
            large_event_chars=self.config.ai.large_event_chars,
            protect_latest_tool_result=True,
        )
        try:
            summary = await self.ai.summarize_context_memory(
                summary_context.events,
                max_chars=self.config.ai.ai_context_summary_max_chars,
                on_retry=on_retry,
                on_context_compacted=on_context_compacted,
            )
        except Exception as exc:
            await self.record(
                "context_compacted",
                level="warning",
                scope="run_context_checkpoint",
                message=f"Context checkpoint update failed; using previous checkpoint/deterministic context: {exc}",
            )
            return checkpoint

        new_checkpoint = {
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "run_id": self.recorder.run_id,
            "covered_event_count": target_count,
            "covered_until_t": events[target_count - 1].get("t") if target_count > 0 else None,
            "covered_until_ts": events[target_count - 1].get("ts") if target_count > 0 else None,
            "source": "ai+deterministic",
            "summary": summary,
            "source_event_count": target_count,
            "new_source_event_count": len(events_to_summarize),
            "previous_covered_event_count": previous_covered,
            "deterministic_context_chars": encoded_json_length(summary_context.events),
            "max_summary_chars": self.config.ai.ai_context_summary_max_chars,
            "safety_note": (
                "This checkpoint is narrative memory only. Before hardware actions, refresh physical state "
                "with MCP tools; do not trust the checkpoint for live matrix, stage, temperature, droplets, or voltages."
            ),
        }
        self.recorder.write_context_checkpoint(new_checkpoint)
        await self.record(
            "context_checkpoint_saved",
            scope="run_context_checkpoint",
            message="Persistent context checkpoint saved for future turns.",
            covered_event_count=new_checkpoint["covered_event_count"],
            covered_until_t=new_checkpoint["covered_until_t"],
            source_event_count=new_checkpoint["source_event_count"],
            new_source_event_count=new_checkpoint["new_source_event_count"],
            previous_covered_event_count=new_checkpoint["previous_covered_event_count"],
            deterministic_context_chars=new_checkpoint["deterministic_context_chars"],
            max_summary_chars=new_checkpoint["max_summary_chars"],
        )
        return new_checkpoint

    def valid_context_checkpoint(self, events: list[dict[str, Any]]) -> dict[str, Any] | None:
        checkpoint = self.recorder.read_context_checkpoint()
        if not checkpoint:
            return None
        covered = int(checkpoint.get("covered_event_count") or 0)
        summary = str(checkpoint.get("summary") or "").strip()
        if covered <= 0 or covered > len(events) or not summary:
            return None
        return checkpoint

    def should_update_context_checkpoint(
        self,
        events: list[dict[str, Any]],
        checkpoint: dict[str, Any] | None,
    ) -> bool:
        if not events:
            return False
        total_chars = encoded_json_length(events)
        if checkpoint is None:
            return total_chars >= self.config.ai.ai_context_summary_trigger_chars
        covered = int(checkpoint.get("covered_event_count") or 0)
        tail = events[covered:]
        if len(tail) >= CHECKPOINT_NEW_EVENT_TRIGGER:
            return True
        if encoded_json_length(tail) >= CHECKPOINT_NEW_CHARS_TRIGGER:
            return True
        return False

    def context_checkpoint_target_count(self, events: list[dict[str, Any]]) -> int:
        if len(events) < 2:
            return 0
        # Leave the current prompt/agent_started and immediate fresh context outside the checkpoint.
        return max(0, len(events) - 2)

    def checkpoint_summary_events(self, events: list[dict[str, Any]], previous_summary: str) -> list[dict[str, Any]]:
        events = [
            event
            for event in events
            if event.get("type") not in {"context_checkpoint_used", "context_compacted", "pinned_context_used"}
        ]
        if not previous_summary:
            return events
        return [
            {
                "type": "previous_context_checkpoint",
                "message": (
                    "Previous persistent context checkpoint. Merge it with newer events and produce "
                    "a fresh checkpoint; do not treat it as live hardware state."
                ),
                "text": previous_summary,
            },
            *events,
        ]

    def events_for_model_from_checkpoint(
        self,
        events: list[dict[str, Any]],
        checkpoint: dict[str, Any] | None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        checkpoint = self.valid_context_checkpoint(events) if checkpoint is None else checkpoint
        if checkpoint is None:
            return events, None
        covered = int(checkpoint.get("covered_event_count") or 0)
        tail = events[covered:]
        memory_event = {
            "type": "run_context_checkpoint",
            "message": (
                "Persistent run memory checkpoint loaded. It summarizes earlier events only; "
                "the complete events.jsonl remains on disk."
            ),
            "covered_event_count": covered,
            "covered_until_t": checkpoint.get("covered_until_t"),
            "covered_until_ts": checkpoint.get("covered_until_ts"),
            "text": checkpoint.get("summary"),
            "safety_note": checkpoint.get("safety_note"),
        }
        details = {
            "scope": "run_context_checkpoint",
            "message": "Persistent context checkpoint loaded for this model turn.",
            "covered_event_count": covered,
            "new_event_count": len(tail),
            "checkpoint_chars": len(str(checkpoint.get("summary") or "")),
            "estimated_chars_after": encoded_json_length([memory_event, *tail]),
        }
        return [memory_event, *tail], details

    def ensure_live_polling(self) -> None:
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.create_task(self.live_poll_loop())

    async def stop_live_polling(self) -> None:
        task = self._poll_task
        self._poll_task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def live_poll_loop(self) -> None:
        last_state_poll = 0.0
        while self.mcp.running:
            try:
                now = time.monotonic()
                include_state = (
                    not self.live
                    or now - last_state_poll >= max(0.1, self.config.live_state_interval_seconds)
                )
                live = await self.collect_live_snapshot(include_state=include_state)
                if include_state:
                    last_state_poll = now
                self.live = live
                await self.broadcast_json({"type": "live", "live": live})
            except Exception as exc:
                await self.record("live_poll_error", level="warning", message=str(exc))
            await asyncio.sleep(max(0.05, self.config.live_frame_interval_seconds))

    async def collect_live_snapshot(self, include_state: bool = True) -> dict[str, Any]:
        previous = self.live or {}
        runtime = previous.get("runtime")
        state = previous.get("state")
        visualizer_status = previous.get("visualizers")
        if include_state:
            runtime = compact_tool_payload(await self.safe_tool("runtime_status"))
            state = compact_tool_payload(await self.safe_tool("state_summary"))
            visualizer_status = compact_tool_payload(await self.safe_tool("visualizer_status"))
        frames = {
            "matrix": await self.safe_frame("matrix", "snapshot", max_width=520, max_height=360),
            "streamer": await self.safe_frame("streamer", "snapshot", max_width=720, max_height=460),
        }
        return {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "runtime": runtime,
            "state": state,
            "visualizers": visualizer_status,
            "frames": frames,
        }

    async def safe_tool(self, tool: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            return {"ok": True, "result": await self.mcp.call_tool(tool, arguments or {})}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def safe_frame(
        self,
        visualizer: str,
        frame_source: str,
        max_width: int,
        max_height: int,
    ) -> dict[str, Any]:
        result = await self.safe_tool(
            "visualizer_frame",
            {
                "visualizer": visualizer,
                "frame_source": frame_source,
                "image_format": "jpg",
                "include_base64": True,
                "max_width": max_width,
                "max_height": max_height,
            },
        )
        if not result.get("ok"):
            return result
        payload = compact_tool_payload(result)
        return payload if isinstance(payload, dict) else {"ok": True, "result": payload}

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
    output = json.dumps(result, ensure_ascii=True, default=str)
    chars = len(output)
    return {
        "model_output_chars": chars,
        "estimated_model_output_tokens": max(1, (chars + 3) // 4),
    }


def safe_filename(value: str) -> str:
    cleaned = []
    for char in str(value or ""):
        if char.isalnum() or char in {"-", "_"}:
            cleaned.append(char)
        else:
            cleaned.append("_")
    text = "".join(cleaned).strip("_")
    return text[:64] or "item"


def websocket_closed_ok(exc: Exception) -> bool:
    return "received 1000 (OK)" in str(exc) or "sent 1000 (OK)" in str(exc)


if __name__ == "__main__":
    main()
