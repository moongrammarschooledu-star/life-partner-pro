import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// The comparison view an admin opens to review a potential duplicate —
// both profiles' basic (non-sensitive) fields side by side plus the
// weighted evidence, never contact info (that stays behind the existing
// reveal/share pipeline even here).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("duplicates:view");
    const { id } = await params;

    const candidate = await prisma.duplicateCandidate.findUnique({
      where: { id },
      include: {
        profile: { select: { id: true, profileCode: true, fullName: true, gender: true, dateOfBirth: true, city: true, country: true } },
        candidateProfile: { select: { id: true, profileCode: true, fullName: true, gender: true, dateOfBirth: true, city: true, country: true } },
        securityFlag: { select: { id: true, status: true, severity: true, description: true } },
        reviewer: { select: { name: true } },
      },
    });
    if (!candidate) throw new ApiError(404, "Duplicate candidate not found");

    return NextResponse.json({ ...candidate, matchingSignals: JSON.parse(candidate.matchingSignals) });
  } catch (error) {
    return handleApiError(error);
  }
}
