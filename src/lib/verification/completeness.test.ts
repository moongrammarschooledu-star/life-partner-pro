import { describe, it, expect } from "vitest";
import { computeProfileCompleteness, type CompletenessInput } from "./completeness";

function minimalInput(overrides: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    fullName: "Test User",
    gender: "MALE",
    dateOfBirth: new Date("1995-01-01"),
    maritalStatus: "NEVER_MARRIED",
    heightCm: 170,
    city: "Lahore",
    country: "Pakistan",
    nationality: null,
    area: null,
    contact: { mobileNumber: "+923001234567", email: "a@example.com", whatsappNumber: null },
    phoneVerified: false,
    emailVerified: false,
    education: null,
    profession: null,
    family: null,
    lifestyle: null,
    preference: null,
    hasPhoto: false,
    ...overrides,
  };
}

describe("computeProfileCompleteness", () => {
  it("scores a fully-populated profile at 100%", () => {
    const result = computeProfileCompleteness(
      minimalInput({
        nationality: "Pakistani",
        area: "Model Town",
        contact: { mobileNumber: "+923001234567", email: "a@example.com", whatsappNumber: "+923001234567" },
        phoneVerified: true,
        emailVerified: true,
        education: { level: "Masters", degree: "MS", institution: "LUMS" },
        profession: { profession: "Engineer", employmentType: "PRIVATE", monthlyIncome: 2000, jobTitle: "SWE" },
        family: { fatherOccupation: "Business", motherOccupation: "Homemaker", familyType: "NUCLEAR", familyLocation: "Lahore", familyBackground: "Middle class" },
        lifestyle: { religion: "Islam", languages: "Urdu, English", hobbies: "Reading", aboutMe: "About me text" },
        preference: { minAge: 25, maxAge: 35, preferredCity: "Lahore", minEducation: "Bachelors", maritalStatusPreference: "NEVER_MARRIED", minHeightCm: 150, maxHeightCm: 180 },
        hasPhoto: true,
      })
    );
    expect(result.percent).toBe(100);
    expect(result.categories.every((c) => c.missingFields.length === 0)).toBe(true);
  });

  it("scores a bare-minimum profile below 100% and lists missing fields", () => {
    const result = computeProfileCompleteness(minimalInput());
    expect(result.percent).toBeLessThan(100);
    expect(result.categories.find((c) => c.key === "photo")?.missingFields).toContain("Profile photo");
    expect(result.categories.find((c) => c.key === "education")?.earnedWeight).toBe(0);
  });

  it("never exceeds 100 or drops below 0", () => {
    const result = computeProfileCompleteness(minimalInput());
    expect(result.percent).toBeGreaterThanOrEqual(0);
    expect(result.percent).toBeLessThanOrEqual(100);
  });

  it("category weights sum to 100", () => {
    const result = computeProfileCompleteness(minimalInput());
    const totalWeight = result.categories.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBe(100);
  });
});
