import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { readJson, requireReauth, requireReason } from "@/lib/ops/admin-route";
import { assessRollback } from "@/lib/ops/rollback";
import { verifyRelease } from "@/lib/ops/releases";

// Release records (spec §26/§60/§61). Approval and rollback bookkeeping need
// the releases:manage permission AND a fresh password re-confirmation. The
// actual rollback is Vercel's "promote previous deployment"; this records the
// decision, checks database compatibility and freezes nothing on its own.
export async function GET() {
  try {
    await requireAdmin("readiness:view");
    const releases = await prisma.release.findMany({ orderBy: { deployedAt: "desc" }, take: 20 });
    const byId = new Map(releases.map((r) => [r.id, r]));
    const items = releases.map((r) => {
      const target = r.rollbackTargetId ? byId.get(r.rollbackTargetId) ?? null : null;
      return {
        ...r,
        rollbackTarget: target ? { id: target.id, releaseCode: target.releaseCode, version: target.version } : null,
        rollbackAssessment: target ? assessRollback({ currentMigrations: (r.migrations as string[] | null) ?? null, targetMigrations: (target.migrations as string[] | null) ?? null }) : null,
      };
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("releases:manage");
    const body = await readJson<{ releaseId?: string; action?: string; reason?: string; notes?: string; stepUpToken?: string }>(req);
    if (!body.releaseId) throw new ApiError(400, "A release is required.");
    requireReauth(admin, body.stepUpToken, "change a release record");
    const release = await prisma.release.findUniqueOrThrow({ where: { id: body.releaseId } });

    if (body.action === "approve") {
      if (release.status !== "HEALTHY") throw new ApiError(400, "Only a release that passed post-deploy verification can be approved.");
      const updated = await prisma.release.update({ where: { id: release.id }, data: { approvedById: admin.id, approvedAt: new Date(), notes: body.notes?.slice(0, 300) ?? release.notes } });
      await writeAudit({ action: "DEPLOYMENT_COMPLETED", adminId: admin.id, meta: { releaseCode: release.releaseCode, event: "APPROVED" } });
      return NextResponse.json(updated);
    }
    if (body.action === "record_rollback") {
      const reason = requireReason(body.reason);
      await writeAudit({ action: "ROLLBACK_STARTED", adminId: admin.id, meta: { releaseCode: release.releaseCode, reason } });
      const updated = await prisma.release.update({ where: { id: release.id }, data: { status: "ROLLED_BACK", notes: reason } });
      await writeAudit({ action: "ROLLBACK_COMPLETED", adminId: admin.id, meta: { releaseCode: release.releaseCode, note: "Recorded — the deployment itself is reverted in Vercel" } });
      return NextResponse.json(updated);
    }
    if (body.action === "reverify") return NextResponse.json(await verifyRelease(release.id));
    throw new ApiError(400, "Unknown action.");
  } catch (error) {
    return handleApiError(error);
  }
}
