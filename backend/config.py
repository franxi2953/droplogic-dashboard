from __future__ import annotations

import json
import os
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
class AiProfile:
    id: str
    label: str
    base_url: str | None = None
    model: str | None = None
    provider_name: str | None = None
    wire_api: str = "responses"
    reasoning_effort: str | None = None
    reasoning_summary: str | None = None
    api_key: str | None = None
    api_key_id: str | None = None
    api_key_env: str | None = None


@dataclass
class AiConfig:
    enabled: bool = True
    base_url: str | None = None
    model: str | None = None
    provider_name: str | None = None
    wire_api: str = "responses"
    reasoning_effort: str | None = None
    reasoning_summary: str | None = "auto"
    api_key: str | None = None
    ai_config_file: str = "backend/ai_config.local.json"
    ai_auth_file: str = "backend/ai_auth.local.json"
    active_profile: str | None = None
    profiles: list[AiProfile] = field(default_factory=list)
    # The cockpit budgets model context in characters. Use ~4 chars/token as
    # a conservative conversion, so 800k chars is roughly 200k tokens.
    max_context_chars: int = 800_000
    target_context_chars: int = 60_000
    recent_event_target: int = 120
    large_event_chars: int = 8_000
    max_tool_output_chars: int = 6_000
    ai_context_summary_enabled: bool = True
    ai_context_summary_trigger_chars: int = 300_000
    ai_context_summary_max_chars: int = 12_000
    pinned_context_files: list[str] = field(
        default_factory=lambda: ["agent-guide.md", "cockpit-mode.md", "cartridge.default.json"]
    )


@dataclass
class SpeechConfig:
    enabled: bool = True
    engine: str = "faster_whisper"
    model: str = "large-v3-turbo"
    device: str = "auto"
    compute_type: str = "int8"
    language: str | None = None
    vad_filter: bool = True
    beam_size: int = 1
    best_of: int = 1
    temperature: float = 0.0
    condition_on_previous_text: bool = False
    preload: bool = False
    wake_enabled: bool = True
    wake_auto_start: bool = False
    wake_word: str = "BoxMini"
    wake_language: str | None = None
    wake_auto_submit: bool = True
    wake_command_max_seconds: int = 24
    wake_silence_ms: int = 1200
    wake_initial_silence_ms: int = 5000
    initial_prompt: str | None = (
        "DropLogic BoxMini laboratory control. Common words: BoxMini, DropLogic, "
        "dashboard, droplet, droplets, reservoir, injection, extraction, cartridge, "
        "whole cartridge, whole chip, matrix, electrodes, streamer, visualizer, "
        "Brightfield, FAM, coaxial, ring light, exposure, analog gain, stage, X axis, "
        "Y axis, Z axis, temperature, melting probes, IVT, TX TL, MCP."
    )
    hotwords: str | None = (
        "BoxMini DropLogic droplet droplets reservoir injection extraction cartridge "
        "whole cartridge whole chip matrix electrodes streamer visualizer Brightfield "
        "FAM coaxial ring light exposure analog gain stage temperature melting probes "
        "IVT TX TL MCP"
    )
    max_audio_seconds: int = 90
    max_audio_bytes: int = 25_000_000


@dataclass
class CockpitConfig:
    host: str = "127.0.0.1"
    port: int = 8787
    runs_dir: str = "runs"
    live_frame_interval_seconds: float = 0.33
    live_streamer_interval_seconds: float = 0.12
    live_state_interval_seconds: float = 1.0
    mcp: McpConfig = field(default_factory=McpConfig)
    ai: AiConfig = field(default_factory=AiConfig)
    speech: SpeechConfig = field(default_factory=SpeechConfig)


