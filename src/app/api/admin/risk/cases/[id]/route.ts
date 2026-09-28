import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getRiskCaseForActor } from "@/lib/risk/case-service";
import { verifyEvidenceRecord } from "@/lib/risk/evidence-service";
import { logPrivacyAccess } from "@/lib/privacy/access-log";

// STEP 24 - full case view for a reviewer: subject, signals, latest explainable assessment, timeline, review
// history, evidence METADATA (payloads have their own permission-gated endpoint), restrictions, duplicate
// clusters and related records. Reading it is itself a logged sensitive access. Device and network signals
// are only listed to holders of sensitive:device:view / sensitive:network:view.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:view");
    const { id } = await params;
    const riskCase = await getRiskCaseForActor(id, admin); // same 404 for missing and not-visible

    const hideTypes: string[] = [];
    if (!admin.permissions.includes("sensitive:device:view")) hideTypes.push("SHARED_DEVICE_SIGNAL");
    if (!admin.permissions.includes("sensitive:network:view")) hideTypes.push("UNUSUAL_NETWORK_ACTIVITY");
    const profileId = riskCase.subjectProfileId;

    const [signals, assessment, events, reviews, evidence, restrictions, clusters, profile, userReports, tasks] = await Promise.all([
      prisma.securityFlag.findMany({
        where: { riskCaseId: id, ...(hideTypes.length ? { flagType: { notIn: hideTypes as never[] } } : {}) },
        select: { id: true, signalCode: true, flagType: true, severity: true, confidence: true, category: true, status: true, description: true, ruleVersion: true, falsePositiveReason: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.riskAssessment.findFirst({ where: { riskCaseId: id }, orderBy: { createdAt: "desc" } }),
      prisma.riskCaseEvent.findMany({ where: { riskCaseId: id }, orderBy: { createdAt: "asc" }, take: 300 }),
      prisma.riskReview.findMany({ where: { riskCaseId: id }, orderBy: { createdAt: "asc" }, take: 100 }),
      prisma.riskEvidence.findMany({ where: { riskCaseId: id }, orderBy: { occurredAt: "asc" }, take: 100 }),
      profileId ? prisma.profileRestriction.findMany({ where: { profileId }, orderBy: { createdAt: "desc" }, take: 25 }) : Promise.resolve([]),
      profileId ? prisma.duplicateClusterMember.findMany({ where: { profileId }, include: { cluster: true }, take: 10 }) : Promise.resolve([]),
      profileId ? prisma.profile.findUnique({ where: { id: profileId }, select: { id: true, profileCode: true, fullName: true, status: true, verified: true, createdAt: true, city: true, country: true } }) : Promise.resolve(null),
      riskCase.userReportId ? prisma.userReport.findMany({ where: { id: riskCase.userReportId }, select: { reportCode: true, reportType: true, status: true, createdAt: true } }) : Promise.resolve([]),
      prisma.adminTask.findMany({ where: { resourceId: { in: [profileId, riskCase.subjectAdminId].filter((x): x is string => !!x) }, taskType: { in: ["RISK_REVIEW", "ADMIN_SECURITY_REVIEW", "RISK_SIGNAL_REVIEW"] } }, select: { id: true, taskCode: true, taskType: true, status: true }, take: 10 }),
    ]);

    await logPrivacyAccess({ actorAdminId: admin.id, action: "RISK_CASE_VIEWED", field: "riskCase", targetProfileId: profileId, reason: `Risk case ${riskCase.riskCode}`, purpose: "FRAUD_PREVENTION" });

    return NextResponse.json({
      case: riskCase,
      subject: riskCase.subjectAdminId ? { kind: "STAFF" } : { kind: "APPLICANT", profile },
      signals,
      assessment: assessment
        ? { ...assessment, topSignals: safeJson(assessment.topSignals), rulesTriggered: safeJson(assessment.rulesTriggered), evidence: undefined }
        : null,
      events: events.map((e) => ({ ...e, payload: undefined })),
      reviews: reviews.map((r) => ({ ...r, checklist: safeJson(r.checklist) })),
      evidence: evidence.map((e) => ({ id: e.id, evidenceType: e.evidenceType, source: e.source, summary: e.summary, occurredAt: e.occurredAt, createdById: e.createdById, integrityOk: verifyEvidenceRecord(e) })),
      restrictions,
      duplicateClusters: clusters.map((c) => ({ id: c.cluster.id, status: c.cluster.status, confidenceBand: c.cluster.confidenceBand, memberCount: c.cluster.memberCount })),
      userReports,
      tasks,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
