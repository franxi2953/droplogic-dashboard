from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import statistics
import time
import urllib.request
from pathlib import Path
from typing import Any

import websockets


def frame_payload(data: dict[str, Any]) -> dict[str, Any] | None:
    msg_type = data.get("type")
    if msg_type == "live":
        frame = ((data.get("live") or {}).get("frames") or {}).get("streamer")
    elif msg_type == "live_frame" and data.get("visualizer") == "streamer":
        frame = data.get("frame")
    else:
        return None
    if not isinstance(frame, dict):
        return None
    payload = frame.get("result") if isinstance(frame.get("result"), dict) else frame
    return payload if isinstance(payload, dict) and payload.get("base64") else None


async def run_benchmark(url: str, seconds: float) -> None:
    counts: dict[str, int] = {}
    bytes_by_type: dict[str, int] = {}
    streamer_frames = 0
    frame_bytes = 0
    gaps: list[float] = []
    last_frame_at: float | None = None
    started = time.perf_counter()

    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"type": "get_status"}))
        deadline = time.perf_counter() + seconds
        while time.perf_counter() < deadline:
            timeout = max(0.01, deadline - time.perf_counter())
            try:
                message = await asyncio.wait_for(ws.recv(), timeout=timeout)
            except asyncio.TimeoutError:
                break

            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                data = {"type": "invalid"}
            msg_type = str(data.get("type") or "?")
            counts[msg_type] = counts.get(msg_type, 0) + 1
            bytes_by_type[msg_type] = bytes_by_type.get(msg_type, 0) + len(message)

            frame = frame_payload(data)
            if frame is None:
                continue
            now = time.perf_counter()
            if last_frame_at is not None:
                gaps.append(now - last_frame_at)
            last_frame_at = now
            streamer_frames += 1
            frame_bytes += len(str(frame.get("base64") or ""))

    elapsed = max(0.001, time.perf_counter() - started)
    print(f"elapsed_seconds={elapsed:.2f}")
    print(f"streamer_frames={streamer_frames}")
    print(f"streamer_fps={streamer_frames / elapsed:.2f}")
    if gaps:
        print(f"gap_median_seconds={statistics.median(gaps):.3f}")
        print(f"gap_min_seconds={min(gaps):.3f}")
        print(f"gap_max_seconds={max(gaps):.3f}")
    if streamer_frames:
        print(f"avg_streamer_base64_bytes={int(frame_bytes / streamer_frames)}")
    print("message_counts=" + json.dumps(counts, sort_keys=True))
    avg_bytes = {
        key: int(bytes_by_type[key] / max(1, counts.get(key, 1)))
        for key in sorted(bytes_by_type)
    }
    print("avg_message_bytes=" + json.dumps(avg_bytes, sort_keys=True))


