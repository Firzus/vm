"""Host MCP server for the Cursor-style VM controller.

Talks to the controller (Next.js, default ``http://localhost:3000``) instead
of a single VM API. Every desktop tool takes an explicit ``vm_id`` and is
proxied through the controller's per-VM HTTP route ``/api/vm/{id}/...``.

Lifecycle tools (``create_vm``, ``delete_vm``, ``reset_vm``, ``restart_vm``,
``list_vms``) call the controller's ``/api/vms`` endpoints directly.
"""

from __future__ import annotations

import os
import shlex
from typing import Annotated, Any, Literal

import httpx
from mcp.server.fastmcp import FastMCP, Image
from pydantic import Field

CONTROLLER_URL = os.environ.get("CONTROLLER_URL", "http://localhost:3000")

mcp = FastMCP("cursor-vm")
client = httpx.Client(base_url=CONTROLLER_URL, timeout=120.0)


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------


def _request(method: str, path: str, **kwargs: Any) -> dict:
    resp = client.request(method, path, **kwargs)
    resp.raise_for_status()
    if resp.headers.get("content-type", "").startswith("application/json"):
        return resp.json()
    return {"status_code": resp.status_code, "text": resp.text}


def _vm_api(method: str, vm_id: str, path: str, **kwargs: Any) -> dict:
    """Call the per-VM proxy: /api/vm/{vm_id}/{path}."""
    return _request(method, f"/api/vm/{vm_id}/{path}", **kwargs)


def _resolve_vm_id(vm_id: str | None) -> str:
    """Resolve an optional vm_id. Returns the only VM if exactly one exists."""
    if vm_id:
        return vm_id
    listing = _request("GET", "/api/vms")
    vms = listing.get("vms", [])
    if len(vms) == 1:
        return vms[0]["id"]
    if not vms:
        raise RuntimeError(
            "No VM exists. Call create_vm() first, or specify vm_id explicitly."
        )
    names = ", ".join(f"{v['id']} ({v.get('label') or v['name']})" for v in vms)
    raise RuntimeError(
        f"Multiple VMs running ({len(vms)}). Specify vm_id. Choices: {names}"
    )


# ---------------------------------------------------------------------------
# VM lifecycle (controller-level)
# ---------------------------------------------------------------------------


@mcp.tool()
def list_vms() -> dict:
    """List every VM the controller knows about (id, name, status, ports)."""
    return _request("GET", "/api/vms")


@mcp.tool()
def create_vm(
    label: str | None = None,
    memory_mb: Annotated[int | None, Field(ge=512, le=65536)] = None,
    cpus: Annotated[float | None, Field(gt=0, le=16)] = None,
) -> dict:
    """Spin up a new VM container from the cursor-style-vm image.

    Returns ``{ vm: { id, name, ports: {api, novnc, cdp}, ... } }``.
    """
    body: dict[str, Any] = {}
    if label:
        body["label"] = label
    if memory_mb is not None:
        body["memoryMb"] = memory_mb
    if cpus is not None:
        body["cpus"] = cpus
    return _request("POST", "/api/vms", json=body)


@mcp.tool()
def delete_vm(
    vm_id: str,
    wipe: bool = True,
) -> dict:
    """Stop the container and (by default) delete its persistent /root volume.

    Set ``wipe=false`` to keep the volume around for a future ``create_vm``.
    """
    suffix = "?wipe=1" if wipe else ""
    return _request("DELETE", f"/api/vms/{vm_id}{suffix}")


@mcp.tool()
def reset_vm(vm_id: str, wipe: bool = True) -> dict:
    """Hard-reset a VM: destroy + recreate the container (and volume if wipe)."""
    suffix = "?wipe=1" if wipe else ""
    return _request("POST", f"/api/vms/{vm_id}/reset{suffix}")


@mcp.tool()
def restart_vm(vm_id: str) -> dict:
    """Soft restart: keeps the /root volume and re-creates the desktop session."""
    return _request("POST", f"/api/vms/{vm_id}/restart")


# ---------------------------------------------------------------------------
# Desktop / system (per-VM)
# ---------------------------------------------------------------------------


@mcp.tool()
def health(vm_id: str | None = None) -> dict:
    """Check the in-VM automation API is reachable."""
    return _vm_api("GET", _resolve_vm_id(vm_id), "health")


@mcp.tool()
def screen_size(vm_id: str | None = None) -> dict:
    """Return the VM virtual screen dimensions (width, height)."""
    return _vm_api("GET", _resolve_vm_id(vm_id), "screen_size")


@mcp.tool()
def cursor_position(vm_id: str | None = None) -> dict:
    """Return the current mouse cursor position."""
    return _vm_api("GET", _resolve_vm_id(vm_id), "cursor_position")


@mcp.tool()
def list_windows(vm_id: str | None = None) -> dict:
    """List currently open desktop windows (id, desktop, host, title)."""
    return _vm_api("GET", _resolve_vm_id(vm_id), "windows")


