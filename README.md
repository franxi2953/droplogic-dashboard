<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/droplets-mark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/droplets-mark-light.svg">
    <img src="docs/assets/droplets-mark-light.svg" alt="DropLogic logo" width="120">
  </picture>
</p>

<h1 align="center">DropLogic Dashboard</h1>

<p align="center">
  <strong>A local AI control surface for DropLogic MCP runs and BoxMini experiments.</strong>
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-experimental-ff9f0a?style=flat-square&amp;labelColor=111111">
  <img alt="Python" src="https://img.shields.io/badge/python-3.13-3776ab?style=flat-square&amp;labelColor=111111">
  <img alt="Frontend" src="https://img.shields.io/badge/frontend-vanilla%20JS-64d2ff?style=flat-square&amp;labelColor=111111">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-stdio%20proxy-30d158?style=flat-square&amp;labelColor=111111">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-d29922?style=flat-square&amp;labelColor=111111"></a>
</p>

DropLogic Dashboard is a browser-based companion for live DropLogic sessions. It owns one local MCP server process, renders the BoxMini streamer and matrix visualizers headlessly, records every tool call into append-only run logs, and can route an OpenAI-compatible agent through the same tools the normal MCP workflow uses.

It is intentionally separate from the `droplogic` Python package: DropLogic remains the hardware/control library; Dashboard is the operator-facing lab console.

## What It Provides

- **Main Control**: large live streamer with source, overlay, histogram, and display-level controls; matrix visualizer; temperature chart; and BoxMini state panels with per-priority command queues.
- **Agent Chat**: a Codex/OpenAI-compatible control loop with thinking summaries, tool calls, retries, cancellation, copy buttons, and run history.
- **Local Audio Input**: browser microphone capture sent to a local speech-to-text model before text is placed into the agent prompt.
- **Context Analysis**: per-request token charts, context breakdown histograms, compaction events, retry diagnostics, and tool-output size badges.
- **Run Records**: append-only `events.jsonl` histories, artifacts, visualizer frames, and persistent context checkpoints.
- **MCP Proxy Mode**: agents can keep using the DropLogic MCP tool surface while Dashboard observes, records, and displays the same session.

## Quick Start

Place this repository next to DropLogic:

```text
GitHub/
  DropLogic/
  droplogic-dashboard/
```

Then launch the local dashboard:

```powershell
cd C:\Users\FranQuero\Documents\GitHub\droplogic-dashboard
.\start.ps1 -Open
```

The browser UI runs at:

```text
http://127.0.0.1:8787
```

The main WebSocket API runs on `8788`. Live frame and scene updates use a dedicated WebSocket on `8789` so matrix and streamer rendering can keep moving while the main socket is busy with agent or tool traffic.

By default the Dashboard does not load real hardware until you press **Start MCP** and explicitly call tools such as `load_system`.

## MCP Proxy Mode

To let another agent use the normal DropLogic tools while Dashboard records and displays the run, point that agent's MCP entry at the proxy:

```json
{
  "mcpServers": {
    "droplogic": {
      "command": "py",
      "args": [
        "-3.13",
        "C:\\Users\\FranQuero\\Documents\\GitHub\\droplogic-dashboard\\backend\\mcp_proxy.py"
      ]
    }
  }
}
```

The proxy starts the real DropLogic MCP server as a child process, forwards tool discovery and tool calls, records calls/results into `runs/`, and serves the Dashboard UI.

## Headless Visualizers

When Dashboard starts DropLogic MCP it sets:

```text
DROPLOGIC_COCKPIT_MODE=1
DROPLOGIC_VISUALIZER_HEADLESS=1
DROPLOGIC_MCP_CONTEXT_DIR=<this repo>\context\boxmini
```

The `COCKPIT_*` names are kept for compatibility with the current DropLogic MCP integration. In practice this is Dashboard mode: OpenCV windows stay headless, and the browser renders frames through `visualizer_frame`.

Dashboard contributes only the extra `cockpit-mode.md`/dashboard-mode context. Base agent guidance and cartridge geometry, including `cartridge.default.json`, live in the DropLogic MCP context folder:

```text
DropLogic/droplogic/mcp/context/boxmini/
```

Live polling is split by cadence so state refreshes, matrix scene snapshots, and streamer frames do not block each other. By default, the state loop is slower than the visual loops:

```json
{
  "live_frame_interval_seconds": 0.33,
  "live_scene_interval_seconds": 0.1,
  "live_streamer_interval_seconds": 0.12,
  "live_state_interval_seconds": 1.0
}
```

