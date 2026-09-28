import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { nextCaseNumber } from "@/lib/case-code";
import { isCategoryValidForType } from "@/lib/case-categories";
import { computeSlaDueDates } from "@/lib/case-sla";
import { findPossibleDuplicateCases } from "@/lib/case-duplicate-detection";
import { notifyCaseCreated } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";
import type { CaseType, CaseCategory } from "@prisma/client";
import { blockedResponse } from "@/lib/ops/guards";
import { attachUserReportToCase, REPORT_TYPE_FOR_CATEGORY } from "@/lib/risk/report-service";

const VALID_TYPES: CaseType[] = ["SUPPORT", "COMPLAINT", "SAFETY_REPORT"];

// Spec §3/§4/§5 — authenticated applicant creates a support request,
// complaint, or safety report. Never blocks/discards on a possible
// duplicate (spec §26) — returns candidates alongside the created case so
// the UI can surface "Possible Existing Case" without preventing filing.
export async function POST(req: Request) {
  const blocked = await blockedResponse({ flags: ["support.enabled"] });
  if (blocked) return blocked;
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await enforceConfiguredLimit(req, "my-cases-create", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await req.json();
  const { type, category, subject, description, reportedProfileCode, relatedProposalId, relatedMeetingId, relatedVerificationId, relatedCommunicationId, preferredResponseMethod } = body as {
    type?: string;
    category?: string;
    subject?: string;
    description?: string;
    reportedProfileCode?: string;
    relatedProposalId?: string;
    relatedMeetingId?: string;
    relatedVerificationId?: string;
    relatedCommunicationId?: string;
    preferredResponseMethod?: string;
  };

  if (!type || !VALID_TYPES.includes(type as CaseType)) {
    return NextResponse.json({ error: "A valid request type is required." }, { status: 400 });
  }
  if (!category || !isCategoryValidForType(type as CaseType, category as CaseCategory)) {
    return NextResponse.json({ error: "A valid category for this request type is required." }, { status: 400 });
  }
  if (!subject?.trim() || !description?.trim()) {
    return NextResponse.json({ error: "Subject and description are required." }, { status: 400 });
  }

  let reportedProfileId: string | null = null;
  if (reportedProfileCode?.trim()) {
    const reported = await prisma.profile.findUnique({ where: { profileCode: reportedProfileCode.trim().toUpperCase() }, select: { id: true } });
    reportedProfileId = reported?.id ?? null;
  }

  const caseType = type as CaseType;
  const duplicates = await findPossibleDuplicateCases({
    reporterProfileId: profileId,
    reportedProfileId,
    category: category as CaseCategory,
  });

  const caseNumber = await nextCaseNumber(caseType);
  const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates("NORMAL");

  const created = await prisma.case.create({
    data: {
      caseNumber,
      type: caseType,
      category: category as CaseCategory,
      subject: subject.trim(),
      description: description.trim(),
      reporterProfileId: profileId,
      reportedProfileId,
      relatedProposalId: relatedProposalId || null,
      relatedMeetingId: relatedMeetingId || null,
      relatedVerificationId: relatedVerificationId || null,
      relatedCommunicationId: relatedCommunicationId || null,
      preferredResponseMethod: preferredResponseMethod || null,
      firstResponseDueAt,
      resolutionDueAt,
    },
  });

  await writeAudit({ action: "CASE_CREATED", targetProfileId: profileId, meta: { caseId: created.id, caseNumber, type: caseType, category } });
  await notifyCaseCreated(created.id, profileId);

  // STEP 24 — a Safety Concern also becomes a UserReport + a low-confidence allegation signal, so it reaches human risk
  // review. Fail-open: it can never block or fail the applicant's own request, and nothing here acts on the reported profile.
  if (caseType === "SAFETY_REPORT" && reportedProfileId !== profileId) {
    try {
      await attachUserReportToCase({ caseId: created.id, caseNumber, reportType: REPORT_TYPE_FOR_CATEGORY[category as CaseCategory] ?? "OTHER", reporterProfileId: profileId, reportedProfileId, description: description.trim() });
    } catch (error) {
      console.error("[risk] could not link the safety case to risk review", error instanceof Error ? error.message : "unknown");
    }
  }

  return NextResponse.json({ id: created.id, caseNumber, possibleDuplicates: duplicates });
}

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.case.findMany({
    where: { reporterProfileId: profileId },
    select: { id: true, caseNumber: true, type: true, category: true, subject: true, status: true, priority: true, createdAt: true, updatedAt: true, closedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ items });
}