def load_config(path: str | None = None) -> CockpitConfig:
    config_path = Path(path or os.environ.get("COCKPIT_CONFIG", "config.example.json"))
    if not config_path.is_absolute():
        config_path = COCKPIT_ROOT / config_path
    raw = load_json(config_path)

    mcp_raw = raw.get("mcp", {}) if isinstance(raw, dict) else {}
    ai_raw = raw.get("ai", {}) if isinstance(raw, dict) else {}
    speech_raw = raw.get("speech", {}) if isinstance(raw, dict) else {}
    cfg = CockpitConfig(
        host=str(raw.get("host", "127.0.0.1")),
        port=int(raw.get("port", 8787)),
        runs_dir=str(raw.get("runs_dir", "runs")),
        live_frame_interval_seconds=float(raw.get("live_frame_interval_seconds", 0.33)),
        live_streamer_interval_seconds=float(raw.get("live_streamer_interval_seconds", 0.12)),
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
            wire_api=str(ai_raw.get("wire_api", "responses")),
            reasoning_effort=ai_raw.get("reasoning_effort"),
            reasoning_summary=ai_raw.get("reasoning_summary", "auto"),
            api_key=ai_raw.get("api_key"),
            ai_config_file=str(ai_raw.get("ai_config_file", "backend/ai_config.local.json")),
            ai_auth_file=str(ai_raw.get("ai_auth_file", "backend/ai_auth.local.json")),
            active_profile=ai_raw.get("active_profile") or ai_raw.get("active_profile_id"),
            profiles=[
                parse_ai_profile(item)
                for item in ai_raw.get("profiles", [])
                if isinstance(item, dict)
            ],
            max_context_chars=int(ai_raw.get("max_context_chars", 800_000)),
            target_context_chars=int(ai_raw.get("target_context_chars", 60_000)),
            recent_event_target=int(ai_raw.get("recent_event_target", 120)),
            large_event_chars=int(ai_raw.get("large_event_chars", 8_000)),
            max_tool_output_chars=int(ai_raw.get("max_tool_output_chars", 6_000)),
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
        speech=SpeechConfig(
            enabled=bool(speech_raw.get("enabled", True)),
            engine=str(speech_raw.get("engine", "faster_whisper")),
            model=str(speech_raw.get("model", "large-v3-turbo")),
            device=str(speech_raw.get("device", "auto")),
            compute_type=str(speech_raw.get("compute_type", "int8")),
            language=speech_raw.get("language"),
            vad_filter=bool(speech_raw.get("vad_filter", True)),
            beam_size=int(speech_raw.get("beam_size", 1)),
            best_of=int(speech_raw.get("best_of", 1)),
            temperature=float(speech_raw.get("temperature", 0.0)),
            condition_on_previous_text=bool(speech_raw.get("condition_on_previous_text", False)),
            preload=bool(speech_raw.get("preload", SpeechConfig().preload)),
            wake_enabled=bool(speech_raw.get("wake_enabled", True)),
            wake_auto_start=bool(speech_raw.get("wake_auto_start", False)),
            wake_word=str(speech_raw.get("wake_word", "BoxMini")),
            wake_language=speech_raw.get("wake_language"),
            wake_auto_submit=bool(speech_raw.get("wake_auto_submit", True)),
            wake_command_max_seconds=int(speech_raw.get("wake_command_max_seconds", 24)),
            wake_silence_ms=int(speech_raw.get("wake_silence_ms", 1200)),
            wake_initial_silence_ms=int(speech_raw.get("wake_initial_silence_ms", 5000)),
            initial_prompt=speech_raw.get("initial_prompt", SpeechConfig().initial_prompt),
            hotwords=speech_raw.get("hotwords", SpeechConfig().hotwords),
            max_audio_seconds=int(speech_raw.get("max_audio_seconds", 90)),
            max_audio_bytes=int(speech_raw.get("max_audio_bytes", 25_000_000)),
        ),
    )
    apply_dashboard_ai_files(cfg.ai)
    apply_env_overrides(cfg)
    finalize_ai_profiles(cfg.ai)
    return cfg


