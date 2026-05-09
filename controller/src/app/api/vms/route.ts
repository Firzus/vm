import { NextRequest, NextResponse } from "next/server";
import { CreateVmInput } from "@/lib/schemas";
import { getRegistry } from "@/lib/vms";
import { pingDocker } from "@/lib/docker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/vms — list all VMs (rehydrated from Docker on first call). */
export async function GET() {
  try {
    await pingDocker();
    const registry = getRegistry();
    await registry.bootstrap();
    await registry.refresh();
    return NextResponse.json({ vms: registry.list() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** POST /api/vms — create a fresh VM. Body: CreateVmInput. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = CreateVmInput.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await pingDocker();
    const registry = getRegistry();
    await registry.bootstrap();
    const vm = await registry.create(parsed.data);
    return NextResponse.json({ vm }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
