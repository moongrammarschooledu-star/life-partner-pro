import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { requestContainment, type ContainmentParams, type ContainmentType } from "@/lib/soc/containment";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// POST { actionType, params, reason }. A narrow action runs now; a broad one waits for a DIFFERENT person to approve it. The requester is always
// the signed-in administrator.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:containment:request");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    const b = await readBody(req, 5_000);
    const p = (b.params && typeof b.params === "object" && !Array.isArray(b.params) ? b.params : {}) as Record<string, unknown>;
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "containment-request", resourceId: id });
    const row = await requestContainment(
      await currentViewer(admin.id), id, str(b, "actionType", { required: true, max: 30 }) as ContainmentType,
      { sessionId: p.sessionId, adminId: p.adminId, subjectType: p.subjectType, subjectRef: p.subjectRef, ipHash: p.ipHash, minutes: p.minutes, switch: p.switch } as ContainmentParams,
      str(b, "reason", { required: true, max: 400 }),
    );
    return NextResponse.json({ id: row.id, status: row.status, impact: row.impact, result: row.result }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