def parse_ai_profile(raw: dict[str, Any]) -> AiProfile:
    model = raw.get("model")
    profile_id = str(raw.get("id") or raw.get("profile_id") or profile_id_from_model(model) or "model")
    return AiProfile(
        id=profile_id,
        label=str(raw.get("label") or raw.get("name") or profile_id),
        base_url=raw.get("base_url"),
        model=str(model) if model else None,
        provider_name=raw.get("provider_name"),
        wire_api=str(raw.get("wire_api", "responses")),
        reasoning_effort=raw.get("reasoning_effort"),
        reasoning_summary=raw.get("reasoning_summary"),
        api_key=raw.get("api_key"),
        api_key_id=raw.get("api_key_id") or raw.get("key_id"),
        api_key_env=raw.get("api_key_env"),
    )


def apply_dashboard_ai_files(ai: AiConfig) -> None:
    config_path = resolve_dashboard_path(
        os.environ.get("DASHBOARD_AI_CONFIG", ai.ai_config_file),
        default_filename="ai_config.local.json",
    )
    raw_config = load_json(config_path)
    if raw_config:
        if "enabled" in raw_config:
            ai.enabled = bool(raw_config["enabled"])
        ai.base_url = raw_config.get("base_url", ai.base_url)
        ai.model = raw_config.get("model", ai.model)
        ai.provider_name = raw_config.get("provider_name", ai.provider_name)
        ai.wire_api = str(raw_config.get("wire_api", ai.wire_api))
        ai.reasoning_effort = raw_config.get("reasoning_effort", ai.reasoning_effort)
        ai.reasoning_summary = raw_config.get("reasoning_summary", ai.reasoning_summary)
        ai.active_profile = raw_config.get("active_profile") or raw_config.get("active_profile_id") or ai.active_profile
        if isinstance(raw_config.get("profiles"), list):
            ai.profiles = [
                parse_ai_profile(item)
                for item in raw_config["profiles"]
                if isinstance(item, dict)
            ]

    auth = load_json(
        resolve_dashboard_path(
            os.environ.get("DASHBOARD_AI_AUTH", ai.ai_auth_file),
            default_filename="ai_auth.local.json",
        )
    )
    apply_ai_auth(ai, auth)


