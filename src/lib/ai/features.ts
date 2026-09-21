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
  const fu = await prisma.followUp.findUnique({ where: { id: input.followUpId }, select: { id: true, adminId: true, profileId: true, purpose: true, status: true, dueDate: true, priority: true, proposal: { select: { status: true } } } });
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
        { profileCode: ctx.loaded[0].view.profileCode, purpose: fu.purpose, status: fu.status, dueDate: fu.dueDate, priority: fu.priority, proposalStatus: fu.proposal?.status ?? null, now: new Date() },
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
