---
name: vm-test-app-install
description: Use this skill when the user wants to test the full lifecycle of an app inside the cursor-style VM — download from a website, install, run, uninstall, then delete the VM. Default target is Opera GX from https://operagx.gg/Huzounetaff. Triggers on phrases like "test installing X", "run the install/uninstall loop", "loop the VM with <url>", or just "/vm-test-app-install".
---

# VM app install / uninstall / delete loop

Drives an end-to-end "create VM → download → install → verify → uninstall →
delete VM" cycle.

## Hard rules

1. **All VM-side actions go through the `cursor-vm` MCP server**
   (multi-VM controller). No exceptions. Tools may appear under a
   namespaced prefix in your tool list (e.g.
   `project-0-vm-cursor-vm-list_vms`), but the underlying server name is
   `cursor-vm` — pick whichever exposed identifier the host gives you.
2. **NEVER use the `chrome-devtools` MCP server in this skill.** It drives
   Chrome on the user's *host machine*, not the VM. Even for "just
   inspecting the page", `chrome-devtools` is banned here. If you catch
   yourself reaching for `navigate_page`, `evaluate_script`, `list_pages`,
   `take_screenshot`, etc. from `chrome-devtools`, stop — use
   `cursor-vm.shell` / `cursor-vm.open_url` / `cursor-vm.screenshot`
   instead.
3. **No host-side shell calls against the target website.** Don't `curl`
   the vendor URL from the host; always run the download from inside the
   VM via `cursor-vm.shell`.

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

- The controller is running (`cd apps/controller && pnpm start`).
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

### 2. Resolve the real installer URL

Vendor URLs almost never serve the installer directly: they answer with
an HTML landing page that redirects on click, or a "Thank you for
downloading" page that fires a second JS-driven request. Don't fight
this — **scrape the HTML inside the VM to find the actual asset URL**,
then download it.

#### 2a. Fetch the landing page from inside the VM

```
cursor-vm.shell({
  vm_id,
  cmd: "curl -fsSL -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' '<download_url>' -o /tmp/landing.html && wc -c /tmp/landing.html",
  timeout: 60,
})
```

Use a real Chrome User-Agent — some vendor CDNs (Opera included) return
empty bodies or different markup to "headless" clients.

#### 2b. Extract a usable installer URL from the HTML

Look for direct `.deb` / `.rpm` / `.AppImage` links first, then fall back
to vendor download endpoints:

```
cursor-vm.shell({
  vm_id,
  cmd: "grep -oE 'https?://[^\"'\\''>< ]+\\.(deb|rpm|AppImage)' /tmp/landing.html | sort -u | head -10 && echo '---' && grep -oE 'https?://[^\"'\\''>< ]+download[^\"'\\''>< ]*' /tmp/landing.html | sort -u | head -10",
  timeout: 10,
})
```

If you only see vendor "download" endpoints (e.g.
`https://download.opera.com/download/get/?partner=...&opsys=Linux&product=Opera+GX`),
the final binary URL is **almost never embedded in the thank-you HTML**.
Don't fetch and grep the second page — it just returns more HTML.
Instead, follow HTTP redirects with a `HEAD` request and observe
`Location:` headers:

```
cursor-vm.shell({
  vm_id,
  cmd: "curl -fsSIL -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' '<endpoint_url>' 2>&1 | grep -iE '^(HTTP|location):'",
  timeout: 30,
})
```

**Vendor-specific tips** (try these *before* falling back to step 2e):

- **Opera / Opera GX**: append `&nothanks=yes` to the
  `download.opera.com/download/get/` URL — this skips the thank-you
  page and 302-redirects straight to a real `.deb` /`.rpm` on
  `download*.operacdn.com`. Example:
  `…/?partner=www&opsys=Linux&product=Opera+GX&nothanks=yes`.
- Decode any HTML entities you see (`&amp;` → `&`) before reusing the
  URL.

#### 2c. Download the resolved asset to `/root/Downloads`

```
cursor-vm.shell({
  vm_id,
  cmd: "cd /root/Downloads && curl -fL -A 'Mozilla/5.0 (X11; Linux x86_64) ...' -o <name>.deb '<resolved_url>'",
  timeout: 600,
})
```

Always pass `-o <name>.deb` (or `.rpm` / `.AppImage`) rather than `-O -J`
— vendor URLs frequently omit `Content-Disposition`, which makes `-J`
fail with `curl: (23)`.

#### 2d. Sanity-check the magic bytes

Don't trust the file extension. A real `.deb` starts with `!<arch>`, a
real `.rpm` starts with `0xED 0xAB 0xEE 0xDB`, and an `.AppImage` starts
with `0x7F 'E' 'L' 'F'`:

