import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

// Spec §36 — deliberately narrow: status, official (visibleToUser) responses,
// and resolution only. Never internal notes, evidence uploaded by staff or
// other parties, internal risk flags, or non-user-facing decisions.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      comments: { where: { visibleToUser: true }, orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, authorAdminId: true } },
      resolution: { select: { summary: true, actionTaken: true, createdAt: true } },
    },
  });
  // 404 rather than 403 for a case that isn't theirs — never confirms
  // whether a given case id exists to someone who doesn't own it.
  if (!caseRecord || caseRecord.reporterProfileId !== profileId) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: caseRecord.id,
    caseNumber: caseRecord.caseNumber,
    type: caseRecord.type,
    category: caseRecord.category,
    subject: caseRecord.subject,
    description: caseRecord.description,
    status: caseRecord.status,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt,
    closedAt: caseRecord.closedAt,
    responses: caseRecord.comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, official: !!c.authorAdminId })),
    resolution: caseRecord.resolution,
  });
}
