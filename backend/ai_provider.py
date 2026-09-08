from __future__ import annotations

import asyncio
from copy import deepcopy
import re
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .config import AiConfig, active_ai_profile_public, ai_profiles_public, select_ai_profile
from .context_builder import (
    build_run_memory,
    compact_tool_output_for_model,
    compact_value,
    encoded_json_length,
    stale_state_snapshot_indices,
)
from .pinned_context import parse_guide_shard_selection


RETRY_PAYLOAD_COMPACT_EVERY = 5
RETRY_PAYLOAD_EVENT_LOG_TARGET_CHARS = 70_000
RETRY_PAYLOAD_MIN_EVENT_LOG_TARGET_CHARS = 16_000
RETRY_PAYLOAD_MIN_TOOL_OUTPUT_CHARS = 1_500
MODEL_ATTACHMENTS_KEY = "_cockpit_model_attachments"
RECENT_INPUT_TOOL_PAIRS_KEEP = 2
RECENT_INPUT_TOOL_RESULT_WINDOW = 8
MAX_ACTIVE_TOOL_OUTPUT_CHARS = 2_500
MAX_ACTIVE_TOOL_OUTPUT_BATCH_CHARS = 6_000
MIN_ACTIVE_TOOL_OUTPUT_CHARS = 500
MAX_CHAT_TRANSCRIPT_CHARS = 220_000
CHAT_TRANSCRIPT_RECENT_MESSAGES = 10
CHAT_CONTEXT_CHARS_PER_TOKEN = 2
CHAT_CONTEXT_REQUEST_RESERVE_CHARS = 8_000
RESPONSE_CONTEXT_SCHEMA_VERSION = 1
MAX_RESPONSE_CONTEXT_CHARS = 100_000
MIN_RESPONSE_CONTEXT_CHARS = 20_000
DASHBOARD_CONTEXT_PREFIX = "Curated dashboard event log JSON for model context:\n"
DASHBOARD_AGENT_INSTRUCTIONS = (
    "You are the DropLogic Dashboard agent controlling BoxMini through MCP tools. "
    "When the user asks for an action, call the appropriate MCP tools and execute it; "
    "do not merely propose steps. Use the event log to avoid repeating completed work. "
    "For hardware actions, proceed carefully, report errors, and do not claim success "
    "unless the tool result confirms it. Keep user-facing narration brief, but use the "
    "available tool calls to make real progress. Continue tool-use until the requested "
    "checkpoint is reached, a user confirmation is required, or a real blocker/error occurs. "
    "On every continuation, read the most recent MCP result first. Identify the last confirmed "
    "action and the single immediate unmet requirement, then call exactly the next tool needed. "
    "Reason as far ahead as necessary to choose that action safely, but do not repeatedly enumerate "
    "or re-plan the entire protocol. Treat required_next_tool and recommended_status_call in an MCP "
    "result as authoritative unless they conflict with safety or the named tool is unavailable. "
    "Do not query status after every action; when fresh live state is needed, prefer "
    "execution_status_summary() over separate runtime/executor/matrix/droplet/plan status calls. "
    "If execute_segment_to_breakpoint starts a background wait, call "
    "execution_wait_status(wait_seconds=recommended_wait_seconds) as a timer and avoid "
    "repeated immediate status calls. If background planning is running, call "
    "planning_job_status once and wait for its returned result instead of polling in a tight loop. "
    "A successful load_system or restart_system is initialization already completed: never initialize "
    "or clear state again in the same request unless a later tool result explicitly proves the runtime "
    "failed. Match every emitted tool call to the immediate next action stated in your reasoning. "
    "When the user asks to show the whole cartridge, use whole_chip_camera and request a streamer "
    "visualizer_frame so the camera image is actually recorded and previewable. When the request says "
    "to show the whole cartridge during the protocol, preserve whole_chip_camera for every segment; "
    "do not switch back to follow_droplets unless the user requests a microscope inspection."
)


def successful_goal_completion(tool: str, result: Any) -> bool:
    """Return true only for the dashboard's terminal completion result."""
    return (
        tool == "dashboard_complete_goal"
        and isinstance(result, dict)
        and result.get("ok") is True
        and result.get("status") == "complete"
    )


def compact_chat_transcript(messages: list[dict[str, Any]], max_chars: int = MAX_CHAT_TRANSCRIPT_CHARS) -> int:
    """Bound the in-flight transcript accumulated across tool rounds."""
    if encoded_json_length(messages) <= max_chars:
        return 0
    prefix = messages[:2]
    tail = messages[2:]
    kept = tail[-CHAT_TRANSCRIPT_RECENT_MESSAGES:]
    if kept and kept[0].get("role") == "tool" and len(tail) > len(kept):
        kept.insert(0, tail[-CHAT_TRANSCRIPT_RECENT_MESSAGES - 1])
    marker = {
        "role": "user",
        "content": (
            "Earlier tool transcript was compacted for context safety. "
            "Use the authoritative event log and recent tool result; do not repeat confirmed actions."
        ),
    }
    compacted = [*prefix, marker, *kept]
    # Keep the most recent state if the initial snapshot itself is unusually large.
    while encoded_json_length(compacted) > max_chars and len(compacted) > 3:
        compacted.pop(3)
    if encoded_json_length(compacted) > max_chars:
        for item in compacted:
            content = item.get("content")
            if isinstance(content, str) and len(content) > 2_000:
                item["content"] = content[-2_000:]
        while encoded_json_length(compacted) > max_chars and len(compacted) > 2:
            compacted.pop(2)
    removed = max(0, len(messages) - len(compacted))
    messages[:] = compacted
    return removed


def chat_request_char_limit(config: AiConfig) -> int | None:
    """Translate a configured token limit into a conservative JSON request budget."""
    try:
        max_context_tokens = int(config.max_context_tokens or 0)
    except (TypeError, ValueError):
        max_context_tokens = 0
    if max_context_tokens <= 0:
        return None
    return max_context_tokens * CHAT_CONTEXT_CHARS_PER_TOKEN - CHAT_CONTEXT_REQUEST_RESERVE_CHARS


