import { prisma } from "@/lib/prisma";
import { computeConfidence, type VerificationConfidenceLevel } from "@/lib/verification/confidence";
import type { SecurityFlagSeverity } from "@prisma/client";

// Explainable Risk Assessment (spec §18) — live-computed, never persisted,
// exactly like computeConfidence()'s VerificationConfidenceLevel. Always a
// band plus the plain-language reasons behind it, never a bare verdict —
// this is what makes it "explainable" rather than a black-box score, and
// per spec §17/§58 the text is always about signals needing review, never an
// accusation ("the user is fraudulent").

export type RiskBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskAssessmentInput {
  openFlagSeverities: SecurityFlagSeverity[];
  openDuplicateReviewCount: number;
  verificationConfidence: VerificationConfidenceLevel;
}

export interface RiskAssessment {
  band: RiskBand;
  explanation: string[];
}

// Pure — unit-testable without touching Prisma.
export function deriveRiskBand(input: RiskAssessmentInput): RiskAssessment {
  const explanation: string[] = [];
  const hasCritical = input.openFlagSeverities.includes("CRITICAL");
  const hasHigh = input.openFlagSeverities.includes("HIGH");
  const mediumCount = input.openFlagSeverities.filter((s) => s === "MEDIUM").length;
  const lowCount = input.openFlagSeverities.filter((s) => s === "LOW").length;

  if (hasCritical) explanation.push("A critical-severity risk signal is open for review.");
  if (hasHigh) explanation.push("A high-severity risk signal is open for review.");
  if (mediumCount > 0) explanation.push(`${mediumCount} medium-severity risk signal(s) open for review.`);
  if (lowCount > 0) explanation.push(`${lowCount} low-severity risk signal(s) open for review.`);
  if (input.openDuplicateReviewCount > 0) explanation.push(`${input.openDuplicateReviewCount} potential duplicate profile relationship(s) awaiting review.`);
  if (input.verificationConfidence === "LOW") explanation.push("Verification confidence is currently low.");

  let band: RiskBand;
  if (hasCritical) band = "CRITICAL";
  else if (hasHigh || input.openDuplicateReviewCount >= 2) band = "HIGH";
  else if (mediumCount > 0 || input.openDuplicateReviewCount === 1 || input.verificationConfidence === "LOW") band = "MEDIUM";
  else band = "LOW";

  if (explanation.length === 0) explanation.push("No open risk signals or reviews.");

  return { band, explanation };
}

export async function computeRiskAssessment(profileId: string): Promise<RiskAssessment> {
  const [openFlags, openDuplicateReviews, verification] = await Promise.all([
    prisma.securityFlag.findMany({ where: { profileId, status: { in: ["OPEN", "INVESTIGATING"] } }, select: { severity: true } }),
    prisma.duplicateCandidate.count({ where: { profileId, status: { in: ["POTENTIAL_DUPLICATE", "DUPLICATE_REVIEW_REQUIRED"] } } }),
    prisma.profileVerification.findUnique({ where: { profileId }, include: { items: true } }),
  ]);

  const confidence = computeConfidence({
    phoneVerified: !!verification?.phoneVerifiedAt,
    emailVerified: !!verification?.emailVerifiedAt,
    checklistCompletionRatio: verification?.items.length ? verification.items.filter((i) => i.status === "COMPLETED").length / verification.items.length : 0,
    adminReviewCompleted: verification?.status === "VERIFIED",
    documentVerificationEnabled: false,
    documentVerificationApproved: false,
    hasOpenHighOrCriticalFlag: openFlags.some((f) => f.severity === "HIGH" || f.severity === "CRITICAL"),
  });

  return deriveRiskBand({
    openFlagSeverities: openFlags.map((f) => f.severity),
    openDuplicateReviewCount: openDuplicateReviews,
    verificationConfidence: confidence,
  });
}
