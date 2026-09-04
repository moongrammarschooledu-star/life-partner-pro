import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { ensureProposalCode } from "@/lib/proposal-code";
import { assertProposalAccess } from "@/lib/proposal-access";
import { SELECTABLE_STATUSES, isLegacyStatus } from "@/lib/proposal-status-labels";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import type { AuditAction, ProfileStatus, ProposalStatus } from "@prisma/client";

const proposalDetailInclude = {
  profileA: { include: profileDetailInclude },
  profileB: { include: profileDetailInclude },
  match: true,
  createdBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  events: {
    orderBy: { createdAt: "asc" as const },
    include: { performedByAdmin: { select: { name: true } }, performedByProfile: { select: { fullName: true } } },
  },
  responses: { include: { profile: { select: { id: true, fullName: true } } } },
  contactPermissions: { include: { profile: { select: { id: true, fullName: true } }, approvedBy: { select: { name: true } } } },
  meetings: { orderBy: { scheduledAt: "desc" as const } },
  familyCommunications: { orderBy: { communicationDate: "desc" as const } },
  notes: { include: { admin: { select: { name: true } } }, orderBy: { createdAt: "desc" as const } },
};

// Profile-level status a proposal reaching a terminal state should cascade
// to. This app models "one active matchmaking conversation at a time" per
// profile (the existing POST already sets both profiles to MATCHING on
// creation) — REJECTED/ARCHIVED release the profile back to ACTIVE (a
// declined proposal shouldn't itself disqualify the profile from future
// matching) while FINALIZED/MARRIED are genuine terminal profile states.
const PROFILE_STATUS_ON_PROPOSAL_STATUS: Partial<Record<ProposalStatus, ProfileStatus>> = {
  FINALIZED: "FINALIZED",
  MARRIED: "MARRIED",
  REJECTED: "ACTIVE",
  ARCHIVED: "ACTIVE",
};

const AUDIT_ACTION_FOR_STATUS: Partial<Record<ProposalStatus, AuditAction>> = {
  FINALIZED: "PROPOSAL_FINALIZED",
  MARRIED: "PROPOSAL_MARRIED",
  ARCHIVED: "PROPOSAL_ARCHIVED",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("proposal:create");
    const { id } = await params;

    const proposal = await prisma.proposal.findUnique({ where: { id }, include: proposalDetailInclude });
    if (!proposal) throw new ApiError(404, "Proposal not found");

    const proposalCode = await ensureProposalCode(proposal);

    return NextResponse.json({
      ...proposal,
      proposalCode,
      profileA: toDetailDto(proposal.profileA),
      profileB: toDetailDto(proposal.profileB),
      breakdown: proposal.match ? JSON.parse(proposal.match.breakdown) : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id } = await params;
    const body = await req.json();
    const status: ProposalStatus | undefined = body.status;
    const { note, priority, rejectionReason, internalRejectionNote, finalNotes, marriageNotes } = body;

    const existing = await prisma.proposal.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, existing);

    if (status) {
      // A status may only be *kept* if it's the proposal's current (possibly
      // legacy) value — every new target must come from the current lifecycle.
      const keepingCurrent = status === existing.status;
      if (!keepingCurrent && (!SELECTABLE_STATUSES.includes(status) || isLegacyStatus(status))) {
        throw new ApiError(400, "Invalid status");
      }
      if (status === "REJECTED" && !rejectionReason) {
        throw new ApiError(400, "A rejection reason is required to reject a proposal.");
      }
    }

    const now = new Date();
    const statusFields =
      status === "FINALIZED"
        ? { finalizedAt: now, finalizedById: admin.id, finalNotes: finalNotes || null }
        : status === "MARRIED"
          ? { marriedAt: now, marriedById: admin.id, marriageNotes: marriageNotes || null }
          : status === "REJECTED"
            ? { rejectedAt: now, rejectedById: admin.id, rejectionReason, internalRejectionNote: internalRejectionNote || null }
            : status === "ARCHIVED"
              ? { archivedAt: now }
              : status === "CLOSED"
                ? { closedAt: now }
                : {};

    const proposal = await prisma.proposal.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...statusFields,
        ...(status ? { events: { create: { status, note: note || null, performedByAdminId: admin.id } } } : {}),
      },
    });

    if (status && PROFILE_STATUS_ON_PROPOSAL_STATUS[status]) {
      const profileStatus = PROFILE_STATUS_ON_PROPOSAL_STATUS[status]!;
      await Promise.all([
        prisma.profile.update({ where: { id: proposal.profileAId }, data: { status: profileStatus } }),
        prisma.profile.update({ where: { id: proposal.profileBId }, data: { status: profileStatus } }),
      ]);
    }

    await writeAudit({
      action: (status && AUDIT_ACTION_FOR_STATUS[status]) || "PROPOSAL_STATUS_CHANGED",
      adminId: admin.id,
      targetProfileId: proposal.profileAId,
      meta: { proposalId: id, status, priority },
    });

    return NextResponse.json({ status: proposal.status, priority: proposal.priority });
  } catch (error) {
    return handleApiError(error);
  }
}