@mcp.tool()
def screenshot(vm_id: str | None = None) -> Image:
    """Capture a PNG screenshot of the VM desktop."""
    resolved = _resolve_vm_id(vm_id)
    resp = client.get(f"/api/vm/{resolved}/screenshot")
    resp.raise_for_status()
    return Image(data=resp.content, format="png")


@mcp.tool()
def move_mouse(
    x: Annotated[int, Field(ge=0)],
    y: Annotated[int, Field(ge=0)],
    vm_id: str | None = None,
) -> dict:
    """Move the mouse cursor to (x, y)."""
    return _vm_api(
        "POST", _resolve_vm_id(vm_id), "move", json={"x": x, "y": y}
    )


@mcp.tool()
def click(
    x: Annotated[int, Field(ge=0)],
    y: Annotated[int, Field(ge=0)],
    button: Literal["left", "middle", "right"] = "left",
    clicks: Annotated[int, Field(ge=1, le=5)] = 1,
    vm_id: str | None = None,
) -> dict:
    """Click at (x, y). Supports left/middle/right and up to 5 clicks."""
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "click",
        json={"x": x, "y": y, "button": button, "clicks": clicks},
    )


@mcp.tool()
def double_click(x: int, y: int, vm_id: str | None = None) -> dict:
    """Double left-click at (x, y)."""
    return _vm_api(
        "POST", _resolve_vm_id(vm_id), "double_click", json={"x": x, "y": y}
    )


@mcp.tool()
def right_click(x: int, y: int, vm_id: str | None = None) -> dict:
    """Right-click at (x, y)."""
    return _vm_api(
        "POST", _resolve_vm_id(vm_id), "right_click", json={"x": x, "y": y}
    )


@mcp.tool()
def scroll(
    x: int,
    y: int,
    direction: Literal["up", "down", "left", "right"] = "down",
    amount: Annotated[int, Field(ge=1, le=50)] = 3,
    vm_id: str | None = None,
) -> dict:
    """Scroll the wheel at (x, y) in the given direction."""
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "scroll",
        json={"x": x, "y": y, "direction": direction, "amount": amount},
    )


@mcp.tool()
def drag(
    from_x: int,
    from_y: int,
    to_x: int,
    to_y: int,
    button: Literal["left", "middle", "right"] = "left",
    vm_id: str | None = None,
) -> dict:
    """Drag from (from_x, from_y) to (to_x, to_y) with the given button held."""
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "drag",
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
    vm_id: str | None = None,
) -> dict:
    """Type literal text at the current keyboard focus."""
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "type",
        json={"text": text, "delay_ms": delay_ms},
    )


@mcp.tool()
def press_key(
    keys: str,
    repeat: Annotated[int, Field(ge=1, le=20)] = 1,
    vm_id: str | None = None,
) -> dict:
    """Send an xdotool key combo, e.g. 'Return', 'ctrl+t', 'alt+F4', 'super'."""
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "key",
        json={"keys": keys, "repeat": repeat},
    )


@mcp.tool()
def shell(
    cmd: str,
    timeout: Annotated[float, Field(ge=0.1, le=600.0)] = 60.0,
    vm_id: str | None = None,
) -> dict:
    """Run an arbitrary shell command inside the VM container.

    Returns ``{cmd, returncode, stdout, stderr}``.
    """
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "shell",
        json={"cmd": cmd, "timeout": timeout},
    )


@mcp.tool()
def launch_app(name: str, vm_id: str | None = None) -> dict:
    """Launch a desktop application detached from the API request.

    ``name`` is parsed as a shell command line, e.g. ``xfce4-terminal`` or
    ``google-chrome --no-sandbox https://example.com``.
    """
    resolved = _resolve_vm_id(vm_id)
    resp = client.post(f"/api/vm/{resolved}/launch", params={"name": name})
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def open_url(url: str, vm_id: str | None = None) -> dict:
    """Open a URL in Google Chrome (creates a new window/tab)."""
    cmd = f"google-chrome --no-sandbox {shlex.quote(url)}"
    resolved = _resolve_vm_id(vm_id)
    resp = client.post(f"/api/vm/{resolved}/launch", params={"name": cmd})
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Chrome DevTools
# ---------------------------------------------------------------------------


