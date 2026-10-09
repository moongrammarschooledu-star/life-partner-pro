import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { assertStepUp } from "@/lib/soc/session-policy";
import { logSocAccess } from "@/lib/soc/audit";
import { approvePlan, createPlanDraft, drOverview, listPlans, recordTest, type DrTestType } from "@/lib/soc/disaster-recovery";
import { HttpError } from "@/lib/http-error";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

// The recovery plan, the CONFIGURED objectives and the MEASURED results — kept apart, with "not measured yet" where there is no evidence.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:dr:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "disaster-recovery" });
    return NextResponse.json({ overview: await drOverview(), plans: await listPlans() }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// POST { action: DRAFT | APPROVE | TEST, ... }
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("soc:dr:manage");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const b = await readBody(req, 60_000);
    const action = str(b, "action", { required: true, max: 10 });
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "disaster-recovery" });
    if (action === "DRAFT") {
      const days = b.testEveryDays === null || b.testEveryDays === undefined ? null : Number(b.testEveryDays);
      return NextResponse.json(await createPlanDraft(admin.id, { sections: b.sections, testEveryDays: days, reason: str(b, "reason", { required: true, max: 300 }) }), { status: 201 });
    }
    if (action === "APPROVE") {
      await assertStepUp(admin.id, str(b, "stepUpToken", { max: 600 }));
      return NextResponse.json(await approvePlan(admin.id, Number(b.version)));
    }
    if (action === "TEST") {
      return NextResponse.json(
        await recordTest(admin.id, { testType: str(b, "testType", { required: true, max: 10 }) as DrTestType, status: str(b, "status", { required: true, max: 10 }) as "COMPLETED" | "FAILED", performedAt: new Date(str(b, "performedAt", { required: true, max: 40 })), durationMinutes: b.durationMinutes == null ? null : Number(b.durationMinutes), findings: str(b, "findings", { required: true, max: 1500 }), drillId: str(b, "drillId", { max: 40 }) || null }),
        { status: 201 },
      );
    }
    throw new HttpError(422, "Unknown action.");
  } catch (error) {
    return marketingError(error);
  }
}
