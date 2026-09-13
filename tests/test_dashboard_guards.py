from __future__ import annotations

import asyncio
import json
import tempfile
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

from backend.agent_tools import filter_agent_tools
from backend.mcp_client import McpStdioClient
from backend.runtime_utils import websocket_closed_ok
from backend.server import CockpitApp, exception_diagnostic, parse_next_guide_declaration


class AgentFailureDiagnosticTests(unittest.TestCase):
    def test_empty_exception_keeps_type_and_repr(self) -> None:
        self.assertEqual(
            exception_diagnostic(AssertionError()),
            "AssertionError: AssertionError()",
        )

    def test_dashboard_watchdog_close_codes_are_expected_disconnects(self) -> None:
        self.assertTrue(
            websocket_closed_ok(
                RuntimeError(
                    "received 4000 (private use) dashboard main websocket stale; "
                    "then sent 4000 (private use) dashboard main websocket stale"
                )
            )
        )
        self.assertTrue(
            websocket_closed_ok(
                RuntimeError(
                    "received 4001 (private use) dashboard live websocket stale; "
                    "then sent 4001 (private use) dashboard live websocket stale"
                )
            )
        )
        self.assertFalse(websocket_closed_ok(RuntimeError("received 4002 unexpected failure")))


class AgentContinuityGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = object.__new__(CockpitApp)

    def test_successful_reset_blocks_destructive_repeat_and_requires_droplet(self) -> None:
        state: dict[str, object] = {}
        self.app.update_agent_continuity_state(
            state,
            "load_system",
            {"system": "boxmini", "reset_matrix": True},
            {"ok": True},
        )

        repeated = self.app.agent_continuity_guard_result(
            state,
            "load_system",
            {"system": "boxmini", "reset_matrix": True},
        )
        premature_plan = self.app.agent_continuity_guard_result(state, "plan_move", {})

        self.assertEqual(repeated["reason"], "agent_state_continuity_guard")
        self.assertEqual(premature_plan["required_next_tool"], "create_droplet")

    def test_created_droplet_allows_planning_but_not_a_later_reset(self) -> None:
        state: dict[str, object] = {}
        self.app.update_agent_continuity_state(
            state,
            "load_system",
            {"system": "boxmini", "reset_matrix": True},
            {"ok": True},
        )
        self.app.update_agent_continuity_state(
            state,
            "create_droplet",
            {"droplet_id": 1},
            {"ok": True},
        )

        self.assertIsNone(self.app.agent_continuity_guard_result(state, "plan_move", {}))
        self.assertIsNotNone(
            self.app.agent_continuity_guard_result(
                state,
                "restart_system",
                {"system": "boxmini", "reset_matrix": True},
            )
        )


class LiveWebSocketDisconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_expected_stale_disconnect_is_not_recorded_as_an_error(self) -> None:
        class StaleSocket:
            def __aiter__(self) -> "StaleSocket":
                return self

            async def __anext__(self) -> object:
                raise RuntimeError(
                    "received 4001 (private use) dashboard live websocket stale; "
                    "then sent 4001 (private use) dashboard live websocket stale"
                )

        recorded: list[tuple[str, dict[str, object]]] = []
        app = object.__new__(CockpitApp)
        app.live_clients = set()
        app._client_send_locks = {}
        app.live = {}

        async def record(event_type: str, **fields: object) -> dict[str, object]:
            recorded.append((event_type, fields))
            return {}

        app.record = record
        socket = StaleSocket()
        await app.handle_live_ws(socket)

        self.assertEqual(recorded, [])
        self.assertNotIn(socket, app.live_clients)


class McpToolCatalogRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_tools_retries_without_restarting_mcp(self) -> None:
        class FakeSession:
            def __init__(self) -> None:
                self.calls = 0

            async def list_tools(self) -> dict[str, object]:
                self.calls += 1
                if self.calls == 1:
                    raise AssertionError()
                return {"tools": []}

        client = McpStdioClient("py", [])
        session = FakeSession()
        client._session = session

        with patch("backend.mcp_client.asyncio.sleep", new=fake_sleep):
            result = await client.list_tools()

        self.assertEqual(result, {"tools": []})
        self.assertEqual(session.calls, 2)


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


