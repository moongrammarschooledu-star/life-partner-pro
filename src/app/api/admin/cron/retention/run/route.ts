import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { runDueRetentionActions } from "@/lib/privacy/retention-policy";

// Manual trigger for the same retention sweep the Vercel Cron job runs
// (spec §19), mirroring /api/admin/cron/notifications/run's precedent — the
// tested, reliable path for otherwise time-based logic in an environment
// where Vercel Cron reliability can't be verified end-to-end.
export async function POST() {
  try {
    await requireAdmin("privacy:retention:manage");
    const result = await runDueRetentionActions();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
