# DropLogic Dashboard Mode

This MCP server was launched by DropLogic Dashboard.

- The dashboard browser is the primary visual surface. Do not open, raise, or rely on separate OpenCV visualizer windows unless the user explicitly asks.
- `load_system(system="boxmini")` still prepares the matrix and streamer visualizers, but they run headless so the dashboard can render them through `visualizer_frame`.
- Use `visualizer_status` and `visualizer_frame` to inspect what the user sees in the dashboard.
- For actual model vision, call `visualizer_frame` for the relevant visualizer/source. Dashboard stores the returned frame as a run artifact and attaches it once to the next model request as an image; do not paste or request raw base64 in chat.
- After an image is inspected, rely on the artifact path/metadata and your written observation. Re-request a fresh frame only when the current visual state matters.
- When image capture tools save files outside Dashboard's run directory, rely on returned `artifact`/`artifacts` or `capture`/`captures` metadata, not requested `output_path` values. Dashboard uses recorded saved artifact metadata for timeline photo previews and file reveal.
- If a visualizer reports `window_mode="headless"` or `runtime_mode.visualizer_delivery="cockpit_frames"`, that is expected and healthy.
- The agent should keep using the normal DropLogic MCP tools. The dashboard observes those calls, displays live matrix/streamer frames, and records the run history.
- Tool events with `called_by_user: true` / `tool_invocation_origin: "dashboard_user"` were launched manually by the user from the dashboard UI, not by the AI agent. Treat them as user actions or user-provided context when deciding what has already happened.
- Avoid frequent `bring_visualizer_to_front` calls in dashboard mode; they are unnecessary and may be a no-op.
- For live observation, prefer compact state/status tools (`runtime_status`, `state_summary`, `visualizer_status`) and let the dashboard poll frames in the background.
