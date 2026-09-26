import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RegistrationInput } from "@/lib/validation/registration";

interface FakeProfile { id: string; profileCode: string; [key: string]: unknown }

let profiles: FakeProfile[];
let contacts: { mobileNumber: string; email: string; profile: { status: string; softDeleted: boolean } }[];
let auditCalls: Record<string, unknown>[];
let notifyRegisteredCalls: string[];
let notifySubmittedCalls: string[];
let idCounter = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({
  notifyProfileRegistered: vi.fn(async (id: string) => { notifyRegisteredCalls.push(id); }),
  notifyProfileSubmitted: vi.fn(async (id: string) => { notifySubmittedCalls.push(id); }),
}));
vi.mock("@/lib/profile-code", () => ({ nextProfileCode: vi.fn(async () => "LPP-000001") }));
vi.mock("@/lib/verification/checklist-catalog", () => ({ CHECKLIST_KEYS: ["PHOTO", "EDUCATION"] }));
vi.mock("@/lib/verification/completeness", () => ({ computeProfileCompleteness: vi.fn(() => ({ percent: 42 })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contactInfo: {
      findFirst: vi.fn(async ({ where }: { where: { OR: { mobileNumber?: string; email?: { equals: string } }[] } }) => {
        const [byPhone, byEmail] = where.OR;
        return (
          contacts.find(
            (c) => c.mobileNumber === byPhone.mobileNumber || c.email.toLowerCase() === byEmail.email?.equals.toLowerCase()
          ) ?? null
        );
      }),
    },
    profile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const profile: FakeProfile = { id: `p${++idCounter}`, profileCode: data.profileCode as string, ...data };
        profiles.push(profile);
        return profile;
      }),
    },
    profileVerification: {
      create: vi.fn(async () => ({})),
    },
  },
}));

const { createProfileFromRegistration, ProfileCreationError } = await import("./profile-creation");

function buildInput(overrides?: Partial<RegistrationInput>): RegistrationInput {
  return {
    hp: "",
    basic: {
      fullName: "Ayesha Siddiqui",
      gender: "FEMALE",
      dateOfBirth: "1995-05-01",
      maritalStatus: "NEVER_MARRIED",
      hasChildren: null,
      numberOfChildren: undefined,
      heightCm: 165,
      city: "Lahore",
      area: "",
      country: "Pakistan",
      nationality: "",
    },
    contact: {
      mobileNumber: "+923001234567",
      whatsappNumber: "",
      email: "ayesha@example.com",
      preferredContactMethod: "WHATSAPP",
    },
    educationProfession: {
      educationLevel: "Bachelors",
      degree: "",
      institution: "",
      profession: "Software Engineer",
      jobTitle: "",
      companyName: "",
      employmentType: "PRIVATE",
      monthlyIncome: undefined,
      annualIncome: undefined,
      workLocation: "",
      businessDetails: "",
      program: "",
      expectedGraduation: "",
    },
    family: {
      fatherOccupation: "",
      motherOccupation: "",
      numberOfBrothers: 0,
      numberOfSisters: 0,
      familyType: "NUCLEAR",
      familyStatus: "MIDDLE_CLASS",
      familyLocation: "",
      familyBackground: "",
      additionalInfo: "",
    },
    lifestyle: {
      religion: "",
      sect: "",
      religiousPractice: "",
      languages: "",
      smoking: false,
      drinking: false,
      hobbies: "",
      personality: "",
      aboutMe: "",
      otherPreferences: "",
    },
    preference: {
      minAge: undefined,
      maxAge: undefined,
      agePriority: "PREFERRED",
      preferredCountry: "",
      preferredCity: "",
      preferredArea: "",
      locationScope: "",
      locationPriority: "PREFERRED",
      minEducation: "",
      preferredEducation: "",
      professionPreference: "ANY",
      professionPriority: "PREFERRED",
      minIncome: undefined,
      maxIncome: undefined,
      incomeFlexible: true,
      maritalStatusPreference: "ANY",
      minHeightCm: undefined,
      maxHeightCm: undefined,
      familyTypePreference: "ANY",
      familyBackgroundPreference: "ANY",
      otherFamilyRequirements: "",
      additionalExpectations: "",
    },
    consent: { accurate: true, storageConsent: true, reviewConsent: true, contactConsent: false },
    ...overrides,
  };
}

beforeEach(() => {
  profiles = [];
  contacts = [];
  auditCalls = [];
  notifyRegisteredCalls = [];
  notifySubmittedCalls = [];
});

describe("createProfileFromRegistration", () => {
  it("creates a profile, verification record, audits and notifies", async () => {
    const { profile, profileCode } = await createProfileFromRegistration(buildInput(), null, { ipHashSource: "1.2.3.4" });
    expect(profileCode).toBe("LPP-000001");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].fullName).toBe("Ayesha Siddiqui");
    expect(profile.id).toBe(profiles[0].id);
    expect(auditCalls[0]).toMatchObject({ action: "PROFILE_CREATED", targetProfileId: profile.id, adminId: undefined });
    expect(notifyRegisteredCalls).toEqual([profile.id]);
    expect(notifySubmittedCalls).toEqual([profile.id]);
  });

  it("attributes the audit row to the admin when created from the admin route", async () => {
    const { profile } = await createProfileFromRegistration(buildInput(), null, { adminId: "admin1", ipHashSource: "admin:admin1" });
    expect(auditCalls[0]).toMatchObject({ action: "PROFILE_CREATED", targetProfileId: profile.id, adminId: "admin1" });
  });

  it("rejects a duplicate mobile number belonging to an active profile", async () => {
    contacts.push({ mobileNumber: "+923001234567", email: "someone-else@example.com", profile: { status: "NEW", softDeleted: false } });
    await expect(createProfileFromRegistration(buildInput(), null, { ipHashSource: "x" })).rejects.toThrow(ProfileCreationError);
    expect(profiles).toHaveLength(0);
  });

  it("allows re-registration when the matching contact belongs to an archived profile", async () => {
    contacts.push({ mobileNumber: "+923001234567", email: "someone-else@example.com", profile: { status: "ARCHIVED", softDeleted: false } });
    const { profile } = await createProfileFromRegistration(buildInput(), null, { ipHashSource: "x" });
    expect(profiles).toHaveLength(1);
    expect(profile).toBeDefined();
  });
});
