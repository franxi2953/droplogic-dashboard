from __future__ import annotations

import sys
import types
import unittest

sys.modules.setdefault("httpx", types.ModuleType("httpx"))
from backend.live_snapshot import LIVE_TIMELINE_FRAME_SAMPLE_LIMIT, LiveSnapshotMixin


class FakeLiveSnapshot(LiveSnapshotMixin):
    pass


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


if __name__ == "__main__":
    unittest.main()
