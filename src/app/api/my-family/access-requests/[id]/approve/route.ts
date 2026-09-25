import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { grantFamilyPermission, FamilyGrantError } from "@/lib/family/grants";
import { writeAudit } from "@/lib/audit";
import { notifyFamilyAccessRequestDecision } from "@/lib/notifications/events";

// Workflow (spec §13): Family Member Request -> Applicant Review -> Approve
// -> Permission Updated -> Audit. Sensitive permissions still route through
// STEP 19 admin approval via grantFamilyPermission's own PENDING_APPROVAL
// path — the applicant's "approve" here means "I agree to this request,"
// not "this is now active" for a sensitive scope.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const request = await prisma.familyAccessRequest.findFirst({ where: { id, applicantId: profileId, status: "PENDING" } });
  if (!request) return NextResponse.json({ error: "Access request not found." }, { status: 404 });

  try {
    const grant = await grantFamilyPermission({ familyMemberId: request.familyMemberId, permission: request.requestedPermission, grantedByProfileId: profileId });

    await prisma.familyAccessRequest.update({
      where: { id },
      data: { status: grant.status === "PENDING_APPROVAL" ? "ESCALATED_FOR_ADMIN_APPROVAL" : "APPROVED", reviewedAt: new Date() },
    });
    await writeAudit({ action: "FAMILY_ACCESS_APPROVED", targetProfileId: profileId, meta: { requestId: id, permission: request.requestedPermission } });
    await notifyFamilyAccessRequestDecision(request.familyMemberId, true);

    return NextResponse.json({ ok: true, status: grant.status });
  } catch (error) {
    if (error instanceof FamilyGrantError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
