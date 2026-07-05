from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import server as backend_server
from backend.server import resolve_run_artifact_path


class RunArtifactPathTests(unittest.TestCase):
    def make_run(self, root: Path) -> tuple[Path, str, Path]:
        runs_dir = root / "runs"
        run_id = "run-1"
        run_dir = runs_dir / run_id
        run_dir.mkdir(parents=True)
        return runs_dir, run_id, run_dir

    def write_events(self, run_dir: Path, *events: dict[str, object]) -> None:
        payload = "\n".join(json.dumps(event, ensure_ascii=True) for event in events)
        (run_dir / "events.jsonl").write_text(payload + "\n", encoding="utf-8")

    def test_run_local_artifact_still_resolves_without_event_ref(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            runs_dir, run_id, run_dir = self.make_run(root)
            artifact = run_dir / "artifacts" / "visualizers" / "frame.png"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"png")

            resolved = resolve_run_artifact_path(runs_dir, run_id, "artifacts/visualizers/frame.png")

            self.assertEqual(resolved, artifact.resolve())

    def test_referenced_external_artifact_resolves(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            runs_dir, run_id, run_dir = self.make_run(root)
            capture_root = root / "captures"
            artifact = capture_root / "frame.png"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"png")
            self.write_events(
                run_dir,
                {
                    "type": "mcp_tool_result",
                    "result": {
                        "artifact": {
                            "absolute_path": str(artifact),
                            "mime_type": "image/png",
                        }
                    },
                },
            )

            with patch.dict(os.environ, {"DROPLOGIC_CAPTURE_ROOT": str(capture_root)}):
                resolved = resolve_run_artifact_path(runs_dir, run_id, "", str(artifact))

            self.assertEqual(resolved, artifact.resolve())

    def test_referenced_nested_capture_resolves(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            runs_dir, run_id, run_dir = self.make_run(root)
            capture_root = root / "captures"
            artifact = capture_root / "fam.png"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"png")
            self.write_events(
                run_dir,
                {
                    "type": "mcp_tool_result",
                    "tool": "capture_droplet_images",
                    "result": {
                        "captures": [
                            {
                                "channel": "FAM",
                                "captures": [
                                    {
                                        "absolute_path": str(artifact),
                                        "mime_type": "image/png",
                                    }
                                ],
                            }
                        ]
                    },
                },
            )

            with patch.dict(os.environ, {"DROPLOGIC_CAPTURE_ROOT": str(capture_root)}):
                resolved = resolve_run_artifact_path(runs_dir, run_id, "", str(artifact))

            self.assertEqual(resolved, artifact.resolve())

    def test_unreferenced_external_capture_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            runs_dir, run_id, run_dir = self.make_run(root)
            capture_root = root / "captures"
            artifact = capture_root / "secret.png"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"png")
            self.write_events(run_dir, {"type": "mcp_tool_result", "result": {"ok": True}})

            with patch.dict(os.environ, {"DROPLOGIC_CAPTURE_ROOT": str(capture_root)}):
                with self.assertRaisesRegex(ValueError, "Artifact file not found"):
                    resolve_run_artifact_path(runs_dir, run_id, "", str(artifact))

    def test_output_path_alone_does_not_allow_external_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            runs_dir, run_id, run_dir = self.make_run(root)
            capture_root = root / "captures"
            artifact = capture_root / "planned.png"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"png")
            self.write_events(
                run_dir,
                {
                    "type": "mcp_tool_result",
                    "result": {
                        "output_path": str(artifact),
                        "mime_type": "image/png",
                    },
                },
            )

            with patch.dict(os.environ, {"DROPLOGIC_CAPTURE_ROOT": str(capture_root)}):
                with self.assertRaisesRegex(ValueError, "Artifact file not found"):
                    resolve_run_artifact_path(runs_dir, run_id, "", str(artifact))

    def test_external_artifact_allowlist_is_cached_until_events_change(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            runs_dir, run_id, run_dir = self.make_run(root)
            capture_root = root / "captures"
            artifact = capture_root / "frame.png"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"png")
            self.write_events(
                run_dir,
                {
                    "type": "mcp_tool_result",
                    "result": {
                        "artifact": {
                            "absolute_path": str(artifact),
                            "mime_type": "image/png",
                        }
                    },
                },
            )

            with patch.dict(os.environ, {"DROPLOGIC_CAPTURE_ROOT": str(capture_root)}):
                with patch(
                    "backend.server.collect_recorded_artifact_path_keys",
                    wraps=backend_server.collect_recorded_artifact_path_keys,
                ) as collect:
                    resolve_run_artifact_path(runs_dir, run_id, "", str(artifact))
                    first_call_count = collect.call_count
                    self.assertGreater(first_call_count, 0)

                    resolve_run_artifact_path(runs_dir, run_id, "", str(artifact))
                    self.assertEqual(collect.call_count, first_call_count)

                    new_artifact = capture_root / "frame-after-log-change.png"
                    new_artifact.write_bytes(b"png")
                    self.write_events(
                        run_dir,
                        {
                            "type": "mcp_tool_result",
                            "result": {
                                "artifact": {
                                    "absolute_path": str(artifact),
                                    "mime_type": "image/png",
                                }
                            },
                        },
                        {
                            "type": "mcp_tool_result",
                            "result": {
                                "artifact": {
                                    "absolute_path": str(new_artifact),
                                    "mime_type": "image/png",
                                }
                            },
                        },
                    )

                    resolve_run_artifact_path(runs_dir, run_id, "", str(new_artifact))
                    self.assertGreater(collect.call_count, first_call_count)


if __name__ == "__main__":
    unittest.main()
