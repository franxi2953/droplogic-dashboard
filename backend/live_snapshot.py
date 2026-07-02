from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DROPLOGIC_ROOT
from .tool_payloads import compact_tool_payload


class LiveSnapshotMixin:
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
        streamer_options = getattr(self, "streamer_frame_options", {}) or {}
        streamer_max_width = int(streamer_options.get("max_width") or 720)
        streamer_max_height = int(streamer_options.get("max_height") or 460)
        frames = {
            "matrix": await self.safe_frame("matrix", "snapshot", max_width=520, max_height=360),
            "streamer": await self.safe_frame(
                "streamer",
                "snapshot",
                max_width=streamer_max_width,
                max_height=streamer_max_height,
            ),
        }
        scene = await self.safe_dashboard_scene()
        return {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "runtime": runtime,
            "state": state,
            "visualizers": visualizer_status,
            "scene": scene,
            "frames": frames,
        }

    async def safe_tool(self, tool: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            return {"ok": True, "result": await self.mcp.call_tool(tool, arguments or {})}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def safe_dashboard_scene(self) -> dict[str, Any]:
        result = await self.safe_tool(
            "dashboard_scene",
            {"max_path_points": 256, "max_droplet_cells": 1024},
        )
        scene = compact_tool_payload(result)
        if isinstance(scene, dict) and "available" in scene:
            if not scene.get("coordinate_mapping"):
                mapping = self.dashboard_coordinate_mapping()
                if mapping:
                    scene["coordinate_mapping"] = mapping
            scene["transport"] = "dashboard_scene_tool"
            return scene

        fallback = self.read_dashboard_scene_snapshot()
        fallback["tool_error"] = scene if isinstance(scene, dict) else result
        return fallback

    def read_dashboard_scene_snapshot(self) -> dict[str, Any]:
        path = self.config.mcp.env.get("DROPLOGIC_DASHBOARD_SCENE_PATH")
        if not path:
            return {"available": False, "reason": "scene_path_not_configured"}
        scene_path = Path(path)
        if not scene_path.is_file():
            return {"available": False, "reason": "scene_snapshot_not_ready"}
        try:
            with scene_path.open("r", encoding="utf-8") as handle:
                scene = json.load(handle)
            if not isinstance(scene, dict):
                return {"available": False, "reason": "scene_snapshot_invalid"}
            if not scene.get("coordinate_mapping"):
                mapping = self.dashboard_coordinate_mapping()
                if mapping:
                    scene["coordinate_mapping"] = mapping
            scene["transport"] = "dashboard_scene_file"
            return scene
        except Exception as exc:
            return {"available": False, "reason": "scene_snapshot_read_error", "error": str(exc)}

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
