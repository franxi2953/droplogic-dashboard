from __future__ import annotations

import asyncio
import base64
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .audio_transcriber import LocalAudioTranscriber
from .runtime_utils import audio_suffix_for_mime, websocket_closed_ok


class AudioHandlersMixin:
    async def handle_transcribe_audio(self, websocket: Any, message: dict[str, Any]) -> None:
        if not self.config.speech.enabled:
            raise RuntimeError("Speech transcription is disabled.")

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
        )
        await websocket.send(json.dumps({"type": "audio_transcription", "busy": True, "event": started}))

        try:
            transcript = await asyncio.to_thread(self.transcribe_audio_file, audio_path)
            event = await self.record(
                "audio_transcript",
                text=transcript.text,
                language=transcript.language,
                duration_seconds=transcript.duration_seconds,
                elapsed_seconds=transcript.elapsed_seconds,
                engine=transcript.engine,
                model=transcript.model,
                artifact=str(audio_path.relative_to(self.recorder.run_dir)),
            )
            payload = {
                "type": "audio_transcription",
                "busy": False,
                "ok": True,
                "event": event,
                "text": transcript.text,
                "language": transcript.language,
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
            )
            payload = {
                "type": "audio_transcription",
                "busy": False,
                "ok": False,
                "event": event,
                "error": str(exc),
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

    def transcribe_audio_file(self, audio_path: Path):
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
        return self._audio_transcriber.transcribe(audio_path)
