import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Marks a POTENTIAL_DUPLICATE as actively being looked at — no decision yet,
// just claims the review (mirrors SecurityFlag's OPEN → INVESTIGATING step).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("duplicates:review");
    const { id } = await params;

    const existing = await prisma.duplicateCandidate.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Duplicate candidate not found");
    if (existing.status !== "POTENTIAL_DUPLICATE") {
      throw new ApiError(409, "This duplicate candidate is no longer awaiting initial review.");
    }

    const candidate = await prisma.$transaction(async (tx) => {
      const updated = await tx.duplicateCandidate.update({ where: { id }, data: { status: "DUPLICATE_REVIEW_REQUIRED", reviewerId: admin.id } });
      if (existing.securityFlagId) {
        await tx.securityFlag.update({ where: { id: existing.securityFlagId }, data: { status: "INVESTIGATING", assignedToId: admin.id } });
      }
      return updated;
    });

    await writeAudit({ action: "DUPLICATE_CANDIDATE_REVIEWED", adminId: admin.id, targetProfileId: candidate.profileId, meta: { candidateId: id } });

    return NextResponse.json(candidate);
  } catch (error) {
    return handleApiError(error);
  }
}
