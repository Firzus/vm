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
import { createConnection } from "node:net";
import { monitorEventLoopDelay } from "node:perf_hooks";
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

/**
 * Probe a loopback TCP port once. Resolves true if a connection completes
 * within `timeoutMs`, false on any error/timeout. Always cleans up the
 * probe socket so we never leak FDs.
 *
 * We use an explicit `setTimeout` rather than `socket.setTimeout` because
 * the latter is an *idle* timeout — it doesn't fire while a SYN is still
 * pending, so a dropped SYN could keep the socket alive for the OS-level
 * connect timeout (tens of seconds on Windows) and queue up extra probes.
 */
function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const sock = createConnection({ host, port });
    sock.unref(); // never keep the event loop alive for a probe

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Detach all listeners before destroying so a late `error` event from
      // the kernel (e.g. ECONNREFUSED arriving after we resolved) cannot
      // bubble up as an `uncaughtException`.
      sock.removeAllListeners();
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false));
    sock.once("close", () => finish(false));
  });
}

/**
 * Wait until the upstream websockify port is accepting connections, or until
 * we hit the deadline / the client gives up. This lets us keep the browser's
 * WebSocket in `connecting` during the early-boot window (Xvfb → XFCE →
 * x11vnc → websockify is sequential in entrypoint.sh) instead of accepting
 * the upgrade and immediately closing it — which causes `@novnc/novnc` to
 * `console.error` a noisy `Connection closed (code: 1006)` for every cold
 * boot. The first probe succeeds instantly once websockify is already up,
 * so warm reconnects pay no measurable cost.
 *
 * Returns "ready" on success, "client_gone" if the browser disconnected
 * while waiting (no need to surface anything), or "timeout" if the upstream
 * never came up within the budget (let the upgrade fail normally so the UI
 * can surface a real error).
 */
