from __future__ import annotations

import unittest

from backend.context_builder import build_model_context, latest_tool_results_by_tool, old_tool_event_indices
from backend.pinned_context import compact_pinned_context_file


class ContextCompactionPolicyTests(unittest.TestCase):
    def test_old_tool_events_keep_only_latest_result_per_tool(self) -> None:
        events = []
        for index in range(10):
            for tool in ("runtime_status", "plan_summary"):
                call_t = float(len(events) + 1)
                events.append({"type": "mcp_tool_call", "t": call_t, "tool": tool, "arguments": {"i": index}})
                events.append(
                    {
                        "type": "mcp_tool_result",
                        "t": float(len(events) + 1),
                        "tool": tool,
                        "ok": True,
                        "call_event_id": call_t,
                        "result": {"i": index},
                    }
                )

        compact_indices = old_tool_event_indices(events)
        raw_results = [
            event
            for index, event in enumerate(events)
            if event.get("type") == "mcp_tool_result" and index not in compact_indices
        ]

        self.assertEqual([event["tool"] for event in raw_results], ["runtime_status", "plan_summary"])
        self.assertEqual([event["result"]["i"] for event in raw_results], [9, 9])

    def test_latest_tool_results_are_ordered_by_latest_event_index(self) -> None:
        events = [
            {
                "type": "mcp_tool_result",
                "tool": "core_status",
                "ok": True,
                "result": {"generation": 0},
            }
        ]
        for index in range(31):
            events.append(
                {
                    "type": "mcp_tool_result",
                    "tool": f"tool_{index}",
                    "ok": True,
                    "result": {"generation": index},
                }
            )
        events.append(
            {
                "type": "mcp_tool_result",
                "tool": "core_status",
                "ok": True,
                "result": {"generation": 1},
            }
        )

        retained_tools = [item["tool"] for item in latest_tool_results_by_tool(events)[-30:]]

        self.assertIn("core_status", retained_tools)
        self.assertNotIn("tool_0", retained_tools)

    def test_latest_tool_result_is_protected_after_many_non_tool_events(self) -> None:
        events = []
        for index in range(5):
            call_t = float(len(events) + 1)
            events.append({"type": "mcp_tool_call", "t": call_t, "tool": "runtime_status", "arguments": {"i": index}})
            events.append(
                {
                    "type": "mcp_tool_result",
                    "t": float(len(events) + 1),
                    "tool": "runtime_status",
                    "ok": True,
                    "call_event_id": call_t,
                    "result": {"i": index},
                }
            )
        for index in range(100):
            events.append({"type": "agent_note", "message": f"temperature sample {index}"})

        compact_indices = old_tool_event_indices(events)
        latest_result_index = 9

        self.assertNotIn(latest_result_index, compact_indices)

        model_context = build_model_context(events, large_event_chars=1_000)
        latest_result = model_context.events[latest_result_index]

        self.assertEqual(latest_result["type"], "mcp_tool_result")
        self.assertEqual(latest_result["result"], {"i": 4})
        self.assertTrue(latest_result["_protected_latest_tool_output"])

    def test_agent_guide_is_sent_as_turn_manual(self) -> None:
        large_guide = "# BoxMini Agent Quick Guide\n\n" + "\n".join(
            f"## Section {index}\nImportant detail {index}."
            for index in range(200)
        )

        compacted, metadata = compact_pinned_context_file("agent-guide.md", large_guide)

        self.assertTrue(metadata["compacted"])
        self.assertLess(metadata["sent_chars"], metadata["original_chars"])
        self.assertIn("BoxMini Turn Manual", compacted)
        self.assertIn("Use read_context_file", compacted)


if __name__ == "__main__":
    unittest.main()
