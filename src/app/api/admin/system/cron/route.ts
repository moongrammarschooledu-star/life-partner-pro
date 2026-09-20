import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { CRON_TASKS, runDailyTick } from "@/lib/ops/scheduler";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { getCorrelationId } from "@/lib/observability/correlation";

export const maxDuration = 60;

// Cron / scheduled-task management (spec §31): last run, status, duration,
// failure counts. "next run" is the once-daily Vercel cron (08:00 UTC).
export async function GET() {
  try {
    await requireAdmin("system:jobs:view");
    const [tasks, runs] = await Promise.all([
      prisma.cronTask.findMany(),
      prisma.cronTaskRun.findMany({ orderBy: { startedAt: "desc" }, take: 40 }),
    ]);
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return NextResponse.json({
      nextScheduledRun: next.toISOString(),
      note: "Vercel Hobby allows one cron job per account, running once daily; every task below runs inside that single tick.",
      tasks: CRON_TASKS.map((t) => {
        const row = tasks.find((r) => r.name === t.name);
        return { ...t, lastStartedAt: row?.lastStartedAt ?? null, lastCompletedAt: row?.lastCompletedAt ?? null, lastStatus: row?.lastStatus ?? null, lastDurationMs: row?.lastDurationMs ?? null, consecutiveFailures: row?.consecutiveFailures ?? 0, totalFailures: row?.totalFailures ?? 0, locked: Boolean(row?.lockedUntil && row.lockedUntil > now) };
      }),
      recentRuns: runs,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Manual "run the daily tick now" — the same locked, recorded path as cron, so
// it can never overlap a scheduled run.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("system:jobs:manage");
    const limited = await enforcePersistentLimit(req, "admin-cron-run", 5, 300_000, admin.id);
    if (limited) return limited;
    await writeAudit({ action: "JOB_INTERVENTION", adminId: admin.id, meta: { action: "RUN_DAILY_TICK" } });
    const result = await runDailyTick(await getCorrelationId());
    return NextResponse.json({ status: result.status, error: result.error, tasks: result.result?.tasks });
  } catch (error) {
    return handleApiError(error);
  }
}
