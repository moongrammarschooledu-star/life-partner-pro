import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Spec §64 — Family ID, primary applicant, members, relationships, roles,
// permissions, consent status, access expiration, activity history, related
// proposals/cases. Sensitive fields (raw permission scope, consent details)
// stay visible to any admin holding family:manage — this is an internal
// staff investigation view, not a further-redacted applicant-facing one.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("family:manage");
    const { id } = await params;

    const account = await prisma.familyAccount.findUnique({
      where: { id },
      include: {
        applicant: { select: { id: true, profileCode: true, fullName: true } },
        members: {
          include: {
            permissions: { select: { permission: true, scope: true, status: true, grantedAt: true, expiresAt: true } },
            sharedRecords: { select: { recordType: true, recordId: true, accessLevel: true, status: true, sharedAt: true, expiresAt: true } },
            sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, deviceInfo: true, lastActiveAt: true } },
          },
        },
      },
    });
    if (!account) throw new ApiError(404, "Family account not found.");

    return NextResponse.json(account);
  } catch (error) {
    return handleApiError(error);
  }
}
