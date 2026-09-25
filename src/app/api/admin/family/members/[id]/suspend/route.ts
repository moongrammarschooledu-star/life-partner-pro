import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { suspendFamilyMember, revokeAccess } from "@/lib/family/access-control";

// Spec §49 — admin may suspend a family account for a security issue, abuse
// report, policy violation, or compromised account. Integrates with STEP 12
// (case linkage via `reason`) and STEP 19 governance is not additionally
// required here since suspension is a protective, reversible action (unlike
// granting new sensitive access, which IS gated — see the access-requests
// review route). Evidence/audit records are never deleted, only the
// member's access.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("family:manage");
    const { id } = await params;
    const { reason, permanent } = await req.json();
    if (!reason || typeof reason !== "string") throw new ApiError(400, "A reason is required.");

    const member = await prisma.familyMember.findUnique({ where: { id }, select: { id: true, familyAccount: { select: { applicantId: true } } } });
    if (!member) throw new ApiError(404, "Family member not found.");

    if (permanent) {
      await revokeAccess(id, member.familyAccount.applicantId, `admin:${admin.id}:${reason}`);
    } else {
      await suspendFamilyMember(id, member.familyAccount.applicantId, `admin:${admin.id}:${reason}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
