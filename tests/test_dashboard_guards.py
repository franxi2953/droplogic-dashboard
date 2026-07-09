from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.server import CockpitApp


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
