import type { AiFeature, ConsentCategory, ConsentGrantStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Spec §20 — AI consent. Never silently bypassed.
//
//  • INTERNAL processing (the built-in provider; data never leaves the system)
//    relies on the member's existing matchmaking consent and is refused only if
//    that consent has been withdrawn.
//  • EXTERNAL processing requires an EXPLICIT grant of the relevant AI category
//    made by the member. A grant created by the historical backfill
//    (source = "BACKFILL" — an implicit default, not a member action) does NOT
//    count. Without it the external provider is not used for that profile.

export const EXTERNAL_CONSENT_FOR: Partial<Record<AiFeature, ConsentCategory>> = {
  PROFILE_SUMMARY: "AI_PROFILE_ASSISTANCE",
  DATA_QUALITY: "AI_PROFILE_ASSISTANCE",
  PROFILE_IMPROVEMENT: "AI_PROFILE_ASSISTANCE",
  MATCH_EXPLANATION: "AI_ASSISTED_MATCHING",
  COMPARE: "AI_ASSISTED_MATCHING",
  PROPOSAL_ASSISTANT: "AI_ASSISTED_MATCHING",
  COMMUNICATION_ASSISTANT: "AI_COMMUNICATION_ASSISTANCE",
  FOLLOWUP_ASSISTANT: "AI_COMMUNICATION_ASSISTANCE",
};

export interface GrantLike {
  category: ConsentCategory;
  status: ConsentGrantStatus;
  source: string;
  recordedAt: Date;
}

export function latestGrant(grants: GrantLike[], category: ConsentCategory): GrantLike | null {
  const forCategory = grants.filter((g) => g.category === category).sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  return forCategory[0] ?? null;
}

// Internal processing is allowed unless the member has withdrawn matchmaking
// consent (latest PROFILE_MATCHING grant REVOKED, or the registration consent
// record says no).
export function internalConsentOk(grants: GrantLike[], matchmakingConsent: boolean | null): boolean {
  if (matchmakingConsent === false) return false;
  const g = latestGrant(grants, "PROFILE_MATCHING");
  return !(g && g.status === "REVOKED");
}

export function externalConsentOk(grants: GrantLike[], feature: AiFeature): boolean {
  const category = EXTERNAL_CONSENT_FOR[feature];
  if (!category) return false; // this feature never uses an external provider
  const g = latestGrant(grants, category);
  return !!g && g.status === "GRANTED" && g.source !== "BACKFILL";
}

export interface ConsentDecision {
  internalOk: boolean;
  externalOk: boolean;
  blockedProfileIds: string[]; // internal consent withdrawn
  externalMissingProfileIds: string[];
}

export function decideConsent(params: {
  feature: AiFeature;
  profiles: Array<{ profileId: string; grants: GrantLike[]; matchmakingConsent: boolean | null }>;
}): ConsentDecision {
  const blocked: string[] = [];
  const externalMissing: string[] = [];
  for (const p of params.profiles) {
    if (!internalConsentOk(p.grants, p.matchmakingConsent)) blocked.push(p.profileId);
    if (!externalConsentOk(p.grants, params.feature)) externalMissing.push(p.profileId);
  }
  return {
    internalOk: blocked.length === 0,
    externalOk: params.profiles.length > 0 && externalMissing.length === 0 && blocked.length === 0,
    blockedProfileIds: blocked,
    externalMissingProfileIds: externalMissing,
  };
}

export async function loadConsentDecision(feature: AiFeature, profileIds: string[]): Promise<ConsentDecision> {
  if (profileIds.length === 0) return { internalOk: true, externalOk: false, blockedProfileIds: [], externalMissingProfileIds: [] };
  const [grants, records] = await Promise.all([
    prisma.consentGrant.findMany({
      where: { profileId: { in: profileIds }, category: { in: ["PROFILE_MATCHING", "AI_ASSISTED_MATCHING", "AI_PROFILE_ASSISTANCE", "AI_COMMUNICATION_ASSISTANCE"] } },
      select: { profileId: true, category: true, status: true, source: true, recordedAt: true },
    }),
    prisma.consentRecord.findMany({ where: { profileId: { in: profileIds } }, select: { profileId: true, matchmakingConsent: true } }),
  ]);
  return decideConsent({
    feature,
    profiles: profileIds.map((profileId) => ({
      profileId,
      grants: grants.filter((g) => g.profileId === profileId),
      matchmakingConsent: records.find((r) => r.profileId === profileId)?.matchmakingConsent ?? null,
    })),
  });
}
