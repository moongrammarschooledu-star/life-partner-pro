import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeJurisdiction { countryCode: string; status: string; configuration: string; effectiveFrom: Date; effectiveTo: Date | null; }
let jurisdictions: FakeJurisdiction[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jurisdiction: {
      findFirst: vi.fn(async ({ where }: { where: { countryCode: string; status: string } }) =>
        jurisdictions.find((j) => j.countryCode === where.countryCode && j.status === where.status) ?? null
      ),
    },
  },
}));

const { validateMinimumAge, DEFAULT_MINIMUM_AGE } = await import("./age-policy");

function dobForAge(age: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d;
}

beforeEach(() => {
  jurisdictions = [];
});

describe("validateMinimumAge", () => {
  it("uses the conservative default (18) when no jurisdiction is configured", async () => {
    const result = await validateMinimumAge(dobForAge(17), "PK");
    expect(result).toMatchObject({ allowed: false, minAge: DEFAULT_MINIMUM_AGE, jurisdictionResolved: false });
  });

  it("allows an applicant at or above the default minimum with no jurisdiction configured", async () => {
    const result = await validateMinimumAge(dobForAge(18), "PK");
    expect(result.allowed).toBe(true);
  });

  it("a configured jurisdiction can raise the minimum age above the default", async () => {
    jurisdictions.push({ countryCode: "PK", status: "ACTIVE", configuration: JSON.stringify({ minAge: 21 }), effectiveFrom: new Date("2020-01-01"), effectiveTo: null });
    const result = await validateMinimumAge(dobForAge(19), "PK");
    expect(result).toMatchObject({ allowed: false, minAge: 21, jurisdictionResolved: true });
  });

  it("a configured jurisdiction can never lower the minimum age below the platform default", async () => {
    jurisdictions.push({ countryCode: "PK", status: "ACTIVE", configuration: JSON.stringify({ minAge: 15 }), effectiveFrom: new Date("2020-01-01"), effectiveTo: null });
    const result = await validateMinimumAge(dobForAge(16), "PK");
    expect(result.minAge).toBe(DEFAULT_MINIMUM_AGE); // 18, not 15
    expect(result.allowed).toBe(false);
  });

  it("falls back to the default on malformed jurisdiction configuration rather than throwing", async () => {
    jurisdictions.push({ countryCode: "PK", status: "ACTIVE", configuration: "{not json", effectiveFrom: new Date("2020-01-01"), effectiveTo: null });
    const result = await validateMinimumAge(dobForAge(18), "PK");
    expect(result.minAge).toBe(DEFAULT_MINIMUM_AGE);
    expect(result.jurisdictionResolved).toBe(false);
  });

  it("cannot be bypassed by a client-supplied age — always recomputes from dateOfBirth server-side", async () => {
    const result = await validateMinimumAge(dobForAge(10), "PK");
    expect(result.age).toBeLessThan(18);
    expect(result.allowed).toBe(false);
  });
});
