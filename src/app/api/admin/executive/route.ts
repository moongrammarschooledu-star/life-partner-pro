import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getSectionDashboard } from "@/lib/analytics/dashboard-service";
import { evaluateKpis } from "@/lib/analytics/kpi-service";
import { assertEnabled, periodParams } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Executive dashboard: headline KPI cards (each with definition, period, source, freshness), the canonical funnel and the active KPIs.
// Everything is filtered to what the signed-in admin may see; hidden metrics are named, never shown.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("analytics:dashboard:view");
    await assertEnabled();
    const p = periodParams(req.url);
    const [dashboard, kpis] = await Promise.all([
      getSectionDashboard(admin, "executive", { period: p.period, compare: p.compare, from: p.from, to: p.to, withSeries: true }),
      evaluateKpis(admin, { period: p.period, compare: "NONE", onlyActive: true }).catch(() => []),
    ]);
    return NextResponse.json({ dashboard, kpis }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
