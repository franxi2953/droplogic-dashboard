from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

from .config import DROPLOGIC_ROOT


DEFAULT_CONFIG_PATH = DROPLOGIC_ROOT / "config.json"
DEFAULT_CARTRIDGE_RELATIVE_PATH = "cartridge.default.json"
DEFAULT_COAXIAL_INTENSITY = 10
DEFAULT_EXPOSURE_US = 16000
SPEEDS = {
    "1": ("fine", 200.0, 2000.0),
    "2": ("medium", 1000.0, 10000.0),
    "3": ("fast", 5000.0, 100000.0),
}

DEFAULT_CARTRIDGE_TEMPLATE = {
    "name": "boxmini_default",
    "system": "boxmini",
    "version": 1,
    "notes": "",
    "matrix": {
        "rows": 128,
        "columns": 128,
    },
    "coordinate_system": {
        "origin": "top-left",
        "row_direction": "down",
        "column_direction": "right",
    },
    "input_holes": [],
    "usable_regions": [],
    "no_go_regions": [],
}


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


def resolve_cartridge_path(
    context_roots: list[Path] | None = None,
    relative_path: str = DEFAULT_CARTRIDGE_RELATIVE_PATH,
) -> Path:
    clean_relative = str(relative_path or DEFAULT_CARTRIDGE_RELATIVE_PATH).replace("\\", "/").strip("/") or DEFAULT_CARTRIDGE_RELATIVE_PATH
    roots = [Path(root).resolve() for root in (context_roots or []) if root]
    if not roots:
        roots = [DROPLOGIC_ROOT / "droplogic" / "mcp" / "context" / "boxmini"]
    for root in roots:
        candidate = (root / clean_relative).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            continue
        if candidate.is_file():
            return candidate
    primary_root = roots[0].resolve()
    return (primary_root / clean_relative).resolve()


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


def ensure_cartridge_shape(data: dict[str, Any], rows: int = 128, columns: int = 128) -> None:
    for key, value in DEFAULT_CARTRIDGE_TEMPLATE.items():
        if key not in data:
            data[key] = copy.deepcopy(value)
    matrix = data.setdefault("matrix", {})
    if not isinstance(matrix, dict):
        matrix = {}
        data["matrix"] = matrix
    matrix.setdefault("rows", int(rows))
    matrix.setdefault("columns", int(columns))
    coordinate_system = data.setdefault("coordinate_system", {})
    if not isinstance(coordinate_system, dict):
        coordinate_system = {}
        data["coordinate_system"] = coordinate_system
    coordinate_system.setdefault("origin", "top-left")
    coordinate_system.setdefault("row_direction", "down")
    coordinate_system.setdefault("column_direction", "right")
    for list_key in ("input_holes", "usable_regions", "no_go_regions"):
        value = data.get(list_key)
        if not isinstance(value, list):
            data[list_key] = []


def stage_to_electrode_float(position: dict[str, Any], calibration: dict[str, Any]) -> tuple[float, float] | None:
    if not isinstance(position, dict) or not isinstance(calibration, dict):
        return None
    mapping = calibration.get("electrode_mapping")
    origin = calibration.get("chip_origin")
    if not isinstance(mapping, dict) or not isinstance(origin, dict):
        return None
    inter_row = list(mapping.get("inter_row") or [])
    inter_column = list(mapping.get("inter_column") or [])
    if len(inter_row) < 2 or len(inter_column) < 2:
        return None
    try:
        stage_x = float(position.get("X"))
        stage_y = float(position.get("Y"))
        origin_x = float(origin.get("X"))
        origin_y = float(origin.get("Y"))
    except (TypeError, ValueError):
        return None
    offset_x = float(mapping.get("offset_x", 0) or 0)
    offset_y = float(mapping.get("offset_y", 0) or 0)
    delta_x = stage_x - origin_x - offset_x
    delta_y = stage_y - origin_y - offset_y
    row_x = float(inter_row[0])
    row_y = float(inter_row[1])
    col_x = float(inter_column[0])
    col_y = float(inter_column[1])
    determinant = row_x * col_y - col_x * row_y
    if abs(determinant) < 1e-12:
        return None
    row = (delta_x * col_y - col_x * delta_y) / determinant
    col = (row_x * delta_y - delta_x * row_y) / determinant
    if not (row == row and col == col):
        return None
    return row, col


