import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildProfilePdf, profileSections, type ProfileDetailView } from "./profile-pdf";

// The printable profile sheet: the right rows, none of the private ones, and a valid PDF even for names the built-in font cannot draw.

function dto(overrides: Record<string, unknown> = {}): ProfileDetailView {
  return {
    id: "p1",
    profileCode: "LPP-000005",
    fullName: "Test Person",
    gender: "FEMALE",
    age: 27,
    maritalStatus: "NEVER_MARRIED",
    hasChildren: null,
    numberOfChildren: null,
    heightCm: 160,
    city: "Lahore",
    area: "Model Town",
    country: "Pakistan",
    nationality: "Pakistani",
    education: { level: "Masters", degree: "MBA", institution: "LUMS" },
    profession: { profession: "Teacher", employmentType: "PRIVATE", jobTitle: null, companyName: null, workLocation: null, businessDetails: null, monthlyIncome: 90000, annualIncome: null },
    family: { fatherOccupation: "Retired", motherOccupation: "Housewife", numberOfBrothers: 1, numberOfSisters: 2, familyType: "NUCLEAR", familyStatus: "MIDDLE_CLASS", familyLocation: "Lahore", familyBackground: null, additionalInfo: null },
    lifestyle: { religion: "Islam", sect: "Sunni", religiousPractice: "Practicing", languages: "Urdu, English", smoking: false, drinking: false, hobbies: "Reading", personality: "Calm, Caring", aboutMe: "Friendly and family oriented." },
    preference: { minAge: 28, maxAge: 35, preferredCountry: "Pakistan", preferredCity: "Lahore", preferredArea: null, locationScope: null, minEducation: "Bachelors", preferredEducation: null, professionPreference: "ANY", maritalStatusPreference: "NEVER_MARRIED", minHeightCm: 165, maxHeightCm: null, familyTypePreference: null, familyBackgroundPreference: null, otherFamilyRequirements: null, additionalExpectations: null },
    ...overrides,
  } as unknown as ProfileDetailView;
}

const titles = (p: ProfileDetailView) => profileSections(p).map((s) => s.title);
const allText = (p: ProfileDetailView) => JSON.stringify(profileSections(p));

describe("profile sheet sections", () => {
  it("lists the features in sections and skips empty rows", () => {
    expect(titles(dto())).toEqual(["Personal details", "Education and profession", "Family", "Lifestyle and religion", "Partner requirements"]);
    const personal = profileSections(dto())[0].rows;
    expect(personal).toContainEqual(["Age", "27 years"]);
    expect(personal).toContainEqual(["Height", `5'3" (160 cm)`]);
    expect(personal).toContainEqual(["City / area", "Lahore, Model Town"]);
    expect(personal.find(([l]) => l === "Children")).toBeUndefined();
  });

  it("states the partner's wishes and leaves 'any' out", () => {
    const partner = profileSections(dto()).find((s) => s.title === "Partner requirements")!.rows;
    expect(partner).toContainEqual(["Age", "28 to 35 years"]);
    expect(partner).toContainEqual(["Marital status", "Never Married"]);
    expect(partner.find(([l]) => l === "Profession")).toBeUndefined();
  });

  it("prints only what the downloading admin may see (income, family, religion arrive already removed)", () => {
    const redacted = dto({
      profession: { profession: "Teacher", employmentType: "PRIVATE", monthlyIncome: null, annualIncome: null },
      family: null,
      lifestyle: { religion: null, sect: null, religiousPractice: null, languages: "Urdu", smoking: false, drinking: false, hobbies: null, personality: null, aboutMe: null },
    });
    expect(titles(redacted)).not.toContain("Family");
    const text = allText(redacted);
    expect(text).not.toContain("Monthly income");
    expect(text).not.toContain("Islam");
    expect(text).not.toContain("Sunni");
  });

  it("never carries contact details, notes or documents, whatever the profile object holds", () => {
    const rich = dto({ contact: { mobileNumber: "03001234567", email: "x@y.com" }, notes: [{ text: "secret note" }], verificationDocuments: [{ id: "d" }] });
    const text = allText(rich);
    for (const forbidden of ["03001234567", "x@y.com", "secret note", "mobile", "e-mail", "WhatsApp"]) expect(text).not.toContain(forbidden);
  });
});

describe("profile sheet PDF", () => {
  const base = {
    appName: "Life Partner Pro",
    tagline: "Finding the Right Life Partner, With Trust.",
    generatedAt: new Date("2026-10-16T09:00:00Z"),
    profileCode: "LPP-000005",
    fullName: "Test Person",
    headline: "Female  |  27 years  |  Lahore",
    verified: true,
    footer: "Confidential.",
  };

  it("builds a valid PDF", async () => {
    const bytes = await buildProfilePdf({ ...base, sections: profileSections(dto()) });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain("LPP-000005");
  });

  it("does not fail on a name or text the built-in font cannot draw", async () => {
    const bytes = await buildProfilePdf({ ...base, fullName: "محمد منور Muhammad", sections: [{ title: "About", rows: [["About", "مجھے پڑھنا پسند ہے. Emoji \u{1F600} and normal text."]] }] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("runs onto more pages for very long text instead of cutting it off", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const bytes = await buildProfilePdf({ ...base, sections: [{ title: "About", rows: [["About", long], ["More", long], ["Even more", long]] }] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("copes with a very long unbroken word", async () => {
    const bytes = await buildProfilePdf({ ...base, sections: [{ title: "About", rows: [["About", "x".repeat(600)]] }] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
