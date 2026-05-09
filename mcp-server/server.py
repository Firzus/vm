"""Host MCP server for the Cursor-style VM.

Proxies the in-container automation API (``VM_API_URL``) and runs host-side
``docker compose`` for lifecycle (up/down/reset).
"""

from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Annotated, Literal

import httpx
from mcp.server.fastmcp import FastMCP, Image
from pydantic import Field

VM_API_URL = os.environ.get("VM_API_URL", "http://localhost:8000")
COMPOSE_DIR = Path(
    os.environ.get("VM_COMPOSE_DIR", str(Path(__file__).resolve().parent.parent))
)
COMPOSE_SERVICE = os.environ.get("VM_COMPOSE_SERVICE", "vm")

mcp = FastMCP("cursor-vm")
client = httpx.Client(base_url=VM_API_URL, timeout=120.0)


def _api(method: str, path: str, **kwargs) -> dict:
    resp = client.request(method, path, **kwargs)
    resp.raise_for_status()
    if resp.headers.get("content-type", "").startswith("application/json"):
        return resp.json()
    return {"status_code": resp.status_code, "text": resp.text}


def _compose(*args: str, timeout: float = 600.0) -> dict:
    proc = subprocess.run(
        ["docker", "compose", *args],
        cwd=str(COMPOSE_DIR),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return {
        "cmd": ["docker", "compose", *args],
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


@mcp.tool()
def health() -> dict:
    """Check the in-VM automation API is reachable."""
    return _api("GET", "/health")


@mcp.tool()
def screen_size() -> dict:
    """Return the VM virtual screen dimensions (width, height)."""
    return _api("GET", "/screen_size")


@mcp.tool()
def cursor_position() -> dict:
    """Return the current mouse cursor position."""
    return _api("GET", "/cursor_position")


@mcp.tool()
def list_windows() -> dict:
    """List currently open desktop windows (id, desktop, host, title)."""
    return _api("GET", "/windows")


@mcp.tool()
def screenshot() -> Image:
    """Capture a PNG screenshot of the VM desktop."""
    resp = client.get("/screenshot")
    resp.raise_for_status()
    return Image(data=resp.content, format="png")


@mcp.tool()
def move_mouse(
    x: Annotated[int, Field(ge=0)],
    y: Annotated[int, Field(ge=0)],
) -> dict:
    """Move the mouse cursor to (x, y)."""
    return _api("POST", "/move", json={"x": x, "y": y})


@mcp.tool()
def click(
    x: Annotated[int, Field(ge=0)],
    y: Annotated[int, Field(ge=0)],
    button: Literal["left", "middle", "right"] = "left",
    clicks: Annotated[int, Field(ge=1, le=5)] = 1,
) -> dict:
    """Click at (x, y). Supports left/middle/right and up to 5 clicks."""
    return _api(
        "POST",
        "/click",
        json={"x": x, "y": y, "button": button, "clicks": clicks},
    )


@mcp.tool()
def double_click(x: int, y: int) -> dict:
    """Double left-click at (x, y)."""
    return _api("POST", "/double_click", json={"x": x, "y": y})


@mcp.tool()
def right_click(x: int, y: int) -> dict:
    """Right-click at (x, y)."""
    return _api("POST", "/right_click", json={"x": x, "y": y})


@mcp.tool()
def scroll(
    x: int,
    y: int,
    direction: Literal["up", "down", "left", "right"] = "down",
    amount: Annotated[int, Field(ge=1, le=50)] = 3,
) -> dict:
    """Scroll the wheel at (x, y) in the given direction."""
    return _api(
        "POST",
        "/scroll",
        json={"x": x, "y": y, "direction": direction, "amount": amount},
    )


@mcp.tool()
def drag(
    from_x: int,
    from_y: int,
    to_x: int,
    to_y: int,
    button: Literal["left", "middle", "right"] = "left",
) -> dict:
    """Drag from (from_x, from_y) to (to_x, to_y) with the given button held."""
    return _api(
        "POST",
        "/drag",
        json={
            "from": {"x": from_x, "y": from_y},
            "to": {"x": to_x, "y": to_y},
            "button": button,
        },
    )


@mcp.tool()
def type_text(
    text: str,
    delay_ms: Annotated[int, Field(ge=0, le=500)] = 12,
) -> dict:
    """Type literal text at the current keyboard focus."""
    return _api("POST", "/type", json={"text": text, "delay_ms": delay_ms})


@mcp.tool()
def press_key(
    keys: str,
    repeat: Annotated[int, Field(ge=1, le=20)] = 1,
) -> dict:
    """Send an xdotool key combo, e.g. 'Return', 'ctrl+t', 'alt+F4', 'super'."""
    return _api("POST", "/key", json={"keys": keys, "repeat": repeat})


@mcp.tool()
def shell(
    cmd: str,
    timeout: Annotated[float, Field(ge=0.1, le=600.0)] = 60.0,
) -> dict:
    """Run an arbitrary shell command inside the VM container.

    Returns ``{cmd, returncode, stdout, stderr}``. Use this for filesystem
    inspection, scripting, or anything not covered by the dedicated tools.
    """
    return _api("POST", "/shell", json={"cmd": cmd, "timeout": timeout})


@mcp.tool()
def launch_app(name: str) -> dict:
    """Launch a desktop application detached from the API request.

    ``name`` is parsed as a shell command line, e.g. ``xfce4-terminal`` or
    ``google-chrome --no-sandbox https://example.com``.
    """
    resp = client.post("/launch", params={"name": name})
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def open_url(url: str) -> dict:
    """Open a URL in Google Chrome (creates a new window/tab)."""
    cmd = f"google-chrome --no-sandbox {shlex.quote(url)}"
    resp = client.post("/launch", params={"name": cmd})
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def launch_chrome_debug(
    url: str | None = None,
    port: Annotated[int, Field(ge=1024, le=65535)] = 9222,
) -> dict:
    """Launch Chrome inside the VM with the DevTools Protocol exposed.

    Required before pointing chrome-devtools-mcp (or any CDP client) at the
    VM. Modern Chrome ignores ``--remote-debugging-address=0.0.0.0`` and
    only listens on loopback, so this tool also starts a ``socat`` forwarder
    that bridges ``0.0.0.0:<port>`` to Chrome's loopback listener.

    Kills any existing Chrome instance first. The forwarded port must be
    published in ``docker-compose.yml`` for the host to reach it.
    """
    chrome_internal_port = port + 1
    # [g]oogle / [s]ocat patterns so pgrep does not match this shell
    setup = (
        "command -v socat >/dev/null || (apt-get update -q && apt-get install -y -q socat) >/dev/null 2>&1; "
        "for p in $(pgrep -f \"/opt/[g]oogle/chrome/chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        "for p in $(pgrep -f \"/usr/bin/[g]oogle-chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        f"for p in $(pgrep -f \"[s]ocat TCP-LISTEN:{port}\"); do kill -9 $p 2>/dev/null || true; done; "
        "sleep 2; "
    )
    chrome_flags = (
        f"--no-sandbox "
        f"--remote-debugging-port={chrome_internal_port} "
        f"--user-data-dir=/root/.config/google-chrome-debug "
        f"--no-first-run --no-default-browser-check "
        f"--disable-features=PrivacySandboxSettings4"
    )
    target = shlex.quote(url) if url else "about:blank"
    chrome_cmd = f"google-chrome {chrome_flags} {target}"
    socat_cmd = (
        f"setsid socat TCP-LISTEN:{port},fork,reuseaddr,bind=0.0.0.0 "
        f"TCP:127.0.0.1:{chrome_internal_port} "
        f">/tmp/socat-{port}.log 2>&1 < /dev/null & disown"
    )
    full = (
        setup
        + f"setsid {chrome_cmd} >/tmp/launch-chrome-debug.log 2>&1 < /dev/null & disown; "
        + "sleep 5; "
        + socat_cmd + "; "
        + "sleep 1; "
        + f"curl -fsS http://127.0.0.1:{chrome_internal_port}/json/version | head -3"
    )
    result = _api("POST", "/shell", json={"cmd": full, "timeout": 120})
    return {
        **result,
        "debug_port": port,
        "chrome_loopback_port": chrome_internal_port,
    }


@mcp.tool()
def kill_chrome() -> dict:
    """Force-quit Chrome inside the VM (pgrep patterns exclude this shell)."""
    cmd = (
        "for p in $(pgrep -f \"/opt/[g]oogle/chrome/chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        "for p in $(pgrep -f \"/usr/bin/[g]oogle-chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        "sleep 1; "
        "pgrep -af \"/opt/[g]oogle/chrome/chrome\" || echo 'no chrome running'"
    )
    return _api("POST", "/shell", json={"cmd": cmd, "timeout": 15})


@mcp.tool()
def list_downloads() -> dict:
    """List files in /root/Downloads (where Chrome saves files by default)."""
    return _api(
        "POST",
        "/shell",
        json={"cmd": "ls -la /root/Downloads", "timeout": 10},
    )


@mcp.tool()
def install_apt(
    package: str,
    update: bool = True,
    timeout: Annotated[float, Field(ge=1.0, le=600.0)] = 600.0,
) -> dict:
    """apt-get install a package by name. Set update=false to skip apt-get update."""
    parts = []
    if update:
        parts.append("apt-get update")
    parts.append(f"apt-get install -y {shlex.quote(package)}")
    return _api(
        "POST",
        "/shell",
        json={"cmd": " && ".join(parts), "timeout": timeout},
    )


@mcp.tool()
def install_deb(
    deb_path: str,
    timeout: Annotated[float, Field(ge=1.0, le=600.0)] = 600.0,
) -> dict:
    """Install a local .deb file inside the VM (resolves deps via apt)."""
    return _api(
        "POST",
        "/shell",
        json={
            "cmd": f"apt-get install -y {shlex.quote(deb_path)}",
            "timeout": timeout,
        },
    )


@mcp.tool()
def uninstall_apt(
    package: str,
    purge: bool = True,
    autoremove: bool = True,
    timeout: Annotated[float, Field(ge=1.0, le=600.0)] = 600.0,
) -> dict:
    """apt-get remove (or purge) a package, optionally followed by autoremove."""
    op = "purge" if purge else "remove"
    parts = [f"apt-get {op} -y {shlex.quote(package)}"]
    if autoremove:
        parts.append("apt-get autoremove -y")
    return _api(
        "POST",
        "/shell",
        json={"cmd": " && ".join(parts), "timeout": timeout},
    )


@mcp.tool()
def list_installed(filter_substr: str | None = None) -> dict:
    """List installed apt packages (name + version). Optional substring filter."""
    base = "dpkg-query -W -f='${Package}\\t${Version}\\n'"
    cmd = f"{base} | sort"
    if filter_substr:
        cmd = f"{base} | grep -i {shlex.quote(filter_substr)} | sort"
    return _api("POST", "/shell", json={"cmd": cmd, "timeout": 30})


@mcp.tool()
def vm_status() -> dict:
    """Return ``docker compose ps`` for the VM stack."""
    return _compose("ps")


@mcp.tool()
def vm_up(rebuild: bool = False) -> dict:
    """Start the VM (no reset). Set rebuild=true to also rebuild the image."""
    args = ["up", "-d"]
    if rebuild:
        args.append("--build")
    return _compose(*args)


@mcp.tool()
def vm_down(wipe: bool = False) -> dict:
    """Stop the VM. Set wipe=true to also remove the /root volume (hard reset on next up)."""
    args = ["down"]
    if wipe:
        args.append("-v")
    return _compose(*args)


@mcp.tool()
def vm_restart() -> dict:
    """Soft-restart the VM container. Keeps installed apps and /root contents."""
    return _compose("restart", COMPOSE_SERVICE)


@mcp.tool()
def vm_reset(rebuild: bool = False) -> dict:
    """Hard-reset the VM: wipes the /root volume, then brings the stack back up.

    Destroys downloads, browser profile data, and anything installed in the
    user volume. Image-baseline software (Chrome, XFCE, etc.) survives.
    Use ``rebuild=true`` to also rebuild the Docker image first.
    """
    down = _compose("down", "-v")
    if down["returncode"] != 0:
        return {"step": "down", **down}
    args = ["up", "-d"]
    if rebuild:
        args.append("--build")
    up = _compose(*args)
    return {"down": down, "up": up}


if __name__ == "__main__":
    mcp.run()
