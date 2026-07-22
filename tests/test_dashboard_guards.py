from __future__ import annotations

import asyncio
import unittest
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.modules.setdefault("websockets", SimpleNamespace(serve=None))
sys.modules.setdefault(
    "httpx",
    SimpleNamespace(
        AsyncClient=object,
        HTTPStatusError=RuntimeError,
        RequestError=RuntimeError,
    ),
)
sys.modules.setdefault(
    "mcp",
    SimpleNamespace(
        ClientSession=object,
        StdioServerParameters=object,
        types=SimpleNamespace(
            CallToolResult=object,
            TextContent=object,
            Tool=object,
        ),
    ),
)
sys.modules.setdefault("mcp.client", SimpleNamespace())
sys.modules.setdefault("mcp.client.stdio", SimpleNamespace(stdio_client=None))
sys.modules.setdefault("mcp.server", SimpleNamespace(Server=object))
sys.modules.setdefault("mcp.server.stdio", SimpleNamespace(stdio_server=None))

from backend.server import CockpitApp


class AgentExecutionWaitRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_dashboard_planning_message_is_dispatched_in_background(self) -> None:
        received: list[dict[str, object]] = []

        async def run_background(_websocket: object, message: dict[str, object]) -> None:
            received.append(message)

        app = object.__new__(CockpitApp)
        app._dashboard_tasks = set()
        app.run_background_dashboard_message = run_background
        message = {"type": "matrix_plan_waypoint_paths", "droplet_id": 1, "waypoints": [[2, 3]]}

        await app.handle_message(object(), message)
        task = next(iter(app._dashboard_tasks))
        await task

        self.assertEqual(received, [message])

    async def test_background_dashboard_planning_messages_are_serialized(self) -> None:
        entered: list[int] = []
        release_first = asyncio.Event()

        async def handle_message(
            _websocket: object,
            message: dict[str, object],
            *,
            background: bool = False,
        ) -> None:
            self.assertTrue(background)
            entered.append(int(message["droplet_id"]))
            if message["droplet_id"] == 1:
                await release_first.wait()

        app = object.__new__(CockpitApp)
        app._dashboard_planning_lock = asyncio.Lock()
        app.handle_message = handle_message
        first = asyncio.create_task(
            app.run_background_dashboard_message(object(), {"droplet_id": 1})
        )
        await asyncio.sleep(0)
        second = asyncio.create_task(
            app.run_background_dashboard_message(object(), {"droplet_id": 2})
        )
        await asyncio.sleep(0)

        self.assertEqual(entered, [1])
        release_first.set()
        await asyncio.gather(first, second)
        self.assertEqual(entered, [1, 2])

    async def test_dashboard_plan_waits_for_background_job_completion(self) -> None:
        calls: list[tuple[str, dict[str, object]]] = []

        async def safe_tool(
            tool: str,
            arguments: dict[str, object] | None = None,
            timeout_seconds: float | None = None,
        ) -> dict[str, object]:
            calls.append((tool, arguments or {}))
            if tool == "plan_move":
                return {
                    "ok": True,
                    "result": {
                        "structuredContent": {
                            "ok": True,
                            "running": True,
                            "completed": False,
                            "recommended_wait_seconds": 0.05,
                        }
                    },
                }
            return {
                "ok": True,
                "result": {
                    "structuredContent": {
                        "ok": True,
                        "running": False,
                        "completed": True,
                    }
                },
            }

        app = object.__new__(CockpitApp)
        app.safe_tool = safe_tool

        with patch("backend.server.asyncio.sleep", new=fake_sleep):
            result = await app.plan_dashboard_move("sipp")

        self.assertEqual(calls, [
            (
                "plan_move",
                {
                    "mode": "sipp",
                    "remove_duplicate_frames": False,
                    "planning_timeout": 120.0,
                    "background": True,
                },
            ),
            ("planning_job_status", {}),
        ])
        self.assertTrue(result["result"]["structuredContent"]["completed"])

    async def test_dashboard_plan_rejects_terminal_incomplete_job(self) -> None:
        responses = [
            {"ok": True, "running": True, "completed": False, "recommended_wait_seconds": 0.05},
            {"ok": True, "running": False, "completed": False},
        ]

        async def safe_tool(
            _tool: str,
            _arguments: dict[str, object] | None = None,
            timeout_seconds: float | None = None,
        ) -> dict[str, object]:
            return {"ok": True, "result": {"structuredContent": responses.pop(0)}}

        app = object.__new__(CockpitApp)
        app.safe_tool = safe_tool

        with patch("backend.server.asyncio.sleep", new=fake_sleep):
            result = await app.plan_dashboard_move("sipp")

        self.assertFalse(result["ok"])
        self.assertTrue(result["isError"])
        self.assertIn("before completion", result["error"])

    async def test_dashboard_plan_rejects_completed_job_with_error(self) -> None:
        async def safe_tool(
            _tool: str,
            _arguments: dict[str, object] | None = None,
            timeout_seconds: float | None = None,
        ) -> dict[str, object]:
            return {
                "ok": True,
                "result": {
                    "structuredContent": {
                        "ok": True,
                        "running": False,
                        "completed": True,
                        "error": "planner failed",
                    }
                },
            }

        app = object.__new__(CockpitApp)
        app.safe_tool = safe_tool

        result = await app.plan_dashboard_move("sipp")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "planner failed")

    async def test_resume_plan_is_not_rewritten_to_breakpoint_execution(self) -> None:
        class FakeMcp:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            async def call_tool(self, tool: str, arguments: dict[str, object], **_kwargs: object) -> dict[str, object]:
                self.calls.append((tool, arguments))
                return {"structuredContent": {"ok": True, "resumed": True}}

        app = object.__new__(CockpitApp)
        app.mcp = FakeMcp()
        app.ensure_mcp_started_for_tool = fake_no_restart

        result = await app.call_agent_mcp_tool(
            "resume_plan",
            {
                "execution_view_mode": "whole_chip_camera",
                "verify_positions": False,
                "frame_delay": 1.0,
                "restart_from_beginning": True,
            },
        )
        payload = result["structuredContent"]

        self.assertEqual(app.mcp.calls, [
            (
                "resume_plan",
                {
                    "execution_view_mode": "whole_chip_camera",
                    "verify_positions": False,
                    "frame_delay": 1.0,
                    "restart_from_beginning": True,
                },
            )
        ])
        self.assertEqual(payload["resumed"], True)
        self.assertNotIn("dashboard_routed_from_tool", payload)

    async def test_executor_status_routes_to_timed_wait_when_background_wait_running(self) -> None:
        class FakeMcp:
            def __init__(self) -> None:
                self.running = False
                self.calls: list[tuple[str, dict[str, object]]] = []

            async def call_tool(self, tool: str, arguments: dict[str, object], **_kwargs: object) -> dict[str, object]:
                self.calls.append((tool, arguments))
                if len(self.calls) == 1:
                    return {"structuredContent": {"running": True, "recommended_wait_seconds": 12.0}}
                if len(self.calls) == 2:
                    return {"structuredContent": {"running": True, "recommended_wait_seconds": 12.0}}
                return {"structuredContent": {"running": False, "completed": True, "ok": True}}

        app = object.__new__(CockpitApp)
        app.mcp = FakeMcp()
        app.ensure_mcp_started_for_tool = fake_no_restart

        with patch("backend.server.asyncio.sleep", new=fake_sleep):
            result = await app.call_agent_mcp_tool("executor_status", {})
        payload = result["structuredContent"]

        self.assertEqual(app.mcp.calls, [
            ("execution_wait_status", {"wait_seconds": 0.0}),
            ("execution_wait_status", {"wait_seconds": 0.0}),
            ("execution_wait_status", {"wait_seconds": 0.0}),
        ])
        self.assertEqual(payload["dashboard_routed_from_tool"], "executor_status")
        self.assertEqual(payload["dashboard_actual_tool"], "execution_wait_status")
        self.assertEqual(payload["status_wait"]["requested_seconds"], 12.0)
        self.assertEqual(payload["status_wait"]["effective_seconds"], 12.0)
        self.assertEqual(payload["status_wait"]["return_reason"], "wait_completed")

    async def test_executor_status_routed_wait_uses_execution_wait_health_guard(self) -> None:
        class FakeMcp:
            def __init__(self) -> None:
                self.running = True
                self.calls: list[tuple[str, dict[str, object]]] = []

            async def call_tool(self, tool: str, arguments: dict[str, object], **_kwargs: object) -> dict[str, object]:
                self.calls.append((tool, arguments))
                return {"structuredContent": {"running": True}}

        app = object.__new__(CockpitApp)
        app.mcp = FakeMcp()
        app.ensure_mcp_started_for_tool = fake_no_restart
        app.safe_tool = fake_unhealthy_tool

        result = await app.call_agent_mcp_tool("executor_status", {})

        self.assertEqual(app.mcp.calls, [])
        self.assertEqual(result["reason"], "mcp_runtime_health_failed")
        self.assertEqual(result["tool_not_run"], "execution_wait_status")
        self.assertEqual(result["dashboard_routed_from_tool"], "executor_status")
        self.assertEqual(result["dashboard_actual_tool"], "execution_wait_status")

    async def test_planning_job_status_waits_when_background_planning_running(self) -> None:
        class FakeMcp:
            def __init__(self) -> None:
                self.calls: list[tuple[str, dict[str, object]]] = []

            async def call_tool(self, tool: str, arguments: dict[str, object], **_kwargs: object) -> dict[str, object]:
                self.calls.append((tool, arguments))
                if len(self.calls) == 1:
                    return {"structuredContent": {"running": True, "recommended_wait_seconds": 9.0}}
                return {"structuredContent": {"running": False, "completed": True, "ok": True}}

        app = object.__new__(CockpitApp)
        app.mcp = FakeMcp()
        app.ensure_mcp_started_for_tool = fake_no_restart

        with patch("backend.server.asyncio.sleep", new=fake_sleep):
            result = await app.call_agent_mcp_tool("planning_job_status", {})
        payload = result["structuredContent"]

        self.assertEqual(app.mcp.calls, [
            ("planning_job_status", {}),
            ("planning_job_status", {}),
        ])
        self.assertEqual(payload["status_wait"]["requested_seconds"], 9.0)
        self.assertEqual(payload["status_wait"]["effective_seconds"], 9.0)
        self.assertEqual(payload["status_wait"]["return_reason"], "planning_completed")


