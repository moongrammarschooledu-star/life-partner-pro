import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { nextCaseNumber } from "@/lib/case-code";
import { computeSlaDueDates } from "@/lib/case-sla";
import { getEffectiveRule } from "@/lib/risk/config";
import { createRiskSignal } from "@/lib/risk/signal-service";
import { assessProfile } from "@/lib/risk/assessment-service";
import { notifyCaseStatusChanged } from "@/lib/notifications/events";
import { notifyAdmins, sendNotification } from "@/lib/notifications/notification-service";
import type { SessionAdmin } from "@/lib/route-guard";
import type { CaseCategory, UserReport, UserReportStatus, UserReportType } from "@prisma/client";

// UserReport → (STEP 12 Case) → risk signal → human review. A report is an
// ALLEGATION, never proof: the signal it raises is low-confidence by
// definition, so one report cannot on its own push an account above MEDIUM,
// and nothing in this file takes any action against the reported profile.

export const REPORT_CATEGORY: Record<UserReportType, CaseCategory> = {
  SUSPICIOUS_PROFILE: "FAKE_PROFILE",
  INAPPROPRIATE_COMMUNICATION: "OTHER_SAFETY_CONCERN",
  IDENTITY_CONCERN: "IDENTITY_MISREPRESENTATION",
  CONTACT_ABUSE: "UNAUTHORIZED_CONTACT",
  HARASSMENT: "THREATENING_BEHAVIOR",
  IMPERSONATION: "FAKE_PROFILE",
  OTHER: "OTHER_SAFETY_CONCERN",
};

export const REPORT_TYPE_FOR_CATEGORY: Partial<Record<CaseCategory, UserReportType>> = {
  FAKE_PROFILE: "SUSPICIOUS_PROFILE",
  IDENTITY_MISREPRESENTATION: "IDENTITY_CONCERN",
  UNAUTHORIZED_CONTACT: "CONTACT_ABUSE",
  THREATENING_BEHAVIOR: "HARASSMENT",
  BLACKMAIL: "HARASSMENT",
  FINANCIAL_SCAM: "SUSPICIOUS_PROFILE",
};

export const REPORT_TYPES = Object.keys(REPORT_CATEGORY) as UserReportType[];
export const MAX_REPORTS_PER_REPORTER_PER_DAY = 5;
const MIN_LEN = 10;
const MAX_LEN = 2000;

