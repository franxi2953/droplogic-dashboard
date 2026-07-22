from __future__ import annotations

import sys
import json
import tempfile
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.modules.setdefault("httpx", types.ModuleType("httpx"))
from backend.live_snapshot import (
    LIVE_TIMELINE_FRAME_SAMPLE_LIMIT,
    LiveSnapshotMixin,
    scene_session_mismatch_fallback_is_fresh,
)


class FakeLiveSnapshot(LiveSnapshotMixin):
    pass


class StreamerSnapshotLoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_direct_stream_skips_unrequested_snapshots(self) -> None:
        class RunningOnce:
            checks = 0

            @property
            def running(self) -> bool:
                self.checks += 1
                return self.checks == 1

        async def fail_collect() -> dict[str, object]:
            raise AssertionError("snapshot should not be captured")

        async def no_sleep(_seconds: float) -> None:
            return None

        app = FakeLiveSnapshot()
        app.mcp = RunningOnce()
        app.config = SimpleNamespace(live_state_interval_seconds=1.0)
        app._direct_stream_available = True
        app._streamer_snapshot_clients = set()
        app.collect_streamer_frame = fail_collect

        with patch("backend.live_snapshot.asyncio.sleep", new=no_sleep):
            await app.streamer_frame_loop()


class LiveSceneMergeTests(unittest.TestCase):
    def test_live_scene_merge_uses_runtime_state_and_visualizers_from_scene(self) -> None:
        scene = {
            "available": True,
            "session_id": "session-1",
            "runtime": {"session_id": "session-1", "system": {"loaded": True}},
            "state": {"value": {"electrode_matrix": {"voltage_status": {"display": "40 V x4"}}}},
            "visualizers": {"streamer": {"available": True}},
        }

        live = FakeLiveSnapshot().merge_live_scene({"runtime": {"session_id": "old"}}, scene)

        self.assertEqual(live["runtime"]["session_id"], "session-1")
        self.assertEqual(live["state"]["value"]["electrode_matrix"]["voltage_status"]["display"], "40 V x4")
        self.assertTrue(live["visualizers"]["streamer"]["available"])


class LiveSceneCompactionTests(unittest.TestCase):
    def test_heavy_timeline_frames_are_sampled_for_live_scene(self) -> None:
        frames = [
            {
                "index": index,
                "event_id": f"event-{index // 5}",
                "event_type": "move",
                "active_droplet_ids": [index % 7],
                "summary": {
                    "active_count": (index % 4) + 1,
                    "active_mask_sha256": f"active-{index}",
                    "matrix_values_sha256": f"values-{index}",
                    "rows": {"0": [1] * 128},
                },
            }
            for index in range(500)
        ]
        scene = {
            "available": True,
            "frame": {"index": 250, "count": len(frames)},
            "executor": {"current_frame": 251},
            "timeline": {
                "available": True,
                "frame_count": len(frames),
                "detailed_frame_limit": 500,
                "frames": frames,
            },
        }

        compact = FakeLiveSnapshot().compact_live_scene(scene)
        timeline = compact["timeline"]
        compact_frames = timeline["frames"]
        indices = [frame["index"] for frame in compact_frames]

        self.assertLess(len(compact_frames), len(frames))
        self.assertLessEqual(len(compact_frames), LIVE_TIMELINE_FRAME_SAMPLE_LIMIT)
        self.assertTrue(timeline["live_frames_sampled"])
        self.assertEqual(timeline["live_frame_count"], len(frames))
        self.assertEqual(timeline["live_frames_sent"], len(compact_frames))
        self.assertEqual(timeline["live_frames_omitted"], len(frames) - len(compact_frames))
        self.assertEqual(timeline["encoding"], "sampled_compact_frame_index")
        self.assertEqual(timeline["live_frame_lookup"], "exact_index")
        self.assertIn(0, indices)
        self.assertIn(250, indices)
        self.assertIn(499, indices)
        self.assertTrue(all("rows" not in frame.get("summary", {}) for frame in compact_frames))
        self.assertTrue(any(frame.get("summary", {}).get("active_count") for frame in compact_frames))

    def test_small_timeline_is_left_unchanged(self) -> None:
        scene = {
            "available": True,
            "timeline": {
                "available": True,
                "frame_count": 2,
                "frames": [{"index": 0}, {"index": 1}],
            },
        }

        self.assertIs(FakeLiveSnapshot().compact_live_scene(scene), scene)


