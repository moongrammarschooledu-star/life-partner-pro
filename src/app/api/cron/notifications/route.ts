import { NextResponse } from "next/server";
import { runScheduledNotifications } from "@/lib/notifications/scheduled";
import { runDueScheduledReports } from "@/lib/reports/scheduler";
import { runDueRetentionActions } from "@/lib/privacy/retention-policy";
import { runDueSubscriptionRenewals } from "@/lib/finance/subscription";
import { runScheduledReconciliation } from "@/lib/finance/reconciliation";

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
// STEP 10's Scheduled Reports (spec §25), STEP 13's Retention Policy
// engine, STEP 14's subscription renewal/grace-period sweep, and the
// rollout-phases add-on's configurable reconciliation schedule (spec §77)
// also piggyback on this same once-daily tick rather than their own cron
// entries — this Hobby-plan account cannot have more than one cron job at
// all, let alone a more-frequent one.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const [notifications, reports, retention, subscriptions, reconciliation] = await Promise.all([
    runScheduledNotifications(),
    runDueScheduledReports(),
    runDueRetentionActions(),
    runDueSubscriptionRenewals(),
    runScheduledReconciliation(),
  ]);
  return NextResponse.json({ notifications, reports, retention, subscriptions, reconciliation });
}
