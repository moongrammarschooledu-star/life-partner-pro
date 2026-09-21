import { describe, it, expect } from "vitest";
import { analyzeMutual } from "@/lib/ai/analysis/mutual";
import { detectFindings, sufficiencyOf, improvementSuggestions } from "@/lib/ai/analysis/quality";
import { buildProfileSummary } from "@/lib/ai/analysis/summary";
import { buildMatchExplanation, buildMatchReview } from "@/lib/ai/analysis/match-review";
import { buildComparison } from "@/lib/ai/analysis/comparison";
import { buildCommunicationDraft } from "@/lib/ai/analysis/drafts";
import { buildFollowUpSuggestion, suggestFollowUpActions } from "@/lib/ai/analysis/followup";
import { buildReportSummary } from "@/lib/ai/analysis/report";
import { applySafetyRules } from "@/lib/ai/safety";
import { minimizeForExternal } from "@/lib/ai/profile-view";
import { scoreMatch } from "@/lib/matching";
import { makeView, makeMatchable, malePartner } from "@/lib/ai/testing/fixtures";
import { LANGUAGES, COMMUNICATION_KINDS } from "@/lib/ai/types";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

const pair = () => {
  const a = makeView();
  const b = malePartner();
  return { a: { view: a, matchable: makeMatchable(a) }, b: { view: b, matchable: makeMatchable(b) } };
};

describe("mutual requirement analysis", () => {
  it("re-uses the deterministic engine's score and never alters it", () => {
    const { a, b } = pair();
    const before = scoreMatch(a.matchable, b.matchable);
    deepFreeze(a);
    deepFreeze(b);
    const m = analyzeMutual(a, b);
    expect(m.deterministic.total).toBe(before.total);
    expect(m.deterministic.label).toBe("System matching result");
    expect(m.deterministic.algorithmVersion).toMatch(/^LPP-MATCH-/);
    // recomputing afterwards still gives the same number (nothing was mutated)
    expect(scoreMatch(a.matchable, b.matchable).total).toBe(before.total);
  });

  it("reports missing information as INSUFFICIENT, never as a conflict", () => {
    const a = makeView({}, { minAge: null, maxAge: null, preferredCountry: null, preferredCity: null, minEducation: null, professionPreference: null, maritalStatusPreference: null, minHeightCm: null, maxHeightCm: null, familyTypePreference: null, familyBackgroundPreference: null, incomeFlexible: null });
    const b = makeView({ gender: "MALE" }, { minAge: null, maxAge: null, preferredCountry: null, preferredCity: null, minEducation: null, professionPreference: null, maritalStatusPreference: null, minHeightCm: null, maxHeightCm: null, familyTypePreference: null, familyBackgroundPreference: null, incomeFlexible: null });
    const m = analyzeMutual({ view: a, matchable: makeMatchable(a) }, { view: b, matchable: makeMatchable(b) });
    expect(m.requirementConflicts).toEqual([]);
    expect(m.unknownInformation.length).toBeGreaterThan(0);
  });

  it("detects a genuine age-preference conflict on the correct side", () => {
    const a = makeView({ age: 27 }, { minAge: 27, maxAge: 30 });
    const b = malePartner({ age: 40 });
    const m = analyzeMutual({ view: a, matchable: makeMatchable(a) }, { view: b, matchable: makeMatchable(b) });
    const age = m.categories.find((c) => c.category === "age")!;
    expect(age.combined).toBe("CONFLICT");
    expect(age.aToB).toBe("CONFLICT");
    expect(m.requirementConflicts.some((c) => c.startsWith("Age"))).toBe(true);
    expect(m.mutualCompatibility).toBe("CONFLICT");
  });

  it("does not expose income when the admin lacks sensitive:income:view", () => {
    const a = makeView({ hidden: { income: true, familyDetails: false }, monthlyIncome: null }, { minIncome: 500000 });
    const b = malePartner({ hidden: { income: true, familyDetails: false }, monthlyIncome: null });
    const m = analyzeMutual({ view: a, matchable: makeMatchable(a) }, { view: b, matchable: makeMatchable(b) }, { restrictedCategories: ["income"] });
    const income = m.categories.find((c) => c.category === "income")!;
    expect(income.restricted).toBe(true);
    expect(income.combined).toBe("INSUFFICIENT");
    expect(income.reason).toBe("Not available at your access level");
    expect(m.deterministic.excludesRestrictedCategories).toBe(true);
    expect(JSON.stringify(m)).not.toContain("500000");
  });

  it("lists both profiles' flexible areas", () => {
    const { a, b } = pair();
    const m = analyzeMutual(a, b);
    expect(m.flexibleAreas.some((f) => f.includes("profession"))).toBe(true);
  });
});

