import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { assertStepUp } from "@/lib/soc/session-policy";
import { logSocAccess } from "@/lib/soc/audit";
import { reviewDrill } from "@/lib/soc/restore-drills";
import { HttpError } from "@/lib/http-error";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// POST { decision: APPROVE | REJECT, note, stepUpToken } — never by the person who performed the drill (the service refuses it).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:restore:review");
    await assertSocEnabled("soc.restore_drills.enabled");
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    const b = await readBody(req, 5_000);
    await assertStepUp(admin.id, str(b, "stepUpToken", { max: 600 }));
    const decision = str(b, "decision", { required: true, max: 10 });
    if (decision !== "APPROVE" && decision !== "REJECT") throw new HttpError(422, "decision must be APPROVE or REJECT.");
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "restore-drill-review", resourceId: id });
    return NextResponse.json(await reviewDrill(admin.id, id, decision, str(b, "note", { required: true, max: 400 })));
  } catch (error) {
    return marketingError(error);
  }
}
