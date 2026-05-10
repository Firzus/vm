# AGENTS.md

## Overview & Scope

Cursor-style VM: a local multi-VM sandbox (Ubuntu 24.04 + XFCE in Docker) driven by a Next.js controller and an MCP server, accessed from the browser via noVNC. The repo is laid out as `apps/{controller,mcp-server}` + `automation/` + `vm-image/`; this file applies to the whole repo. No nested `AGENTS.md` exist — closest-wins precedence still applies if any are added later.

Subprojects:

- `apps/controller/` — Next.js 16 + React 19 controller (host-side).
- `apps/mcp-server/` — Python MCP server that wraps the controller's HTTP API.
- `automation/` — FastAPI server that runs **inside** each VM container, baked into the image at build time.
- `vm-image/` — Docker build context for the VM image (`Dockerfile`, `entrypoint.sh`, `assets/{chrome,theme}`).
- `scripts/` — repo utilities (e.g. `sync-mcp.mjs`).

## Agent Role

Senior full-stack engineer fluent in Next.js App Router (server + client components, custom Node server), Docker/dockerode, Python (FastAPI, MCP), and shell. Allowed: edit code, refactor, add features, update env schema, write commits/PRs when explicitly asked. Not allowed: change Docker host bindings to non-loopback, weaken Chrome managed policies, run/build the VM image without explicit ask, run the install/uninstall loop without `/vm-test-app-install` (`.cursor/skills/vm-test-app-install/SKILL.md`), push or force-push.

## Build, Test & Validation Commands

Controller (run from `apps/controller/`, package manager is **pnpm 10.33.2**):

```bash
cd apps/controller && pnpm install
cd apps/controller && pnpm lint                # eslint (eslint-config-next)
cd apps/controller && pnpm typecheck           # tsc --noEmit (strict)
cd apps/controller && pnpm dev                 # tsx server.ts, NODE_ENV=development
cd apps/controller && pnpm start               # tsx server.ts, NODE_ENV=production (auto-builds VM image on first boot)
cd apps/controller && pnpm build               # next build (unverified)
```

MCP server (Python, requires Docker + a running controller):

```bash
cd apps/mcp-server && python -m venv .venv
# Windows
apps\mcp-server\.venv\Scripts\python.exe -m pip install -r apps\mcp-server\requirements.txt
apps\mcp-server\.venv\Scripts\python.exe apps\mcp-server\smoke_test_cursor_vm.py   # (unverified)
apps\mcp-server\.venv\Scripts\python.exe apps\mcp-server\smoke_test_cdm.py         # (unverified)
```

VM image (built automatically by the controller on first `pnpm start`; only run manually when explicitly asked, build context is the repo root):

```bash
docker build -f vm-image/Dockerfile -t cursor-style-vm:latest .  # (unverified, slow)
```

MCP config render (`.mcp.template.json` → `.mcp.json` + `.cursor/mcp.json`, both gitignored):

```bash
node scripts/sync-mcp.mjs
```

No JS test runner is configured. Use `pnpm typecheck && pnpm lint` (in `apps/controller/`) as the default validation gate before declaring work done.

## Conventions & Patterns

