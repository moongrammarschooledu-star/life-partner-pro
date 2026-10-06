import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createDashboard, listDashboards } from "@/lib/analytics/dashboard-service";
import { assertEnabled, dbViewerFor } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    const admin = await requireAdmin("analytics:dashboard:view");
    await assertEnabled();
    return NextResponse.json({ items: await listDashboards(await dbViewerFor(admin.id)) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:dashboard:create");
    await assertEnabled();
    const b = await readBody(req, 60_000);
    const row = await createDashboard(admin, { name: str(b, "name", { required: true, max: 120 }), description: str(b, "description", { max: 300 }) || null, widgets: b.widgets });
    return NextResponse.json({ id: row.id, code: row.code }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
