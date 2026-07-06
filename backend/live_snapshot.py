from __future__ import annotations

import asyncio
import json
import time
import traceback as traceback_module
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DROPLOGIC_ROOT
from .tool_payloads import compact_tool_payload


class LiveSnapshotMixin:
    def ensure_live_polling(self) -> None:
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.create_task(self.live_poll_loop())
        if getattr(self, "_stream_task", None) is None or self._stream_task.done():
            self._stream_task = asyncio.create_task(self.streamer_frame_loop())
        if getattr(self, "_scene_task", None) is None or self._scene_task.done():
            self._scene_task = asyncio.create_task(self.scene_snapshot_loop())

    async def stop_live_polling(self) -> None:
        tasks = [
            self._poll_task,
            getattr(self, "_stream_task", None),
            getattr(self, "_scene_task", None),
        ]
        self._poll_task = None
        self._stream_task = None
        self._scene_task = None
        for task in tasks:
            if task is None or task.done():
                continue
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
                live = await self.collect_live_snapshot(
                    include_state=include_state,
                    include_streamer_frame=False,
                    prefer_scene_file=True,
                )
                if include_state:
                    last_state_poll = now
                live = self.merge_newer_live_frames(live, self.live or {})
                self.live = live
                if include_state:
                    await self.record_live_temperature_sample(live)
                await self.broadcast_live_json({"type": "live", "live": live})
            except Exception as exc:
                await self.record_live_loop_error("live_poll_error", exc)
            await asyncio.sleep(max(0.05, self.config.live_frame_interval_seconds))

    async def streamer_frame_loop(self) -> None:
        while self.mcp.running:
            started = time.monotonic()
            try:
                if getattr(self, "_direct_stream_available", False):
                    await asyncio.sleep(max(0.2, float(getattr(self.config, "live_state_interval_seconds", 1.0))))
                    continue
                frame = await self.collect_streamer_frame()
                self.live = self.merge_live_frame(self.live or {}, "streamer", frame)
                await self.broadcast_live_json(
                    {
                        "type": "live_frame",
                        "visualizer": "streamer",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "sequence": live_frame_sequence(frame),
                        "frame": frame,
                    }
                )
            except Exception as exc:
                await self.record_live_loop_error("live_stream_error", exc)
            elapsed = time.monotonic() - started
            interval = max(0.05, float(getattr(self.config, "live_streamer_interval_seconds", 0.12)))
            await asyncio.sleep(max(0.01, interval - elapsed))

    async def scene_snapshot_loop(self) -> None:
        last_key = ""
        while self.mcp.running:
            started = time.monotonic()
            try:
                runtime = self.live.get("runtime") if isinstance(self.live, dict) else None
                runtime_session_id = live_runtime_session_id(runtime)
                scene = await self.read_dashboard_scene_snapshot_async(runtime_session_id=runtime_session_id)
                if (
                    runtime_session_id
                    and isinstance(scene, dict)
                    and scene.get("reason") == "scene_session_mismatch"
                ):
                    # Runtime polling can lag behind long MCP calls. The scene file is written
                    # by the executor-side writer, so prefer the newest scene stream over a stale
                    # runtime session id when keeping the matrix visualizer live.
                    fresh_scene = await self.read_dashboard_scene_snapshot_async(runtime_session_id=None)
                    if isinstance(fresh_scene, dict) and fresh_scene.get("available"):
                        scene = fresh_scene
                if isinstance(scene, dict) and scene.get("available"):
                    key = scene_snapshot_key(scene)
                    if key and key != last_key:
                        last_key = key
                        scene = self.compact_live_scene(self.annotate_live_scene(scene))
                        self.live = self.merge_live_scene(self.live or {}, scene)
                        await self.broadcast_live_json(
                            {
                                "type": "live_scene",
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                                "sequence": live_scene_sequence(scene),
                                "runtime": self.live.get("runtime"),
                                "scene": scene,
                            }
                        )
            except Exception as exc:
                await self.record_live_loop_error("live_scene_error", exc)
            elapsed = time.monotonic() - started
            interval = max(0.05, float(getattr(self.config, "live_streamer_interval_seconds", 0.12)))
            await asyncio.sleep(max(0.01, interval - elapsed))

    async def record_live_loop_error(self, event_type: str, exc: Exception) -> None:
        message = str(exc)
        now = time.monotonic()
        states = getattr(self, "_live_loop_error_states", None)
        if not isinstance(states, dict):
            states = {}
            self._live_loop_error_states = states
        key = (event_type, message)
        state = states.get(key) or {"count": 0, "last_emit": 0.0, "emitted": False}
        state["count"] = int(state.get("count") or 0) + 1
        elapsed = now - float(state.get("last_emit") or 0.0)
        if not state.get("emitted") or elapsed >= 10.0:
            suppressed = max(0, state["count"] - 1)
            await self.record(
                event_type,
                level="warning",
                message=message,
                suppressed_repeats=suppressed,
                error_traceback="".join(
                    traceback_module.format_exception(type(exc), exc, exc.__traceback__, limit=8)
                ),
            )
            state["count"] = 0
            state["last_emit"] = now
            state["emitted"] = True
        states[key] = state

    async def collect_live_snapshot(
        self,
        include_state: bool = True,
        include_streamer_frame: bool = True,
        prefer_scene_file: bool = False,
    ) -> dict[str, Any]:
        previous = self.live or {}
        runtime = previous.get("runtime")
        state = previous.get("state")
        visualizer_status = previous.get("visualizers")
        if include_state:
            runtime_result = await self.safe_tool("runtime_status", timeout_seconds=3.0)
            runtime = compact_tool_payload(runtime_result)
            if not runtime_result.get("ok"):
                return {
                    **previous,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "runtime": runtime,
                    "live_poll_degraded": True,
                    "live_poll_error": runtime_result.get("error"),
                }
            state = compact_tool_payload(await self.safe_tool("state_summary", timeout_seconds=3.0))
            voltage_status = compact_tool_payload(await self.safe_tool("matrix_voltage_status", timeout_seconds=3.0))
            state = attach_matrix_voltage_status(state, voltage_status)
            visualizer_status = compact_tool_payload(await self.safe_tool("visualizer_status", timeout_seconds=3.0))
            self._direct_stream_available = streamer_direct_stream_available(visualizer_status)
        scene = await self.safe_dashboard_scene(
            prefer_file=prefer_scene_file,
            runtime=runtime,
        )
        scene = self.compact_live_scene(scene)

        streamer_options = getattr(self, "streamer_frame_options", {}) or {}
        streamer_full_resolution = bool(streamer_options.get("full_resolution"))
        streamer_max_width = None if streamer_full_resolution else int(streamer_options.get("max_width") or 720)
        streamer_max_height = None if streamer_full_resolution else int(streamer_options.get("max_height") or 460)
        previous_frames = previous.get("frames") if isinstance(previous.get("frames"), dict) else {}
        direct_stream_available = bool(getattr(self, "_direct_stream_available", False))
        streamer_frame = None
        if not direct_stream_available:
            if include_streamer_frame:
                streamer_frame = self.annotate_live_frame("streamer", await self.safe_frame(
                    "streamer",
                    "snapshot",
                    max_width=streamer_max_width,
                    max_height=streamer_max_height,
                    image_quality=72,
                ))
            else:
                streamer_frame = previous_frames.get("streamer")
        matrix_frame = previous_frames.get("matrix")
        if not (isinstance(scene, dict) and scene.get("available")):
            matrix_frame = self.annotate_live_frame(
                "matrix",
                await self.safe_frame("matrix", "snapshot", max_width=520, max_height=360),
            )
        frames = {
            "matrix": matrix_frame,
            "streamer": streamer_frame,
        }
        snapshot = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "runtime": runtime,
            "state": state,
            "visualizers": visualizer_status,
            "scene": scene,
            "frames": frames,
        }
        return self.merge_newer_live_frames(snapshot, self.live or {})

    async def collect_streamer_frame(self) -> dict[str, Any]:
        streamer_options = getattr(self, "streamer_frame_options", {}) or {}
        streamer_full_resolution = bool(streamer_options.get("full_resolution"))
        streamer_max_width = None if streamer_full_resolution else int(streamer_options.get("max_width") or 720)
        streamer_max_height = None if streamer_full_resolution else int(streamer_options.get("max_height") or 460)
        return self.annotate_live_frame("streamer", await self.safe_frame(
            "streamer",
            "snapshot",
            max_width=streamer_max_width,
            max_height=streamer_max_height,
            image_quality=72,
        ))

    @staticmethod
    def merge_live_frame(live: dict[str, Any], visualizer: str, frame: dict[str, Any]) -> dict[str, Any]:
        next_live = dict(live or {})
        frames = dict(next_live.get("frames") or {})
        frames[visualizer] = frame
        next_live["frames"] = frames
        next_live["updated_at"] = datetime.now(timezone.utc).isoformat()
        return next_live

    def merge_live_scene(self, live: dict[str, Any], scene: dict[str, Any]) -> dict[str, Any]:
        next_live = dict(live or {})
        compact_scene = self.compact_live_scene(scene)
        next_live["scene"] = compact_scene
        runtime = runtime_with_scene_session(next_live.get("runtime"), compact_scene)
        if runtime is not None:
            next_live["runtime"] = runtime
        next_live["updated_at"] = datetime.now(timezone.utc).isoformat()
        return next_live

    def next_live_sequence(self, channel: str) -> int:
        sequences = getattr(self, "_live_frame_sequences", None)
        if not isinstance(sequences, dict):
            sequences = {}
            self._live_frame_sequences = sequences
        next_value = int(sequences.get(channel, 0)) + 1
        sequences[channel] = next_value
        return next_value

    def annotate_live_frame(self, visualizer: str, frame: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(frame, dict):
            return frame
        sequence = self.next_live_sequence(f"frame:{visualizer}")
        captured_at = datetime.now(timezone.utc).isoformat()
        annotated = dict(frame)
        metadata = {
            "visualizer": visualizer,
            "sequence": sequence,
            "captured_at": captured_at,
            "emitted_at": captured_at,
        }
        annotated["dashboard_live"] = metadata
        annotated["dashboard_live_sequence"] = sequence
        annotated["dashboard_live_captured_at"] = captured_at
        annotated["dashboard_live_visualizer"] = visualizer
        return annotated

    def annotate_live_scene(self, scene: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(scene, dict):
            return scene
        sequence = self.next_live_sequence("scene:matrix")
        captured_at = datetime.now(timezone.utc).isoformat()
        annotated = dict(scene)
        session_id = scene_session_id(annotated)
        if session_id and not annotated.get("session_id"):
            annotated["session_id"] = session_id
        annotated["dashboard_live"] = {
            "visualizer": "matrix",
            "sequence": sequence,
            "captured_at": captured_at,
            "emitted_at": captured_at,
        }
        annotated["dashboard_live_sequence"] = sequence
        annotated["dashboard_live_captured_at"] = captured_at
        return annotated

    def merge_newer_live_frames(self, incoming: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(incoming, dict):
            return incoming
        incoming_frames = incoming.get("frames") if isinstance(incoming.get("frames"), dict) else {}
        current_frames = current.get("frames") if isinstance(current.get("frames"), dict) else {}
        if not incoming_frames or not current_frames:
            return incoming
        merged = dict(incoming_frames)
        for visualizer, current_frame in current_frames.items():
            incoming_frame = merged.get(visualizer)
            if incoming_frame is None:
                merged[visualizer] = current_frame
                continue
            if live_frame_is_newer(current_frame, incoming_frame):
                merged[visualizer] = current_frame
        next_live = dict(incoming)
        next_live["frames"] = merged
        return next_live

    def compact_live_scene(self, scene: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(scene, dict):
            return scene
        timeline = scene.get("timeline")
        if not isinstance(timeline, dict):
            return scene
        frames = timeline.get("frames")
        if not isinstance(frames, list) or not frames:
            return scene
        heavy = len(frames) > 80 or len(json.dumps(frames, ensure_ascii=True)) > 160_000
        if not heavy:
            return scene
        compact_frames = []
        for frame in frames:
            if not isinstance(frame, dict):
                continue
            compact_frames.append({
                "index": frame.get("index"),
                "event_id": frame.get("event_id"),
                "event_type": frame.get("event_type"),
                "active_droplet_ids": frame.get("active_droplet_ids") if isinstance(frame.get("active_droplet_ids"), list) else [],
            })
        compact_timeline = dict(timeline)
        compact_timeline["frames"] = compact_frames
        compact_timeline["frames_compact"] = True
        compact_timeline["live_frames_compacted"] = True
        compact_timeline["live_omitted_frame_details"] = True
        compact_timeline["encoding"] = "compact_frame_index"
        compact_timeline["detailed_frame_limit"] = min(int(timeline.get("detailed_frame_limit") or 0) or 80, 80)
        compact_scene = dict(scene)
        compact_scene["timeline"] = compact_timeline
        return compact_scene

    async def record_live_temperature_sample(self, live: dict[str, Any]) -> None:
        state = unwrap_live_state(live.get("state"))
        measured = extract_live_temperature(state)
        target = extract_live_temperature_target(state)
        measured_valid = is_valid_live_temperature(measured)
        target_valid = is_valid_live_temperature_target(target)
        if not measured_valid and not target_valid:
            return

        now = time.time()
        previous = getattr(self, "_last_temperature_record", {}) or {}
        previous_at = number_or_none(previous.get("t")) or 0.0
        previous_measured = number_or_none(previous.get("measured_c"))
        previous_target = number_or_none(previous.get("target_c"))
        target_changed = (
            target_valid
            and (
                previous_target is None
                or abs(float(target) - previous_target) > 0.02
            )
        )
        measured_changed = (
            measured_valid
            and (
                previous_measured is None
                or now - previous_at >= 5.0
                or target_changed
            )
        )
        if not measured_changed and not target_changed:
            return

        event = {
            "source": "live_poll",
            "state_updated_at": live.get("updated_at"),
        }
        if measured_valid:
            event["measured_c"] = round(float(measured), 4)
        if target_valid:
            event["target_c"] = round(float(target), 4)
        recorded = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "t": time.time(),
            "type": "temperature_sample",
            **event,
        }
        self.recorder.append_temperature_sample(recorded)
        await self.broadcast_event(recorded)
        self._last_temperature_record = {
            "t": now,
            "measured_c": float(measured) if measured_valid else previous_measured,
            "target_c": float(target) if target_valid else previous_target,
        }

    async def safe_tool(
        self,
        tool: str,
        arguments: dict[str, Any] | None = None,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        try:
            return {
                "ok": True,
                "result": await self.mcp.call_tool(
                    tool,
                    arguments or {},
                    read_timeout_seconds=timeout_seconds,
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def safe_dashboard_scene(
        self,
        prefer_file: bool = False,
        runtime: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        runtime_session_id = live_runtime_session_id(runtime)
        if live_runtime_system_loaded(runtime) is False:
            return {
                "available": False,
                "reason": "no_system_loaded",
                "system_loaded": False,
                "session_id": runtime_session_id,
            }
        if prefer_file:
            fallback = await self.read_dashboard_scene_snapshot_async(runtime_session_id=runtime_session_id)
            if fallback.get("available"):
                return fallback
        result = await self.safe_tool(
            "dashboard_scene",
            {"max_path_points": 256, "max_droplet_cells": 1024},
        )
        scene = compact_tool_payload(result)
        if isinstance(scene, dict) and "available" in scene:
            if runtime_session_id and scene_session_id(scene) not in {None, runtime_session_id}:
                scene = {
                    "available": False,
                    "reason": "scene_session_mismatch",
                    "session_id": scene_session_id(scene),
                    "runtime_session_id": runtime_session_id,
                }
            else:
                if runtime_session_id and not scene.get("session_id"):
                    scene = dict(scene)
                    scene["session_id"] = runtime_session_id
                if not scene.get("coordinate_mapping"):
                    mapping = self.dashboard_coordinate_mapping()
                    if mapping:
                        scene["coordinate_mapping"] = mapping
                scene = self.attach_cartridge_metadata(scene)
                scene["transport"] = "dashboard_scene_tool"
                return scene
        fallback = await self.read_dashboard_scene_snapshot_async(runtime_session_id=runtime_session_id)
        if fallback is scene:
            fallback = dict(fallback)
        fallback["tool_error"] = scene if isinstance(scene, dict) else result
        return fallback

    async def read_dashboard_scene_snapshot_async(
        self,
        runtime_session_id: str | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.read_dashboard_scene_snapshot,
            runtime_session_id=runtime_session_id,
        )

    def read_dashboard_scene_snapshot(
        self,
        runtime_session_id: str | None = None,
    ) -> dict[str, Any]:
        path = self.config.mcp.env.get("DROPLOGIC_DASHBOARD_SCENE_PATH")
        if not path:
            return {"available": False, "reason": "scene_path_not_configured"}
        scene_path = Path(path)
        if not scene_path.is_file():
            return {"available": False, "reason": "scene_snapshot_not_ready"}
        last_error: Exception | None = None
        scene: Any = None
        for attempt in range(4):
            try:
                with scene_path.open("r", encoding="utf-8") as handle:
                    scene = json.load(handle)
                last_error = None
                break
            except json.JSONDecodeError as exc:
                last_error = exc
                time.sleep(0.03 * (attempt + 1))
            except OSError as exc:
                last_error = exc
                time.sleep(0.03 * (attempt + 1))
        if last_error is not None:
            return {"available": False, "reason": "scene_snapshot_read_error", "error": str(last_error)}
        try:
            if not isinstance(scene, dict):
                return {"available": False, "reason": "scene_snapshot_invalid"}
            snapshot_session_id = scene_session_id(scene)
            if runtime_session_id and snapshot_session_id != runtime_session_id:
                return {
                    "available": False,
                    "reason": "scene_session_mismatch",
                    "session_id": snapshot_session_id,
                    "runtime_session_id": runtime_session_id,
                }
            if runtime_session_id and not scene.get("session_id"):
                scene["session_id"] = runtime_session_id
            if not scene.get("coordinate_mapping"):
                mapping = self.dashboard_coordinate_mapping()
                if mapping:
                    scene["coordinate_mapping"] = mapping
            scene = self.attach_cartridge_metadata(scene)
            scene["transport"] = "dashboard_scene_file"
            return scene
        except Exception as exc:
            return {"available": False, "reason": "scene_snapshot_read_error", "error": str(exc)}

    def attach_cartridge_metadata(self, scene: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(scene, dict) or scene.get("cartridge"):
            return scene
        cartridge = self.load_cartridge_metadata()
        if not cartridge:
            return scene
        next_scene = dict(scene)
        next_scene["cartridge"] = cartridge
        return next_scene

    def load_cartridge_metadata(self) -> dict[str, Any] | None:
        candidates = [
            DROPLOGIC_ROOT / "droplogic" / "mcp" / "context" / "boxmini" / "cartridge.default.json",
            DROPLOGIC_ROOT / "droplogic" / "mcp" / "context" / "cartridge.default.json",
        ]
        for path in candidates:
            if not path.is_file():
                continue
            try:
                stat = path.stat()
                cache_key = (str(path), stat.st_mtime_ns, stat.st_size)
                cached = getattr(self, "_cartridge_metadata_cache", None)
                if isinstance(cached, dict) and cached.get("key") == cache_key:
                    payload = cached.get("payload")
                    return payload if isinstance(payload, dict) else None
                with path.open("r", encoding="utf-8-sig") as handle:
                    payload = json.load(handle)
                if not isinstance(payload, dict):
                    return None
                self._cartridge_metadata_cache = {"key": cache_key, "payload": payload}
                return payload
            except Exception:
                continue
        return None

    def dashboard_coordinate_mapping(self) -> dict[str, Any] | None:
        config_path = DROPLOGIC_ROOT / "config.json"
        if not config_path.is_file():
            return None
        try:
            with config_path.open("r", encoding="utf-8") as handle:
                config = json.load(handle)
        except Exception:
            return None
        if not isinstance(config, dict):
            return None
        calibration = config.get("calibration")
        electrode_mapping = calibration.get("electrode_mapping") if isinstance(calibration, dict) else None
        chip_origin = calibration.get("chip_origin") if isinstance(calibration, dict) else None
        if not isinstance(electrode_mapping, dict) or not isinstance(chip_origin, dict):
            return None

        def number(value: Any, default: Any = None) -> Any:
            if value is None:
                return default
            try:
                parsed = float(value)
            except (TypeError, ValueError):
                return default
            if parsed != parsed or parsed in {float("inf"), float("-inf")}:
                return default
            return int(parsed) if parsed.is_integer() else parsed

        def vector(values: Any) -> list[Any]:
            if not isinstance(values, list):
                return []
            parsed_values = []
            for item in values:
                parsed = number(item)
                if parsed is None:
                    return []
                parsed_values.append(parsed)
            return parsed_values

        origin = {
            axis: parsed
            for axis in ("X", "Y", "Z")
            if (parsed := number(chip_origin.get(axis, chip_origin.get(axis.lower())))) is not None
        }
        inter_row = vector(electrode_mapping.get("inter_row"))
        inter_column = vector(electrode_mapping.get("inter_column"))
        if "X" not in origin or "Y" not in origin or len(inter_row) < 2 or len(inter_column) < 2:
            return None

        electrode_config = config.get("electrode_matrix")
        matrix_shape = None
        if isinstance(electrode_config, dict):
            rows = number(electrode_config.get("rows"))
            columns = number(electrode_config.get("columns"))
            if rows is not None and columns is not None:
                matrix_shape = [int(rows), int(columns)]

        return {
            "kind": "electrode_to_stage_affine",
            "units": "stage_steps",
            "origin_electrode": [0, 0],
            "matrix_shape": matrix_shape,
            "chip_origin": origin,
            "offset": {
                "X": number(electrode_mapping.get("offset_x"), 0),
                "Y": number(electrode_mapping.get("offset_y"), 0),
            },
            "inter_row": inter_row,
            "inter_column": inter_column,
            "source": "dashboard_config_fallback",
        }

    async def safe_frame(
        self,
        visualizer: str,
        frame_source: str,
        max_width: int | None,
        max_height: int | None,
        image_quality: int | None = None,
    ) -> dict[str, Any]:
        arguments: dict[str, Any] = {
            "visualizer": visualizer,
            "frame_source": frame_source,
            "image_format": "jpg",
            "include_base64": True,
            **({"image_quality": int(image_quality)} if image_quality is not None else {}),
        }
        if max_width is not None:
            arguments["max_width"] = max_width
        if max_height is not None:
            arguments["max_height"] = max_height
        result = await self.safe_tool(
            "visualizer_frame",
            arguments,
        )
        if not result.get("ok"):
            return result
        payload = compact_tool_payload(result)
        return payload if isinstance(payload, dict) else {"ok": True, "result": payload}


def unwrap_live_state(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    roots = [
        payload.get("value"),
        get_path(payload, "result.value"),
        payload.get("result"),
        payload,
    ]
    return next((root for root in roots if isinstance(root, dict)), payload)


def live_frame_sequence(frame: Any) -> int | None:
    if not isinstance(frame, dict):
        return None
    roots = [
        frame,
        frame.get("dashboard_live"),
        frame.get("result") if isinstance(frame.get("result"), dict) else None,
    ]
    for root in roots:
        if not isinstance(root, dict):
            continue
        value = root.get("dashboard_live_sequence") or root.get("sequence")
        try:
            sequence = int(value)
        except (TypeError, ValueError):
            continue
        return sequence
    return None


def live_scene_sequence(scene: Any) -> int | None:
    return live_frame_sequence(scene)


def live_frame_captured_at(frame: Any) -> str:
    if not isinstance(frame, dict):
        return ""
    roots = [
        frame,
        frame.get("dashboard_live"),
        frame.get("result") if isinstance(frame.get("result"), dict) else None,
    ]
    for root in roots:
        if not isinstance(root, dict):
            continue
        value = root.get("dashboard_live_captured_at") or root.get("captured_at") or root.get("updated_at")
        if value:
            return str(value)
    return ""


def live_frame_is_newer(candidate: Any, baseline: Any) -> bool:
    candidate_sequence = live_frame_sequence(candidate)
    baseline_sequence = live_frame_sequence(baseline)
    if candidate_sequence is not None and baseline_sequence is not None:
        return candidate_sequence > baseline_sequence
    if candidate_sequence is not None and baseline_sequence is None:
        return True
    if candidate_sequence is None and baseline_sequence is not None:
        return False
    candidate_time = live_frame_captured_at(candidate)
    baseline_time = live_frame_captured_at(baseline)
    return bool(candidate_time and baseline_time and candidate_time > baseline_time)


def attach_matrix_voltage_status(state_payload: Any, voltage_status: Any) -> Any:
    if not isinstance(state_payload, dict):
        return state_payload
    root = state_payload.get("value") if isinstance(state_payload.get("value"), dict) else state_payload
    if not isinstance(root, dict):
        return state_payload
    matrix = root.get("electrode_matrix")
    if not isinstance(matrix, dict):
        return state_payload

    next_state = dict(state_payload)
    next_root = dict(root)
    next_matrix = dict(matrix)
    next_matrix["voltage_status"] = normalize_matrix_voltage_status(voltage_status, matrix)
    next_root["electrode_matrix"] = next_matrix
    if isinstance(next_state.get("value"), dict):
        next_state["value"] = next_root
    else:
        next_state = next_root
    return next_state


def normalize_matrix_voltage_status(voltage_status: Any, matrix: dict[str, Any]) -> dict[str, Any]:
    if isinstance(voltage_status, dict):
        roots = [
            voltage_status,
            voltage_status.get("result"),
            get_path(voltage_status, "structuredContent"),
            get_path(voltage_status, "structuredContent.result"),
        ]
        for root in roots:
            if isinstance(root, dict) and (
                "values" in root or "voltage" in root or "display" in root
            ):
                return root
    fallback = matrix.get("initial_voltages")
    if fallback is None:
        fallback = matrix.get("voltage")
    values = normalize_voltage_values(fallback)
    all_equal = bool(values) and all(value == values[0] for value in values)
    if all_equal:
        display = f"{values[0]} V x{len(values)}"
    elif values:
        display = f"{'/'.join(str(value) for value in values)} V"
    else:
        display = "-"
    return {
        "ok": False,
        "source": "state_fallback",
        "values": values,
        "voltage": values[0] if values else matrix.get("voltage"),
        "count": len(values),
        "all_equal": all_equal,
        "display": display,
    }


def normalize_voltage_values(value: Any) -> list[int]:
    if value is None:
        return []
    if isinstance(value, (int, float, str)):
        try:
            return [int(float(value))]
        except (TypeError, ValueError):
            return []
    if isinstance(value, (list, tuple)):
        values: list[int] = []
        for item in value:
            try:
                values.append(int(float(item)))
            except (TypeError, ValueError):
                continue
        return values
    return []


def streamer_direct_stream_available(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    roots = [
        payload,
        payload.get("result"),
        get_path(payload, "structuredContent.result"),
        get_path(payload, "result.structuredContent.result"),
    ]
    for root in roots:
        if not isinstance(root, dict):
            continue
        stream = get_path(root, "streamer.stream")
        if isinstance(stream, dict) and stream.get("available") and stream.get("url"):
            return True
    return False


def scene_snapshot_key(scene: Any) -> str:
    if not isinstance(scene, dict):
        return ""
    frame = scene.get("frame") if isinstance(scene.get("frame"), dict) else {}
    summary = frame.get("summary") if isinstance(frame.get("summary"), dict) else {}
    executor = scene.get("executor") if isinstance(scene.get("executor"), dict) else {}
    return ":".join(
        str(item)
        for item in (
            scene.get("session_id"),
            frame.get("source"),
            frame.get("index"),
            frame.get("count"),
            summary.get("active_mask_sha256"),
            summary.get("matrix_values_sha256"),
            executor.get("current_frame"),
            executor.get("frames_executed"),
            scene.get("updated_at"),
        )
    )


def extract_live_temperature(root: Any) -> float | None:
    for candidate_root in live_payload_roots(root):
        value = first_number(
            get_path(candidate_root, "temperature.current"),
            get_path(candidate_root, "temperature.current_c"),
            get_path(candidate_root, "temperature.value"),
            get_path(candidate_root, "temperature.temperature"),
            get_path(candidate_root, "temperature.current_temperature"),
            get_path(candidate_root, "current_temperature"),
            get_path(candidate_root, "measured_temperature"),
            get_path(candidate_root, "temperature_c"),
            get_path(candidate_root, "measured_c"),
        )
        if is_valid_live_temperature(value):
            return value
        temperature = get_path(candidate_root, "temperature")
        if isinstance(temperature, dict):
            for key, nested in temperature.items():
                if any(token in key.lower() for token in ("target", "tarjet", "setpoint", "limit", "port", "version")):
                    continue
                number = number_or_none(nested)
                if is_valid_live_temperature(number):
                    return number
    return None


def extract_live_temperature_target(root: Any) -> float | None:
    for candidate_root in live_payload_roots(root):
        value = first_number(
            get_path(candidate_root, "temperature.target"),
            get_path(candidate_root, "temperature.tarjet"),
            get_path(candidate_root, "temperature.target_c"),
            get_path(candidate_root, "temperature.tarjet_c"),
            get_path(candidate_root, "temperature.target_temperature"),
            get_path(candidate_root, "temperature.tarjet_temperature"),
            get_path(candidate_root, "temperature.setpoint"),
            get_path(candidate_root, "temperature.setpoint_c"),
            get_path(candidate_root, "target_c"),
            get_path(candidate_root, "tarjet_c"),
            get_path(candidate_root, "target_temperature"),
            get_path(candidate_root, "tarjet_temperature"),
            get_path(candidate_root, "target"),
            get_path(candidate_root, "tarjet"),
            get_path(candidate_root, "setpoint"),
        )
        if is_valid_live_temperature_target(value):
            return value
        temperature = get_path(candidate_root, "temperature")
        if isinstance(temperature, dict):
            for key, nested in temperature.items():
                if any(token in key.lower() for token in ("target", "tarjet", "setpoint")):
                    number = number_or_none(nested)
                    if is_valid_live_temperature_target(number):
                        return number
    return None


def live_payload_roots(root: Any) -> list[Any]:
    roots: list[Any] = []
    if isinstance(root, dict):
        roots.extend([
            root,
            root.get("value"),
            root.get("result"),
            get_path(root, "result.value"),
            get_path(root, "structuredContent"),
            get_path(root, "structuredContent.result"),
        ])
    return [item for item in roots if isinstance(item, dict)]


def live_runtime_session_id(root: Any) -> str | None:
    for candidate_root in live_payload_roots(root):
        value = first_defined(
            candidate_root.get("session_id"),
            get_path(candidate_root, "runtime.session_id"),
            get_path(candidate_root, "result.session_id"),
            get_path(candidate_root, "structuredContent.result.session_id"),
        )
        if value:
            return str(value)
    return None


def runtime_with_scene_session(runtime: Any, scene: Any) -> Any:
    session_id = scene_session_id(scene)
    if not session_id:
        return runtime
    if not isinstance(runtime, dict):
        return {"session_id": session_id}
    if live_runtime_session_id(runtime) == session_id:
        return runtime
    updated = dict(runtime)
    updated["session_id"] = session_id
    for key in ("result", "value"):
        nested = updated.get(key)
        if isinstance(nested, dict):
            nested_copy = dict(nested)
            nested_copy["session_id"] = session_id
            updated[key] = nested_copy
    structured = updated.get("structuredContent")
    if isinstance(structured, dict):
        structured_copy = dict(structured)
        structured_result = structured_copy.get("result")
        if isinstance(structured_result, dict):
            structured_result_copy = dict(structured_result)
            structured_result_copy["session_id"] = session_id
            structured_copy["result"] = structured_result_copy
        updated["structuredContent"] = structured_copy
    return updated


def live_runtime_system_loaded(root: Any) -> bool | None:
    for candidate_root in live_payload_roots(root):
        value = first_defined(
            get_path(candidate_root, "system.loaded"),
            get_path(candidate_root, "result.system.loaded"),
            get_path(candidate_root, "structuredContent.result.system.loaded"),
        )
        if isinstance(value, bool):
            return value
    return None


def scene_session_id(scene: Any) -> str | None:
    if not isinstance(scene, dict):
        return None
    value = first_defined(
        scene.get("session_id"),
        get_path(scene, "runtime.session_id"),
        get_path(scene, "executor.session_id"),
    )
    return str(value) if value else None


def get_path(root: Any, path: str) -> Any:
    current = root
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def first_defined(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def first_number(*values: Any) -> float | None:
    for value in values:
        number = number_or_none(value)
        if number is not None:
            return number
    return None


def number_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def is_finite_number(value: Any) -> bool:
    return number_or_none(value) is not None


def is_valid_live_temperature(value: Any) -> bool:
    number = number_or_none(value)
    if number is None:
        return False
    if is_missing_temperature_sentinel(number):
        return False
    return -50 < number < 180


def is_valid_live_temperature_target(value: Any) -> bool:
    number = number_or_none(value)
    if number is None:
        return False
    if is_missing_temperature_sentinel(number):
        return False
    return -50 < number < 180


def is_missing_temperature_sentinel(value: Any) -> bool:
    number = number_or_none(value)
    if number is None:
        return False
    return abs(number) < 1e-9 or abs(number + 1) < 1e-9
