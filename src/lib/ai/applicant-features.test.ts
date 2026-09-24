import { describe, it, expect, vi, beforeEach } from "vitest";

let profileRow: Record<string, unknown> | null;
let aiConfig: { killSwitchActive: boolean; phase: string; provider: string };
let consentDecision: { internalOk: boolean; externalOk: boolean; blockedProfileIds: string[]; externalMissingProfileIds: string[] };
let auditCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/ai/config", () => ({ getAiConfig: vi.fn(async () => aiConfig) }));
vi.mock("@/lib/ai/consent", () => ({ loadConsentDecision: vi.fn(async () => consentDecision) }));
vi.mock("@/lib/prisma", () => ({ prisma: { profile: { findUnique: vi.fn(async () => profileRow) } } }));

const { runApplicantProfileImprovement } = await import("./applicant-features");

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    profileCode: "LPP-000001",
    softDeleted: false,
    status: "ACTIVE",
    gender: "FEMALE",
    dateOfBirth: new Date("1998-01-01"),
    heightCm: 165,
    maritalStatus: "NEVER_MARRIED",
    hasChildren: null,
    numberOfChildren: null,
    city: "Lahore",
    area: null,
    country: "Pakistan",
    nationality: null,
    education: { level: "Masters", degree: "MSc CS", institution: "X" },
    profession: { profession: "Engineer", employmentType: "PRIVATE", jobTitle: "SWE", companyName: "Y", monthlyIncome: 100000, workLocation: null },
    family: { fatherOccupation: "Business", motherOccupation: null, familyType: "NUCLEAR", familyStatus: "MIDDLE_CLASS", familyLocation: null, familyBackground: null, numberOfBrothers: 1, numberOfSisters: 1 },
    lifestyle: { religion: "Islam", sect: null, religiousPractice: null, languages: "English, Urdu", smoking: false, drinking: false, hobbies: "Reading", personality: null, aboutMe: null },
    preference: { minAge: 25, maxAge: 32, preferredCountry: "Pakistan", preferredCity: null, preferredArea: null, minEducation: "Bachelors", preferredEducation: null, professionPreference: "ANY", minIncome: null, maxIncome: null, incomeFlexible: true, maritalStatusPreference: "ANY", minHeightCm: null, maxHeightCm: null, familyTypePreference: null, familyBackgroundPreference: null, locationScope: null, additionalExpectations: "Looking for a kind and understanding partner" },
    verification: { status: "VERIFIED", phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), items: [] },
    profileCompletion: 90,
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  aiConfig = { killSwitchActive: false, phase: "PRODUCTION", provider: "RULES" };
  consentDecision = { internalOk: true, externalOk: false, blockedProfileIds: [], externalMissingProfileIds: [] };
  profileRow = baseProfile();
  auditCalls = [];
});

describe("runApplicantProfileImprovement", () => {
  it("denies when the AI kill switch is active", async () => {
    aiConfig.killSwitchActive = true;
    const outcome = await runApplicantProfileImprovement("p1");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("DISABLED");
  });

  it("denies when the phase is DISABLED", async () => {
    aiConfig.phase = "DISABLED";
    const outcome = await runApplicantProfileImprovement("p1");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("DISABLED");
  });

  it("denies with CONSENT_REQUIRED when internal (matchmaking) consent is withdrawn", async () => {
    consentDecision.internalOk = false;
    const outcome = await runApplicantProfileImprovement("p1");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("CONSENT_REQUIRED");
  });

  it("does NOT require external AI consent (rule-based only, no external provider)", async () => {
    consentDecision.internalOk = true;
    consentDecision.externalOk = false; // explicitly not granted
    const outcome = await runApplicantProfileImprovement("p1");
    expect(outcome.ok).toBe(true);
  });

  it("returns a safety-filtered payload with findings/suggestions for the caller's own profile only", async () => {
    profileRow = baseProfile({ education: null }); // trigger a MISSING finding
    const outcome = await runApplicantProfileImprovement("p1");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.payload.missingInformation.length).toBeGreaterThan(0);
      expect(outcome.payload.data?.suggestions).toBeDefined();
      expect(auditCalls[0]).toMatchObject({ action: "AI_APPLICANT_FEATURE_USED", adminId: null, targetProfileId: "p1" });
    }
  });

  it("never mentions a compatibility score or match verdict (this feature is self-profile only)", async () => {
    const outcome = await runApplicantProfileImprovement("p1");
    if (outcome.ok) {
      const text = JSON.stringify(outcome.payload).toLowerCase();
      expect(text).not.toContain("perfect match");
      expect(text).not.toContain("guaranteed marriage");
    }
  });

  it("returns UNAVAILABLE for a nonexistent/deleted profile", async () => {
    profileRow = null;
    const outcome = await runApplicantProfileImprovement("gone");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("UNAVAILABLE");
  });
});
