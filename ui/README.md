# VM Console (Next.js)

A Cursor-style web console for the VM container running next door:
fullscreen interactive remote desktop, status pill, screenshot, terminal
launcher, restart and reconnect controls.

## Run

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

The VM container must already be running (from the parent folder):

```bash
docker compose up -d
```

## How it works

- The browser opens a WebSocket directly to the noVNC websockify endpoint
  on `ws://localhost:6080/websockify` and renders the desktop with
  `@novnc/novnc`.
- The toolbar controls call the FastAPI automation API on
  `http://localhost:8000` through a thin Next.js proxy at `/api/vm/*` so
  CORS is never an issue.
- All inputs (mouse, keyboard, scroll) are sent straight to the VM, just
  like in the Cursor cloud agent UI.

## Configuration

Override defaults via `.env.local` (see `.env.local.example`).