def apply_env_overrides(cfg: CockpitConfig) -> None:
    cfg.host = os.environ.get("COCKPIT_HOST", cfg.host)
    cfg.port = int(os.environ.get("COCKPIT_PORT", cfg.port))
    cfg.runs_dir = os.environ.get("COCKPIT_RUNS_DIR", cfg.runs_dir)
    cfg.live_frame_interval_seconds = float(
        os.environ.get("COCKPIT_LIVE_FRAME_INTERVAL_SECONDS", cfg.live_frame_interval_seconds)
    )
    cfg.live_streamer_interval_seconds = float(
        os.environ.get("COCKPIT_LIVE_STREAMER_INTERVAL_SECONDS", cfg.live_streamer_interval_seconds)
    )
    cfg.live_state_interval_seconds = float(
        os.environ.get("COCKPIT_LIVE_STATE_INTERVAL_SECONDS", cfg.live_state_interval_seconds)
    )
    cfg.ai.base_url = os.environ.get("COCKPIT_AI_BASE_URL", cfg.ai.base_url)
    cfg.ai.model = os.environ.get("COCKPIT_AI_MODEL", cfg.ai.model)
    cfg.ai.provider_name = os.environ.get("COCKPIT_AI_PROVIDER_NAME", cfg.ai.provider_name)
    cfg.ai.wire_api = os.environ.get("COCKPIT_AI_WIRE_API", cfg.ai.wire_api)
    cfg.ai.reasoning_effort = os.environ.get("COCKPIT_AI_REASONING_EFFORT", cfg.ai.reasoning_effort)
    cfg.ai.reasoning_summary = os.environ.get("COCKPIT_AI_REASONING_SUMMARY", cfg.ai.reasoning_summary)
    cfg.ai.ai_config_file = os.environ.get("DASHBOARD_AI_CONFIG", cfg.ai.ai_config_file)
    cfg.ai.ai_auth_file = os.environ.get("DASHBOARD_AI_AUTH", cfg.ai.ai_auth_file)
    cfg.ai.active_profile = os.environ.get("COCKPIT_AI_PROFILE", cfg.ai.active_profile)
    profiles_json = os.environ.get("COCKPIT_AI_PROFILES_JSON")
    if profiles_json:
        try:
            parsed_profiles = json.loads(profiles_json)
            if isinstance(parsed_profiles, list):
                cfg.ai.profiles = [parse_ai_profile(item) for item in parsed_profiles if isinstance(item, dict)]
        except json.JSONDecodeError:
            pass
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

    cfg.speech.enabled = parse_bool(os.environ.get("DASHBOARD_SPEECH_ENABLED"), cfg.speech.enabled)
    cfg.speech.engine = os.environ.get("DASHBOARD_SPEECH_ENGINE", cfg.speech.engine)
    cfg.speech.model = os.environ.get("DASHBOARD_SPEECH_MODEL", cfg.speech.model)
    cfg.speech.device = os.environ.get("DASHBOARD_SPEECH_DEVICE", cfg.speech.device)
    cfg.speech.compute_type = os.environ.get("DASHBOARD_SPEECH_COMPUTE_TYPE", cfg.speech.compute_type)
    cfg.speech.language = os.environ.get("DASHBOARD_SPEECH_LANGUAGE", cfg.speech.language)
    cfg.speech.vad_filter = parse_bool(os.environ.get("DASHBOARD_SPEECH_VAD_FILTER"), cfg.speech.vad_filter)
    cfg.speech.beam_size = int(os.environ.get("DASHBOARD_SPEECH_BEAM_SIZE", cfg.speech.beam_size))
    cfg.speech.best_of = int(os.environ.get("DASHBOARD_SPEECH_BEST_OF", cfg.speech.best_of))
    cfg.speech.temperature = float(os.environ.get("DASHBOARD_SPEECH_TEMPERATURE", cfg.speech.temperature))
    cfg.speech.condition_on_previous_text = parse_bool(
        os.environ.get("DASHBOARD_SPEECH_CONDITION_ON_PREVIOUS_TEXT"),
        cfg.speech.condition_on_previous_text,
    )
    cfg.speech.preload = parse_bool(os.environ.get("DASHBOARD_SPEECH_PRELOAD"), cfg.speech.preload)
    cfg.speech.wake_enabled = parse_bool(os.environ.get("DASHBOARD_SPEECH_WAKE_ENABLED"), cfg.speech.wake_enabled)
    cfg.speech.wake_auto_start = parse_bool(
        os.environ.get("DASHBOARD_SPEECH_WAKE_AUTO_START"),
        cfg.speech.wake_auto_start,
    )
    cfg.speech.wake_word = os.environ.get("DASHBOARD_SPEECH_WAKE_WORD", cfg.speech.wake_word)
    cfg.speech.wake_language = os.environ.get("DASHBOARD_SPEECH_WAKE_LANGUAGE", cfg.speech.wake_language)
    cfg.speech.wake_auto_submit = parse_bool(
        os.environ.get("DASHBOARD_SPEECH_WAKE_AUTO_SUBMIT"),
        cfg.speech.wake_auto_submit,
    )
    cfg.speech.wake_command_max_seconds = int(
        os.environ.get("DASHBOARD_SPEECH_WAKE_COMMAND_MAX_SECONDS", cfg.speech.wake_command_max_seconds)
    )
    cfg.speech.wake_silence_ms = int(
        os.environ.get("DASHBOARD_SPEECH_WAKE_SILENCE_MS", cfg.speech.wake_silence_ms)
    )
    cfg.speech.wake_initial_silence_ms = int(
        os.environ.get("DASHBOARD_SPEECH_WAKE_INITIAL_SILENCE_MS", cfg.speech.wake_initial_silence_ms)
    )
    cfg.speech.initial_prompt = os.environ.get("DASHBOARD_SPEECH_INITIAL_PROMPT", cfg.speech.initial_prompt)
    cfg.speech.hotwords = os.environ.get("DASHBOARD_SPEECH_HOTWORDS", cfg.speech.hotwords)
    cfg.speech.max_audio_seconds = int(
        os.environ.get("DASHBOARD_SPEECH_MAX_AUDIO_SECONDS", cfg.speech.max_audio_seconds)
    )
    cfg.speech.max_audio_bytes = int(
        os.environ.get("DASHBOARD_SPEECH_MAX_AUDIO_BYTES", cfg.speech.max_audio_bytes)
    )

    env = {}
    for key, value in cfg.mcp.env.items():
        env[key] = expand_path(value) or value
    env.setdefault("PYTHONPATH", str(DROPLOGIC_ROOT))
    env.setdefault("DROPLOGIC_COCKPIT_MODE", "1")
    env.setdefault("DROPLOGIC_VISUALIZER_HEADLESS", "1")
    env.setdefault("DROPLOGIC_MCP_CONTEXT_DIR", str(COCKPIT_CONTEXT_ROOT))
    env.setdefault("DROPLOGIC_COCKPIT_URL", f"http://{cfg.host}:{cfg.port}")
    env.setdefault("DROPLOGIC_DASHBOARD_SCENE_PATH", str(COCKPIT_ROOT / "runtime" / "dashboard_scene.json"))
    context_dir = Path(env["DROPLOGIC_MCP_CONTEXT_DIR"])
    if not context_dir.is_absolute():
        context_dir = (COCKPIT_ROOT / context_dir).resolve()
    env["DROPLOGIC_MCP_CONTEXT_DIR"] = str(context_dir)
    scene_path = Path(env["DROPLOGIC_DASHBOARD_SCENE_PATH"])
    if not scene_path.is_absolute():
        scene_path = (COCKPIT_ROOT / scene_path).resolve()
    env["DROPLOGIC_DASHBOARD_SCENE_PATH"] = str(scene_path)
    cfg.mcp.env = env

    if cfg.ai.base_url:
        cfg.ai.base_url = cfg.ai.base_url.rstrip("/")


