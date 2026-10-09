import { prisma } from "@/lib/prisma";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { assertFollowUpAccess } from "@/lib/followup-access";
import { assertProposalAccess } from "@/lib/proposal-access";
import { runAiRequest } from "@/lib/ai/pipeline";
import { auditAi } from "@/lib/ai/record";
import { minimizeForExternal } from "@/lib/ai/profile-view";
import { analyzeMutual } from "@/lib/ai/analysis/mutual";
import { detectFindings, improvementSuggestions, sufficiencyOf } from "@/lib/ai/analysis/quality";
import { buildFollowUpSuggestion } from "@/lib/ai/analysis/followup";
import { buildReportSummary } from "@/lib/ai/analysis/report";
import { buildRiskCaseSummary } from "@/lib/ai/analysis/risk-summary";
import { getRiskCaseForActor } from "@/lib/risk/case-service";
import { verifyEvidenceRecord } from "@/lib/risk/evidence-service";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { buildCrmApplicantSummary, buildCrmTimelineSummary } from "@/lib/crm/ai-assistant";
import { getCrmTimeline } from "@/lib/crm/timeline-service";
import { buildMarketingAssist, type MarketingAssistInput, type MarketingAssistMode } from "@/lib/ai/analysis/marketing-assistant";
import { computeCampaignRoi, computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { buildEngagementAssist, type EngagementAssistInput, type EngagementAssistMode } from "@/lib/ai/analysis/engagement-assistant";
import { getEngagementOverview } from "@/lib/engagement/analytics";
import { buildAnalyticsAnswer, buildExecutiveSummaryPayload } from "@/lib/ai/analysis/analytics-assistant";
import { explainResult, parseQuestion } from "@/lib/analytics/assistant";
import { collectExecutiveFacts } from "@/lib/analytics/executive";
import { runAnalyticsQuery } from "@/lib/analytics/query";
import { PERIOD_PRESETS } from "@/lib/analytics/time";
import { loadEngagementSnapshot } from "@/lib/engagement/read-model";
import type { EngagementSnapshot } from "@/lib/engagement/types";
import { STANDARD_LIMITATIONS } from "@/lib/ai/analysis/summary";
import { loadMatchConfig } from "@/lib/ai/match-config";
import { executeTool } from "@/lib/ai/copilot/tools";
import type { AiLanguage, AiOutcome, AiPayload, CommunicationKind } from "@/lib/ai/types";
import type { BuildContext } from "@/lib/ai/pipeline";

// Spec §42 — one function per AI feature. Each goes through runAiRequest(), so
// authentication is done by the route, and permission / assignment /
// sensitive-field / consent / rate-limit / safety / audit are all enforced in
// the pipeline. Profiles may be given as an internal id or a profile code
// (LPP-000123); unknown and inaccessible look identical.

const denied = (message = "You do not have access to this profile."): AiOutcome => ({ ok: false, status: 403, code: "FORBIDDEN", message });

export async function resolveProfileRef(ref: string): Promise<string | null> {
  if (/^LPP-/i.test(ref)) {
    const p = await prisma.profile.findFirst({ where: { profileCode: ref.toUpperCase(), softDeleted: false }, select: { id: true } });
    return p?.id ?? null;
  }
  return ref;
}

async function refsToIds(admin: SessionAdmin, refs: string[], feature: string): Promise<string[] | null> {
  const ids: string[] = [];
  for (const r of refs) {
    const id = await resolveProfileRef(r);
    if (!id) {
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature, reason: "UNKNOWN_PROFILE" });
      return null;
    }
    ids.push(id);
  }
  return ids;
}

const externalOf = (ctx: BuildContext) => ctx.loaded.map((l) => minimizeForExternal(l.view));

