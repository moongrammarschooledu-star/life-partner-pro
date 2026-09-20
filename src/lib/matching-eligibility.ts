import type { AccountStatus, Gender, ProfileStatus } from "@prisma/client";

// Hard exclusions that apply to EVERY match path (spec §17/§36): suspended,
// deleted, archived, rejected, married and non-active accounts are never
// matched, no matter how an admin widens the search filters. The automatic
// candidate query already filters these in SQL; this pure check is used for the
// manual "create match" path, which previously re-checked nothing.

export interface EligibilityProfile {
  id: string;
  gender: Gender;
  softDeleted: boolean;
  status: ProfileStatus;
  accountStatus: AccountStatus;
}

const EXCLUDED_STATUSES: ProfileStatus[] = ["ARCHIVED", "REJECTED", "MARRIED", "SUSPENDED"];

export function profileExclusionReason(p: EligibilityProfile): string | null {
  if (p.softDeleted) return "deleted";
  if (EXCLUDED_STATUSES.includes(p.status)) return p.status.toLowerCase();
  if (p.accountStatus !== "ACTIVE") return "not an active account";
  return null;
}

export function pairEligibilityProblem(seeker: EligibilityProfile, candidate: EligibilityProfile): string | null {
  if (seeker.id === candidate.id) return "A profile cannot be matched with itself.";
  if (seeker.gender === candidate.gender) return "Matches must be between opposite genders.";
  const seekerReason = profileExclusionReason(seeker);
  if (seekerReason) return `The seeker profile is ${seekerReason} and cannot be matched.`;
  const candidateReason = profileExclusionReason(candidate);
  if (candidateReason) return `The candidate profile is ${candidateReason} and cannot be matched.`;
  return null;
}