def finalize_ai_profiles(ai: AiConfig) -> None:
    if ai.base_url:
        ai.base_url = ai.base_url.rstrip("/")

    if not ai.profiles and (ai.model or ai.base_url or ai.api_key):
        ai.profiles.append(
            AiProfile(
                id=profile_id_from_model(ai.model or "model"),
                label=str(ai.model or "AI Model"),
                base_url=ai.base_url,
                model=ai.model,
                provider_name=ai.provider_name,
                wire_api=ai.wire_api,
                reasoning_effort=ai.reasoning_effort,
                reasoning_summary=ai.reasoning_summary,
                api_key=ai.api_key,
            )
        )

    for profile in ai.profiles:
        resolve_ai_profile(profile, ai)

    if not ai.active_profile:
        configured = next((profile for profile in ai.profiles if ai_profile_configured(profile)), None)
        claude = next((
            profile for profile in ai.profiles
            if ai_profile_configured(profile)
            and "claude" in f"{profile.id} {profile.label} {profile.model}".lower()
        ), None)
        ai.active_profile = (claude or configured or ai.profiles[0]).id if ai.profiles else None
    select_ai_profile(ai, ai.active_profile, raise_on_missing=False)


def resolve_dashboard_path(value: str | None, default_filename: str) -> Path:
    if not value:
        return COCKPIT_ROOT / "backend" / default_filename
    path = Path(expand_path(value) or value)
    if path.is_absolute():
        return path
    return COCKPIT_ROOT / path


def apply_ai_auth(ai: AiConfig, auth: dict[str, Any]) -> None:
    keys = auth.get("api_keys") if isinstance(auth.get("api_keys"), dict) else auth
    if not isinstance(keys, dict):
        return
    for profile in ai.profiles:
        candidates = [
            profile.api_key_id,
            profile.id,
            profile.model,
            profile.label,
        ]
        for candidate in candidates:
            if candidate and candidate in keys and not profile.api_key:
                profile.api_key = str(keys[candidate])
                break
    if not ai.api_key:
        for key in ("default", ai.active_profile, ai.model):
            if key and key in keys:
                ai.api_key = str(keys[key])
                break