async def fake_no_restart(*_args: object, **_kwargs: object) -> bool:
    return False


async def fake_sleep(_seconds: float) -> None:
    return None


async def fake_unhealthy_tool(*_args: object, **_kwargs: object) -> dict[str, object]:
    return {"ok": False, "error": "queue workers stopped"}


class HealthGuardTests(unittest.TestCase):
    def test_melting_curve_capture_requires_health(self) -> None:
        self.assertTrue(CockpitApp.mcp_tool_requires_health("start_melting_curve_capture", {}))

    def test_droplet_image_capture_requires_health(self) -> None:
        self.assertTrue(CockpitApp.mcp_tool_requires_health("capture_droplet_images", {}))


class ProxyStartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_websocket_startup_failure_closes_started_servers(self) -> None:
        try:
            from backend import mcp_proxy
        except ModuleNotFoundError as exc:
            if exc.name == "mcp":
                self.skipTest("mcp package is not installed")
            raise

        config = SimpleNamespace(host="127.0.0.1", port=8787)

        class FakeMcp:
            def __init__(self) -> None:
                self.stopped = False

            async def stop(self) -> None:
                self.stopped = True

        class FakeApp:
            def __init__(self) -> None:
                self.recorder = SimpleNamespace(runs_dir=Path("."))
                self.mcp = FakeMcp()
                self.live_polling_stopped = False

            async def record(self, *args: object, **kwargs: object) -> dict[str, object]:
                return {}

            async def stop_live_polling(self) -> None:
                self.live_polling_stopped = True

            async def handle_ws(self, *args: object, **kwargs: object) -> None:
                return None

            async def handle_live_ws(self, *args: object, **kwargs: object) -> None:
                return None

        class FakeHttpServer:
            def __init__(self) -> None:
                self.shutdown_called = False
                self.server_close_called = False

            def shutdown(self) -> None:
                self.shutdown_called = True

            def server_close(self) -> None:
                self.server_close_called = True

        class FakeWebSocketServer:
            def __init__(self) -> None:
                self.close_called = False
                self.wait_closed_called = False

            def close(self) -> None:
                self.close_called = True

            async def wait_closed(self) -> None:
                self.wait_closed_called = True

        class FakeServer:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def list_tools(self) -> object:
                def decorator(func: object) -> object:
                    return func

                return decorator

            def call_tool(self, *args: object, **kwargs: object) -> object:
                def decorator(func: object) -> object:
                    return func

                return decorator

        fake_app = FakeApp()
        fake_httpd = FakeHttpServer()
        main_ws_server = FakeWebSocketServer()

        async def fake_serve(handler: object, host: str, port: int, max_size: object = None) -> FakeWebSocketServer:
            if port == config.port + 2:
                raise RuntimeError("live bind failed")
            return main_ws_server

        with (
            patch.object(mcp_proxy, "load_config", return_value=config),
            patch.object(mcp_proxy, "CockpitApp", return_value=fake_app),
            patch.object(mcp_proxy, "Server", FakeServer),
            patch.object(mcp_proxy, "start_http_server", return_value=fake_httpd),
            patch.object(mcp_proxy.websockets, "serve", new=fake_serve),
        ):
            with self.assertRaisesRegex(RuntimeError, "live bind failed"):
                await mcp_proxy.run_proxy(None)

        self.assertTrue(main_ws_server.close_called)
        self.assertTrue(main_ws_server.wait_closed_called)
        self.assertTrue(fake_httpd.shutdown_called)
        self.assertTrue(fake_httpd.server_close_called)
        self.assertTrue(fake_app.live_polling_stopped)
        self.assertTrue(fake_app.mcp.stopped)


if __name__ == "__main__":
    unittest.main()
