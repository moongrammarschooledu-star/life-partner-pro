import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";
import { notifyUserResponded } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Spec §14 — submitting additional information flips the case from
// "Waiting for User" back to "In Review".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // STEP 15 §19 — persistent (cross-instance) rate limit.
  const limited = await enforcePersistentLimit(req, "case-respond", 20, 60000);
  if (limited) return limited;
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const { message } = (await req.json()) as { message?: string };

  if (!message?.trim()) return NextResponse.json({ error: "A message is required." }, { status: 400 });

  const caseRecord = await prisma.case.findUnique({ where: { id } });
  if (!caseRecord || caseRecord.reporterProfileId !== profileId) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }
  if (caseRecord.status !== "WAITING_FOR_USER") {
    return NextResponse.json({ error: "This case is not currently waiting for your response." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.caseComment.create({ data: { caseId: id, authorProfileId: profileId, body: message.trim(), visibleToUser: true } }),
    prisma.case.update({ where: { id }, data: { status: "IN_REVIEW" } }),
    prisma.caseStatusHistory.create({ data: { caseId: id, fromStatus: "WAITING_FOR_USER", toStatus: "IN_REVIEW" } }),
  ]);

  const assignedToId = await getCurrentAssigneeId("CASE", id);
  await writeAudit({ action: "CASE_STATUS_CHANGED", targetProfileId: profileId, meta: { caseId: id, fromStatus: "WAITING_FOR_USER", toStatus: "IN_REVIEW", source: "user" } });
  await notifyUserResponded(assignedToId);

  return NextResponse.json({ ok: true, status: "IN_REVIEW" });
}
