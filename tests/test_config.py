from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.config import active_ai_profile_public, load_config, select_ai_profile


class CockpitConfigTests(unittest.TestCase):
    def test_dgx_example_uses_one_gateway_model(self) -> None:
        example_path = Path(__file__).resolve().parents[1] / "backend" / "apis.example.json"
        example = json.loads(example_path.read_text(encoding="utf-8"))

        self.assertEqual(example["active_profile"], "dgx-gateway")
        self.assertGreaterEqual(len(example["profiles"]), 1)
        profile = next(item for item in example["profiles"] if item["id"] == "dgx-gateway")
        self.assertEqual(profile["id"], "dgx-gateway")
        self.assertEqual(profile["base_url"], "http://DGX_HOST:4000/v1")
        self.assertEqual(profile["model"], "dgx-auto")
        self.assertEqual(profile["wire_api"], "chat_completions")
        self.assertEqual(profile["max_context_tokens"], 100_000)
        dgx_profiles = [item for item in example["profiles"] if item["id"].startswith("dgx-")]
        self.assertEqual([item["id"] for item in dgx_profiles], ["dgx-gateway"])
        self.assertEqual([item["model"] for item in dgx_profiles], ["dgx-auto"])
        self.assertEqual(
            {item["id"] for item in example["profiles"]}
            & {"claude-opus-4-8", "gpt-5-6-terra"},
            {"claude-opus-4-8", "gpt-5-6-terra"},
        )

    def test_example_model_catalog_contains_comparable_xhigh_profiles(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_AI_CONFIG": str(Path(temp_dir) / "missing-ai.json"),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-auth.json"),
                },
                clear=False,
            ):
                config = load_config("config.example.json")

        self.assertEqual(
            [profile.model for profile in config.ai.profiles],
            ["claude-opus-5", "claude-opus-4-8", "gpt-5.6-terra", "gpt-5.6-sol"],
        )
        self.assertTrue(all(profile.reasoning_effort == "xhigh" for profile in config.ai.profiles))
        self.assertEqual(
            [profile.wire_api for profile in config.ai.profiles],
            ["anthropic_messages", "anthropic_messages", "responses", "responses"],
        )

    def test_native_response_compaction_defaults_are_explicitly_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text("{}", encoding="utf-8")
            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_AI_CONFIG": str(Path(temp_dir) / "missing-ai.json"),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertFalse(config.ai.native_response_compaction_enabled)
        self.assertEqual(config.ai.native_response_compaction_threshold, 200_000)


    def test_native_response_compaction_can_be_enabled_from_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(
                json.dumps({
                    "ai": {
                        "native_response_compaction_enabled": True,
                        "native_response_compaction_threshold": 180000,
                    }
                }),
                encoding="utf-8",
            )
            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_AI_CONFIG": str(Path(temp_dir) / "missing-ai.json"),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertTrue(config.ai.native_response_compaction_enabled)
        self.assertEqual(config.ai.native_response_compaction_threshold, 180_000)


    def test_profile_reasoning_context_is_selected_with_the_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text("{}", encoding="utf-8")
            ai_config_path = Path(temp_dir) / "ai.json"
            ai_config_path.write_text(
                json.dumps(
                    {
                        "active_profile": "codex-5-6-terra",
                        "profiles": [
                            {
                                "id": "codex-5-5",
                                "label": "Codex 5.5",
                                "base_url": "https://example.invalid/v1",
                                "model": "gpt-5.5",
                                "reasoning_context": "current_turn",
                            },
                            {
                                "id": "codex-5-6-terra",
                                "label": "Codex 5.6 Terra",
                                "base_url": "https://example.invalid/v1",
                                "model": "gpt-5.6-terra",
                                "reasoning_context": "all_turns",
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_AI_CONFIG": str(ai_config_path),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-ai-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertEqual(config.ai.active_profile, "codex-5-6-terra")
        self.assertEqual(config.ai.reasoning_context, "all_turns")

    def test_profile_chat_template_kwargs_are_selected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text("{}", encoding="utf-8")
            ai_config_path = Path(temp_dir) / "ai.json"
            ai_config_path.write_text(
                json.dumps(
                    {
                        "active_profile": "dgx-qwen",
                        "profiles": [
                            {
                                "id": "dgx-qwen",
                                "label": "DGX Qwen",
                                "base_url": "http://dgx.local:8000/v1",
                                "model": "Qwen/Qwen3.6-35B-A3B",
                                "wire_api": "chat_completions",
                                "chat_template_kwargs": {
                                    "enable_thinking": True,
                                    "preserve_thinking": True,
                                },
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_AI_CONFIG": str(ai_config_path),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-ai-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertEqual(config.ai.wire_api, "chat_completions")
        self.assertEqual(
            config.ai.chat_template_kwargs,
            {"enable_thinking": True, "preserve_thinking": True},
        )

    def test_profile_context_limit_is_selected_without_leaking_to_other_profiles(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text("{}", encoding="utf-8")
            ai_config_path = Path(temp_dir) / "apis.json"
            ai_config_path.write_text(
                json.dumps(
                    {
                        "active_profile": "dgx",
                        "api_keys": {"dgx": "EMPTY", "cloud": "secret"},
                        "profiles": [
                            {
                                "id": "dgx",
                                "label": "DGX",
                                "base_url": "https://ml.example/v1",
                                "model": "dgx-auto",
                                "wire_api": "chat_completions",
                                "max_context_tokens": 100000,
                                "api_key_id": "dgx",
                            },
                            {
                                "id": "cloud",
                                "label": "Cloud",
                                "base_url": "https://api.example/v1",
                                "model": "cloud-model",
                                "wire_api": "responses",
                                "api_key_id": "cloud",
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_APIS_FILE": str(ai_config_path),
                    "DASHBOARD_AI_CONFIG": str(Path(temp_dir) / "missing-legacy.json"),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertEqual(config.ai.max_context_tokens, 100_000)
        self.assertEqual(active_ai_profile_public(config.ai)["max_context_tokens"], 100_000)
        select_ai_profile(config.ai, "cloud")
        self.assertIsNone(config.ai.max_context_tokens)
        self.assertIsNone(active_ai_profile_public(config.ai)["max_context_tokens"])

    def test_unified_apis_file_is_single_source_for_profiles_and_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text("{}", encoding="utf-8")
            apis_path = Path(temp_dir) / "apis.json"
            apis_path.write_text(
                json.dumps(
                    {
                        "enabled": True,
                        "active_profile": "dgx",
                        "api_keys": {"dgx": "EMPTY"},
                        "profiles": [
                            {
                                "id": "dgx",
                                "label": "DGX local",
                                "base_url": "http://127.0.0.1:8000/v1",
                                "model": "nvidia/Qwen3.6-35B-A3B-NVFP4",
                                "provider_name": "dgx",
                                "wire_api": "chat_completions",
                                "chat_template_kwargs": {"enable_thinking": True},
                                "api_key_id": "dgx",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(
                "os.environ",
                {
                    "DASHBOARD_APIS_FILE": str(apis_path),
                    "DASHBOARD_AI_CONFIG": str(Path(temp_dir) / "missing-legacy.json"),
                    "DASHBOARD_AI_AUTH": str(Path(temp_dir) / "missing-auth.json"),
                },
                clear=False,
            ):
                config = load_config(str(config_path))

        self.assertEqual(config.ai.active_profile, "dgx")
        self.assertEqual(config.ai.model, "nvidia/Qwen3.6-35B-A3B-NVFP4")
        self.assertEqual(config.ai.api_key, "EMPTY")
        self.assertEqual(config.ai.wire_api, "chat_completions")
        self.assertEqual(config.ai.chat_template_kwargs, {"enable_thinking": True})

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
