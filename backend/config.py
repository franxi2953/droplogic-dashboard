from __future__ import annotations

import json
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


COCKPIT_ROOT = Path(__file__).resolve().parents[1]
GITHUB_ROOT = COCKPIT_ROOT.parent
DROPLOGIC_ROOT = Path(os.environ.get("DROPLOGIC_REPO", GITHUB_ROOT / "DropLogic"))
COCKPIT_CONTEXT_ROOT = COCKPIT_ROOT / "context" / "boxmini"


def expand_path(value: str | None) -> str | None:
    if not value:
        return value
    expanded = os.path.expandvars(value)
    expanded = os.path.expanduser(expanded)
    return expanded


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


@dataclass
class McpConfig:
    command: str = "py"
    args: list[str] = field(
        default_factory=lambda: [
            "-3.13",
            "-m",
            "droplogic.mcp.server",
            "--transport",
            "stdio",
            "--allow-real-hardware",
            "--config",
            "config.json",
        ]
    )
    env: dict[str, str] = field(
        default_factory=lambda: {
            "PYTHONPATH": ".",
            "DROPLOGIC_LOG_DIR": "%LOCALAPPDATA%/DropLogic/logs",
        }
    )


@dataclass
class AiConfig:
    enabled: bool = True
    base_url: str | None = None
    model: str | None = None
    provider_name: str | None = None
    reasoning_effort: str | None = None
    reasoning_summary: str | None = "auto"
    api_key: str | None = None
    codex_config: str = "%USERPROFILE%/.codex/config.toml"
    codex_auth: str = "%USERPROFILE%/.codex/auth.json"
    # The cockpit budgets model context in characters. Use ~4 chars/token as
    # a conservative conversion, so 800k chars is roughly 200k tokens.
    max_context_chars: int = 800_000
    target_context_chars: int = 90_000
    recent_event_target: int = 120
    large_event_chars: int = 8_000
    max_tool_output_chars: int = 12_000
    ai_context_summary_enabled: bool = True
    ai_context_summary_trigger_chars: int = 300_000
    ai_context_summary_max_chars: int = 12_000
    pinned_context_files: list[str] = field(
        default_factory=lambda: ["agent-guide.md", "cockpit-mode.md", "cartridge.default.json"]
    )


@dataclass
class CockpitConfig:
    host: str = "127.0.0.1"
    port: int = 8787
    runs_dir: str = "runs"
    live_frame_interval_seconds: float = 0.33
    live_state_interval_seconds: float = 1.0
    mcp: McpConfig = field(default_factory=McpConfig)
    ai: AiConfig = field(default_factory=AiConfig)


def load_config(path: str | None = None) -> CockpitConfig:
    config_path = Path(path or os.environ.get("COCKPIT_CONFIG", "config.example.json"))
    if not config_path.is_absolute():
        config_path = COCKPIT_ROOT / config_path
    raw = load_json(config_path)

    mcp_raw = raw.get("mcp", {}) if isinstance(raw, dict) else {}
    ai_raw = raw.get("ai", {}) if isinstance(raw, dict) else {}
    cfg = CockpitConfig(
        host=str(raw.get("host", "127.0.0.1")),
        port=int(raw.get("port", 8787)),
        runs_dir=str(raw.get("runs_dir", "runs")),
        live_frame_interval_seconds=float(raw.get("live_frame_interval_seconds", 0.33)),
        live_state_interval_seconds=float(raw.get("live_state_interval_seconds", 1.0)),
        mcp=McpConfig(
            command=str(mcp_raw.get("command", "py")),
            args=[str(item) for item in mcp_raw.get("args", McpConfig().args)],
            env={str(k): str(v) for k, v in mcp_raw.get("env", McpConfig().env).items()},
        ),
        ai=AiConfig(
            enabled=bool(ai_raw.get("enabled", True)),
            base_url=ai_raw.get("base_url"),
            model=ai_raw.get("model"),
            provider_name=ai_raw.get("provider_name"),
            reasoning_effort=ai_raw.get("reasoning_effort"),
            reasoning_summary=ai_raw.get("reasoning_summary", "auto"),
            api_key=ai_raw.get("api_key"),
            codex_config=str(ai_raw.get("codex_config", "%USERPROFILE%/.codex/config.toml")),
            codex_auth=str(ai_raw.get("codex_auth", "%USERPROFILE%/.codex/auth.json")),
            max_context_chars=int(ai_raw.get("max_context_chars", 800_000)),
            target_context_chars=int(ai_raw.get("target_context_chars", 90_000)),
            recent_event_target=int(ai_raw.get("recent_event_target", 120)),
            large_event_chars=int(ai_raw.get("large_event_chars", 8_000)),
            max_tool_output_chars=int(ai_raw.get("max_tool_output_chars", 12_000)),
            ai_context_summary_enabled=bool(ai_raw.get("ai_context_summary_enabled", True)),
            ai_context_summary_trigger_chars=int(ai_raw.get("ai_context_summary_trigger_chars", 300_000)),
            ai_context_summary_max_chars=int(ai_raw.get("ai_context_summary_max_chars", 12_000)),
            pinned_context_files=[
                str(item)
                for item in ai_raw.get(
                    "pinned_context_files",
                    AiConfig().pinned_context_files,
                )
            ],
        ),
    )
    apply_codex_ai_defaults(cfg.ai)
    apply_env_overrides(cfg)
    return cfg


