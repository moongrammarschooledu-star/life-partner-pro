import { prisma } from "@/lib/prisma";
import { calculateAge } from "@/lib/utils";

// spec §16 — "never assume a universal legal marriage age," but also never
// assume a LOWER one when unresolved. Age is inherently a personal
// attribute of the applicant, not a multi-factor business/processing-
// location question, so this looks up the Jurisdiction row for the
// applicant's own country directly (bypassing the full multi-signal
// resolveApplicableJurisdictions() in src/lib/compliance/jurisdiction.ts,
// which exists for business/transfer decisions where "which country" is
// genuinely ambiguous — that's not the case for "what country does this
// applicant say they live in"). A configured jurisdiction can only RAISE the
// floor above the conservative platform default, never lower it silently.
export const DEFAULT_MINIMUM_AGE = 18;

export interface AgeValidationResult {
  allowed: boolean;
  age: number;
  minAge: number;
  jurisdictionResolved: boolean;
}

export async function validateMinimumAge(dateOfBirth: Date | string, applicantCountry: string): Promise<AgeValidationResult> {
  const age = calculateAge(dateOfBirth);
  let minAge = DEFAULT_MINIMUM_AGE;
  let jurisdictionResolved = false;

  const now = new Date();
  const jurisdiction = await prisma.jurisdiction.findFirst({
    where: { countryCode: applicantCountry, status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
  });

  if (jurisdiction) {
    try {
      const config = JSON.parse(jurisdiction.configuration) as { minAge?: number };
      if (typeof config.minAge === "number" && Number.isFinite(config.minAge)) {
        minAge = Math.max(config.minAge, DEFAULT_MINIMUM_AGE);
        jurisdictionResolved = true;
      }
    } catch {
      // Malformed configuration — fall through to the conservative default,
      // never throw and never silently permit a younger applicant.
    }
  }

  return { allowed: age >= minAge, age, minAge, jurisdictionResolved };
}