describe("data quality and contradictions", () => {
  it("flags a never-married profile that lists children as a potential inconsistency, not fraud", () => {
    const v = makeView({ maritalStatus: "NEVER_MARRIED", hasChildren: true, numberOfChildren: 2 });
    const f = detectFindings(v).find((x) => x.label === "INCONSISTENT" && x.area === "Marital status")!;
    expect(f.message).toMatch(/Potential inconsistency detected — Admin Review Required/);
    expect(f.message).not.toMatch(/fraud|lie|fake/i);
  });

  it("flags impossible partner ranges and employment conflicts", () => {
    const v = makeView({ employmentType: "NOT_WORKING", jobTitle: "Manager" }, { minAge: 40, maxAge: 30 });
    const areas = detectFindings(v).filter((x) => x.label === "INCONSISTENT").map((x) => x.area);
    expect(areas).toEqual(expect.arrayContaining(["Employment", "Partner requirements"]));
  });

  it("flags education level vs degree text mismatch", () => {
    const v = makeView({ educationLevel: "Matric", degree: "MBA" });
    expect(detectFindings(v).some((x) => x.label === "INCONSISTENT" && x.area === "Education")).toBe(true);
  });

  it("labels missing, needs-verification and confirmation findings", () => {
    const v = makeView({ educationLevel: null, degree: null, verification: { status: "VERIFICATION_PENDING", phoneVerified: false, emailVerified: true, approvedChecklistItems: [] }, hasChildren: true, numberOfChildren: null, maritalStatus: "DIVORCED" });
    const labels = new Set(detectFindings(v).map((x) => x.label));
    expect(labels.has("MISSING")).toBe(true);
    expect(labels.has("NEEDS_VERIFICATION")).toBe(true);
    expect(labels.has("USER_CONFIRMATION_REQUIRED")).toBe(true);
  });

  it("does not compute a probability — sufficiency is a label", () => {
    expect(["SUFFICIENT", "PARTIAL", "LIMITED"]).toContain(sufficiencyOf(makeView()));
    expect(sufficiencyOf(makeView({ completenessPercent: 20, educationLevel: null, profession: null }))).toBe("LIMITED");
  });

  it("suggests improvements as text only", () => {
    const v = makeView({ jobTitle: null, employmentType: "PRIVATE" });
    expect(improvementSuggestions(v).join(" ")).toMatch(/job title/i);
  });
});

describe("profile summary", () => {
  it("separates verified, user-provided and AI observation lines", () => {
    const s = buildProfileSummary(makeView());
    const sources = new Set(s.evidence.map((e) => e.source));
    expect(sources.has("VERIFIED")).toBe(true);
    expect(sources.has("USER_PROVIDED")).toBe(true);
    expect(sources.has("AI_OBSERVATION")).toBe(true);
    // user-provided facts are never presented as verified
    expect(s.evidence.find((e) => e.label === "Education")!.source).toBe("USER_PROVIDED");
  });

  it("never includes a name, contact detail or hidden income", () => {
    const v = makeView({ hidden: { income: true, familyDetails: true }, monthlyIncome: null });
    const s = JSON.stringify(buildProfileSummary(v));
    expect(s).not.toMatch(/Monthly income/);
    expect(s).not.toMatch(/@|\+92|03\d{9}/);
    expect(s).not.toMatch(/Siblings/);
  });

  it("states limitations and passes the safety filter unchanged", () => {
    const s = buildProfileSummary(makeView());
    expect(s.limitations.length).toBeGreaterThan(0);
    const safe = applySafetyRules(s);
    expect(safe.blocked).toBe(false);
    expect(safe.events).toHaveLength(0);
  });
});

