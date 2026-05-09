/**
 * Per-VM HTTP reverse proxy. The browser and the host MCP only ever talk to
 * the controller; this route forwards each call to the in-VM automation API
 * (FastAPI on container port 8000, published on a loopback port we look up
 * via the VM registry).
 *
 *   /api/vm/{id}/screenshot         →   http://127.0.0.1:{apiPort}/screenshot
 *   /api/vm/{id}/shell  (POST)      →   http://127.0.0.1:{apiPort}/shell
 *   /api/vm/{id}/click  (POST)      →   http://127.0.0.1:{apiPort}/click
 */
import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "@/lib/vms";
import { VmIdParam } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "upgrade",
  "host",
  "content-length",
]);

type Ctx = { params: Promise<{ id: string; path: string[] }> };

async function proxy(req: NextRequest, vmId: string, segments: string[]) {
  const idCheck = VmIdParam.safeParse(vmId);
  if (!idCheck.success) {
    return NextResponse.json({ error: "invalid_vm_id" }, { status: 400 });
  }

  const registry = getRegistry();
  await registry.bootstrap();
  const vm = registry.get(idCheck.data);
  if (!vm) {
    return NextResponse.json({ error: "vm_not_found" }, { status: 404 });
  }

  const targetPath = segments.map(encodeURIComponent).join("/");
  const search = req.nextUrl.search ?? "";
  const url = `http://127.0.0.1:${vm.ports.api}/${targetPath}${search}`;

  const headers = new Headers();
  for (const [key, value] of req.headers) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.delete("host");

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    return NextResponse.json(
      {
        error: "vm_api_unreachable",
        target: url,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) responseHeaders.set(key, value);
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function handler(req: NextRequest, ctx: Ctx) {
  const { id, path } = await ctx.params;
  return proxy(req, id, path);
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as DELETE,
  handler as PATCH,
};
