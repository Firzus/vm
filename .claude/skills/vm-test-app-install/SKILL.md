---
name: vm-test-app-install
description: Use this skill when the user wants to test the full lifecycle of an app inside the cursor-style VM — download from a website, install, run, uninstall, then hard-reset the VM. Default target is Opera GX from https://operagx.gg/Huzounetaff. Triggers on phrases like "test installing X", "run the install/uninstall loop", "loop the VM with <url>", or just "/vm-test-app-install".
---

# VM app install / uninstall / reset loop

Drives an end-to-end "download → install → verify → uninstall → reset"
cycle inside the Cursor-style VM in this repo. Uses **only the `cursor-vm`
MCP server** (FastAPI automation + docker compose lifecycle). The
`chrome-devtools` MCP is unrelated to this skill — it lives in `.mcp.json`
for separate frontend-debugging work, do not call it here.

## Inputs

- `download_url` — page that triggers the installer download.
  **Default**: `https://operagx.gg/Huzounetaff` (Opera GX).
- `package_hint` — substring to find the apt package after install.
  **Default**: `opera`.
- `skip_initial_reset` — when true, skip the pre-cycle `vm_reset` and use
  the VM in its current state. **Default**: false.

If the user did not specify these, use the defaults — do not ask before
starting.

## Preconditions

- Docker is reachable from the host.
- The VM image is built (`docker compose up -d --build` from the repo
  root). The skill will start the VM if it is down.
- The `cursor-vm` MCP server is configured in the repo's `.mcp.json`.

If `cursor-vm.health` returns an error, run `cursor-vm.vm_up()` and wait
until `cursor-vm.health` returns `{ "status": "ok" }`.

## Steps

Run the following in order. **After each destructive step (vm_reset,
install, uninstall) tell the user in one sentence what just changed so
they can interrupt.**

### 1. Clean baseline

Unless `skip_initial_reset` is true, call `cursor-vm.vm_reset()`. This
wipes the `/root` volume (Downloads, browser profiles, anything
user-installed) and brings the stack back up. Wait for `cursor-vm.health`
to return `ok`.

### 2. Trigger the download

Try the cheap path first — many vendor URLs redirect straight to the
installer file, in which case `curl -L` is enough:

```
cursor-vm.shell({ cmd: "cd /root/Downloads && curl -fL -O -J <download_url>", timeout: 300 })
```

If a `*.deb`, `*.rpm`, or `*.AppImage` file appears in `/root/Downloads`
(check via `cursor-vm.list_downloads()`), skip to step 4.

If the URL lands on an HTML landing page with a download button instead
of redirecting to the file, fall back to driving Chrome from the desktop:

1. `cursor-vm.open_url({ url: download_url })` — opens the URL in the
   pre-installed Chrome (no DevTools needed; this is just a browser
   launch).
2. `cursor-vm.screenshot()` — take a PNG of the desktop. Look at the
   image and find the visible "Download" / "Télécharger" button.
3. `cursor-vm.click({ x, y })` — click on the button using the
   coordinates you read from the screenshot. Most vendor pages auto-pick
   the right OS variant for Linux + Chrome.

### 3. Wait for the file

Poll `cursor-vm.list_downloads()` up to 5 times, ~3 seconds apart, until
a `*.deb`, `*.rpm`, or `*.AppImage` appears in `/root/Downloads`. If
nothing appears, abort with a clear message — do not retry blindly.

### 4. Install

For a `.deb`:
```
cursor-vm.install_deb({ deb_path: "/root/Downloads/<file>" })
```

For an `.AppImage`, no install is needed — just make it executable:
```
cursor-vm.shell({ cmd: "chmod +x /root/Downloads/<file>" })
```

Confirm the install with
`cursor-vm.list_installed({ filter_substr: package_hint })`. **Capture the
exact package name from the dpkg output** — you'll need it for the
uninstall in step 6.

### 5. Smoke-launch the app

Optional but recommended. Launch the binary detached:
```
cursor-vm.launch_app({ name: "<binary> --no-sandbox" })
```
(Opera GX: `opera --no-sandbox`.) Then `cursor-vm.screenshot()` so the
user can see the app window.

### 6. Uninstall

```
cursor-vm.uninstall_apt({ package: "<package>", purge: true, autoremove: true })
```

Re-run `cursor-vm.list_installed({ filter_substr: package_hint })` and
confirm the package list no longer includes it.

For `.AppImage`, uninstall is just `cursor-vm.shell({ cmd: "rm /root/Downloads/<file>" })`.

### 7. Hard reset

`cursor-vm.vm_reset()`. This wipes `/root` again, bringing the VM back
to the image baseline so the next iteration starts clean.

Wait for `cursor-vm.health` to return `ok`. Skill is complete.

## When things go wrong

- **`curl` returns 4xx/5xx** — the URL probably needs a real browser.
  Fall back to the `open_url` + `screenshot` + `click` path in step 2.
- **No file appears in `/root/Downloads`** — the page may detect headless
  or require login. Tell the user, do not try to bypass.
- **`install_deb` fails with apt dependency error** — run
  `cursor-vm.shell({ cmd: "apt-get install -y -f" })` to repair, then retry.
- **`vm_reset` returns a non-zero `down.returncode`** — the volume is
  held by another container. Read the stderr and stop; do not force.

## Notes

- `vm_reset` is destructive. The user's MCP host should prompt before
  it runs — do not bypass that prompt.
- Each iteration of the loop ends with `vm_reset` (rather than starting
  the next one with it), so the VM is left in a clean state if the user
  stops mid-loop.
- If you need to inspect the page itself (network, console, performance),
  switch to the `chrome-devtools` MCP server — that is its purpose, and
  it is independent of this install/uninstall skill.