def normalize_input_hole_bounds(region: dict[str, Any], rows: int, columns: int) -> dict[str, int] | None:
    if not isinstance(region, dict):
        return None

    def clamp_int(value: Any, lower: int, upper: int) -> int | None:
        try:
            parsed = int(round(float(value)))
        except (TypeError, ValueError):
            return None
        return max(lower, min(upper, parsed))

    row_min = row_max = col_min = col_max = None
    row_range = region.get("rows")
    col_range = region.get("columns")
    if isinstance(row_range, list) and row_range:
        if len(row_range) == 1:
            row_min = row_max = clamp_int(row_range[0], 0, rows - 1)
        else:
            row_min = clamp_int(row_range[0], 0, rows - 1)
            row_max = clamp_int(row_range[1], 0, rows - 1)
    if isinstance(col_range, list) and col_range:
        if len(col_range) == 1:
            col_min = col_max = clamp_int(col_range[0], 0, columns - 1)
        else:
            col_min = clamp_int(col_range[0], 0, columns - 1)
            col_max = clamp_int(col_range[1], 0, columns - 1)
    if row_min is None:
        single_row = region.get("row")
        if single_row is not None:
            row_min = row_max = clamp_int(single_row, 0, rows - 1)
    if col_min is None:
        single_col = region.get("column")
        if single_col is not None:
            col_min = col_max = clamp_int(single_col, 0, columns - 1)
    row_min = row_min if row_min is not None else clamp_int(region.get("row_min"), 0, rows - 1)
    row_max = row_max if row_max is not None else clamp_int(region.get("row_max"), 0, rows - 1)
    col_min = col_min if col_min is not None else clamp_int(region.get("column_min"), 0, columns - 1)
    col_max = col_max if col_max is not None else clamp_int(region.get("column_max"), 0, columns - 1)
    if None in {row_min, row_max, col_min, col_max}:
        return None
    return {
        "row_min": min(row_min, row_max),
        "row_max": max(row_min, row_max),
        "column_min": min(col_min, col_max),
        "column_max": max(col_min, col_max),
    }


def compact_input_hole_region(bounds: dict[str, int]) -> dict[str, Any]:
    row_min = int(bounds["row_min"])
    row_max = int(bounds["row_max"])
    col_min = int(bounds["column_min"])
    col_max = int(bounds["column_max"])
    if col_min == col_max:
        return {
            "column": col_min,
            "rows": [row_min, row_max],
        }
    if row_min == row_max:
        return {
            "row": row_min,
            "columns": [col_min, col_max],
        }
    return {
        "row_min": row_min,
        "row_max": row_max,
        "column_min": col_min,
        "column_max": col_max,
    }


def default_input_hole(side: str, index: int = 0) -> dict[str, Any]:
    side_key = str(side or "left").strip().lower() or "left"
    label = f"{side_key}_{index + 1}"
    return {
        "id": label,
        "role": "manual_injection",
        "side": side_key,
        "electrode_region": {
            "column": 0 if side_key == "left" else 127 if side_key == "right" else 64,
            "rows": [0, 0],
        },
        "notes": "",
    }


def rounded_position(position: dict[str, Any] | None) -> dict[str, int]:
    position = position or {}
    return {
        axis: int(round(float(position.get(axis, 0))))
        for axis in ("X", "Y", "Z")
    }


