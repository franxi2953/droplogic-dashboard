# Matrix RTS Controls Plan

## Goal

Make the matrix visualizer behave like an RTS control surface for droplet plans: viewport navigation should feel map-like, selected droplets should accept queued right-click destinations, and the timeline should distinguish planned frames from executed progress while keeping direct execution controls close to the plan.

## Phase 1: Cartridge Navigation

- Keep wheel zoom, drag pan, and double-click reset.
- Add edge panning when the cursor rests near the matrix viewer borders.
- Add a persistent minimap in the lower-right corner that shows the full cartridge and the current viewport.
- Expand the minimap on hover.
- Allow clicking or dragging on the minimap to recenter the matrix viewport.

## Phase 2: Droplet Command Queue

- Reuse normal left-click droplet selection.
- When a droplet is selected, right-click on the matrix replaces its queued destination with that electrode.
- Shift + right-click appends another waypoint to the selected droplet queue.
- Render queued waypoints and preview legs directly on the matrix.
- Add a compact command panel with queue count, clear, and SIPP plan action.
- Send queued waypoints to the backend, where each waypoint becomes a target update followed by SIPP planning.

## Phase 3: Timeline Execution Control

- Keep timeline zoom/pan/scrub for inspecting old frames.
- Add play/pause/rewind controls wired to DropLogic execution tools.
- Show the planned cursor separately from executed progress.
- Keep the live/preview toggle so the user can inspect history and return to live execution.
- Treat compact live timelines as sparse exact-index frame sets, not dense arrays.
- Treat successful `clear_droplet_state(reset_executor=true)` empty-plan results as the boundary for current plan/execution markers.
- Add a frame-delay editor, defaulting to 1.0 s, and use it for execution start/resume commands when available.

## Phase 4: Verification And Cleanup

- Run syntax checks for edited JavaScript and Python files.
- Run live responsiveness checks when matrix rendering or live payloads change: `npm run bench:matrix:motion`, `npm run bench:live`, and the agent matrix benchmark when agent-driven motion is affected.
- Restart the dashboard backend.
- Open the dashboard and visually inspect the matrix minimap, command panel, and timeline controls.
- Remove temporary inspection artifacts after verification.