def enforce_chat_payload_budget(payload: dict[str, Any], config: AiConfig) -> dict[str, Any] | None:
    """Compact dashboard-owned chat history before it reaches the gateway."""
    request_limit = chat_request_char_limit(config)
    messages = payload.get("messages")
    if request_limit is None or not isinstance(messages, list):
        return None
    before = encoded_json_length(payload)
    if before <= request_limit:
        return None

    fixed_payload = dict(payload)
    fixed_payload["messages"] = []
    fixed_chars = encoded_json_length(fixed_payload)
    message_limit = request_limit - fixed_chars
    if message_limit < 4_000:
        raise RuntimeError(
            "Configured AI context budget is too small for the current MCP tool schemas. "
            f"Request limit: {request_limit} chars; non-message payload: {fixed_chars} chars."
        )

    # Dashboard context is structured JSON, so compact it structurally before
    # dropping complete historical chat turns.
    compacted_context_sections = compact_input_user_contexts(
        messages,
        target_chars=max(4_000, message_limit // 2),
    )
    removed_messages = compact_chat_transcript(messages, max_chars=message_limit)
    after = encoded_json_length(payload)
    if after > request_limit:
        raise RuntimeError(
            "Dashboard could not fit the request within the configured AI context budget. "
            f"Request: {after} chars; limit: {request_limit} chars."
        )
    return {
        "scope": "chat_context_budget",
        "message": "Dashboard compacted chat context before the provider request.",
        "max_context_tokens": config.max_context_tokens,
        "estimated_chars_before": before,
        "estimated_chars_after": after,
        "request_char_limit": request_limit,
        "message_char_limit": message_limit,
        "compacted_user_context_sections": compacted_context_sections,
        "removed_messages": removed_messages,
    }


@dataclass
class ResponseContextSession:
    """Opaque Responses items that must round-trip across dashboard prompts."""

    profile_id: str
    model: str
    items: list[dict[str, Any]]
    path: Path | None = None
    revision: int = 0
    last_response_id: str | None = None
    loaded_from_disk: bool = False


def response_context_char_limit(max_context_chars: int | None) -> int:
    """Reserve room for current state, guides, instructions, and tool schemas."""

    try:
        configured = int(max_context_chars or 0)
    except (TypeError, ValueError):
        configured = 0
    available = configured - 150_000 if configured else MAX_RESPONSE_CONTEXT_CHARS
    return max(MIN_RESPONSE_CONTEXT_CHARS, min(MAX_RESPONSE_CONTEXT_CHARS, available))


def is_dashboard_context_input(item: dict[str, Any]) -> bool:
    return (
        item.get("role") == "user"
        and isinstance(item.get("content"), str)
        and item["content"].startswith(DASHBOARD_CONTEXT_PREFIX)
    )


def dashboard_user_request(item: dict[str, Any]) -> str:
    content = item.get("content")
    if not isinstance(content, str):
        return ""
    marker = "\n\nUser request:\n"
    _, separator, request = content.partition(marker)
    return request.strip() if separator else ""


def response_context_items(
    input_list: list[dict[str, Any]],
    data: dict[str, Any],
    retain_dashboard_user_requests: bool = False,
) -> list[dict[str, Any]]:
    """Keep provider output/tool pairs, but replace prior bulky dashboard snapshots.

    A fresh authoritative event/state snapshot is supplied with each user prompt. The
    retained output items carry the encrypted reasoning, assistant phase, and tool-call
    identity needed by the Responses API for continuity.
    """

    items = []
    for item in input_list:
        if not isinstance(item, dict):
            continue
        if is_dashboard_context_input(item):
            if retain_dashboard_user_requests:
                request = dashboard_user_request(item)
                if request:
                    items.append({"role": "user", "content": request})
            continue
        items.append(item)
    items.extend(item for item in data.get("output", []) or [] if isinstance(item, dict))
    return deepcopy(items)


def load_response_context_session(
    path: Path | None,
    profile_id: str,
    model: str,
) -> ResponseContextSession:
    session = ResponseContextSession(profile_id=profile_id, model=model, items=[], path=path)
    if path is None or not path.exists():
        return session
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return session
    if not isinstance(payload, dict):
        return session
    if payload.get("schema_version") != RESPONSE_CONTEXT_SCHEMA_VERSION:
        return session
    if str(payload.get("profile_id") or "") != profile_id or str(payload.get("model") or "") != model:
        return session
    stored_items = payload.get("items")
    if not isinstance(stored_items, list) or not all(isinstance(item, dict) for item in stored_items):
        return session
    session.items = stored_items
    session.revision = int(payload.get("revision") or 0)
    response_id = payload.get("last_response_id")
    session.last_response_id = str(response_id) if response_id else None
    session.loaded_from_disk = True
    return session


def save_response_context_session(session: ResponseContextSession) -> str | None:
    if session.path is None:
        return None
    payload = {
        "schema_version": RESPONSE_CONTEXT_SCHEMA_VERSION,
        "profile_id": session.profile_id,
        "model": session.model,
        "revision": session.revision,
        "last_response_id": session.last_response_id,
        "items": session.items,
    }
    try:
        session.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = session.path.with_suffix(".tmp")
        temporary_path.write_text(json.dumps(payload, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
        temporary_path.replace(session.path)
    except OSError as exc:
        return f"{type(exc).__name__}: {exc}"
    return None


class AiProvider:
    def __init__(self, config: AiConfig):
        self.config = config
        self._response_context_sessions: dict[str, ResponseContextSession] = {}

    def response_context_session(
        self,
        session_key: str | None,
        session_path: str | Path | None,
        profile_id: str | None,
    ) -> ResponseContextSession | None:
        if not session_key:
            return None
        expected_profile_id = str(profile_id or self.config.active_profile or self.config.model or "responses")
        expected_model = str(self.config.model or "")
        cached = self._response_context_sessions.get(session_key)
        if cached and cached.profile_id == expected_profile_id and cached.model == expected_model:
            return cached
        path = Path(session_path) if session_path else None
        session = load_response_context_session(path, expected_profile_id, expected_model)
        self._response_context_sessions[session_key] = session
        return session

    @property
    def configured(self) -> bool:
        return bool(self.config.enabled and self.config.api_key and self.config.base_url and self.config.model)

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "configured": self.configured,
            "provider": self.config.provider_name,
            "base_url": self.config.base_url,
            "model": self.config.model,
            "wire_api": self.config.wire_api,
            "reasoning_effort": self.config.reasoning_effort,
            "reasoning_summary": self.config.reasoning_summary,
            "reasoning_context": self.config.reasoning_context,
            "max_tool_rounds": self.config.max_tool_rounds,
            "tool_round_limit_enabled": self.config.max_tool_rounds is not None,
            "context_compaction_strategy": context_compaction_strategy(self.config),
            "native_response_compaction_enabled": bool(self.config.native_response_compaction_enabled),
            "native_response_compaction_threshold": self.config.native_response_compaction_threshold,
            "has_api_key": bool(self.config.api_key),
            "active_profile": self.config.active_profile,
            "profile": active_ai_profile_public(self.config),
            "profiles": ai_profiles_public(self.config),
        }

    def set_profile(self, profile_id: str) -> dict[str, Any]:
        return select_ai_profile(self.config, profile_id)

    async def ask(self, prompt: str, events: list[dict[str, Any]]) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("AI provider is not configured.")

        context = json.dumps(events, ensure_ascii=True, default=str)
        instructions = (
            "You are the DropLogic Dashboard brain. You inspect event logs and propose "
            "safe next actions. Do not claim physical actions happened unless they "
            "appear in the event log. Keep responses concise."
        )
        if uses_anthropic_messages(self.config):
            payload = {
                "model": self.config.model,
                "system": instructions,
                "max_tokens": 4096,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Curated dashboard event log JSON for model context:\n{context}\n\n"
                            f"User request:\n{prompt}"
                        ),
                    }
                ],
            }
            apply_anthropic_options(payload, self.config)
            data = await self._post_anthropic_message(payload, on_retry_compact=retry_payload_compactor(payload))
            return {
                "text": extract_anthropic_text(data),
                "reasoning": extract_anthropic_thinking(data),
                "raw": data,
            }

        if uses_chat_completions(self.config):
            payload = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": instructions},
                    {
                        "role": "user",
                        "content": (
                            f"Curated dashboard event log JSON for model context:\n{context}\n\n"
                            f"User request:\n{prompt}"
                        ),
                    },
                ],
            }
            apply_chat_options(payload, self.config)
            data = await self._post_chat_completion(payload, on_retry_compact=retry_payload_compactor(payload))
            return {
                "text": extract_chat_response_text(data),
                "reasoning": extract_chat_reasoning(data),
                "raw": data,
            }

        payload = {
            "model": self.config.model,
            "instructions": instructions,
            "input": [
                {
                    "role": "user",
                    "content": (
                        f"Curated dashboard event log JSON for model context:\n{context}\n\n"
                        f"User request:\n{prompt}"
                    ),
                }
            ],
        }
        apply_response_context_options(payload, self.config)
        if self.config.reasoning_effort or self.config.reasoning_summary or self.config.reasoning_context:
            apply_reasoning_options(payload, self.config)
        data = await self._post_response(payload, on_retry_compact=retry_payload_compactor(payload))
        return {
            "text": extract_response_text(data),
            "reasoning": extract_reasoning_summary(data),
            "raw": data,
        }

    async def name_run(self, events: list[dict[str, Any]]) -> str:
        if not self.configured:
            raise RuntimeError("AI provider is not configured.")

        instructions = (
            "Infer a concise human-readable name for this DropLogic BoxMini run. "
            "Return only the name, 2 to 5 words, Title Case. Prefer concrete lab intent "
            "such as Quick Test, In Vitro Transcription, Melting Curve, Protein Production, "
            "Droplet Extraction, Imaging Calibration, or Hardware Check. No quotes, no period."
        )
        payload = {
            "model": self.config.model,
            "instructions": instructions,
            "input": [
                {
                    "role": "user",
                    "content": json.dumps(events, ensure_ascii=True, default=str),
                }
            ],
        }
        if uses_anthropic_messages(self.config):
            anthropic_payload = {
                "model": self.config.model,
                "system": instructions,
                "max_tokens": 1000,
                "messages": [
                    {"role": "user", "content": json.dumps(events, ensure_ascii=True, default=str)}
                ],
            }
            data = await self._post_anthropic_message(
                anthropic_payload,
                on_retry_compact=retry_payload_compactor(anthropic_payload),
            )
            return sanitize_run_name(extract_anthropic_text(data))

        if uses_chat_completions(self.config):
            chat_payload = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": json.dumps(events, ensure_ascii=True, default=str)},
                ],
            }
            apply_chat_options(chat_payload, self.config)
            data = await self._post_chat_completion(chat_payload, on_retry_compact=retry_payload_compactor(chat_payload))
            return sanitize_run_name(extract_chat_response_text(data))
        apply_response_context_options(payload, self.config)
        data = await self._post_response(payload, on_retry_compact=retry_payload_compactor(payload))
        return sanitize_run_name(extract_response_text(data))

    async def summarize_context_memory(
        self,
        events: list[dict[str, Any]],
        max_chars: int = 6_000,
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_context_compacted: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> str:
        if not self.configured:
            raise RuntimeError("AI provider is not configured.")

        instructions = (
            "Create a compact narrative memory for a DropLogic BoxMini dashboard run. "
            "This memory is only for orientation and must not be treated as proof of current hardware state. "
            "Summarize the user's objective, confirmed completed actions, active blockers/errors, pending next steps, "
            "important file/output locations, and any user preferences. "
            "Do not invent physical state. For matrices, stage position, temperatures, droplet existence, voltage, "
            "or live hardware status, say that the agent must refresh state with execution_status_summary() "
            "or a targeted MCP tool before acting. "
            "Return plain text with short sections. Keep it concise."
        )
        context = json.dumps(events, ensure_ascii=True, default=str)
        payload = {
            "model": self.config.model,
            "instructions": instructions,
            "input": [
                {
                    "role": "user",
                    "content": (
                        f"Curated deterministic event log for summarization:\n{context}\n\n"
                        f"Maximum memory length: {max_chars} characters."
                    ),
                }
            ],
        }
        if uses_anthropic_messages(self.config):
            anthropic_payload = {
                "model": self.config.model,
                "system": instructions,
                "max_tokens": max(1000, min(8192, max_chars + 500)),
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Curated deterministic event log for summarization:\n{context}\n\n"
                            f"Maximum memory length: {max_chars} characters."
                        ),
                    }
                ],
            }
            apply_anthropic_options(anthropic_payload, self.config)
            data = await self._post_anthropic_message(
                anthropic_payload,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(
                    anthropic_payload,
                    max_tool_output_chars=6_000,
                    on_context_compacted=on_context_compacted,
                ),
            )
            text = extract_anthropic_text(data).strip()
            if len(text) > max_chars:
                text = f"{text[: max_chars - 200].rstrip()}\n\n[AI memory truncated to configured limit.]"
            return text

        if uses_chat_completions(self.config):
            chat_payload = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": instructions},
                    {
                        "role": "user",
                        "content": (
                            f"Curated deterministic event log for summarization:\n{context}\n\n"
                            f"Maximum memory length: {max_chars} characters."
                        ),
                    },
                ],
            }
            apply_chat_options(chat_payload, self.config)
            data = await self._post_chat_completion(
                chat_payload,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(
                    chat_payload,
                    max_tool_output_chars=6_000,
                    on_context_compacted=on_context_compacted,
                ),
            )
            text = extract_chat_response_text(data).strip()
            if len(text) > max_chars:
                text = f"{text[: max_chars - 200].rstrip()}\n\n[AI memory truncated to configured limit.]"
            return text
        apply_response_context_options(payload, self.config)
        data = await self._post_response(
            payload,
            on_retry=on_retry,
            on_retry_compact=retry_payload_compactor(
                payload,
                max_tool_output_chars=6_000,
                on_context_compacted=on_context_compacted,
            ),
        )
        text = extract_response_text(data).strip()
        if len(text) > max_chars:
            text = f"{text[: max_chars - 200].rstrip()}\n\n[AI memory truncated to configured limit.]"
        return text

    async def select_guide_shards(
        self,
        prompt: str,
        events: list[dict[str, Any]],
        shard_catalog: list[dict[str, Any]],
        max_files: int = 5,
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_context_compacted: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        if not self.configured or not shard_catalog:
            return {"paths": [], "reason": "guide shard selection unavailable"}

        allowed_paths = [str(item.get("path") or "") for item in shard_catalog if item.get("path")]
        selection_context = [
            build_run_memory(events),
            *events[-20:],
        ]
        instructions = (
            "Select DropLogic BoxMini guide shards to refresh before the next agent turn. "
            "You are not executing the task. Choose only files whose detailed rules are likely "
            "needed for this exact user request, active goal, recent tool failures, or safety risk. "
            f"Return only JSON with keys `paths` and `reason`. `paths` must contain 0 to {max_files} "
            "items from the provided catalog, with no invented paths."
        )
        content = (
            f"User request:\n{prompt}\n\n"
            f"Available guide shards:\n{json.dumps(shard_catalog, ensure_ascii=True, default=str)}\n\n"
            "Compact recent run context:\n"
            f"{json.dumps(selection_context, ensure_ascii=True, default=str)}"
        )

        if uses_anthropic_messages(self.config):
            payload = {
                "model": self.config.model,
                "system": instructions,
                "max_tokens": 1200,
                "messages": [{"role": "user", "content": content}],
            }
            data = await self._post_anthropic_message(
                payload,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(payload, on_context_compacted=on_context_compacted),
            )
            text = extract_anthropic_text(data)
        elif uses_chat_completions(self.config):
            payload = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": content},
                ],
            }
            data = await self._post_chat_completion(
                payload,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(payload, on_context_compacted=on_context_compacted),
            )
            text = extract_chat_response_text(data)
        else:
            payload = {
                "model": self.config.model,
                "instructions": instructions,
                "input": [{"role": "user", "content": content}],
            }
            apply_response_context_options(payload, self.config)
            data = await self._post_response(
                payload,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(payload, on_context_compacted=on_context_compacted),
            )
            text = extract_response_text(data)

        return parse_guide_shard_selection(text, allowed_paths=allowed_paths, max_files=max_files)

    async def ask_with_tools(
        self,
        prompt: str,
        events: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        call_tool: Callable[[str, dict[str, Any]], Awaitable[Any]],
        pinned_context: str | None = None,
        response_session_key: str | None = None,
        response_session_path: str | Path | None = None,
        response_session_profile_id: str | None = None,
        response_context_max_chars: int | None = None,
        on_reasoning: Callable[[str, int], Awaitable[None]] | None = None,
        on_text: Callable[[str, int], Awaitable[None]] | None = None,
        on_model_response: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        max_tool_rounds: int | None = None,
        max_tool_output_chars: int = 6_000,
        on_context_compacted: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("AI provider is not configured.")

        if uses_anthropic_messages(self.config):
            return await self.ask_with_anthropic_tools(
                prompt,
                events,
                tools,
                call_tool,
                pinned_context=pinned_context,
                on_reasoning=on_reasoning,
                on_text=on_text,
                on_model_response=on_model_response,
                on_retry=on_retry,
                max_tool_rounds=max_tool_rounds,
                max_tool_output_chars=max_tool_output_chars,
                on_context_compacted=on_context_compacted,
            )

        if uses_chat_completions(self.config):
            return await self.ask_with_chat_tools(
                prompt,
                events,
                tools,
                call_tool,
                pinned_context=pinned_context,
                on_reasoning=on_reasoning,
                on_text=on_text,
                on_model_response=on_model_response,
                on_retry=on_retry,
                max_tool_rounds=max_tool_rounds,
                max_tool_output_chars=max_tool_output_chars,
                on_context_compacted=on_context_compacted,
            )

        context = json.dumps(events, ensure_ascii=True, default=str)
        instructions = DASHBOARD_AGENT_INSTRUCTIONS
        effective_instructions = instructions_with_pinned_context(instructions, pinned_context)
        response_tools = mcp_tools_to_response_tools(tools)
        context_input = {
            "role": "user",
            "content": (
                f"Curated dashboard event log JSON for model context:\n{context}\n\n"
                f"User request:\n{prompt}"
            ),
        }
        response_session = self.response_context_session(
            response_session_key,
            response_session_path,
            response_session_profile_id,
        )
        response_context_limit = response_context_char_limit(response_context_max_chars)
        response_context_meta: dict[str, Any] = {
            "enabled": response_session is not None,
            "profile_id": response_session.profile_id if response_session else None,
            "reasoning_context": self.config.reasoning_context,
            "retains_prior_user_requests": self.config.reasoning_context != "all_turns",
            "loaded_from_disk": bool(response_session and response_session.loaded_from_disk),
            "prior_item_count": len(response_session.items) if response_session else 0,
            "prior_chars": encoded_json_length(response_session.items) if response_session else 0,
            "previous_response_id": response_session.last_response_id if response_session else None,
            "max_chars": response_context_limit,
            "reused": bool(response_session and response_session.items),
            "reset_reason": None,
            "compaction_strategy": context_compaction_strategy(self.config),
            "native_compaction_threshold": (
                self.config.native_response_compaction_threshold
                if context_compaction_strategy(self.config) == "dashboard+native_responses"
                else None
            ),
            "preflight_compacted_tool_history": 0,
            "preflight_compacted_tool_outputs": 0,
        }
        input_list: list[dict[str, Any]] = deepcopy(response_session.items) if response_session else []
        if response_session and response_context_meta["prior_chars"] > response_context_limit:
            input_list = []
            response_session.items = []
            response_context_meta["reused"] = False
            response_context_meta["reset_reason"] = "response_context_budget_exceeded_before_request"
        elif input_list:
            response_context_meta["preflight_compacted_tool_history"] = compact_consumed_tool_history(input_list)
            response_context_meta["preflight_compacted_tool_outputs"] = await compact_consumed_tool_outputs(
                input_list,
                max_chars=max_tool_output_chars,
                on_context_compacted=on_context_compacted,
            )
        input_list.append(context_input)
        payload = {
            "model": self.config.model,
            "instructions": effective_instructions,
            "input": input_list,
            "tools": response_tools,
            "tool_choice": "auto",
        }
        apply_response_context_options(payload, self.config)
        if self.config.reasoning_effort or self.config.reasoning_summary or self.config.reasoning_context:
            apply_reasoning_options(payload, self.config)

        request_started = time.monotonic()
        data = await self._post_response(
            payload,
            on_retry=on_retry,
            on_retry_compact=retry_payload_compactor(
                payload,
                on_context_compacted=on_context_compacted,
            ),
        )
        if on_model_response is not None:
            metrics = model_response_metrics(
                data,
                round_index=0,
                elapsed_seconds=time.monotonic() - request_started,
                payload=payload,
            )
            metrics["response_context"] = dict(response_context_meta)
            await on_model_response(metrics)
        all_reasoning: list[str] = []
        tool_calls: list[dict[str, Any]] = []
        round_index = 0
        pending_calls: list[dict[str, Any]] = []
        goal_completion_result: dict[str, Any] | None = None
        emitted_texts: set[str] = set()
        await emit_response_text(data, round_index, emitted_texts, on_text)
        reasoning = extract_reasoning_summary(data)
        all_reasoning.extend(reasoning)
        if on_reasoning is not None:
            for item in reasoning:
                thinking = str(item).strip()
                if thinking:
                    await on_reasoning(thinking, round_index)

        while True:
            calls = extract_function_calls(data)
            if not calls:
                break
            if max_tool_rounds is not None and round_index >= max_tool_rounds:
                pending_calls = calls
                break
            input_list.extend(data.get("output", []) or [])
            outputs = []
            image_messages: list[dict[str, Any]] = []
            image_message_indices: list[int] = []
            round_tool_output_chars = active_tool_output_chars(max_tool_output_chars, len(calls))
            for call in calls:
                name = call["name"]
                arguments = call["arguments"]
                result = await call_tool(name, arguments)
                result, attachments = pop_model_attachments(result)
                compacted_result = compact_chat_tool_result(result, round_tool_output_chars)
                tool_calls.append({"name": name, "arguments": arguments, "result": compacted_result})
                outputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": call["call_id"],
                        "output": json.dumps(compacted_result, ensure_ascii=True, default=str),
                    }
                )
                image_messages.extend(model_attachment_messages(name, call["call_id"], attachments))
                if successful_goal_completion(name, result):
                    goal_completion_result = result
                    break
            if goal_completion_result is not None:
                input_list.extend(outputs)
                break
            input_list.extend(outputs)
            if image_messages:
                image_message_indices = list(range(len(input_list), len(input_list) + len(image_messages)))
                input_list.extend(image_messages)
            compacted_tool_history = compact_consumed_tool_history(input_list)
            compacted_tools = await compact_consumed_tool_outputs(
                input_list,
                max_chars=max_tool_output_chars,
                on_context_compacted=on_context_compacted,
            )
            effective_instructions = instructions_with_pinned_context(instructions, pinned_context)
            followup = {
                "model": self.config.model,
                "instructions": effective_instructions,
                "input": input_list,
                "tools": response_tools,
            }
            apply_response_context_options(followup, self.config)
            if self.config.reasoning_effort or self.config.reasoning_summary or self.config.reasoning_context:
                apply_reasoning_options(followup, self.config)
            round_index += 1
            request_started = time.monotonic()
            data = await self._post_response(
                followup,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(
                    followup,
                    max_tool_output_chars=max_tool_output_chars,
                    on_context_compacted=on_context_compacted,
                ),
            )
            if on_model_response is not None:
                metrics = model_response_metrics(
                    data,
                    round_index=round_index,
                    elapsed_seconds=time.monotonic() - request_started,
                    payload=followup,
                )
                metrics["compacted_prior_tool_outputs"] = compacted_tools
                metrics["compacted_prior_tool_history"] = compacted_tool_history
                await on_model_response(metrics)
            degrade_image_messages(input_list, image_message_indices)
            await emit_response_text(data, round_index, emitted_texts, on_text)
            reasoning = extract_reasoning_summary(data)
            all_reasoning.extend(reasoning)
            if on_reasoning is not None:
                for item in reasoning:
                    thinking = str(item).strip()
                    if thinking:
                        await on_reasoning(thinking, round_index)

        text = extract_response_text(data)
        stopped_reason = None
        if goal_completion_result is not None:
            stopped_reason = "goal_completed"
            text = str(
                goal_completion_result.get("message")
                or goal_completion_result.get("summary")
                or "Goal completed."
            )
        elif pending_calls:
            stopped_reason = "max_tool_rounds"
            pending_names = ", ".join(call["name"] for call in pending_calls)
            text = (
                f"Stopped after {max_tool_rounds} tool rounds with pending tool call(s): "
                f"{pending_names}. Send a short follow-up to continue from the current state."
            )
        elif not text:
            text = "The model returned no user-facing text."

        if response_session is not None:
            response_session.items = response_context_items(
                input_list,
                data,
                retain_dashboard_user_requests=bool(response_context_meta["retains_prior_user_requests"]),
            )
            response_session.revision += 1
            response_id = data.get("id")
            response_session.last_response_id = str(response_id) if response_id else None
            response_context_meta["final_item_count"] = len(response_session.items)
            response_context_meta["final_chars"] = encoded_json_length(response_session.items)
            if response_context_meta["final_chars"] > response_context_limit:
                response_session.items = []
                response_context_meta["final_item_count"] = 0
                response_context_meta["final_chars"] = 0
                response_context_meta["reset_reason"] = "response_context_budget_exceeded_after_request"
            response_context_meta["revision"] = response_session.revision
            response_context_meta["last_response_id"] = response_session.last_response_id
            response_context_meta["persistence_error"] = save_response_context_session(response_session)

        return {
            "text": text,
            "reasoning": all_reasoning,
            "tool_calls": tool_calls,
            "pending_tool_calls": pending_calls,
            "stopped_reason": stopped_reason,
            "response_context": response_context_meta,
            "raw": data,
        }

    async def ask_with_chat_tools(
        self,
        prompt: str,
        events: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        call_tool: Callable[[str, dict[str, Any]], Awaitable[Any]],
        pinned_context: str | None = None,
        on_reasoning: Callable[[str, int], Awaitable[None]] | None = None,
        on_text: Callable[[str, int], Awaitable[None]] | None = None,
        on_model_response: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        max_tool_rounds: int | None = None,
        max_tool_output_chars: int = 6_000,
        on_context_compacted: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        context = json.dumps(events, ensure_ascii=True, default=str)
        instructions = DASHBOARD_AGENT_INSTRUCTIONS
        effective_instructions = instructions_with_pinned_context(instructions, pinned_context)
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": effective_instructions},
            {
                "role": "user",
                "content": (
                    f"Curated dashboard event log JSON for model context:\n{context}\n\n"
                    f"User request:\n{prompt}"
                ),
            },
        ]
        chat_tools = mcp_tools_to_chat_tools(tools)
        payload = {
            "model": self.config.model,
            "messages": messages,
            "tools": chat_tools,
            "tool_choice": "auto",
        }
        apply_chat_options(payload, self.config)
        compaction_details = enforce_chat_payload_budget(payload, self.config)
        if compaction_details is not None and on_context_compacted is not None:
            await on_context_compacted(compaction_details)
        request_started = time.monotonic()
        data = await self._post_chat_completion(
            payload,
            on_retry=on_retry,
            on_retry_compact=retry_payload_compactor(
                payload,
                on_context_compacted=on_context_compacted,
            ),
        )
        if on_model_response is not None:
            await on_model_response(
                chat_model_response_metrics(
                    data,
                    round_index=0,
                    elapsed_seconds=time.monotonic() - request_started,
                    payload=payload,
                )
            )

        all_reasoning: list[str] = []
        tool_calls: list[dict[str, Any]] = []
        pending_calls: list[dict[str, Any]] = []
        goal_completion_result: dict[str, Any] | None = None
        emitted_texts: set[str] = set()
        emitted_reasoning: set[str] = set()
        round_index = 0
        reasoning = extract_chat_reasoning(data)
        all_reasoning.extend(reasoning)
        await emit_chat_reasoning(data, round_index, emitted_reasoning, on_reasoning)
        await emit_chat_response_text(data, round_index, emitted_texts, on_text)

        while True:
            calls = extract_chat_tool_calls(data)
            if not calls:
                break
            if max_tool_rounds is not None and round_index >= max_tool_rounds:
                pending_calls = calls
                break
            messages.append(chat_assistant_message(data))
            round_tool_output_chars = active_tool_output_chars(max_tool_output_chars, len(calls))
            for call in calls:
                name = call["name"]
                arguments = call["arguments"]
                result = await call_tool(name, arguments)
                result, _attachments = pop_model_attachments(result)
                compacted_result = compact_chat_tool_result(result, round_tool_output_chars)
                tool_calls.append({"name": name, "arguments": arguments, "result": compacted_result})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["call_id"],
                        "content": json.dumps(compacted_result, ensure_ascii=True, default=str),
                    }
                )
                if successful_goal_completion(name, result):
                    goal_completion_result = result
                    break
            if goal_completion_result is not None:
                # The completion tool is terminal. Do not ask the model for
                # another turn after the dashboard has cleared the goal.
                break
            compacted_tool_history = compact_consumed_tool_history(messages)
            compacted_tools = await compact_consumed_tool_outputs(
                messages,
                max_chars=max_tool_output_chars,
                on_context_compacted=on_context_compacted,
            )
            compact_chat_transcript(messages)
            messages[0] = {
                "role": "system",
                "content": instructions_with_pinned_context(instructions, pinned_context),
            }
            followup = {
                "model": self.config.model,
                "messages": messages,
                "tools": chat_tools,
                "tool_choice": "auto",
            }
            apply_chat_options(followup, self.config)
            compaction_details = enforce_chat_payload_budget(followup, self.config)
            if compaction_details is not None and on_context_compacted is not None:
                await on_context_compacted(compaction_details)
            round_index += 1
            request_started = time.monotonic()
            data = await self._post_chat_completion(
                followup,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(
                    followup,
                    max_tool_output_chars=max_tool_output_chars,
                    on_context_compacted=on_context_compacted,
                ),
            )
            if on_model_response is not None:
                metrics = chat_model_response_metrics(
                    data,
                    round_index=round_index,
                    elapsed_seconds=time.monotonic() - request_started,
                    payload=followup,
                )
                metrics["compacted_prior_tool_outputs"] = compacted_tools
                metrics["compacted_prior_tool_history"] = compacted_tool_history
                await on_model_response(metrics)
            reasoning = extract_chat_reasoning(data)
            all_reasoning.extend(reasoning)
            await emit_chat_reasoning(data, round_index, emitted_reasoning, on_reasoning)
            await emit_chat_response_text(data, round_index, emitted_texts, on_text)

        text = extract_chat_response_text(data)
        stopped_reason = None
        if goal_completion_result is not None:
            stopped_reason = "goal_completed"
            text = str(
                goal_completion_result.get("message")
                or goal_completion_result.get("summary")
                or "Goal completed."
            )
        elif pending_calls:
            stopped_reason = "max_tool_rounds"
            pending_names = ", ".join(call["name"] for call in pending_calls)
            text = (
                f"Stopped after {max_tool_rounds} tool rounds with pending tool call(s): "
                f"{pending_names}. Send a short follow-up to continue from the current state."
            )
        elif not text:
            text = "The model returned no user-facing text."

        return {
            "text": text,
            "reasoning": all_reasoning,
            "tool_calls": tool_calls,
            "pending_tool_calls": pending_calls,
            "stopped_reason": stopped_reason,
            "raw": data,
        }

    async def ask_with_anthropic_tools(
        self,
        prompt: str,
        events: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        call_tool: Callable[[str, dict[str, Any]], Awaitable[Any]],
        pinned_context: str | None = None,
        on_reasoning: Callable[[str, int], Awaitable[None]] | None = None,
        on_text: Callable[[str, int], Awaitable[None]] | None = None,
        on_model_response: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        max_tool_rounds: int | None = None,
        max_tool_output_chars: int = 6_000,
        on_context_compacted: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        context = json.dumps(events, ensure_ascii=True, default=str)
        instructions = DASHBOARD_AGENT_INSTRUCTIONS
        effective_instructions = instructions_with_pinned_context(instructions, pinned_context)
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": (
                    f"Curated dashboard event log JSON for model context:\n{context}\n\n"
                    f"User request:\n{prompt}"
                ),
            }
        ]
        anthropic_tools = mcp_tools_to_anthropic_tools(tools)
        payload = {
            "model": self.config.model,
            "system": effective_instructions,
            "messages": messages,
            "tools": anthropic_tools,
            "max_tokens": 8192,
        }
        apply_anthropic_options(payload, self.config)
        request_started = time.monotonic()
        data = await self._post_anthropic_message(
            payload,
            on_retry=on_retry,
            on_retry_compact=retry_payload_compactor(
                payload,
                on_context_compacted=on_context_compacted,
            ),
        )
        if on_model_response is not None:
            await on_model_response(
                anthropic_model_response_metrics(
                    data,
                    round_index=0,
                    elapsed_seconds=time.monotonic() - request_started,
                    payload=payload,
                )
            )

        all_reasoning: list[str] = []
        tool_calls: list[dict[str, Any]] = []
        pending_calls: list[dict[str, Any]] = []
        emitted_texts: set[str] = set()
        emitted_reasoning: set[str] = set()
        round_index = 0
        await emit_anthropic_thinking(data, round_index, emitted_reasoning, on_reasoning)
        all_reasoning.extend(extract_anthropic_thinking(data))
        await emit_anthropic_text(data, round_index, emitted_texts, on_text)

        while True:
            calls = extract_anthropic_tool_calls(data)
            if not calls:
                break
            if max_tool_rounds is not None and round_index >= max_tool_rounds:
                pending_calls = calls
                break
            messages.append(anthropic_assistant_message(data))
            tool_results = []
            round_tool_output_chars = active_tool_output_chars(max_tool_output_chars, len(calls))
            for call in calls:
                name = call["name"]
                arguments = call["arguments"]
                result = await call_tool(name, arguments)
                result, _attachments = pop_model_attachments(result)
                compacted_result = compact_chat_tool_result(result, round_tool_output_chars)
                tool_calls.append({"name": name, "arguments": arguments, "result": compacted_result})
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": call["call_id"],
                        "content": json.dumps(compacted_result, ensure_ascii=True, default=str),
                    }
                )
            messages.append({"role": "user", "content": tool_results})
            compacted_tool_history = compact_consumed_tool_history(messages)
            compacted_tools = await compact_consumed_tool_outputs(
                messages,
                max_chars=max_tool_output_chars,
                on_context_compacted=on_context_compacted,
            )
            effective_instructions = instructions_with_pinned_context(instructions, pinned_context)
            followup = {
                "model": self.config.model,
                "system": effective_instructions,
                "messages": messages,
                "tools": anthropic_tools,
                "max_tokens": 8192,
            }
            apply_anthropic_options(followup, self.config)
            round_index += 1
            request_started = time.monotonic()
            data = await self._post_anthropic_message(
                followup,
                on_retry=on_retry,
                on_retry_compact=retry_payload_compactor(
                    followup,
                    max_tool_output_chars=max_tool_output_chars,
                    on_context_compacted=on_context_compacted,
                ),
            )
            if on_model_response is not None:
                metrics = anthropic_model_response_metrics(
                    data,
                    round_index=round_index,
                    elapsed_seconds=time.monotonic() - request_started,
                    payload=followup,
                )
                metrics["compacted_prior_tool_outputs"] = compacted_tools
                metrics["compacted_prior_tool_history"] = compacted_tool_history
                await on_model_response(metrics)
            await emit_anthropic_thinking(data, round_index, emitted_reasoning, on_reasoning)
            all_reasoning.extend(extract_anthropic_thinking(data))
            await emit_anthropic_text(data, round_index, emitted_texts, on_text)

        text = extract_anthropic_text(data)
        stopped_reason = None
        if pending_calls:
            stopped_reason = "max_tool_rounds"
            pending_names = ", ".join(call["name"] for call in pending_calls)
            text = (
                f"Stopped after {max_tool_rounds} tool rounds with pending tool call(s): "
                f"{pending_names}. Send a short follow-up to continue from the current state."
            )
        elif not text:
            text = "The model returned no user-facing text."

        return {
            "text": text,
            "reasoning": all_reasoning,
            "tool_calls": tool_calls,
            "pending_tool_calls": pending_calls,
            "stopped_reason": stopped_reason,
            "raw": data,
        }

    async def _post_response(
        self,
        payload: dict[str, Any],
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_retry_compact: Callable[[int], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.config.base_url}/responses"
        delays = [0.0, 0.0, 0.25, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0]
        attempt = 0
        async with httpx.AsyncClient(timeout=None) as client:
            while True:
                delay = delays[attempt] if attempt < len(delays) else delays[-1]
                if delay > 0:
                    await asyncio.sleep(delay)
                attempt += 1
                try:
                    response = await client.post(url, headers=headers, json=payload)
                except httpx.RequestError as exc:
                    if not is_retryable_request_error(exc):
                        raise RuntimeError(f"Request error for {url}: {exc}") from exc
                    if on_retry is not None:
                        await on_retry(
                            {
                                "attempt": attempt,
                                "delay_seconds": delay,
                                "error": str(exc),
                                "error_type": type(exc).__name__,
                                **payload_diagnostics(payload),
                            }
                        )
                    if attempt > 0 and attempt % RETRY_PAYLOAD_COMPACT_EVERY == 0 and on_retry_compact is not None:
                        await on_retry_compact(attempt)
                    continue
                if is_retryable_response(response):
                    if on_retry is not None:
                        body = response.text
                        await on_retry(
                            {
                                "attempt": attempt,
                                "delay_seconds": delay,
                                "status_code": response.status_code,
                                "response": preview_response_body(body),
                                "body_preview": preview_response_body(body),
                                "body_chars": len(body),
                                **payload_diagnostics(payload),
                            }
                        )
                    if attempt > 0 and attempt % RETRY_PAYLOAD_COMPACT_EVERY == 0 and on_retry_compact is not None:
                        await on_retry_compact(attempt)
                    continue
                break
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                body = response.text
                raise RuntimeError(f"{exc}. Response body: {body}") from exc
            data = response.json()
            data["_cockpit_retry_attempts"] = attempt
            return data

    async def _post_chat_completion(
        self,
        payload: dict[str, Any],
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_retry_compact: Callable[[int], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.config.base_url}/chat/completions"
        delays = [0.0, 0.0, 0.25, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0]
        attempt = 0
        async with httpx.AsyncClient(timeout=None) as client:
            while True:
                delay = delays[attempt] if attempt < len(delays) else delays[-1]
                if delay > 0:
                    await asyncio.sleep(delay)
                attempt += 1
                try:
                    response = await client.post(url, headers=headers, json=payload)
                except httpx.RequestError as exc:
                    if not is_retryable_request_error(exc):
                        raise RuntimeError(f"Request error for {url}: {exc}") from exc
                    if on_retry is not None:
                        await on_retry(
                            {
                                "attempt": attempt,
                                "delay_seconds": delay,
                                "error": str(exc),
                                "error_type": type(exc).__name__,
                                **payload_diagnostics(payload),
                            }
                        )
                    if attempt > 0 and attempt % RETRY_PAYLOAD_COMPACT_EVERY == 0 and on_retry_compact is not None:
                        await on_retry_compact(attempt)
                    continue
                if is_retryable_response(response):
                    if on_retry is not None:
                        body = response.text
                        await on_retry(
                            {
                                "attempt": attempt,
                                "delay_seconds": delay,
                                "status_code": response.status_code,
                                "response": preview_response_body(body),
                                "body_preview": preview_response_body(body),
                                "body_chars": len(body),
                                **payload_diagnostics(payload),
                            }
                        )
                    if attempt > 0 and attempt % RETRY_PAYLOAD_COMPACT_EVERY == 0 and on_retry_compact is not None:
                        await on_retry_compact(attempt)
                    continue
                break
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                body = response.text
                raise RuntimeError(f"{exc}. Response body: {body}") from exc
            data = response.json()
            data["_cockpit_retry_attempts"] = attempt
            return data

    async def _post_anthropic_message(
        self,
        payload: dict[str, Any],
        on_retry: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_retry_compact: Callable[[int], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        }
        url = f"{self.config.base_url}/messages"
        delays = [0.0, 0.0, 0.25, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0]
        attempt = 0
        async with httpx.AsyncClient(timeout=None) as client:
            while True:
                delay = delays[attempt] if attempt < len(delays) else delays[-1]
                if delay > 0:
                    await asyncio.sleep(delay)
                attempt += 1
                try:
                    response = await client.post(url, headers=headers, json=payload)
                except httpx.RequestError as exc:
                    if not is_retryable_request_error(exc):
                        raise RuntimeError(f"Request error for {url}: {exc}") from exc
                    if on_retry is not None:
                        await on_retry(
                            {
                                "attempt": attempt,
                                "delay_seconds": delay,
                                "error": str(exc),
                                "error_type": type(exc).__name__,
                                **payload_diagnostics(payload),
                            }
                        )
                    if attempt > 0 and attempt % RETRY_PAYLOAD_COMPACT_EVERY == 0 and on_retry_compact is not None:
                        await on_retry_compact(attempt)
                    continue
                if is_retryable_response(response):
                    if on_retry is not None:
                        body = response.text
                        await on_retry(
                            {
                                "attempt": attempt,
                                "delay_seconds": delay,
                                "status_code": response.status_code,
                                "response": preview_response_body(body),
                                "body_preview": preview_response_body(body),
                                "body_chars": len(body),
                                **payload_diagnostics(payload),
                            }
                        )
                    if attempt > 0 and attempt % RETRY_PAYLOAD_COMPACT_EVERY == 0 and on_retry_compact is not None:
                        await on_retry_compact(attempt)
                    continue
                break
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                body = response.text
                raise RuntimeError(f"{exc}. Response body: {body}") from exc
            data = response.json()
            data["_cockpit_retry_attempts"] = attempt
            return data


def apply_reasoning_options(payload: dict[str, Any], config: AiConfig) -> None:
    payload["reasoning"] = {}
    if config.reasoning_effort:
        payload["reasoning"]["effort"] = config.reasoning_effort
    if config.reasoning_summary:
        payload["reasoning"]["summary"] = config.reasoning_summary
    if config.reasoning_context:
        payload["reasoning"]["context"] = config.reasoning_context
    payload["include"] = unique_list(
        [
            *payload.get("include", []),
            "reasoning.encrypted_content",
        ]
    )


def apply_chat_options(payload: dict[str, Any], config: AiConfig) -> None:
    if config.reasoning_effort:
        payload["reasoning_effort"] = config.reasoning_effort
    chat_template_kwargs = getattr(config, "chat_template_kwargs", None)
    if isinstance(chat_template_kwargs, dict) and chat_template_kwargs:
        # vLLM/SGLang accept these as extra OpenAI-compatible body fields.
        # Keep them explicit in configuration because the key names are
        # model/template-specific (for example Qwen3.6 preserve_thinking).
        payload["chat_template_kwargs"] = deepcopy(chat_template_kwargs)


def apply_anthropic_options(payload: dict[str, Any], config: AiConfig) -> None:
    if config.reasoning_effort:
        payload["output_config"] = {"effort": config.reasoning_effort}
        payload["thinking"] = {"type": "adaptive", "display": "summarized"}


def unique_list(values: list[Any]) -> list[Any]:
    result: list[Any] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def uses_chat_completions(config: AiConfig) -> bool:
    return str(getattr(config, "wire_api", "") or "").strip().lower() in {
        "chat",
        "chat_completion",
        "chat_completions",
        "chat/completions",
    }


def uses_anthropic_messages(config: AiConfig) -> bool:
    return str(getattr(config, "wire_api", "") or "").strip().lower() in {
        "anthropic",
        "anthropic_messages",
        "messages",
        "claude_messages",
    }


def payload_diagnostics(payload: dict[str, Any]) -> dict[str, Any]:
    input_list = payload.get("input")
    if input_list is None:
        input_list = payload.get("messages")
    input_items = input_list if isinstance(input_list, list) else []
    input_types = [str(item.get("type") or item.get("role") or "?") for item in input_items if isinstance(item, dict)]
    function_outputs = [
        item
        for item in input_items
        if isinstance(item, dict) and (item.get("type") == "function_call_output" or item.get("role") == "tool")
    ]
    request_chars = encoded_json_length(payload)
    return {
        "request_chars": request_chars,
        "estimated_context_tokens": estimate_tokens_from_chars(request_chars),
        "input_item_count": len(input_items),
        "input_tail_types": input_types[-8:],
        "function_call_output_count": len(function_outputs),
        "input_image_count": count_input_images(payload),
        "has_reasoning_encrypted_content_include": "reasoning.encrypted_content" in (payload.get("include") or []),
    }


def retry_payload_compactor(
    payload: dict[str, Any],
    max_tool_output_chars: int = 6_000,
    on_context_compacted: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> Callable[[int], Awaitable[None]]:
    async def compact(attempt: int) -> None:
        before = encoded_json_length(payload)
        level = max(1, attempt // RETRY_PAYLOAD_COMPACT_EVERY)
        details = compact_payload_for_retry(
            payload,
            attempt=attempt,
            level=level,
            max_tool_output_chars=max_tool_output_chars,
        )
        after = encoded_json_length(payload)
        if on_context_compacted is None:
            return
        await on_context_compacted(
            {
                "scope": "provider_retry_payload",
                "message": (
                    "Provider request payload compacted after repeated retryable errors. "
                    "The full events.jsonl and pinned BoxMini context are unchanged."
                ),
                "retry_attempt": attempt,
                "retry_compaction_level": level,
                "compacted_user_context_sections": details["user_context_sections"],
                "compacted_tool_outputs": details["tool_outputs"],
                "compacted_image_messages": details["image_messages"],
                "protected_latest_tool_output": details["protected_latest_tool_output"],
                "estimated_chars_before": before,
                "estimated_chars_after": after,
                "max_context_chars": details["event_log_target_chars"],
            }
        )

    return compact


def compact_payload_for_retry(
    payload: dict[str, Any],
    attempt: int,
    level: int,
    max_tool_output_chars: int,
) -> dict[str, Any]:
    input_list = payload.get("input")
    if input_list is None:
        input_list = payload.get("messages")
    if not isinstance(input_list, list):
        return {
            "attempt": attempt,
            "user_context_sections": 0,
            "image_messages": 0,
            "tool_outputs": 0,
            "protected_latest_tool_output": False,
            "event_log_target_chars": retry_event_log_target_chars(level),
        }

    target_chars = retry_event_log_target_chars(level)
    image_messages = degrade_all_image_messages(input_list)
    user_context_sections = compact_input_user_contexts(input_list, target_chars=target_chars)
    tool_output_chars = max(
        RETRY_PAYLOAD_MIN_TOOL_OUTPUT_CHARS,
        min(max_tool_output_chars, MAX_ACTIVE_TOOL_OUTPUT_CHARS) // (2 ** max(1, level)),
    )
    tool_outputs, protected_latest = compact_retry_tool_outputs(input_list, max_chars=tool_output_chars)
    return {
        "attempt": attempt,
        "user_context_sections": user_context_sections,
        "image_messages": image_messages,
        "tool_outputs": tool_outputs,
        "protected_latest_tool_output": protected_latest,
        "event_log_target_chars": target_chars,
    }


def retry_event_log_target_chars(level: int) -> int:
    divisor = 2 ** max(0, level - 1)
    return max(RETRY_PAYLOAD_MIN_EVENT_LOG_TARGET_CHARS, RETRY_PAYLOAD_EVENT_LOG_TARGET_CHARS // divisor)


def compact_input_user_contexts(input_list: list[dict[str, Any]], target_chars: int) -> int:
    compacted = 0
    for item in input_list:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if isinstance(content, str):
            new_content, changed = compact_context_string_for_retry(content, target_chars=target_chars)
            if changed:
                item["content"] = new_content
                compacted += 1
            continue
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or not isinstance(part.get("text"), str):
                continue
            new_text, changed = compact_context_string_for_retry(part["text"], target_chars=target_chars)
            if changed:
                part["text"] = new_text
                compacted += 1
    return compacted


def degrade_all_image_messages(input_list: list[dict[str, Any]]) -> int:
    degraded = 0
    for index, item in enumerate(input_list):
        if not isinstance(item, dict):
            continue
        before = count_input_images(item)
        if before <= 0:
            continue
        degrade_image_messages(input_list, [index])
        after = count_input_images(item)
        if after < before:
            degraded += 1
    return degraded


def compact_context_string_for_retry(text: str, target_chars: int) -> tuple[str, bool]:
    for marker in (
        "Curated dashboard event log JSON for model context:\n",
        "Curated deterministic event log for summarization:\n",
    ):
        marker_index = text.find(marker)
        if marker_index < 0:
            continue
        json_start = marker_index + len(marker)
        json_end = find_context_json_end(text, json_start)
        json_text = text[json_start:json_end].strip()
        compacted_json = compact_json_events_text_for_retry(json_text, target_chars=target_chars)
        if compacted_json is None or compacted_json == json_text:
            return text, False
        return f"{text[:json_start]}{compacted_json}{text[json_end:]}", True

    stripped = text.strip()
    if len(stripped) <= target_chars or not stripped.startswith(("[", "{")):
        return text, False
    compacted_json = compact_json_events_text_for_retry(stripped, target_chars=target_chars)
    if compacted_json is None or compacted_json == stripped:
        return text, False
    leading = text[: len(text) - len(text.lstrip())]
    trailing = text[len(text.rstrip()) :]
    return f"{leading}{compacted_json}{trailing}", True


def find_context_json_end(text: str, start: int) -> int:
    candidates = []
    for delimiter in ("\n\nUser request:\n", "\n\nMaximum memory length:"):
        index = text.find(delimiter, start)
        if index >= 0:
            candidates.append(index)
    return min(candidates) if candidates else len(text)


def compact_json_events_text_for_retry(json_text: str, target_chars: int) -> str | None:
    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError:
        return None
    compacted = compact_context_value_for_retry(parsed, target_chars=target_chars)
    encoded = json.dumps(compacted, ensure_ascii=True, default=str)
    if len(encoded) >= len(json_text):
        return None
    return encoded


def compact_context_value_for_retry(value: Any, target_chars: int) -> Any:
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return compact_event_list_for_retry(value, target_chars=target_chars)
    compacted = compact_value(value, path="retry_payload")
    if encoded_json_length(compacted) <= target_chars:
        return compacted
    return {
        "type": "retry_payload_summary",
        "message": (
            "Large context was summarized during provider retries. "
            "The complete value remains in the dashboard run files."
        ),
        "summary": compact_value(compacted, path="retry_payload.summary"),
    }


def compact_event_list_for_retry(events: list[dict[str, Any]], target_chars: int) -> list[dict[str, Any]]:
    latest_tool_index = latest_event_index_by_type(events, "mcp_tool_result")
    protected_event = events[latest_tool_index] if latest_tool_index is not None else None
    stale_indices = stale_state_snapshot_indices(events)
    memory = build_run_memory(events)
    memory.update(
        {
            "type": "retry_payload_memory",
            "message": (
                "Older run history was compacted again during repeated provider retries. "
                "Pinned BoxMini context is still sent separately, and complete events.jsonl is unchanged."
            ),
            "source_event_count": len(events),
            "target_context_chars": target_chars,
        }
    )

    selected_reversed: list[dict[str, Any]] = []
    protected_encoded = encoded_json_length(protected_event) if protected_event is not None else 0
    budget = max(target_chars, protected_encoded + 4_000)
    current_chars = encoded_json_length([memory]) + protected_encoded

    for index in range(len(events) - 1, -1, -1):
        if latest_tool_index is not None and index == latest_tool_index:
            continue
        if index in stale_indices:
            continue
        event = compact_event_for_retry(events[index])
        event_chars = encoded_json_length(event) + 2
        if selected_reversed and current_chars + event_chars > budget:
            break
        selected_reversed.append(event)
        current_chars += event_chars

    selected = list(reversed(selected_reversed))
    if protected_event is not None and not any(item is protected_event for item in selected):
        insert_index = len(selected)
        for index, event in enumerate(selected):
            if event_sort_key(event) > event_sort_key(protected_event):
                insert_index = index
                break
        protected_copy = dict(protected_event)
        protected_copy["_protected_latest_tool_output"] = True
        protected_copy["_protection_note"] = "Latest tool result kept untrimmed during retry-time compaction."
        selected.insert(insert_index, protected_copy)

    memory["retained_recent_event_count"] = len(selected)
    memory["omitted_event_count"] = max(0, len(events) - len(selected))
    return [memory, *selected]


def compact_event_for_retry(event: dict[str, Any]) -> dict[str, Any]:
    return {str(key): compact_value(value, path=f"retry_event.{key}") for key, value in event.items()}


def latest_event_index_by_type(events: list[dict[str, Any]], event_type: str) -> int | None:
    for index in range(len(events) - 1, -1, -1):
        if events[index].get("type") == event_type:
            return index
    return None


def event_sort_key(event: dict[str, Any]) -> str:
    return str(event.get("ts") or event.get("t") or "")


def compact_retry_tool_outputs(input_list: list[dict[str, Any]], max_chars: int) -> tuple[int, bool]:
    protected_indices = latest_tool_output_batch_indices(input_list)
    call_names = function_call_names_by_id(input_list)
    compacted_count = 0
    protected_latest = False

    for index, item in enumerate(input_list):
        if not isinstance(item, dict):
            continue
        is_latest_batch = index in protected_indices
        compacted_here = False
        if item.get("type") == "function_call_output":
            compacted_here = compact_single_tool_output(
                item,
                key="output",
                max_chars=max_chars,
                tool=call_names.get(str(item.get("call_id") or ""), str(item.get("call_id") or "") or "tool"),
            )
        elif item.get("role") == "tool":
            compacted_here = compact_single_tool_output(
                item,
                key="content",
                max_chars=max_chars,
                tool=call_names.get(str(item.get("tool_call_id") or ""), str(item.get("tool_call_id") or "") or "tool"),
            )
        elif is_anthropic_tool_result_message(item):
            for part in item.get("content") or []:
                if not isinstance(part, dict):
                    continue
                call_id = str(part.get("tool_use_id") or "")
                tool = call_names.get(call_id, call_id or "tool")
                compacted_here = compact_single_tool_output(part, key="content", max_chars=max_chars, tool=tool) or compacted_here
        if compacted_here:
            compacted_count += 1
        else:
            protected_latest = protected_latest or is_latest_batch

    return compacted_count, protected_latest


def compact_single_tool_output(item: dict[str, Any], key: str, max_chars: int, tool: str) -> bool:
    output = item.get(key)
    if not isinstance(output, str):
        return False
    if len(output) <= max_chars:
        return False
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        parsed = output
    compacted, _details = compact_tool_output_for_model(tool, parsed, max_chars=max_chars)
    compacted_output = json.dumps(compacted, ensure_ascii=True, default=str)
    if len(compacted_output) > max_chars:
        compacted = force_compact_tool_output(tool, compacted, max_chars=max_chars)
        compacted_output = json.dumps(compacted, ensure_ascii=True, default=str)
    item[key] = compacted_output
    return True


def preview_response_body(body: str, limit: int = 220) -> str:
    text = " ".join(str(body or "").split())
    if looks_like_html(text):
        return summarize_html_error(text)
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}... [truncated; {len(text)} chars]"


def looks_like_html(text: str) -> bool:
    lowered = text[:500].lower()
    return "<!doctype html" in lowered or "<html" in lowered or "<body" in lowered


def summarize_html_error(text: str) -> str:
    title = extract_html_tag_text(text, "title")
    heading = extract_html_tag_text(text, "h1")
    cloudflare_code = re.search(r"Error code\\s*(\\d{3})", text, flags=re.IGNORECASE)
    code_text = f"HTTP {cloudflare_code.group(1)}" if cloudflare_code else ""
    parts = [part for part in (title, heading, code_text) if part]
    if not parts:
        return "HTML error page returned by provider gateway."
    deduped = []
    for part in parts:
        if part not in deduped:
            deduped.append(part)
    return "Provider returned an HTML gateway error page: " + " / ".join(deduped)


def extract_html_tag_text(text: str, tag: str) -> str:
    match = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    value = re.sub(r"<[^>]+>", " ", match.group(1))
    return " ".join(value.split())


def extract_response_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()
    parts = []
    for item in data.get("output", []) or []:
        for content in item.get("content", []) or []:
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                parts.append(str(content["text"]))
    if parts:
        return "\n".join(parts).strip()
    return ""


async def emit_response_text(
    data: dict[str, Any],
    round_index: int,
    emitted_texts: set[str],
    on_text: Callable[[str, int], Awaitable[None]] | None,
) -> None:
    if on_text is None:
        return
    text = extract_response_text(data).strip()
    if not text or text in emitted_texts:
        return
    emitted_texts.add(text)
    await on_text(text, round_index)


def format_pinned_context(pinned_context: str | Callable[[], str] | None) -> str:
    if callable(pinned_context):
        pinned_context = pinned_context()
    text = (pinned_context or "").strip()
    if not text:
        return ""
    return (
        "Pinned BoxMini operating context. This is authoritative and is resent before every "
        "model reasoning turn; do not treat the compacted event log as replacing it. The "
        "`Turn-Scoped Detailed Guide Expansions` section is the current detailed guide set "
        "and may be replaced by the dashboard guide-context tool.\n"
        f"{text}\n\n"
    )


def context_compaction_strategy(config: AiConfig) -> str:
    """Return the effective context strategy for comparable run metrics."""

    if uses_chat_completions(config) or uses_anthropic_messages(config):
        return "dashboard"
    if bool(getattr(config, "native_response_compaction_enabled", False)):
        return "dashboard+native_responses"
    return "dashboard"


def apply_response_context_options(payload: dict[str, Any], config: AiConfig) -> None:
    """Opt into OpenAI Responses server-side compaction when explicitly enabled."""

    if uses_chat_completions(config) or uses_anthropic_messages(config):
        return
    if not bool(getattr(config, "native_response_compaction_enabled", False)):
        return
    threshold = max(1, int(getattr(config, "native_response_compaction_threshold", 200_000) or 0))
    payload["context_management"] = [{"type": "compaction", "compact_threshold": threshold}]


def payload_context_compaction_strategy(payload: dict[str, Any] | None) -> str:
    if isinstance(payload, dict) and isinstance(payload.get("context_management"), list):
        if any(
            isinstance(item, dict) and item.get("type") == "compaction"
            for item in payload["context_management"]
        ):
            return "dashboard+native_responses"
    return "dashboard"


def instructions_with_pinned_context(
    instructions: str,
    pinned_context: str | Callable[[], str] | None,
) -> str:
    pinned = format_pinned_context(pinned_context).strip()
    if not pinned:
        return instructions
    return f"{instructions}\n\n{pinned}"


def model_response_metrics(
    data: dict[str, Any],
    round_index: int,
    elapsed_seconds: float,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    output = data.get("output", []) or []
    output_types = [item.get("type") for item in output if isinstance(item, dict)]
    calls = extract_function_calls(data)
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    metrics = {
        "round": round_index,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "status": data.get("status"),
        "output_types": output_types,
        "tool_calls": [call["name"] for call in calls],
        "tool_call_count": len(calls),
        "has_text": bool(extract_response_text(data)),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "reasoning_tokens": (usage.get("output_tokens_details") or {}).get("reasoning_tokens")
        if isinstance(usage.get("output_tokens_details"), dict)
        else None,
        **reasoning_summary_metrics(data),
        "total_tokens": usage.get("total_tokens"),
        "retry_attempts": data.get("_cockpit_retry_attempts"),
        "context_compaction_strategy": payload_context_compaction_strategy(payload),
    }
    if payload is not None:
        request_chars = encoded_json_length(payload)
        metrics.update(
            {
                "request_chars": request_chars,
                "estimated_context_tokens": estimate_tokens_from_chars(request_chars),
                "input_item_count": len(payload.get("input") if isinstance(payload.get("input"), list) else []),
                "input_image_count": count_input_images(payload),
                "context_breakdown": payload_context_breakdown(payload),
            }
        )
    return metrics


def chat_model_response_metrics(
    data: dict[str, Any],
    round_index: int,
    elapsed_seconds: float,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    calls = extract_chat_tool_calls(data)
    reasoning = extract_chat_reasoning(data)
    completion_details = usage.get("completion_tokens_details")
    output_details = usage.get("output_tokens_details")
    reasoning_tokens = None
    for details in (completion_details, output_details):
        if isinstance(details, dict) and isinstance(details.get("reasoning_tokens"), (int, float)):
            reasoning_tokens = details["reasoning_tokens"]
            break
    if reasoning_tokens is None and isinstance(usage.get("reasoning_tokens"), (int, float)):
        reasoning_tokens = usage["reasoning_tokens"]
    metrics = {
        "round": round_index,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "status": "completed",
        "output_types": ["chat.completion"],
        "tool_calls": [call["name"] for call in calls],
        "tool_call_count": len(calls),
        "has_text": bool(extract_chat_response_text(data)),
        "has_reasoning": bool(reasoning),
        "reasoning_summary_item_count": len(reasoning),
        "reasoning_summary_chars": sum(len(item) for item in reasoning),
        "reasoning_summary_heading_only": bool(reasoning)
        and all(is_heading_only_reasoning_summary(item) for item in reasoning),
        "input_tokens": usage.get("prompt_tokens") or usage.get("input_tokens"),
        "output_tokens": usage.get("completion_tokens") or usage.get("output_tokens"),
        "reasoning_tokens": reasoning_tokens,
        "total_tokens": usage.get("total_tokens"),
        "retry_attempts": data.get("_cockpit_retry_attempts"),
        "context_compaction_strategy": payload_context_compaction_strategy(payload),
    }
    if payload is not None:
        request_chars = encoded_json_length(payload)
        metrics.update(
            {
                "request_chars": request_chars,
                "estimated_context_tokens": estimate_tokens_from_chars(request_chars),
                "input_item_count": len(payload.get("messages") if isinstance(payload.get("messages"), list) else []),
                "input_image_count": count_input_images(payload),
                "context_breakdown": payload_context_breakdown(payload),
            }
        )
    return metrics


def anthropic_model_response_metrics(
    data: dict[str, Any],
    round_index: int,
    elapsed_seconds: float,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    calls = extract_anthropic_tool_calls(data)
    metrics = {
        "round": round_index,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "status": data.get("stop_reason") or "completed",
        "output_types": [item.get("type") for item in data.get("content", []) if isinstance(item, dict)],
        "tool_calls": [call["name"] for call in calls],
        "tool_call_count": len(calls),
        "has_text": bool(extract_anthropic_text(data)),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "reasoning_tokens": usage.get("thinking_tokens"),
        "total_tokens": sum(
            value
            for value in [
                usage.get("input_tokens"),
                usage.get("output_tokens"),
            ]
            if isinstance(value, (int, float))
        )
        or None,
        "retry_attempts": data.get("_cockpit_retry_attempts"),
        "context_compaction_strategy": payload_context_compaction_strategy(payload),
    }
    if payload is not None:
        request_chars = encoded_json_length(payload)
        metrics.update(
            {
                "request_chars": request_chars,
                "estimated_context_tokens": estimate_tokens_from_chars(request_chars),
                "input_item_count": len(payload.get("messages") if isinstance(payload.get("messages"), list) else []),
                "input_image_count": count_input_images(payload),
                "context_breakdown": payload_context_breakdown(payload),
            }
        )
    return metrics


def estimate_tokens_from_chars(chars: int | float | None) -> int | None:
    try:
        value = int(chars or 0)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return max(1, (value + 3) // 4)


def count_input_images(payload: Any) -> int:
    if isinstance(payload, dict):
        count = 1 if payload.get("type") == "input_image" else 0
        return count + sum(count_input_images(value) for value in payload.values())
    if isinstance(payload, list):
        return sum(count_input_images(item) for item in payload)
    return 0


def payload_context_breakdown(payload: dict[str, Any]) -> list[dict[str, Any]]:
    buckets = {
        "instructions": {
            "label": "Instructions",
            "chars": len(str(payload.get("instructions") or "")) + encoded_json_length(payload.get("system") or ""),
        },
        "tools_schema": {"label": "Tool Schema", "chars": encoded_json_length(payload.get("tools") or [])},
        "user_context": {"label": "Guide/Event Log", "chars": 0},
        "model_history": {"label": "Model History", "chars": 0},
        "tool_outputs": {"label": "Tool Outputs", "chars": 0},
        "images": {"label": "Images", "chars": 0, "count": 0},
        "overhead": {"label": "Overhead", "chars": 0},
    }
    input_list = payload.get("input")
    if input_list is None:
        input_list = payload.get("messages")
    if isinstance(input_list, list):
        for item in input_list:
            if not isinstance(item, dict):
                buckets["overhead"]["chars"] += encoded_json_length(item)
                continue
            item_type = str(item.get("type") or "")
            role = str(item.get("role") or "")
            if item_type == "function_call_output" or role == "tool":
                buckets["tool_outputs"]["chars"] += encoded_json_length(item)
                continue
            if item_type in {"function_call", "message"} or role == "assistant":
                buckets["model_history"]["chars"] += encoded_json_length(item)
                continue
            if role == "system":
                buckets["instructions"]["chars"] += encoded_json_length(item)
                continue
            if role == "user":
                if is_anthropic_tool_result_message(item):
                    buckets["tool_outputs"]["chars"] += encoded_json_length(item)
                    continue
                text_chars, image_chars, image_count = input_content_breakdown(item.get("content"))
                buckets["user_context"]["chars"] += text_chars
                buckets["images"]["chars"] += image_chars
                buckets["images"]["count"] += image_count
                buckets["overhead"]["chars"] += max(0, encoded_json_length(item) - text_chars - image_chars)
                continue
            buckets["overhead"]["chars"] += encoded_json_length(item)
    known = sum(int(item.get("chars") or 0) for item in buckets.values())
    total = encoded_json_length(payload)
    buckets["overhead"]["chars"] += max(0, total - known)
    return [value for value in buckets.values() if int(value.get("chars") or 0) > 0 or value.get("count")]


def is_anthropic_tool_result_message(item: dict[str, Any]) -> bool:
    content = item.get("content")
    if not isinstance(content, list) or not content:
        return False
    return all(isinstance(part, dict) and part.get("type") == "tool_result" for part in content)


def input_content_breakdown(content: Any) -> tuple[int, int, int]:
    if isinstance(content, str):
        return len(content), 0, 0
    if not isinstance(content, list):
        return encoded_json_length(content), 0, 0
    text_chars = 0
    image_chars = 0
    image_count = 0
    for part in content:
        if not isinstance(part, dict):
            text_chars += encoded_json_length(part)
            continue
        if part.get("type") == "input_image":
            image_count += 1
            image_chars += encoded_json_length(part)
        else:
            text_chars += encoded_json_length(part)
    return text_chars, image_chars, image_count


def pop_model_attachments(result: Any) -> tuple[Any, list[dict[str, Any]]]:
    if not isinstance(result, dict):
        return result, []
    attachments = result.pop(MODEL_ATTACHMENTS_KEY, [])
    if not isinstance(attachments, list):
        attachments = []
    return result, [item for item in attachments if isinstance(item, dict)]


def model_attachment_messages(tool: str, call_id: str, attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    messages = []
    for attachment in attachments:
        if attachment.get("type") != "input_image":
            continue
        base64_value = str(attachment.get("base64") or "")
        mime_type = str(attachment.get("mime_type") or "image/png")
        if not base64_value:
            continue
        artifact = attachment.get("artifact") if isinstance(attachment.get("artifact"), dict) else {}
        label = str(attachment.get("label") or artifact.get("path") or "visualizer frame")
        description = (
            f"Image attached from MCP tool {tool} ({call_id}): {label}. "
            f"Artifact: {artifact.get('path') or 'not recorded'}. "
            "Use it for visual inspection in this model round."
        )
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": description},
                    {"type": "input_image", "image_url": f"data:{mime_type};base64,{base64_value}"},
                ],
            }
        )
    return messages


def degrade_image_messages(input_list: list[dict[str, Any]], indices: list[int]) -> None:
    for index in indices:
        if index < 0 or index >= len(input_list):
            continue
        item = input_list[index]
        if not isinstance(item, dict) or count_input_images(item) <= 0:
            continue
        prior_text = image_message_text(item)
        item["content"] = [
            {
                "type": "input_text",
                "text": (
                    "Visual frame image bytes were attached to an earlier model request and "
                    f"are now kept only as compact metadata. {prior_text}".strip()
                ),
            }
        ]


def image_message_text(item: dict[str, Any]) -> str:
    content = item.get("content")
    if not isinstance(content, list):
        return ""
    texts = []
    for part in content:
        if isinstance(part, dict) and part.get("type") == "input_text" and part.get("text"):
            texts.append(str(part["text"]))
    return " ".join(" ".join(text.split()) for text in texts).strip()


def compact_consumed_tool_history(input_list: list[dict[str, Any]]) -> int:
    pairs = tool_pairs(input_list)
    if len(pairs) <= RECENT_INPUT_TOOL_PAIRS_KEEP:
        return 0
    keep_call_ids = latest_tool_pair_call_ids(pairs)
    compacted = 0
    for pair in pairs:
        call_id = pair["call_id"]
        if call_id in keep_call_ids:
            continue
        output = tool_pair_output(input_list, pair)
        if tool_output_is_error(output):
            continue
        if tool_history_already_compacted(input_list, pair):
            continue
        compact_tool_call_item(input_list[pair["call_index"]], pair)
        set_tool_pair_output(
            input_list,
            pair,
            json.dumps(
            {
                "_compacted_prior_tool_output": True,
                "tool": pair["tool"],
                "summary": compact_tool_history_output(output, pair["tool"]),
            },
            ensure_ascii=True,
            default=str,
            ),
        )
        compacted += 1
    return compacted


def latest_tool_pair_call_ids(pairs: list[dict[str, Any]]) -> set[str]:
    keep: set[str] = set()
    seen_tools: set[str] = set()
    recent_pairs = pairs[-RECENT_INPUT_TOOL_RESULT_WINDOW:]
    for pair in reversed(recent_pairs):
        tool = str(pair.get("tool") or "")
        if not tool or tool in seen_tools:
            continue
        keep.add(str(pair["call_id"]))
        seen_tools.add(tool)
    return keep


def tool_pairs(input_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    calls: dict[str, dict[str, Any]] = {}
    pairs = []
    for index, item in enumerate(input_list):
        if not isinstance(item, dict):
            continue
        if item.get("type") in {"function_call", "tool_call"}:
            call_id = item.get("call_id") or item.get("id")
            name = item.get("name") or item.get("function", {}).get("name") or call_id or "tool"
            if call_id:
                calls[str(call_id)] = {"call_index": index, "tool": str(name), "arguments": item.get("arguments") or item.get("function", {}).get("arguments")}
            continue
        if item.get("role") == "assistant":
            for tool_call in item.get("tool_calls") or []:
                if not isinstance(tool_call, dict):
                    continue
                call_id = tool_call.get("id")
                function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
                name = function.get("name") or call_id or "tool"
                if call_id:
                    calls[str(call_id)] = {"call_index": index, "tool": str(name), "arguments": function.get("arguments")}
            for part in item.get("content") or []:
                if not isinstance(part, dict) or part.get("type") != "tool_use":
                    continue
                call_id = part.get("id")
                name = part.get("name") or call_id or "tool"
                if call_id:
                    calls[str(call_id)] = {"call_index": index, "tool": str(name), "arguments": part.get("input")}
            continue
        elif item.get("type") == "function_call_output":
            call_id = item.get("call_id")
            if call_id and str(call_id) in calls:
                pairs.append({**calls[str(call_id)], "call_id": str(call_id), "output_index": index, "output_key": "output"})
        elif item.get("role") == "tool":
            call_id = item.get("tool_call_id")
            if call_id and str(call_id) in calls:
                pairs.append({**calls[str(call_id)], "call_id": str(call_id), "output_index": index, "output_key": "content"})
        elif item.get("role") == "user" and isinstance(item.get("content"), list):
            for part_index, part in enumerate(item.get("content") or []):
                if not isinstance(part, dict) or part.get("type") != "tool_result":
                    continue
                call_id = part.get("tool_use_id")
                if call_id and str(call_id) in calls:
                    pairs.append(
                        {
                            **calls[str(call_id)],
                            "call_id": str(call_id),
                            "output_index": index,
                            "output_part_index": part_index,
                            "output_key": "content",
                        }
                    )
    return pairs


def tool_pair_output(input_list: list[dict[str, Any]], pair: dict[str, Any]) -> Any:
    item = input_list[pair["output_index"]]
    if "output_part_index" in pair:
        content = item.get("content") if isinstance(item, dict) else None
        if isinstance(content, list):
            part_index = int(pair["output_part_index"])
            if 0 <= part_index < len(content) and isinstance(content[part_index], dict):
                return content[part_index].get(pair.get("output_key") or "content")
        return None
    return item.get(pair.get("output_key") or "output") if isinstance(item, dict) else None


def set_tool_pair_output(input_list: list[dict[str, Any]], pair: dict[str, Any], value: str) -> None:
    item = input_list[pair["output_index"]]
    if "output_part_index" in pair:
        content = item.get("content") if isinstance(item, dict) else None
        if isinstance(content, list):
            part_index = int(pair["output_part_index"])
            if 0 <= part_index < len(content) and isinstance(content[part_index], dict):
                content[part_index][pair.get("output_key") or "content"] = value
        return
    if isinstance(item, dict):
        item[pair.get("output_key") or "output"] = value


def tool_history_already_compacted(input_list: list[dict[str, Any]], pair: dict[str, Any]) -> bool:
    parsed = parse_json_maybe(tool_pair_output(input_list, pair))
    return isinstance(parsed, dict) and bool(parsed.get("_compacted_prior_tool_output"))


def tool_output_is_error(output: Any) -> bool:
    parsed = parse_json_maybe(output)
    if isinstance(parsed, dict):
        if parsed.get("isError") or parsed.get("error") or parsed.get("ok") is False:
            return True
        text = json.dumps(parsed, ensure_ascii=True, default=str).lower()
        if tool_output_text_looks_error(text):
            return True
        return any(tool_output_is_error(value) for value in parsed.values())
    if isinstance(parsed, list):
        text = json.dumps(parsed, ensure_ascii=True, default=str).lower()
        if tool_output_text_looks_error(text):
            return True
        return any(tool_output_is_error(value) for value in parsed)
    return tool_output_text_looks_error(str(parsed or "").lower())


def tool_output_text_looks_error(text: str) -> bool:
    sample = text[:800]
    stripped = text.strip()
    return (
        "error executing tool" in sample
        or '"error"' in sample
        or "'error'" in sample
        or '"iserror": true' in sample
        or '"iserror":true' in sample
        or "'iserror': true" in sample
        or '"ok": false' in sample
        or '"ok":false' in sample
        or stripped.startswith(("error:", "error ", "failed:", "exception:", "traceback "))
    )


def compact_tool_call_item(item: dict[str, Any], pair: dict[str, Any]) -> None:
    tool = str(pair.get("tool") or pair.get("call_id") or "tool")
    arguments = pair.get("arguments")
    summary = {
        "_compacted_prior_tool_call": True,
        "tool": tool,
        "arguments_summary": compact_value(parse_json_maybe(arguments), path=f"tool_history.{tool}.arguments"),
    }
    if item.get("type") in {"function_call", "tool_call"}:
        item.clear()
        item.update(
            {
                "type": "function_call",
                "call_id": pair["call_id"],
                "name": tool,
                "arguments": json.dumps(summary, ensure_ascii=True, default=str),
            }
        )
        return
    if item.get("role") == "assistant":
        return


def compact_tool_history_output(output: Any, tool: str) -> Any:
    parsed = parse_json_maybe(output)
    compacted = compact_value(parsed, path=f"tool_history.{tool}.output")
    if encoded_json_length(compacted) <= 900:
        return compacted
    return summarize_plain_text(json.dumps(compacted, ensure_ascii=True, default=str), 900)


def parse_json_maybe(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped or stripped[0] not in "{[":
        return value
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


async def compact_consumed_tool_outputs(
    input_list: list[dict[str, Any]],
    max_chars: int,
    on_context_compacted: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> int:
    """Compact tool outputs, preserving only reasonably sized latest outputs verbatim."""
    pairs = tool_pairs(input_list)
    protected_call_ids = latest_tool_pair_call_ids(pairs)
    compacted_count = 0
    max_chars = min(max_chars, MAX_ACTIVE_TOOL_OUTPUT_CHARS)

    for pair in pairs:
        output = tool_pair_output(input_list, pair)
        if not isinstance(output, str) or len(output) <= max_chars:
            continue
        is_latest_batch = str(pair["call_id"]) in protected_call_ids
        tool = str(pair.get("tool") or pair.get("call_id") or "tool")
        try:
            parsed = json.loads(output)
        except json.JSONDecodeError:
            parsed = output
        compacted, details = compact_tool_output_for_model(tool, parsed, max_chars=max_chars)
        compacted_output = json.dumps(compacted, ensure_ascii=True, default=str)
        if len(compacted_output) > max_chars:
            compacted = force_compact_tool_output(tool, compacted, max_chars=max_chars)
            compacted_output = json.dumps(compacted, ensure_ascii=True, default=str)
        set_tool_pair_output(input_list, pair, compacted_output)
        compacted_count += 1
        if details and on_context_compacted is not None:
            details = {
                **details,
                "message": (
                    f"{'Latest' if is_latest_batch else 'Prior consumed'} tool output compacted "
                    f"for model context: {tool}."
                ),
                "protected_latest_tool_output": not is_latest_batch,
                "latest_tool_output_compacted_for_model": is_latest_batch,
                "estimated_chars_after": len(compacted_output),
            }
            await on_context_compacted(details)

    return compacted_count


def force_compact_tool_output(tool: str, value: Any, max_chars: int) -> dict[str, Any]:
    summary = compact_value(value, path=f"tool_output.{tool}.forced")
    payload = {
        "_compacted_for_model": True,
        "_forced_compaction": True,
        "_compaction_note": (
            "Tool output exceeded the configured model-context limit even after structural "
            "compaction. Full output remains in the dashboard event log."
        ),
        "tool": tool,
        "summary": summary,
    }
    encoded = json.dumps(payload, ensure_ascii=True, default=str)
    if len(encoded) <= max_chars:
        return payload
    payload["summary"] = fit_summary_text(encoded, payload, max_chars=max_chars)
    return payload


def fit_summary_text(source_text: str, payload: dict[str, Any], max_chars: int) -> str:
    payload_without_summary = dict(payload)
    payload_without_summary["summary"] = ""
    overhead = len(json.dumps(payload_without_summary, ensure_ascii=True, default=str))
    allowance = max(80, max_chars - overhead - 80)
    summary = summarize_plain_text(source_text, allowance)
    while allowance > 80:
        candidate = dict(payload)
        candidate["summary"] = summary
        if len(json.dumps(candidate, ensure_ascii=True, default=str)) <= max_chars:
            return summary
        allowance = max(80, int(allowance * 0.82))
        summary = summarize_plain_text(source_text, allowance)
    return summarize_plain_text(source_text, 80)


def summarize_plain_text(value: str, max_chars: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_chars:
        return text
    head = max(0, max_chars - 80)
    return f"{text[:head].rstrip()} ... [truncated; {len(text)} chars]"


def latest_tool_output_batch_indices(input_list: list[dict[str, Any]]) -> set[int]:
    protected: set[int] = set()
    index = len(input_list) - 1
    while index >= 0:
        item = input_list[index]
        if (
            item.get("type") == "function_call_output"
            or item.get("role") == "tool"
            or is_anthropic_tool_result_message(item)
        ):
            protected.add(index)
            index -= 1
            continue
        break
    return protected


def function_call_names_by_id(input_list: list[dict[str, Any]]) -> dict[str, str]:
    names: dict[str, str] = {}
    for item in input_list:
        if not isinstance(item, dict):
            continue
        if item.get("type") in {"function_call", "tool_call"}:
            call_id = item.get("call_id") or item.get("id")
            name = item.get("name") or item.get("function", {}).get("name")
            if call_id and name:
                names[str(call_id)] = str(name)
            continue
        if item.get("role") == "assistant":
            for tool_call in item.get("tool_calls") or []:
                if not isinstance(tool_call, dict):
                    continue
                call_id = tool_call.get("id")
                function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
                name = function.get("name")
                if call_id and name:
                    names[str(call_id)] = str(name)
            for part in item.get("content") or []:
                if not isinstance(part, dict) or part.get("type") != "tool_use":
                    continue
                call_id = part.get("id")
                name = part.get("name")
                if call_id and name:
                    names[str(call_id)] = str(name)
    return names


def is_retryable_status(status_code: int) -> bool:
    return status_code in {408, 409, 425, 429, 500, 502, 503, 504}


def is_retryable_response(response: httpx.Response) -> bool:
    if not is_retryable_status(response.status_code):
        return False
    return provider_error_code(response) not in {
        "model_not_found",
        "invalid_model",
        "convert_request_failed",
    }


def provider_error_code(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except Exception:
        return ""
    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return ""
    return str(error.get("code") or error.get("type") or "").strip().lower()


def is_retryable_request_error(exc: httpx.RequestError) -> bool:
    return isinstance(
        exc,
        (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.NetworkError,
            httpx.PoolTimeout,
            httpx.ReadError,
            httpx.ReadTimeout,
            httpx.RemoteProtocolError,
            httpx.WriteError,
            httpx.WriteTimeout,
        ),
    )


def sanitize_run_name(value: str) -> str:
    text = " ".join(str(value or "").replace("\n", " ").split())
    text = text.strip("`'\" .")
    if not text:
        return "Untitled Run"
    return text


def extract_reasoning_summary(data: dict[str, Any]) -> list[str]:
    summaries: list[str] = []
    for item in data.get("output", []) or []:
        item_type = item.get("type")
        if item_type in {"reasoning", "thinking"}:
            for summary in item.get("summary", []) or []:
                text = summary.get("text") if isinstance(summary, dict) else summary
                if text:
                    summaries.append(str(text))
            for content in item.get("content", []) or []:
                if isinstance(content, dict) and content.get("type") in {"summary_text", "reasoning_summary"}:
                    text = content.get("text")
                    if text:
                        summaries.append(str(text))
    return summaries


def reasoning_summary_metrics(data: dict[str, Any]) -> dict[str, Any]:
    """Expose whether the provider sent a usable reasoning summary at all."""

    summaries = [summary.strip() for summary in extract_reasoning_summary(data) if summary.strip()]
    heading_only = bool(summaries) and all(is_heading_only_reasoning_summary(summary) for summary in summaries)
    return {
        "reasoning_summary_item_count": len(summaries),
        "reasoning_summary_chars": sum(len(summary) for summary in summaries),
        "reasoning_summary_heading_only": heading_only,
    }


def is_heading_only_reasoning_summary(summary: str) -> bool:
    lines = [line.strip() for line in summary.splitlines() if line.strip()]
    if not lines:
        return False
    return all(
        line.startswith("#")
        or re.fullmatch(r"\*\*[^*\n]+\*\*", line) is not None
        for line in lines
    )


def mcp_tools_to_response_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    response_tools = []
    for tool in tools:
        name = tool.get("name")
        if not name:
            continue
        parameters = tool.get("inputSchema") or tool.get("input_schema") or {"type": "object", "properties": {}}
        response_tools.append(
            {
                "type": "function",
                "name": str(name),
                "description": str(tool.get("description") or ""),
                "parameters": parameters,
            }
        )
    return response_tools


def mcp_tools_to_chat_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chat_tools = []
    for tool in tools:
        name = tool.get("name")
        if not name:
            continue
        parameters = tool.get("inputSchema") or tool.get("input_schema") or {"type": "object", "properties": {}}
        chat_tools.append(
            {
                "type": "function",
                "function": {
                    "name": str(name),
                    "description": str(tool.get("description") or ""),
                    "parameters": parameters,
                },
            }
        )
    return chat_tools


def mcp_tools_to_anthropic_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    anthropic_tools = []
    for tool in tools:
        name = tool.get("name")
        if not name:
            continue
        parameters = tool.get("inputSchema") or tool.get("input_schema") or {"type": "object", "properties": {}}
        anthropic_tools.append(
            {
                "name": str(name),
                "description": str(tool.get("description") or ""),
                "input_schema": parameters,
            }
        )
    return anthropic_tools


def extract_function_calls(data: dict[str, Any]) -> list[dict[str, Any]]:
    calls = []
    for item in data.get("output", []) or []:
        if item.get("type") not in {"function_call", "tool_call"}:
            continue
        name = item.get("name") or item.get("function", {}).get("name")
        call_id = item.get("call_id") or item.get("id")
        raw_arguments = item.get("arguments")
        if raw_arguments is None and isinstance(item.get("function"), dict):
            raw_arguments = item["function"].get("arguments")
        arguments = {}
        if isinstance(raw_arguments, str) and raw_arguments.strip():
            try:
                arguments = json.loads(raw_arguments)
            except json.JSONDecodeError:
                arguments = {"_raw_arguments": raw_arguments}
        elif isinstance(raw_arguments, dict):
            arguments = raw_arguments
        if name and call_id:
            calls.append({"name": str(name), "call_id": str(call_id), "arguments": arguments})
    return calls


def extract_chat_response_text(data: dict[str, Any]) -> str:
    texts: list[str] = []
    for choice in data.get("choices", []) or []:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
        content = message.get("content")
        if isinstance(content, str) and content:
            texts.append(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") in {"text", "input_text"} and part.get("text"):
                    texts.append(str(part["text"]))
    return "\n".join(texts).strip()


def _chat_reasoning_fragments(value: Any) -> list[str]:
    """Normalize reasoning fields emitted by OpenAI-compatible chat servers.

    vLLM and several local runtimes use ``reasoning_content`` while other
    gateways expose ``reasoning`` or ``thinking``.  These values may be a
    string, a list of content blocks, or a summary object.  Keep this parser
    deliberately narrow so metadata (token counts, signatures, etc.) is not
    shown as model thinking.
    """

    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        fragments: list[str] = []
        for item in value:
            fragments.extend(_chat_reasoning_fragments(item))
        return fragments
    if not isinstance(value, dict):
        return []

    fragments: list[str] = []
    for key in ("text", "thinking", "reasoning_content", "reasoning", "summary", "content"):
        if key in value:
            fragments.extend(_chat_reasoning_fragments(value[key]))
    return fragments


def extract_chat_reasoning(data: dict[str, Any]) -> list[str]:
    """Return ordered, de-duplicated thinking text from a chat completion."""

    fragments: list[str] = []
    for choice in data.get("choices", []) or []:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
        for key in ("reasoning_content", "reasoning", "thinking"):
            fragments.extend(_chat_reasoning_fragments(message.get(key)))
        content = message.get("content")
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                block_type = str(block.get("type") or "").lower()
                if block_type in {"reasoning", "thinking", "summary", "summary_text", "reasoning_summary"}:
                    fragments.extend(_chat_reasoning_fragments(block))

    result: list[str] = []
    seen: set[str] = set()
    for fragment in fragments:
        text = str(fragment).strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


async def emit_chat_reasoning(
    data: dict[str, Any],
    round_index: int,
    emitted_reasoning: set[str],
    on_reasoning: Callable[[str, int], Awaitable[None]] | None,
) -> None:
    if on_reasoning is None:
        return
    for item in extract_chat_reasoning(data):
        text = item.strip()
        if not text or text in emitted_reasoning:
            continue
        emitted_reasoning.add(text)
        await on_reasoning(text, round_index)


async def emit_chat_response_text(
    data: dict[str, Any],
    round_index: int,
    emitted_texts: set[str],
    on_text: Callable[[str, int], Awaitable[None]] | None,
) -> None:
    if on_text is None:
        return
    text = extract_chat_response_text(data).strip()
    if not text or text in emitted_texts:
        return
    emitted_texts.add(text)
    await on_text(text, round_index)


def extract_chat_tool_calls(data: dict[str, Any]) -> list[dict[str, Any]]:
    calls = []
    for choice in data.get("choices", []) or []:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
        for item in message.get("tool_calls", []) or []:
            if not isinstance(item, dict):
                continue
            function = item.get("function") if isinstance(item.get("function"), dict) else {}
            name = function.get("name")
            call_id = item.get("id")
            raw_arguments = function.get("arguments")
            arguments = {}
            if isinstance(raw_arguments, str) and raw_arguments.strip():
                try:
                    arguments = json.loads(raw_arguments)
                except json.JSONDecodeError:
                    arguments = {"_raw_arguments": raw_arguments}
            elif isinstance(raw_arguments, dict):
                arguments = raw_arguments
            if set(arguments.keys()) == {"_noargs"}:
                arguments = {}
            if name and call_id:
                calls.append({"name": str(name), "call_id": str(call_id), "arguments": arguments})
    return calls


def chat_assistant_message(data: dict[str, Any]) -> dict[str, Any]:
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") if isinstance(choice, dict) and isinstance(choice.get("message"), dict) else {}
    assistant: dict[str, Any] = {
        "role": "assistant",
        "content": message.get("content") or "",
    }
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        assistant["tool_calls"] = tool_calls
    # Local reasoning models (notably gpt-oss/Qwen served by vLLM) require
    # their reasoning channel to be replayed with the assistant tool-call
    # message on the next request.  Preserve only fields that were actually
    # returned so ordinary OpenAI Chat Completions remain unchanged.
    for key in ("reasoning_content", "reasoning", "thinking"):
        value = message.get(key)
        if value not in (None, "", []):
            assistant[key] = value
    return assistant


def compact_chat_tool_result(result: Any, max_chars: int) -> Any:
    if encoded_json_length(result) <= max_chars:
        return result
    compacted, _details = compact_tool_output_for_model("chat_tool_result", result, max_chars=max_chars)
    if encoded_json_length(compacted) <= max_chars:
        return compacted
    return force_compact_tool_output("chat_tool_result", compacted, max_chars=max_chars)


def active_tool_output_chars(max_chars: int, batch_size: int) -> int:
    batch_size = max(1, int(batch_size or 1))
    per_tool_batch_budget = MAX_ACTIVE_TOOL_OUTPUT_BATCH_CHARS // batch_size
    return max(
        MIN_ACTIVE_TOOL_OUTPUT_CHARS,
        min(int(max_chars or MAX_ACTIVE_TOOL_OUTPUT_CHARS), MAX_ACTIVE_TOOL_OUTPUT_CHARS, per_tool_batch_budget),
    )


def extract_anthropic_text(data: dict[str, Any]) -> str:
    texts = []
    for item in data.get("content", []) or []:
        if isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
            texts.append(str(item["text"]))
    return "\n".join(texts).strip()


def extract_anthropic_thinking(data: dict[str, Any]) -> list[str]:
    thinking = []
    for item in data.get("content", []) or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "thinking" and item.get("thinking"):
            thinking.append(str(item["thinking"]))
        elif item.get("type") in {"redacted_thinking", "summary"} and item.get("text"):
            thinking.append(str(item["text"]))
    return thinking


async def emit_anthropic_thinking(
    data: dict[str, Any],
    round_index: int,
    emitted_reasoning: set[str],
    on_reasoning: Callable[[str, int], Awaitable[None]] | None,
) -> None:
    if on_reasoning is None:
        return
    for item in extract_anthropic_thinking(data):
        text = item.strip()
        if not text or text in emitted_reasoning:
            continue
        emitted_reasoning.add(text)
        await on_reasoning(text, round_index)


async def emit_anthropic_text(
    data: dict[str, Any],
    round_index: int,
    emitted_texts: set[str],
    on_text: Callable[[str, int], Awaitable[None]] | None,
) -> None:
    if on_text is None:
        return
    text = extract_anthropic_text(data).strip()
    if not text or text in emitted_texts:
        return
    emitted_texts.add(text)
    await on_text(text, round_index)


def extract_anthropic_tool_calls(data: dict[str, Any]) -> list[dict[str, Any]]:
    calls = []
    for item in data.get("content", []) or []:
        if not isinstance(item, dict) or item.get("type") != "tool_use":
            continue
        name = item.get("name")
        call_id = item.get("id")
        arguments = item.get("input") if isinstance(item.get("input"), dict) else {}
        if set(arguments.keys()) == {"_noargs"}:
            arguments = {}
        if name and call_id:
            calls.append({"name": str(name), "call_id": str(call_id), "arguments": arguments})
    return calls


def anthropic_assistant_message(data: dict[str, Any]) -> dict[str, Any]:
    content = data.get("content", []) if isinstance(data.get("content"), list) else []
    return {"role": "assistant", "content": content}
