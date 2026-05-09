"""Smoke test: spawn chrome-devtools-mcp via stdio (using the official MCP
Python SDK) and verify it can connect to the Chrome we launched in the VM
via socat on http://127.0.0.1:9222.

Run from the host:

    python mcp-server/smoke_test_cdm.py
"""

from __future__ import annotations

import asyncio
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main() -> int:
    is_win = sys.platform == "win32"
    params = StdioServerParameters(
        command="cmd" if is_win else "npx",
        args=(
            ["/c", "npx", "-y", "chrome-devtools-mcp@latest",
             "--browserUrl=http://127.0.0.1:9222",
             "--logFile=mcp-server/.cdm-mcp.log"]
            if is_win else
            ["-y", "chrome-devtools-mcp@latest",
             "--browserUrl=http://127.0.0.1:9222",
             "--logFile=mcp-server/.cdm-mcp.log"]
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
            print(f"Connected to: {init.serverInfo.name} v{init.serverInfo.version}")

            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            print(f"\n{len(names)} tools exposed:")
            for n in names:
                print(f"  - {n}")

            if "list_pages" in names:
                print("\nCalling list_pages...")
                result = await session.call_tool("list_pages", {})
                for c in result.content:
                    text = getattr(c, "text", str(c))
                    print(text[:800])

            if "navigate_page" in names:
                print("\nCalling navigate_page(https://example.com)...")
                try:
                    result = await asyncio.wait_for(
                        session.call_tool("navigate_page", {"url": "https://example.com"}),
                        timeout=30,
                    )
                    for c in result.content:
                        text = getattr(c, "text", str(c))
                        print(text[:600])
                except asyncio.TimeoutError:
                    print("navigate_page timed out (>30s)")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