def run_mjpeg_benchmark(url: str, seconds: float) -> None:
    started = time.perf_counter()
    deadline = started + seconds
    frames = 0
    unique_frames = 0
    frame_bytes = 0
    gaps: list[float] = []
    unique_gaps: list[float] = []
    frame_age_ms: list[float] = []
    sequences: list[int] = []
    sources: dict[str, int] = {}
    last_frame_at: float | None = None
    last_unique_at: float | None = None
    last_digest = ""
    duplicate_frames = 0
    buffer = b""
    boundary = b"--frame"

    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=max(3.0, seconds + 2.0)) as response:
        while time.perf_counter() < deadline:
            chunk = response.read(65536)
            if not chunk:
                break
            buffer += chunk
            while True:
                start = buffer.find(b"\xff\xd8")
                end = buffer.find(b"\xff\xd9", start + 2) if start >= 0 else -1
                if start < 0 or end < 0:
                    if len(buffer) > 2_000_000:
                        marker = buffer.rfind(boundary)
                        buffer = buffer[marker:] if marker >= 0 else buffer[-65536:]
                    break
                header_start = buffer.rfind(boundary, 0, start)
                headers = buffer[header_start:start] if header_start >= 0 else b""
                image = buffer[start:end + 2]
                buffer = buffer[end + 2:]
                now = time.perf_counter()
                if last_frame_at is not None:
                    gaps.append(now - last_frame_at)
                last_frame_at = now
                frames += 1
                frame_bytes += len(image)
                age = header_float(headers, b"x-droplogic-frame-age-ms")
                if age is not None:
                    frame_age_ms.append(age)
                sequence = header_int(headers, b"x-droplogic-frame-sequence")
                if sequence is not None:
                    sequences.append(sequence)
                source = header_value(headers, b"x-droplogic-frame-source")
                if source:
                    sources[source] = sources.get(source, 0) + 1
                digest = hashlib.blake2b(image, digest_size=8).hexdigest()
                if digest == last_digest:
                    duplicate_frames += 1
                else:
                    if last_unique_at is not None:
                        unique_gaps.append(now - last_unique_at)
                    last_unique_at = now
                    last_digest = digest
                    unique_frames += 1
                if now >= deadline:
                    break

    elapsed = max(0.001, time.perf_counter() - started)
    print(f"elapsed_seconds={elapsed:.2f}")
    print(f"mjpeg_frames={frames}")
    print(f"mjpeg_fps={frames / elapsed:.2f}")
    print(f"unique_frames={unique_frames}")
    print(f"unique_fps={unique_frames / elapsed:.2f}")
    print(f"duplicate_frames={duplicate_frames}")
    if gaps:
        print(f"gap_median_seconds={statistics.median(gaps):.3f}")
        print(f"gap_min_seconds={min(gaps):.3f}")
        print(f"gap_max_seconds={max(gaps):.3f}")
    if unique_gaps:
        print(f"unique_gap_median_seconds={statistics.median(unique_gaps):.3f}")
        print(f"unique_gap_min_seconds={min(unique_gaps):.3f}")
        print(f"unique_gap_max_seconds={max(unique_gaps):.3f}")
    if frame_age_ms:
        print(f"frame_age_median_ms={statistics.median(frame_age_ms):.1f}")
        print(f"frame_age_min_ms={min(frame_age_ms):.1f}")
        print(f"frame_age_max_ms={max(frame_age_ms):.1f}")
    if sequences:
        print(f"sequence_min={min(sequences)}")
        print(f"sequence_max={max(sequences)}")
        print(f"sequence_unique={len(set(sequences))}")
    if sources:
        print("frame_sources=" + json.dumps(sources, sort_keys=True))
    if frames:
        print(f"avg_jpeg_bytes={int(frame_bytes / frames)}")


def header_float(headers: bytes, name: bytes) -> float | None:
    raw = header_value(headers, name)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def header_int(headers: bytes, name: bytes) -> int | None:
    raw = header_value(headers, name)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def header_value(headers: bytes, name: bytes) -> str | None:
    prefix = name.lower() + b":"
    for line in headers.splitlines():
        if line.lower().startswith(prefix):
            return line.split(b":", 1)[1].strip().decode("ascii", errors="ignore")
    return None


def load_run_events(run_dir: str) -> list[dict[str, Any]]:
    path = Path(run_dir)
    events_path = path if path.is_file() else path / "events.jsonl"
    if not events_path.exists():
        raise FileNotFoundError(f"Event log not found: {events_path}")
    events: list[dict[str, Any]] = []
    for line in events_path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def numeric(values: list[Any]) -> list[float]:
    result: list[float] = []
    for value in values:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number == number:
            result.append(number)
    return result


def print_stats(prefix: str, values: list[Any], digits: int = 3) -> None:
    numbers = numeric(values)
    if not numbers:
        return
    print(f"{prefix}_count={len(numbers)}")
    print(f"{prefix}_min={min(numbers):.{digits}f}")
    print(f"{prefix}_median={statistics.median(numbers):.{digits}f}")
    print(f"{prefix}_max={max(numbers):.{digits}f}")


def context_label_chars(event: dict[str, Any], label: str) -> int | None:
    for item in event.get("context_breakdown") or []:
        if isinstance(item, dict) and item.get("label") == label:
            try:
                return int(item.get("chars"))
            except (TypeError, ValueError):
                return None
    return None


