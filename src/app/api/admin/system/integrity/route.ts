import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { runIntegrityChecks, INTEGRITY_CHECK_COUNT } from "@/lib/ops/integrity";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Data-integrity monitor (spec §42) — read-only findings, never auto-fixed.
export async function GET() {
  try {
    await requireAdmin("system:view");
    const runs = await prisma.integrityCheckRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
    return NextResponse.json({ runs, checkCount: INTEGRITY_CHECK_COUNT });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("system:jobs:manage");
    const limited = await enforcePersistentLimit(req, "admin-integrity", 6, 600_000, admin.id);
    if (limited) return limited;
    return NextResponse.json(await runIntegrityChecks({ trigger: "MANUAL", actorId: admin.id }));
  } catch (error) {
    return handleApiError(error);
  }
}
