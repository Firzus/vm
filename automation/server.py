"""FastAPI automation layer for the cursor-style VM.

Exposes a small HTTP API that wraps xdotool / scrot / xdpyinfo so any external
agent (a script, an LLM harness, etc.) can drive the desktop running inside
this container, in the same spirit as Cursor cloud agents drive their own VM.
"""

from __future__ import annotations

import base64
import os
import shlex
import subprocess
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

DISPLAY = os.environ.get("DISPLAY", ":1")
ENV = {**os.environ, "DISPLAY": DISPLAY}

# We disable the bundled docs pages and re-serve them ourselves so the
# embedded Swagger UI / ReDoc shell can point at a proxy-aware
# ``openapi_url``. The controller forwards the original path prefix as
# ``X-Forwarded-Prefix`` (e.g. ``/api/vm/<id>``); when present, the docs HTML
# loads its spec from ``<prefix>/openapi.json`` instead of the page-origin
# ``/openapi.json`` (which, behind the proxy, is the controller and would
# 404). The default ``/openapi.json`` route is left intact and is reachable
# through the same proxy.
app = FastAPI(
    title="Cursor-style VM Automation API",
    version="1.0.0",
    description=(
        "Drive the XFCE desktop running inside this container. "
        "Endpoints mirror the action set used by computer-use agents."
    ),
    docs_url=None,
    redoc_url=None,
)


def _forwarded_prefix(request: Request) -> str:
    """Return the path prefix the proxy used to reach us, without a trailing slash.

    Falls back to an empty string when the header is absent (i.e. the API is
    being hit directly, not via the controller proxy).
    """
    raw = request.headers.get("x-forwarded-prefix", "")
    return raw.rstrip("/")


@app.get("/docs", include_in_schema=False)
def swagger_ui(request: Request) -> HTMLResponse:
    prefix = _forwarded_prefix(request)
    return get_swagger_ui_html(
        openapi_url=f"{prefix}{app.openapi_url}",
        title=f"{app.title} – Swagger UI",
    )


@app.get("/redoc", include_in_schema=False)
def redoc_ui(request: Request) -> HTMLResponse:
    prefix = _forwarded_prefix(request)
    return get_redoc_html(
        openapi_url=f"{prefix}{app.openapi_url}",
        title=f"{app.title} – ReDoc",
    )


def run(cmd: list[str], *, timeout: float = 15.0, capture: bool = True) -> subprocess.CompletedProcess[str]:
    """Run a shell command with DISPLAY set, raising on failure."""
    try:
        result = subprocess.run(
            cmd,
            env=ENV,
            timeout=timeout,
            capture_output=capture,
            text=True,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"command timed out: {' '.join(cmd)}") from exc
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "cmd": cmd,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            },
        )
    return result


class Point(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)


class ClickRequest(Point):
    button: Literal["left", "middle", "right"] = "left"
    clicks: int = Field(1, ge=1, le=5)


class TypeRequest(BaseModel):
    text: str
    delay_ms: int = Field(12, ge=0, le=500)


class KeyRequest(BaseModel):
    keys: str = Field(..., description="xdotool key sequence, e.g. 'Return', 'ctrl+a', 'alt+F4'")
    repeat: int = Field(1, ge=1, le=20)


class ScrollRequest(Point):
    direction: Literal["up", "down", "left", "right"] = "down"
    amount: int = Field(3, ge=1, le=50)


class MoveRequest(Point):
    pass


class DragRequest(BaseModel):
    from_: Point = Field(..., alias="from")
    to: Point
    button: Literal["left", "middle", "right"] = "left"

    model_config = {"populate_by_name": True}


class ShellRequest(BaseModel):
    cmd: str = Field(..., description="Shell command executed in the container")
    timeout: float = Field(60.0, ge=0.1, le=600.0)


_BUTTON_MAP = {"left": "1", "middle": "2", "right": "3"}
_SCROLL_BUTTONS = {"up": "4", "down": "5", "left": "6", "right": "7"}


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "display": DISPLAY}


@app.get("/screen_size", tags=["meta"])
def screen_size() -> dict:
    out = run(["xdpyinfo"]).stdout
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("dimensions:"):
            dims = line.split()[1]
            w, h = dims.split("x")
            return {"width": int(w), "height": int(h)}
    raise HTTPException(status_code=500, detail="could not parse xdpyinfo output")


@app.get("/cursor_position", tags=["meta"])
def cursor_position() -> dict:
    out = run(["xdotool", "getmouselocation", "--shell"]).stdout
    pos = {}
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            pos[k.lower()] = v
    return {"x": int(pos.get("x", 0)), "y": int(pos.get("y", 0))}