Large live matrix scenes are compacted before broadcast. When a plan timeline is heavy, Dashboard sends sampled compact frames around the first frames, final frames, and current execution focus; the full run record remains on disk.

Live frame and scene payloads carry dashboard sequence metadata. The browser keeps the newest payload per channel, resets freshness on live WebSocket reconnect, and ignores older matrix scenes from stale sessions. Backend scene-file fallback also rejects stale `dashboard_scene.json` snapshots after the greater of 10 seconds or six live poll intervals.

The Streamer state card switches between microscope and camera sources. The streamer panel can toggle the electrode overlay and apply persistent, browser-local black/white display levels manually, once from the current histogram, or continuously with **Auto live**. Level adjustments affect only the browser display; **Download** still saves the raw camera frame. When a direct stream is available, Dashboard requests snapshot frames only while histogram or level processing needs them.

The BoxMini state grid also shows pending commands from compact `runtime_status` data, split into `CRITICAL`, `HIGH`, `MEDIUM`, and `LOW` queues.

## Cartridge Calibration

**Cartridge Calibration** starts MCP, opens a full-resolution streamer view, and provides two modes. **Focus** records the matrix origin, row endpoint, and column endpoint in the DropLogic config selected by `DROPLOGIC_CONFIG` (or the default DropLogic `config.json`) and applies the resulting mapping to the running system. **Injection Holes** creates, renames, selects, and deletes cartridge input holes; captures each selected region's start and end from the current calibrated stage position; and edits its side, role, and notes.

Saving injection holes writes `cartridge.default.json` in the first matching pinned BoxMini context root, normally `DropLogic/droplogic/mcp/context/boxmini/`. Focus calibration must be valid before stage positions can be converted to electrode coordinates for hole capture.

## AI Provider

The backend reads model profiles from private Dashboard files:

```text
backend/ai_config.local.json
backend/ai_auth.local.json
```

Both files are ignored by git. The config file stores profile ids, labels, RKAPI URLs, model names, reasoning settings, and `api_key_id` references. The auth file stores the matching API keys.

Profiles may use different RKAPI wire formats. Codex-style profiles can use `wire_api: "responses"`; Claude profiles currently use `wire_api: "anthropic_messages"` so Dashboard can read returned `thinking`, `text`, and `tool_use` blocks.

The browser receives only public profile metadata such as label/model/configured status. It never receives API keys.

Minimal shape:

```json
{
  "active_profile": "codex-5-5",
  "profiles": [
    {
      "id": "codex-5-5",
      "label": "Codex 5.5",
      "base_url": "https://rkapi.com/v1",
      "wire_api": "responses",
      "model": "gpt-5.5",
      "reasoning_effort": "xhigh",
      "api_key_id": "codex"
    }
  ]
}
```

```json
{
  "api_keys": {
    "codex": "..."
  }
}
```

## Local Speech Input

The **Load** button explicitly loads the local speech model. Audio is off by default: the dashboard does not preload Whisper, open the microphone, or start wake listening until the model is loaded. After that, the **Audio** button records microphone audio in the browser and sends it to the local Dashboard backend for transcription. Manual recordings insert the transcript into the prompt box for review.

The **Wake** mode listens for a short browser wake phrase, then records the following command until word silence and sends that command through the same local transcription path. By default it uses `BoxMini` as the wake phrase and auto-submits recognized wake commands to the agent. Browser wake listening uses the Web Speech API when available; during the command it also uses that API only as a word-activity sensor, so music or steady room noise does not keep the recording open. The final transcript still comes from the local Whisper model. If browser speech recognition is unavailable, the dashboard falls back to audio-level silence detection. If the browser blocks automatic microphone activation, click **Load** and then **Wake** once.

Install a local recognizer:

```powershell
py -3.13 -m pip install faster-whisper
```

Then tune `config.example.json` or a private config:

```json
{
  "speech": {
    "enabled": true,
    "engine": "faster_whisper",
    "model": "large-v3-turbo",
    "device": "auto",
    "compute_type": "int8",
    "language": null,
    "beam_size": 1,
    "best_of": 1,
    "temperature": 0,
    "condition_on_previous_text": false,
    "preload": false,
    "wake_enabled": true,
    "wake_auto_start": false,
    "wake_word": "BoxMini",
    "wake_language": null,
    "wake_auto_submit": true,
    "wake_command_max_seconds": 24,
    "wake_silence_ms": 1200,
    "wake_initial_silence_ms": 5000,
    "hotwords": "BoxMini DropLogic droplet reservoir cartridge streamer visualizer Brightfield FAM stage temperature IVT TX TL MCP"
  }
}
```

