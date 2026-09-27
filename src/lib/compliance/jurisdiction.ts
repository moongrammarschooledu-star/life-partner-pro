import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { createTask } from "@/lib/workflow/engine";

// Spec §4 — deliberately NOT a lookup by Profile.country alone. Every field
// here is optional because a real operation rarely has all of them (e.g. a
// registration only has applicantCountry; a document-storage decision has
// storageCountry/providerCountry too).
export interface JurisdictionContext {
  applicantCountry?: string;
  applicantRegion?: string;
  businessCountry?: string;
  processingCountry?: string;
  providerCountry?: string;
  storageCountry?: string;
  serviceType?: string;
}

export type JurisdictionBasis = "processingCountry" | "businessCountry" | "storageCountry" | "providerCountry" | "applicantCountry" | "applicantRegion";
export type JurisdictionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ResolvedJurisdictionMatch {
  jurisdictionId: string;
  jurisdictionCode: string;
  name: string;
  basis: JurisdictionBasis;
  confidence: JurisdictionConfidence;
}

export interface JurisdictionResolution {
  matches: ResolvedJurisdictionMatch[];
  // True whenever nothing matched, matches conflict (different jurisdictions
  // at the same confidence tier), or the only match is an applicant-country
  // guess (spec §4's explicit "user country = applicable legal jurisdiction"
  // is never assumed on its own). Never silently resolved to a guess —
  // spec §37, JURISDICTION_UNKNOWN.
  reviewRequired: boolean;
  reason: "RESOLVED" | "NO_MATCH" | "CONFLICTING_MATCHES" | "LOW_CONFIDENCE_ONLY";
}

// Priority order reflects which location is most legally relevant to a data
// activity: where the data is actually PROCESSED/controlled by the business
// outranks where the applicant happens to live (spec §4's own warning).
const BASIS_CONFIDENCE: Record<JurisdictionBasis, JurisdictionConfidence> = {
  processingCountry: "HIGH",
  businessCountry: "HIGH",
  storageCountry: "MEDIUM",
  providerCountry: "MEDIUM",
  applicantRegion: "LOW",
  applicantCountry: "LOW",
};

export async function resolveApplicableJurisdictions(context: JurisdictionContext): Promise<JurisdictionResolution> {
  const now = new Date();
  const jurisdictions = await prisma.jurisdiction.findMany({
    where: { status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
  });

  const matches: ResolvedJurisdictionMatch[] = [];
  const bases: [JurisdictionBasis, string | undefined][] = [
    ["processingCountry", context.processingCountry],
    ["businessCountry", context.businessCountry],
    ["storageCountry", context.storageCountry],
    ["providerCountry", context.providerCountry],
    ["applicantCountry", context.applicantCountry],
    ["applicantRegion", context.applicantRegion],
  ];

  for (const j of jurisdictions) {
    for (const [basis, value] of bases) {
      if (!value) continue;
      const matchesCode = basis === "applicantRegion" ? j.regionCode === value : j.countryCode === value;
      if (matchesCode) {
        matches.push({ jurisdictionId: j.id, jurisdictionCode: j.jurisdictionCode, name: j.name, basis, confidence: BASIS_CONFIDENCE[basis] });
        break; // one match per jurisdiction, on its strongest applicable basis
      }
    }
  }

  if (matches.length === 0) {
    return { matches: [], reviewRequired: true, reason: "NO_MATCH" };
  }

  const highOrMedium = matches.filter((m) => m.confidence !== "LOW");
  if (highOrMedium.length === 0) {
    // Only applicant-country/region-based matches — never treated as final.
    return { matches, reviewRequired: true, reason: "LOW_CONFIDENCE_ONLY" };
  }

  const distinctJurisdictions = new Set(highOrMedium.map((m) => m.jurisdictionId));
  if (distinctJurisdictions.size > 1) {
    return { matches: highOrMedium, reviewRequired: true, reason: "CONFLICTING_MATCHES" };
  }

  return { matches: highOrMedium, reviewRequired: false, reason: "RESOLVED" };
}

// ---------- CRUD (admin-managed; jurisdictionCode is admin-chosen, e.g.
// "PK"/"US-CA"/"EU" — never auto-generated, since it's the human-facing key
// every ComplianceRule/rule lookup references) ----------

export interface CreateJurisdictionInput {
  jurisdictionCode: string;
  countryCode: string;
  regionCode?: string;
  name: string;
  effectiveFrom?: Date;
  effectiveTo?: Date;
  configuration?: unknown;
}

export async function createJurisdiction(input: CreateJurisdictionInput, actorId: string) {
  const jurisdiction = await prisma.jurisdiction.create({
    data: {
      jurisdictionCode: input.jurisdictionCode,
      countryCode: input.countryCode,
      regionCode: input.regionCode ?? null,
      name: input.name,
      status: "DRAFT",
      effectiveFrom: input.effectiveFrom ?? new Date(),
      effectiveTo: input.effectiveTo ?? null,
      configuration: JSON.stringify(input.configuration ?? {}),
    },
  });

  await writeAudit({ action: "JURISDICTION_CREATED", adminId: actorId, meta: { jurisdictionId: jurisdiction.id, jurisdictionCode: jurisdiction.jurisdictionCode } });
  // A new jurisdiction always starts DRAFT — flag it for review before an
  // admin considers setting it ACTIVE.
  await createTask({ taskType: "JURISDICTION_REVIEW", resourceType: "CASE", resourceId: jurisdiction.id });
  return jurisdiction;
}

export async function updateJurisdiction(
  jurisdictionId: string,
  patch: Partial<Omit<CreateJurisdictionInput, "jurisdictionCode">> & { status?: "ACTIVE" | "INACTIVE" | "DRAFT" },
  actorId: string
) {
  const jurisdiction = await prisma.jurisdiction.update({
    where: { id: jurisdictionId },
    data: {
      ...(patch.countryCode !== undefined && { countryCode: patch.countryCode }),
      ...(patch.regionCode !== undefined && { regionCode: patch.regionCode }),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.effectiveFrom !== undefined && { effectiveFrom: patch.effectiveFrom }),
      ...(patch.effectiveTo !== undefined && { effectiveTo: patch.effectiveTo }),
      ...(patch.configuration !== undefined && { configuration: JSON.stringify(patch.configuration) }),
    },
  });

  await writeAudit({ action: "JURISDICTION_UPDATED", adminId: actorId, meta: { jurisdictionId, status: jurisdiction.status } });
  return jurisdiction;
}

export async function listJurisdictions() {
  return prisma.jurisdiction.findMany({ orderBy: { jurisdictionCode: "asc" } });
}

export async function getJurisdiction(jurisdictionId: string) {
  return prisma.jurisdiction.findUnique({ where: { id: jurisdictionId } });
}
