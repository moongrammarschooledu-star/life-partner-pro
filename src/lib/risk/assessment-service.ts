import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getConfigurationVersion, getEffectiveFactor, getEffectiveRule } from "@/lib/risk/config";
import { OPEN_SIGNAL_STATUSES } from "@/lib/risk/signal-service";
import { LEVEL_ORDER, openRiskCase } from "@/lib/risk/case-service";
import type { RiskAssessment, RiskConfidence, RiskLevel, RiskSignalCategory, SecurityFlagSeverity } from "@prisma/client";

// RiskAssessmentService. An assessment is a persisted, explainable summary of
// the open signals for one profile: which signals, which rules, which versions,
// why the level is what it is. It is NOT a finding about the person — its only
// downstream effect is to request human review (open a RiskCase).

export interface AssessmentSignalInput {
  id: string;
  flagType: string;
  severity: SecurityFlagSeverity;
  confidence: RiskConfidence | null;
  category: RiskSignalCategory | null;
  weight: number;
  immediateControl: boolean;
  factorVersion: number;
}

export interface ScoreBands {
  medium: number;
  high: number;
  critical: number;
}

export interface AssessmentComputation {
  score: number | null;
  level: RiskLevel;
  confidence: RiskConfidence;
  cappedBySingleSignal: boolean;
  topSignals: Array<{ signalId: string; type: string; severity: SecurityFlagSeverity; confidence: RiskConfidence | null; contribution: number }>;
  rulesTriggered: Array<{ ruleKey: string; version: number }>;
  explanation: string[];
}

const CONFIDENCE_MULTIPLIER: Record<RiskConfidence, number> = { EXACT: 1, VERY_HIGH: 0.9, HIGH: 0.8, MEDIUM: 0.6, LOW: 0.4 };
const CONFIDENCE_ORDER: RiskConfidence[] = ["EXACT", "VERY_HIGH", "HIGH", "MEDIUM", "LOW"];
const SEVERITY_LEVEL: Record<SecurityFlagSeverity, RiskLevel> = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "CRITICAL" };
const CONTEXT_ONLY_CATEGORIES: RiskSignalCategory[] = ["DEVICE", "NETWORK"];

export function levelFromScore(score: number, bands: ScoreBands): RiskLevel {
  if (score >= bands.critical) return "CRITICAL";
  if (score >= bands.high) return "HIGH";
  if (score >= bands.medium) return "MEDIUM";
  return "LOW";
}

function capLevel(level: RiskLevel, cap: RiskLevel): RiskLevel {
  return LEVEL_ORDER[level] > LEVEL_ORDER[cap] ? cap : level;
}

// Pure — unit-testable without Prisma. Inputs are already-resolved factors, so
// the result depends only on (signals, bands, scoringEnabled) and is therefore
// reproducible for any historical ruleVersion.
export function computeAssessment(signals: AssessmentSignalInput[], bands: ScoreBands, scoringEnabled = true): AssessmentComputation {
  if (signals.length === 0) {
    return { score: scoringEnabled ? 0 : null, level: "LOW", confidence: "LOW", cappedBySingleSignal: false, topSignals: [], rulesTriggered: [], explanation: ["No open risk signals."] };
  }

  // One contribution per signal TYPE (the strongest instance) so a burst of the
  // same repeated signal cannot inflate the score.
  const byType = new Map<string, { signal: AssessmentSignalInput; contribution: number }>();
  for (const s of signals) {
    const contribution = s.weight * CONFIDENCE_MULTIPLIER[s.confidence ?? "LOW"];
    const current = byType.get(s.flagType);
    if (!current || contribution > current.contribution) byType.set(s.flagType, { signal: s, contribution });
  }
  const ranked = [...byType.values()].sort((a, b) => b.contribution - a.contribution);
  const rawScore = Math.min(100, Math.round(ranked.reduce((sum, r) => sum + r.contribution, 0)));

  let level: RiskLevel;
  if (scoringEnabled) {
    level = levelFromScore(rawScore, bands);
  } else {
    level = ranked.reduce<RiskLevel>((max, r) => (LEVEL_ORDER[SEVERITY_LEVEL[r.signal.severity]] > LEVEL_ORDER[max] ? SEVERITY_LEVEL[r.signal.severity] : max), "LOW");
  }

  const explanation: string[] = [];
  let cappedBySingleSignal = false;

  // No-single-signal rule: one weak signal never raises the level above MEDIUM,
  // unless its factor is explicitly an immediate-control factor.
  const only = ranked.length === 1 ? ranked[0].signal : null;
  if (only && (only.confidence ?? "LOW") === "LOW" && !only.immediateControl && LEVEL_ORDER[level] > LEVEL_ORDER.MEDIUM) {
    level = "MEDIUM";
    cappedBySingleSignal = true;
    explanation.push("Level limited to MEDIUM: a single low-confidence signal is not sufficient on its own.");
  }
  // Device/network context is never the sole basis for a HIGH+ level.
  if (ranked.every((r) => r.signal.category && CONTEXT_ONLY_CATEGORIES.includes(r.signal.category)) && LEVEL_ORDER[level] > LEVEL_ORDER.MEDIUM) {
    level = capLevel(level, "MEDIUM");
    cappedBySingleSignal = true;
    explanation.push("Level limited to MEDIUM: device/network signals are context only and cannot stand alone.");
  }

  for (const r of ranked.slice(0, 5)) {
    explanation.push(`Signal "${r.signal.flagType}" (${r.signal.severity.toLowerCase()} severity, ${(r.signal.confidence ?? "LOW").toLowerCase().replace("_", " ")} confidence) is open for review.`);
  }
  explanation.push("This is a request for human review, not a finding about the person.");

  const strongest = ranked[0].signal.confidence ?? "LOW";
  const confidence = CONFIDENCE_ORDER.find((c) => c === strongest) ?? "LOW";

  return {
    score: scoringEnabled ? rawScore : null,
    level,
    confidence,
    cappedBySingleSignal,
    topSignals: ranked.slice(0, 5).map((r) => ({ signalId: r.signal.id, type: r.signal.flagType, severity: r.signal.severity, confidence: r.signal.confidence, contribution: Math.round(r.contribution) })),
    rulesTriggered: ranked.map((r) => ({ ruleKey: r.signal.flagType, version: r.signal.factorVersion })),
    explanation,
  };
}