Recommended defaults are `model: "large-v3-turbo"`, `compute_type: "int8"`, `beam_size: 1`, and `best_of: 1` for responsive local use on a CPU laptop. Keep `preload: false` when running hardware protocols so Whisper does not compete with the dashboard until you click **Load**. Set `preload: true` only when you prefer paying the model-load cost at startup. For maximum accuracy, use `model: "large-v3"`. For a CUDA GPU, use `device: "cuda"` and `compute_type: "float16"`.

Transcription events record `load_seconds`, `inference_seconds`, and `elapsed_seconds`, so slow runs can be separated into model startup versus recognition time.

## Run Logs

Runs are stored locally:

```text
runs/<run_id>/
  run.json
  events.jsonl
  artifacts/
```

`events.jsonl` is the source of truth for the UI. Agent prose is treated as narration; hardware state should be refreshed through MCP tools before acting.

Recorded runs are loaded into a responsive conversation view. While the user is reading history, newly streamed agent text preserves the exact scroll offset; conversation-only events do not rerender unrelated dashboard panels, and **Jump to latest** resumes live following.

Timeline plan/execution overlays focus on the active plan window. A successful `clear_droplet_state(reset_executor=true)` that leaves an empty plan is treated as a boundary for later plan and execution markers.

Timeline photo markers and hover previews use saved image records from event results, content, and model attachments. Recorded `artifact`/`artifacts`, `artifact_ref`/`artifact_refs`, and `capture`/`captures` metadata can be previewed or revealed; requested `output_path` values in tool arguments are not treated as saved files on their own.

For `start_melting_curve_capture`, Dashboard watches the returned capture metadata and records `melting_curve_capture_photo` events as images appear, so those photos can show up in the same timeline preview path.

Run-local artifacts are served from the selected run directory. External capture files are served only when the file was recorded in `events.jsonl` and lives under `DROPLOGIC_CAPTURE_ROOT` or `%USERPROFILE%\Documents\DropLogic\captures`. If capture tools save photos somewhere else, set the capture root before launching Dashboard:

```powershell
$env:DROPLOGIC_CAPTURE_ROOT="C:\path\to\captures"
```

## Context Hygiene

Dashboard tracks the size of every model request and compacts old context aggressively:

- the default AI context target is `40000` characters with a `300000` character hard limit, and tool outputs are trimmed to the configured `4000` character limit or a tighter active-call cap for model requests;
- old state snapshots are pruned from model context when newer snapshots exist;
- old tool chatter, including older failed results, is reduced to compact timeline markers while the latest result per tool, recent pending calls, and failure metadata summaries are preserved;
- the latest tool result is protected through history summarization and retry-time compaction so the agent can still see the most recent observation;
- large tool outputs are replaced with compact summaries for the model while full logs stay on disk, including OpenAI Responses, Chat Completions, and Anthropic tool-result payloads;
- visualizer images are attached once, then degraded to artifact references;
- repeated live polling/streaming errors are summarized for the model while full events stay in `events.jsonl`;
- pinned guide context is sent from the configured context roots, large JSON pinned files are sent as structured summaries, and other large pinned files are sent as heading indexes with the full file still available through `read_context_file`;
- before each agent turn, Dashboard can select up to five detailed `agent-guide/*.md` shards from the available BoxMini guide catalog and append them as turn-scoped guide expansions that are not retained for future turns;
- persistent context checkpoints keep old conversations reloadable without replaying huge logs.

This is especially important for BoxMini runs, where matrix state and visualizer data can otherwise explode a provider request.

## Benchmarks

Dashboard performance benchmarks are documented in [benchmarks/README.md](benchmarks/README.md), including the live WebSocket feed check, synthetic live matrix motion, and agent-driven matrix motion scripts.

## Configuration

The default config lives in:

```text
config.example.json
```

Override the DropLogic repo location with:

```powershell
$env:DROPLOGIC_REPO="C:\path\to\DropLogic"
```

## Safety Note

Dashboard can control real hardware through DropLogic MCP. Treat every hardware action as live unless the MCP session is explicitly in simulation/debug mode. The UI records tool results, but it does not replace physical inspection or protocol-specific validation.

Before running hardware-sensitive MCP tools from the agent, dashboard UI, or proxy, Dashboard checks MCP runtime health and refuses the tool call if the runtime reports unhealthy queue workers. Guarded calls include stage, camera, light, matrix, execution, temperature, and melting-capture tools; `calibration_stage_jog(stop_all=true)` remains available as a stop path.

## License

DropLogic Dashboard is released under the [MIT License](LICENSE).
