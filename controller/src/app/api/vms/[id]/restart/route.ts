import { NextRequest, NextResponse } from "next/server";
import { VmIdParam } from "@/lib/schemas";
import { getRegistry } from "@/lib/vms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/vms/{id}/restart — soft restart (keeps volume). */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = VmIdParam.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  try {
    const registry = getRegistry();
    await registry.bootstrap();
    const vm = await registry.restart(parsed.data);
    return NextResponse.json({ vm });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
