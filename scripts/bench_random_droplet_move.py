from __future__ import annotations

import argparse
import json
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
GITHUB_ROOT = REPO_ROOT.parent
DROPLOGIC_ROOT = GITHUB_ROOT / "DropLogic"
RESULTS_ROOT = REPO_ROOT / "benchmarks" / "results" / "random-droplet-move"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def summarize_numbers(values: list[float]) -> dict[str, Any]:
    clean = [float(value) for value in values if isinstance(value, (int, float)) and value == value]
    if not clean:
        return {"count": 0}
    ordered = sorted(clean)
    return {
        "count": len(ordered),
        "min": round(ordered[0], 4),
        "median": round(statistics.median(ordered), 4),
        "p95": round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * 0.95))], 4),
        "max": round(ordered[-1], 4),
        "mean": round(sum(ordered) / len(ordered), 4),
    }


def compact_matrix_queue_wait(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    queue_wait = raw.get("queue_wait") if isinstance(raw.get("queue_wait"), dict) else {}
    queues = queue_wait.get("queues") if isinstance(queue_wait.get("queues"), dict) else {}
    high = queues.get("HIGH") if isinstance(queues.get("HIGH"), dict) else {}
    last_command = high.get("last_command") if isinstance(high.get("last_command"), dict) else {}
    queued_at = last_command.get("queued_at")
    processed_at = last_command.get("processed_at")
    command_latency = None
    if isinstance(queued_at, (int, float)) and isinstance(processed_at, (int, float)):
        command_latency = round(float(processed_at) - float(queued_at), 6)
    return {
        "ok": raw.get("ok"),
        "successful_attempt": raw.get("successful_attempt"),
        "attempts_count": len(raw.get("attempts") or []),
        "pending_commands": queue_wait.get("pending_commands"),
        "timed_out": bool(queue_wait.get("timed_out")),
        "hardware_errors_count": len(queue_wait.get("hardware_errors") or []),
        "high_queue": {
            "queue_size": high.get("queue_size"),
            "unfinished_tasks": high.get("unfinished_tasks"),
            "last_path": last_command.get("path"),
            "last_ok": last_command.get("ok"),
            "command_latency_seconds": command_latency,
        },
    }


def compact_last_frame(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    return {
        "index": raw.get("index"),
        "started_at": raw.get("started_at"),
        "finished_at": raw.get("finished_at"),
        "duration_seconds": raw.get("duration_seconds"),
        "error": raw.get("error"),
        "matrix_queue_wait": compact_matrix_queue_wait(raw.get("matrix_queue_wait")),
    }


def compact_executor_status(status: dict[str, Any]) -> dict[str, Any]:
    return {
        "is_executing": status.get("is_executing"),
        "current_frame": status.get("current_frame"),
        "total_frames": status.get("total_frames"),
        "frames_executed": status.get("frames_executed"),
        "frame_delay": status.get("frame_delay"),
        "execution_time": status.get("execution_time"),
        "progress": status.get("progress"),
        "stage_tracking_mode": status.get("stage_tracking_mode"),
        "last_frame": compact_last_frame(status.get("last_frame")),
        "last_applied_frame": status.get("last_applied_frame"),
    }


class PhaseTimer:
    def __init__(self) -> None:
        self.phases: list[dict[str, Any]] = []

    def run(self, name: str, fn):
        started = time.perf_counter()
        ok = False
        try:
            result = fn()
            ok = True
            return result
        finally:
            self.phases.append({
                "name": name,
                "ok": ok,
                "seconds": round(time.perf_counter() - started, 6),
            })


def load_droplogic() -> None:
    if not DROPLOGIC_ROOT.exists():
        raise FileNotFoundError(f"DropLogic repo not found next to dashboard: {DROPLOGIC_ROOT}")
    sys.path.insert(0, str(DROPLOGIC_ROOT))


def make_simulator_config(path: Path, rows: int = 128, columns: int = 128) -> None:
    matrix = [[0 for _ in range(columns)] for _ in range(rows)]
    payload = {
        "electrode_matrix": {
            "rows": rows,
            "columns": columns,
            "voltage": [60, 55, 55, 55, 55, 55, 55, 55, 55],
            "matrix": matrix,
        },
        "xy_stage": {
            "position": {"X": 0, "Y": 0, "Z": 0},
            "motion_params": {"speed": 2},
            "continuous_movement": {"X": 0, "Y": 0, "Z": 0},
        },
        "calibration": {
            "chip_origin": {"X": 0, "Y": 0, "Z": 0},
            "electrode_mapping": {
                "inter_row": [100, 0, 0],
                "inter_column": [0, 100, 0],
                "offset_x": 0,
                "offset_y": 0,
                "offset_z": 0,
            },
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def deterministic_case(seed: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    import random

    rng = random.Random(seed)
    origins = [(18, 18), (18, 48), (48, 18), (48, 48), (78, 32)]
    target_pool = [(82, 92), (22, 90), (92, 24), (56, 96), (96, 62), (34, 72), (72, 34)]
    rng.shuffle(target_pool)
    droplets = []
    targets = []
    for index, origin in enumerate(origins, start=1):
        droplets.append({
            "id": index,
            "origin": origin,
            "target": origin,
            "width": 2,
            "height": 2,
            "vital_space": 2,
        })
        targets.append({"id": index, "target": target_pool[index - 1]})
    return droplets, targets


def wait_for_executor(executor, timeout_seconds: float) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    deadline = time.perf_counter() + max(1.0, timeout_seconds)
    last_frame_seen = None
    while time.perf_counter() < deadline:
        status = executor.status()
        last_frame = status.get("last_frame") or {}
        frame_index = last_frame.get("index")
        if frame_index != last_frame_seen:
            samples.append({
                "sampled_at": time.time(),
                "current_frame": status.get("current_frame"),
                "frames_executed": status.get("frames_executed"),
                "last_frame": compact_last_frame(last_frame),
            })
            last_frame_seen = frame_index
        if not status.get("is_executing"):
            return samples
        time.sleep(0.02)
    raise TimeoutError(f"PlanExecutor did not finish within {timeout_seconds:.1f}s")


def run_simulator_benchmark(args: argparse.Namespace) -> dict[str, Any]:
    load_droplogic()
    from droplogic.hardware.simulator import Simulator

    timer = PhaseTimer()
    run_started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="droplogic_bench_") as temp_dir:
        config_path = Path(temp_dir) / "simulator_config.json"
        make_simulator_config(config_path)
        simulator = timer.run(
            "simulator_init",
            lambda: Simulator(config_file=str(config_path), log_level="WARNING", reset_matrix=True),
        )
        advanced_drop = simulator.advanced_drop
        droplets, targets = deterministic_case(args.seed)

        def create_droplets() -> None:
            for item in droplets:
                advanced_drop.droplets.create_droplet(
                    item["id"],
                    item["origin"],
                    item["target"],
                    width=item["width"],
                    height=item["height"],
                    vital_space=item["vital_space"],
                )

        timer.run("create_5_droplets", create_droplets)

        def update_targets() -> None:
            for item in targets:
                ok = advanced_drop.droplets.update_droplet_target(item["id"], tuple(item["target"]))
                if not ok:
                    raise RuntimeError(f"Failed to update droplet {item['id']} target")

        timer.run("update_random_targets", update_targets)
        plan = timer.run(
            "sipp_plan_move",
            lambda: advanced_drop.move(mode="sipp", merge_on_failure=False, remove_duplicate_frames=False),
        )
        if not getattr(plan, "planning_success", False):
            raise RuntimeError(f"SIPP planning failed: {getattr(plan, 'targets_reached', {})}")

        frame_count = len(getattr(plan, "frames", []) or [])
        expected_seconds = frame_count * float(args.frame_delay)

        execution_started = time.perf_counter()
        timer.run(
            "executor_start",
            lambda: advanced_drop.executor.start(
                plan=plan,
                frame_delay=float(args.frame_delay),
                verify_positions=False,
                enable_visualizers=False,
                stage_tracking_mode="fixed_stage",
                fixed_stage_position={"X": 0, "Y": 0, "Z": 0},
                fixed_stage_ready=True,
            ),
        )
        frame_samples = timer.run(
            "executor_wait_until_done",
            lambda: wait_for_executor(
                advanced_drop.executor,
                timeout_seconds=max(float(args.timeout), expected_seconds + 20.0),
            ),
        )
        actual_seconds = time.perf_counter() - execution_started
        status = advanced_drop.executor.status()
        simulator.close()

    frame_durations = [
        sample.get("last_frame", {}).get("duration_seconds")
        for sample in frame_samples
        if isinstance(sample.get("last_frame"), dict)
    ]
    queue_wait_latencies = [
        (((sample.get("last_frame", {}).get("matrix_queue_wait") or {}).get("high_queue") or {}).get("command_latency_seconds"))
        for sample in frame_samples
        if isinstance(sample.get("last_frame"), dict)
    ]
    slowest_frames = sorted(
        [
            {
                "frame": sample.get("last_frame", {}).get("index"),
                "duration_seconds": sample.get("last_frame", {}).get("duration_seconds"),
                "matrix_queue_wait": sample.get("last_frame", {}).get("matrix_queue_wait"),
            }
            for sample in frame_samples
            if isinstance(sample.get("last_frame"), dict)
        ],
        key=lambda item: float(item.get("duration_seconds") or 0),
        reverse=True,
    )[:10]
    error_seconds = actual_seconds - expected_seconds
    return {
        "benchmark": "random_5_droplet_move",
        "mode": "simulator",
        "generated_at": utc_now(),
        "seed": args.seed,
        "frame_delay": float(args.frame_delay),
        "droplets": droplets,
        "targets": targets,
        "frame_count": frame_count,
        "expected_execution_seconds": round(expected_seconds, 4),
        "actual_execution_seconds": round(actual_seconds, 4),
        "execution_error_seconds": round(error_seconds, 4),
        "execution_error_percent": round((error_seconds / expected_seconds) * 100, 3) if expected_seconds else None,
        "wall_seconds": round(time.perf_counter() - run_started, 4),
        "phases": timer.phases,
        "final_executor_status": compact_executor_status(status),
        "frame_samples": frame_samples,
        "frame_duration_summary": summarize_numbers([value for value in frame_durations if isinstance(value, (int, float))]),
        "matrix_command_latency_summary": summarize_numbers([value for value in queue_wait_latencies if isinstance(value, (int, float))]),
        "slowest_frames": slowest_frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark 5 random 2x2 droplet moves through AdvancedDrop and PlanExecutor.")
    parser.add_argument("--frame-delay", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--timeout", type=float, default=0.0, help="Override executor wait timeout seconds.")
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--real-hardware", action="store_true", help="Reserved guard; this script currently refuses real hardware.")
    args = parser.parse_args()

    if args.real_hardware:
        raise SystemExit("Real hardware benchmark is intentionally not implemented here yet. Use simulator mode first.")

    result = run_simulator_benchmark(args)
    output_root = Path(args.output_dir) if args.output_dir else RESULTS_ROOT / datetime.now().strftime("%Y%m%d_%H%M%S")
    output_root.mkdir(parents=True, exist_ok=True)
    summary_path = output_root / "summary.json"
    summary_path.write_text(json.dumps(result, indent=2, ensure_ascii=True, default=str), encoding="utf-8")
    print(json.dumps({
        "summary_path": str(summary_path),
        "frame_count": result["frame_count"],
        "expected_execution_seconds": result["expected_execution_seconds"],
        "actual_execution_seconds": result["actual_execution_seconds"],
        "execution_error_seconds": result["execution_error_seconds"],
        "execution_error_percent": result["execution_error_percent"],
    }, indent=2))


if __name__ == "__main__":
    main()
