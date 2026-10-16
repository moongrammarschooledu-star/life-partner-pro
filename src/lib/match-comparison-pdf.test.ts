import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildProfilePdf, type ProfileDetailView } from "./profile-pdf";
import { comparisonSections, type ComparisonRow } from "./match-comparison-pdf";

// The comparison sheet handed to one of the two people: both names and the safe summary for both sides; the income comparison, photo, contact and every private detail left out.

const person = (over: Record<string, unknown>) =>
  ({
    fullName: "Private Name",
    gender: "FEMALE",
    age: 38,
    maritalStatus: "NEVER_MARRIED",
    hasChildren: null,
    heightCm: 163,
    city: "Islamabad",
    area: "F-7 Secret Area",
    country: "Pakistan",
    education: { level: "Bachelors" },
    profession: { profession: "Dentist", monthlyIncome: 250000 },
    family: { familyType: "NUCLEAR", fatherOccupation: "Secret Father Job" },
    lifestyle: { religion: "Islam", sect: "Sunni", aboutMe: "private about text" },
    contact: { mobileNumber: "03001234567", email: "x@y.com" },
    ...over,
  }) as unknown as ProfileDetailView;

const breakdown: ComparisonRow[] = [
  { category: "age", label: "Age", score: 1, status: "compatible", reason: "Both ages (38, 49) fall within each other's preferred range" },
  { category: "location", label: "Location", score: 0.2, status: "incompatible", reason: "Preferred location differs from at least one side's actual city (Islamabad vs Jhang)" },
  { category: "income", label: "Income", score: 1, status: "compatible", reason: "Income is within both sides' preferred range" },
  { category: "education", label: "Education", score: 0, status: "unknown", reason: "No education requirement stated" },
];

const you = person({});
const other = person({ fullName: "Other Private", age: 49, city: "Jhang", area: "Other Secret Area", education: { level: "Matric" }, profession: { profession: "Farm Manager", monthlyIncome: 90000 }, lifestyle: { religion: "Islam", sect: "Sunni" } });

describe("match comparison sections", () => {
  const sections = comparisonSections({ you, other, total: 75, tierLabel: "Good Match", breakdown });
  const text = JSON.stringify(sections);

  it("states the score and each category, leaving out income", () => {
    const rows = sections[0].rows;
    expect(sections[0].title).toBe("How well you match");
    expect(rows[0]).toEqual(["Overall", "75% - Good Match"]);
    expect(rows).toContainEqual(["Age", "100% - Both ages (38, 49) fall within each other's preferred range"]);
    expect(rows).toContainEqual(["Education", "No education requirement stated"]);
    expect(rows.find(([l]) => l === "Income")).toBeUndefined();
  });

  it("puts the two sides next to each other as You and Candidate", () => {
    const side = sections[1].rows;
    expect(side).toContainEqual(["Age", "You: 38 years\nCandidate: 49 years"]);
    expect(side).toContainEqual(["City", "You: Islamabad\nCandidate: Jhang"]);
    expect(side).toContainEqual(["Education", "You: Bachelors\nCandidate: Matric"]);
  });

  it("names both people", () => {
    expect(sections[1].rows[0]).toEqual(["Name", "You: Private Name\nCandidate: Other Private"]);
  });

  it("carries no area, income, family detail, about text or contact detail for either side", () => {
    for (const forbidden of ["Secret Area", "250000", "90000", "Secret Father", "private about", "03001234567", "x@y.com"]) expect(text).not.toContain(forbidden);
  });

  it("renders as a valid PDF", async () => {
    const pdf = await buildProfilePdf({
      appName: "Life Partner Pro",
      tagline: "t",
      generatedAt: new Date("2026-10-16T00:00:00Z"),
      profileCode: "LPP-000012",
      fullName: "Match summary",
      headline: "For Profile LPP-000012  |  compared with Profile LPP-000028",
      verified: false,
      sections,
      footer: "f",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
