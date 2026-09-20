import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { enqueueJob, runDueJobs, retryJob, cancelJob, resolveJob, JOB_TYPES } from "@/lib/ops/jobs";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import type { JobStatus } from "@prisma/client";

const STATUSES: JobStatus[] = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "RETRYING", "DEAD_LETTER", "CANCELLED"];

export async function GET(req: Request) {
  try {
    await requireAdmin("system:jobs:view");
    const status = new URL(req.url).searchParams.get("status");
    const [counts, items] = await Promise.all([
      prisma.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.backgroundJob.findMany({
        where: status && (STATUSES as string[]).includes(status) ? { status: status as JobStatus } : {},
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, runAfter: true, createdAt: true, startedAt: true, completedAt: true, failureReason: true, resolved: true, correlationId: true, dedupKey: true },
      }),
    ]);
    return NextResponse.json({ counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), items, jobTypes: JOB_TYPES });
  } catch (error) {
    return handleApiError(error);
  }
}

// Retry / cancel / resolve / enqueue / run-now — every one audited (jobs.ts).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("system:jobs:manage");
    const limited = await enforcePersistentLimit(req, "admin-jobs", 30, 60_000, admin.id);
    if (limited) return limited;

    const body = await readJson<{ action?: string; jobId?: string; type?: string }>(req);
    try {
      if (body.action === "retry" && body.jobId) await retryJob(body.jobId, admin.id);
      else if (body.action === "cancel" && body.jobId) await cancelJob(body.jobId, admin.id);
      else if (body.action === "resolve" && body.jobId) await resolveJob(body.jobId, admin.id);
      else if (body.action === "enqueue" && body.type) {
        await enqueueJob({ type: body.type, dedupKey: `manual:${body.type}:${Date.now()}`, createdById: admin.id });
      } else if (body.action === "run") {
        return NextResponse.json(await runDueJobs({ limit: 5, budgetMs: 25_000 }));
      } else throw new ApiError(400, "Unknown action.");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, error instanceof Error ? error.message : "Action failed.");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
