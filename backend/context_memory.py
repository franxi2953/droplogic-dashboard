from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .context_builder import build_model_context, encoded_json_length


CHECKPOINT_NEW_EVENT_TRIGGER = 40
CHECKPOINT_NEW_CHARS_TRIGGER = 40_000


class ContextMemoryMixin:
    def should_make_ai_context_summary(self, events: list[dict[str, Any]]) -> bool:
        if not self.config.ai.ai_context_summary_enabled:
            return False
        if not self.ai.configured:
            return False
        if not events:
            return False
        chars = encoded_json_length(events)
        if chars < self.config.ai.ai_context_summary_trigger_chars:
            return False
        last_summary_index = None
        for index in range(len(events) - 1, -1, -1):
            if events[index].get("type") == "context_ai_summary":
                last_summary_index = index
                break
        if last_summary_index is None:
            return True
        events_since_summary = len(events) - last_summary_index - 1
        if events_since_summary >= max(20, self.config.ai.recent_event_target // 2):
            return True
        chars_since_summary = encoded_json_length(events[last_summary_index + 1 :])
        return chars_since_summary >= max(20_000, self.config.ai.ai_context_summary_trigger_chars // 3)

    async def ensure_context_checkpoint(
        self,
        events: list[dict[str, Any]],
        on_retry: Any,
        on_context_compacted: Any,
    ) -> dict[str, Any] | None:
        checkpoint = self.valid_context_checkpoint(events)
        if not self.should_update_context_checkpoint(events, checkpoint):
            return checkpoint
        if not self.config.ai.ai_context_summary_enabled or not self.ai.configured:
            return checkpoint

        target_count = self.context_checkpoint_target_count(events)
        if target_count <= 0:
            return checkpoint

        previous_summary = str((checkpoint or {}).get("summary") or "").strip()
        previous_covered = int((checkpoint or {}).get("covered_event_count") or 0) if previous_summary else 0
        events_to_summarize = events[previous_covered:target_count] if previous_summary else events[:target_count]
        if not events_to_summarize and previous_summary:
            return checkpoint
        summary_context = build_model_context(
            self.checkpoint_summary_events(events_to_summarize, previous_summary),
            run_dir=self.recorder.run_dir,
            max_chars=min(self.config.ai.max_context_chars, self.config.ai.ai_context_summary_trigger_chars),
            target_chars=min(self.config.ai.target_context_chars, 60_000),
            recent_event_target=min(self.config.ai.recent_event_target, 100),
            large_event_chars=self.config.ai.large_event_chars,
            protect_latest_tool_result=True,
        )
        try:
            summary = await self.ai.summarize_context_memory(
                summary_context.events,
                max_chars=self.config.ai.ai_context_summary_max_chars,
                on_retry=on_retry,
                on_context_compacted=on_context_compacted,
            )
        except Exception as exc:
            await self.record(
                "context_compacted",
                level="warning",
                scope="run_context_checkpoint",
                message=f"Context checkpoint update failed; using previous checkpoint/deterministic context: {exc}",
            )
            return checkpoint

        new_checkpoint = {
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "run_id": self.recorder.run_id,
            "covered_event_count": target_count,
            "covered_until_t": events[target_count - 1].get("t") if target_count > 0 else None,
            "covered_until_ts": events[target_count - 1].get("ts") if target_count > 0 else None,
            "source": "ai+deterministic",
            "summary": summary,
            "source_event_count": target_count,
            "new_source_event_count": len(events_to_summarize),
            "previous_covered_event_count": previous_covered,
            "deterministic_context_chars": encoded_json_length(summary_context.events),
            "max_summary_chars": self.config.ai.ai_context_summary_max_chars,
            "safety_note": (
                "This checkpoint is narrative memory only. Before hardware actions, refresh physical state "
                "with execution_status_summary() or a targeted MCP tool; do not trust the checkpoint for "
                "live matrix, stage, temperature, droplets, or voltages."
            ),
        }
        self.recorder.write_context_checkpoint(new_checkpoint)
        await self.record(
            "context_checkpoint_saved",
            scope="run_context_checkpoint",
            message="Persistent context checkpoint saved for future turns.",
            covered_event_count=new_checkpoint["covered_event_count"],
            covered_until_t=new_checkpoint["covered_until_t"],
            source_event_count=new_checkpoint["source_event_count"],
            new_source_event_count=new_checkpoint["new_source_event_count"],
            previous_covered_event_count=new_checkpoint["previous_covered_event_count"],
            deterministic_context_chars=new_checkpoint["deterministic_context_chars"],
            max_summary_chars=new_checkpoint["max_summary_chars"],
        )
        return new_checkpoint

    def valid_context_checkpoint(self, events: list[dict[str, Any]]) -> dict[str, Any] | None:
        checkpoint = self.recorder.read_context_checkpoint()
        if not checkpoint:
            return None
        covered = int(checkpoint.get("covered_event_count") or 0)
        summary = str(checkpoint.get("summary") or "").strip()
        if covered <= 0 or covered > len(events) or not summary:
            return None
        return checkpoint

    def should_update_context_checkpoint(
        self,
        events: list[dict[str, Any]],
        checkpoint: dict[str, Any] | None,
    ) -> bool:
        if not events:
            return False
        total_chars = encoded_json_length(events)
        if checkpoint is None:
            return total_chars >= self.config.ai.ai_context_summary_trigger_chars
        covered = int(checkpoint.get("covered_event_count") or 0)
        tail = events[covered:]
        if len(tail) >= CHECKPOINT_NEW_EVENT_TRIGGER:
            return True
        if encoded_json_length(tail) >= CHECKPOINT_NEW_CHARS_TRIGGER:
            return True
        return False

    def context_checkpoint_target_count(self, events: list[dict[str, Any]]) -> int:
        if len(events) < 2:
            return 0
        # Leave the current prompt/agent_started and immediate fresh context outside the checkpoint.
        return max(0, len(events) - 2)

    def checkpoint_summary_events(self, events: list[dict[str, Any]], previous_summary: str) -> list[dict[str, Any]]:
        events = [
            event
            for event in events
            if event.get("type") not in {"context_checkpoint_used", "context_compacted", "pinned_context_used"}
        ]
        if not previous_summary:
            return events
        return [
            {
                "type": "previous_context_checkpoint",
                "message": (
                    "Previous persistent context checkpoint. Merge it with newer events and produce "
                    "a fresh checkpoint; do not treat it as live hardware state."
                ),
                "text": previous_summary,
            },
            *events,
        ]

    def events_for_model_from_checkpoint(
        self,
        events: list[dict[str, Any]],
        checkpoint: dict[str, Any] | None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        checkpoint = self.valid_context_checkpoint(events) if checkpoint is None else checkpoint
        if checkpoint is None:
            return events, None
        covered = int(checkpoint.get("covered_event_count") or 0)
        tail = events[covered:]
        memory_event = {
            "type": "run_context_checkpoint",
            "message": (
                "Persistent run memory checkpoint loaded. It summarizes earlier events only; "
                "the complete events.jsonl remains on disk."
            ),
            "covered_event_count": covered,
            "covered_until_t": checkpoint.get("covered_until_t"),
            "covered_until_ts": checkpoint.get("covered_until_ts"),
            "text": checkpoint.get("summary"),
            "safety_note": checkpoint.get("safety_note"),
        }
        details = {
            "scope": "run_context_checkpoint",
            "message": "Persistent context checkpoint loaded for this model turn.",
            "covered_event_count": covered,
            "new_event_count": len(tail),
            "checkpoint_chars": len(str(checkpoint.get("summary") or "")),
            "estimated_chars_after": encoded_json_length([memory_event, *tail]),
        }
        return [memory_event, *tail], details
