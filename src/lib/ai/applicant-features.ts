import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateAge } from "@/lib/utils";
import { catalogEntry } from "@/lib/verification/checklist-catalog";
import { matchableInclude } from "@/lib/match-adapter";
import { randomUUID } from "crypto";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { getAiConfig } from "@/lib/ai/config";
import { loadConsentDecision } from "@/lib/ai/consent";
import { detectFindings, improvementSuggestions, sufficiencyOf } from "@/lib/ai/analysis/quality";
import { STANDARD_LIMITATIONS } from "@/lib/ai/analysis/summary";
import { applySafetyRules } from "@/lib/ai/safety";
import { AI_VERSION } from "@/lib/ai/versions";
import type { AiProfileView } from "@/lib/ai/profile-view";
import type { AiFailureCode, AiOutcome, AiPayload } from "@/lib/ai/types";

// STEP 21 Decision 8 — the applicant-facing AI surface is deliberately a
// separate, minimal, rule-based-only path. It does NOT go through
// src/lib/ai/pipeline.ts (typed end-to-end around SessionAdmin, with
// admin-role rollout gating and cross-profile assignment checks that have no
// applicant-shaped equivalent) — retrofitting an applicant actor into that
// pipeline would risk weakening admin-side authorization assumptions locked
// down by 5+ prior STEPs. This module never imports @/lib/ai/pipeline.ts,
// @/lib/ai/load.ts, or @/lib/route-guard (all of which are admin-typed and,
// for load.ts/route-guard.ts, transitively pull in the NextAuth/next/server
// chain that breaks lightweight module resolution in tests).

const include = { ...matchableInclude, verification: { include: { items: true } } } satisfies Prisma.ProfileInclude;
type ProfileRecord = Prisma.ProfileGetPayload<{ include: typeof include }>;

// A trimmed, self-only rebuild of src/lib/ai/load.ts's buildView() — income
// and family details are always visible here (unlike the admin version,
// which gates them on a permission), because the viewer IS the data owner.
function buildOwnView(p: ProfileRecord): AiProfileView {
  const pref = p.preference;
  const dobOk = !Number.isNaN(p.dateOfBirth.getTime()) && p.dateOfBirth <= new Date();
  const verification = p.verification
    ? {
        status: p.verification.status,
        phoneVerified: !!p.verification.phoneVerifiedAt,
        emailVerified: !!p.verification.emailVerifiedAt,
        approvedChecklistItems: p.verification.items.filter((i) => i.status === "COMPLETED").map((i) => catalogEntry(i.itemKey)?.label ?? i.itemKey),
      }
    : null;

  return {
    profileId: p.id,
    profileCode: p.profileCode,
    ref: "Your profile",
    status: p.status,
    gender: p.gender,
    age: dobOk ? calculateAge(p.dateOfBirth) : 0,
    dateOfBirthValid: dobOk,
    heightCm: p.heightCm ?? null,
    maritalStatus: p.maritalStatus,
    hasChildren: p.hasChildren ?? null,
    numberOfChildren: p.numberOfChildren ?? null,
    city: p.city,
    area: p.area ?? null,
    country: p.country,
    nationality: p.nationality ?? null,
    educationLevel: p.education?.level ?? null,
    degree: p.education?.degree ?? null,
    institution: p.education?.institution ?? null,
    profession: p.profession?.profession ?? null,
    employmentType: p.profession?.employmentType ?? null,
    jobTitle: p.profession?.jobTitle ?? null,
    companyName: p.profession?.companyName ?? null,
    workLocation: p.profession?.workLocation ?? null,
    monthlyIncome: p.profession?.monthlyIncome ?? null,
    familyType: p.family?.familyType ?? null,
    familyStatus: p.family?.familyStatus ?? null,
    numberOfBrothers: p.family?.numberOfBrothers ?? null,
    numberOfSisters: p.family?.numberOfSisters ?? null,
    fatherOccupation: p.family?.fatherOccupation ?? null,
    motherOccupation: p.family?.motherOccupation ?? null,
    familyLocation: p.family?.familyLocation ?? null,
    familyBackground: p.family?.familyBackground ?? null,
    religion: p.lifestyle?.religion ?? null,
    sect: p.lifestyle?.sect ?? null,
    religiousPractice: p.lifestyle?.religiousPractice ?? null,
    languages: p.lifestyle?.languages ?? null,
    smoking: p.lifestyle?.smoking ?? null,
    drinking: p.lifestyle?.drinking ?? null,
    hobbies: p.lifestyle?.hobbies ?? null,
    personality: p.lifestyle?.personality ?? null,
    aboutMe: p.lifestyle?.aboutMe ?? null,
    preference: {
      minAge: pref?.minAge ?? null,
      maxAge: pref?.maxAge ?? null,
      preferredCountry: pref?.preferredCountry ?? null,
      preferredCity: pref?.preferredCity ?? null,
      preferredArea: pref?.preferredArea ?? null,
      minEducation: pref?.minEducation ?? null,
      preferredEducation: pref?.preferredEducation ?? null,
      professionPreference: pref?.professionPreference ?? null,
      minIncome: pref?.minIncome ?? null,
      maxIncome: pref?.maxIncome ?? null,
      incomeFlexible: pref?.incomeFlexible ?? null,
      maritalStatusPreference: pref?.maritalStatusPreference ?? null,
      minHeightCm: pref?.minHeightCm ?? null,
      maxHeightCm: pref?.maxHeightCm ?? null,
      familyTypePreference: pref?.familyTypePreference ?? null,
      familyBackgroundPreference: pref?.familyBackgroundPreference ?? null,
      locationScope: pref?.locationScope ?? null,
      additionalExpectations: pref?.additionalExpectations ?? null,
    },
    hasPreference: !!pref,
    hasEducationRecord: !!p.education,
    hasProfessionRecord: !!p.profession,
    hasFamilyRecord: !!p.family,
    hasLifestyleRecord: !!p.lifestyle,
    verification,
    completenessPercent: p.profileCompletion,
    updatedAt: p.updatedAt.toISOString(),
    hidden: { income: false, familyDetails: false },
  };
}