def summarize_run_events(run_dir: str) -> None:
    events = load_run_events(run_dir)
    print(f"run_events={len(events)}")
    times = numeric([event.get("t") for event in events])
    if len(times) >= 2:
        print(f"run_span_seconds={max(times) - min(times):.1f}")

    counts: dict[str, int] = {}
    for event in events:
        event_type = str(event.get("type") or "?")
        counts[event_type] = counts.get(event_type, 0) + 1
    print("event_counts=" + json.dumps(counts, sort_keys=True))

    live_errors = [event for event in events if event.get("type") in {"live_poll_error", "live_stream_error"}]
    if live_errors:
        messages: dict[str, int] = {}
        for event in live_errors:
            message = str(event.get("message") or event.get("error") or "?")
            messages[message] = messages.get(message, 0) + 1
        print("live_errors=" + json.dumps(messages, sort_keys=True))

    tool_results = [event for event in events if event.get("type") == "mcp_tool_result"]
    tools: dict[str, int] = {}
    tool_seconds: list[float] = []
    slow_tools: list[tuple[float, str]] = []
    for event in tool_results:
        tool = str(event.get("tool") or "?")
        tools[tool] = tools.get(tool, 0) + 1
        timing = event.get("dashboard_timing") if isinstance(event.get("dashboard_timing"), dict) else {}
        seconds = timing.get("tool_total_seconds")
        try:
            value = float(seconds)
        except (TypeError, ValueError):
            continue
        tool_seconds.append(value)
        slow_tools.append((value, tool))
    if tools:
        print("tool_counts=" + json.dumps(dict(sorted(tools.items())), sort_keys=True))
    print_stats("tool_total_seconds", tool_seconds)
    if slow_tools:
        top = [
            {"tool": tool, "seconds": round(seconds, 3)}
            for seconds, tool in sorted(slow_tools, reverse=True)[:8]
        ]
        print("slowest_tools=" + json.dumps(top))

    model_events = [event for event in events if event.get("type") == "agent_model_response"]
    print_stats("agent_elapsed_seconds", [event.get("elapsed_seconds") for event in model_events])
    print_stats("request_chars", [event.get("request_chars") for event in model_events], digits=0)
    print_stats("estimated_context_tokens", [event.get("estimated_context_tokens") for event in model_events], digits=0)
    print_stats("tool_schema_chars", [context_label_chars(event, "Tool Schema") for event in model_events], digits=0)
    print_stats("guide_event_log_chars", [context_label_chars(event, "Guide/Event Log") for event in model_events], digits=0)

    audio_preloads = [event for event in events if event.get("type") == "audio_model_preloaded"]
    audio_transcripts = [event for event in events if event.get("type") == "audio_transcript"]
    audio_errors = [event for event in events if event.get("type") == "audio_model_preload_error" or event.get("type") == "audio_transcription_error"]
    print_stats("audio_preload_elapsed_seconds", [event.get("elapsed_seconds") for event in audio_preloads])
    print_stats("audio_transcript_elapsed_seconds", [event.get("elapsed_seconds") for event in audio_transcripts])
    print_stats("audio_transcript_inference_seconds", [event.get("inference_seconds") for event in audio_transcripts])
    print_stats("audio_transcript_load_seconds", [event.get("load_seconds") for event in audio_transcripts])
    if audio_errors:
        print("audio_errors=" + json.dumps([event.get("message") or event.get("error") for event in audio_errors]))


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark dashboard live streamer websocket cadence.")
    parser.add_argument("--url", default="ws://127.0.0.1:8788/ws")
    parser.add_argument("--mjpeg-url", default="")
    parser.add_argument("--run-dir", default="", help="Analyze a run directory or events.jsonl as a passive benchmark.")
    parser.add_argument("--skip-live", action="store_true", help="Only analyze --run-dir; do not connect to the live dashboard.")
    parser.add_argument("--seconds", type=float, default=8.0)
    args = parser.parse_args()
    if args.run_dir:
        summarize_run_events(args.run_dir)
    if args.skip_live:
        return
    if args.mjpeg_url:
        run_mjpeg_benchmark(args.mjpeg_url, max(1.0, args.seconds))
    else:
        asyncio.run(run_benchmark(args.url, max(1.0, args.seconds)))


if __name__ == "__main__":
    main()
