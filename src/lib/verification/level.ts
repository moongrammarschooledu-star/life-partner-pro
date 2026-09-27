// Verification Level (spec §3) — computed fresh on every read, never
// persisted, exactly like computeConfidence()'s VerificationConfidenceLevel
// (see confidence.ts). LEVEL 4 ("Enhanced") is reserved: it is only ever
// reachable when a provider is configured and policy explicitly enables it —
// this codebase ships no enhanced-tier capability itself, so factors.enhancedAvailable
// defaults to false everywhere it's called, and the function simply never
// returns 4 in that case (never a false claim of an enhanced check that
// didn't happen).

export type VerificationLevel = 0 | 1 | 2 | 3 | 4;

export interface VerificationLevelFactors {
  phoneVerified: boolean;
  emailVerified: boolean;
  adminReviewCompleted: boolean; // VerificationStatus === VERIFIED
  identityVerified: boolean; // approved VerificationDocument, or a provider result promoted to VERIFIED by an admin
  hasOpenHighOrCriticalFlag: boolean;
  enhancedAvailable: boolean; // policy + provider both explicitly enable an enhanced tier
  enhancedCompleted: boolean;
}

export function computeVerificationLevel(factors: VerificationLevelFactors): VerificationLevel {
  // Mirrors computeConfidence()'s own override — an unresolved serious flag
  // caps the level regardless of what's individually completed, so "Level 3"
  // never coexists with an open high/critical risk signal.
  if (factors.hasOpenHighOrCriticalFlag) {
    return factors.phoneVerified && factors.emailVerified ? 1 : 0;
  }

  if (factors.enhancedAvailable && factors.enhancedCompleted && factors.identityVerified && factors.adminReviewCompleted) {
    return 4;
  }
  if (factors.identityVerified && factors.adminReviewCompleted) {
    return 3;
  }
  if (factors.adminReviewCompleted) {
    return 2;
  }
  if (factors.phoneVerified && factors.emailVerified) {
    return 1;
  }
  return 0;
}
