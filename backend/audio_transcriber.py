from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class AudioTranscript:
    text: str
    language: str | None = None
    duration_seconds: float | None = None
    engine: str | None = None
    model: str | None = None
    elapsed_seconds: float | None = None


class LocalAudioTranscriber:
    """Lazy local speech-to-text wrapper.

    The dashboard keeps browser capture separate from model inference so the
    recognizer can later grow wake-word/name detection without changing the UI.
    """

    def __init__(
        self,
        *,
        engine: str = "faster_whisper",
        model: str = "large-v3",
        device: str = "auto",
        compute_type: str = "int8",
        language: str | None = None,
        vad_filter: bool = True,
        beam_size: int = 5,
        best_of: int = 5,
        temperature: float = 0.0,
        condition_on_previous_text: bool = False,
        initial_prompt: str | None = None,
        hotwords: str | None = None,
    ) -> None:
        self.engine = (engine or "faster_whisper").strip().lower()
        self.model = model or "large-v3"
        self.device = device or "auto"
        self.compute_type = compute_type or "int8"
        self.language = language or None
        self.vad_filter = bool(vad_filter)
        self.beam_size = int(beam_size or 5)
        self.best_of = int(best_of or 5)
        self.temperature = float(temperature)
        self.condition_on_previous_text = bool(condition_on_previous_text)
        self.initial_prompt = initial_prompt or None
        self.hotwords = hotwords or None
        self._model: Any = None

    def transcribe(self, path: str | Path) -> AudioTranscript:
        audio_path = Path(path)
        if not audio_path.is_file():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        if self.engine in {"faster_whisper", "faster-whisper", "ctranslate2"}:
            return self._transcribe_faster_whisper(audio_path)
        if self.engine in {"whisper", "openai_whisper", "openai-whisper"}:
            return self._transcribe_openai_whisper(audio_path)
        raise RuntimeError(
            f"Unsupported speech engine '{self.engine}'. "
            "Use 'faster_whisper' or 'whisper'."
        )

    def _transcribe_faster_whisper(self, audio_path: Path) -> AudioTranscript:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "Local audio transcription needs faster-whisper. Install with: "
                "py -3.13 -m pip install faster-whisper"
            ) from exc

        if self._model is None:
            kwargs: dict[str, Any] = {}
            if self.device != "auto":
                kwargs["device"] = self.device
            if self.compute_type != "auto":
                kwargs["compute_type"] = self.compute_type
            self._model = WhisperModel(self.model, **kwargs)

        start = time.perf_counter()
        segments, info = self._model.transcribe(
            str(audio_path),
            language=self.language,
            vad_filter=self.vad_filter,
            beam_size=self.beam_size,
            best_of=self.best_of,
            temperature=self.temperature,
            condition_on_previous_text=self.condition_on_previous_text,
            initial_prompt=self.initial_prompt,
            hotwords=self.hotwords,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        return AudioTranscript(
            text=text,
            language=getattr(info, "language", None),
            duration_seconds=float(getattr(info, "duration", 0.0) or 0.0),
            engine="faster_whisper",
            model=self.model,
            elapsed_seconds=time.perf_counter() - start,
        )

    def _transcribe_openai_whisper(self, audio_path: Path) -> AudioTranscript:
        try:
            import whisper
        except ImportError as exc:
            raise RuntimeError(
                "Local audio transcription needs openai-whisper. Install with: "
                "py -3.13 -m pip install openai-whisper"
            ) from exc

        if self._model is None:
            self._model = whisper.load_model(self.model)

        start = time.perf_counter()
        result = self._model.transcribe(str(audio_path), language=self.language)
        return AudioTranscript(
            text=str(result.get("text") or "").strip(),
            language=result.get("language"),
            duration_seconds=None,
            engine="whisper",
            model=self.model,
            elapsed_seconds=time.perf_counter() - start,
        )
