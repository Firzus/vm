---
name: vm-test-app-install
description: Use this skill when the user wants to test the full lifecycle of an app inside the cursor-style VM — download from a website, install, run, uninstall, then delete the VM. Default target is Opera GX from https://operagx.gg/Huzounetaff. Triggers on phrases like "test installing X", "run the install/uninstall loop", "loop the VM with <url>", or just "/vm-test-app-install".
---

# VM app install / uninstall / delete loop

Drives an end-to-end "create VM → download → install → verify → uninstall →
delete VM" cycle. Uses **only the `cursor-vm` MCP server** (multi-VM
controller). The `chrome-devtools` MCP is unrelated to this skill — it
lives in `.mcp.json` for separate frontend-debugging work, do not call it
here.

## Inputs

- `download_url` — page that triggers the installer download.
  **Default**: `https://operagx.gg/Huzounetaff` (Opera GX).
- `package_hint` — substring to find the apt package after install.
  **Default**: `opera`.
- `label` — human-readable label for the VM tab.
  **Default**: `app-test-<short-uuid>`.

If the user did not specify these, use the defaults — do not ask before
starting.

## Preconditions

- The controller is running (`cd controller && pnpm start`).
  `cursor-vm.list_vms()` should return successfully.

If the controller is unreachable, surface the error to the user and stop.
The skill does not start the controller for them.

## Steps

Run the following in order. **After each destructive step (create_vm,
install, uninstall, delete_vm) tell the user in one sentence what just
changed so they can interrupt.**

### 1. Create a fresh VM

```
cursor-vm.create_vm({ label: "<label>" })
```

Capture the returned `vm.id` — every subsequent call passes it as `vm_id`.
Wait ~8 seconds for the in-VM API to come up, then verify with
`cursor-vm.health({ vm_id })` returning `{ "status": "ok" }`.

### 2. Trigger the download

Try the cheap path first — many vendor URLs redirect straight to the
installer file:

```
cursor-vm.shell({
  vm_id,
  cmd: "cd /root/Downloads && curl -fL -O -J <download_url>",
  timeout: 300,
})
```

If a `*.deb`, `*.rpm`, or `*.AppImage` file appears in `/root/Downloads`
(check via `cursor-vm.list_downloads({ vm_id })`), skip to step 4.

If the URL lands on an HTML landing page with a download button, fall back
to driving Chrome from the desktop:

1. `cursor-vm.open_url({ vm_id, url: download_url })`
2. `cursor-vm.screenshot({ vm_id })` — find the visible "Download" /
   "Télécharger" button.
3. `cursor-vm.click({ vm_id, x, y })` on the button. Most vendor pages
   auto-pick the right OS variant for Linux + Chrome.

### 3. Wait for the file

Poll `cursor-vm.list_downloads({ vm_id })` up to 5 times, ~3 seconds apart,
until a `*.deb`, `*.rpm`, or `*.AppImage` appears in `/root/Downloads`. If
nothing appears, abort with a clear message — do not retry blindly.

### 4. Install

For a `.deb`:
```
cursor-vm.install_deb({ vm_id, deb_path: "/root/Downloads/<file>" })
```

For an `.AppImage`, no install is needed:
```
cursor-vm.shell({ vm_id, cmd: "chmod +x /root/Downloads/<file>" })
```

Confirm the install with
`cursor-vm.list_installed({ vm_id, filter_substr: package_hint })`.
**Capture the exact package name from the dpkg output** — needed for the
uninstall in step 6.

### 5. Smoke-launch the app

Optional but recommended:
```
cursor-vm.launch_app({ vm_id, name: "<binary> --no-sandbox" })
```
(Opera GX: `opera --no-sandbox`.) Then `cursor-vm.screenshot({ vm_id })` so
the user can see the app window.

### 6. Uninstall

```
cursor-vm.uninstall_apt({
  vm_id,
  package: "<package>",
  purge: true,
  autoremove: true,
})
```

Re-run `cursor-vm.list_installed({ vm_id, filter_substr: package_hint })`
and confirm the package is gone.

For `.AppImage`:
`cursor-vm.shell({ vm_id, cmd: "rm /root/Downloads/<file>" })`.

### 7. Delete the VM

```
cursor-vm.delete_vm({ vm_id, wipe: true })
```

This stops the container and removes the persistent /root volume — full
cleanup. Skill is complete.

## Why we delete instead of resetting

The previous version of this skill called `vm_reset` to wipe the single VM
and bring it back. The new controller is multi-VM: every test run creates
its own throw-away container, so we just delete it at the end. Other VMs
the user has open are untouched.

If you need to run multiple iterations in a tight loop, re-run from step 1
— the controller is fast at creating new containers (~5 s once the image
is cached).

## When things go wrong

- **`curl` returns 4xx/5xx** — the URL needs a real browser. Fall back to
  the `open_url` + `screenshot` + `click` path in step 2.
- **No file appears in `/root/Downloads`** — the page may detect headless
  or require login. Tell the user, do not try to bypass.
- **`install_deb` fails with apt dependency error** — run
  `cursor-vm.shell({ vm_id, cmd: "apt-get install -y -f" })` to repair.
- **`create_vm` fails with `Concurrent VM limit reached`** — ask the user
  which existing VM to delete first; do not delete on their behalf.

## Notes

- `delete_vm` is destructive but only for that one VM. Other VMs in other
  tabs survive untouched.
- If you need to inspect the page itself (network, console, performance),
  switch to the `chrome-devtools` MCP server — call
  `cursor-vm.launch_chrome_debug({ vm_id })` first, read the returned
  `host_cdp_port`, and point `chrome-devtools-mcp` at that port.
