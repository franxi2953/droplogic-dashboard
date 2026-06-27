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

- **Main Control**: large live streamer, matrix visualizer, temperature chart, and BoxMini state panels.
- **Agent Chat**: a Codex/OpenAI-compatible control loop with thinking summaries, tool calls, retries, cancellation, copy buttons, and run history.
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

The WebSocket API runs on `8788`.

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

Frame polling is faster than state polling by default:

```json
{
  "live_frame_interval_seconds": 0.33,
  "live_state_interval_seconds": 1.0
}
```

## AI Provider

The backend reads OpenAI-compatible defaults from your Codex config:

```text
%USERPROFILE%\.codex\config.toml
%USERPROFILE%\.codex\auth.json
```

It uses:

- `model_providers.<provider>.base_url`
- `model`
- `model_reasoning_effort`
- `OPENAI_API_KEY`

Environment variables override those values:

```powershell
$env:COCKPIT_AI_BASE_URL="https://rkapi.com/v1"
$env:COCKPIT_AI_MODEL="gpt-5.5"
$env:OPENAI_API_KEY="..."
```

The browser never receives the API key.

## Run Logs

Runs are stored locally:

```text
runs/<run_id>/
  run.json
  events.jsonl
  artifacts/
```

`events.jsonl` is the source of truth for the UI. Agent prose is treated as narration; hardware state should be refreshed through MCP tools before acting.

## Context Hygiene

Dashboard tracks the size of every model request and compacts old context aggressively:

- old state snapshots are pruned from model context when newer snapshots exist;
- large tool outputs are replaced with compact summaries for the model while full logs stay on disk;
- visualizer images are attached once, then degraded to artifact references;
- persistent context checkpoints keep old conversations reloadable without replaying huge logs.

This is especially important for BoxMini runs, where matrix state and visualizer data can otherwise explode a provider request.

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

## License

DropLogic Dashboard is released under the [MIT License](LICENSE).