describe("match explanation and review", () => {
  it("uses neutral wording and no guarantee language", () => {
    const { a, b } = pair();
    const m = analyzeMutual(a, b);
    const e = buildMatchExplanation(a.view, b.view, m);
    expect(JSON.stringify(e)).not.toMatch(/perfect|guarantee|ideal spouse|100%|definitely/i);
    expect(e.sufficiency).toMatch(/SUFFICIENT|PARTIAL|LIMITED/);
    const safe = applySafetyRules(e);
    expect(safe.blocked).toBe(false);
    expect(safe.events).toHaveLength(0);
  });

  it("labels the deterministic score as the system result, not an AI score", () => {
    const { a, b } = pair();
    const e = buildMatchExplanation(a.view, b.view, analyzeMutual(a, b));
    const line = e.evidence.find((x) => x.label.startsWith("System matching result"))!;
    expect(line.value).toMatch(/deterministic matching engine, not by AI/);
  });

  it("recommends verification before proposal when a profile is unverified, and never auto-acts", () => {
    const a = makeView({ verification: { status: "VERIFICATION_PENDING", phoneVerified: false, emailVerified: false, approvedChecklistItems: [] } });
    const b = malePartner();
    const m = analyzeMutual({ view: a, matchable: makeMatchable(a) }, { view: b, matchable: makeMatchable(b) });
    const r = buildMatchReview(a, b, m);
    expect(r.suggestedNextStep).toMatch(/verify/i);
    // the assistant only suggests; it never claims to have sent, approved or shared anything
    expect(JSON.stringify(r)).not.toMatch(/\b(sent|approved|has been shared|finali[sz]ed|executed)\b/i);
  });
});

describe("candidate comparison", () => {
  it("produces the 15 required columns and NO ranking or winner", () => {
    const views = [makeView(), malePartner(), makeView({ city: "Karachi" }), malePartner({ city: "Islamabad" })];
    const c = buildComparison(views);
    const fields = (c.data!.columns as Array<{ field: string }>).map((x) => x.field);
    expect(fields).toEqual([
      "Basic compatibility", "Education", "Profession", "Location", "Income", "Marital status", "Height", "Family preferences",
      "Religious preferences", "Lifestyle", "Partner requirements", "Verification", "Profile completeness", "Missing information", "Review notes",
    ]);
    expect(c.data!.ranking).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/is the (best|top|winner)|best candidate|top candidate|recommended candidate|ranked #?1\b/i);
    expect((c.data!.refs as unknown[]).length).toBe(4);
  });

  it("keeps deterministic pair results separate and labelled", () => {
    const { a, b } = pair();
    const c = buildComparison([a.view, b.view], [{ a: a.view.ref, b: b.view.ref, analysis: analyzeMutual(a, b) }]);
    const sys = c.data!.systemMatchingResults as Array<{ label: string }>;
    expect(sys[0].label).toBe("System matching result");
  });

  it("hides income when not permitted", () => {
    const c = buildComparison([makeView({ hidden: { income: true, familyDetails: false }, monthlyIncome: null }), malePartner({ hidden: { income: true, familyDetails: false }, monthlyIncome: null })]);
    const income = (c.data!.columns as Array<{ field: string; values: Record<string, string> }>).find((x) => x.field === "Income")!;
    for (const v of Object.values(income.values)) expect(v).toBe("Not available at your access level");
  });
});

