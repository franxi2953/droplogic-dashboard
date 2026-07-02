from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

from .config import DROPLOGIC_ROOT


DEFAULT_CONFIG_PATH = DROPLOGIC_ROOT / "config.json"
DEFAULT_COAXIAL_INTENSITY = 10
DEFAULT_EXPOSURE_US = 10000


def load_config(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_config(path: Path, data: dict[str, Any]) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=4)
        handle.write("\n")
    os.replace(temp_path, path)


def resolve_config_path() -> Path:
    env_config = os.environ.get("DROPLOGIC_CONFIG")
    if env_config:
        return Path(env_config).expanduser().resolve()
    return DEFAULT_CONFIG_PATH.resolve()


def ensure_calibration_shape(data: dict[str, Any]) -> None:
    calibration = data.setdefault("calibration", {})
    calibration.setdefault("chip_origin", {"X": 0, "Y": 0, "Z": 0})
    mapping = calibration.setdefault("electrode_mapping", {})
    mapping.setdefault("offset_x", 0)
    mapping.setdefault("offset_y", 0)
    mapping.setdefault("inter_row", [0, 0, 0])
    mapping.setdefault("inter_column", [0, 0, 0])
    for key in ("inter_row", "inter_column"):
        values = list(mapping.get(key, [0, 0, 0]))
        while len(values) < 3:
            values.append(0)
        mapping[key] = values[:3]


def rounded_position(position: dict[str, Any] | None) -> dict[str, int]:
    position = position or {}
    return {
        axis: int(round(float(position.get(axis, 0))))
        for axis in ("X", "Y", "Z")
    }


class DashboardCalibrationSession:
    def __init__(self, config_path: Path | None = None) -> None:
        self.config_path = (config_path or resolve_config_path()).resolve()
        self.config_data = load_config(self.config_path)
        ensure_calibration_shape(self.config_data)
        self.travel_config_data = copy.deepcopy(self.config_data)
        self.reference_points: dict[str, dict[str, int]] = {}
        self.guided_index = 0
        self.workflow_complete = False
        self.status_message = "Ready"

    @property
    def rows(self) -> int:
        return int((self.config_data.get("electrode_matrix") or {}).get("rows") or 128)

    @property
    def columns(self) -> int:
        return int((self.config_data.get("electrode_matrix") or {}).get("columns") or 128)

    @property
    def current_origin(self) -> dict[str, int]:
        return rounded_position(self.config_data["calibration"].get("chip_origin"))

    @property
    def guided_steps(self) -> list[dict[str, Any]]:
        return [
            {"key": "origin", "label": "0,0", "row": 0, "column": 0},
            {"key": "row", "label": f"{self.rows - 1},0", "row": self.rows - 1, "column": 0},
            {"key": "column", "label": f"0,{self.columns - 1}", "row": 0, "column": self.columns - 1},
        ]

    @property
    def current_step(self) -> dict[str, Any] | None:
        if self.guided_index >= len(self.guided_steps):
            return None
        return self.guided_steps[self.guided_index]

    def target_for_current_step(self) -> dict[str, int] | None:
        step = self.current_step
        if step is None:
            return None
        if step["key"] == "origin":
            return self.current_origin
        return self.electrode_to_stage(step["row"], step["column"], self.travel_config_data)

    def electrode_to_stage(
        self,
        row: int,
        column: int,
        data: dict[str, Any] | None = None,
    ) -> dict[str, int]:
        data = data or self.config_data
        mapping = data["calibration"]["electrode_mapping"]
        origin = data["calibration"]["chip_origin"]
        inter_row = mapping["inter_row"]
        inter_column = mapping["inter_column"]
        return {
            "X": int(round(float(origin["X"]) + row * inter_row[0] + column * inter_column[0])),
            "Y": int(round(float(origin["Y"]) + row * inter_row[1] + column * inter_column[1])),
            "Z": int(round(float(origin["Z"]) + row * inter_row[2] + column * inter_column[2])),
        }

    def record_current_step(self, position: dict[str, Any]) -> dict[str, Any]:
        point = rounded_position(position)
        step = self.current_step
        if step is None:
            self.save()
            self.status_message = "Saved"
            return self.state(position=point)

        key = step["key"]
        self.reference_points[key] = point
        if key == "origin":
            self.config_data["calibration"]["chip_origin"] = point
            self.travel_config_data["calibration"]["chip_origin"] = copy.deepcopy(point)
            self.config_data["calibration"]["electrode_mapping"]["offset_x"] = 0
            self.config_data["calibration"]["electrode_mapping"]["offset_y"] = 0
        else:
            self._recalculate_mapping_if_possible()

        self.guided_index += 1
        next_step = self.current_step
        if next_step is None:
            self.workflow_complete = True
            self.save()
            self.status_message = f"Complete; saved to {self.config_path}"
        else:
            self.status_message = f"Recorded {step['label']}"
        return self.state(position=point)

    def save(self) -> None:
        self._recalculate_mapping_if_possible()
        save_config(self.config_path, self.config_data)

    def _recalculate_mapping_if_possible(self) -> None:
        origin = self.reference_points.get("origin") or self.current_origin
        mapping = self.config_data["calibration"]["electrode_mapping"]

        row_reference = self.reference_points.get("row")
        if row_reference is not None and self.rows > 1:
            intervals = self.rows - 1
            mapping["inter_row"] = [
                (row_reference[axis] - origin[axis]) / intervals
                for axis in ("X", "Y", "Z")
            ]

        column_reference = self.reference_points.get("column")
        if column_reference is not None and self.columns > 1:
            intervals = self.columns - 1
            mapping["inter_column"] = [
                (column_reference[axis] - origin[axis]) / intervals
                for axis in ("X", "Y", "Z")
            ]

    def state(
        self,
        *,
        position: dict[str, Any] | None = None,
        preparing: bool = False,
        error: str | None = None,
    ) -> dict[str, Any]:
        step = self.current_step
        target = self.target_for_current_step()
        return {
            "active": True,
            "preparing": preparing,
            "error": error,
            "config_path": str(self.config_path),
            "rows": self.rows,
            "columns": self.columns,
            "guided_index": self.guided_index,
            "step_count": len(self.guided_steps),
            "current_step": copy.deepcopy(step),
            "target_position": target,
            "position": rounded_position(position) if position else None,
            "reference_points": copy.deepcopy(self.reference_points),
            "workflow_complete": self.workflow_complete,
            "status": self.status_message,
            "calibration": copy.deepcopy(self.config_data.get("calibration") or {}),
            "optics": {
                "coaxial_intensity": DEFAULT_COAXIAL_INTENSITY,
                "exposure_time": DEFAULT_EXPOSURE_US,
            },
        }
