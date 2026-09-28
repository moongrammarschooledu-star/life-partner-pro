import { RiskRuleEngine } from "@/lib/risk/rule-engine";
import { runRiskSignalScan } from "@/lib/risk/signal-engine";
import { assessProfile } from "@/lib/risk/assessment-service";

// FraudPreventionService — thin composition facade. Logic lives in the focused
// services it composes (never in route handlers). `evaluateProfile` is only
// ever driven by SERVER-SIDE state (persisted events and records): there is
// deliberately no entry point that accepts client-supplied events or scores.

export async function evaluateProfileSafety(profileId: string) {
  const engine = await RiskRuleEngine.evaluateProfile(profileId);
  const scan = await runRiskSignalScan(profileId);
  const assessed = await assessProfile(profileId);
  return {
    signalsCreated: engine.signalsCreated + scan.signalsCreated,
    assessmentId: assessed.assessment?.id ?? null,
    level: assessed.assessment?.riskLevel ?? null,
    riskCaseId: assessed.riskCaseId,
    caseOpened: assessed.caseOpened,
  };
}

// Used right after account creation: real-time duplicate / rapid-registration detection that can
// never delay or fail the registration itself (time-bounded, errors swallowed).
export async function evaluateNewAccountSafety(profileId: string, timeoutMs = 2500): Promise<void> {
  try {
    await Promise.race([evaluateProfileSafety(profileId), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  } catch (error) {
    console.error("[fraud-prevention] new-account evaluation failed (fail-open)", error instanceof Error ? error.message : "unknown");
  }
}

export const FraudPreventionService = { evaluateProfile: evaluateProfileSafety, evaluateNewAccount: evaluateNewAccountSafety };