export function cleanDescription(input: string): string {
  // Strip control characters; keep it as inert text (it is later wrapped as untrusted for any AI use).
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

export interface SubmitReportResult {
  reportCode: string;
  status: UserReportStatus;
  duplicate: boolean;
}

export async function submitUserReport(params: {
  reporterProfileId: string;
  reportType: string;
  description: string;
  reportedProfileCode?: string | null;
}): Promise<SubmitReportResult> {
  if (!REPORT_TYPES.includes(params.reportType as UserReportType)) throw new HttpError(400, "A valid report type is required.");
  const reportType = params.reportType as UserReportType;
  const description = cleanDescription(params.description ?? "");
  if (description.length < MIN_LEN) throw new HttpError(400, `Please describe your concern in at least ${MIN_LEN} characters.`);
  if (description.length > MAX_LEN) throw new HttpError(400, `Please keep the description under ${MAX_LEN} characters.`);

  let reportedProfileId: string | null = null;
  if (params.reportedProfileCode?.trim()) {
    const reported = await prisma.profile.findUnique({ where: { profileCode: params.reportedProfileCode.trim().toUpperCase() }, select: { id: true } });
    reportedProfileId = reported?.id ?? null; // an unknown code is stored as a general report, never an error that confirms/denies existence
  }
  if (reportedProfileId && reportedProfileId === params.reporterProfileId) throw new HttpError(400, "You cannot report your own profile.");

  const since = new Date(Date.now() - 24 * 3_600_000);
  const todayCount = await prisma.userReport.count({ where: { reporterProfileId: params.reporterProfileId, createdAt: { gte: since } } });
  if (todayCount >= MAX_REPORTS_PER_REPORTER_PER_DAY) throw new HttpError(429, "You have reached today's report limit. Please try again tomorrow.");

  // One live report per reporter+target: a repeat is folded into the existing one (no report-spam
  // pile-up against one person), and the reporter simply gets the existing acknowledgement.
  if (reportedProfileId) {
    const existing = await prisma.userReport.findFirst({
      where: { reporterProfileId: params.reporterProfileId, reportedProfileId, status: { in: ["RECEIVED", "UNDER_REVIEW"] } },
      select: { reportCode: true, status: true },
    });
    if (existing) return { reportCode: existing.reportCode, status: existing.status, duplicate: true };
  }

  const caseNumber = await nextCaseNumber("SAFETY_REPORT");
  const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates("NORMAL");
  const linkedCase = await prisma.case.create({
    data: {
      caseNumber,
      type: "SAFETY_REPORT",
      category: REPORT_CATEGORY[reportType],
      subject: `Safety report (${reportType.toLowerCase().replace(/_/g, " ")})`,
      description,
      reporterProfileId: params.reporterProfileId,
      reportedProfileId,
      firstResponseDueAt,
      resolutionDueAt,
    },
  });

  return attachUserReportToCase({ caseId: linkedCase.id, caseNumber, reportType, reporterProfileId: params.reporterProfileId, reportedProfileId, description });
}

// Creates the UserReport for an existing safety Case and raises the (low-confidence) allegation signal.
// Shared by the "Report a Concern" flow and by the existing Safety Concern case flow (/api/my-cases), so BOTH
// reach human risk review the same way. Never takes any action against the reported profile.
export async function attachUserReportToCase(params: {
  caseId: string;
  caseNumber: string;
  reportType: UserReportType;
  reporterProfileId: string;
  reportedProfileId: string | null;
  description: string;
}): Promise<SubmitReportResult> {
  const { reportType, reportedProfileId, description } = params;
  const linkedCase = { id: params.caseId };
  const caseNumber = params.caseNumber;
  const report = await prisma.userReport.create({
    data: {
      reportCode: await nextSequenceCode("REPORT"),
      reportType,
      reporterProfileId: params.reporterProfileId,
      reportedProfileId,
      description,
      caseId: linkedCase.id,
    },
  });
  await writeAudit({ action: "CASE_CREATED", targetProfileId: params.reporterProfileId, meta: { caseId: linkedCase.id, caseNumber, reportCode: report.reportCode, type: "SAFETY_REPORT" } });

  let riskCaseId: string | null = null;
  if (reportedProfileId) {
    const signal = await createRiskSignal({
      profileId: reportedProfileId,
      flagType: "SAFETY_REPORT_SIGNAL",
      ruleKey: "user_report",
      bucket: `report-${report.id}`,
      description: "A safety concern was reported by another member. This is an allegation and has not been verified.",
      confidence: "LOW",
      source: "user-report",
      evidenceRef: report.id,
    });
    if (signal.created) {
      // Independent reporters are the only thing that raises confidence — never volume from one reporter.
      const concentration = await getEffectiveRule("report_concentration");
      const distinctReporters = (
        await prisma.userReport.findMany({
          where: { reportedProfileId, createdAt: { gte: new Date(Date.now() - Number(concentration.config.windowDays) * 86_400_000) } },
          distinct: ["reporterProfileId"],
          select: { reporterProfileId: true },
        })
      ).length;
      if (distinctReporters >= Number(concentration.config.distinctReporters)) {
        await createRiskSignal({
          profileId: reportedProfileId,
          flagType: "ABUSIVE_BEHAVIOR_REPORT",
          ruleKey: "report_concentration",
          ruleVersion: concentration.version,
          description: `${distinctReporters} different members raised safety concerns about this profile in ${Number(concentration.config.windowDays)} days. These are allegations that need human review.`,
          confidence: "MEDIUM",
          source: "user-report",
        });
      }
      const assessed = await assessProfile(reportedProfileId);
      riskCaseId = assessed.riskCaseId;
      if (riskCaseId) await prisma.userReport.update({ where: { id: report.id }, data: { riskCaseId } });
    }
  }

  await sendNotification({ profileId: params.reporterProfileId, type: "SAFETY_REPORT_ACKNOWLEDGED", data: {} });
  await notifyAdmins({ type: "SAFETY_REPORT_RECEIVED", data: { relatedProfileId: reportedProfileId ?? undefined }, roles: ["SUPPORT_MANAGER", "VERIFICATION_MANAGER"] });

  return { reportCode: report.reportCode, status: report.status, duplicate: false };
}

// The reporter's own reports only — never the reported profile, never risk data.
export async function listOwnReports(reporterProfileId: string) {
  return prisma.userReport.findMany({
    where: { reporterProfileId },
    select: { reportCode: true, reportType: true, status: true, resolutionNote: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

const REPORT_TRANSITIONS: Record<UserReportStatus, UserReportStatus[]> = {
  RECEIVED: ["UNDER_REVIEW", "NO_ACTION_NEEDED", "CLOSED"],
  UNDER_REVIEW: ["ACTION_TAKEN", "NO_ACTION_NEEDED", "CLOSED"],
  ACTION_TAKEN: ["CLOSED"],
  NO_ACTION_NEEDED: ["CLOSED"],
  CLOSED: [],
};

export async function updateReportStatus(reportId: string, actor: SessionAdmin, status: UserReportStatus, resolutionNote?: string): Promise<UserReport> {
  const report = await prisma.userReport.findUnique({ where: { id: reportId } });
  if (!report) throw new HttpError(404, "Report not found.");
  if (!REPORT_TRANSITIONS[report.status].includes(status)) throw new HttpError(409, `A report that is ${report.status} cannot move to ${status}.`);
  const note = resolutionNote?.trim();
  if (["ACTION_TAKEN", "NO_ACTION_NEEDED", "CLOSED"].includes(status) && !note) throw new HttpError(422, "A neutral resolution note is required.");
  const updated = await prisma.userReport.update({ where: { id: reportId }, data: { status, resolutionNote: note ?? report.resolutionNote } });
  await writeAudit({ action: "CASE_STATUS_CHANGED", adminId: actor.id, targetProfileId: report.reportedProfileId, meta: { reportCode: report.reportCode, from: report.status, to: status } });
  await notifyCaseStatusChanged(report.reporterProfileId);
  return updated;
}