async function waitForUpstreamReady(
  host: string,
  port: number,
  clientSocket: Socket,
): Promise<"ready" | "client_gone" | "timeout"> {
  const deadline = Date.now() + 15_000;
  const probeTimeoutMs = 500;
  const retryDelayMs = 300;
  let attempts = 0;
  let logged = false;

  while (Date.now() < deadline) {
    if (clientSocket.destroyed) return "client_gone";
    const ok = await probeTcp(host, port, probeTimeoutMs);
    if (ok) {
      if (logged) {
        console.log(
          `[ws-bridge] upstream ${host}:${port} ready after ${attempts + 1} probe(s)`,
        );
      }
      return "ready";
    }
    attempts += 1;
    if (!logged) {
      // Single info line per pending connection — the browser is in the
      // pre-ready window, so this is expected for the first few seconds
      // after a fresh `POST /api/vms`.
      console.log(
        `[ws-bridge] upstream ${host}:${port} not ready yet, holding upgrade…`,
      );
      logged = true;
    }
    await new Promise<void>((r) => setTimeout(r, retryDelayMs));
  }
  return "timeout";
}

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

  // Surface unexpected client-side socket errors that fire *before* the
  // upstream upgrade completes; once the bridge is live, the cleanup chain
  // installed inside the `upgrade` handler takes over (and removes this one
  // to avoid double-logging).
  const preBridgeClientError = (err: Error) =>
    console.error("[ws-bridge] client socket error:", err.message);
  clientSocket.on("error", preBridgeClientError);

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    clientSocket.off("error", preBridgeClientError);
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

    let teardown = false;
    const cleanup = (origin: string) => () => {
      if (teardown) return;
      teardown = true;
      console.log(`[ws-bridge] ${origin} ended`);
      try {
        upstreamSocket.unpipe(clientSocket as NodeJS.WritableStream);
      } catch {
        /* ignore */
      }
      try {
        (clientSocket as unknown as NodeJS.ReadableStream).unpipe(upstreamSocket);
      } catch {
        /* ignore */
      }
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

    // `pipe()` propagates `end` but not `error` or `close`, so without these
    // listeners a half-broken socket would orphan the other side and leak
    // a Docker-host FD until the process restarts. We hook all three on
    // both sides and let the first one fire teardown.
    upstreamSocket.on("end", cleanup("upstream"));
    upstreamSocket.on("close", cleanup("upstream-close"));
    upstreamSocket.on("error", (err) => {
      console.error("[ws-bridge] upstream socket error:", err.message);
      cleanup("upstream-error")();
    });
    clientSocket.on("end", cleanup("client"));
    clientSocket.on("close", cleanup("client-close"));
    clientSocket.on("error", (err) => {
      console.error("[ws-bridge] client socket error:", err.message);
      cleanup("client-error")();
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

/**
 * Lightweight runtime instrumentation. The dev server has hung three times
 * in a single session with port 3000 still LISTENING but every request
 * timing out — classic event-loop starvation. These three signals make the
 * next freeze diagnose itself instead of needing a hard restart:
 *
 *   1. `monitorEventLoopDelay()` records min/mean/max blocking time and we
 *      log a warning when the mean climbs past 500 ms over a 5 s window.
 *   2. `uncaughtException` / `unhandledRejection` become a single log line
 *      (instead of silently killing whichever I/O cycle they fire under).
 *   3. A periodic heartbeat log proves the loop is still alive even when
 *      no requests are coming in — its absence in the next freeze pinpoints
 *      the exact moment the loop wedged.
 */
function installRuntimeInstrumentation(): void {
  process.on("uncaughtException", (err: Error) => {
    console.error("[runtime] uncaughtException:", err.stack ?? err.message);
  });
  process.on("unhandledRejection", (reason) => {
    const detail =
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    console.error("[runtime] unhandledRejection:", detail);
  });

  if (env.NODE_ENV !== "production") {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();

    const intervalMs = 5_000;
    const tick = setInterval(() => {
      const meanMs = histogram.mean / 1e6;
      const maxMs = histogram.max / 1e6;
      const p99Ms = histogram.percentile(99) / 1e6;
      histogram.reset();
      // Always emit a one-line heartbeat so a freeze is visible by absence.
      const tag = meanMs > 500 || maxMs > 2_000 ? "warn" : "log";
      const line = `[runtime] loop heartbeat mean=${meanMs.toFixed(1)}ms p99=${p99Ms.toFixed(1)}ms max=${maxMs.toFixed(1)}ms`;
      if (tag === "warn") console.warn(line);
      else console.log(line);
    }, intervalMs);
    tick.unref(); // never keep the process alive on its own
  }
}

(async () => {
  installRuntimeInstrumentation();
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

    // Hold the upstream dial until websockify inside the container is
    // listening. Without this, the browser sees a 1006 close during the
    // cold-boot window and `@novnc/novnc` floods the console with
    // `Connection closed (code: 1006)` errors — see commit message for
    // context. The probe is cheap on warm reconnects (single immediate
    // `connect`), so the happy path is unchanged.
    const clientSocket = socket as Socket;
    // Mirror the timeout/keepalive tuning that pumpUpgrade applies, so the
    // socket isn't RST'd by Node's HTTP layer while we're waiting on the
    // upstream probe.
    clientSocket.setTimeout?.(0);
    clientSocket.setKeepAlive?.(true, 30_000);
    clientSocket.setNoDelay?.(true);

    // Without this listener, a client-side socket error during the wait
    // window would propagate as an `uncaughtException`. pumpUpgrade installs
    // its own listener once the bridge is live; remove ours just before
    // handing off so we don't double-log.
    const preBridgeError = (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
      console.warn(
        `[ws-bridge] client socket error during pre-ready wait: ${err.message}`,
      );
    };
    clientSocket.on("error", preBridgeError);

    const upstreamState = await waitForUpstreamReady(
      "127.0.0.1",
      vm.ports.novnc,
      clientSocket,
    );

    if (upstreamState === "client_gone") {
      // Browser closed the WebSocket before we got an upstream connection;
      // nothing more to do, the socket is already destroyed.
      return;
    }

    if (upstreamState === "timeout") {
      // Genuine failure: websockify never came up. Let the upgrade attempt
      // fail so the UI's silent-retry budget eventually surfaces a real
      // error to the user.
      console.warn(
        `[ws-bridge] upstream 127.0.0.1:${vm.ports.novnc} did not become ready in time; closing`,
      );
      try {
        clientSocket.destroy();
      } catch {
        /* ignore */
      }
      return;
    }

    // Hand off to the byte-pump bridge. pumpUpgrade installs its own
    // `error` listener, so remove ours to avoid double-logging.
    clientSocket.off("error", preBridgeError);
    pumpUpgrade(req, clientSocket, head, "127.0.0.1", vm.ports.novnc, "/websockify");
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
