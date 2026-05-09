"""Smoke test: stdio MCP client against server.py.

Calls health, vm_status, screen_size, list_windows, list_installed (chrome
filter), shell, list_downloads. Does not call vm_reset, screenshot, or the
install path — keep this cheap; run destructive checks manually.

Usage from the repo root:

    .\mcp-server\.venv\Scripts\python.exe mcp-server\smoke_test_cursor_vm.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

REPO = Path(__file__).resolve().parent.parent
PYTHON = REPO / "mcp-server" / ".venv" / "Scripts" / "python.exe"
SERVER = REPO / "mcp-server" / "server.py"


async def call(session: ClientSession, name: str, args: dict | None = None) -> str:
    args = args or {}
    print(f"\n>>> {name}({args})")
    res = await session.call_tool(name, args)
    out_parts = []
    for c in res.content:
        out_parts.append(getattr(c, "text", str(c)))
    out = "\n".join(out_parts)
    truncated = out if len(out) < 800 else out[:800] + " ... [truncated]"
    print(truncated)
    return out


async def main() -> int:
    params = StdioServerParameters(
        command=str(PYTHON),
        args=[str(SERVER)],
        env={
            **os.environ,
            "VM_API_URL": "http://localhost:8000",
            "VM_COMPOSE_DIR": str(REPO),
        },
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print(f"Connected: {init.serverInfo.name}")

            tools = await session.list_tools()
            names = sorted(t.name for t in tools.tools)
            print(f"{len(names)} tools: {', '.join(names)}")

            await call(session, "health")
            await call(session, "vm_status")
            await call(session, "screen_size")
            await call(session, "list_windows")
            await call(session, "list_installed", {"filter_substr": "chrome"})
            await call(session, "shell", {"cmd": "echo hello from VM && uname -a"})
            await call(session, "list_downloads")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