export async function runProfileSummary(admin: SessionAdmin, input: { profileId: string }): Promise<AiOutcome> {
  const ids = await refsToIds(admin, [input.profileId], "PROFILE_SUMMARY");
  if (!ids) return denied();
  return runAiRequest({
    admin,
    feature: "PROFILE_SUMMARY",
    profileIds: ids,
    build: (ctx) => ctx.provider.analyzeProfile({ view: ctx.loaded[0].view, external: externalOf(ctx)[0] }, ctx.settings),
  });
}

// §10/§11/§12/§48 — data quality, contradictions and improvement suggestions.
// Rule-based only (no external provider is ever used for this feature).
export async function runDataQuality(admin: SessionAdmin, input: { profileId: string; mode?: "quality" | "improvement" }): Promise<AiOutcome> {
  const feature = input.mode === "improvement" ? "PROFILE_IMPROVEMENT" : "DATA_QUALITY";
  const ids = await refsToIds(admin, [input.profileId], feature);
  if (!ids) return denied();
  return runAiRequest({
    admin,
    feature,
    profileIds: ids,
    build: async (ctx) => {
      const view = ctx.loaded[0].view;
      const findings = detectFindings(view);
      const suggestions = improvementSuggestions(view);
      const by = (l: string) => findings.filter((f) => f.label === l);
      const payload: AiPayload = {
        summary:
          findings.length === 0
            ? `${view.ref} (${view.profileCode}): no data-quality issues were detected.`
            : `${view.ref} (${view.profileCode}): ${findings.length} potential item(s) detected — ${by("MISSING").length} missing, ${by("INCONSISTENT").length} potentially inconsistent, ${by("NEEDS_VERIFICATION").length} needing verification, ${by("USER_CONFIRMATION_REQUIRED").length} needing member confirmation. Admin review required; none of these is a conclusion about the member.`,
        evidence: [],
        alignedAreas: [],
        potentialConflicts: by("INCONSISTENT").map((f) => f.message),
        missingInformation: by("MISSING").map((f) => f.message),
        verificationQuestions: [...by("NEEDS_VERIFICATION"), ...by("USER_CONFIRMATION_REQUIRED")].map((f) => `${f.area}: ${f.message}`),
        suggestedNextStep: suggestions[0] ?? (findings.length ? "Review the listed items with the member." : null),
        limitations: [...STANDARD_LIMITATIONS, "Findings are observations for admin review. They do not reject, suspend or accuse anyone, and never conclude fraud."],
        sufficiency: sufficiencyOf(view, findings),
        findings,
        data: { suggestions, note: "Suggestions are text only; nothing is written to the profile." },
      };
      return { payload };
    },
  });
}

async function mutualFor(ctx: BuildContext) {
  const [a, b] = ctx.loaded;
  if (a.view.gender === b.view.gender) throw new ApiError(400, "Matches must be between opposite genders.");
  const mutual = analyzeMutual(a, b, { config: await loadMatchConfig(), restrictedCategories: ctx.restrictedCategories });
  return { a, b, mutual };
}

export async function runMatchExplanation(admin: SessionAdmin, input: { profileAId: string; profileBId: string }): Promise<AiOutcome> {
  const ids = await refsToIds(admin, [input.profileAId, input.profileBId], "MATCH_EXPLANATION");
  if (!ids) return denied();
  return runAiRequest({
    admin,
    feature: "MATCH_EXPLANATION",
    profileIds: ids,
    forMatching: true,
    build: async (ctx) => {
      const { a, b, mutual } = await mutualFor(ctx);
      const ex = externalOf(ctx);
      return ctx.provider.explainMatch({ a: a.view, b: b.view, externalA: ex[0], externalB: ex[1], mutual }, ctx.settings);
    },
  });
}