describe("communication drafts", () => {
  for (const language of LANGUAGES) {
    for (const kind of COMMUNICATION_KINDS) {
      it(`${kind} (${language}) is safe, respectful and free of contact details`, () => {
        const d = buildCommunicationDraft({ kind, language, recipientCode: "LPP-SYN-0001" });
        const draft = (d.data as { draft: { subject: string; body: string } }).draft;
        const text = `${draft.subject}\n${draft.body}`;
        expect(text).not.toMatch(/@|https?:\/\/|\d{9,}/);
        expect(text).not.toMatch(/guarantee|perfect|last chance|hurry|must accept/i);
        expect(text).toMatch(/\[[^\]]+\]/); // placeholders left for the admin
        expect((d.data as { sent: boolean }).sent).toBe(false);
        const safe = applySafetyRules(d);
        expect(safe.blocked).toBe(false);
        expect(safe.events).toHaveLength(0);
      });
    }
  }
});

describe("follow-up assistant", () => {
  const base = { profileCode: "LPP-SYN-0001", purpose: "Check on family discussion", status: "PENDING", priority: "MEDIUM", proposalStatus: null, now: new Date("2026-09-20T00:00:00Z") };
  it("suggests a gentle reminder when due and escalates to admin review when long overdue", () => {
    expect(suggestFollowUpActions({ ...base, dueDate: new Date("2026-09-20T00:00:00Z") })).toEqual(["GENTLE_REMINDER"]);
    expect(suggestFollowUpActions({ ...base, dueDate: new Date("2026-08-01T00:00:00Z") })).toContain("ADMIN_REVIEW");
  });
  it("suggests nothing for a completed follow-up and never marks sent", () => {
    expect(suggestFollowUpActions({ ...base, status: "COMPLETED", dueDate: new Date("2026-09-01T00:00:00Z") })).toEqual([]);
    const s = buildFollowUpSuggestion({ ...base, dueDate: new Date("2026-09-10T00:00:00Z") }, "en");
    expect((s.data as { draft: { body: string } | null }).draft?.body).toBeTruthy();
    expect((s.data as { sent: boolean }).sent).toBe(false);
  });
});

describe("report summary", () => {
  it("restates only the supplied figures — nothing is invented", () => {
    const r = buildReportSummary({ title: "Registrations", periodDays: 30, figures: [{ label: "New registrations", value: 42 }, { label: "Verified", value: 17 }], generatedAt: new Date("2026-09-20T00:00:00Z") });
    expect(r.summary).toContain("42");
    expect(r.summary).toContain("17");
    const numbersInText = (r.summary.match(/\d+/g) ?? []).map(Number);
    for (const n of numbersInText) expect([30, 42, 17]).toContain(n); // 30 = period
    expect(r.evidence.every((e) => e.source === "DATABASE")).toBe(true);
  });
  it("reports an empty period honestly", () => {
    const r = buildReportSummary({ title: "Registrations", periodDays: 7, figures: [], generatedAt: new Date() });
    expect(r.sufficiency).toBe("LIMITED");
    expect(r.missingInformation.length).toBe(1);
  });
});

describe("external payload minimisation", () => {
  it("contains no name, contact, area, income, free text or identifiers", () => {
    const v = makeView({ aboutMe: "Call me on 0300 1234567", hobbies: "secret hobby", fatherOccupation: "Retired officer", workLocation: "Gulberg III", familyLocation: "Bahria Town" });
    const ext = JSON.stringify(minimizeForExternal(v));
    for (const forbidden of [v.profileId, v.profileCode, v.area!, v.institution!, v.companyName!, v.workLocation!, v.familyLocation!, "Retired officer", "secret hobby", "0300", "120000", "Model Town", "Synthetic"]) {
      expect(ext, forbidden).not.toContain(forbidden);
    }
    expect(ext).toContain(v.ref);
    expect(Object.keys(JSON.parse(ext).preference)).not.toEqual(expect.arrayContaining(["minIncome", "maxIncome", "additionalExpectations"]));
  });
});
