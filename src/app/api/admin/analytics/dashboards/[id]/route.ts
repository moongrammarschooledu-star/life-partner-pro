import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { renderDashboard, updateDashboard } from "@/lib/analytics/dashboard-service";
import { assertEnabled, dbViewerFor, periodParams } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

// A saved dashboard opens AS THE VIEWER: widgets they may not see come back as "not available to you".
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:dashboard:view");
    await assertEnabled();
    const { id } = await params;
    const p = periodParams(req.url);
    return NextResponse.json(await renderDashboard(await dbViewerFor(admin.id), id, { period: p.period, compare: p.compare }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:dashboard:edit");
    await assertEnabled();
    const { id } = await params;
    const b = await readBody(req, 60_000);
    const row = await updateDashboard(admin, id, { name: b.name === undefined ? undefined : str(b, "name", { max: 120 }), description: b.description === undefined ? undefined : str(b, "description", { max: 300 }) || null, widgets: b.widgets, status: b.status === "ARCHIVED" ? "ARCHIVED" : b.status === "ACTIVE" ? "ACTIVE" : undefined });
    return NextResponse.json({ id: row.id, version: row.currentVersion, status: row.status });
  } catch (error) {
    return marketingError(error);
  }
}
