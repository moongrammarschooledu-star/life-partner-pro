// Internal Verification Confidence rating (spec §11) — explicitly NOT a
// compatibility score and NEVER a claim of absolute authenticity. Shown to
// admins only, as "High / Medium / Low", never to applicants.

export interface ConfidenceFactors {
  phoneVerified: boolean;
  emailVerified: boolean;
  checklistCompletionRatio: number; // 0..1, completed / applicable items
  adminReviewCompleted: boolean; // VerificationStatus === VERIFIED
  documentVerificationEnabled: boolean;
  documentVerificationApproved: boolean; // meaningless if not enabled
  hasOpenHighOrCriticalFlag: boolean;
}

export type VerificationConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export function computeConfidence(factors: ConfidenceFactors): VerificationConfidenceLevel {
  // An unresolved serious flag overrides every other signal — a "verified"
  // profile with an active high/critical fraud flag is not a confident one.
  if (factors.hasOpenHighOrCriticalFlag) return "LOW";

  let earned = 0;
  let applicable = 0;

  applicable += 1;
  if (factors.phoneVerified) earned += 1;

  applicable += 1;
  if (factors.emailVerified) earned += 1;

  applicable += 1;
  earned += Math.max(0, Math.min(1, factors.checklistCompletionRatio));

  applicable += 1;
  if (factors.adminReviewCompleted) earned += 1;

  if (factors.documentVerificationEnabled) {
    applicable += 1;
    if (factors.documentVerificationApproved) earned += 1;
  }

  const ratio = applicable > 0 ? earned / applicable : 0;
  if (ratio >= 0.8) return "HIGH";
  if (ratio >= 0.5) return "MEDIUM";
  return "LOW";
}
