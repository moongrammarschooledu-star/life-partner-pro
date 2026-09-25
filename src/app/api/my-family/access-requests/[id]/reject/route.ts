import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { writeAudit } from "@/lib/audit";
import { notifyFamilyAccessRequestDecision } from "@/lib/notifications/events";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const result = await prisma.familyAccessRequest.updateMany({
    where: { id, applicantId: profileId, status: "PENDING" },
    data: { status: "REJECTED", reviewedAt: new Date() },
  });
  if (result.count === 0) return NextResponse.json({ error: "Access request not found." }, { status: 404 });

  const request = await prisma.familyAccessRequest.findUnique({ where: { id } });
  await writeAudit({ action: "FAMILY_ACCESS_REJECTED", targetProfileId: profileId, meta: { requestId: id } });
  if (request) await notifyFamilyAccessRequestDecision(request.familyMemberId, false);

  return NextResponse.json({ ok: true });
}
