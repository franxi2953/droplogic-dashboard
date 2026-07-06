# DropLogic Dashboard Benchmarks

Use two layers:

- Library tests live in the repo that owns the Python code. `DropLogic/tests/` is the right place for deterministic `AdvancedDrop`, SIPP, merge, extraction, and executor unit/regression tests.
- Dashboard/system benchmarks live here because they orchestrate browser UI, dashboard backend, MCP, and sometimes hardware. Long-running result sets should go under `benchmarks/results/`, and local smoke outputs may use `runtime/`; both paths are intentionally ignored by git.

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

## 2. Live WebSocket feed benchmark

This samples the dashboard live channel. It is useful for checking that streamer frames and matrix scenes keep arriving independently from the main control WebSocket.

Start the dashboard, then run:

```powershell
npm run bench:live
```

The default target is `ws://127.0.0.1:8789/live`. The output reports message counts, live channel counts, last sequences, sequence regressions/repeats, inter-message gaps, frame ages, streamer FPS, and average message sizes.

Optional passive run-log analysis:

```powershell
py -3 backend\bench_live_feed.py --run-dir runs\<run-id> --skip-live
```

## 3. Synthetic live matrix motion benchmark

This benchmark does not touch hardware. It serves the frontend with a fake live WebSocket stream containing a reservoir extraction and 15-droplet motion sequence, then measures matrix render calls, unique rendered frames, dropped frames, render duration, long tasks, and final live state.

```powershell
npm run bench:matrix:motion
```

Useful knobs:

```powershell
npm run bench:matrix:motion -- --fps 20 --headed --output benchmarks/results/matrix-motion/dev
npm run bench:matrix:motion -- --video false
```

The default output folder is `runtime/perf-bench-motion`; it contains JSON metrics, a final screenshot, and a `.webm` video unless video capture is disabled.

## 4. Agent matrix motion benchmark

This asks the dashboard agent to run the reservoir extraction and matrix motion workflow through MCP tools while Playwright records matrix renders, main/live WebSocket traffic, long tasks, run events, a screenshot, and a video.

The script may change MCP state, so it requires an explicit acknowledgement. It defaults to the simulator:

```powershell
npm run bench:agent:matrix -- --i-understand-this-may-change-mcp-state
```

Common variants:

```powershell
npm run bench:agent:matrix -- --i-understand-this-may-change-mcp-state --frame-delay 0.05 --headed
npm run bench:agent:matrix -- --i-understand-this-may-change-mcp-state --system boxmini --headed
npm run bench:agent:matrix -- --i-understand-this-may-change-mcp-state --allow-loaded-system-restart
```

Other knobs include `--url`, `--output`, `--timeout`, `--prompt`, and `--video false`.

Use `--system boxmini` only when controlling real BoxMini hardware is intentional. If another system is already loaded, the script refuses to restart it unless `--allow-loaded-system-restart` is supplied.

## 5. Five-droplet move benchmark

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

## 6. Real dashboard-to-hardware move benchmark

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
