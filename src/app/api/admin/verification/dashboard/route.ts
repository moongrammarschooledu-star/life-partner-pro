import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { ensureAllProfileVerifications } from "@/lib/verification/status";
import type { Prisma, VerificationStatus } from "@prisma/client";

// Verification Center dashboard (spec §1): KPI counts + a filterable queue.
export async function GET(req: Request) {
  try {
    await requireAdmin("verification:view");
    await ensureAllProfileVerifications();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const profileCode = searchParams.get("profileId");
    const name = searchParams.get("name");
    const city = searchParams.get("city");
    const registeredFrom = searchParams.get("registeredFrom");
    const registeredTo = searchParams.get("registeredTo");
    const reviewedFrom = searchParams.get("reviewedFrom");
    const reviewedTo = searchParams.get("reviewedTo");
    const assignedToId = searchParams.get("assignedToId");
    const minCompleteness = searchParams.get("minCompleteness");

    const totalProfiles = await prisma.profile.count({ where: { softDeleted: false } });

    const statusCounts = await prisma.profileVerification.groupBy({ by: ["status"], _count: { status: true } });
    const countByStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])) as Record<VerificationStatus, number>;

    const kpis = {
      totalProfiles,
      pendingVerification: countByStatus.VERIFICATION_PENDING ?? 0,
      verified: countByStatus.VERIFIED ?? 0,
      inProgress: (countByStatus.UNDER_REVIEW ?? 0) + (countByStatus.VERIFICATION_REQUIRED ?? 0),
      rejected: countByStatus.VERIFICATION_REJECTED ?? 0,
      expired: countByStatus.VERIFICATION_EXPIRED ?? 0,
      reVerificationRequired: countByStatus.RE_VERIFICATION_REQUIRED ?? 0,
    };

    const where: Prisma.ProfileVerificationWhereInput = {
      ...(status ? { status: status as VerificationStatus } : {}),
      ...(assignedToId ? { assignedToId } : {}),
      ...(reviewedFrom || reviewedTo
        ? { lastReviewedAt: { ...(reviewedFrom ? { gte: new Date(reviewedFrom) } : {}), ...(reviewedTo ? { lte: new Date(reviewedTo) } : {}) } }
        : {}),
      profile: {
        softDeleted: false,
        ...(profileCode ? { profileCode: { contains: profileCode, mode: "insensitive" } } : {}),
        ...(name ? { fullName: { contains: name, mode: "insensitive" } } : {}),
        ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
        ...(registeredFrom || registeredTo
          ? { createdAt: { ...(registeredFrom ? { gte: new Date(registeredFrom) } : {}), ...(registeredTo ? { lte: new Date(registeredTo) } : {}) } }
          : {}),
        ...(minCompleteness ? { profileCompletion: { gte: Number(minCompleteness) } } : {}),
      },
    };

    const queue = await prisma.profileVerification.findMany({
      where,
      include: {
        profile: { select: { id: true, profileCode: true, fullName: true, city: true, createdAt: true, profileCompletion: true, status: true } },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ kpis, items: queue });
  } catch (error) {
    return handleApiError(error);
  }
}