```
cursor-vm.shell({
  vm_id,
  cmd: "head -c 8 /root/Downloads/<file> | od -An -c | head -1 && ls -la /root/Downloads/<file>",
  timeout: 5,
})
```

If it looks like HTML (`<!DOCTYPE` / `<html`) or is under ~1 MB for a
desktop browser, **don't try to install it** — re-scrape the page,
inspect what the vendor returned (`head -c 400 <file>`), and either find
the embedded redirect or fall back to step 2e.

#### 2e. Last-resort fallback: drive Chrome inside the VM

Only if the HTML scrape genuinely doesn't expose the asset (login wall,
JS-only flow, captcha, etc.):

1. `cursor-vm.open_url({ vm_id, url: <download_url> })`
2. `cursor-vm.screenshot({ vm_id })` to inspect what's on screen.
3. `cursor-vm.click({ vm_id, x, y })` on the download button.
4. Poll `cursor-vm.list_downloads({ vm_id })` (step 3) for the file.

If even this fails, **abort and tell the user** — do not try to bypass
captchas or login walls.

### 3. Wait for the file

Poll `cursor-vm.list_downloads({ vm_id })` up to 5 times, ~3 seconds
apart, until a `*.deb`, `*.rpm`, or `*.AppImage` whose magic bytes are
valid (see 2d) appears in `/root/Downloads`. If nothing appears, abort
with a clear message — do not retry blindly.

### 4. Install

For a `.deb`:
```
cursor-vm.install_deb({ vm_id, deb_path: "/root/Downloads/<file>" })
```

For an `.AppImage`, no install is needed:
```
cursor-vm.shell({ vm_id, cmd: "chmod +x /root/Downloads/<file>" })
```

#### 4a. Handling Ubuntu 24.04 (Noble) `libqt5*` / `t64` mismatch

> **Image rebuilt with the Qt5 compat shim?** Step 4a should be a no-op.
> The current `vm-image/Dockerfile` preinstalls `libqt5core5t64`,
> `libqt5gui5t64`, `libqt5widgets5t64` and a `qt5-noble-compat` shim
> package that `Provides:` the legacy `libqt5core5a` / `libqt5gui5` /
> `libqt5widgets5` / `libqt5gui5-gles` names. With that in place,
> `cursor-vm.install_deb({ vm_id, deb_path: ... })` (which runs
> `apt-get install -y <path>`) just works for Opera/Opera GX/most
> Electron apps — no `--force-depends`, no extra step needed. Skip ahead
> to 4b.
>
> Caveats, in order of likelihood:
>
> 1. The image still ships with `/var/lib/apt/lists/*` empty (existing
>    policy, kept on purpose for image size). If `install_deb` complains
>    about unresolvable transitive deps, run an `apt-get update` first:
>    `cursor-vm.shell({ vm_id, cmd: "apt-get update -q", timeout: 120 })`.
> 2. The shim only covers four `Provides:` (`libqt5core5a`,
>    `libqt5gui5`, `libqt5gui5-gles`, `libqt5widgets5`). A vendor `.deb`
>    that depends on some other legacy Qt5 name (e.g. `libqt5network5`)
>    will still need the recovery flow below — extend the shim in
>    `vm-image/assets/qt5-compat/qt5-noble-compat.equivs` rather than
>    forcing it.
> 3. Older images (built before the shim landed) need the full recovery
>    flow as-is.

The VM image is Ubuntu 24.04. Several older `.deb` packages
(Opera/Opera GX, some Electron apps, anything built against pre-Noble
Qt5) hard-depend on `libqt5core5a`, `libqt5gui5`, `libqt5widgets5`. On
Noble these are renamed to `libqt5core5t64`, `libqt5gui5t64`,
`libqt5widgets5t64` (time_t-64 transition), so on an unpatched image
`apt-get install` will fail with:

```
opera-gx-stable : Depends: libqt5core5a (>= 5.3.0) but it is not installable
```

`apt-get install -y -f` **does not fix this**. The recovery flow:

1. Install the `t64` runtime packages (the actual `.so` files are
   ABI-compatible):
   ```
   cursor-vm.shell({
     vm_id,
     cmd: "apt-get update -q && apt-get install -y libqt5core5t64 libqt5gui5t64 libqt5widgets5t64",
     timeout: 180,
   })
   ```
2. Force-install the original `.deb` over the unmet symbolic deps:
   ```
   cursor-vm.shell({
     vm_id,
     cmd: "dpkg -i --force-depends /root/Downloads/<file>",
     timeout: 180,
   })
   ```

The app runs fine — the dependency names are stale, the libraries
themselves are identical.

#### 4b. Confirm the install

```
cursor-vm.list_installed({ vm_id, filter_substr: package_hint })
```

**Capture the exact package name AND the binary name from `dpkg -L`** —
the binary name often differs from `package_hint` (e.g. paquet
`opera-gx-stable`, binaire `opera-gx`; paquet `code`, binaire `code`).
Both are needed: package name for step 6, binary name for step 5.

