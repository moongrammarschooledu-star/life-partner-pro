import { NextResponse } from "next/server";
import { runScheduledNotifications } from "@/lib/notifications/scheduled";
import { runDueScheduledReports } from "@/lib/reports/scheduler";

// Vercel Cron target (see vercel.json). This account is on the Hobby plan,
// which rejects any cron expression running more than once per day — the
// schedule here is a once-daily baseline safety net, not a substitute for
// real-time reminders. CRON_SECRET is unset in this environment (no real
// deployment secret was provisioned) — the route still enforces the
// standard Bearer-token check Vercel documents, so wiring a real secret
// later requires no code change. The manual "Run Now" admin route
// (/api/admin/cron/notifications/run) calls the same underlying function
// and is the actually-reliable, tested path for live verification.
//
// STEP 10's Scheduled Reports (spec §25) also piggyback on this same
// once-daily tick rather than a second cron entry — this Hobby-plan account
// cannot have more than one cron job at all, let alone a more-frequent one.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const [notifications, reports] = await Promise.all([runScheduledNotifications(), runDueScheduledReports()]);
  return NextResponse.json({ notifications, reports });
}
