/**
 * Per-VM HTTP reverse proxy. The browser and the host MCP only ever talk to
 * the controller; this route forwards each call to the in-VM automation API
 * (FastAPI on container port 8000, published on a loopback port we look up
 * via the VM registry).
 *
 *   /api/vm/{id}/screenshot         →   http://127.0.0.1:{apiPort}/screenshot
 *   /api/vm/{id}/shell  (POST)      →   http://127.0.0.1:{apiPort}/shell
 *   /api/vm/{id}/click  (POST)      →   http://127.0.0.1:{apiPort}/click
 *
 * Special-case for FastAPI's bundled docs (`/docs`, `/redoc`): Swagger UI is
 * served as a static HTML shell that loads its spec from `/openapi.json` at
 * the page origin. Because the page is served through this proxy, that URL
 * resolves to the controller's root and 404s. We fix it two ways:
 *   1. Forward `X-Forwarded-Prefix: /api/vm/{id}` so an updated FastAPI app
 *      can build the correct `openapi_url` itself (see automation/server.py).
 *   2. As a belt-and-braces fallback for older VM images, rewrite the docs
 *      HTML on the fly to point Swagger UI / ReDoc at the proxied openapi
 *      path.
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

// FastAPI docs pages whose embedded Swagger UI / ReDoc config references
// `/openapi.json` at the page origin. We rewrite the body of these specific
// responses; everything else is streamed unchanged.
const DOCS_HTML_PATHS = new Set(["docs", "redoc"]);

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

  // Path the browser used to reach us, e.g. `/api/vm/foo`. Newer FastAPI
  // builds use this (via `X-Forwarded-Prefix`) to compute a correct
  // `openapi_url` for the bundled Swagger UI / ReDoc shells.
  const forwardedPrefix = `/api/vm/${encodeURIComponent(idCheck.data)}`;

  const headers = new Headers();
  for (const [key, value] of req.headers) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.delete("host");
  headers.set("x-forwarded-prefix", forwardedPrefix);

  // Tie the upstream call to the inbound request lifecycle. Without this,
  // a hung in-VM handler keeps the undici socket pinned forever and the
  // host's fetch keep-alive pool slowly fills up — eventually starving every
  // proxy call (and, under load, freezing the whole event loop).
  const abort = new AbortController();
  // Hard wall-clock cap so even a request whose client disconnect signal
  // never fires (e.g. an MCP client stuck in retry) can't pin a socket.
  // 60s is well above legitimate screenshot/shell turnarounds yet short
  // enough to recycle a wedged in-VM call. `unref` so the timer never
  // delays a clean shutdown on its own.
  const hardTimeout = setTimeout(
    () => abort.abort(new Error("vm_api_timeout")),
    60_000,
  );
  hardTimeout.unref?.();
  const onClientAbort = () => abort.abort(new Error("client_aborted"));
  req.signal.addEventListener("abort", onClientAbort, { once: true });

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
    signal: abort.signal,
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    clearTimeout(hardTimeout);
    req.signal.removeEventListener("abort", onClientAbort);
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

  // Belt-and-braces: rewrite the docs HTML so older VM images (which don't
  // honour `X-Forwarded-Prefix`) still produce a working Swagger UI / ReDoc
  // page through the proxy. We only touch HTML responses for the known docs
  // paths to avoid corrupting anything else.
  const isDocsPath =
    segments.length === 1 && DOCS_HTML_PATHS.has(segments[0].toLowerCase());
  const contentType = upstream.headers.get("content-type") ?? "";
  if (
    req.method === "GET" &&
    upstream.ok &&
    isDocsPath &&
    contentType.toLowerCase().includes("text/html")
  ) {
    const original = await upstream.text();
    clearTimeout(hardTimeout);
    req.signal.removeEventListener("abort", onClientAbort);
    const rewritten = rewriteDocsHtml(original, forwardedPrefix);
    // Body length changed; let the runtime recompute it.
    responseHeaders.delete("content-length");
    return new NextResponse(rewritten, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }

  // Streaming pass-through. The hard timeout + client-abort listener stay
  // armed: if Next finishes piping the body cleanly, the response stream
  // closes and the underlying socket frees naturally; if the body stalls
  // mid-stream, the 60s cap aborts the upstream socket so it can't stay
  // pinned in undici's keep-alive pool.
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

/**
 * Rewrite FastAPI's Swagger UI / ReDoc shell so it loads the spec through the
 * controller proxy. Both shells reference the spec via a literal
 * `"/openapi.json"` (Swagger UI) or `spec-url="/openapi.json"` (ReDoc) string,
 * so a targeted string replace is sufficient and avoids pulling in a parser.
 */
function rewriteDocsHtml(html: string, prefix: string): string {
  const proxiedSpec = `${prefix}/openapi.json`;
  return html
    .replaceAll('"/openapi.json"', `"${proxiedSpec}"`)
    .replaceAll("'/openapi.json'", `'${proxiedSpec}'`)
    .replaceAll('spec-url="/openapi.json"', `spec-url="${proxiedSpec}"`);
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
