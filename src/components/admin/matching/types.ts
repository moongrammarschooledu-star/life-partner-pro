import type { CategoryResult, MatchResult } from "@/lib/matching";

export interface MatchCandidateProfile {
  id: string;
  profileCode: string;
  fullName: string;
  age: number;
  city: string;
  area: string | null;
  country: string;
  education: string | null;
  profession: string | null;
  status: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  profileCompletion: number;
}

export interface MatchCandidate extends MatchResult {
  profile: MatchCandidateProfile;
}

export type { CategoryResult };
