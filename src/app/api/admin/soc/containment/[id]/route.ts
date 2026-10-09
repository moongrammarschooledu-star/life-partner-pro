import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { assertStepUp } from "@/lib/soc/session-policy";
import { logSocAccess } from "@/lib/soc/audit";
import { decideContainment } from "@/lib/soc/containment";
import { HttpError } from "@/lib/http-error";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// POST { decision: APPROVE | REJECT, note, stepUpToken } — approving runs the action. The service refuses the requester, the target of the
// action and anyone without the permission, whatever this route receives.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:containment:approve");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    const b = await readBody(req, 5_000);
    await assertStepUp(admin.id, str(b, "stepUpToken", { max: 600 }));
    const decision = str(b, "decision", { required: true, max: 10 });
    if (decision !== "APPROVE" && decision !== "REJECT") throw new HttpError(422, "decision must be APPROVE or REJECT.");
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "containment-decision", resourceId: id });
    const row = await decideContainment(await currentViewer(admin.id), id, decision, str(b, "note", { required: true, max: 300 }));
    return NextResponse.json({ id: row.id, status: row.status, result: row.result });
  } catch (error) {
    return marketingError(error);
  }
}