export async function runCompare(admin: SessionAdmin, input: { profileIds: string[] }): Promise<AiOutcome> {
  const ids = await refsToIds(admin, input.profileIds, "COMPARE");
  if (!ids) return denied();
  return runAiRequest({
    admin,
    feature: "COMPARE",
    profileIds: ids,
    forMatching: true,
    build: async (ctx) => {
      const config = await loadMatchConfig();
      const pairs: Array<{ a: string; b: string; analysis: ReturnType<typeof analyzeMutual> }> = [];
      for (let i = 0; i < ctx.loaded.length; i++) {
        for (let j = i + 1; j < ctx.loaded.length; j++) {
          const A = ctx.loaded[i];
          const B = ctx.loaded[j];
          if (A.view.gender === B.view.gender) continue; // the matcher only pairs opposite genders
          pairs.push({ a: A.view.ref, b: B.view.ref, analysis: analyzeMutual(A, B, { config, restrictedCategories: ctx.restrictedCategories }) });
        }
      }
      return ctx.provider.compareProfiles({ views: ctx.loaded.map((l) => l.view), externals: externalOf(ctx), pairs }, ctx.settings);
    },
  });
}

// §13 — internal, neutral proposal-preparation note. The admin must review and
// approve; nothing is created or sent here.
export async function runProposalAssistance(admin: SessionAdmin, input: { profileAId: string; profileBId: string; proposalId?: string }): Promise<AiOutcome> {
  const ids = await refsToIds(admin, [input.profileAId, input.profileBId], "PROPOSAL_ASSISTANT");
  if (!ids) return denied();
  let proposalLine: { label: string; value: string; source: "DATABASE" } | null = null;
  if (input.proposalId) {
    const proposal = await prisma.proposal.findUnique({ where: { id: input.proposalId }, select: { status: true, assignedToId: true, proposalCode: true } });
    try {
      if (!proposal) throw new ApiError(403, "no access");
      assertProposalAccess(admin, proposal);
    } catch {
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "PROPOSAL_ASSISTANT", reason: "PROPOSAL_ACCESS" });
      return denied("You do not have access to this proposal.");
    }
    proposalLine = { label: "Proposal status", value: `${proposal.proposalCode ?? "Proposal"} — ${proposal.status.replace(/_/g, " ").toLowerCase()}`, source: "DATABASE" };
  }
  return runAiRequest({
    admin,
    feature: "PROPOSAL_ASSISTANT",
    profileIds: ids,
    forMatching: true,
    build: async (ctx) => {
      const { a, b, mutual } = await mutualFor(ctx);
      const ex = externalOf(ctx);
      const base = await ctx.provider.explainMatch({ a: a.view, b: b.view, externalA: ex[0], externalB: ex[1], mutual }, ctx.settings);
      const p = base.payload;
      const notVerified = [a, b].filter((x) => x.view.verification?.status !== "VERIFIED").map((x) => `${x.view.ref}: verification is not complete.`);
      const payload: AiPayload = {
        ...p,
        summary: `AI Proposal Preparation (internal, neutral): ${p.summary} Admin review and approval are required before any proposal is sent.`,
        evidence: proposalLine ? [proposalLine, ...p.evidence] : p.evidence,
        verificationQuestions: [
          ...new Set([
            ...p.verificationQuestions,
            ...notVerified,
            "Has each member consented to this proposal and to sharing the agreed details?",
            "Are the differences listed above acceptable to both sides, or should they be discussed first?",
          ]),
        ].slice(0, 30),
        suggestedNextStep: "Resolve the questions above, then review and approve in the Proposals workflow. This note has not been sent to anyone.",
        limitations: [...p.limitations, "This is an internal preparation note, not a recommendation to proceed."],
      };
      return { ...base, payload };
    },
  });
}

