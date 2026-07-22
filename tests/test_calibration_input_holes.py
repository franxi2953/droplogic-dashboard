from __future__ import annotations

import unittest

from backend.calibration import DashboardCalibrationSession


class InputHoleCaptureTests(unittest.TestCase):
    def test_first_capture_replaces_new_hole_placeholder(self) -> None:
        session = object.__new__(DashboardCalibrationSession)
        session.cartridge_data = {"input_holes": []}
        session.config_data = {"electrode_matrix": {"rows": 128, "columns": 128}}
        session.selected_hole_id = ""
        session.status_message = ""
        session._uncaptured_input_holes = set()
        session.state = lambda **values: values

        session.create_input_hole("left")
        session.update_selected_input_hole(hole_id="renamed_hole")
        point = {"row": 20, "column": 5}
        session.stage_position_to_electrode = lambda _position: point

        session.capture_selected_input_hole_endpoint("start", {})

        hole = session.selected_input_hole()
        self.assertEqual(hole["electrode_region"], {"column": 5, "rows": [20, 20]})

        point = {"row": 30, "column": 8}
        session.capture_selected_input_hole_endpoint("end", {})
        self.assertEqual(
            hole["electrode_region"],
            {"row_min": 20, "row_max": 30, "column_min": 5, "column_max": 8},
        )


if __name__ == "__main__":
    unittest.main()
