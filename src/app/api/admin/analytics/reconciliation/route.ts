import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { latestReconciliation, runReconciliation } from "@/lib/analytics/reconciliation";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("analytics:reconciliation:view");
    await assertEnabled();
    return NextResponse.json({ latest: await latestReconciliation() }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST() {
  try {
    const admin = await requireAdmin("analytics:reconciliation:manage");
    await assertEnabled("analytics.pipeline.enabled");
    return NextResponse.json(await runReconciliation(admin.id));
  } catch (error) {
    return marketingError(error);
  }
}
