import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { grantFamilyPermission, revokeFamilyPermission, FamilyGrantError } from "@/lib/family/grants";
import { isKnownFamilyPermission } from "@/lib/family/permissions";
import { writeAudit } from "@/lib/audit";
import type { FamilyRole } from "@prisma/client";

const VALID_ROLES: FamilyRole[] = ["FAMILY_VIEWER", "FAMILY_ADVISOR", "FAMILY_COORDINATOR", "FAMILY_GUARDIAN", "FAMILY_APPROVER", "FAMILY_ADMIN"];

// Ownership check at the Prisma call itself (compound WHERE, not
// fetch-then-compare) — the applicant can only ever touch a FamilyMember
// belonging to their OWN FamilyAccount.
async function requireOwnedMember(id: string, applicantId: string) {
  return prisma.familyMember.findFirst({ where: { id, familyAccount: { applicantId } } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const member = await requireOwnedMember(id, profileId);
  if (!member) return NextResponse.json({ error: "Family member not found." }, { status: 404 });

  const body = await req.json();
  const { role, grantPermission, revokePermission, scope, expiresAt } = body as {
    role?: FamilyRole;
    grantPermission?: string;
    revokePermission?: string;
    scope?: string;
    expiresAt?: string;
  };

  try {
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
      await prisma.familyMember.update({ where: { id }, data: { role } });
      await writeAudit({ action: "FAMILY_PERMISSION_CHANGED", targetProfileId: profileId, meta: { familyMemberId: id, newRole: role } });
    }

    if (grantPermission !== undefined) {
      if (!isKnownFamilyPermission(grantPermission)) return NextResponse.json({ error: "Unknown permission." }, { status: 400 });
      await grantFamilyPermission({
        familyMemberId: id,
        permission: grantPermission,
        scope,
        grantedByProfileId: profileId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
    }

    if (revokePermission !== undefined) {
      await revokeFamilyPermission(id, revokePermission, scope ?? null, profileId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FamilyGrantError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
