"""Smoke test: stdio MCP client against the multi-VM controller.

Lifecycle covered:
  1. list_vms (initial)
  2. create_vm (label="smoke")
  3. health, screen_size on the new VM (via implicit single-VM resolution)
  4. shell  (echo + uname)
  5. list_installed (chrome filter)
  6. delete_vm (wipe)
  7. list_vms (final, expect empty unless other VMs exist)

Pre-requisites:
  - Controller is up:  cd apps/controller && pnpm start  (http://localhost:3000)
  - Docker daemon reachable.

Usage from the repo root:

    .\\apps\\mcp-server\\.venv\\Scripts\\python.exe apps\\mcp-server\\smoke_test_cursor_vm.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Script lives at <repo>/apps/mcp-server/smoke_test_cursor_vm.py — climb two levels.
REPO = Path(__file__).resolve().parent.parent.parent
PYTHON = REPO / "apps" / "mcp-server" / ".venv" / "Scripts" / "python.exe"
SERVER = REPO / "apps" / "mcp-server" / "server.py"


async def call(
    session: ClientSession,
    name: str,
    args: dict | None = None,
) -> str:
    args = args or {}
    print(f"\n>>> {name}({args})")
    res = await session.call_tool(name, args)
    out_parts: list[str] = []
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
            "CONTROLLER_URL": os.environ.get(
                "CONTROLLER_URL", "http://localhost:3000"
            ),
        },
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print(f"Connected: {init.serverInfo.name}")

            tools = await session.list_tools()
            names = sorted(t.name for t in tools.tools)
            print(f"{len(names)} tools: {', '.join(names)}")

            await call(session, "list_vms")

            created_raw = await call(
                session, "create_vm", {"label": "smoke"}
            )
            created = json.loads(created_raw)
            vm_id = created["vm"]["id"]
            print(f"  → created vm_id={vm_id}")

            # Give Xvfb / API a few seconds to come up before the first probe.
            await asyncio.sleep(8)

            await call(session, "health", {"vm_id": vm_id})
            await call(session, "screen_size", {"vm_id": vm_id})
            await call(
                session,
                "shell",
                {
                    "cmd": "echo hello from VM && uname -a",
                    "vm_id": vm_id,
                },
            )
            await call(
                session,
                "list_installed",
                {"filter_substr": "chrome", "vm_id": vm_id},
            )
            await call(session, "list_downloads", {"vm_id": vm_id})

            await call(session, "delete_vm", {"vm_id": vm_id, "wipe": True})
            await call(session, "list_vms")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
