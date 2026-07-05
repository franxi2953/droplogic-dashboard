from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import websockets
from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.config import load_config
    from backend.server import CockpitApp, MCP_STATEFUL_EXECUTION_TOOLS, start_http_server
    from backend.tool_payloads import mcp_tool_call_succeeded
else:
    from .config import load_config
    from .server import CockpitApp, MCP_STATEFUL_EXECUTION_TOOLS, start_http_server
    from .tool_payloads import mcp_tool_call_succeeded


INSTRUCTIONS = """
DropLogic Dashboard MCP proxy.

Use the exposed DropLogic tools normally. This proxy forwards calls to the real
DropLogic MCP server, records the run, and renders the matrix/streamer visualizers
in the dashboard browser. In dashboard mode, OpenCV visualizer windows are disabled;
use visualizer_status and visualizer_frame for visual feedback.
""".strip()


async def ensure_mcp_started(app: CockpitApp) -> bool:
    if app.mcp.running:
        return False
    await app.mcp.start()
    app.ensure_live_polling()
    app.now = "MCP server running through cockpit proxy"
    await app.record("mcp_started", command=app.mcp.command_line(), via="cockpit_proxy")
    return True


def as_call_tool_result(result: Any) -> types.CallToolResult:
    if isinstance(result, dict):
        try:
            return types.CallToolResult.model_validate(result)
        except Exception:
            pass
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(result, ensure_ascii=True, indent=2))],
        structuredContent=result if isinstance(result, dict) else None,
        isError=False,
    )


def error_result(message: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=message)],
        isError=True,
    )


async def run_proxy(config_path: str | None = None) -> None:
    config = load_config(config_path)
    app = CockpitApp(config)
    await app.record("cockpit_proxy_started", host=config.host, port=config.port)

    httpd = start_http_server(config.host, config.port, app.recorder.runs_dir)
    ws_port = config.port + 1
    ws_server = await websockets.serve(
        app.handle_ws,
        config.host,
        ws_port,
        max_size=None,
    )

    server = Server(
        "DropLogic Dashboard",
        version="0.1.0",
        instructions=INSTRUCTIONS,
        website_url=f"http://{config.host}:{config.port}",
    )

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        await ensure_mcp_started(app)
        result = await app.mcp.list_tools()
        return [types.Tool.model_validate(item) for item in result.get("tools", [])]

    @server.call_tool(validate_input=False)
    async def call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        mcp_auto_started = await ensure_mcp_started(app)
        actual_name = name
        actual_arguments = arguments
        routed_tool = False
        if name == "temperature_hold" and app.should_background_temperature_hold(arguments):
            actual_name = "start_temperature_routine"
            actual_arguments = app.temperature_hold_as_routine_arguments(arguments)
            routed_tool = True
        call_event = await app.record(
            "mcp_tool_call",
            tool=name,
            arguments=arguments,
            via="cockpit_proxy",
            **(
                {
                    "dashboard_actual_tool": actual_name,
                    "dashboard_actual_arguments": actual_arguments,
                }
                if routed_tool
                else {}
            ),
        )
        try:
            if mcp_auto_started and actual_name in MCP_STATEFUL_EXECUTION_TOOLS:
                result = app.mcp_runtime_restarted_result(actual_name, via="cockpit_proxy")
            elif actual_name == "verify_droplets":
                result = await app.call_verify_droplets_observed(
                    actual_arguments,
                    source="cockpit_proxy",
                    call_event_id=call_event.get("t"),
                )
            else:
                result = await app.mcp.call_tool(
                    actual_name,
                    actual_arguments,
                    read_timeout_seconds=app.dashboard_user_tool_timeout_seconds(
                        actual_name,
                        actual_arguments,
                    ),
                )
            if routed_tool:
                result = app.annotate_routed_tool_result(result, name, actual_name)
            ok = mcp_tool_call_succeeded(result)
            await app.record(
                "mcp_tool_result",
                tool=name,
                ok=ok,
                result=result,
                call_event_id=call_event.get("t"),
                via="cockpit_proxy",
                **(
                    {
                        "dashboard_actual_tool": actual_name,
                        "dashboard_actual_arguments": actual_arguments,
                    }
                    if routed_tool
                    else {}
                ),
            )
            return as_call_tool_result(result)
        except Exception as exc:
            await app.record(
                "mcp_tool_result",
                level="error",
                tool=name,
                ok=False,
                error=str(exc),
                call_event_id=call_event.get("t"),
                via="cockpit_proxy",
                **(
                    {
                        "dashboard_actual_tool": actual_name,
                        "dashboard_actual_arguments": actual_arguments,
                    }
                    if routed_tool
                    else {}
                ),
            )
            return error_result(str(exc))

    try:
        await ensure_mcp_started(app)
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options(),
            )
    finally:
        await app.stop_live_polling()
        await app.mcp.stop()
        ws_server.close()
        await ws_server.wait_closed()
        httpd.shutdown()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the DropLogic Dashboard MCP proxy.")
    parser.add_argument("--config", help="Path to cockpit config JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(run_proxy(args.config))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
