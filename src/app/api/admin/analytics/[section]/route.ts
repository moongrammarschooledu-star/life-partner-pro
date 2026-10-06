import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getSectionDashboard } from "@/lib/analytics/dashboard-service";
import { SECTIONS, type SectionKey } from "@/lib/analytics/types";
import { HttpError } from "@/lib/http-error";
import { assertEnabled, periodParams } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// One dashboard per section (operations, crm, marketing, matching, proposals, meetings, verification, support, finance, membership,
// engagement, risk, communications, tasks, family, identity). Access is decided per metric inside getSectionDashboard.
export async function GET(req: Request, { params }: { params: Promise<{ section: string }> }) {
  try {
    const admin = await requireAdmin("analytics:view");
    await assertEnabled();
    const { section } = await params;
    if (!(SECTIONS as readonly string[]).includes(section) || section === "executive") throw new HttpError(404, "Unknown analytics section.");
    const p = periodParams(req.url);
    return NextResponse.json(await getSectionDashboard(admin, section as SectionKey, { period: p.period, compare: p.compare, from: p.from, to: p.to, withSeries: true }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