- **Controller** is a Next.js 16 App Router project with `reactCompiler: true`. Keep server-only code under `apps/controller/src/lib/` and never import `src/lib/env.ts` from a client component.
- TypeScript `strict: true`. Path alias `@/*` → `apps/controller/src/*`. Prefer types from `src/lib/schemas.ts` (Zod) at every external boundary (env, HTTP I/O, dockerode events).
- API routes live under `apps/controller/src/app/api/{vms,vm/[id],events}/route.ts`. Per-VM proxy lives at `apps/controller/src/app/api/vm/[id]/[...path]/route.ts`. Add new VM endpoints there, not as standalone routes.
- VM lifecycle goes through `apps/controller/src/lib/vms.ts` (`VmRegistry`) + `ports.ts` (loopback allocator) + `image.ts` (auto-build). Docker is the source of truth — do not introduce in-process state that survives a controller restart.
- UI uses **shadcn/ui** (`style: new-york`, base `zinc`, icons `lucide-react`, prefix none). Aliases: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`. Tailwind v4 via `@tailwindcss/postcss`; global styles in `src/app/globals.css`.
- Animation: GSAP via `@gsap/react` (`useGSAP`), reveal helpers in `apps/controller/src/components/visuals/`. Respect reduced-motion.
- Data fetching: SWR + an SSE subscription on `/api/events` (see `src/lib/useVms.ts`). Don't poll Docker directly from the client.
- VM container ports: API `8000`, noVNC `6080`, VNC `5901`. Host-side they're allocated dynamically from `VM_PORT_*_BASE` and bound on `127.0.0.1` only.
- Python (`automation/`, `apps/mcp-server/`): pinned `requirements.txt`, FastAPI + Pydantic v2, `from __future__ import annotations`. The MCP server reads `CONTROLLER_URL` (default `http://localhost:3000`).
- MCP config is rendered from `.mcp.template.json` (committed) by `node scripts/sync-mcp.mjs`. Never edit `.mcp.json` or `.cursor/mcp.json` by hand — they are gitignored, generated per-machine, and overwritten on every render. The template uses `${REPO_ROOT}` and `${PYTHON}` placeholders to stay portable.
- Search excludes: `node_modules/`, `.next/`, `out/`, `build/`, `apps/controller/pnpm-lock.yaml`, `**/.venv/`, `.cursor/screens/`.

## Dos and Don'ts

- Do route every per-VM action through the controller proxy (`/api/vm/{id}/...`); never hit a VM's host port directly from the browser.
- Do validate every external input with Zod (`apps/controller/src/lib/schemas.ts`) before crossing a trust boundary.
- Do keep the controller stateless across restarts — derive state from Docker (`label=cursor-vm.role=vm`).
- Do use `pnpm` (not npm/yarn/bun) and respect `packageManager` pinning.
- Don't add a JS test runner, formatter, or new linter without approval.
- Don't bump `next`, `react`, `react-dom`, or `eslint-config-next` independently — they move together.
- Don't bind VM ports on `0.0.0.0`, expose Docker over TCP, or relax Chrome's managed policies in `vm-image/assets/chrome/policies/cursor-vm.json`.
- Don't run apt installs, big builds, or the install/uninstall loop unprompted.

## Safety & Guardrails

- Off-limits without explicit user request: pushing to `origin`, force-push, rewriting history, building/publishing the VM image, running smoke tests that create real containers, deleting Docker volumes, modifying `.mcp.template.json` server entries.
- Never edit generated/vendored content: `apps/controller/.next/`, `apps/controller/node_modules/`, `apps/controller/pnpm-lock.yaml` (regenerate via pnpm only), `apps/mcp-server/.venv/`, `**/*.tsbuildinfo`, `apps/controller/next-env.d.ts`.
- Never commit `.env`, `.env.local`, VNC passwords, or tokens. The default `VM_VNC_PASSWORD=agent` is for local-only loopback use; do not surface it in logs or UI.
- Treat `vm-image/Dockerfile`, `vm-image/entrypoint.sh`, `vm-image/assets/theme/build-theme.sh`, and `vm-image/assets/chrome/policies/cursor-vm.json` as security-sensitive — reviewer should look twice.
- Prefer fast, scoped commands. Avoid global installs and long-running watchers in CI/agent runs.

## Git & PR Rules

- Default branch: `main`. Work on a feature branch; PR into `main`.
- Commit subject style follows existing history: short, imperative, sentence case, optional `(#N)` for the merging PR (e.g. `Multi-VM controller: one Next.js service, N concurrent VMs, per-VM tabs (#2)`). Body in English only.
- Before opening a PR: `pnpm lint && pnpm typecheck` (in `apps/controller/`) must pass. Mention any `(unverified)` command you didn't run.
- Keep PRs focused. Update `README.md` and this file when behavior, env vars, ports, or commands change.
