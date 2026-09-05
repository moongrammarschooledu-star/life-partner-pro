// Pure field-matching heuristic (spec §12) — the DB-querying wrapper lives
// in src/app/api/admin/verification/duplicate-scan/route.ts. Deliberately
// text/field matching only: no facial recognition, no inferred identity —
// admin-reviewed, never auto-deletes anything.

export interface DuplicateCandidateProfile {
  id: string;
  fullName: string;
  dateOfBirth: string; // ISO date, compared by date-only
  mobileNumber: string;
  email: string;
}

export type DuplicateSignal = "MOBILE" | "EMAIL" | "NAME_AND_DOB";

export interface DuplicateMatch {
  candidateId: string;
  signals: DuplicateSignal[];
}

function normalizePhone(v: string): string {
  return v.replace(/\D/g, "");
}

function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

function normalizeName(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

function sameDate(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

export function findDuplicateSignals(profile: DuplicateCandidateProfile, candidates: DuplicateCandidateProfile[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const candidate of candidates) {
    if (candidate.id === profile.id) continue;
    const signals: DuplicateSignal[] = [];
    if (normalizePhone(candidate.mobileNumber) === normalizePhone(profile.mobileNumber)) signals.push("MOBILE");
    if (normalizeEmail(candidate.email) === normalizeEmail(profile.email)) signals.push("EMAIL");
    if (normalizeName(candidate.fullName) === normalizeName(profile.fullName) && sameDate(candidate.dateOfBirth, profile.dateOfBirth)) {
      signals.push("NAME_AND_DOB");
    }
    if (signals.length > 0) matches.push({ candidateId: candidate.id, signals });
  }
  return matches;
}
