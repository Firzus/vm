/**
 * Custom Next.js server.
 *
 * Why we need a custom server:
 *   App Router route handlers don't expose the HTTP `upgrade` event, so we
 *   can't proxy the noVNC WebSocket via a standard route. We intercept
 *   `/api/vm/{id}/novnc` upgrades here and bridge them to the per-VM
 *   websockify endpoint with a tiny in-process WebSocket relay.
 *
 * Boot sequence:
 *   1. Validate env (via importing `./src/lib/env`).
 *   2. Build the VM image if missing (non-blocking — surfaced in the UI).
 *   3. Start Next.js + the WS upgrade interceptor.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { parse } from "node:url";
import next from "next";
// Import order matters: env validation runs first, then dockerode lazy-init.
import { env } from "./src/lib/env";
import { ensureVmImage } from "./src/lib/image";
import { getRegistry } from "./src/lib/vms";
import { pingDocker } from "./src/lib/docker";

const dev = env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const NOVNC_RE = /^\/api\/vm\/([a-zA-Z0-9-]+)\/novnc(?:\/.*)?$/;

/**
 * TCP byte-pump WebSocket bridge.
 *
 * We don't speak the WebSocket framing protocol on either side: we simply
 * forward the upgrade request to the upstream websockify server, and once
 * the upstream answers with `101 Switching Protocols`, we splice the two
 * raw TCP sockets together. This is exactly what `socat` would do, and it
 * sidesteps every framing/subprotocol/encoding edge case that bites you
 * when bridging two `ws` libraries (especially on Windows where the
 * `WebSocket` client sometimes complains about `1005` close codes that
 * websockify legitimately sends).
 */
import type { Socket } from "node:net";

function pumpUpgrade(
  clientReq: IncomingMessage,
  clientSocket: Socket,
  clientHead: Buffer,
  upstreamHost: string,
  upstreamPort: number,
  upstreamPath: string,
) {
  // Disable any read/write timeout on the raw client socket and the underlying
  // request — Node's HTTP layer will RST the connection after a short idle
  // period otherwise, which manifests as ECONNRESET ~20ms into the upgrade.
  const rawClientSocket = clientSocket as unknown as {
    setTimeout?: (ms: number) => void;
    setKeepAlive?: (b: boolean, ms?: number) => void;
    setNoDelay?: (b: boolean) => void;
  };
  rawClientSocket.setTimeout?.(0);
  rawClientSocket.setKeepAlive?.(true, 30_000);
  rawClientSocket.setNoDelay?.(true);

  const upstreamReq = httpRequest({
    host: upstreamHost,
    port: upstreamPort,
    path: upstreamPath,
    method: "GET",
    headers: {
      ...clientReq.headers,
      // Replace the host header with the upstream's so websockify is happy.
      host: `${upstreamHost}:${upstreamPort}`,
    },
  });

  upstreamReq.on("error", (err) => {
    console.error("[ws-bridge] upstream request error:", err.message);
    try {
      clientSocket.destroy();
    } catch {
      /* ignore */
    }
  });

  upstreamReq.on("response", (res) => {
    // Upstream returned a regular HTTP response — write it through and bail.
    console.warn(
      `[ws-bridge] upstream did not upgrade (status=${res.statusCode}); closing`,
    );
    try {
      clientSocket.destroy();
    } catch {
      /* ignore */
    }
  });

  // Surface unexpected client-side socket errors; benign close events are
  // routed through the cleanup chain below once the bridge is live.
  clientSocket.on("error", (err: Error) =>
    console.error("[ws-bridge] client socket error:", err.message),
  );

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    if (clientSocket.destroyed) {
      console.warn(
        "[ws-bridge] client already destroyed at upgrade time; aborting",
      );
      upstreamSocket.destroy();
      return;
    }

    // Forward the 101 (and any extra header bytes the upstream sent) to the
    // browser, then splice the two TCP sockets together for the rest of
    // the conversation.
    const headers = [
      `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`,
    ];
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      const list = Array.isArray(value) ? value : [value];
      for (const v of list) headers.push(`${key}: ${v}`);
    }
    headers.push("", "");
    clientSocket.write(headers.join("\r\n"));
    if (upstreamHead?.length) clientSocket.write(upstreamHead);
    if (clientHead?.length) upstreamSocket.write(clientHead);

    // Bidirectional byte pipe.
    upstreamSocket.pipe(clientSocket as NodeJS.WritableStream);
    (clientSocket as unknown as NodeJS.ReadableStream).pipe(upstreamSocket);

    const cleanup = (origin: string) => () => {
      console.log(`[ws-bridge] ${origin} ended`);
      try {
        upstreamSocket.destroy();
      } catch {
        /* ignore */
      }
      try {
        clientSocket.destroy();
      } catch {
        /* ignore */
      }
    };

    upstreamSocket.on("end", cleanup("upstream"));
    upstreamSocket.on("error", (err) => {
      console.error("[ws-bridge] upstream socket error:", err.message);
      cleanup("upstream-error")();
    });

    console.log(`[ws-bridge] bridge live ${clientReq.url} ↔ ${upstreamHost}:${upstreamPort}${upstreamPath}`);
  });

  upstreamReq.end();
}

