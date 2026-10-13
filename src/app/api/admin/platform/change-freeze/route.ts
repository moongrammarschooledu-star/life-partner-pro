import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { endFreeze, getActiveFreeze, listFreezes, startFreeze } from "@/lib/platform/freeze";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin("platform:maintenance:view");
    return NextResponse.json({ active: await getActiveFreeze(), items: await listFreezes() });
  } catch (error) {
    return handleApiError(error);
  }
}

// Start or end a change freeze. While one is active, configuration changes are refused (423) except break-glass and restrictive emergency actions.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("platform:change_freeze");
    const body = await readJson<{ action?: unknown; reason?: unknown; endsAt?: unknown; environment?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "change the change freeze");
    if (body.action === "END") return NextResponse.json(await endFreeze(admin, { reason: body.reason, environment: body.environment }));
    return NextResponse.json(await startFreeze(admin, { reason: body.reason, endsAt: body.endsAt, environment: body.environment }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}