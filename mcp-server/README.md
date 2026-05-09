# Cursor-style VM — MCP server

An MCP (Model Context Protocol) server that lets any MCP-compatible AI agent
(Claude Desktop, Claude Code, Cursor, etc.) drive the Cursor-style VM in this
repo end-to-end:

- See the desktop (`screenshot`)
- Click / type / shortcut (`click`, `type_text`, `press_key`, `drag`, ...)
- Run shell commands inside the VM (`shell`)
- Open URLs in Chrome (`open_url`)
- Install / uninstall software (`install_apt`, `install_deb`, `uninstall_apt`)
- Reset the VM to a clean baseline (`vm_reset`)

This is the natural fit for a "download from Chrome → install → test →
uninstall → reset → repeat" automation loop.

## Architecture

Two MCP servers are configured in `.mcp.json` at the repo root, but they
have **distinct, non-overlapping purposes**:

- **cursor-vm** (this server) — desktop drive (click/type/screenshot/shell)
  + VM lifecycle (`docker compose` up/down/reset). Used by the install /
  uninstall / reset loop.
- **chrome-devtools** (Google's `chrome-devtools-mcp@latest`) — Chrome
  DevTools Protocol tools for **frontend analysis** (network, console,
  performance, accessibility snapshots). Used independently when the agent
  needs to inspect a page, not by the install loop. Before using it, call
  `cursor-vm.launch_chrome_debug` once to start Chrome with the DevTools
  port attached.

Both run on the host.

```
                AI agent (Claude / Cursor / ...)
                          │
              ┌───────────┴────────────────┐
              │ MCP (stdio)                │ MCP (stdio)
              ▼                            ▼
        cursor-vm (host)            chrome-devtools (host)
        Python / FastMCP            npx chrome-devtools-mcp@latest
              │                            │
   docker     │ HTTP :8000                 │ CDP HTTP / WebSocket
   compose    │                            │
              ▼                            ▼
        cursor-style-vm container (Docker)
        ┌───────────────────────────────────────────┐
        │ Chrome ── 127.0.0.1:9223 (CDP loopback)   │
        │            ▲                              │
        │            │ socat bridge                 │
        │ 0.0.0.0:9222 ── forwarded to host:9222 ───┘
        │ FastAPI :8000 (xdotool / scrot / shell)
        └───────────────────────────────────────────┘
```

The socat hop is required because modern Chrome ignores
`--remote-debugging-address=0.0.0.0` and only listens on loopback. The
`launch_chrome_debug` tool installs and starts socat automatically and
launches Chrome in a dedicated user-data-dir (Chrome also refuses CDP on
the default profile).

This server runs **on the host** (not inside the container), because:

- Desktop-drive tools call the FastAPI automation server already exposed at
  `http://localhost:8000` (see `automation/server.py`).
- VM lifecycle tools (`vm_reset`, `vm_up`, `vm_down`, `vm_restart`) call
  `docker compose` directly — that has to happen on the host or the VM would
  be unable to reset itself.

## Setup

```powershell
# from the repo root
cd mcp-server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Make sure the VM is up at least once so port 8000 responds:

```powershell
docker compose up -d --build
curl http://localhost:8000/health
```

## Run it standalone (sanity check)

```powershell
python server.py
```

The server speaks MCP over stdio, so this will just sit waiting for a client.
Hit Ctrl+C to exit. Real usage is via an MCP host (below).

## Register with Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "cursor-vm": {
      "command": "C:\\Users\\User\\Documents\\repository\\vm\\mcp-server\\.venv\\Scripts\\python.exe",
      "args": ["C:\\Users\\User\\Documents\\repository\\vm\\mcp-server\\server.py"],
      "env": {
        "VM_API_URL": "http://localhost:8000",
        "VM_COMPOSE_DIR": "C:\\Users\\User\\Documents\\repository\\vm"
      }
    }
  }
}
```

Restart Claude Desktop. The `cursor-vm` tools should appear in the tool picker.

## Register with Claude Code

```powershell
claude mcp add cursor-vm `
  --env VM_API_URL=http://localhost:8000 `
  --env VM_COMPOSE_DIR=C:\Users\User\Documents\repository\vm `
  -- C:\Users\User\Documents\repository\vm\mcp-server\.venv\Scripts\python.exe `
     C:\Users\User\Documents\repository\vm\mcp-server\server.py
```

## Environment variables

| Var                  | Default                       | Purpose                              |
| -------------------- | ----------------------------- | ------------------------------------ |
| `VM_API_URL`         | `http://localhost:8000`       | Where the in-VM FastAPI server lives |
| `VM_COMPOSE_DIR`     | parent of this folder         | Where `docker-compose.yml` lives     |
| `VM_COMPOSE_SERVICE` | `vm`                          | Service name to restart              |

## Tool reference

### Vision / meta

- `health()` — the in-VM API is up
- `screen_size()` — desktop dimensions
- `cursor_position()` — current mouse coords
- `list_windows()` — open windows (id, desktop, title)
- `screenshot()` — PNG of the desktop

### Mouse / keyboard

- `move_mouse(x, y)`
- `click(x, y, button="left", clicks=1)`
- `double_click(x, y)`
- `right_click(x, y)`
- `scroll(x, y, direction="down", amount=3)`
- `drag(from_x, from_y, to_x, to_y, button="left")`
- `type_text(text, delay_ms=12)`
- `press_key(keys, repeat=1)` — xdotool syntax (`ctrl+t`, `Return`, `alt+F4`)

### System

- `shell(cmd, timeout=60)` — arbitrary shell inside the VM
- `launch_app(name)` — launch a detached desktop app

### Chrome / install / uninstall

- `open_url(url)` — open a URL in Chrome (`--no-sandbox` is set automatically)
- `launch_chrome_debug(url=None, port=9222)` — launch Chrome with the
  DevTools Protocol exposed on `localhost:9222` (host) so
  `chrome-devtools-mcp` can attach. Installs and runs `socat` as needed.
- `kill_chrome()` — force-quit any running Chrome (uses a regex trick so
  the kill itself is not matched by `pgrep -f`).
- `list_downloads()` — `ls -la /root/Downloads`
- `install_apt(package, update=true)`
- `install_deb(deb_path)`
- `uninstall_apt(package, purge=true, autoremove=true)`
- `list_installed(filter_substr=None)`

### VM lifecycle (host-side)

- `vm_status()` — `docker compose ps`
- `vm_up(rebuild=false)` — start, optionally rebuild the image
- `vm_down(wipe=false)` — stop, optionally drop the /root volume
- `vm_restart()` — soft restart (keeps installed apps)
- `vm_reset(rebuild=false)` — **hard reset**: wipe /root, then bring the stack back up

## Project-scoped MCP registration (`.mcp.json`)

This repo ships a `.mcp.json` at the root that registers both servers for
Claude Code in project scope. Open the repo, accept the project servers
once, and both `cursor-vm` and `chrome-devtools` are immediately available.

## Typical loop the agent would run

Uses **only `cursor-vm`** (chrome-devtools-mcp is unrelated):

1. `cursor-vm.vm_reset()` — clean slate
2. Trigger the download:
   - first try `cursor-vm.shell({ cmd: "cd /root/Downloads && curl -fL -O -J <url>" })`
   - if the URL needs a real browser, `cursor-vm.open_url(url)` + read
     a `cursor-vm.screenshot()` and `cursor-vm.click(x, y)` on the
     download button
3. Poll `cursor-vm.list_downloads()` until the installer file appears
4. `cursor-vm.install_deb("/root/Downloads/<file>")`
5. `cursor-vm.launch_app("opera --no-sandbox")` + `cursor-vm.screenshot()`
6. `cursor-vm.uninstall_apt("opera-stable")`
7. `cursor-vm.vm_reset()` and start the next case

A Claude Code skill that walks through this loop is provided at
`.claude/skills/vm-test-app-install/SKILL.md`.

## Smoke tests

Run from the repo root once the VM is up (`docker compose up -d --build`):

```powershell
# cursor-vm itself
.\mcp-server\.venv\Scripts\python.exe mcp-server\smoke_test_cursor_vm.py

# chrome-devtools-mcp -> Chrome inside the VM (requires launch_chrome_debug
# to have been called first)
.\mcp-server\.venv\Scripts\python.exe mcp-server\smoke_test_cdm.py
```
