import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertProposalAccess } from "@/lib/proposal-access";
import { notifyContactPermissionAction, notifyAdminContactPermissionRequest, notifyContactApproved } from "@/lib/notifications/events";

// Per-profile consent state for a proposal (spec §8) — distinct from
// ContactShareLog, which records the actual reveal once both sides here are
// approved. This intentionally does NOT block the existing reveal endpoint
// server-side (see /api/admin/profiles/[id]/contact) so Step 1-6 behavior
// stays unchanged; the Proposal Detail UI shows a warning banner instead
// when reveal is attempted before both permissions are approved.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id } = await params;
    const { profileId, action } = await req.json(); // action: "request" | "approve" | "revoke"

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, proposal);
    if (profileId !== proposal.profileAId && profileId !== proposal.profileBId) {
      throw new ApiError(400, "Profile is not part of this proposal");
    }

    if (action === "request") {
      await prisma.contactPermission.upsert({
        where: { proposalId_profileId: { proposalId: id, profileId } },
        update: { requestedAt: new Date(), revokedAt: null },
        create: { proposalId: id, profileId },
      });
      await writeAudit({ action: "CONTACT_PERMISSION_REQUESTED", adminId: admin.id, targetProfileId: profileId, meta: { proposalId: id } });
      await notifyContactPermissionAction(profileId, id, "request");
      await notifyAdminContactPermissionRequest(id, proposal.assignedToId);
    } else if (action === "approve") {
      await prisma.contactPermission.upsert({
        where: { proposalId_profileId: { proposalId: id, profileId } },
        update: { approvedAt: new Date(), approvedById: admin.id, revokedAt: null },
        create: { proposalId: id, profileId, approvedAt: new Date(), approvedById: admin.id },
      });
      await writeAudit({ action: "CONTACT_PERMISSION_APPROVED", adminId: admin.id, targetProfileId: profileId, meta: { proposalId: id } });
      await notifyContactPermissionAction(profileId, id, "approve");
    } else if (action === "revoke") {
      await prisma.contactPermission.updateMany({ where: { proposalId: id, profileId }, data: { revokedAt: new Date() } });
      await notifyContactPermissionAction(profileId, id, "revoke");
    } else {
      throw new ApiError(400, "Invalid action");
    }

    const permissions = await prisma.contactPermission.findMany({ where: { proposalId: id } });
    const isApproved = (pid: string) => permissions.some((p) => p.profileId === pid && p.approvedAt && !p.revokedAt);
    const bothApproved = isApproved(proposal.profileAId) && isApproved(proposal.profileBId);

    if (bothApproved && proposal.status !== "CONTACT_APPROVED") {
      await prisma.proposal.update({
        where: { id },
        data: { status: "CONTACT_APPROVED", events: { create: { status: "CONTACT_APPROVED", performedByAdminId: admin.id } } },
      });
      await notifyContactApproved(proposal.profileAId, proposal.profileBId, id);
    }

    return NextResponse.json({ permissions, bothApproved });
  } catch (error) {
    return handleApiError(error);
  }
}
