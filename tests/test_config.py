from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.config import load_config


class CockpitConfigTests(unittest.TestCase):
    def test_scene_interval_config_controls_dashboard_scene_publisher_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "live_scene_interval_seconds": 0.2,
                        "mcp": {"env": {"PYTHONPATH": "../DropLogic"}},
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_AI_CONFIG": str(Path(temp_dir) / "missing-ai-config.json"),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-ai-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertEqual(config.live_scene_interval_seconds, 0.2)
        self.assertEqual(config.mcp.env["DROPLOGIC_DASHBOARD_SCENE_INTERVAL_SECONDS"], "0.2")
        self.assertEqual(config.mcp.env["DROPLOGIC_DASHBOARD_STATE_INTERVAL_SECONDS"], "1.0")

    def test_scene_interval_env_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text("{}", encoding="utf-8")

            with patch.dict(
                "os.environ",
                {
                    "COCKPIT_LIVE_SCENE_INTERVAL_SECONDS": "0.05",
                    "DASHBOARD_AI_CONFIG": str(Path(temp_dir) / "missing-ai-config.json"),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-ai-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertEqual(config.live_scene_interval_seconds, 0.05)
        self.assertEqual(config.mcp.env["DROPLOGIC_DASHBOARD_SCENE_INTERVAL_SECONDS"], "0.05")
        self.assertEqual(config.mcp.env["DROPLOGIC_DASHBOARD_STATE_INTERVAL_SECONDS"], "1.0")


if __name__ == "__main__":
    unittest.main()
