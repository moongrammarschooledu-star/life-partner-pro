import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { assertStepUp } from "@/lib/soc/session-policy";
import { logSocAccess } from "@/lib/soc/audit";
import { reviewRuleChange } from "@/lib/soc/rule-service";
import { HttpError } from "@/lib/http-error";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// POST { decision: APPROVE | REJECT, note, stepUpToken } — never by the person who proposed the change (the service refuses it).
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("soc:rules:manage");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { key } = await params;
    const b = await readBody(req, 10_000);
    await assertStepUp(admin.id, str(b, "stepUpToken", { max: 600 }));
    const decision = str(b, "decision", { required: true, max: 10 });
    if (decision !== "APPROVE" && decision !== "REJECT") throw new HttpError(422, "decision must be APPROVE or REJECT.");
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "rule-review", resourceId: key });
    return NextResponse.json(await reviewRuleChange(await currentViewer(admin.id), key, decision, str(b, "note", { required: true, max: 300 })));
  } catch (error) {
    return marketingError(error);
  }
}