def resolve_ai_profile(profile: AiProfile, fallback: AiConfig) -> None:
    fill_profile_field(profile, "base_url", fallback.base_url)
    fill_profile_field(profile, "provider_name", fallback.provider_name)
    fill_profile_field(profile, "wire_api", fallback.wire_api)
    fill_profile_field(profile, "reasoning_effort", fallback.reasoning_effort)
    fill_profile_field(profile, "reasoning_summary", fallback.reasoning_summary)
    if profile.api_key_env and not profile.api_key:
        profile.api_key = os.environ.get(profile.api_key_env)
    if profile.base_url:
        profile.base_url = profile.base_url.rstrip("/")
    if not profile.reasoning_summary:
        profile.reasoning_summary = fallback.reasoning_summary


def fill_profile_field(profile: AiProfile, field_name: str, value: str | None) -> None:
    if getattr(profile, field_name) in {None, ""} and value not in {None, ""}:
        setattr(profile, field_name, value)


def select_ai_profile(
    ai: AiConfig,
    profile_id: str | None,
    raise_on_missing: bool = True,
) -> dict[str, Any]:
    profile = find_ai_profile(ai, profile_id)
    if profile is None:
        if raise_on_missing:
            raise ValueError(f"AI profile not found: {profile_id}")
        return active_ai_profile_public(ai)
    resolve_ai_profile(profile, ai)
    ai.active_profile = profile.id
    ai.base_url = profile.base_url
    ai.model = profile.model
    ai.provider_name = profile.provider_name
    ai.wire_api = profile.wire_api
    ai.reasoning_effort = profile.reasoning_effort
    ai.reasoning_summary = profile.reasoning_summary
    ai.api_key = profile.api_key
    return ai_profile_public(profile, active=True)


def find_ai_profile(ai: AiConfig, profile_id: str | None) -> AiProfile | None:
    return find_ai_profile_in_list(ai.profiles, profile_id)


def find_ai_profile_in_list(profiles: list[AiProfile], profile_id: str | None) -> AiProfile | None:
    if not profile_id:
        return None
    return next((profile for profile in profiles if profile.id == profile_id), None)


def ai_profiles_public(ai: AiConfig) -> list[dict[str, Any]]:
    return [ai_profile_public(profile, active=profile.id == ai.active_profile) for profile in ai.profiles]


def active_ai_profile_public(ai: AiConfig) -> dict[str, Any]:
    profile = find_ai_profile(ai, ai.active_profile)
    if profile is not None:
        return ai_profile_public(profile, active=True)
    return {
        "id": ai.active_profile,
        "label": ai.model or "AI",
        "provider": ai.provider_name,
        "base_url": ai.base_url,
        "model": ai.model,
        "wire_api": ai.wire_api,
        "reasoning_effort": ai.reasoning_effort,
        "reasoning_summary": ai.reasoning_summary,
        "configured": bool(ai.enabled and ai.api_key and ai.base_url and ai.model),
        "active": True,
        "has_api_key": bool(ai.api_key),
    }


def ai_profile_public(profile: AiProfile, active: bool = False) -> dict[str, Any]:
    return {
        "id": profile.id,
        "label": profile.label,
        "provider": profile.provider_name,
        "base_url": profile.base_url,
        "model": profile.model,
        "wire_api": profile.wire_api,
        "reasoning_effort": profile.reasoning_effort,
        "reasoning_summary": profile.reasoning_summary,
        "api_key_id": profile.api_key_id,
        "configured": ai_profile_configured(profile),
        "active": active,
        "has_api_key": bool(profile.api_key),
    }


def ai_profile_configured(profile: AiProfile) -> bool:
    return bool(profile.api_key and profile.base_url and profile.model)


def profile_id_from_model(model: Any) -> str:
    text = str(model or "").strip().lower()
    cleaned = []
    previous_dash = False
    for char in text:
        if char.isalnum():
            cleaned.append(char)
            previous_dash = False
        elif not previous_dash:
            cleaned.append("-")
            previous_dash = True
    return "".join(cleaned).strip("-") or "model"


def parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}