export async function runCommunicationDraft(admin: SessionAdmin, input: { profileId: string; kind: CommunicationKind; language: AiLanguage; proposalId?: string }): Promise<AiOutcome> {
  const ids = await refsToIds(admin, [input.profileId], "COMMUNICATION_ASSISTANT");
  if (!ids) return denied();
  return runAiRequest({
    admin,
    feature: "COMMUNICATION_ASSISTANT",
    profileIds: ids,
    language: input.language,
    extraCacheParts: { kind: input.kind },
    build: async (ctx) => {
      const view = ctx.loaded[0].view;
      const res = await ctx.provider.generateCommunication({ kind: input.kind, language: input.language, recipientCode: view.profileCode }, ctx.settings);
      // §49 — respect consent: warn if the member has agreed to no channel.
      const consents = await prisma.communicationConsent.findMany({ where: { profileId: view.profileId }, select: { channel: true, status: true } });
      const granted = consents.filter((c) => c.status === "GRANTED").map((c) => c.channel);
      const consentNote = granted.length
        ? `Member has consented to: ${granted.join(", ").toLowerCase()}. Use only those channels.`
        : "No communication-channel consent is recorded for this member — do not send until it is confirmed.";
      return { ...res, payload: { ...res.payload, potentialConflicts: granted.length ? res.payload.potentialConflicts : [...res.payload.potentialConflicts, consentNote], evidence: [...res.payload.evidence, { label: "Channel consent", value: consentNote, source: "DATABASE" as const }] } };
    },
  });
}

export async function runFollowUpDraft(admin: SessionAdmin, input: { followUpId: string; language: AiLanguage }): Promise<AiOutcome> {
  const fu = await prisma.followUp.findUnique({
    where: { id: input.followUpId },
    select: { id: true, adminId: true, profileId: true, purpose: true, status: true, dueDate: true, priority: true, proposal: { select: { status: true } }, crmRecord: { select: { crmCode: true, lifecycleStage: true } } },
  });
  try {
    if (!fu) throw new ApiError(403, "no access");
    await assertFollowUpAccess(admin, { id: fu.id, adminId: fu.adminId });
  } catch {
    await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "FOLLOWUP_ASSISTANT", reason: "FOLLOWUP_ACCESS" });
    return denied("You do not have access to this follow-up.");
  }
  return runAiRequest({
    admin,
    feature: "FOLLOWUP_ASSISTANT",
    profileIds: [fu.profileId],
    language: input.language,
    extraCacheParts: { followUp: fu.id, due: fu.dueDate.toISOString(), status: fu.status },
    build: async (ctx) => ({
      payload: buildFollowUpSuggestion(
        {
          profileCode: ctx.loaded[0].view.profileCode,
          purpose: fu.purpose,
          status: fu.status,
          dueDate: fu.dueDate,
          priority: fu.priority,
          proposalStatus: fu.proposal?.status ?? null,
          now: new Date(),
          // STEP 28 — enriches the draft's evidence when this follow-up is
          // CRM-linked; a pre-STEP-28 follow-up simply has no crmRecord.
          crmCode: fu.crmRecord?.crmCode,
          lifecycleStage: fu.crmRecord?.lifecycleStage,
        },
        input.language
      ),
    }),
  });
}

export async function runReportSummary(admin: SessionAdmin, input: { report: "registrations" | "proposals" | "followups" | "verification" | "support"; days: number }): Promise<AiOutcome> {
  return runAiRequest({
    admin,
    feature: "REPORT_ASSISTANT",
    profileIds: [],
    extraCacheParts: input,
    build: async () => {
      // The tool re-checks reports:view AND ai:report:use against this admin.
      const out = await executeTool("getReportSummary", input, admin);
      const figures = Object.entries((out.data as { figures?: Record<string, number> } | undefined)?.figures ?? {}).map(([label, value]) => ({ label, value }));
      return { payload: buildReportSummary({ title: input.report.charAt(0).toUpperCase() + input.report.slice(1), periodDays: input.days, figures, generatedAt: new Date() }) };
    },
  });
}

