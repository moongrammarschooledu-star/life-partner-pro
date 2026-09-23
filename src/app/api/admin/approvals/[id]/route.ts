import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { recordApprovalEvent } from "@/lib/approvals/events";
import { getCatalogEntry } from "@/lib/approvals/catalog";

// STEP 19 §20 — Approval Detail. IDOR-hardened: the record is loaded by its
// own id and every downstream field (sourceType/sourceId/makerId/status) is
// read from the trusted row, never from client input. Viewing beyond one's
// own request/decisions requires a broad role or an explicit governance
// permission — mirrors src/lib/workflow/access.ts's own visibility gating.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:view");
    const { id } = await params;

    const request = await prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        maker: { select: { id: true, name: true, role: true } },
        assignedChecker: { select: { id: true, name: true } },
        assignedDepartment: { select: { id: true, name: true } },
        createdTask: { select: { id: true, taskCode: true, status: true } },
        steps: { orderBy: { sequence: "asc" }, include: { reviewers: { include: { reviewer: { select: { id: true, name: true, role: true } } } } } },
      },
    });
    if (!request) throw new ApiError(404, "Approval request not found.");

    const isMaker = request.makerId === admin.id;
    const isDecisionMaker = request.steps.some((s) => s.reviewers.some((r) => r.reviewerId === admin.id));
    if (!isMaker && !isDecisionMaker && !hasBroadRecordAccess(admin.role) && !admin.permissions.includes("approvals:audit:view")) {
      throw new ApiError(403, "You do not have permission to view this approval request.");
    }

    await recordApprovalEvent({ approvalRequestId: id, actorId: admin.id, eventType: "APPROVAL_VIEWED" }).catch(() => {});

    return NextResponse.json({ ...request, catalogEntry: getCatalogEntry(request.actionType) });
  } catch (error) {
    return handleApiError(error);
  }
}
