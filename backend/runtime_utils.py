from __future__ import annotations


def audio_suffix_for_mime(mime_type: str) -> str:
    clean = mime_type.split(";", 1)[0].strip().lower()
    mapping = {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/opus": ".opus",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
    }
    return mapping.get(clean, ".webm")


def safe_filename(value: str) -> str:
    cleaned = []
    for char in str(value or ""):
        if char.isalnum() or char in {"-", "_"}:
            cleaned.append(char)
        else:
            cleaned.append("_")
    text = "".join(cleaned).strip("_")
    return text[:64] or "item"


def websocket_closed_ok(exc: Exception) -> bool:
    text = str(exc)
    return (
        "received 1000 (OK)" in text
        or "sent 1000 (OK)" in text
        or "going away" in text
        or "keepalive ping timeout" in text
        or "no close frame received" in text
    )
