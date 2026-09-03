import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    await requireAdmin("proposal:create");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const profileId = searchParams.get("profileId");

    const proposals = await prisma.proposal.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(profileId ? { OR: [{ profileAId: profileId }, { profileBId: profileId }] } : {}),
      },
      include: {
        profileA: { select: { id: true, profileCode: true, fullName: true, gender: true } },
        profileB: { select: { id: true, profileCode: true, fullName: true, gender: true } },
        events: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: proposals });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("proposal:create");
    const { profileAId, profileBId } = await req.json();

    if (!profileAId || !profileBId || profileAId === profileBId) {
      throw new ApiError(400, "Two distinct profiles are required");
    }

    const proposal = await prisma.proposal.create({
      data: {
        profileAId,
        profileBId,
        createdById: admin.id,
        events: { create: { status: "DRAFT" } },
      },
      include: { events: true },
    });

    await Promise.all([
      prisma.profile.update({ where: { id: profileAId }, data: { status: "MATCHING" } }),
      prisma.profile.update({ where: { id: profileBId }, data: { status: "MATCHING" } }),
    ]);

    await writeAudit({ action: "PROPOSAL_CREATED", adminId: admin.id, targetProfileId: profileAId, meta: { profileBId, proposalId: proposal.id } });

    return NextResponse.json(proposal);
  } catch (error) {
    return handleApiError(error);
  }
}
