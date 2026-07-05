from __future__ import annotations

import asyncio
import os
import sys
import time
from datetime import timedelta
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class McpStdioClient:
    def __init__(self, command: str, args: list[str], env: dict[str, str] | None = None, cwd: str | None = None):
        self.command = command
        self.args = args
        self.env = env or {}
        self.cwd = cwd
        self._stack: AsyncExitStack | None = None
        self._session: ClientSession | None = None
        self._lock = asyncio.Lock()
        self._exclusive_call_lock = asyncio.Lock()
        self._call_semaphore = asyncio.Semaphore(8)

    @property
    def running(self) -> bool:
        return self._session is not None

    def command_line(self) -> str:
        return " ".join([self.command, *self.args])

    async def start(self) -> None:
        async with self._lock:
            if self._session is not None:
                return
            env = os.environ.copy()
            env.update(self.env)
            params = StdioServerParameters(
                command=self.command,
                args=self.args,
                env=env,
                cwd=self.cwd,
            )
            stack = AsyncExitStack()
            read, write = await stack.enter_async_context(stdio_client(params, errlog=sys.stderr))
            session = await stack.enter_async_context(ClientSession(read, write, read_timeout_seconds=None))
            await session.initialize()
            self._stack = stack
            self._session = session

    async def stop(self) -> None:
        async with self._lock:
            stack = self._stack
            self._session = None
            self._stack = None
            if stack is not None:
                try:
                    await stack.aclose()
                except BaseException as exc:
                    if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                        raise

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
        *,
        read_timeout_seconds: float | None = None,
        exclusive: bool = False,
    ) -> Any:
        result, _ = await self.call_tool_timed(
            name,
            arguments,
            read_timeout_seconds=read_timeout_seconds,
            exclusive=exclusive,
        )
        return result

    async def call_tool_timed(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
        *,
        read_timeout_seconds: float | None = None,
        exclusive: bool = False,
    ) -> tuple[Any, dict[str, float]]:
        if self._session is None:
            raise RuntimeError("MCP server is not running.")
        started = time.perf_counter()
        lock = self._exclusive_call_lock if exclusive else self._call_semaphore
        async with lock:
            acquired = time.perf_counter()
            timeout = (
                timedelta(seconds=max(0.001, float(read_timeout_seconds)))
                if read_timeout_seconds is not None
                else None
            )
            result = await self._session.call_tool(
                name,
                arguments or {},
                read_timeout_seconds=timeout,
            )
            finished = time.perf_counter()
        timing = {
            "mcp_lock_wait_seconds": round(max(0.0, acquired - started), 4),
            "mcp_call_seconds": round(max(0.0, finished - acquired), 4),
            "mcp_total_seconds": round(max(0.0, finished - started), 4),
        }
        return mcp_result_to_json(result), timing

    async def list_tools(self) -> Any:
        if self._session is None:
            raise RuntimeError("MCP server is not running.")
        async with self._exclusive_call_lock:
            result = await self._session.list_tools()
        return mcp_result_to_json(result)


def mcp_result_to_json(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [mcp_result_to_json(item) for item in value]
    if isinstance(value, tuple):
        return [mcp_result_to_json(item) for item in value]
    if isinstance(value, dict):
        return {str(key): mcp_result_to_json(item) for key, item in value.items()}
    return str(value)
