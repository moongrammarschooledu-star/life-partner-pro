import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { notifyProposalAssigned } from "@/lib/notifications/events";
import { createAssignment } from "@/lib/admin-assignment";

// Super Admin only (spec §24) — no row-level gate needed here since
// assigning is itself the mechanism that grants row-level access.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:assign");
    const { id } = await params;
    const { assignedToId } = await req.json();

    if (assignedToId) {
      const staff = await prisma.adminUser.findUnique({ where: { id: assignedToId } });
      if (!staff || !staff.active) throw new ApiError(400, "Invalid staff member");
    }

    const proposal = await prisma.proposal.update({ where: { id }, data: { assignedToId: assignedToId || null } });

    await writeAudit({ action: "PROPOSAL_ASSIGNED", adminId: admin.id, targetProfileId: proposal.profileAId, meta: { proposalId: id, assignedToId } });

    await notifyProposalAssigned(id, proposal.assignedToId);

    if (proposal.assignedToId) {
      await createAssignment({ adminId: proposal.assignedToId, resourceType: "PROPOSAL", resourceId: id, createdById: admin.id });
    }

    return NextResponse.json({ assignedToId: proposal.assignedToId });
  } catch (error) {
    return handleApiError(error);
  }
}
