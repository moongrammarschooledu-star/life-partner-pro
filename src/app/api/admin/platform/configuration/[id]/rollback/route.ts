import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { rollbackConfigChange } from "@/lib/platform/rollback";

export const dynamic = "force-dynamic";

// Roll one change back by writing its previous value as a NEW change (history is never rewritten). Only settings and feature flags can be rolled back; a
// change that was itself superseded is refused. Needs the rollback permission, a reason, the environment, a fresh password confirmation and the approval gate.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("platform:configuration:rollback");
    const { id } = await params;
    const body = await readJson<{ reason?: unknown; environment?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "roll back a configuration change");
    const result = await rollbackConfigChange(admin, { changeId: id, reason: body.reason, environment: body.environment });
    if ("approvalRequired" in result && result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}