class MainWebSocketHeartbeatTests(unittest.IsolatedAsyncioTestCase):
    async def test_status_heartbeat_is_not_blocked_by_slow_ui_command(self) -> None:
        slow_command_started = asyncio.Event()
        release_slow_command = asyncio.Event()
        sent_payloads: list[dict[str, object]] = []

        class FakeWebSocket:
            async def send(self, raw: str) -> None:
                sent_payloads.append(json.loads(raw))

            async def __aiter__(self):
                yield json.dumps({"type": "slow_ui_command"})
                await slow_command_started.wait()
                yield json.dumps({"type": "get_status"})

        app = object.__new__(CockpitApp)
        app.clients = set()
        app.live = None
        app._client_send_locks = {}
        app.status = lambda: {"ok": True}
        app.run_loaded_payload = lambda: {"type": "run_loaded"}

        async def fake_safe_send(_websocket: object, payload: dict[str, object]) -> None:
            sent_payloads.append(payload)

        async def fake_handle_message(_websocket: object, message: dict[str, object]) -> None:
            self.assertEqual(message["type"], "slow_ui_command")
            slow_command_started.set()
            await release_slow_command.wait()

        app.safe_send = fake_safe_send
        app.handle_message = fake_handle_message

        await app.handle_ws(FakeWebSocket())

        status_payloads = [
            payload
            for payload in sent_payloads
            if payload == {"type": "status", "status": {"ok": True}}
        ]
        self.assertEqual(len(status_payloads), 2)


class GuideContextGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = object.__new__(CockpitApp)

    def test_temperature_operation_requires_temperature_guide(self) -> None:
        result = self.app.guide_context_guard_result(
            "temperature_hold",
            {"target_celsius": 42.0},
            {"paths": ["agent-guide/08-reservoir-extraction.md"]},
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["missing_guide_paths"], ["agent-guide/11-temperature.md"])
        self.assertTrue(result["isError"])

    def test_melting_capture_needs_imaging_and_temperature_guides(self) -> None:
        blocked = self.app.guide_context_guard_result(
            "start_melting_curve_capture",
            {},
            {"paths": ["agent-guide/11-temperature.md"]},
        )
        allowed = self.app.guide_context_guard_result(
            "start_melting_curve_capture",
            {},
            {
                "paths": [
                    "agent-guide/10-imaging-light-vision.md",
                    "agent-guide/11-temperature.md",
                ]
            },
        )

        self.assertEqual(blocked["missing_guide_paths"], ["agent-guide/10-imaging-light-vision.md"])
        self.assertIsNone(allowed)


class RequiredGuideContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_melting_capture_loads_required_guides_before_execution(self) -> None:
        app = object.__new__(CockpitApp)
        recorded: list[tuple[str, dict[str, object]]] = []
        calls: list[tuple[str, dict[str, object]]] = []

        async def fake_call(tool: str, arguments: dict[str, object]) -> dict[str, object]:
            calls.append((tool, arguments))
            return {
                "ok": True,
                "selected_paths": [
                    "agent-guide/10-imaging-light-vision.md",
                    "agent-guide/11-temperature.md",
                ],
                "reason": "Required guide context for start_melting_curve_capture.",
                "revision": 4,
            }

        async def fake_record(event_type: str, **fields: object) -> dict[str, object]:
            recorded.append((event_type, fields))
            return {}

        app.call_agent_mcp_tool = fake_call
        app.load_turn_guide_expansions = lambda paths: (
            "guide text",
            {"files": [{"path": path} for path in paths]},
        )
        app.record = fake_record
        state = {
            "paths": ["agent-guide/06-planning-execution-rhythm.md"],
            "reason": "Previous planning context.",
            "revision": 3,
        }

        result = await app.ensure_required_guide_context(
            state,
            "start_melting_curve_capture",
            {"start_c": 25, "end_c": 55},
            trigger_round=7,
        )

        self.assertIsNone(result)
        self.assertEqual(calls[0][0], "select_guide_context")
        self.assertEqual(
            calls[0][1]["paths"],
            ["agent-guide/10-imaging-light-vision.md", "agent-guide/11-temperature.md"],
        )
        self.assertEqual(state["paths"], calls[0][1]["paths"])
        self.assertEqual(recorded[0][0], "guide_context_changed")
        self.assertEqual(recorded[0][1]["source"], "tool_requirement")
        self.assertTrue(recorded[0][1]["internal"])

    async def test_required_guides_fail_closed_when_one_does_not_fit(self) -> None:
        app = object.__new__(CockpitApp)

        async def fake_call(_tool: str, _arguments: dict[str, object]) -> dict[str, object]:
            return {
                "ok": True,
                "selected_paths": [
                    "agent-guide/10-imaging-light-vision.md",
                    "agent-guide/11-temperature.md",
                ],
                "revision": 1,
            }

        async def fake_record(_event_type: str, **_fields: object) -> dict[str, object]:
            return {}

        app.call_agent_mcp_tool = fake_call
        app.load_turn_guide_expansions = lambda _paths: (
            "guide text",
            {
                "files": [
                    {"path": "agent-guide/10-imaging-light-vision.md"},
                    {
                        "path": "agent-guide/11-temperature.md",
                        "omitted": True,
                        "reason": "guide_priority_budget_exhausted",
                    },
                ]
            },
        )
        app.record = fake_record
        state = {"paths": [], "reason": "", "revision": 0}

        result = await app.ensure_required_guide_context(
            state,
            "start_melting_curve_capture",
            {},
            trigger_round=2,
        )

        self.assertIsNotNone(result)
        self.assertTrue(result["isError"])
        self.assertEqual(result["missing_guide_paths"], ["agent-guide/11-temperature.md"])
        self.assertEqual(state["paths"], [])

    def test_melting_capture_defaults_to_microscope_mode_and_both_channels(self) -> None:
        app = object.__new__(CockpitApp)
        app.goal_status = lambda: {
            "objective": "Run a melting curve with Brightfield and FAM images at every step.",
        }

        arguments, overrides = app.agent_tool_arguments(
            "start_melting_curve_capture",
            {"start_c": 25, "end_c": 55, "capture_mode": "whole_chip_camera"},
        )

        self.assertEqual(arguments["capture_mode"], "droplets")
        self.assertEqual(arguments["channels"], ["Brightfield", "FAM"])
        self.assertEqual(arguments["capture_source"], "pause_streamer")
        self.assertIn("capture_mode", overrides)
        self.assertIn("channels", overrides)
        self.assertIn("capture_source", overrides)

    def test_persisted_droplet_capture_uses_direct_microscope_source(self) -> None:
        app = object.__new__(CockpitApp)

        arguments, overrides = app.agent_tool_arguments(
            "capture_droplet_images",
            {"droplet_ids": [1], "channels": ["FAM"], "capture_source": "streamer"},
        )

        self.assertEqual(arguments["capture_source"], "pause_streamer")
        self.assertIn("capture_source", overrides)

    def test_melting_goal_rejects_temperature_only_substitute(self) -> None:
        app = object.__new__(CockpitApp)
        app.goal_status = lambda: {
            "objective": "Run a melting curve with Brightfield and FAM images at every step.",
        }

        result = app.melting_capture_workflow_guard_result(
            "temperature_hold",
            {"target_c": 25, "hold_seconds": 120},
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["required_tool"], "start_melting_curve_capture")
        self.assertTrue(result["isError"])


class DashboardGoalCompletionTests(unittest.IsolatedAsyncioTestCase):
    async def test_dashboard_records_agent_completion_without_objective_heuristics(self) -> None:
        app = object.__new__(CockpitApp)
        recorded: list[tuple[str, dict[str, object]]] = []

        async def fake_record(event_type: str, **fields: object) -> dict[str, object]:
            recorded.append((event_type, fields))
            return {}

        async def fake_broadcast(_message: dict[str, object]) -> None:
            return None

        app.goal_status = lambda: {
            "status": "active",
            "objective": "Run a melting curve with images at every temperature step.",
        }
        app.record = fake_record
        app.status = lambda: {"ok": True}
        app.broadcast_json = fake_broadcast

        result = await app.complete_goal_from_agent(
            {"summary": "Melting completed.", "evidence": "All checkpoints documented."}
        )

        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["ok"])
        self.assertEqual(recorded[0][0], "goal_completed")


class GuideContextBudgetTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.app = object.__new__(CockpitApp)

    def test_omitted_shards_are_not_reported_as_effective_context(self) -> None:
        metadata = {
            "files": [
                {"path": "agent-guide/06-planning-execution-rhythm.md"},
                {
                    "path": "agent-guide/11-temperature.md",
                    "omitted": True,
                    "reason": "guide_expansion_char_limit",
                },
            ]
        }

        self.assertEqual(
            CockpitApp.effective_guide_paths(metadata),
            ["agent-guide/06-planning-execution-rhythm.md"],
        )

    def test_agent_tool_catalog_hides_internal_guide_selector(self) -> None:
        tools = filter_agent_tools(
            [
                {"name": "select_guide_context", "description": "Select detailed guides."},
                {"name": "plan_move", "description": "Plan movement."},
            ]
        )

        self.assertEqual([tool["name"] for tool in tools], ["plan_move"])

    def test_ranked_guides_load_as_an_ordered_prefix_within_budget(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shard_dir = root / "agent-guide"
            shard_dir.mkdir()
            paths = ["agent-guide/a.md", "agent-guide/b.md", "agent-guide/c.md"]
            for path in paths:
                (root / path).write_text("x" * 70, encoding="utf-8")
            self.app.pinned_context_roots = lambda: [("default", root)]

            with patch("backend.server.GUIDE_EXPANSION_CHAR_LIMIT", 350):
                _context, metadata = self.app.load_turn_guide_expansions(paths)

        self.assertEqual(self.app.effective_guide_paths(metadata), paths[:2])
        self.assertEqual(
            [item["path"] for item in metadata["files"] if item.get("omitted")],
            paths[2:],
        )


class AgentGuideDeclarationTests(unittest.IsolatedAsyncioTestCase):
    def test_parses_exact_ranked_next_guides_line(self) -> None:
        allowed = ["agent-guide/a.md", "agent-guide/b.md"]

        result = parse_next_guide_declaration(
            'Reasoning summary.\nNEXT_GUIDES: ["agent-guide/b.md", "agent-guide/a.md"]',
            allowed,
        )

        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["paths"], ["agent-guide/b.md", "agent-guide/a.md"])

    def test_rejects_invented_guide_names(self) -> None:
        result = parse_next_guide_declaration(
            'NEXT_GUIDES: ["agent-guide/not-real.md"]',
            ["agent-guide/a.md"],
        )

        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["invalid_paths"], ["agent-guide/not-real.md"])

    async def test_agent_declaration_applies_ranked_prefix_and_records_omissions(self) -> None:
        app = object.__new__(CockpitApp)
        recorded: list[tuple[str, dict[str, object]]] = []
        ranked = ["agent-guide/a.md", "agent-guide/b.md", "agent-guide/c.md"]

        app.available_guide_shards = lambda: [
            {"path": path, "title": path, "chars": 100} for path in ranked
        ]
        app.load_turn_guide_expansions = lambda _paths: (
            "guide context",
            {
                "files": [
                    {"path": ranked[0]},
                    {"path": ranked[1]},
                    {"path": ranked[2], "omitted": True, "reason": "guide_priority_budget_exhausted"},
                ]
            },
        )

        async def fake_record(event_type: str, **fields: object) -> dict[str, object]:
            recorded.append((event_type, fields))
            return {}

        app.record = fake_record
        guide_state = {"paths": [], "reason": "", "revision": 0}
        declaration_state = {"round": 0, "status": "missing", "alert": "MISSING"}

        applied = await app.apply_agent_guide_declaration(
            guide_state,
            declaration_state,
            f'NEXT_GUIDES: {json.dumps(ranked)}',
            round_index=0,
            source="reasoning",
        )

        self.assertTrue(applied)
        self.assertEqual(guide_state["paths"], ranked[:2])
        self.assertEqual(declaration_state["alert"], "")
        self.assertEqual(recorded[0][1]["ranked_paths"], ranked)
        self.assertEqual(recorded[0][1]["omitted_guide_paths"], ranked[2:])

    async def test_invalid_declaration_creates_uppercase_retry_alert(self) -> None:
        app = object.__new__(CockpitApp)
        app.available_guide_shards = lambda: [
            {"path": "agent-guide/a.md", "title": "A", "chars": 100}
        ]

        async def fake_record(_event_type: str, **_fields: object) -> dict[str, object]:
            return {}

        app.record = fake_record
        guide_state = {"paths": [], "reason": "", "revision": 0}
        declaration_state = {"round": 0, "status": "missing", "alert": ""}

        applied = await app.apply_agent_guide_declaration(
            guide_state,
            declaration_state,
            'NEXT_GUIDES: ["agent-guide/invented.md"]',
            round_index=0,
            source="reasoning",
        )

        self.assertFalse(applied)
        self.assertIn("THE PREVIOUS NEXT_GUIDES LINE WAS INVALID", declaration_state["alert"])
        self.assertIn("agent-guide/a.md", declaration_state["alert"])


if __name__ == "__main__":
    unittest.main()
