from __future__ import annotations

import sys
import types
import unittest

sys.modules.setdefault("httpx", types.ModuleType("httpx"))
from backend.live_snapshot import (
    LIVE_TIMELINE_FRAME_SAMPLE_LIMIT,
    LiveSnapshotMixin,
    scene_session_mismatch_fallback_is_fresh,
)


class FakeLiveSnapshot(LiveSnapshotMixin):
    pass


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


if __name__ == "__main__":
    unittest.main()