@app.post("/move", tags=["mouse"])
def move(req: MoveRequest) -> dict:
    run(["xdotool", "mousemove", "--sync", str(req.x), str(req.y)])
    return {"ok": True, "x": req.x, "y": req.y}


@app.post("/click", tags=["mouse"])
def click(req: ClickRequest) -> dict:
    btn = _BUTTON_MAP[req.button]
    run([
        "xdotool", "mousemove", "--sync", str(req.x), str(req.y),
        "click", "--repeat", str(req.clicks), btn,
    ])
    return {"ok": True, **req.model_dump()}


@app.post("/double_click", tags=["mouse"])
def double_click(req: Point) -> dict:
    run([
        "xdotool", "mousemove", "--sync", str(req.x), str(req.y),
        "click", "--repeat", "2", "--delay", "60", "1",
    ])
    return {"ok": True, **req.model_dump()}


@app.post("/right_click", tags=["mouse"])
def right_click(req: Point) -> dict:
    run([
        "xdotool", "mousemove", "--sync", str(req.x), str(req.y),
        "click", "3",
    ])
    return {"ok": True, **req.model_dump()}


@app.post("/scroll", tags=["mouse"])
def scroll(req: ScrollRequest) -> dict:
    btn = _SCROLL_BUTTONS[req.direction]
    run([
        "xdotool", "mousemove", "--sync", str(req.x), str(req.y),
        "click", "--repeat", str(req.amount), btn,
    ])
    return {"ok": True, **req.model_dump()}


@app.post("/drag", tags=["mouse"])
def drag(req: DragRequest) -> dict:
    btn = _BUTTON_MAP[req.button]
    run([
        "xdotool",
        "mousemove", "--sync", str(req.from_.x), str(req.from_.y),
        "mousedown", btn,
        "mousemove", "--sync", str(req.to.x), str(req.to.y),
        "mouseup", btn,
    ])
    return {"ok": True, "from": req.from_.model_dump(), "to": req.to.model_dump()}


@app.post("/type", tags=["keyboard"])
def type_text(req: TypeRequest) -> dict:
    run(["xdotool", "type", "--delay", str(req.delay_ms), "--", req.text], timeout=60)
    return {"ok": True, "chars": len(req.text)}


@app.post("/key", tags=["keyboard"])
def key(req: KeyRequest) -> dict:
    run(["xdotool", "key", "--repeat", str(req.repeat), req.keys])
    return {"ok": True, **req.model_dump()}


@app.get("/screenshot", tags=["vision"])
def screenshot(format: Literal["png", "base64"] = "png") -> Response:
    path = "/tmp/screenshot.png"
    run(["scrot", "-o", "-z", path], timeout=10)
    with open(path, "rb") as f:
        data = f.read()
    if format == "base64":
        return Response(
            content=base64.b64encode(data),
            media_type="text/plain",
        )
    return Response(content=data, media_type="image/png")


@app.get("/windows", tags=["meta"])
def list_windows() -> dict:
    out = run(["wmctrl", "-l"]).stdout
    windows = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:
            wid, desktop, host, title = parts
            windows.append({"id": wid, "desktop": desktop, "host": host, "title": title})
    return {"windows": windows}


@app.post("/shell", tags=["system"])
def shell(req: ShellRequest) -> dict:
    """Run an arbitrary shell command (sh -c). Useful to install apps, launch
    binaries (e.g. ``opera-gx --no-sandbox &``), inspect the filesystem, etc.
    """
    try:
        result = subprocess.run(
            ["bash", "-lc", req.cmd],
            env=ENV,
            timeout=req.timeout,
            capture_output=True,
            text=True,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"timeout after {req.timeout}s") from exc
    return {
        "cmd": req.cmd,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


@app.post("/launch", tags=["system"])
def launch(name: str) -> dict:
    """Spawn a desktop app in the background (detached from the API request).

    ``name`` is interpreted as a shell command line, e.g. ``opera-gx --no-sandbox``.
    The process is fully detached via ``setsid`` so it survives the request.
    """
    log_basename = shlex.split(name)[0].replace("/", "_") if name.strip() else "launch"
    log_path = f"/tmp/launch-{log_basename}.log"
    subprocess.Popen(
        ["bash", "-lc", f"exec {name} >{shlex.quote(log_path)} 2>&1"],
        env=ENV,
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    return {"ok": True, "launched": name, "log": log_path}
