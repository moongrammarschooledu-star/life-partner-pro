import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { nextProposalCode, ensureProposalCode } from "@/lib/proposal-code";
import { STATUS_GROUPS } from "@/lib/proposal-status-labels";

const proposalListInclude = {
  profileA: { select: { id: true, profileCode: true, fullName: true, gender: true, city: true } },
  profileB: { select: { id: true, profileCode: true, fullName: true, gender: true, city: true } },
  createdBy: { select: { name: true } },
  assignedTo: { select: { id: true, name: true } },
  events: { orderBy: { createdAt: "asc" } as const },
  responses: true,
  meetings: { orderBy: { scheduledAt: "desc" } as const, take: 1 },
} satisfies Prisma.ProposalInclude;

export async function GET(req: Request) {
  try {
    await requireAdmin("proposal:create");
    const { searchParams } = new URL(req.url);
    const statusGroup = searchParams.get("statusGroup");
    const status = searchParams.get("status");
    const profileId = searchParams.get("profileId");
    const minScore = searchParams.get("minScore") ? Number(searchParams.get("minScore")) : null;
    const city = searchParams.get("city");
    const createdFrom = searchParams.get("createdFrom");
    const createdTo = searchParams.get("createdTo");
    const assignedToId = searchParams.get("assignedToId");
    const responseStatus = searchParams.get("responseStatus"); // PENDING | DECLINED
    const meetingStatus = searchParams.get("meetingStatus");

    const group = statusGroup ? STATUS_GROUPS.find((g) => g.key === statusGroup) : undefined;

    const proposals = await prisma.proposal.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(group ? { status: { in: group.statuses } } : {}),
        ...(profileId ? { OR: [{ profileAId: profileId }, { profileBId: profileId }] } : {}),
        ...(minScore != null ? { matchScore: { gte: minScore } } : {}),
        ...(city ? { OR: [{ profileA: { city: { equals: city, mode: "insensitive" } } }, { profileB: { city: { equals: city, mode: "insensitive" } } }] } : {}),
        ...(createdFrom || createdTo
          ? { createdAt: { ...(createdFrom ? { gte: new Date(createdFrom) } : {}), ...(createdTo ? { lte: new Date(createdTo) } : {}) } }
          : {}),
        ...(assignedToId ? { assignedToId } : {}),
        ...(responseStatus === "PENDING" ? { responses: { none: {} } } : {}),
        ...(responseStatus === "DECLINED" ? { responses: { some: { response: "NOT_INTERESTED" } } } : {}),
        ...(meetingStatus ? { meetings: { some: { status: meetingStatus as never } } } : {}),
      },
      include: proposalListInclude,
      orderBy: { createdAt: "desc" },
    });

    const items = await Promise.all(
      proposals.map(async (p) => ({ ...p, proposalCode: await ensureProposalCode(p) }))
    );

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("proposal:create");
    const { profileAId, profileBId, matchId, priority, note, verificationWarningAcknowledged } = await req.json();

    if (!profileAId || !profileBId || profileAId === profileBId) {
      throw new ApiError(400, "Two distinct profiles are required");
    }
    const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
    if (priority && !VALID_PRIORITIES.includes(priority)) throw new ApiError(400, "Invalid priority");

    // Match creation never implies contact sharing (spec §4) — this only
    // records the proposal + a snapshot of the match score it came from.
    let matchScore: number | undefined;
    if (matchId) {
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      matchScore = match?.score;
    }

    const proposalCode = await nextProposalCode();
    // A STAFF-created proposal is auto-assigned to its creator so the
    // row-level access gate (src/lib/proposal-access.ts) never locks them
    // out of the proposal they just made; ADMIN/SUPER_ADMIN-created
    // proposals stay unassigned until a Super Admin assigns one explicitly.
    const assignedToId = admin.role === "STAFF" ? admin.id : undefined;

    const proposal = await prisma.proposal.create({
      data: {
        proposalCode,
        profileAId,
        profileBId,
        matchId: matchId || undefined,
        matchScore,
        priority: priority || undefined,
        createdById: admin.id,
        assignedToId,
        events: { create: { status: "PROPOSAL_CREATED", performedByAdminId: admin.id } },
      },
      include: { events: true },
    });

    await Promise.all([
      prisma.profile.update({ where: { id: profileAId }, data: { status: "MATCHING" } }),
      prisma.profile.update({ where: { id: profileBId }, data: { status: "MATCHING" } }),
      matchId ? prisma.match.update({ where: { id: matchId }, data: { status: "PROPOSAL_CREATED" } }) : Promise.resolve(),
      note && note.trim()
        ? prisma.profileNote.create({ data: { profileId: profileAId, proposalId: proposal.id, adminId: admin.id, text: note.trim() } })
        : Promise.resolve(),
    ]);

    await writeAudit({ action: "PROPOSAL_CREATED", adminId: admin.id, targetProfileId: profileAId, meta: { profileBId, proposalId: proposal.id, matchId } });

    // Non-blocking trail (spec §29) — the UI only lets this flag be true
    // when the admin explicitly clicked "Proceed anyway" past a verification
    // warning; the gate itself is a warning, never a hard block.
    if (verificationWarningAcknowledged) {
      await writeAudit({
        action: "PROPOSAL_CREATED_WITH_VERIFICATION_WARNING",
        adminId: admin.id,
        targetProfileId: profileAId,
        meta: { profileBId, proposalId: proposal.id },
      });
    }

    return NextResponse.json(proposal);
  } catch (error) {
    return handleApiError(error);
  }
}