class DashboardCalibrationSession:
    def __init__(
        self,
        config_path: Path | None = None,
        cartridge_path: Path | None = None,
        context_roots: list[Path] | None = None,
    ) -> None:
        self.config_path = (config_path or resolve_config_path()).resolve()
        self.config_data = load_config(self.config_path)
        ensure_calibration_shape(self.config_data)
        self.context_roots = [Path(root).resolve() for root in (context_roots or []) if root]
        self.cartridge_path = (
            Path(cartridge_path).resolve()
            if cartridge_path is not None
            else resolve_cartridge_path(self.context_roots)
        )
        if self.cartridge_path.is_file():
            self.cartridge_data = load_config(self.cartridge_path)
        else:
            self.cartridge_data = copy.deepcopy(DEFAULT_CARTRIDGE_TEMPLATE)
        ensure_cartridge_shape(self.cartridge_data, rows=self.rows, columns=self.columns)
        self.travel_config_data = copy.deepcopy(self.config_data)
        self.reference_points: dict[str, dict[str, int]] = {}
        self.guided_index = 0
        self.workflow_complete = False
        self.status_message = "Ready"
        self.speed_key = "2"
        self.previous_motion_params: dict[str, float] | None = None
        self.mode = "focus"
        self.selected_hole_id = self._first_input_hole_id()

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
            {"key": "origin", "label": "electrode (0,0)", "row": 0, "column": 0},
            {"key": "row", "label": f"electrode ({self.rows - 1},0)", "row": self.rows - 1, "column": 0},
            {"key": "column", "label": f"electrode (0,{self.columns - 1})", "row": 0, "column": self.columns - 1},
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

    def set_speed(self, speed_key: str) -> dict[str, Any]:
        key = str(speed_key or "2")
        if key not in SPEEDS:
            key = "2"
        self.speed_key = key
        return self.state()

    def set_mode(self, mode: str) -> dict[str, Any]:
        normalized = str(mode or "focus").strip().lower()
        if normalized not in {"focus", "injection_holes"}:
            normalized = "focus"
        self.mode = normalized
        if self.mode == "focus":
            self.status_message = "Ready"
        else:
            self.status_message = "Editing injection holes"
            if not self.selected_hole_id:
                self.selected_hole_id = self._first_input_hole_id()
        return self.state()

    def set_previous_motion_params(self, params: dict[str, Any] | None) -> None:
        if not isinstance(params, dict):
            self.previous_motion_params = None
            return
        velocity = positive_float_or_none(params.get("velocity") or params.get("dMaxV"))
        acceleration = positive_float_or_none(params.get("acceleration") or params.get("dMaxA"))
        if velocity is None or acceleration is None:
            self.previous_motion_params = None
            return
        self.previous_motion_params = {
            "velocity": velocity,
            "acceleration": acceleration,
        }

    @property
    def speed_name(self) -> str:
        return SPEEDS.get(self.speed_key, SPEEDS["2"])[0]

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

    def save_cartridge(self) -> None:
        ensure_cartridge_shape(self.cartridge_data, rows=self.rows, columns=self.columns)
        save_config(self.cartridge_path, self.cartridge_data)

    def input_holes(self) -> list[dict[str, Any]]:
        holes = self.cartridge_data.get("input_holes")
        return holes if isinstance(holes, list) else []

    def _first_input_hole_id(self) -> str:
        for hole in self.input_holes():
            hole_id = str(hole.get("id") or "").strip()
            if hole_id:
                return hole_id
        return ""

    def selected_input_hole(self) -> dict[str, Any] | None:
        selected_id = str(self.selected_hole_id or "").strip()
        holes = self.input_holes()
        if selected_id:
            for hole in holes:
                if str(hole.get("id") or "").strip() == selected_id:
                    return hole
        if holes:
            self.selected_hole_id = str(holes[0].get("id") or "").strip()
            return holes[0]
        return None

    def select_input_hole(self, hole_id: str) -> dict[str, Any]:
        target_id = str(hole_id or "").strip()
        if target_id:
            for hole in self.input_holes():
                if str(hole.get("id") or "").strip() == target_id:
                    self.selected_hole_id = target_id
                    self.status_message = f"Selected {target_id}"
                    return self.state()
        self.status_message = "Requested hole not found"
        return self.state(error="Input hole not found.")

    def create_input_hole(self, side: str = "left") -> dict[str, Any]:
        holes = self.input_holes()
        existing_ids = {str(hole.get("id") or "").strip() for hole in holes}
        index = len(holes)
        hole = default_input_hole(side, index=index)
        while str(hole["id"]) in existing_ids:
            index += 1
            hole = default_input_hole(side, index=index)
        holes.append(hole)
        self.selected_hole_id = str(hole["id"])
        self.status_message = f"Created {hole['id']}"
        return self.state()

    def delete_selected_input_hole(self) -> dict[str, Any]:
        selected = self.selected_input_hole()
        if selected is None:
            return self.state(error="No input hole selected.")
        holes = self.input_holes()
        holes[:] = [hole for hole in holes if hole is not selected]
        self.selected_hole_id = self._first_input_hole_id()
        self.status_message = "Deleted selected hole"
        return self.state()

    def update_selected_input_hole(
        self,
        *,
        hole_id: str | None = None,
        side: str | None = None,
        role: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        selected = self.selected_input_hole()
        if selected is None:
            return self.state(error="No input hole selected.")
        holes = self.input_holes()
        if hole_id is not None:
            clean_id = str(hole_id).strip()
            if not clean_id:
                return self.state(error="Input hole id cannot be empty.")
            for hole in holes:
                if hole is selected:
                    continue
                if str(hole.get("id") or "").strip() == clean_id:
                    return self.state(error=f"Input hole id {clean_id!r} already exists.")
            selected["id"] = clean_id
            self.selected_hole_id = clean_id
        if side is not None:
            selected["side"] = str(side).strip().lower() or "left"
        if role is not None:
            selected["role"] = str(role).strip() or "manual_injection"
        if notes is not None:
            selected["notes"] = str(notes)
        self.status_message = f"Updated {self.selected_hole_id or 'input hole'}"
        return self.state()

    def capture_selected_input_hole_endpoint(self, endpoint: str, position: dict[str, Any]) -> dict[str, Any]:
        selected = self.selected_input_hole()
        if selected is None:
            return self.state(error="No input hole selected.")
        electrode = self.stage_position_to_electrode(position)
        if electrode is None:
            return self.state(error="Could not convert stage position to an electrode coordinate.")
        bounds = self.input_hole_bounds(selected)
        if bounds is None:
            bounds = {
                "row_min": int(electrode["row"]),
                "row_max": int(electrode["row"]),
                "column_min": int(electrode["column"]),
                "column_max": int(electrode["column"]),
            }
        point_row = int(electrode["row"])
        point_col = int(electrode["column"])
        clean_endpoint = str(endpoint or "").strip().lower()
        if clean_endpoint == "start":
            bounds["row_min"] = point_row
            bounds["column_min"] = point_col
        elif clean_endpoint == "end":
            bounds["row_max"] = point_row
            bounds["column_max"] = point_col
        else:
            return self.state(error=f"Unsupported endpoint {endpoint!r}.")
        normalized = {
            "row_min": min(bounds["row_min"], bounds["row_max"]),
            "row_max": max(bounds["row_min"], bounds["row_max"]),
            "column_min": min(bounds["column_min"], bounds["column_max"]),
            "column_max": max(bounds["column_min"], bounds["column_max"]),
        }
        selected["electrode_region"] = compact_input_hole_region(normalized)
        self.status_message = (
            f"Captured {clean_endpoint} for {self.selected_hole_id or selected.get('id') or 'input hole'} "
            f"at ({point_row}, {point_col})"
        )
        return self.state(position=position)

    def stage_position_to_electrode(self, position: dict[str, Any]) -> dict[str, Any] | None:
        coordinates = stage_to_electrode_float(position, self.config_data.get("calibration") or {})
        if coordinates is None:
            return None
        row_f, col_f = coordinates
        row = int(round(row_f))
        col = int(round(col_f))
        if not (0 <= row < self.rows and 0 <= col < self.columns):
            return None
        return {
            "row": row,
            "column": col,
            "row_float": row_f,
            "column_float": col_f,
        }

    def input_hole_bounds(self, hole: dict[str, Any] | None) -> dict[str, int] | None:
        if not isinstance(hole, dict):
            return None
        region = hole.get("electrode_region")
        if not isinstance(region, dict):
            return None
        return normalize_input_hole_bounds(region, self.rows, self.columns)

    def input_holes_state(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        selected_id = str(self.selected_hole_id or "").strip()
        for hole in self.input_holes():
            if not isinstance(hole, dict):
                continue
            item = copy.deepcopy(hole)
            item["selected"] = str(item.get("id") or "").strip() == selected_id
            item["electrode_bounds"] = self.input_hole_bounds(item)
            items.append(item)
        return items

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
        selected_hole = self.selected_input_hole()
        current_electrode = self.stage_position_to_electrode(position) if position else None
        return {
            "active": True,
            "mode": self.mode,
            "preparing": preparing,
            "error": error,
            "config_path": str(self.config_path),
            "cartridge_path": str(self.cartridge_path),
            "rows": self.rows,
            "columns": self.columns,
            "guided_index": self.guided_index,
            "step_count": len(self.guided_steps),
            "current_step": copy.deepcopy(step),
            "target_position": target,
            "position": rounded_position(position) if position else None,
            "current_electrode": copy.deepcopy(current_electrode),
            "reference_points": copy.deepcopy(self.reference_points),
            "workflow_complete": self.workflow_complete,
            "status": self.status_message,
            "speed_key": self.speed_key,
            "speed_name": self.speed_name,
            "previous_motion_params": copy.deepcopy(self.previous_motion_params),
            "speeds": {
                key: {
                    "name": name,
                    "velocity": velocity,
                    "acceleration": acceleration,
                }
                for key, (name, velocity, acceleration) in SPEEDS.items()
            },
            "calibration": copy.deepcopy(self.config_data.get("calibration") or {}),
            "input_holes": self.input_holes_state(),
            "selected_input_hole_id": str(self.selected_hole_id or ""),
            "selected_input_hole": copy.deepcopy(selected_hole) if selected_hole else None,
            "optics": {
                "coaxial_intensity": DEFAULT_COAXIAL_INTENSITY,
                "exposure_time": DEFAULT_EXPOSURE_US,
            },
        }


def positive_float_or_none(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed or parsed <= 0:
        return None
    return parsed
