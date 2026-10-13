import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { moveRelease } from "@/lib/mobile/release-service";

export const dynamic = "force-dynamic";

// Move a release along (draft, internal testing, closed testing, open testing, production, paused, retired). Production goes through the approval gate.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("platform:mobile:manage");
    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(req);
    requireReauth(admin, body.stepUpToken as string | undefined, "change a release");
    const result = await moveRelease(admin, id, { status: body.status, rollbackReferenceId: body.rollbackReferenceId, reason: body.reason, environment: body.environment });
    if (result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}