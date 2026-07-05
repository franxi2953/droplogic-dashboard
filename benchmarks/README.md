# DropLogic Dashboard Benchmarks

Use two layers:

- Library tests live in the repo that owns the Python code. `DropLogic/tests/` is the right place for deterministic `AdvancedDrop`, SIPP, merge, extraction, and executor unit/regression tests.
- Dashboard/system benchmarks live here because they orchestrate browser UI, dashboard backend, MCP, and sometimes hardware. They write results under `benchmarks/results/`, which is intentionally ignored by git.

## 1. UI stress benchmark

This benchmark creates a synthetic heavy run with many plan events, temperature samples, stage/photo markers, and chat events. It does not touch hardware.

```powershell
py -3 scripts\generate_ui_stress_run.py --activate
node scripts\bench_dashboard_ui.mjs --run <printed-run-id> --output benchmarks/results/ui-stress/<printed-run-id>
```

Useful knobs:

```powershell
py -3 scripts\generate_ui_stress_run.py --frames 1600 --events 2500 --temperature-samples 60000 --chat-turns 600 --duration-seconds 32400 --activate
```

The Playwright benchmark reports load time, timeline/matrix pointer latency, render call timings, long tasks, DOM size, event counts, and saves a screenshot plus JSON metrics.

## 2. Five-droplet move benchmark

This measures the path from high-level `AdvancedDrop` operations to `PlanExecutor` timing. By default it uses the DropLogic simulator, so it is safe for development and CI.

```powershell
py -3 scripts\bench_random_droplet_move.py --frame-delay 1
```

Fast smoke test:

```powershell
py -3 scripts\bench_random_droplet_move.py --frame-delay 0.05 --seed 7
```

The output JSON includes:

- droplet creation time
- random target update time
- SIPP planning time
- planned frame count
- expected execution duration (`frame_count * frame_delay`)
- actual execution duration
- execution error seconds and percent
- per-frame duration and matrix queue wait summaries
- slowest frames

Real hardware should be added behind an explicit flag only. Do not make `npm test` or `pytest` move electrodes by default.

## 3. Real dashboard-to-hardware move benchmark

This opens the dashboard with Playwright, creates a new run, optionally restarts BoxMini with a clean matrix/plan, sends MCP tool calls through the dashboard WebSocket as `dashboard_user`, records a browser video, executes the matrix plan at `frame_delay=1`, and then reads compact per-frame executor timing from MCP.

Default safe-ish long pattern: five 2x2 droplets, well spaced, moving left-to-right across the cartridge.

```powershell
npm run bench:move:real -- --i-understand-this-moves-hardware --headed
```

Common variants:

```powershell
npm run bench:move:real -- --i-understand-this-moves-hardware --pattern random5 --headed
npm run bench:move:real -- --i-understand-this-moves-hardware --pattern reservoir_extract_15 --frame-delay 1 --headed
npm run bench:move:real -- --i-understand-this-moves-hardware --frame-delay 1 --system boxmini --execution-view-mode whole_chip_camera
npm run bench:move:real -- --i-understand-this-moves-hardware --no-reset-system --same-run
```

`reservoir_extract_15` creates a 15x30 reservoir droplet, linearly extracts fifteen 2x2 droplets with 4-electrode row/column spacing and staggered offset, clears the reservoir, then moves the extracted droplets across the cartridge in small SIPP batches. It is intentionally much heavier than the default five-droplet movement test.

The result folder contains `summary.json`, `final-dashboard.png`, and a Playwright `.webm` video. The summary reports planned frames, executed frames, actual executor seconds, nominal error against `frames * frame_delay`, period error against frame start cadence, per-frame duration summaries, matrix command latency summaries, slowest frames, dashboard/MCP tool timings, and the `run_id` to reopen in the dashboard.
