import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { installMetricCatalog, listCatalog } from "@/lib/analytics/catalog-service";
import { metricAccessible } from "@/lib/analytics/access";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody } from "@/lib/marketing/route-utils";

// The metric catalog: every metric's definition, formula, source, filters, exclusions, owner, version and review status.
// Definitions are visible to anyone with analytics:metrics:view; a metric the viewer cannot read is marked restricted (no data).
export async function GET() {
  try {
    const admin = await requireAdmin("analytics:metrics:view");
    await assertEnabled();
    const all = await listCatalog(() => true);
    return NextResponse.json({ items: all.map((m) => ({ ...m, restricted: !metricAccessible(admin, getMetric(m.key)!) })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// POST { action: "INSTALL" } creates the governance record for every code metric (as DRAFT; existing rows are never changed).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:metrics:create");
    await assertEnabled();
    const b = await readBody(req);
    if (b.action !== "INSTALL") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json(await installMetricCatalog(admin.id), { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