// STEP 24 — case-metadata summary for a risk case. Built-in deterministic builder only: no provider is
// called, so no risk data can leave the system. Visibility is the case's own (an admin-subject case is
// invisible to its subject); the pipeline still enforces ai:risk:use, flags, rollout and audits.
export async function runRiskCaseSummary(admin: SessionAdmin, input: { riskCaseId: string }): Promise<AiOutcome> {
  let riskCase;
  try {
    riskCase = await getRiskCaseForActor(input.riskCaseId, admin);
  } catch {
    await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "RISK_CASE_SUMMARY", reason: "UNKNOWN_OR_HIDDEN_CASE" });
    return denied("You do not have access to this case.");
  }
  return runAiRequest({
    admin,
    feature: "RISK_CASE_SUMMARY",
    profileIds: [],
    extraCacheParts: { riskCaseId: riskCase.id, updatedAt: riskCase.updatedAt.toISOString() },
    build: async () => {
      const [signals, evidence, reviews, assessment, restrictions, cluster] = await Promise.all([
        prisma.securityFlag.findMany({ where: { riskCaseId: riskCase.id }, select: { flagType: true, severity: true, confidence: true, status: true }, take: 50 }),
        prisma.riskEvidence.findMany({ where: { riskCaseId: riskCase.id }, take: 50 }),
        prisma.riskReview.findMany({ where: { riskCaseId: riskCase.id }, select: { decision: true }, take: 50 }),
        prisma.riskAssessment.findFirst({ where: { riskCaseId: riskCase.id }, orderBy: { createdAt: "desc" }, select: { cappedBySingleSignal: true } }),
        riskCase.subjectProfileId ? prisma.profileRestriction.count({ where: { riskCaseId: riskCase.id, active: true } }) : Promise.resolve(0),
        riskCase.subjectProfileId ? prisma.duplicateClusterMember.count({ where: { profileId: riskCase.subjectProfileId, cluster: { status: "UNRESOLVED" } } }) : Promise.resolve(0),
      ]);
      return {
        payload: buildRiskCaseSummary({
          riskCode: riskCase.riskCode,
          status: riskCase.status,
          riskLevel: riskCase.riskLevel,
          category: riskCase.category,
          openedBy: riskCase.openedBy.split(":")[0],
          subjectKind: riskCase.subjectAdminId ? "STAFF" : "APPLICANT",
          ageHours: (Date.now() - riskCase.createdAt.getTime()) / 3_600_000,
          overdue: !!riskCase.dueAt && riskCase.dueAt.getTime() < Date.now(),
          signals: signals.map((s) => ({ type: s.flagType, severity: s.severity, confidence: s.confidence, status: s.status })),
          evidenceTypes: evidence.map((e) => e.evidenceType),
          evidenceIntegrityIssues: evidence.filter((e) => !verifyEvidenceRecord(e)).length,
          reviewDecisions: reviews.map((r) => r.decision),
          hasActiveRestrictions: restrictions > 0,
          linkedDuplicateCluster: cluster > 0,
          falsePositiveSignals: signals.filter((s) => s.status === "FALSE_POSITIVE").length,
          cappedBySingleSignal: assessment?.cappedBySingleSignal ?? false,
        }),
      };
    },
  });
}