const denied = (status: number, code: AiFailureCode, message: string): AiOutcome => ({ ok: false, status, code, message });

// The one applicant-facing AI feature for STEP 21 — reuses the exact
// pure, rule-based analysis functions the admin PROFILE_IMPROVEMENT feature
// already uses (src/lib/ai/analysis/quality.ts), run against the caller's
// own profile only. Never calls an external provider, so only internal
// (matchmaking) consent is required — the same rule the admin-side
// rule-based features already follow.
export async function runApplicantProfileImprovement(profileId: string): Promise<AiOutcome> {
  const config = await getAiConfig();
  if (config.killSwitchActive) return denied(503, "DISABLED", "AI assistance is temporarily unavailable.");
  if (config.phase === "DISABLED") return denied(503, "DISABLED", "AI assistance is not currently enabled.");
  if (config.provider === "DISABLED") return denied(503, "DISABLED", "AI assistance is not currently enabled.");

  if (!rateLimit(`ai-applicant-profile-improvement:${profileId}`, 10, 60 * 60 * 1000)) {
    return denied(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }

  const consent = await loadConsentDecision("PROFILE_IMPROVEMENT", [profileId]);
  if (!consent.internalOk) {
    return denied(403, "CONSENT_REQUIRED", "AI-assisted suggestions require matchmaking consent, which is currently withdrawn.");
  }

  const p = await prisma.profile.findUnique({ where: { id: profileId }, include });
  if (!p || p.softDeleted) return denied(404, "UNAVAILABLE", "Profile not found.");

  const view = buildOwnView(p);
  const findings = detectFindings(view);
  const suggestions = improvementSuggestions(view);
  const by = (l: string) => findings.filter((f) => f.label === l);

  const payload: AiPayload = {
    summary:
      findings.length === 0
        ? "No profile-improvement suggestions right now — your profile looks complete."
        : `${findings.length} area(s) could be improved — ${by("MISSING").length} missing, ${by("NEEDS_VERIFICATION").length + by("USER_CONFIRMATION_REQUIRED").length} to verify or confirm.`,
    evidence: [],
    alignedAreas: [],
    potentialConflicts: by("INCONSISTENT").map((f) => f.message),
    missingInformation: by("MISSING").map((f) => f.message),
    verificationQuestions: [...by("NEEDS_VERIFICATION"), ...by("USER_CONFIRMATION_REQUIRED")].map((f) => f.message),
    suggestedNextStep: suggestions[0] ?? (findings.length ? "Review the suggestions below." : null),
    limitations: [...STANDARD_LIMITATIONS, "These are automated, rule-based suggestions for your own profile only — never a compatibility score or a guarantee of match success."],
    sufficiency: sufficiencyOf(view, findings),
    findings,
    data: { suggestions },
  };

  const safety = applySafetyRules(payload);
  if (safety.blocked || !safety.payload) {
    return denied(422, "SAFETY_BLOCKED", "This suggestion could not be shown due to a content-safety rule.");
  }

  await writeAudit({ action: "AI_APPLICANT_FEATURE_USED", adminId: null, targetProfileId: profileId, meta: { feature: "PROFILE_IMPROVEMENT" } });

  return {
    ok: true,
    payload: safety.payload,
    labels: {
      generatedByAi: true,
      source: "Life Partner Pro database",
      generatedAt: new Date().toISOString(),
      aiVersion: AI_VERSION,
      promptVersion: "n/a",
      provider: "RULES",
      model: "lpp-rules-v1",
      matchAlgorithmVersion: "n/a",
    },
    requestId: randomUUID(),
    fromCache: false,
    notices: [],
  };
}
