import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { runDueScheduledReports } from "@/lib/reports/scheduler";

// Manual trigger mirroring STEP 9's "Run Now" precedent — the tested path
// for scheduled-report delivery, since Vercel Cron reliability isn't
// something this environment can verify end-to-end (see
// src/app/api/cron/notifications/route.ts for the Hobby-plan cron limits).
export async function POST() {
  try {
    await requireAdmin("reports:schedule:manage");
    const result = await runDueScheduledReports();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