// STEP 29 — marketing copy drafts / aggregate summaries. Built-in phrase-library builder only (no provider call, no
// applicant data). The summary modes read only aggregate campaign numbers computed server-side from a campaign the
// admin may view; the assistant cannot launch, spend, approve or send anything.
export async function runMarketingAssistant(
  admin: SessionAdmin,
  input: { mode: MarketingAssistMode; language?: "EN" | "UR"; objective?: string; campaignId?: string; leadFirstName?: string },
): Promise<AiOutcome> {
  let summary: MarketingAssistInput["summary"];
  if (input.mode === "CAMPAIGN_SUMMARY" || input.mode === "ANALYTICS_SUMMARY") {
    if (!admin.permissions.includes("marketing:analytics:view")) {
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "MARKETING_ASSISTANT", reason: "NO_ANALYTICS_ACCESS" });
      return denied("You do not have access to marketing analytics.");
    }
    const campaign = input.campaignId ? await prisma.marketingCampaign.findUnique({ where: { id: input.campaignId } }) : null;
    if (input.campaignId && !campaign) {
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "MARKETING_ASSISTANT", reason: "UNKNOWN_CAMPAIGN" });
      return denied("You do not have access to this campaign.");
    }
    const a = await computeMarketingAnalytics({ from: new Date("2000-01-01"), to: new Date(), campaignId: campaign?.id ?? null });
    const stage = (k: string) => a.funnel.stages.find((s) => s.key === k)?.value ?? 0;
    const roi = campaign ? await computeCampaignRoi(campaign.id) : null;
    summary = {
      campaignCode: campaign?.code, status: campaign?.status, leads: stage("LEADS"), registrations: stage("REGISTRATIONS"), verified: stage("VERIFIED_PROFILES"),
      spendMinor: campaign?.spendVerified ? campaign.spendVerifiedMinor : null, currencyCode: campaign?.currencyCode ?? "PKR",
      cplMinor: a.topCampaigns[0]?.cplMinor ?? null,
      roiMessage: roi ? (roi.status === "CALCULATED" ? `Verified ROI: ${roi.roiPct}% (${roi.methodology})` : roi.message) : null,
    };
  }
  return runAiRequest({
    admin,
    feature: "MARKETING_ASSISTANT",
    profileIds: [],
    extraCacheParts: { mode: input.mode, language: input.language ?? "EN", objective: input.objective ?? "", campaignId: input.campaignId ?? "", name: input.leadFirstName ?? "" },
    build: async () => ({ payload: buildMarketingAssist({ mode: input.mode, language: input.language, objective: input.objective, summary, leadFirstName: input.leadFirstName }) }),
  });
}

