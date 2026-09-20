import { NextResponse } from "next/server";
import { runDailyTick } from "@/lib/ops/scheduler";
import { getCorrelationId } from "@/lib/observability/correlation";

// Vercel cron can take longer than a normal request; Hobby allows up to 60 s.
export const maxDuration = 60;

// Vercel Cron target (see vercel.json). This account is on the Hobby plan,
// which rejects any cron expression running more than once per day — the
// schedule here is a once-daily baseline safety net, not a substitute for
// real-time reminders. CRON_SECRET, when set, is enforced with the standard
// Bearer-token check Vercel documents. When it is NOT set the route still
// runs (so an unconfigured environment does not silently stop its daily
// sweep) but Production Readiness reports it as a BLOCKER — see
// src/lib/config/validate.ts. The manual "Run Now" admin routes call the
// same underlying functions and remain the tested path for live verification.
//
// STEP 15: the tick is now `runDailyTick()` (src/lib/ops/scheduler.ts) —
// every sub-task is isolated, locked against duplicate execution and
// recorded (System Health → Jobs & Cron). STEP 10's Scheduled Reports,
// STEP 13's Retention engine, STEP 14's subscription renewals and the
// rollout-phases reconciliation schedule still ride this one tick because a
// Hobby-plan account cannot have more than one cron job.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const parent = await runDailyTick(await getCorrelationId());
  const legacy = (parent.result?.legacy ?? []) as Array<{ name: string; status: string; result?: unknown }>;
  const byName = (name: string) => legacy.find((r) => r.name === name)?.result;
  return NextResponse.json(
    {
      ok: parent.status === "SUCCESS",
      status: parent.status,
      error: parent.error,
      tasks: parent.result?.tasks,
      notifications: byName("notifications"),
      reports: byName("scheduled-reports"),
      retention: byName("retention"),
      subscriptions: byName("subscription-renewals"),
      reconciliation: byName("payment-reconciliation"),
    },
    { status: parent.status === "FAILED" ? 500 : 200 }
  );
}
