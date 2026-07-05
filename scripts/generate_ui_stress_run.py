from __future__ import annotations

import argparse
import json
import math
import random
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = REPO_ROOT / "runs"


def iso_from_ts(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat()


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def event_at(base: float, offset: float, event_type: str, **fields: Any) -> dict[str, Any]:
    t = round(base + offset, 3)
    return {"ts": iso_from_ts(t), "t": t, "type": event_type, **fields}


def integer_ranges(values: list[int]) -> list[list[int]]:
    if not values:
        return []
    values = sorted(set(int(value) for value in values))
    ranges: list[list[int]] = []
    start = previous = values[0]
    for value in values[1:]:
        if value == previous + 1:
            previous = value
            continue
        ranges.append([start, previous])
        start = previous = value
    ranges.append([start, previous])
    return ranges


def bbox_from_cells(cells: list[list[int]]) -> dict[str, int] | None:
    if not cells:
        return None
    rows = [int(cell[0]) for cell in cells]
    cols = [int(cell[1]) for cell in cells]
    return {
        "row_min": min(rows),
        "row_max": max(rows),
        "col_min": min(cols),
        "col_max": max(cols),
    }


def matrix_summary_from_droplets(droplets: list[dict[str, Any]], shape: list[int]) -> dict[str, Any]:
    rows: dict[str, list[int]] = {}
    active_count = 0
    for droplet in droplets:
        for row, col in droplet.get("cells") or []:
            rows.setdefault(str(int(row)), []).append(int(col))
            active_count += 1
    ranges_by_row = {row: integer_ranges(cols) for row, cols in rows.items()}
    bbox = bbox_from_cells([
        [int(row), int(col)]
        for row, cols in rows.items()
        for col in cols
    ])
    return {
        "type": "matrix_summary",
        "source": "synthetic_stress",
        "shape": shape,
        "active_count": active_count,
        "encoding": "active_ranges_by_row",
        "zeros_are_implicit": True,
        "active_bbox": bbox,
        "rows": ranges_by_row,
    }


def compact_path(points: list[list[int]], max_points: int = 24) -> list[list[int]]:
    if len(points) <= max_points:
        return points
    result = []
    last = len(points) - 1
    for index in range(max_points):
        result.append(points[round(index * last / (max_points - 1))])
    deduped = []
    for point in result:
        if not deduped or deduped[-1] != point:
            deduped.append(point)
    return deduped


def path_between(start: list[int], end: list[int]) -> list[list[int]]:
    row0, col0 = start
    row1, col1 = end
    steps = max(abs(row1 - row0), abs(col1 - col0), 1)
    points = []
    for step in range(steps + 1):
        progress = step / steps
        points.append([
            int(round(row0 + (row1 - row0) * progress)),
            int(round(col0 + (col1 - col0) * progress)),
        ])
    return compact_path(points)


def droplet_cells(position: list[int], shape: list[list[int]]) -> list[list[int]]:
    return [[position[0] + rel[0], position[1] + rel[1]] for rel in shape]


def build_scene(
    *,
    base_time: float,
    duration_seconds: float,
    frames: int,
    actions_count: int,
    droplets_count: int,
    seed: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rng = random.Random(seed)
    matrix_shape = [128, 128]
    shape = [[0, 0], [0, 1], [1, 0], [1, 1]]
    droplet_ids = list(range(1, droplets_count + 1))
    grid_cols = max(1, math.ceil(math.sqrt(droplets_count)))
    grid_rows = max(1, math.ceil(droplets_count / grid_cols))
    positions = {
        droplet_id: [
            10 + (index // grid_cols) * max(6, 100 // max(1, grid_rows)),
            10 + (index % grid_cols) * max(6, 100 // max(1, grid_cols)),
        ]
        for index, droplet_id in enumerate(droplet_ids)
    }
    trajectories: dict[int, list[list[int]]] = {droplet_id: [positions[droplet_id][:]] for droplet_id in droplet_ids}
    actions: list[dict[str, Any]] = []
    timeline_events: list[dict[str, Any]] = []
    event_id = 1
    frame_cursor = 0
    safe_actions = max(1, actions_count)
    span = max(1, frames // safe_actions)
    action_types = [
        "create_droplet",
        "move",
        "linear_extraction",
        "isometric_split",
        "merge",
        "mix",
        "move",
        "move",
    ]

    for action_index in range(safe_actions):
        start_frame = min(frames - 1, frame_cursor)
        step_count = max(1, min(frames - start_frame, span + rng.randint(-2, 5)))
        end_frame = min(frames - 1, start_frame + step_count - 1)
        action_type = action_types[action_index % len(action_types)]
        action_droplets = rng.sample(droplet_ids, k=min(rng.randint(1, 5), len(droplet_ids)))
        paths = []
        for droplet_id in action_droplets:
            start = positions[droplet_id][:]
            target = [
                rng.randint(6, matrix_shape[0] - 8),
                rng.randint(6, matrix_shape[1] - 8),
            ]
            if action_type in {"create_droplet", "merge", "isometric_split"} and rng.random() < 0.4:
                target = start[:]
            path = path_between(start, target)
            positions[droplet_id] = target
            trajectories[droplet_id].extend(path[1:] or [target])
            paths.append({
                "key": f"{event_id}:{droplet_id}",
                "droplet_id": droplet_id,
                "start": start,
                "end": target,
                "path": path,
                "path_length": len(path),
            })

        start_time = base_time + (duration_seconds * start_frame / max(1, frames - 1))
        end_time = base_time + (duration_seconds * end_frame / max(1, frames - 1))
        action = {
            "id": str(event_id),
            "event_id": event_id,
            "index": action_index,
            "type": action_type,
            "label": f"{action_index + 1}. {action_type}",
            "frame_span": [start_frame, end_frame],
            "frame_count": end_frame - start_frame + 1,
            "start_time": round(start_time, 3),
            "end_time": round(max(start_time + 0.25, end_time), 3),
            "duration_seconds": round(max(0.25, end_time - start_time), 3),
            "droplet_ids": action_droplets,
            "paths": paths,
            "data": {
                "event_id": event_id,
                "frame_span": [start_frame, end_frame],
                "droplet_ids": action_droplets,
                "synthetic": True,
            },
        }
        actions.append(action)
        timeline_events.append({key: value for key, value in action.items() if key != "paths"})
        event_id += 1
        frame_cursor = end_frame + 1
        if frame_cursor >= frames:
            break

    droplets = []
    for droplet_id in droplet_ids:
        position = positions[droplet_id]
        cells = droplet_cells(position, shape)
        path = compact_path(trajectories[droplet_id], max_points=64)
        droplets.append({
            "id": droplet_id,
            "active": True,
            "position": position,
            "origin": path[0],
            "target": position,
            "shape": shape,
            "shape_size": len(shape),
            "cells": cells,
            "bbox": bbox_from_cells(cells),
            "path": path,
            "path_included": True,
            "path_length": len(trajectories[droplet_id]),
            "vital_space": 2,
        })

    active_ids = droplet_ids
    timeline_frames = [
        {
            "index": frame,
            "event_id": actions[min(len(actions) - 1, frame * max(1, len(actions)) // max(1, frames))]["event_id"] if actions else None,
            "active_droplet_ids": active_ids,
        }
        for frame in range(frames)
    ]
    summary = matrix_summary_from_droplets(droplets, matrix_shape)
    scene = {
        "available": True,
        "surface": "dashboard_internal",
        "system_loaded": True,
        "system": "synthetic",
        "session_id": "benchmark",
        "scene_mode": "advanced_drop",
        "updated_at": round(base_time + duration_seconds, 3),
        "revision": f"synthetic-{seed}-{frames}-{actions_count}-{droplets_count}",
        "matrix": summary,
        "coordinate_mapping": {
            "kind": "electrode_to_stage_affine",
            "units": "stage_steps",
            "origin_electrode": [0, 0],
            "matrix_shape": matrix_shape,
            "chip_origin": {"X": 0, "Y": 0, "Z": 0},
            "offset": {"X": 0, "Y": 0, "Z": 0},
            "inter_row": [100, 0, 0],
            "inter_column": [0, 100, 0],
        },
        "frame": {
            "index": frames - 1,
            "count": frames,
            "source": "executor_last_applied_frame",
            "synced_to_executor": True,
            "summary": summary,
        },
        "executor": {
            "is_executing": False,
            "current_frame": frames,
            "total_frames": frames,
            "frames_executed": frames,
            "frame_delay": 1.0,
            "last_frame": {
                "index": frames - 1,
                "started_at": round(base_time + duration_seconds - 1, 3),
                "finished_at": round(base_time + duration_seconds, 3),
                "duration_seconds": 1.0,
                "matrix_queue_wait": {"ok": True, "elapsed_seconds": 0.06},
            },
            "last_applied_frame": {
                "index": frames - 1,
                "applied_at": round(base_time + duration_seconds, 3),
                "active_droplet_ids": active_ids,
            },
        },
        "plan": {
            "available": True,
            "planning_success": True,
            "frame_count": frames,
            "targets_reached": {str(droplet_id): True for droplet_id in droplet_ids},
            "trajectory_count": len(droplet_ids),
            "event_count": len(actions),
            "current_event": None,
            "scene_plan_source": "current_plan",
            "frame_plan_source": "executor_last_applied_plan",
            "droplets_source": "executor_last_applied_frame",
            "actions": actions,
        },
        "timeline_control": {
            "paused": False,
            "system_loaded": True,
            "intervals": [
                {
                    "start_time": round(base_time, 3),
                    "end_time": None,
                    "duration_seconds": None,
                    "after_frame_index": frames - 1,
                    "reason": "synthetic_benchmark_active",
                }
            ],
        },
        "timeline": {
            "available": True,
            "frame_count": frames,
            "event_count": len(timeline_events),
            "events": timeline_events,
            "frames": timeline_frames,
            "control": {
                "paused": False,
                "system_loaded": True,
                "intervals": [],
            },
            "pauses": [],
            "encoding": "compact_frame_index",
            "frames_compact": True,
            "detailed_frame_limit": 240,
        },
        "droplets": droplets,
    }
    return scene, actions


def build_temperature_history(base_time: float, duration_seconds: float, count: int, run_id: str) -> dict[str, Any]:
    samples = []
    count = max(0, int(count))
    if count <= 0:
        return {"schema_version": 1, "run_id": run_id, "samples": []}
    for index in range(count):
        progress = index / max(1, count - 1)
        t = base_time + duration_seconds * progress
        measured = 34.0 + 8.0 * progress + math.sin(progress * math.pi * 30) * 0.35
        sample = {
            "t": round(t, 3),
            "measured_c": round(measured, 4),
            "source": "synthetic_temperature",
        }
        if index == 0 or index % max(1, count // 40) == 0:
            sample["target_c"] = round(30.0 + 20.0 * progress, 2)
        samples.append(sample)
    return {
        "schema_version": 1,
        "run_id": run_id,
        "created_at": iso_from_ts(base_time),
        "updated_at": iso_from_ts(base_time + duration_seconds),
        "max_bytes": 50 * 1024 * 1024,
        "samples": samples,
    }


def build_events(
    *,
    base_time: float,
    duration_seconds: float,
    requested_events: int,
    actions: list[dict[str, Any]],
    photos: int,
    stage_markers: int,
    chat_turns: int,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = [
        event_at(
            base_time,
            0,
            "cockpit_run_created",
            message="Synthetic UI stress benchmark run.",
        ),
        event_at(
            base_time,
            0.05,
            "agent_prompt",
            prompt="Synthetic long-run stress test: many plan events, temperature history, photos, stage moves, and chat.",
        ),
    ]

    for action in actions:
        start_offset = max(0.1, float(action.get("start_time", base_time)) - base_time)
        end_offset = max(start_offset + 0.1, float(action.get("end_time", base_time)) - base_time)
        tool = {
            "linear_extraction": "plan_reservoir_extraction",
            "isometric_split": "plan_isometric_split",
            "create_droplet": "create_droplet",
        }.get(str(action.get("type")), f"plan_{action.get('type')}")
        events.append(event_at(
            base_time,
            start_offset,
            "mcp_tool_call",
            tool=tool,
            arguments={
                "droplet_ids": action.get("droplet_ids"),
                "frame_span": action.get("frame_span"),
                "synthetic": True,
            },
        ))
        events.append(event_at(
            base_time,
            end_offset,
            "mcp_tool_result",
            tool=tool,
            ok=True,
            result={
                "ok": True,
                "frame_span": action.get("frame_span"),
                "plan": {"frame_count": action.get("frame_span", [0, 0])[1] + 1},
                "targets_reached": {str(droplet_id): True for droplet_id in action.get("droplet_ids") or []},
            },
            dashboard_timing={
                "tool_total_seconds": round(max(0.02, end_offset - start_offset), 3),
                "mcp_call_seconds": round(max(0.01, (end_offset - start_offset) * 0.25), 3),
            },
        ))

    for index in range(max(0, photos)):
        offset = duration_seconds * (index + 1) / (photos + 1)
        events.append(event_at(
            base_time,
            offset,
            "mcp_tool_result",
            tool="capture_visualizer_frame",
            ok=True,
            frame_source="streamer",
            result={
                "ok": True,
                "artifact": {
                    "path": f"artifacts/synthetic_photo_{index:04d}.png",
                    "mime_type": "image/png",
                    "preset": "FAM",
                },
                "preset": {"name": "FAM"},
            },
        ))

    for index in range(max(0, stage_markers)):
        offset = duration_seconds * (index + 0.5) / max(1, stage_markers)
        events.append(event_at(
            base_time,
            offset,
            "mcp_tool_call",
            tool="move_stage",
            arguments={
                "position": {
                    "X": 1000 + index * 21,
                    "Y": 2000 + index * 17,
                    "Z": 3000,
                },
            },
        ))

    for index in range(max(0, chat_turns)):
        offset = duration_seconds * (index + 0.25) / max(1, chat_turns)
        events.append(event_at(
            base_time,
            offset,
            "agent_model_response",
            elapsed_seconds=round(0.8 + (index % 9) * 0.22, 3),
            request_chars=18000 + (index % 17) * 900,
            estimated_context_tokens=4500 + (index % 31) * 140,
            input_tokens=4500 + (index % 31) * 140,
            output_tokens=300 + (index % 11) * 35,
            context_breakdown=[
                {"label": "Pinned Context", "chars": 9000},
                {"label": "Guide/Event Log", "chars": 12000 + index},
                {"label": "Tool Schema", "chars": 9000},
            ],
        ))
        events.append(event_at(
            base_time,
            offset + 0.03,
            "agent_response",
            text=f"Synthetic benchmark agent turn {index + 1}: continuing protocol and monitoring timeline.",
        ))

    events.append(event_at(
        base_time,
        duration_seconds * 0.25,
        "mcp_tool_call",
        tool="start_temperature_routine",
        arguments={
            "steps": [
                {"target_c": round(30 + step * 0.5, 1), "hold_seconds": 300}
                for step in range(41)
            ],
            "require_settle": True,
        },
    ))
    events.append(event_at(
        base_time,
        duration_seconds * 0.75,
        "mcp_tool_result",
        tool="execute_segment_to_breakpoint",
        ok=True,
        result={
            "ok": True,
            "executor_status": {
                "current_frame": actions[-1]["frame_span"][1] + 1 if actions else 1,
                "last_frame": {"index": actions[-1]["frame_span"][1] if actions else 0},
            },
        },
    ))

    events.sort(key=lambda event: (float(event["t"]), str(event.get("type") or "")))
    if requested_events > 0 and len(events) > requested_events:
        keep = [events[0], events[-1]]
        middle = events[1:-1]
        stride = len(middle) / max(1, requested_events - 2)
        sampled = [middle[min(len(middle) - 1, int(index * stride))] for index in range(requested_events - 2)]
        events = sorted([*keep, *sampled], key=lambda event: (float(event["t"]), str(event.get("type") or "")))
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a synthetic heavy dashboard run for Playwright stress testing.")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--frames", type=int, default=1200)
    parser.add_argument("--events", type=int, default=1800)
    parser.add_argument("--actions", type=int, default=900)
    parser.add_argument("--temperature-samples", type=int, default=30000)
    parser.add_argument("--chat-turns", type=int, default=360)
    parser.add_argument("--droplets", type=int, default=25)
    parser.add_argument("--photos", type=int, default=80)
    parser.add_argument("--stage-markers", type=int, default=140)
    parser.add_argument("--duration-seconds", type=float, default=9 * 3600)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--activate", action="store_true", help="Write runs/.last_run and mirror to bench_ui_stress_latest.")
    parser.add_argument("--force", action="store_true", help="Replace an existing synthetic run directory.")
    args = parser.parse_args()

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_id = args.run_id or f"bench_ui_stress_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir = RUNS_DIR / run_id
    if run_dir.exists():
        if not args.force:
            raise SystemExit(f"Run already exists: {run_dir} (use --force)")
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)

    base_time = time.time() - float(args.duration_seconds)
    scene, actions = build_scene(
        base_time=base_time,
        duration_seconds=float(args.duration_seconds),
        frames=max(1, int(args.frames)),
        actions_count=max(1, int(args.actions)),
        droplets_count=max(1, int(args.droplets)),
        seed=int(args.seed),
    )
    events = build_events(
        base_time=base_time,
        duration_seconds=float(args.duration_seconds),
        requested_events=max(0, int(args.events)),
        actions=actions,
        photos=max(0, int(args.photos)),
        stage_markers=max(0, int(args.stage_markers)),
        chat_turns=max(0, int(args.chat_turns)),
    )

    metadata = {
        "run_id": run_id,
        "name": "Synthetic UI stress benchmark",
        "created_at": iso_from_ts(base_time),
        "events_path": str(run_dir / "events.jsonl"),
        "synthetic": True,
    }
    write_json(run_dir / "run.json", metadata)
    write_json(run_dir / "scene.json", scene)
    write_json(
        run_dir / "temperature_history.json",
        build_temperature_history(base_time, float(args.duration_seconds), int(args.temperature_samples), run_id),
    )
    with (run_dir / "events.jsonl").open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=True, separators=(",", ":")) + "\n")

    if args.activate:
        (RUNS_DIR / ".last_run").write_text(run_id, encoding="utf-8")
        latest_dir = RUNS_DIR / "bench_ui_stress_latest"
        if latest_dir.exists():
            shutil.rmtree(latest_dir)
        shutil.copytree(run_dir, latest_dir)

    print(json.dumps({
        "run_id": run_id,
        "run_dir": str(run_dir),
        "events": len(events),
        "frames": args.frames,
        "actions": len(actions),
        "temperature_samples": args.temperature_samples,
        "scene_path": str(run_dir / "scene.json"),
    }, indent=2))


if __name__ == "__main__":
    main()
