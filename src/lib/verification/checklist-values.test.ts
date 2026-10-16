import { describe, it, expect } from "vitest";
import { CHECKLIST_KEYS } from "@/lib/verification/checklist-catalog";
import type { ProfileDetailView } from "@/lib/profile-pdf";
import { checklistValues, type ChecklistValueContext } from "./checklist-values";

const person = {
  fullName: "Test Person",
  gender: "FEMALE",
  dateOfBirth: new Date("1998-06-15T00:00:00Z"),
  age: 28,
  maritalStatus: "NEVER_MARRIED",
  hasChildren: null,
  numberOfChildren: null,
  heightCm: 160,
  city: "Lahore",
  area: "Model Town",
  country: "Pakistan",
  nationality: "Pakistani",
  education: { level: "Masters", degree: "MBA", institution: "LUMS" },
  profession: { profession: "Teacher", employmentType: "PRIVATE", jobTitle: "Senior Teacher", companyName: "City School", workLocation: "Lahore", businessDetails: null, monthlyIncome: 90000, annualIncome: null },
  family: { fatherOccupation: "Retired", motherOccupation: "Housewife", numberOfBrothers: 1, numberOfSisters: 2, familyType: "NUCLEAR", familyStatus: "MIDDLE_CLASS", familyLocation: "Lahore", familyBackground: null, additionalInfo: null },
  lifestyle: { religion: "Islam", sect: "Sunni", religiousPractice: null, languages: "Urdu", smoking: false, drinking: false, hobbies: null, personality: null, aboutMe: null },
  preference: { minAge: 28, maxAge: 35, preferredCountry: "Pakistan", preferredCity: "Lahore", minEducation: "Bachelors", professionPreference: "ANY", maritalStatusPreference: "NEVER_MARRIED" },
} as unknown as ProfileDetailView;

const ctx: ChecklistValueContext = { phoneVerifiedAt: null, emailVerifiedAt: null, whatsappVerifiedAt: null, hasWhatsapp: false, hasEmail: true, photoCount: 1 };

describe("checklist values shown to the reviewer", () => {
  it("has something to show for every checklist item", () => {
    const values = checklistValues(person, ctx);
    for (const key of CHECKLIST_KEYS) expect(values[key], key).toBeTruthy();
  });

  it("shows what the person entered", () => {
    const v = checklistValues(person, ctx);
    expect(v.name_reviewed).toBe("Test Person");
    expect(v.dob_reviewed).toBe("15 Jun 1998 (28 years)");
    expect(v.gender_confirmed).toBe("Female");
    expect(v.city_area_reviewed).toBe("Lahore, Model Town, Pakistan");
    expect(v.education_reviewed).toBe("Level: Masters\nDegree: MBA\nInstitution: LUMS");
    expect(v.employment_reviewed).toContain("Monthly income: 90000");
    expect(v.family_reviewed).toContain("Brothers / sisters: 1 / 2");
    expect(v.partner_requirements_reviewed).toContain("Age: 28 to 35 years");
  });

  it("says whether the person confirmed each contact item, without showing any number or address", () => {
    const v = checklistValues(person, { ...ctx, phoneVerifiedAt: new Date("2026-10-10T00:00:00Z") });
    expect(v.mobile_verified).toBe("The person confirmed the mobile number on 10 Oct 2026.");
    expect(v.email_verified).toBe("The person has not confirmed the e-mail address yet.");
    expect(v.whatsapp_verified).toContain("No separate WhatsApp number");
    expect(checklistValues(person, { ...ctx, hasEmail: false }).email_verified).toContain("No e-mail address was given");
    expect(JSON.stringify(v)).not.toMatch(/\d{10,}|@/);
  });

  it("hides family details from an admin who may not see them, and income when it was removed", () => {
    const limited = { ...person, family: null, profession: { ...(person.profession as object), monthlyIncome: null } } as unknown as ProfileDetailView;
    const v = checklistValues(limited, ctx);
    expect(v.family_reviewed).toContain("Hidden");
    expect(v.employment_reviewed).not.toContain("income");
  });

  it("describes the photo items", () => {
    expect(checklistValues(person, { ...ctx, photoCount: 0 }).photo_uploaded).toBe("No photo has been uploaded.");
    expect(checklistValues(person, { ...ctx, photoCount: 2 }).photo_uploaded).toBe("2 photos uploaded.");
  });
});
