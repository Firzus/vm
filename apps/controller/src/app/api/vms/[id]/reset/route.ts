import { NextRequest, NextResponse } from "next/server";
import { ResetVmQuery, VmIdParam } from "@/lib/schemas";
import { getRegistry } from "@/lib/vms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/vms/{id}/reset?wipe=1 — destroy + recreate the container with
 * the same id (keeps the volume by default; pass wipe=1 to also recreate
 * the per-VM /root from scratch).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsedId = VmIdParam.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const parsedQuery = ResetVmQuery.safeParse({
    wipe: req.nextUrl.searchParams.get("wipe") ?? false,
  });
  if (!parsedQuery.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  try {
    const registry = getRegistry();
    await registry.bootstrap();
    const vm = await registry.reset(parsedId.data, {
      wipe: parsedQuery.data.wipe,
    });
    return NextResponse.json({ vm });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
