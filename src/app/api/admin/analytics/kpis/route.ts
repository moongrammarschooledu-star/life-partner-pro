import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createKpi, evaluateKpis, installDefaultKpis } from "@/lib/analytics/kpi-service";
import { assertEnabled, periodParams } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("analytics:kpi:view");
    await assertEnabled();
    const q = new URL(req.url).searchParams;
    const p = periodParams(req.url);
    const hasPeriod = q.has("period");
    return NextResponse.json({ items: await evaluateKpis(admin, { period: hasPeriod ? p.period : undefined, compare: "NONE", onlyActive: q.get("active") === "1" }) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// POST { action: "INSTALL_DEFAULTS" } installs the standard KPI set as drafts; otherwise creates one KPI (a draft that must be reviewed).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:kpi:create");
    await assertEnabled();
    const b = await readBody(req);
    if (b.action === "INSTALL_DEFAULTS") return NextResponse.json(await installDefaultKpis(admin), { status: 201 });
    const row = await createKpi(admin, { key: str(b, "key", { required: true, max: 60 }), name: str(b, "name", { required: true, max: 120 }), description: str(b, "description", { required: true, max: 600 }), category: str(b, "category", { required: true, max: 40 }), unit: str(b, "unit", { required: true, max: 20 }), direction: str(b, "direction", { max: 16 }) || undefined, frequency: str(b, "frequency", { max: 12 }) || undefined, formula: b.formula, visibility: str(b, "visibility", { max: 60 }) || null });
    return NextResponse.json({ id: row.id, code: row.code }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