export interface AssessProfileResult {
  assessment: RiskAssessment | null;
  unchanged: boolean;
  caseOpened: boolean;
  riskCaseId: string | null;
}

// Persist the current assessment for a profile (idempotent: identical signal
// set + level + score returns the previous row instead of writing a new one)
// and, above the configured level, request human review via a RiskCase.
export async function assessProfile(profileId: string, opts: { actorId?: string | null } = {}): Promise<AssessProfileResult> {
  const [signals, previous] = await Promise.all([
    prisma.securityFlag.findMany({ where: { profileId, status: { in: OPEN_SIGNAL_STATUSES } } }),
    prisma.riskAssessment.findFirst({ where: { subjectProfileId: profileId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (signals.length === 0 && !previous) return { assessment: null, unchanged: true, caseOpened: false, riskCaseId: null };

  const [bandsRule, scoringRule, policyRule, configurationVersion] = await Promise.all([
    getEffectiveRule("score_bands"),
    getEffectiveRule("scoring"),
    getEffectiveRule("case_policy"),
    getConfigurationVersion(),
  ]);
  const bands = bandsRule.config as unknown as ScoreBands;

  const inputs: AssessmentSignalInput[] = [];
  for (const s of signals) {
    const factor = await getEffectiveFactor(s.flagType);
    if (!factor.enabled) continue;
    inputs.push({ id: s.id, flagType: s.flagType, severity: s.severity, confidence: s.confidence, category: s.category, weight: factor.weight, immediateControl: factor.immediateControl, factorVersion: factor.version });
  }
  const computed = computeAssessment(inputs, bands, scoringRule.config.enabled === true);

  const signalIds = inputs.map((i) => i.id).sort();
  if (previous) {
    let prevIds: string[] = [];
    try {
      prevIds = (JSON.parse(previous.evidence) as string[]).slice().sort();
    } catch {
      prevIds = [];
    }
    if (previous.riskLevel === computed.level && previous.score === computed.score && prevIds.join(",") === signalIds.join(",")) {
      return { assessment: previous, unchanged: true, caseOpened: false, riskCaseId: previous.riskCaseId };
    }
  }

  const ruleVersion = Math.max(bandsRule.version, ...inputs.map((i) => i.factorVersion), 0);
  const assessment = await prisma.riskAssessment.create({
    data: {
      subjectProfileId: profileId,
      riskLevel: computed.level,
      score: computed.score,
      topSignals: JSON.stringify(computed.topSignals),
      evidence: JSON.stringify(signalIds),
      rulesTriggered: JSON.stringify(computed.rulesTriggered),
      ruleVersion,
      configurationVersion,
      confidence: computed.confidence,
      cappedBySingleSignal: computed.cappedBySingleSignal,
    },
  });
  await writeAudit({ action: "RISK_ASSESSMENT_RECORDED", adminId: opts.actorId ?? null, targetProfileId: profileId, meta: { assessmentId: assessment.id, level: computed.level, signals: signalIds.length, ruleVersion } });

  let riskCaseId: string | null = previous?.riskCaseId ?? null;
  let caseOpened = false;
  const autoOpenFrom = (policyRule.config.autoOpenFromLevel as number) ?? 3;
  if (LEVEL_ORDER[computed.level] >= autoOpenFrom && inputs.length > 0) {
    const category = inputs.find((i) => i.category)?.category ?? "ACCOUNT";
    const result = await openRiskCase({
      subjectProfileId: profileId,
      category,
      title: `Risk review — ${computed.level.toLowerCase()} level`,
      riskLevel: computed.level,
      openedBy: "assessment",
      signalIds,
    });
    riskCaseId = result.riskCase.id;
    caseOpened = result.created;
    await prisma.riskAssessment.update({ where: { id: assessment.id }, data: { riskCaseId } });
    await prisma.riskCaseEvent.create({
      data: { riskCaseId, eventType: "ASSESSMENT_RECORDED", summary: `Assessment recorded: ${computed.level}${computed.score != null ? ` (score ${computed.score})` : ""}.`, payload: JSON.stringify({ assessmentId: assessment.id, topSignals: computed.topSignals }) },
    });
  }

  return { assessment: { ...assessment, riskCaseId }, unchanged: false, caseOpened, riskCaseId };
}
