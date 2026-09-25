import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { createInvitation, FamilyInvitationError } from "@/lib/family/invitation";
import type { FamilyRole } from "@prisma/client";

const VALID_ROLES: FamilyRole[] = ["FAMILY_VIEWER", "FAMILY_ADVISOR", "FAMILY_COORDINATOR", "FAMILY_GUARDIAN", "FAMILY_APPROVER", "FAMILY_ADMIN"];

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const account = await prisma.familyAccount.findUnique({ where: { applicantId: profileId } });
  if (!account) return NextResponse.json({ items: [] });

  const items = await prisma.familyInvitation.findMany({
    where: { familyAccountId: account.id },
    select: { id: true, invitationCode: true, invitedName: true, invitedEmail: true, invitedMobile: true, relationship: true, requestedRole: true, status: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const key = `my-family-invitations:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { invitedName, invitedEmail, invitedMobile, relationship, requestedRole } = await req.json();
    if (!invitedName || !relationship) {
      return NextResponse.json({ error: "Name and relationship are required." }, { status: 400 });
    }
    if (requestedRole && !VALID_ROLES.includes(requestedRole)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const result = await createInvitation({ applicantId: profileId, invitedName, invitedEmail, invitedMobile, relationship, requestedRole });
    return NextResponse.json({ invitationCode: result.invitationCode, expiresAt: result.expiresAt });
  } catch (error) {
    if (error instanceof FamilyInvitationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
