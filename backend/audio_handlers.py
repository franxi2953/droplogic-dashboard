from __future__ import annotations

import asyncio
import base64
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .audio_transcriber import LocalAudioTranscriber
from .runtime_utils import audio_suffix_for_mime, websocket_closed_ok


class AudioHandlersMixin:
    def audio_model_loaded(self) -> bool:
        transcriber = getattr(self, "_audio_transcriber", None)
        return bool(transcriber is not None and getattr(transcriber, "_model", None) is not None)

    def audio_model_loading(self) -> bool:
        task = getattr(self, "_audio_preload_task", None)
        return bool(task is not None and not task.done())

    def audio_model_state(self) -> dict[str, Any]:
        return {
            "loaded": self.audio_model_loaded(),
            "loading": self.audio_model_loading(),
        }

    async def handle_load_audio_model(self, websocket: Any, message: dict[str, Any]) -> None:
        if not self.config.speech.enabled:
            raise RuntimeError("Speech transcription is disabled.")

        await websocket.send(
            json.dumps(
                {
                    "type": "audio_model_load",
                    "busy": True,
                    "status": self.audio_model_state(),
                },
                ensure_ascii=True,
            )
        )

        result: dict[str, Any] = {"ok": True, "cached": self.audio_model_loaded()}
        if not self.audio_model_loaded():
            task = getattr(self, "_audio_preload_task", None)
            if task is None or task.done():
                task = asyncio.create_task(self.preload_audio_transcriber_background(source="manual_load"))
                self._audio_preload_task = task
            try:
                result = await task
            except asyncio.CancelledError:
                result = {"ok": False, "error": "audio_model_load_cancelled"}

        loaded = self.audio_model_loaded()
        payload = {
            "type": "audio_model_load",
            "busy": False,
            "ok": bool(loaded and result.get("ok", True)),
            "status": self.audio_model_state(),
        }
        if result.get("error"):
            payload["error"] = str(result.get("error"))
        await websocket.send(json.dumps(payload, ensure_ascii=True))
        await websocket.send(json.dumps({"type": "status", "status": self.status()}, ensure_ascii=True))

    async def handle_transcribe_audio(self, websocket: Any, message: dict[str, Any]) -> None:
        source = str(message.get("source") or "manual").strip() or "manual"
        if not self.config.speech.enabled:
            await self.reject_audio_transcription(websocket, "Speech transcription is disabled.", source)
            return
        if not self.audio_model_loaded():
            await self.reject_audio_transcription(websocket, "Audio model is not loaded. Click Load Audio before recording.", source)
            return

        audio_b64 = str(message.get("audio_base64") or "")
        if not audio_b64:
            raise ValueError("No audio payload received.")
        if "," in audio_b64 and audio_b64.lstrip().startswith("data:"):
            audio_b64 = audio_b64.split(",", 1)[1]

        try:
            audio_bytes = base64.b64decode(audio_b64, validate=True)
        except Exception as exc:
            raise ValueError("Invalid base64 audio payload.") from exc

        max_bytes = int(self.config.speech.max_audio_bytes)
        if len(audio_bytes) > max_bytes:
            raise ValueError(f"Audio payload is too large ({len(audio_bytes)} bytes > {max_bytes} bytes).")

        mime_type = str(message.get("mime_type") or "audio/webm")
        duration_ms = int(float(message.get("duration_ms") or 0))
        max_duration_ms = int(self.config.speech.max_audio_seconds) * 1000
        if duration_ms > max_duration_ms:
            raise ValueError(
                f"Audio recording is too long ({duration_ms / 1000:.1f}s > "
                f"{self.config.speech.max_audio_seconds}s)."
            )
        suffix = audio_suffix_for_mime(mime_type)
        audio_dir = self.recorder.run_dir / "artifacts" / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_path = audio_dir / f"voice_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{suffix}"
        audio_path.write_bytes(audio_bytes)

        started = await self.record(
            "audio_transcription_started",
            mime_type=mime_type,
            audio_bytes=len(audio_bytes),
            artifact=str(audio_path.relative_to(self.recorder.run_dir)),
            engine=self.config.speech.engine,
            model=self.config.speech.model,
            source=source,
        )
        await websocket.send(json.dumps({"type": "audio_transcription", "busy": True, "event": started, "source": source}))

        try:
            transcript = await asyncio.to_thread(self.transcribe_audio_file, audio_path)
            event = await self.record(
                "audio_transcript",
                text=transcript.text,
                language=transcript.language,
                duration_seconds=transcript.duration_seconds,
                elapsed_seconds=transcript.elapsed_seconds,
                load_seconds=transcript.load_seconds,
                inference_seconds=transcript.inference_seconds,
                engine=transcript.engine,
                model=transcript.model,
                artifact=str(audio_path.relative_to(self.recorder.run_dir)),
                source=source,
            )
            payload = {
                "type": "audio_transcription",
                "busy": False,
                "ok": True,
                "event": event,
                "text": transcript.text,
                "language": transcript.language,
                "duration_seconds": transcript.duration_seconds,
                "elapsed_seconds": transcript.elapsed_seconds,
                "load_seconds": transcript.load_seconds,
                "inference_seconds": transcript.inference_seconds,
                "source": source,
            }
            try:
                await websocket.send(json.dumps(payload, ensure_ascii=True))
            except Exception as send_exc:
                if not websocket_closed_ok(send_exc):
                    await self.record(
                        "ui_error",
                        level="warning",
                        message=f"Audio transcript was created but could not be sent to this browser socket: {send_exc}",
                    )
        except Exception as exc:
            event = await self.record(
                "audio_transcription_error",
                level="error",
                message=str(exc),
                engine=self.config.speech.engine,
                model=self.config.speech.model,
                artifact=str(audio_path.relative_to(self.recorder.run_dir)),
                source=source,
            )
            payload = {
                "type": "audio_transcription",
                "busy": False,
                "ok": False,
                "event": event,
                "error": str(exc),
                "source": source,
            }
            try:
                await websocket.send(json.dumps(payload, ensure_ascii=True))
            except Exception as send_exc:
                if not websocket_closed_ok(send_exc):
                    await self.record(
                        "ui_error",
                        level="warning",
                        message=f"Audio transcription error could not be sent to this browser socket: {send_exc}",
                    )

    async def reject_audio_transcription(self, websocket: Any, message: str, source: str) -> None:
        event = await self.record(
            "audio_transcription_error",
            level="error",
            message=message,
            engine=self.config.speech.engine,
            model=self.config.speech.model,
            source=source,
        )
        await websocket.send(
            json.dumps(
                {
                    "type": "audio_transcription",
                    "busy": False,
                    "ok": False,
                    "event": event,
                    "error": message,
                    "source": source,
                },
                ensure_ascii=True,
            )
        )

    def transcribe_audio_file(self, audio_path: Path):
        return self.audio_transcriber().transcribe(audio_path)

    def preload_audio_model(self) -> dict[str, Any]:
        return self.audio_transcriber().preload()

    def audio_transcriber(self) -> LocalAudioTranscriber:
        lock = getattr(self, "_audio_transcriber_lock", None)
        if lock is None:
            lock = threading.Lock()
            self._audio_transcriber_lock = lock
        with lock:
            if self._audio_transcriber is None:
                self._audio_transcriber = LocalAudioTranscriber(
                    engine=self.config.speech.engine,
                    model=self.config.speech.model,
                    device=self.config.speech.device,
                    compute_type=self.config.speech.compute_type,
                    language=self.config.speech.language,
                    vad_filter=self.config.speech.vad_filter,
                    beam_size=self.config.speech.beam_size,
                    best_of=self.config.speech.best_of,
                    temperature=self.config.speech.temperature,
                    condition_on_previous_text=self.config.speech.condition_on_previous_text,
                    initial_prompt=self.config.speech.initial_prompt,
                    hotwords=self.config.speech.hotwords,
                )
            return self._audio_transcriber

    async def preload_audio_transcriber_background(self, source: str = "startup") -> dict[str, Any]:
        if not self.config.speech.enabled:
            return {"ok": False, "error": "speech_disabled"}
        await self.record(
            "audio_model_preload_started",
            engine=self.config.speech.engine,
            model=self.config.speech.model,
            device=self.config.speech.device,
            compute_type=self.config.speech.compute_type,
            source=source,
        )
        try:
            info = await asyncio.to_thread(self.preload_audio_model)
            await self.record(
                "audio_model_preloaded",
                engine=info.get("engine"),
                model=info.get("model"),
                cached=info.get("cached"),
                load_seconds=info.get("load_seconds"),
                elapsed_seconds=info.get("elapsed_seconds"),
                source=source,
            )
            return {"ok": True, **info}
        except Exception as exc:
            await self.record(
                "audio_model_preload_error",
                level="warning",
                message=str(exc),
                engine=self.config.speech.engine,
                model=self.config.speech.model,
                source=source,
            )
            return {"ok": False, "error": str(exc)}
