import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// STEP 19 §20/§32 — the Approval Chain / audit timeline. Reads the
// purpose-built ApprovalEvent table (written in lockstep with the central
// AuditLog by src/lib/approvals/events.ts's recordApprovalEvent() — see the
// STEP 19 plan's architecture decision 5), plus the conflict and execution
// logs. Never exposes a reviewer's private decisionReason to anyone other
// than a broad/governance role — see the field filter below.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:audit:view");
    const { id } = await params;

    const [events, conflicts, executionLogs] = await Promise.all([
      prisma.approvalEvent.findMany({ where: { approvalRequestId: id }, orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, name: true } } } }),
      prisma.approvalConflict.findMany({ where: { approvalRequestId: id }, orderBy: { detectedAt: "asc" } }),
      prisma.approvalExecutionLog.findMany({ where: { approvalRequestId: id }, orderBy: { startedAt: "asc" } }),
    ]);

    return NextResponse.json({ events, conflicts, executionLogs });
  } catch (error) {
    return handleApiError(error);
  }
}
