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

    def test_latest_tool_results_are_ordered_by_latest_event(self) -> None:
        events = []
        for tool in ("early_refreshed", "middle", "late"):
            events.append({"type": "mcp_tool_result", "tool": tool, "ok": True, "result": {"tool": tool}})
        events.append({"type": "mcp_tool_result", "tool": "early_refreshed", "ok": True, "result": {"tool": "latest"}})

        summaries = latest_tool_results_by_tool(events)

        self.assertEqual([item["tool"] for item in summaries], ["middle", "late", "early_refreshed"])
        self.assertEqual(summaries[-1]["event_index"], 3)

    def test_latest_tool_result_is_not_old_tool_compacted_by_age(self) -> None:
        events = [
            {"type": "mcp_tool_call", "t": 1.0, "tool": "runtime_status", "arguments": {}},
            {"type": "mcp_tool_result", "t": 2.0, "tool": "runtime_status", "ok": True, "call_event_id": 1.0},
        ]
        events.extend({"type": "agent_message", "text": f"note {index}"} for index in range(120))

        compact_indices = old_tool_event_indices(events)

        self.assertNotIn(1, compact_indices)

    def test_latest_tool_result_survives_final_summary_selection(self) -> None:
        events = [
            {"type": "agent_prompt", "prompt": "do work"},
            {"type": "mcp_tool_call", "t": 1.0, "tool": "runtime_status", "arguments": {}},
            {
                "type": "mcp_tool_result",
                "t": 2.0,
                "tool": "runtime_status",
                "ok": True,
                "call_event_id": 1.0,
                "result": {"important": "latest tool output"},
            },
        ]
        events.extend(
            {"type": "agent_message", "text": f"later event {index} " + ("x" * 400)}
            for index in range(40)
        )

        context = build_model_context(events, target_chars=2_500, recent_event_target=4, large_event_chars=6_000)
        runtime_results = [
            event
            for event in context.events
            if event.get("type") == "mcp_tool_result" and event.get("tool") == "runtime_status"
        ]

        self.assertEqual(len(runtime_results), 1)
        self.assertEqual(runtime_results[0]["result"]["important"], "latest tool output")


if __name__ == "__main__":
    unittest.main()
