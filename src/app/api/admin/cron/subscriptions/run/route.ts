import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { runDueSubscriptionRenewals } from "@/lib/finance/subscription";

// Manual trigger for the same renewal/grace-period sweep the Vercel Cron
// job runs (spec §25), mirroring /api/admin/cron/notifications/run and
// /api/admin/cron/retention/run's precedent.
export async function POST() {
  try {
    await requireAdmin("finance:subscriptions:manage");
    const result = await runDueSubscriptionRenewals();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
