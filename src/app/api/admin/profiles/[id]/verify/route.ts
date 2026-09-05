import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { setVerificationStatus } from "@/lib/verification/status";

// Legacy one-click alias, kept so nothing that already links here 404s.
// The Verify button in status-control.tsx was replaced by a link to the
// full Verification Review page (/admin/verification/[profileId]) in
// STEP 8 — this route now routes through the same central
// setVerificationStatus() transition helper every other admin action uses,
// instead of a raw prisma.profile.update.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:verify");
    const { id } = await params;

    await setVerificationStatus(id, "VERIFIED", { adminId: admin.id });
    const profile = await prisma.profile.findUniqueOrThrow({ where: { id }, select: { verified: true, status: true } });

    await writeAudit({ action: "PROFILE_VERIFIED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json({ verified: profile.verified, status: profile.status });
  } catch (error) {
    return handleApiError(error);
  }
}
