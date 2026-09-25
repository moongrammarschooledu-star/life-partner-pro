import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { getFamilyMembership } from "@/lib/family/access-control";
import { isKnownFamilyPermission } from "@/lib/family/permissions";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { writeAudit } from "@/lib/audit";
import { notifyFamilyAccessRequestSubmitted } from "@/lib/notifications/events";

// Spec §13's workflow: Family Member Request -> Applicant Review -> ....
// A family member can only ever request a permission for THEIR OWN
// membership — there is no capability anywhere in this module to request on
// behalf of another family member (No Self-Escalation, spec §14).
export async function POST(req: Request) {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { requestedPermission, reason } = await req.json();
  if (!isKnownFamilyPermission(requestedPermission)) {
    return NextResponse.json({ error: "Unknown permission." }, { status: 400 });
  }

  const requestCode = await nextSequenceCode("FAMREQ");
  const [request, member] = await Promise.all([
    prisma.familyAccessRequest.create({ data: { requestCode, familyMemberId, applicantId: membership.applicantId, requestedPermission, reason: reason || null } }),
    prisma.familyMember.findUnique({ where: { id: familyMemberId }, select: { fullName: true } }),
  ]);

  await writeAudit({ action: "FAMILY_ACCESS_REQUESTED", targetProfileId: membership.applicantId, actorFamilyMemberId: familyMemberId, meta: { requestCode, requestedPermission } });
  await notifyFamilyAccessRequestSubmitted(membership.applicantId, member?.fullName ?? "A family member");

  return NextResponse.json({ id: request.id, requestCode: request.requestCode });
}

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.familyAccessRequest.findMany({ where: { familyMemberId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ items });
}
