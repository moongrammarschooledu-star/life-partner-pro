import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { parseReportFilters } from "@/lib/reports/where-builders";
import { computeStaffPerformance } from "@/lib/reports/aggregate/staff-performance";
import { computeTeamWorkload } from "@/lib/reports/aggregate/team-workload";
import { logAnalyticsAccess } from "@/lib/analytics/audit";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Staff and team performance: management roles only. Reuses the existing reports aggregators (no second implementation). The figures
// describe workload and handled items; they are not a ranking and say nothing about anyone's capability or character.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("analytics:staff:view");
    await assertEnabled();
    if (!admin.permissions.includes("reports:staff-performance:view")) {
      await logAnalyticsAccess({ adminId: admin.id, action: "DENIED", resource: "staff", outcome: "DENIED", sensitive: true });
      throw new HttpError(403, "Staff performance needs the staff-performance reports permission as well.");
    }
    const filters = parseReportFilters(new URL(req.url).searchParams);
    const [performance, workload] = await Promise.all([computeStaffPerformance(filters), computeTeamWorkload()]);
    await logAnalyticsAccess({ adminId: admin.id, action: "VIEW", resource: "staff", sensitive: true });
    return NextResponse.json({ performance, workload, note: "Counts of handled work and open assignments. Not a ranking and not an assessment of any person." }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
