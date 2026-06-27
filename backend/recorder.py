from __future__ import annotations

import json
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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
        events = []
        if events_path.exists():
            lines = events_path.read_text(encoding="utf-8").splitlines()
            for line in lines:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        preview = ""
        for event in reversed(events):
            if event.get("type") == "agent_prompt":
                preview = str(event.get("prompt") or "")
                break
            if event.get("type") == "agent_response":
                preview = str(event.get("text") or event.get("error") or "")
                break
        preview = clean_preview(preview)
        return {
            "run_id": run_id,
            "name": str(metadata.get("name") or ""),
            "active": run_id == self.run_id,
            "created_at": metadata.get("created_at"),
            "event_count": count_lines(events_path),
            "last_event_at": events[-1].get("ts") if events else metadata.get("created_at"),
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
