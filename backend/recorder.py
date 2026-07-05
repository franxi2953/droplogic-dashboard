from __future__ import annotations

import json
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TEMPERATURE_HISTORY_FILENAME = "temperature_history.json"
TEMPERATURE_HISTORY_MAX_BYTES = 50 * 1024 * 1024
TEMPERATURE_HISTORY_TARGET_BYTES = 46 * 1024 * 1024
TEMPERATURE_HISTORY_DISPLAY_MAX_SAMPLES = 60000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunRecorder:
    def __init__(self, runs_dir: Path, run_id: str | None = None):
        self.runs_dir = runs_dir
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id or self.new_run_id()
        self.run_dir = self.runs_dir / self.run_id
        if run_id:
            self._assert_safe_run_path(self.run_dir)
            if not self.run_dir.exists():
                raise FileNotFoundError(f"Run does not exist: {run_id}")
        else:
            self.run_dir.mkdir(parents=True, exist_ok=False)
        self.events_path = self.run_dir / "events.jsonl"
        self.run_path = self.run_dir / "run.json"
        self.temperature_history_path = self.run_dir / TEMPERATURE_HISTORY_FILENAME
        self._temperature_history_cache: dict[str, Any] | None = None
        self._last_temperature_history_sample: dict[str, Any] | None = None
        if not run_id:
            self.write_run_metadata()
        self.remember_active_run(self.run_id)

    @staticmethod
    def new_run_id() -> str:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{stamp}_{uuid.uuid4().hex[:8]}"

    def write_run_metadata(self) -> None:
        payload = {
            "run_id": self.run_id,
            "name": "",
            "created_at": utc_now(),
            "events_path": str(self.events_path),
        }
        self.run_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def read_metadata(self, run_dir: Path | None = None) -> dict[str, Any]:
        path = (run_dir or self.run_dir) / "run.json"
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    @classmethod
    def open_latest_or_create(cls, runs_dir: Path) -> "RunRecorder":
        runs_dir.mkdir(parents=True, exist_ok=True)
        remembered = cls.remembered_run_id(runs_dir)
        if remembered and (runs_dir / remembered).is_dir():
            return cls(runs_dir, run_id=remembered)
        latest = cls.latest_run_id(runs_dir)
        if latest:
            return cls(runs_dir, run_id=latest)
        return cls(runs_dir)

    @staticmethod
    def remembered_run_id(runs_dir: Path) -> str | None:
        path = runs_dir / ".last_run"
        if not path.exists():
            return None
        run_id = path.read_text(encoding="utf-8").strip()
        return run_id or None

    def remember_active_run(self, run_id: str) -> None:
        (self.runs_dir / ".last_run").write_text(run_id, encoding="utf-8")

    @staticmethod
    def latest_run_id(runs_dir: Path) -> str | None:
        candidates = []
        for run_dir in runs_dir.iterdir() if runs_dir.exists() else []:
            if not run_dir.is_dir():
                continue
            events_path = run_dir / "events.jsonl"
            run_path = run_dir / "run.json"
            newest = max(
                [
                    run_dir.stat().st_mtime,
                    events_path.stat().st_mtime if events_path.exists() else 0,
                    run_path.stat().st_mtime if run_path.exists() else 0,
                ]
            )
            candidates.append((newest, run_dir.name))
        if not candidates:
            return None
        return max(candidates)[1]

    def write_metadata(self, metadata: dict[str, Any], run_dir: Path | None = None) -> None:
        path = (run_dir or self.run_dir) / "run.json"
        path.write_text(json.dumps(metadata, indent=2, ensure_ascii=True), encoding="utf-8")

    def append(self, event_type: str, **fields: Any) -> dict[str, Any]:
        event = {
            "ts": utc_now(),
            "t": time.time(),
            "type": event_type,
            **fields,
        }
        with self.events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=True, default=str) + "\n")
        return event

    def append_temperature_sample(self, sample: dict[str, Any]) -> dict[str, Any]:
        normalized = normalize_temperature_sample(sample)
        if not normalized:
            return {"ok": False, "reason": "invalid_temperature_sample"}
        if (
            self._last_temperature_history_sample
            and temperature_sample_key(self._last_temperature_history_sample) == temperature_sample_key(normalized)
        ):
            return {"ok": True, "skipped": "duplicate"}
        if not self.temperature_history_path.exists():
            self._write_temperature_history_with_limit(self._new_temperature_history([normalized]))
        else:
            try:
                append_temperature_sample_to_file(self.temperature_history_path, normalized)
            except Exception:
                history = self.read_temperature_history()
                history["samples"] = [*(history.get("samples") or []), normalized]
                self._write_temperature_history_with_limit(history)
        self._last_temperature_history_sample = normalized
        self._temperature_history_cache = None
        if self.temperature_history_path.stat().st_size > TEMPERATURE_HISTORY_MAX_BYTES:
            history = self.read_temperature_history()
            self._write_temperature_history_with_limit(history)
        return {"ok": True, "path": str(self.temperature_history_path), "sample": normalized}

    def read_temperature_history(
        self,
        run_id: str | None = None,
        max_samples: int | None = None,
    ) -> dict[str, Any]:
        if run_id and run_id != self.run_id:
            run_dir = self.runs_dir / run_id
            self._assert_safe_run_path(run_dir)
            path = run_dir / TEMPERATURE_HISTORY_FILENAME
            history = read_temperature_history_file(path, run_id)
        elif self._temperature_history_cache is not None:
            history = self._temperature_history_cache
        else:
            history = read_temperature_history_file(self.temperature_history_path, self.run_id)
            self._temperature_history_cache = history

        samples = list(history.get("samples") or [])
        stored_count = len(samples)
        if max_samples is not None and stored_count > max_samples:
            samples = simplify_temperature_samples(samples, max_samples)
        result = dict(history)
        result["samples"] = samples
        result["stored_sample_count"] = stored_count
        result["sample_count"] = len(samples)
        result["downsampled"] = len(samples) < stored_count
        result["path"] = TEMPERATURE_HISTORY_FILENAME
        return result

    def ensure_temperature_history_from_events(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        history = self.read_temperature_history()
        if history.get("samples"):
            return history
        samples = temperature_samples_from_events(events)
        if samples:
            self._write_temperature_history_with_limit(self._new_temperature_history(samples))
        return self.read_temperature_history()

    def _write_temperature_history_with_limit(self, history: dict[str, Any]) -> None:
        samples = compact_temperature_history_samples(history.get("samples") or [])
        history["samples"] = samples
        history.setdefault("schema_version", 1)
        history.setdefault("run_id", self.run_id)
        history.setdefault("created_at", utc_now())
        history["updated_at"] = utc_now()
        history["max_bytes"] = TEMPERATURE_HISTORY_MAX_BYTES
        encoded = encode_json_bytes(history)
        if len(encoded) > TEMPERATURE_HISTORY_MAX_BYTES:
            target_count = target_temperature_sample_count(samples, len(encoded))
            samples = simplify_temperature_samples(samples, target_count)
            history["samples"] = samples
            history["compacted_at"] = utc_now()
            history["compaction"] = {
                "reason": "max_bytes",
                "max_bytes": TEMPERATURE_HISTORY_MAX_BYTES,
                "target_bytes": TEMPERATURE_HISTORY_TARGET_BYTES,
            }
            encoded = encode_json_bytes(history)
            while len(encoded) > TEMPERATURE_HISTORY_MAX_BYTES and len(samples) > 1000:
                samples = simplify_temperature_samples(samples, max(1000, int(len(samples) * 0.75)))
                history["samples"] = samples
                encoded = encode_json_bytes(history)

        tmp_path = self.temperature_history_path.with_suffix(".tmp")
        tmp_path.write_bytes(encoded)
        tmp_path.replace(self.temperature_history_path)
        self._temperature_history_cache = history

    def _new_temperature_history(self, samples: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "run_id": self.run_id,
            "created_at": utc_now(),
            "updated_at": utc_now(),
            "max_bytes": TEMPERATURE_HISTORY_MAX_BYTES,
            "samples": samples,
        }

    def recent_events(self, limit: int = 80) -> list[dict[str, Any]]:
        if not self.events_path.exists():
            return []
        lines = self.events_path.read_text(encoding="utf-8").splitlines()
        events = []
        for line in lines[-limit:]:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return events

    def events_for_run(self, run_id: str, limit: int | None = None) -> list[dict[str, Any]]:
        run_dir = self.runs_dir / run_id
        self._assert_safe_run_path(run_dir)
        events_path = run_dir / "events.jsonl"
        if not events_path.exists():
            return []
        lines = events_path.read_text(encoding="utf-8").splitlines()
        if limit is not None:
            lines = lines[-limit:]
        events = []
        for line in lines:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return events

    def event_window_for_run(
        self,
        run_id: str,
        *,
        before_t: float | None = None,
        limit: int = 350,
        omit_types: set[str] | None = None,
    ) -> dict[str, Any]:
        run_dir = self.runs_dir / run_id
        self._assert_safe_run_path(run_dir)
        events_path = run_dir / "events.jsonl"
        if not events_path.exists():
            return {
                "events": [],
                "meta": {
                    "run_id": run_id,
                    "loaded_event_count": 0,
                    "total_event_count": 0,
                    "has_more": False,
                    "oldest_t": None,
                },
            }

        omit = set(omit_types or set())
        parsed: list[tuple[int, dict[str, Any]]] = []
        for index, line in enumerate(events_path.read_text(encoding="utf-8").splitlines()):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") in omit:
                continue
            parsed.append((index, event))

        eligible: list[tuple[int, dict[str, Any]]] = []
        for index, event in parsed:
            event_time = event.get("t")
            if before_t is not None:
                try:
                    if float(event_time) >= float(before_t):
                        continue
                except (TypeError, ValueError):
                    continue
            eligible.append((index, event))

        safe_limit = max(1, min(2000, int(limit or 350)))
        window = eligible[-safe_limit:]
        events = [event for _, event in window]
        oldest_index = window[0][0] if window else None
        return {
            "events": events,
            "meta": {
                "run_id": run_id,
                "loaded_event_count": len(events),
                "total_event_count": len(parsed),
                "has_more": oldest_index is not None and any(index < oldest_index for index, _ in eligible),
                "oldest_t": events[0].get("t") if events else None,
                "oldest_ts": events[0].get("ts") if events else None,
                "oldest_index": oldest_index,
            },
        }

    def context_checkpoint_path(self, run_id: str | None = None) -> Path:
        run_dir = self.runs_dir / (run_id or self.run_id)
        self._assert_safe_run_path(run_dir)
        return run_dir / "context_checkpoint.json"

    def read_context_checkpoint(self, run_id: str | None = None) -> dict[str, Any] | None:
        path = self.context_checkpoint_path(run_id)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
        return payload if isinstance(payload, dict) else None

    def write_context_checkpoint(self, checkpoint: dict[str, Any], run_id: str | None = None) -> None:
        path = self.context_checkpoint_path(run_id)
        path.write_text(json.dumps(checkpoint, indent=2, ensure_ascii=True, default=str), encoding="utf-8")

    def list_runs(self) -> list[dict[str, Any]]:
        runs = []
        for run_dir in sorted(self.runs_dir.iterdir(), reverse=True):
            if not run_dir.is_dir():
                continue
            try:
                runs.append(self.run_summary(run_dir))
            except Exception:
                continue
        return runs

    def run_summary(self, run_dir: Path) -> dict[str, Any]:
        run_id = run_dir.name
        metadata = self.read_metadata(run_dir)
        events_path = run_dir / "events.jsonl"
        event_count = 0
        last_event_at = metadata.get("created_at")
        preview = ""
        if events_path.exists():
            with events_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    event_count += 1
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    last_event_at = event.get("ts") or last_event_at
                    if event.get("type") == "agent_prompt":
                        preview = str(event.get("prompt") or "")
                    elif event.get("type") == "agent_response":
                        preview = str(event.get("text") or event.get("error") or "")
        preview = clean_preview(preview)
        return {
            "run_id": run_id,
            "name": str(metadata.get("name") or ""),
            "active": run_id == self.run_id,
            "created_at": metadata.get("created_at"),
            "event_count": event_count,
            "last_event_at": last_event_at,
            "preview": preview,
        }

    def delete_run(self, run_id: str) -> None:
        run_dir = self.runs_dir / run_id
        self._assert_safe_run_path(run_dir)
        if run_id == self.run_id:
            raise ValueError("Cannot delete the active run.")
        if run_dir.exists():
            shutil.rmtree(run_dir)

    def delete_runs(self, run_ids: list[str]) -> None:
        for run_id in run_ids:
            self.delete_run(run_id)

    def rename_run(self, run_id: str, name: str) -> None:
        run_dir = self.runs_dir / run_id
        self._assert_safe_run_path(run_dir)
        if not run_dir.exists():
            raise FileNotFoundError(f"Run does not exist: {run_id}")
        metadata = self.read_metadata(run_dir)
        metadata.setdefault("run_id", run_id)
        metadata.setdefault("created_at", utc_now())
        metadata.setdefault("events_path", str(run_dir / "events.jsonl"))
        metadata["name"] = name.strip()
        self.write_metadata(metadata, run_dir)

    def open_run(self, run_id: str) -> "RunRecorder":
        return RunRecorder(self.runs_dir, run_id=run_id)

    def _assert_safe_run_path(self, path: Path) -> None:
        root = self.runs_dir.resolve()
        resolved = path.resolve()
        if root != resolved and root not in resolved.parents:
            raise ValueError("Invalid run path.")


def count_lines(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for _ in path.open("r", encoding="utf-8"))


def clean_preview(value: str) -> str:
    return str(value or "").strip()


def read_temperature_history_file(path: Path, run_id: str) -> dict[str, Any]:
    if not path.exists():
        return {
            "schema_version": 1,
            "run_id": run_id,
            "created_at": utc_now(),
            "updated_at": None,
            "max_bytes": TEMPERATURE_HISTORY_MAX_BYTES,
            "samples": [],
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    samples = compact_temperature_history_samples(payload.get("samples") or [])
    return {
        "schema_version": int(payload.get("schema_version") or 1),
        "run_id": str(payload.get("run_id") or run_id),
        "created_at": payload.get("created_at") or utc_now(),
        "updated_at": payload.get("updated_at"),
        "compacted_at": payload.get("compacted_at"),
        "compaction": payload.get("compaction") if isinstance(payload.get("compaction"), dict) else None,
        "max_bytes": int(payload.get("max_bytes") or TEMPERATURE_HISTORY_MAX_BYTES),
        "samples": samples,
    }


def append_temperature_sample_to_file(path: Path, sample: dict[str, Any]) -> None:
    sample_bytes = json.dumps(sample, ensure_ascii=True, separators=(",", ":"), default=str).encode("utf-8")
    closing_index = find_last_byte(path, b"]")
    if closing_index is None:
        raise ValueError("Temperature history JSON has no samples array close.")
    previous_index = previous_non_whitespace_byte(path, closing_index)
    empty_array = previous_index is not None and read_one_byte(path, previous_index) == b"["
    with path.open("r+b") as handle:
        handle.seek(closing_index)
        tail = handle.read()
        handle.seek(closing_index)
        handle.write((b"" if empty_array else b",") + sample_bytes + tail)
        handle.truncate()


def find_last_byte(path: Path, target: bytes) -> int | None:
    chunk_size = 4096
    with path.open("rb") as handle:
        handle.seek(0, 2)
        position = handle.tell()
        while position > 0:
            read_size = min(chunk_size, position)
            position -= read_size
            handle.seek(position)
            chunk = handle.read(read_size)
            index = chunk.rfind(target)
            if index >= 0:
                return position + index
    return None


def previous_non_whitespace_byte(path: Path, index: int) -> int | None:
    if index <= 0:
        return None
    with path.open("rb") as handle:
        position = index - 1
        while position >= 0:
            handle.seek(position)
            byte = handle.read(1)
            if byte not in {b" ", b"\n", b"\r", b"\t"}:
                return position
            position -= 1
    return None


def read_one_byte(path: Path, index: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(index)
        return handle.read(1)


def temperature_samples_from_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    for event in events or []:
        event_time = event_time_seconds(event)
        if event_time is None:
            continue
        samples.extend(planned_temperature_routine_samples(event, event_time))
        for root in event_payload_roots(event):
            direct = direct_temperature_sample(root, event, event_time)
            if direct:
                samples.append(direct)
            samples.extend(generic_temperature_sample_list(root, event, event_time))
            samples.extend(routine_temperature_samples(root, event, event_time))
    return compact_temperature_history_samples(samples)


def planned_temperature_routine_samples(event: dict[str, Any], event_time: float) -> list[dict[str, Any]]:
    if str(event.get("type") or "") != "mcp_tool_call":
        return []
    tool = str(event.get("tool") or "")
    if tool not in {"start_temperature_routine", "start_melting_curve_capture"}:
        return []
    steps = get_path(event, "arguments.steps")
    if not isinstance(steps, list) and tool == "start_melting_curve_capture":
        steps = get_path(event, "arguments.temperature_steps")
    if not isinstance(steps, list) and tool == "start_melting_curve_capture":
        steps = melting_curve_steps_from_arguments(event.get("arguments") or {})
    if not isinstance(steps, list):
        return []
    cursor = event_time
    samples = []
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        target = first_number(
            step.get("target_c"),
            step.get("target_temperature"),
            step.get("target"),
            step.get("tarjet_c"),
            step.get("tarjet_temperature"),
            step.get("tarjet"),
        )
        if target is not None:
            samples.append({
                "t": cursor,
                "target_c": target,
                "source": "routine_plan",
                "ts": event.get("ts"),
                "step_index": index,
            })
        hold = first_number(step.get("hold_seconds"), step.get("duration_seconds"), step.get("seconds"))
        if hold is not None and hold > 0:
            cursor += hold
    return samples


def melting_curve_steps_from_arguments(arguments: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(arguments, dict):
        return []
    start = first_number(arguments.get("start_c"), arguments.get("start"), arguments.get("from_c"))
    end = first_number(arguments.get("end_c"), arguments.get("end"), arguments.get("to_c"))
    step = first_number(arguments.get("step_c"), arguments.get("step"), arguments.get("increment_c"))
    hold = first_number(arguments.get("hold_seconds"), arguments.get("duration_seconds"), arguments.get("hold"))
    if start is None or end is None:
        return []
    step = abs(step if step is not None else 0.5)
    if step <= 0:
        return []
    hold = hold if hold is not None else 0
    direction = 1 if end >= start else -1
    current = start
    values: list[float] = []
    epsilon = step / 1000
    for _ in range(10000):
        if direction > 0 and current > end + epsilon:
            break
        if direction < 0 and current < end - epsilon:
            break
        values.append(round(current, 6))
        current += direction * step
    if values and abs(values[-1] - end) > epsilon:
        values.append(round(end, 6))
    return [{"target_c": value, "hold_seconds": hold} for value in values]


def routine_temperature_samples(root: Any, event: dict[str, Any], event_time: float) -> list[dict[str, Any]]:
    if not isinstance(root, dict):
        return []
    samples: list[dict[str, Any]] = []
    started_at = first_number(get_path(root, "started_at"), get_path(root, "routine.started_at"))
    results = get_path(root, "results")
    cursor = started_at if started_at is not None else None
    if isinstance(results, list):
        for index, result in enumerate(results):
            if not isinstance(result, dict):
                continue
            step_samples = result.get("samples") if isinstance(result.get("samples"), list) else []
            max_elapsed = max_temperature_sample_elapsed(step_samples)
            step_start = cursor if cursor is not None else event_time - max_elapsed
            target = first_number(
                result.get("target_c"),
                result.get("target_temperature"),
                result.get("target"),
                get_path(result, "set_result.actual_value"),
            )
            if target is not None:
                samples.append({
                    "t": step_start,
                    "target_c": target,
                    "source": "temperature_routine",
                    "ts": event.get("ts"),
                    "step_index": first_number(result.get("index"), index),
                })
            for step_sample in step_samples:
                if not isinstance(step_sample, dict):
                    continue
                measured = first_number(
                    step_sample.get("temperature_c"),
                    step_sample.get("temperature"),
                    step_sample.get("current_temperature"),
                    step_sample.get("current"),
                    step_sample.get("value"),
                )
                if not is_valid_temperature(measured):
                    continue
                elapsed = first_number(step_sample.get("elapsed_seconds"), step_sample.get("elapsed"), step_sample.get("time_seconds"))
                samples.append({
                    "t": step_start + elapsed if elapsed is not None else event_time,
                    "measured_c": measured,
                    "target_c": target,
                    "source": "temperature_routine",
                    "ts": event.get("ts"),
                })
            if cursor is not None:
                hold = first_number(result.get("hold_seconds"), result.get("duration_seconds"), 0) or 0
                cursor += max(max_elapsed, hold)

    active_step = get_path(root, "active_step")
    last_sample = get_path(root, "last_sample")
    if isinstance(active_step, dict):
        target = first_number(active_step.get("target_c"), active_step.get("target_temperature"), active_step.get("target"))
        elapsed = first_number(get_path(root, "last_sample.elapsed_seconds"), get_path(root, "last_sample.elapsed"), 0) or 0
        if target is not None:
            samples.append({
                "t": event_time - elapsed,
                "target_c": target,
                "source": "temperature_routine",
                "ts": event.get("ts"),
                "step_index": active_step.get("index"),
            })
        if isinstance(last_sample, dict):
            measured = first_number(
                last_sample.get("temperature_c"),
                last_sample.get("temperature"),
                last_sample.get("current_temperature"),
                last_sample.get("current"),
                last_sample.get("value"),
            )
            if is_valid_temperature(measured):
                samples.append({
                    "t": event_time,
                    "measured_c": measured,
                    "target_c": target,
                    "source": "temperature_routine",
                    "ts": event.get("ts"),
                })
    return samples


def generic_temperature_sample_list(root: Any, event: dict[str, Any], event_time: float) -> list[dict[str, Any]]:
    if not isinstance(root, dict):
        return []
    raw_samples = root.get("samples") or root.get("temperature_samples")
    if not isinstance(raw_samples, list) or not raw_samples:
        return []
    elapsed_values = [
        elapsed
        for sample in raw_samples
        if isinstance(sample, dict)
        for elapsed in [first_number(sample.get("elapsed_seconds"), sample.get("elapsed"), sample.get("time_seconds"))]
        if elapsed is not None
    ]
    start_time = event_time - max(elapsed_values) if elapsed_values else event_time
    samples: list[dict[str, Any]] = []
    for sample in raw_samples:
        if not isinstance(sample, dict):
            continue
        measured = first_number(
            sample.get("temperature_c"),
            sample.get("temperature"),
            sample.get("current_temperature"),
            sample.get("current"),
            sample.get("value"),
        )
        if not is_valid_temperature(measured):
            continue
        elapsed = first_number(sample.get("elapsed_seconds"), sample.get("elapsed"), sample.get("time_seconds"))
        samples.append({
            "t": start_time + elapsed if elapsed is not None else event_time,
            "measured_c": measured,
            "source": "event_samples",
            "ts": event.get("ts"),
        })
    return samples


def direct_temperature_sample(root: Any, event: dict[str, Any], event_time: float) -> dict[str, Any] | None:
    if not isinstance(root, dict):
        return None
    measured = first_number(
        get_path(root, "temperature.current"),
        get_path(root, "temperature.current_c"),
        get_path(root, "temperature.value"),
        get_path(root, "temperature.temperature"),
        get_path(root, "temperature.current_temperature"),
        root.get("current_temperature"),
        root.get("measured_temperature"),
        root.get("temperature_c"),
        root.get("measured_c"),
        root.get("current_c"),
        root.get("current"),
    )
    target = first_number(
        get_path(root, "temperature.target"),
        get_path(root, "temperature.tarjet"),
        get_path(root, "temperature.target_c"),
        get_path(root, "temperature.tarjet_c"),
        get_path(root, "temperature.target_temperature"),
        get_path(root, "temperature.tarjet_temperature"),
        get_path(root, "temperature.setpoint"),
        get_path(root, "temperature.setpoint_c"),
        root.get("target_c"),
        root.get("tarjet_c"),
        root.get("target_temperature"),
        root.get("tarjet_temperature"),
        root.get("target"),
        root.get("tarjet"),
        root.get("setpoint"),
    )
    if not is_valid_temperature(measured) and not is_valid_temperature_target(target):
        return None
    sample: dict[str, Any] = {
        "t": event_time,
        "source": str(root.get("source") or event.get("tool") or event.get("type") or "event"),
        "ts": event.get("ts"),
    }
    if is_valid_temperature(measured):
        sample["measured_c"] = measured
    if target is not None:
        sample["target_c"] = target
    return sample


def max_temperature_sample_elapsed(samples: Any) -> float:
    if not isinstance(samples, list):
        return 0.0
    values = [
        elapsed
        for sample in samples
        if isinstance(sample, dict)
        for elapsed in [first_number(sample.get("elapsed_seconds"), sample.get("elapsed"), sample.get("time_seconds"))]
        if elapsed is not None
    ]
    return max(values) if values else 0.0


def event_payload_roots(event: dict[str, Any]) -> list[Any]:
    roots: list[Any] = []

    def push(value: Any) -> None:
        if isinstance(value, dict):
            roots.append(value)

    push(event)
    push(event.get("arguments"))
    result = event.get("result")
    push(result)
    push(get_path(result, "structuredContent"))
    push(get_path(result, "structuredContent.result"))
    push(get_path(result, "result"))
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            push(part.get("structuredContent"))
            parsed = parse_json_maybe(part.get("text"))
            push(parsed)
    return roots


def event_time_seconds(event: dict[str, Any]) -> float | None:
    value = number_or_none(event.get("t"))
    if value is not None:
        return value
    text = event.get("ts")
    if not text:
        return None
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def parse_json_maybe(text: Any) -> Any:
    if not isinstance(text, str):
        return None
    value = text.strip()
    if not value or value[0] not in "[{" or len(value) > 200000:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def get_path(root: Any, path: str) -> Any:
    current = root
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def normalize_temperature_sample(sample: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(sample, dict):
        return None
    t = number_or_none(sample.get("t"))
    if t is None:
        return None
    measured = first_number(
        sample.get("measured_c"),
        sample.get("temperature_c"),
        sample.get("current_c"),
        sample.get("current"),
    )
    target = first_number(
        sample.get("target_c"),
        sample.get("tarjet_c"),
        sample.get("target_temperature"),
        sample.get("tarjet_temperature"),
    )
    if not is_valid_temperature(measured) and not is_valid_temperature_target(target):
        return None
    normalized: dict[str, Any] = {"t": round(t, 3)}
    if sample.get("ts"):
        normalized["ts"] = str(sample.get("ts"))
    if is_valid_temperature(measured):
        normalized["measured_c"] = round(float(measured), 4)
    if is_valid_temperature_target(target):
        normalized["target_c"] = round(float(target), 4)
    source = str(sample.get("source") or "").strip()
    if source:
        normalized["source"] = source[:64]
    state_updated_at = str(sample.get("state_updated_at") or "").strip()
    if state_updated_at:
        normalized["state_updated_at"] = state_updated_at
    return normalized


def compact_temperature_history_samples(samples: list[Any]) -> list[dict[str, Any]]:
    normalized = [item for item in (normalize_temperature_sample(sample) for sample in samples) if item]
    normalized.sort(key=lambda item: float(item["t"]))
    compacted: list[dict[str, Any]] = []
    last_key: tuple[int, str, str] | None = None
    for sample in normalized:
        measured = sample.get("measured_c")
        target = sample.get("target_c")
        key = (
            int(round(float(sample["t"]) * 1000)),
            "" if measured is None else f"{float(measured):.4f}",
            "" if target is None else f"{float(target):.4f}",
        )
        if key == last_key:
            continue
        last_key = key
        compacted.append(sample)
    return compacted


def simplify_temperature_samples(samples: list[dict[str, Any]], max_samples: int) -> list[dict[str, Any]]:
    compacted = compact_temperature_history_samples(samples)
    max_samples = max(10, int(max_samples))
    if len(compacted) <= max_samples:
        return compacted

    keep_recent = min(2500, max(200, max_samples // 8))
    recent = compacted[-keep_recent:]
    older = compacted[:-keep_recent]
    target_changes = temperature_target_change_samples(older)
    target_keys = {temperature_sample_key(sample) for sample in target_changes}
    available = max(100, max_samples - len(recent) - len(target_changes))
    bucket_count = max(1, available // 3)
    measured = bucket_extrema_samples(
        [sample for sample in older if temperature_sample_key(sample) not in target_keys],
        bucket_count,
    )
    merged = compact_temperature_history_samples([*target_changes, *measured, *recent])
    if len(merged) <= max_samples:
        return merged
    return compact_temperature_history_samples([merged[0], *evenly_spaced_samples(merged[1:-1], max_samples - 2), merged[-1]])


def temperature_target_change_samples(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    last: float | None = None
    for sample in samples:
        target = number_or_none(sample.get("target_c"))
        if not is_valid_temperature_target(target):
            continue
        if last is None or abs(target - last) > 0.02:
            changes.append(sample)
            last = target
    return changes


def bucket_extrema_samples(samples: list[dict[str, Any]], bucket_count: int) -> list[dict[str, Any]]:
    if not samples or bucket_count <= 0:
        return []
    if len(samples) <= bucket_count * 3:
        return samples
    start = float(samples[0]["t"])
    end = float(samples[-1]["t"])
    duration = max(0.001, end - start)
    buckets: list[list[dict[str, Any]]] = [[] for _ in range(bucket_count)]
    for sample in samples:
        index = min(bucket_count - 1, int(((float(sample["t"]) - start) / duration) * bucket_count))
        buckets[index].append(sample)
    result: list[dict[str, Any]] = []
    for bucket in buckets:
        if not bucket:
            continue
        measured = [sample for sample in bucket if number_or_none(sample.get("measured_c")) is not None]
        if not measured:
            result.append(bucket[0])
            continue
        choices = [
            measured[0],
            min(measured, key=lambda item: float(item.get("measured_c"))),
            max(measured, key=lambda item: float(item.get("measured_c"))),
            measured[-1],
        ]
        result.extend(compact_temperature_history_samples(choices))
    return result


def evenly_spaced_samples(samples: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    if count <= 0:
        return []
    if len(samples) <= count:
        return samples
    if count == 1:
        return [samples[len(samples) // 2]]
    last = len(samples) - 1
    return [samples[round(index * last / (count - 1))] for index in range(count)]


def target_temperature_sample_count(samples: list[dict[str, Any]], encoded_size: int) -> int:
    if not samples or encoded_size <= 0:
        return 1000
    bytes_per_sample = max(1.0, encoded_size / max(1, len(samples)))
    return max(1000, int(TEMPERATURE_HISTORY_TARGET_BYTES / bytes_per_sample))


def temperature_sample_key(sample: dict[str, Any]) -> tuple[int, str, str]:
    measured = sample.get("measured_c")
    target = sample.get("target_c")
    return (
        int(round(float(sample.get("t") or 0) * 1000)),
        "" if measured is None else f"{float(measured):.4f}",
        "" if target is None else f"{float(target):.4f}",
    )


def encode_json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"), default=str).encode("utf-8")


def first_number(*values: Any) -> float | None:
    for value in values:
        number = number_or_none(value)
        if number is not None:
            return number
    return None


def number_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def is_valid_temperature(value: Any) -> bool:
    number = number_or_none(value)
    if number is None:
        return False
    if is_missing_temperature_sentinel(number):
        return False
    return -50 < number < 180


def is_valid_temperature_target(value: Any) -> bool:
    number = number_or_none(value)
    if number is None:
        return False
    if is_missing_temperature_sentinel(number):
        return False
    return -50 < number < 180


def is_missing_temperature_sentinel(value: Any) -> bool:
    number = number_or_none(value)
    if number is None:
        return False
    return abs(number) < 1e-9 or abs(number + 1) < 1e-9
