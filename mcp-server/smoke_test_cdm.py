"""Smoke test: chrome-devtools-mcp pointed at Chrome running inside one of
the controller's VMs.

Workflow:
  1. Ask the controller for a running VM (or create one).
  2. Call cursor-vm.launch_chrome_debug to start Chrome + the socat bridge
     inside the VM. The tool returns the host-side CDP port that the
     controller mapped for that container.
  3. Spawn `chrome-devtools-mcp` over stdio with --browserUrl pointing at
     127.0.0.1:{host_cdp_port} and exercise list_pages / navigate_page.

Run from the repo root once the controller is up (cd controller && pnpm start):

    python mcp-server/smoke_test_cdm.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

REPO = Path(__file__).resolve().parent.parent
PYTHON = REPO / "mcp-server" / ".venv" / "Scripts" / "python.exe"
SERVER = REPO / "mcp-server" / "server.py"
CONTROLLER_URL = os.environ.get("CONTROLLER_URL", "http://localhost:3000")


async def ensure_vm_with_chrome_debug() -> int:
    """Pick (or create) a VM, then ask cursor-vm to launch Chrome with CDP.

    Returns the host-side CDP port chrome-devtools-mcp should attach to.
    """
    params = StdioServerParameters(
        command=str(PYTHON),
        args=[str(SERVER)],
        env={**os.environ, "CONTROLLER_URL": CONTROLLER_URL},
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Pick an existing VM or create one.
            with httpx.Client(base_url=CONTROLLER_URL, timeout=30.0) as http:
                listing = http.get("/api/vms").json()
            vms = listing.get("vms", [])
            if not vms:
                print("No VM running. Creating one...")
                created = await session.call_tool(
                    "create_vm", {"label": "cdm-smoke"}
                )
                vm = json.loads(
                    "\n".join(getattr(c, "text", str(c)) for c in created.content)
                )["vm"]
                vm_id = vm["id"]
                # Wait for the in-VM API to come up.
                await asyncio.sleep(8)
            else:
                vm_id = vms[0]["id"]
                print(f"Reusing existing VM: {vm_id}")

            print("Launching Chrome with CDP inside the VM...")
            launched = await session.call_tool(
                "launch_chrome_debug", {"vm_id": vm_id}
            )
            payload = json.loads(
                "\n".join(getattr(c, "text", str(c)) for c in launched.content)
            )
            host_port = payload.get("host_cdp_port")
            if not host_port:
                raise RuntimeError(
                    f"launch_chrome_debug did not return host_cdp_port: {payload}"
                )
            print(f"  → Chrome CDP host port: {host_port}")
            return int(host_port)


async def run_cdm(host_port: int) -> int:
    is_win = sys.platform == "win32"
    browser_url = f"--browserUrl=http://127.0.0.1:{host_port}"
    log_file = "--logFile=mcp-server/.cdm-mcp.log"
    params = StdioServerParameters(
        command="cmd" if is_win else "npx",
        args=(
            ["/c", "npx", "-y", "chrome-devtools-mcp@latest", browser_url, log_file]
            if is_win
            else ["-y", "chrome-devtools-mcp@latest", browser_url, log_file]
        ),
        env={
            **os.environ,
            "CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS": "1",
            "CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS": "1",
        },
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print(
                f"Connected to: {init.serverInfo.name} v{init.serverInfo.version}"
            )

            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            print(f"\n{len(names)} tools exposed.")

            if "list_pages" in names:
                print("\nCalling list_pages...")
                result = await session.call_tool("list_pages", {})
                for c in result.content:
                    print(getattr(c, "text", str(c))[:800])

            if "navigate_page" in names:
                print("\nCalling navigate_page(https://example.com)...")
                try:
                    result = await asyncio.wait_for(
                        session.call_tool(
                            "navigate_page", {"url": "https://example.com"}
                        ),
                        timeout=30,
                    )
                    for c in result.content:
                        print(getattr(c, "text", str(c))[:600])
                except asyncio.TimeoutError:
                    print("navigate_page timed out (>30s)")

    return 0


async def main() -> int:
    port = await ensure_vm_with_chrome_debug()
    return await run_cdm(port)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
