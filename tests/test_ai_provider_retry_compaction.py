from __future__ import annotations

import json
import sys
import types
import unittest

sys.modules.setdefault("httpx", types.SimpleNamespace(Response=object))

from backend.ai_provider import compact_consumed_tool_history, compact_payload_for_retry


class RetryPayloadCompactionTests(unittest.TestCase):
    def test_anthropic_messages_payload_returns_all_expected_detail_keys(self) -> None:
        payload = {
            "model": "claude-opus-4-8",
            "messages": [
                {
                    "role": "user",
                    "content": "Curated dashboard event log JSON for model context:\n"
                    + json.dumps([{"type": "note", "text": "x" * 4000}])
                    + "\n\nUser request:\ncontinue",
                }
            ],
        }

        details = compact_payload_for_retry(payload, attempt=5, level=1, max_tool_output_chars=6000)

        self.assertIn("image_messages", details)
        self.assertEqual(details["image_messages"], 0)
        self.assertGreaterEqual(details["user_context_sections"], 0)

    def test_anthropic_tool_results_are_compacted_without_crashing(self) -> None:
        large_result = json.dumps({"ok": True, "payload": "x" * 12000})
        payload = {
            "model": "claude-opus-4-8",
            "messages": [
                {
                    "role": "assistant",
                    "content": [{"type": "tool_use", "id": "toolu_1", "name": "runtime_status", "input": {}}],
                },
                {
                    "role": "user",
                    "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": large_result}],
                },
            ],
        }

        details = compact_payload_for_retry(payload, attempt=5, level=1, max_tool_output_chars=1500)

        compacted = payload["messages"][1]["content"][0]["content"]
        self.assertEqual(details["tool_outputs"], 1)
        self.assertIsInstance(compacted, str)
        self.assertLessEqual(len(compacted), 1500)

    def test_anthropic_history_keeps_latest_result_per_tool(self) -> None:
        messages = [
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "status_old", "name": "runtime_status", "input": {}}],
            },
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "status_old", "content": json.dumps({"ok": True, "old": "x" * 2000})}],
            },
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "plan_latest", "name": "plan_summary", "input": {}}],
            },
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "plan_latest", "content": json.dumps({"ok": True, "plan": "latest"})}],
            },
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "status_latest", "name": "runtime_status", "input": {}}],
            },
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "status_latest", "content": json.dumps({"ok": True, "status": "latest"})}],
            },
        ]

        compacted_count = compact_consumed_tool_history(messages)

        old_content = json.loads(messages[1]["content"][0]["content"])
        latest_plan = json.loads(messages[3]["content"][0]["content"])
        latest_status = json.loads(messages[5]["content"][0]["content"])
        self.assertEqual(compacted_count, 1)
        self.assertTrue(old_content["_compacted_prior_tool_output"])
        self.assertEqual(latest_plan["plan"], "latest")
        self.assertEqual(latest_status["status"], "latest")

    def test_tool_history_does_not_compact_error_outputs(self) -> None:
        messages = [
            {
                "type": "function_call",
                "call_id": "failed_response",
                "name": "runtime_status",
                "arguments": json.dumps({"verbose": True}),
            },
            {
                "type": "function_call_output",
                "call_id": "failed_response",
                "output": json.dumps({"ok": False, "error": "Connection refused", "details": "x" * 1200}),
            },
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "failed_anthropic", "name": "plan_summary", "input": {}}],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "failed_anthropic",
                        "content": json.dumps({"content": [{"text": json.dumps({"isError": True, "message": "bad request"})}]}),
                    }
                ],
            },
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "failed_chat",
                        "type": "function",
                        "function": {"name": "file_read", "arguments": json.dumps({"path": "missing"})},
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "failed_chat",
                "content": "Error executing tool: missing file",
            },
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "latest_status", "name": "runtime_status", "input": {}}],
            },
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "latest_status", "content": json.dumps({"ok": True})}],
            },
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "latest_plan", "name": "plan_summary", "input": {}}],
            },
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "latest_plan", "content": json.dumps({"ok": True})}],
            },
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "latest_file", "name": "file_read", "input": {}}],
            },
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "latest_file", "content": json.dumps({"ok": True})}],
            },
        ]

        compacted_count = compact_consumed_tool_history(messages)

        self.assertEqual(compacted_count, 0)
        self.assertEqual(json.loads(messages[1]["output"])["error"], "Connection refused")
        anthropic_result = json.loads(messages[3]["content"][0]["content"])
        self.assertTrue(json.loads(anthropic_result["content"][0]["text"])["isError"])
        self.assertEqual(messages[5]["content"], "Error executing tool: missing file")


if __name__ == "__main__":
    unittest.main()
