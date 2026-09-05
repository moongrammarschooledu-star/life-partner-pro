import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { runScheduledNotifications } from "@/lib/notifications/scheduled";

// Manual trigger for the same scheduled-notification sweep the Vercel Cron
// job runs (spec §23) — since Vercel Cron reliability isn't something this
// environment can verify end-to-end, this is the tested path for meeting/
// follow-up/pending-proposal reminders, mirroring STEP 8's admin-triggered
// "Scan for Duplicates" precedent for otherwise time-based logic.
export async function POST() {
  try {
    await requireAdmin("communication:send");
    const result = await runScheduledNotifications();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