```
cursor-vm.shell({
  vm_id,
  cmd: "dpkg -L <package> | grep -E '/(usr/)?bin/' | head",
  timeout: 5,
})
```

### 5. Smoke-launch the app

Use the **binary name** captured in step 4b (not the package name and not
a guess from the vendor's brand):

```
cursor-vm.launch_app({ vm_id, name: "<binary> --no-sandbox" })
```

Known mappings:

| Package | Binary |
|---|---|
| `opera-gx-stable` | `opera-gx` |
| `opera-stable` | `opera` |
| `google-chrome-stable` | `google-chrome` |
| `code` (VS Code) | `code` |

Wait ~8–10 s, then verify a window appeared:

```
cursor-vm.list_windows({ vm_id })
```

Expect a new entry beyond the baseline (`xfce4-panel`, `Desktop`,
`plank`). If no app window appears, dump
`cat /tmp/launch-<binary>.log` to find the cause (most common:
`exec: <binary>: not found` because you used the wrong name).

Finally `cursor-vm.screenshot({ vm_id })` so the user can see the app
window.

### 6. Uninstall

First, kill any running instance — `apt-get purge` won't reclaim disk if
the binary is still held by a process, and `delete_vm` cleanup is
slower if the container has a dangling app.

**Gotcha**: `pkill -f <binary>` self-matches the `bash -lc` that
`cursor-vm.shell` uses to wrap the command (its own command line
contains the binary name), and pkill kills its own shell with SIGTERM.
The result is a `returncode: -15` and a silent kill of the shell *and*
the target — confusing.

Use one of these instead:

```
# Option A — pkill on the basename only, anchored, no -f:
cursor-vm.shell({ vm_id, cmd: "pkill -x <binary> 2>/dev/null; sleep 2", timeout: 10 })

# Option B — pkill -f with a regex that excludes our own shell wrapper:
cursor-vm.shell({
  vm_id,
  cmd: "pkill -f '^(/usr/bin/)?<binary>($| )' 2>/dev/null; sleep 2",
  timeout: 10,
})
```

Both swallow the exit code (`2>/dev/null` for "no process matched") and
give Opera/Electron-like apps 2 s to flush. Verify with
`pgrep -x <binary>` returning empty.

Then purge:

```
cursor-vm.uninstall_apt({
  vm_id,
  package: "<package>",
  purge: true,
  autoremove: true,
})
```

Re-run `cursor-vm.list_installed({ vm_id, filter_substr: package_hint })`
and confirm the package is gone (the command should return an empty
`stdout`).

For `.AppImage`:
`cursor-vm.shell({ vm_id, cmd: "rm /root/Downloads/<file>" })`.

### 7. Delete the VM

```
cursor-vm.delete_vm({ vm_id, wipe: true })
```

This stops the container and removes the persistent /root volume — full
cleanup. Skill is complete.

## Why we delete instead of resetting

The previous version of this skill called `vm_reset` to wipe the single
VM and bring it back. The new controller is multi-VM: every test run
creates its own throw-away container, so we just delete it at the end.
Other VMs the user has open are untouched.

If you need to run multiple iterations in a tight loop, re-run from
step 1 — the controller is fast at creating new containers (~5 s once
the image is cached).

## When things go wrong

- **`curl` returns 4xx/5xx or empty body** — the vendor probably gates
  on User-Agent. Retry with a real Chrome UA (see step 2a).
- **`curl: (23)`** — `-J` couldn't determine a filename. Use `-o <name>`
  with an explicit filename instead.
- **`curl` succeeds but the file is HTML** — it's a "thank you" or
  redirect page. Try a `HEAD -L` to surface the next `Location:` header
  (step 2b) before falling back to scraping.
- **`apt-get install` reports `libqt5core5a … not installable`** — this
  is the Noble t64 transition, not a missing repo.
  `apt-get install -f` will NOT fix it. Follow step 4a (install
  `libqt5*t64` then `dpkg -i --force-depends`).
- **No file appears in `/root/Downloads` after step 2e** — the page may
  detect automation or require login. Tell the user, do not try to
  bypass.
- **`launch_app` succeeds but no window appears, log shows
  `exec: <binary>: not found`** — wrong binary name. Re-check
  `dpkg -L <package> | grep /bin/` to get the real name (step 4b).
- **`create_vm` fails with `Concurrent VM limit reached`** — ask the
  user which existing VM to delete first; do not delete on their behalf.

## Notes

- `delete_vm` is destructive but only for that one VM. Other VMs in
  other tabs survive untouched.
- The `chrome-devtools` MCP server is **off-limits in this skill** (see
  hard rule 2). If you need to debug the controller's own frontend, do
  it outside the skill's execution.