@mcp.tool()
def launch_chrome_debug(
    url: str | None = None,
    vm_id: str | None = None,
) -> dict:
    """Launch Chrome inside the VM with the DevTools Protocol exposed.

    Returns the host port of the per-VM CDP endpoint so callers can point
    ``chrome-devtools-mcp`` at ``http://127.0.0.1:{cdp_port}``.

    Each VM publishes its own CDP port on the host (allocated by the
    controller from the VM_PORT_CDP_BASE pool). Inside the VM the chrome
    DevTools server listens on a fixed loopback port and a ``socat`` bridge
    republishes it on the container port that the controller maps.
    """
    resolved = _resolve_vm_id(vm_id)
    # Match the container port published as 9222 in the controller's
    # PortBindings; the in-container bridge target is +1 on the loopback.
    container_port = 9222
    chrome_internal_port = container_port + 1
    setup = (
        "command -v socat >/dev/null || (apt-get update -q && apt-get install -y -q socat) >/dev/null 2>&1; "
        "for p in $(pgrep -f \"/opt/[g]oogle/chrome/chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        "for p in $(pgrep -f \"/usr/bin/[g]oogle-chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        f"for p in $(pgrep -f \"[s]ocat TCP-LISTEN:{container_port}\"); do kill -9 $p 2>/dev/null || true; done; "
        "sleep 2; "
    )
    chrome_flags = (
        "--no-sandbox "
        f"--remote-debugging-port={chrome_internal_port} "
        "--user-data-dir=/root/.config/google-chrome-debug "
        "--no-first-run --no-default-browser-check "
        "--disable-features=PrivacySandboxSettings4"
    )
    target = shlex.quote(url) if url else "about:blank"
    chrome_cmd = f"google-chrome {chrome_flags} {target}"
    socat_cmd = (
        f"setsid socat TCP-LISTEN:{container_port},fork,reuseaddr,bind=0.0.0.0 "
        f"TCP:127.0.0.1:{chrome_internal_port} "
        f">/tmp/socat-{container_port}.log 2>&1 < /dev/null & disown"
    )
    full = (
        setup
        + f"setsid {chrome_cmd} >/tmp/launch-chrome-debug.log 2>&1 < /dev/null & disown; "
        + "sleep 5; "
        + socat_cmd + "; "
        + "sleep 1; "
        + f"curl -fsS http://127.0.0.1:{chrome_internal_port}/json/version | head -3"
    )
    result = _vm_api(
        "POST",
        resolved,
        "shell",
        json={"cmd": full, "timeout": 120},
    )

    # Look up the host port the controller mapped for this VM's CDP.
    listing = _request("GET", "/api/vms")
    host_cdp_port: int | None = None
    for v in listing.get("vms", []):
        if v["id"] == resolved:
            host_cdp_port = v["ports"]["cdp"]
            break

    return {
        **result,
        "vm_id": resolved,
        "container_cdp_port": container_port,
        "host_cdp_port": host_cdp_port,
        "chrome_devtools_mcp_url": (
            f"http://127.0.0.1:{host_cdp_port}" if host_cdp_port else None
        ),
    }


@mcp.tool()
def kill_chrome(vm_id: str | None = None) -> dict:
    """Force-quit Chrome inside the VM (pgrep patterns exclude this shell)."""
    cmd = (
        "for p in $(pgrep -f \"/opt/[g]oogle/chrome/chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        "for p in $(pgrep -f \"/usr/bin/[g]oogle-chrome\"); do kill -9 $p 2>/dev/null || true; done; "
        "sleep 1; "
        "pgrep -af \"/opt/[g]oogle/chrome/chrome\" || echo 'no chrome running'"
    )
    return _vm_api(
        "POST", _resolve_vm_id(vm_id), "shell", json={"cmd": cmd, "timeout": 15}
    )


# ---------------------------------------------------------------------------
# Apt / installs
# ---------------------------------------------------------------------------


@mcp.tool()
def list_downloads(vm_id: str | None = None) -> dict:
    """List files in /root/Downloads (where Chrome saves files by default)."""
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "shell",
        json={"cmd": "ls -la /root/Downloads", "timeout": 10},
    )


@mcp.tool()
def install_apt(
    package: str,
    update: bool = True,
    timeout: Annotated[float, Field(ge=1.0, le=600.0)] = 600.0,
    vm_id: str | None = None,
) -> dict:
    """apt-get install a package by name. Set update=false to skip apt-get update."""
    parts: list[str] = []
    if update:
        parts.append("apt-get update")
    parts.append(f"apt-get install -y {shlex.quote(package)}")
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "shell",
        json={"cmd": " && ".join(parts), "timeout": timeout},
    )


@mcp.tool()
def install_deb(
    deb_path: str,
    timeout: Annotated[float, Field(ge=1.0, le=600.0)] = 600.0,
    vm_id: str | None = None,
) -> dict:
    """Install a local .deb file inside the VM (resolves deps via apt)."""
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "shell",
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
    vm_id: str | None = None,
) -> dict:
    """apt-get remove (or purge) a package, optionally followed by autoremove."""
    op = "purge" if purge else "remove"
    parts = [f"apt-get {op} -y {shlex.quote(package)}"]
    if autoremove:
        parts.append("apt-get autoremove -y")
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "shell",
        json={"cmd": " && ".join(parts), "timeout": timeout},
    )


@mcp.tool()
def list_installed(
    filter_substr: str | None = None,
    vm_id: str | None = None,
) -> dict:
    """List installed apt packages (name + version). Optional substring filter."""
    base = "dpkg-query -W -f='${Package}\\t${Version}\\n'"
    cmd = f"{base} | sort"
    if filter_substr:
        cmd = f"{base} | grep -i {shlex.quote(filter_substr)} | sort"
    return _vm_api(
        "POST",
        _resolve_vm_id(vm_id),
        "shell",
        json={"cmd": cmd, "timeout": 30},
    )


if __name__ == "__main__":
    mcp.run()
