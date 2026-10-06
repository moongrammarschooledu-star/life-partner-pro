import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { COHORT_KINDS, getCohorts, getRetention, type CohortKind } from "@/lib/analytics/cohorts";
import { logAnalyticsAccess } from "@/lib/analytics/audit";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Retention (Day 1/7/30/60/90) and cohorts by registration month, campaign, referral source, membership start month or lifecycle stage.
// Never cohorts by religion, caste, income or any other sensitive attribute. Needs cross-domain or sensitive analytics access.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("analytics:view");
    await assertEnabled();
    if (!admin.permissions.includes("analytics:cross_domain:view") && !admin.permissions.includes("analytics:sensitive:view")) {
      await logAnalyticsAccess({ adminId: admin.id, action: "DENIED", resource: "cohorts", outcome: "DENIED" });
      throw new HttpError(403, "You do not have access to cohort analytics.");
    }
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind") ?? "registration_month";
    if (kind === "retention") return NextResponse.json(await getRetention({ months: Number(q.get("months") ?? 6) || 6 }), { headers: noStore });
    if (!(COHORT_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, "Unknown cohort kind.");
    await logAnalyticsAccess({ adminId: admin.id, action: "VIEW", resource: "cohorts" });
    return NextResponse.json(await getCohorts(kind as CohortKind, { months: Number(q.get("months") ?? 12) || 12 }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
