import { NextRequest, NextResponse } from "next/server";
import { DeleteVmQuery, VmIdParam } from "@/lib/schemas";
import { getRegistry } from "@/lib/vms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/vms/{id} — fetch a single VM. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = VmIdParam.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const registry = getRegistry();
  await registry.bootstrap();
  const vm = registry.get(parsed.data);
  if (!vm) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ vm });
}

/** DELETE /api/vms/{id}?wipe=1 — destroy container, optionally remove volume. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsedId = VmIdParam.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const wipe = DeleteVmQuery.safeParse({
    wipe: req.nextUrl.searchParams.get("wipe") ?? false,
  });
  if (!wipe.success) {
    return NextResponse.json(
      { error: "invalid_query", issues: wipe.error.issues },
      { status: 400 },
    );
  }
  try {
    const registry = getRegistry();
    await registry.bootstrap();
    await registry.delete(parsedId.data, { wipe: wipe.data.wipe });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