// STEP 28 — CRM applicant/timeline summary. Built-in deterministic builder
// only (src/lib/crm/ai-assistant.ts), same no-provider-call pattern as
// RISK_CASE_SUMMARY above; the neutral risk-indicator band (never a raw
// score, spec §46) comes from the most recent open RiskCase, if any.
export async function runCrmSummary(admin: SessionAdmin, input: { crmRecordId: string; mode?: "applicant" | "timeline" }): Promise<AiOutcome> {
  const record = await prisma.crmRecord.findUnique({ where: { id: input.crmRecordId } });
  try {
    if (!record) throw new ApiError(403, "no access");
    assertCanSeeCrmRecord(admin, record);
  } catch {
    await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "CRM_SUMMARY", reason: "UNKNOWN_OR_HIDDEN_RECORD" });
    return denied("You do not have access to this CRM record.");
  }

  return runAiRequest({
    admin,
    feature: "CRM_SUMMARY",
    profileIds: [],
    extraCacheParts: { crmRecordId: record.id, mode: input.mode ?? "applicant", updatedAt: record.updatedAt.toISOString() },
    build: async () => {
      if (input.mode === "timeline") {
        const items = await getCrmTimeline(record.id, admin, 500);
        const stageChanges = items.filter((i) => i.sourceType === "LIFECYCLE").length;
        const first = items[items.length - 1]?.createdAt;
        const last = items[0]?.createdAt;
        const spanDays = first && last ? Math.max(0, Math.round((last.getTime() - first.getTime()) / 86_400_000)) : 0;
        return { payload: buildCrmTimelineSummary({ eventCount: items.length, stageChanges, spanDays, lastEventLabel: items[0]?.label ?? null }) };
      }

      const [assignedStaff, verification, openFollowUps, overdueFollowUps, activeProposals, tagRows, openRiskCase, activeSubscription] = await Promise.all([
        record.assignedStaffId ? prisma.adminUser.findUnique({ where: { id: record.assignedStaffId }, select: { name: true } }) : Promise.resolve(null),
        prisma.profileVerification.findUnique({ where: { profileId: record.profileId }, select: { status: true } }),
        prisma.followUp.count({ where: { crmRecordId: record.id, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
        prisma.followUp.count({ where: { crmRecordId: record.id, slaState: { in: ["OVERDUE", "BREACHED"] } } }),
        prisma.proposal.count({ where: { OR: [{ profileAId: record.profileId }, { profileBId: record.profileId }], status: { notIn: ["CLOSED", "REJECTED", "ARCHIVED", "NOT_INTERESTED"] } } }),
        prisma.crmRecordTag.findMany({ where: { crmRecordId: record.id }, include: { tag: { select: { name: true } } } }),
        prisma.riskCase.findFirst({ where: { subjectProfileId: record.profileId, status: { notIn: ["CLOSED", "DISMISSED"] } }, orderBy: { createdAt: "desc" }, select: { riskLevel: true } }),
        prisma.subscription.findFirst({ where: { profileId: record.profileId, status: "ACTIVE" }, include: { package: { select: { name: true } } } }),
      ]);

      return {
        payload: buildCrmApplicantSummary({
          crmCode: record.crmCode,
          lifecycleStage: record.lifecycleStage,
          verificationStatus: verification?.status ?? "NOT_VERIFIED",
          assignedStaffName: assignedStaff?.name ?? null,
          openFollowUps,
          overdueFollowUps,
          activeProposals,
          lastActivityDaysAgo: record.lastActivityAt ? Math.round((Date.now() - record.lastActivityAt.getTime()) / 86_400_000) : null,
          membershipPackageName: activeSubscription?.package?.name ?? null,
          riskIndicatorBand: openRiskCase?.riskLevel ?? null,
          tags: tagRows.map((t) => t.tag.name),
        }),
      };
    },
  });
}

// STEP 30 - engagement summaries / reminder drafts / content topics. Built-in deterministic builder only (no provider call).
// Per-person modes require the admin to be able to see that person's CRM record (same rule as CRM_SUMMARY) and read a
// server-built snapshot with counts only - never contact details, documents, notes, risk signals or the activity score.
// Summary modes read aggregates. The assistant cannot send, schedule, approve or change anything.
export async function runEngagementAssistant(
  admin: SessionAdmin,
  input: { mode: EngagementAssistMode; language?: "EN" | "UR"; crmRecordId?: string; reminderKind?: string; days?: number },
): Promise<AiOutcome> {
  const needsPerson = input.mode === "JOURNEY_SUMMARY" || input.mode === "NEXT_ACTION_EXPLANATION";
  let snapshot: EngagementSnapshot | undefined;
  let recordUpdatedAt = "";
  if (needsPerson) {
    const record = input.crmRecordId ? await prisma.crmRecord.findUnique({ where: { id: input.crmRecordId } }) : null;
    try {
      if (!record) throw new ApiError(403, "no access");
      assertCanSeeCrmRecord(admin, record);
    } catch {
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "ENGAGEMENT_ASSISTANT", reason: "UNKNOWN_OR_HIDDEN_RECORD" });
      return denied("You do not have access to this record.");
    }
    snapshot = (await loadEngagementSnapshot(record.profileId)) ?? undefined;
    recordUpdatedAt = record.updatedAt.toISOString();
  }
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 365);
  let feedback: EngagementAssistInput["feedback"];
  let analytics: EngagementAssistInput["analytics"];
  if (input.mode === "FEEDBACK_SUMMARY") {
    if (!admin.permissions.includes("engagement:feedback:view")) {
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "ENGAGEMENT_ASSISTANT", reason: "NO_FEEDBACK_ACCESS" });
      return denied("You do not have access to engagement feedback.");
    }
    const since = new Date(Date.now() - days * 86_400_000);
    const [byType, byStatus] = await Promise.all([
      prisma.engagementFeedback.groupBy({ by: ["type"], where: { createdAt: { gte: since } }, _count: { type: true } }),
      prisma.engagementFeedback.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { status: true } }),
    ]);
    feedback = { total: byType.reduce((n, r) => n + r._count.type, 0), byType: Object.fromEntries(byType.map((r) => [r.type, r._count.type])), byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count.status])) };
  }
  if (input.mode === "ANALYTICS_SUMMARY") {
    if (!admin.permissions.includes("engagement:analytics:view")) {
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "ENGAGEMENT_ASSISTANT", reason: "NO_ANALYTICS_ACCESS" });
      return denied("You do not have access to engagement analytics.");
    }
    const o = await getEngagementOverview(days);
    analytics = { windowDays: days, registered: o.events.USER_REGISTERED ?? 0, profileCompleted: o.events.PROFILE_COMPLETED ?? 0, verified: o.events.VERIFICATION_COMPLETED ?? 0, remindersSent: o.reminders.SENT ?? 0, reengagementRate: o.reengagementResponseRate };
  }
  return runAiRequest({
    admin,
    feature: "ENGAGEMENT_ASSISTANT",
    profileIds: [],
    extraCacheParts: { mode: input.mode, language: input.language ?? "EN", crmRecordId: input.crmRecordId ?? "", reminderKind: input.reminderKind ?? "", days: String(days), updatedAt: recordUpdatedAt },
    build: async () => ({ payload: buildEngagementAssist({ mode: input.mode, language: input.language, snapshot, reminderKind: input.reminderKind, feedback, analytics }) }),
  });
}

