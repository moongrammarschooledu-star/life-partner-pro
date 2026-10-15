import { describe, it, expect } from "vitest";
import {
  basicInfoSchema,
  contactInfoSchema,
  educationProfessionSchema,
  lifestyleSchema,
  partnerPreferenceSchema,
  registrationLifestyleSchema,
  registrationPreferenceSchema,
} from "./registration";

// The registration form asks for the essentials compulsorily (what matching is built on), leaves the rest optional, and says what is wrong in plain words.

const messages = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("plain-language messages on an empty form", () => {
  it("basic information never shows a technical message", () => {
    const m = messages(basicInfoSchema.safeParse({ fullName: "", gender: "", dateOfBirth: "", maritalStatus: "", heightCm: "", city: "", country: "" }));
    expect(m.fullName).toBe("Please enter your full name.");
    expect(m.gender).toBe("Please select your gender.");
    expect(m.maritalStatus).toBe("Please select your marital status.");
    expect(m.heightCm).toBe("Please select your height.");
    expect(m.city).toBe("Please select your city.");
    expect(m.country).toBe("Please select your country.");
    for (const text of Object.values(m)) expect(text).not.toMatch(/Invalid option|expected|Too small/i);
  });

  it("education and profession", () => {
    const m = messages(educationProfessionSchema.safeParse({ educationLevel: "", profession: "", employmentType: "" }));
    expect(m.educationLevel).toBe("Please select your education level.");
    expect(m.profession).toBe("Please enter your profession.");
    expect(m.employmentType).toBe("Please select your employment type.");
  });
});

describe("compulsory for a new registration, optional for the admin edit form", () => {
  it("religion is required, and for Islam the sect is too", () => {
    expect(messages(registrationLifestyleSchema.safeParse({ religion: "" })).religion).toBe("Please select your religion.");
    expect(messages(registrationLifestyleSchema.safeParse({ religion: "Islam", sect: "" })).sect).toBe("Please select your sect.");
    expect(registrationLifestyleSchema.safeParse({ religion: "Islam", sect: "Sunni" }).success).toBe(true);
    expect(registrationLifestyleSchema.safeParse({ religion: "Christianity" }).success).toBe(true); // no sect list for other religions
    expect(lifestyleSchema.safeParse({}).success).toBe(true); // the admin edit form is unchanged
  });

  it("the partner's age range and country are required, and the range must make sense", () => {
    const empty = messages(registrationPreferenceSchema.safeParse({ minAge: "", maxAge: "", preferredCountry: "" }));
    expect(empty.minAge).toBe("Please enter the youngest age you would accept.");
    expect(empty.maxAge).toBe("Please enter the oldest age you would accept.");
    expect(empty.preferredCountry).toBe("Please select the country you prefer.");
    expect(messages(registrationPreferenceSchema.safeParse({ minAge: "30", maxAge: "25", preferredCountry: "Pakistan" })).maxAge).toBe("The oldest age cannot be lower than the youngest age.");
    expect(messages(registrationPreferenceSchema.safeParse({ minAge: "17", maxAge: "25", preferredCountry: "Pakistan" })).minAge).toBe("The age must be 18 or more.");
    expect(registrationPreferenceSchema.safeParse({ minAge: "25", maxAge: "35", preferredCountry: "Pakistan" }).success).toBe(true);
    expect(partnerPreferenceSchema.safeParse({}).success).toBe(true); // the admin edit form is unchanged
  });

  it("the e-mail address stays optional and the mobile number stays compulsory", () => {
    expect(contactInfoSchema.safeParse({ mobileNumber: "0300 1234567", email: "", preferredContactMethod: "WHATSAPP" }).success).toBe(true);
    expect(messages(contactInfoSchema.safeParse({ mobileNumber: "", preferredContactMethod: "WHATSAPP" })).mobileNumber).toBe("Please enter a valid mobile number.");
  });
});