class SceneSessionFallbackTests(unittest.TestCase):
    def test_session_mismatch_fallback_requires_fresh_snapshot(self) -> None:
        scene = {
            "available": True,
            "session_id": "next-session",
            "dashboard_snapshot_mtime": 1000.0,
        }

        self.assertTrue(
            scene_session_mismatch_fallback_is_fresh(
                scene,
                runtime={
                    "session_id": "old-session",
                    "system": {"loaded": True},
                    "dashboard_live_captured_ts": 999.5,
                },
                runtime_session_id="old-session",
                loop_started_at=999.0,
                max_age_seconds=5.0,
                now=1001.0,
            )
        )

    def test_session_mismatch_fallback_rejects_stale_snapshot(self) -> None:
        scene = {
            "available": True,
            "session_id": "previous-session",
            "dashboard_snapshot_mtime": 990.0,
        }

        self.assertFalse(
            scene_session_mismatch_fallback_is_fresh(
                scene,
                runtime={"session_id": "active-session", "system": {"loaded": True}},
                runtime_session_id="active-session",
                loop_started_at=995.0,
                max_age_seconds=5.0,
                now=1001.0,
            )
        )

    def test_session_mismatch_fallback_rejects_snapshot_older_than_runtime_poll(self) -> None:
        scene = {
            "available": True,
            "session_id": "previous-session",
            "dashboard_snapshot_mtime": 1000.0,
        }

        self.assertFalse(
            scene_session_mismatch_fallback_is_fresh(
                scene,
                runtime={
                    "session_id": "active-session",
                    "system": {"loaded": True},
                    "dashboard_live_captured_ts": 1000.5,
                },
                runtime_session_id="active-session",
                loop_started_at=999.0,
                max_age_seconds=5.0,
                now=1001.0,
            )
        )

    def test_session_mismatch_fallback_rejects_no_system_runtime(self) -> None:
        scene = {
            "available": True,
            "session_id": "next-session",
            "dashboard_snapshot_mtime": 1000.0,
        }

        self.assertFalse(
            scene_session_mismatch_fallback_is_fresh(
                scene,
                runtime={"session_id": "old-session", "system": {"loaded": False}},
                runtime_session_id="old-session",
                loop_started_at=999.0,
                max_age_seconds=5.0,
                now=1001.0,
            )
        )


class LiveSceneSnapshotFileTests(unittest.TestCase):
    def test_read_dashboard_scene_snapshot_rejects_stale_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = f"{temp_dir}/dashboard_scene.json"
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"available": True, "session_id": "session-1"}, handle)

            app = FakeLiveSnapshot()
            app.config = SimpleNamespace(
                live_state_interval_seconds=1.0,
                live_scene_interval_seconds=0.1,
                mcp=SimpleNamespace(env={"DROPLOGIC_DASHBOARD_SCENE_PATH": path}),
            )
            old_time = 1000.0
            import os

            os.utime(path, (old_time, old_time))

            scene = app.read_dashboard_scene_snapshot(runtime_session_id="session-1")

            self.assertFalse(scene["available"])
            self.assertEqual(scene["reason"], "scene_snapshot_stale")
            self.assertGreater(scene["dashboard_snapshot_age_seconds"], scene["dashboard_snapshot_max_age_seconds"])


if __name__ == "__main__":
    unittest.main()