// STEP 31 - analytics assistant. Two modes. QUESTION: a plain-language question is parsed (no model, no SQL) into a structured query over
// the metric catalog, run through the same engine and permission checks as every dashboard, and explained with citations.
// EXECUTIVE_SUMMARY: an AI-assisted summary built from the same engine's results with observed / calculated / interpretation /
// recommendation lines labelled. It sees only what the asking admin may see, and it cannot run SQL, send, approve or predict anything.
export async function runAnalyticsAssistant(
  admin: SessionAdmin,
  input: { mode: "QUESTION" | "EXECUTIVE_SUMMARY"; question?: string; period?: string },
): Promise<AiOutcome> {
  return runAiRequest({
    admin,
    feature: "ANALYTICS_ASSISTANT",
    userText: input.question,
    profileIds: [],
    extraCacheParts: { mode: input.mode, q: (input.question ?? "").slice(0, 300), period: input.period ?? "", day: new Date().toISOString().slice(0, 13) },
    build: async () => {
      const viewer = { id: admin.id, permissions: admin.permissions as string[] };
      if (input.mode === "EXECUTIVE_SUMMARY") {
        const preset = ((input.period ?? "LAST_30_DAYS") as import("@/lib/analytics/time").PeriodPreset);
        const facts = await collectExecutiveFacts(viewer, PERIOD_PRESETS.includes(preset) && preset !== "CUSTOM" ? preset : "LAST_30_DAYS");
        return { payload: buildExecutiveSummaryPayload(facts) };
      }
      const question = (input.question ?? "").trim();
      const parsed = parseQuestion(question);
      if (!parsed.ok) return { payload: buildAnalyticsAnswer({ question, ...(parsed.kind === "REFUSED" ? { refused: parsed.reason } : { unsupported: parsed.reason }) }) };
      try {
        const res = await runAnalyticsQuery(viewer, parsed.query, { resource: "assistant" });
        const explanation = explainResult(res.results, res.period.label, res.comparison?.label ?? null, res.dimension, { assumptions: parsed.assumptions, causal: parsed.causal });
        return { payload: buildAnalyticsAnswer({ question, explanation, period: res.period.label, freshness: res.freshness.label }) };
      } catch (error) {
        const denied = error instanceof Error && /do not have access/i.test(error.message);
        return { payload: buildAnalyticsAnswer({ question, ...(denied ? { denied: "You do not have access to that metric, so I cannot answer it." } : { unsupported: "I can't answer that from the available data." }) }) };
      }
    },
  });
}