async function bootstrap() {
  await pingDocker().catch((err: Error) => {
    // Allow the UI to render and surface the docker error rather than
    // crashing the controller — many users will hit `pnpm start` before
    // Docker Desktop is fully up.
    console.warn(`[boot] ${err.message}`);
  });

  // Pre-build the VM image in the background so the first `POST /api/vms`
  // doesn't block for a fresh build. Errors are surfaced via the registry.
  ensureVmImage().catch((err: Error) => {
    console.error(`[boot] ensureVmImage failed: ${err.message}`);
  });

  // Pre-warm the registry so SSE/HTTP requests don't all race to bootstrap.
  await getRegistry()
    .bootstrap()
    .catch((err: Error) => {
      console.warn(`[boot] registry bootstrap: ${err.message}`);
    });
}

(async () => {
  await app.prepare();
  await bootstrap();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const parsed = parse(req.url ?? "/", true);
    handle(req, res, parsed);
  });

  // Next.js installs its own `upgrade` handler on `req.socket.server` the
  // first time it sees a request, and that handler unconditionally calls
  // `socket.destroy()` for any URL it doesn't recognise — including our
  // VM noVNC routes. We intercept `server.on('upgrade', ...)` so Next's
  // handler is captured (and selectively forwarded) but never wired
  // directly into the EventEmitter. Our own handler stays in charge of
  // routing the upgrade to the right place.
  let nextUpgradeHandler:
    | ((req: IncomingMessage, socket: NodeJS.Socket, head: Buffer) => void)
    | null = null;
  const originalOn = server.on.bind(server);
  (server as unknown as { on: (...args: unknown[]) => unknown }).on = (
    event: unknown,
    listener: unknown,
  ) => {
    if (event === "upgrade") {
      // Capture the first 'upgrade' listener (Next.js or another lib) as
      // the fallback we'll call ourselves for non-VM upgrades.
      if (!nextUpgradeHandler) {
        nextUpgradeHandler = listener as typeof nextUpgradeHandler;
      }
      return server;
    }
    return originalOn(event as never, listener as never);
  };

  // Our own upgrade listener — added directly via the original (unpatched)
  // EventEmitter so it actually runs.
  originalOn("upgrade", async (req, socket, head) => {
    const url = req.url ?? "";
    const match = NOVNC_RE.exec(url);
    if (!match) {
      // Not a VM noVNC upgrade — defer to whichever upgrade listener Next.js
      // (or another lib) registered so HMR/RSC keep working in dev. In
      // production Next.js doesn't currently install one.
      if (nextUpgradeHandler) {
        nextUpgradeHandler(req, socket as NodeJS.Socket, head);
      } else {
        socket.destroy();
      }
      return;
    }

    const vmId = match[1];
    let vm;
    try {
      const registry = getRegistry();
      await registry.bootstrap();
      vm = registry.get(vmId);
    } catch (err) {
      console.error("[ws-bridge] registry lookup failed:", err);
      socket.destroy();
      return;
    }

    if (!vm) {
      socket.write(
        "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nvm_not_found",
      );
      socket.destroy();
      return;
    }

    pumpUpgrade(req, socket as Socket, head, "127.0.0.1", vm.ports.novnc, "/websockify");
  });

  server.listen(port, hostname, () => {
    console.log(
      `\n  Cursor VM controller ready on http://${hostname}:${port}\n` +
        `  - Image:           ${env.VM_IMAGE}\n` +
        `  - Max concurrent:  ${env.VM_MAX_CONCURRENT}\n` +
        `  - Memory per VM:   ${env.VM_MEMORY_MB} MB\n` +
        `  - CPUs per VM:     ${env.VM_CPUS}\n`,
    );
  });
})().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
