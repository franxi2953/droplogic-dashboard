from __future__ import annotations

import asyncio
from copy import deepcopy
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

sys.modules.setdefault("httpx", types.SimpleNamespace(Response=object))

from backend.ai_provider import (
    AiProvider,
    ResponseContextSession,
    compact_consumed_tool_history,
    compact_payload_for_retry,
    load_response_context_session,
    model_response_metrics,
    response_context_items,
    save_response_context_session,
    apply_response_context_options,
    chat_assistant_message,
    chat_model_response_metrics,
    context_compaction_strategy,
    compact_chat_transcript,
    extract_chat_reasoning,
)
from backend.config import AiConfig


class RetryPayloadCompactionTests(unittest.TestCase):
    def test_chat_transcript_is_bounded_and_keeps_recent_tool_pair(self) -> None:
        messages = [
            {"role": "system", "content": "instructions"},
            {"role": "user", "content": "authoritative state"},
        ]
        for index in range(20):
            messages.extend(
                [
                    {
                        "role": "assistant",
                        "content": "reasoning " + ("x" * 4_000),
                        "tool_calls": [
                            {
                                "id": f"call_{index}",
                                "type": "function",
                                "function": {"name": "status", "arguments": "{}"},
                            }
                        ],
                    },
                    {"role": "tool", "tool_call_id": f"call_{index}", "content": "result"},
                ]
            )

        removed = compact_chat_transcript(messages, max_chars=10_000)

        self.assertGreater(removed, 0)
        self.assertLessEqual(len(json.dumps(messages)), 10_000)
        self.assertIn("context safety", messages[2]["content"])
        self.assertEqual(messages[-1]["tool_call_id"], "call_19")

    def test_goal_completion_stops_chat_tool_loop_without_followup_model_call(self) -> None:
        async def exercise() -> tuple[dict, list[dict]]:
            provider = AiProvider(
                AiConfig(
                    base_url="https://example.invalid/v1",
                    model="dgx-auto",
                    api_key="test-key",
                    wire_api="chat_completions",
                )
            )
            requests: list[dict] = []
            response = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "complete",
                                    "type": "function",
                                    "function": {
                                        "name": "dashboard_complete_goal",
                                        "arguments": '{"summary":"done"}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            }

            async def fake_post(payload: dict, **_: object) -> dict:
                requests.append(deepcopy(payload))
                return response

            async def call_tool(_: str, __: dict) -> dict:
                return {"ok": True, "status": "complete", "message": "Goal marked complete."}

            provider._post_chat_completion = fake_post  # type: ignore[method-assign]
            result = await provider.ask_with_tools(
                prompt="finish",
                events=[],
                tools=[
                    {
                        "name": "dashboard_complete_goal",
                        "description": "Complete the active goal",
                        "inputSchema": {"type": "object", "properties": {}},
                    }
                ],
                call_tool=call_tool,
            )
            return result, requests

        result, requests = asyncio.run(exercise())

        self.assertEqual(len(requests), 1)
        self.assertEqual(result["stopped_reason"], "goal_completed")
        self.assertEqual(result["text"], "Goal marked complete.")

    def test_chat_reasoning_normalizes_local_runtime_fields(self) -> None:
        data = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "reasoning_content": "Check the stage state first.",
                        "content": [
                            {"type": "reasoning", "text": "Then validate the requested range."},
                            {"type": "text", "text": "I can do that."},
                        ],
                    }
                }
            ]
        }

        self.assertEqual(
            extract_chat_reasoning(data),
            ["Check the stage state first.", "Then validate the requested range."],
        )
        assistant = chat_assistant_message(data)
        self.assertEqual(assistant["reasoning_content"], "Check the stage state first.")
        metrics = chat_model_response_metrics(data, round_index=0, elapsed_seconds=0.1)
        self.assertTrue(metrics["has_reasoning"])
        self.assertEqual(metrics["reasoning_summary_item_count"], 2)

    def test_chat_metrics_accept_reasoning_token_usage_variants(self) -> None:
        metrics = chat_model_response_metrics(
            {
                "choices": [{"message": {"role": "assistant", "content": "done"}}],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 8,
                    "completion_tokens_details": {"reasoning_tokens": 5},
                    "total_tokens": 18,
                },
            },
            round_index=0,
            elapsed_seconds=0.1,
        )
        self.assertEqual(metrics["reasoning_tokens"], 5)

    def test_chat_tool_loop_emits_and_replays_reasoning_content(self) -> None:
        async def exercise() -> tuple[dict, list[dict], list[tuple[str, int]]]:
            config = AiConfig(
                base_url="https://example.invalid/v1",
                model="openai/gpt-oss-120b",
                api_key="test-key",
                wire_api="chat_completions",
                reasoning_effort="high",
                chat_template_kwargs={"enable_thinking": True, "preserve_thinking": True},
            )
            provider = AiProvider(config)
            requests: list[dict] = []
            responses = [
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "reasoning_content": "Inspect the stage before moving it.",
                                "content": "",
                                "tool_calls": [
                                    {
                                        "id": "call_status",
                                        "type": "function",
                                        "function": {
                                            "name": "runtime_status",
                                            "arguments": "{}",
                                        },
                                    }
                                ],
                            },
                            "finish_reason": "tool_calls",
                        }
                    ]
                },
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "reasoning_content": "The status is safe; report completion.",
                                "content": "Stage status is safe.",
                            },
                            "finish_reason": "stop",
                        }
                    ]
                },
            ]

            async def fake_post(payload: dict, **_: object) -> dict:
                requests.append(deepcopy(payload))
                return responses.pop(0)

            async def call_tool(_: str, __: dict) -> dict:
                return {"ok": True, "stage": "idle"}

            thinking: list[tuple[str, int]] = []

            async def on_reasoning(text: str, round_index: int) -> None:
                thinking.append((text, round_index))

            provider._post_chat_completion = fake_post  # type: ignore[method-assign]
            result = await provider.ask_with_tools(
                prompt="Check the stage",
                events=[],
                tools=[
                    {
                        "name": "runtime_status",
                        "description": "Read runtime status",
                        "inputSchema": {"type": "object", "properties": {}},
                    }
                ],
                call_tool=call_tool,
                on_reasoning=on_reasoning,
            )
            return result, requests, thinking

        result, requests, thinking = asyncio.run(exercise())

        self.assertEqual(result["text"], "Stage status is safe.")
        self.assertEqual(
            result["reasoning"],
            ["Inspect the stage before moving it.", "The status is safe; report completion."],
        )
        self.assertEqual(
            thinking,
            [
                ("Inspect the stage before moving it.", 0),
                ("The status is safe; report completion.", 1),
            ],
        )
        assistant = requests[1]["messages"][2]
        self.assertEqual(
            requests[0]["chat_template_kwargs"],
            {"enable_thinking": True, "preserve_thinking": True},
        )
        self.assertEqual(assistant["reasoning_content"], "Inspect the stage before moving it.")
        self.assertEqual(assistant["tool_calls"][0]["id"], "call_status")
        self.assertEqual(requests[1]["messages"][3]["role"], "tool")

    def test_native_response_compaction_is_transport_specific(self) -> None:
        responses_config = AiConfig(
            wire_api="responses",
            native_response_compaction_enabled=True,
            native_response_compaction_threshold=180_000,
        )
        responses_payload = {}
        apply_response_context_options(responses_payload, responses_config)
        self.assertEqual(
            responses_payload["context_management"],
            [{"type": "compaction", "compact_threshold": 180_000}],
        )
        self.assertEqual(context_compaction_strategy(responses_config), "dashboard+native_responses")

        claude_config = AiConfig(
            wire_api="anthropic_messages",
            native_response_compaction_enabled=True,
        )
        claude_payload = {}
        apply_response_context_options(claude_payload, claude_config)
        self.assertNotIn("context_management", claude_payload)
        self.assertEqual(context_compaction_strategy(claude_config), "dashboard")

    def test_response_context_round_trips_reasoning_and_assistant_phase(self) -> None:
        input_list = [
            {
                "role": "user",
                "content": "Curated dashboard event log JSON for model context:\nold snapshot",
            },
            {
                "type": "reasoning",
                "id": "rs_old",
                "encrypted_content": "opaque-reasoning",
                "summary": [{"type": "summary_text", "text": "**Old plan**"}],
            },
            {"type": "function_call", "call_id": "call_1", "name": "status", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "call_1", "output": "{\"ok\": true}"},
        ]
        final_response = {
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "phase": "final_answer",
                    "content": [{"type": "output_text", "text": "Status confirmed."}],
                }
            ]
        }

        items = response_context_items(input_list, final_response)

        self.assertEqual([item["type"] for item in items], ["reasoning", "function_call", "function_call_output", "message"])
        self.assertEqual(items[0]["encrypted_content"], "opaque-reasoning")
        self.assertEqual(items[-1]["phase"], "final_answer")

    def test_current_turn_context_keeps_prior_user_request_without_event_log(self) -> None:
        items = response_context_items(
            [
                {
                    "role": "user",
                    "content": (
                        "Curated dashboard event log JSON for model context:\n"
                        "[large current state]\n\nUser request:\nRemember LANTERN-72 exactly."
                    ),
                }
            ],
            {"output": [{"type": "reasoning", "encrypted_content": "opaque"}]},
            retain_dashboard_user_requests=True,
        )

        self.assertEqual(items[0], {"role": "user", "content": "Remember LANTERN-72 exactly."})
        self.assertNotIn("large current state", items[0]["content"])
        self.assertEqual(items[1]["encrypted_content"], "opaque")

    def test_response_metrics_identify_heading_only_reasoning_summary(self) -> None:
        metrics = model_response_metrics(
            {
                "output": [
                    {
                        "type": "reasoning",
                        "summary": [
                            {"type": "summary_text", "text": "## Planning"},
                            {"type": "summary_text", "text": "**Execution**"},
                        ],
                    }
                ]
            },
            round_index=0,
            elapsed_seconds=0.1,
        )

        self.assertEqual(metrics["reasoning_summary_item_count"], 2)
        self.assertEqual(metrics["reasoning_summary_chars"], len("## Planning**Execution**"))
        self.assertTrue(metrics["reasoning_summary_heading_only"])

    def test_response_context_persistence_is_bound_to_profile_and_model(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "responses" / "codex.json"
            session = ResponseContextSession(
                profile_id="codex-5-6-terra",
                model="gpt-5.6-terra",
                items=[{"type": "reasoning", "encrypted_content": "opaque"}],
                path=path,
                revision=3,
                last_response_id="resp_previous",
            )

            self.assertIsNone(save_response_context_session(session))
            restored = load_response_context_session(path, "codex-5-6-terra", "gpt-5.6-terra")
            wrong_model = load_response_context_session(path, "codex-5-6-terra", "gpt-5.5")

        self.assertTrue(restored.loaded_from_disk)
        self.assertEqual(restored.revision, 3)
        self.assertEqual(restored.last_response_id, "resp_previous")
        self.assertEqual(restored.items[0]["encrypted_content"], "opaque")
        self.assertFalse(wrong_model.loaded_from_disk)
        self.assertEqual(wrong_model.items, [])

    def test_response_context_replays_opaque_items_on_the_next_dashboard_prompt(self) -> None:
        async def exercise() -> tuple[list[dict], str | None]:
            config = AiConfig(
                base_url="https://example.invalid/v1",
                model="gpt-5.6-terra",
                api_key="test-key",
                reasoning_effort="xhigh",
                reasoning_summary="auto",
                reasoning_context="all_turns",
            )
            provider = AiProvider(config)
            requests: list[dict] = []
            responses = [
                {
                    "id": "resp_first_tool_call",
                    "output": [
                        {"type": "reasoning", "encrypted_content": "opaque-first", "summary": []},
                        {"type": "function_call", "call_id": "call_1", "name": "status", "arguments": "{}"},
                    ]
                },
                {
                    "id": "resp_first_complete",
                    "output": [
                        {
                            "type": "message",
                            "role": "assistant",
                            "phase": "final_answer",
                            "content": [{"type": "output_text", "text": "First complete."}],
                        }
                    ]
                },
                {
                    "id": "resp_second_complete",
                    "output": [
                        {
                            "type": "message",
                            "role": "assistant",
                            "phase": "final_answer",
                            "content": [{"type": "output_text", "text": "Second complete."}],
                        }
                    ]
                },
            ]

            async def fake_post(payload: dict, **_: object) -> dict:
                requests.append(deepcopy(payload))
                return responses.pop(0)

            async def call_tool(_: str, __: dict) -> dict:
                return {"ok": True}

            provider._post_response = fake_post  # type: ignore[method-assign]
            with tempfile.TemporaryDirectory() as temp_dir:
                path = Path(temp_dir) / "responses.json"
                common = {
                    "events": [{"type": "state", "value": "old"}],
                    "tools": [{"name": "status", "inputSchema": {"type": "object", "properties": {}}}],
                    "call_tool": call_tool,
                    "response_session_key": "run-1:codex-5-6-terra",
                    "response_session_path": path,
                    "response_session_profile_id": "codex-5-6-terra",
                    "response_context_max_chars": 300_000,
                }
                await provider.ask_with_tools(prompt="first", **common)
                await provider.ask_with_tools(prompt="second", **common)
                session = provider.response_context_session(
                    common["response_session_key"],
                    common["response_session_path"],
                    common["response_session_profile_id"],
                )
                return requests, session.last_response_id if session else None

        requests, last_response_id = asyncio.run(exercise())

        self.assertEqual(len(requests), 3)
        self.assertEqual(requests[0]["reasoning"]["context"], "all_turns")
        replayed = requests[2]["input"]
        self.assertEqual(
            [item.get("type") or item.get("role") for item in replayed],
            ["reasoning", "function_call", "function_call_output", "message", "user"],
        )
        self.assertEqual(replayed[0]["encrypted_content"], "opaque-first")
        self.assertEqual(replayed[3]["phase"], "final_answer")
        self.assertIn("User request:\nsecond", replayed[-1]["content"])
        self.assertNotIn("User request:\nfirst", replayed[-1]["content"])
        self.assertEqual(last_response_id, "resp_second_complete")

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