def apply_codex_ai_defaults(ai: AiConfig) -> None:
    codex_config_path = Path(expand_path(ai.codex_config) or "")
    if codex_config_path.exists():
        with codex_config_path.open("rb") as handle:
            data = tomllib.load(handle)
        provider_name = data.get("model_provider")
        if not ai.provider_name and provider_name:
            ai.provider_name = str(provider_name)
        if not ai.model and data.get("model"):
            ai.model = str(data["model"])
        if not ai.reasoning_effort and data.get("model_reasoning_effort"):
            ai.reasoning_effort = str(data["model_reasoning_effort"])
        providers = data.get("model_providers", {})
        provider = providers.get(provider_name, {}) if provider_name else {}
        if not ai.base_url and provider.get("base_url"):
            ai.base_url = str(provider["base_url"])

    codex_auth_path = Path(expand_path(ai.codex_auth) or "")
    if codex_auth_path.exists():
        auth = load_json(codex_auth_path)
        if not ai.api_key and auth.get("OPENAI_API_KEY"):
            ai.api_key = str(auth["OPENAI_API_KEY"])


def apply_env_overrides(cfg: CockpitConfig) -> None:
    cfg.host = os.environ.get("COCKPIT_HOST", cfg.host)
    cfg.port = int(os.environ.get("COCKPIT_PORT", cfg.port))
    cfg.runs_dir = os.environ.get("COCKPIT_RUNS_DIR", cfg.runs_dir)
    cfg.live_frame_interval_seconds = float(
        os.environ.get("COCKPIT_LIVE_FRAME_INTERVAL_SECONDS", cfg.live_frame_interval_seconds)
    )
    cfg.live_state_interval_seconds = float(
        os.environ.get("COCKPIT_LIVE_STATE_INTERVAL_SECONDS", cfg.live_state_interval_seconds)
    )
    cfg.ai.base_url = os.environ.get("COCKPIT_AI_BASE_URL", cfg.ai.base_url)
    cfg.ai.model = os.environ.get("COCKPIT_AI_MODEL", cfg.ai.model)
    cfg.ai.provider_name = os.environ.get("COCKPIT_AI_PROVIDER_NAME", cfg.ai.provider_name)
    cfg.ai.reasoning_effort = os.environ.get("COCKPIT_AI_REASONING_EFFORT", cfg.ai.reasoning_effort)
    cfg.ai.reasoning_summary = os.environ.get("COCKPIT_AI_REASONING_SUMMARY", cfg.ai.reasoning_summary)
    cfg.ai.api_key = os.environ.get("OPENAI_API_KEY", cfg.ai.api_key)
    cfg.ai.max_context_chars = int(os.environ.get("COCKPIT_AI_MAX_CONTEXT_CHARS", cfg.ai.max_context_chars))
    cfg.ai.target_context_chars = int(
        os.environ.get("COCKPIT_AI_TARGET_CONTEXT_CHARS", cfg.ai.target_context_chars)
    )
    cfg.ai.recent_event_target = int(os.environ.get("COCKPIT_AI_RECENT_EVENT_TARGET", cfg.ai.recent_event_target))
    cfg.ai.large_event_chars = int(os.environ.get("COCKPIT_AI_LARGE_EVENT_CHARS", cfg.ai.large_event_chars))
    cfg.ai.max_tool_output_chars = int(
        os.environ.get("COCKPIT_AI_MAX_TOOL_OUTPUT_CHARS", cfg.ai.max_tool_output_chars)
    )
    cfg.ai.ai_context_summary_enabled = parse_bool(
        os.environ.get("COCKPIT_AI_CONTEXT_SUMMARY_ENABLED"),
        cfg.ai.ai_context_summary_enabled,
    )
    cfg.ai.ai_context_summary_trigger_chars = int(
        os.environ.get("COCKPIT_AI_CONTEXT_SUMMARY_TRIGGER_CHARS", cfg.ai.ai_context_summary_trigger_chars)
    )
    cfg.ai.ai_context_summary_max_chars = int(
        os.environ.get("COCKPIT_AI_CONTEXT_SUMMARY_MAX_CHARS", cfg.ai.ai_context_summary_max_chars)
    )
    pinned_context_files = os.environ.get("COCKPIT_AI_PINNED_CONTEXT_FILES")
    if pinned_context_files:
        cfg.ai.pinned_context_files = [item.strip() for item in pinned_context_files.split(",") if item.strip()]

    env = {}
    for key, value in cfg.mcp.env.items():
        env[key] = expand_path(value) or value
    env.setdefault("PYTHONPATH", str(DROPLOGIC_ROOT))
    env.setdefault("DROPLOGIC_COCKPIT_MODE", "1")
    env.setdefault("DROPLOGIC_VISUALIZER_HEADLESS", "1")
    env.setdefault("DROPLOGIC_MCP_CONTEXT_DIR", str(COCKPIT_CONTEXT_ROOT))
    env.setdefault("DROPLOGIC_COCKPIT_URL", f"http://{cfg.host}:{cfg.port}")
    context_dir = Path(env["DROPLOGIC_MCP_CONTEXT_DIR"])
    if not context_dir.is_absolute():
        context_dir = (COCKPIT_ROOT / context_dir).resolve()
    env["DROPLOGIC_MCP_CONTEXT_DIR"] = str(context_dir)
    cfg.mcp.env = env

    if cfg.ai.base_url:
        cfg.ai.base_url = cfg.ai.base_url.rstrip("/")


def parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}
