/**
 * Server-Sent Events stream of VM lifecycle events.
 *
 * Replays Docker's own event bus (`docker.getEvents`) filtered to containers
 * carrying the `cursor-vm.role=vm` label, normalizing each one into a typed
 * `VmEvent`. The browser subscribes via `useSWRSubscription` and uses the
 * stream to invalidate the SWR cache for `/api/vms`.
 *
 * The Docker daemon is the source of truth — no DB, no in-memory pubsub.
 */
import type { NextRequest } from "next/server";
import { getDocker, pingDocker } from "@/lib/docker";
import type { VmEvent, VmEventKind } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DockerEvent {
  Type?: string;
  Action?: string;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
  time?: number;
  timeNano?: number;
}

function mapAction(action: string | undefined): VmEventKind | null {
  switch (action) {
    case "create":
      return "registered";
    case "start":
      return "started";
    case "kill":
    case "stop":
    case "pause":
      return "stopping";
    case "die":
      return "died";
    case "destroy":
    case "remove":
      return "destroyed";
    case "restart":
      return "starting";
    default:
      return null;
  }
}

function toVmEvent(raw: DockerEvent): VmEvent | null {
  if (raw.Type !== "container") return null;
  const labels = raw.Actor?.Attributes ?? {};
  if (labels["cursor-vm.role"] !== "vm") return null;
  const vmId = labels["cursor-vm.id"];
  if (!vmId) return null;
  const kind = mapAction(raw.Action);
  if (!kind) return null;
  return {
    vmId,
    kind,
    at: new Date((raw.time ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

export async function GET(req: NextRequest) {
  await pingDocker();

  const encoder = new TextEncoder();
  let cancelled = false;
  // Keep a handle on the upstream Docker stream so we can destroy it cleanly
  // if the client disconnects mid-stream.
  let upstream: NodeJS.ReadableStream | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Comment line plus initial flush so EventSource fires `onopen`.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      // Heartbeat every 25s to keep proxies/load balancers from closing the
      // connection. SSE comments don't trigger client message handlers.
      const heartbeat = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* controller already closed */
        }
      }, 25_000);

      try {
        upstream = (await getDocker().getEvents({
          filters: { label: ["cursor-vm.role=vm"], type: ["container"] },
        })) as unknown as NodeJS.ReadableStream;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ message: detail })}\n\n`,
          ),
        );
        clearInterval(heartbeat);
        controller.close();
        return;
      }

      // Buffer Docker's newline-delimited JSON lines.
      let buffer = "";
      upstream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const parsed = JSON.parse(line) as DockerEvent;
            const evt = toVmEvent(parsed);
            if (!evt) continue;
            controller.enqueue(
              encoder.encode(`event: vm\ndata: ${JSON.stringify(evt)}\n\n`),
            );
          } catch {
            // ignore unparseable lines
          }
        }
      });

      upstream.on("end", () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      upstream.on("error", (err: Error) => {
        clearInterval(heartbeat);
        try {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`,
            ),
          );
          controller.close();
        } catch {
          /* already closed */
        }
      });

      // Disconnect cleanup.
      req.signal.addEventListener("abort", () => {
        cancelled = true;
        clearInterval(heartbeat);
        try {
          (upstream as unknown as { destroy?: (e?: Error) => void } | null)?.destroy?.();
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
