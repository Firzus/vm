# Controller (Next.js)

The single host service for the multi-VM Cursor-style sandbox: spawns and
destroys VM containers via `dockerode`, reverse-proxies their automation API
+ noVNC, and serves the tabbed web console.

See the root [`README.md`](../README.md) for the full architecture and quick
start. Brief reminder:

```bash
pnpm install
pnpm start          # boots the controller on http://localhost:3000
pnpm dev            # same thing in dev mode (Turbopack)
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint
pnpm build          # next build (only required if you want a true prod build;
                    # `pnpm start` runs server.ts via tsx so it just works)
```

## Layout

```text
controller/
├── server.ts                 Custom Next.js server: HTTP + noVNC WS upgrade proxy
├── package.json
└── src/
    ├── app/
    │   ├── page.tsx          Tabs shell over N VmConsoles
    │   └── api/
    │       ├── vms/...       Lifecycle endpoints (create/list/delete/restart/reset)
    │       ├── vm/[id]/      Per-VM HTTP proxy → 127.0.0.1:{apiPort}
    │       └── events/       SSE stream of Docker events
    ├── components/
    │   ├── console/
    │   │   ├── vm-tabs.tsx       Top-level tab shell + create/delete/reset UI
    │   │   ├── vm-console.tsx    One VM's noVNC + dock + shell drawer
    │   │   ├── header.tsx
    │   │   ├── boot-loader.tsx
    │   │   ├── dock.tsx
    │   │   ├── shell-drawer.tsx
    │   │   └── status.tsx
    │   ├── vnc-viewer.tsx        @novnc/novnc client
    │   └── ui/                   shadcn/ui primitives
    └── lib/
        ├── docker.ts             dockerode singleton (named pipe / unix socket)
        ├── vms.ts                VmRegistry (create/list/delete/restart/reset)
        ├── ports.ts              Loopback port allocator
        ├── image.ts              ensureVmImage (auto-build from ../Dockerfile)
        ├── schemas.ts            Zod schemas — single source of truth at boundaries
        ├── env.ts                Validated env (parsed once at boot)
        ├── vm-client.ts          Per-VM HTTP client (browser-side)
        ├── useVms.ts             SWR + SSE subscription hook
        └── utils.ts
```

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| Custom server | `node http` + `next()` for the WS upgrade |
| Docker SDK | [`dockerode`](https://github.com/apocas/dockerode) |
| WS proxy (noVNC) | TCP byte-pump in `server.ts` |
| Validation | [`zod`](https://zod.dev) v4 |
| Server state (browser) | [`swr`](https://swr.vercel.app) |
| Reactivity | SSE streamed from `docker.getEvents` |
| State (UI) | `useState` + URL search params (`?vm={id}`) |

### Why no `socket.io`?

The two real-time channels we have today are deliberately *not* socket.io:

- **noVNC bridge** uses raw WebSocket framing (subprotocol `binary`). websockify
  inside the VM doesn't speak socket.io's `?EIO=4` handshake, so a socket.io
  proxy wouldn't work. The byte-pump in `server.ts` is the correct shape for
  this transport.
- **Docker events** are pushed one-way (server → browser) via SSE. `EventSource`
  handles reconnection natively and the payload is tiny — adding socket.io
  would be heavier than what we ship today with zero new deps.

If a future feature needs **bidirectional structured messaging with rooms,
acks, or long-polling fallback** (live `docker logs --follow` from multiple
clients, multi-user with per-user VM rooms, ack-based command pipelines, …),
socket.io is a fine drop-in. Add it as a separate `/socket.io` namespace in
`server.ts` — keep the noVNC bridge and SSE as-is, both happy to coexist
on the same custom server.

## Configuration

All env vars are validated at boot via `src/lib/env.ts`. See the root README
for the full list. Set them in `controller/.env.local`.
