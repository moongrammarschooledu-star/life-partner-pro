import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/route-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "SUPER_ADMIN", permissions: ["verification:duplicate:scan"] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

const auditCalls: Record<string, unknown>[] = [];
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifyDuplicateScanSummary: vi.fn(async () => {}) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (prefix: string) => `LPP-${prefix}-000001`) }));

interface FakeProfile { id: string; fullName: string; dateOfBirth: Date; contact: { mobileNumber: string; email: string } | null; }
interface FakeFlag { id: string; profileId: string; relatedProfileId: string; flagType: string; status: string; }
interface FakeCandidate { profileId: string; candidateProfileId: string; securityFlagId: string; confidenceBand: string; }
interface FakeRelationship { profileId: string; relatedProfileId: string; relationshipType: string; status: string; }

let profiles: FakeProfile[];
let flags: FakeFlag[];
let candidates: FakeCandidate[];
let relationships: FakeRelationship[];
let idCounter = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findMany: vi.fn(async () => profiles) },
    securityFlag: {
      findFirst: vi.fn(async ({ where }: { where: { OR: { profileId: string; relatedProfileId: string }[] }; status: unknown } & Record<string, unknown>) => {
        const pairs = where.OR;
        return flags.find((f) => pairs.some((p) => (f.profileId === p.profileId && f.relatedProfileId === p.relatedProfileId))) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<FakeFlag, "id" | "status"> }) => {
        const flag: FakeFlag = { id: `flag${++idCounter}`, status: "OPEN", ...data };
        flags.push(flag);
        return flag;
      }),
    },
    accountRelationship: {
      findFirst: vi.fn(async ({ where }: { where: { OR: { profileId: string; relatedProfileId: string }[] } }) => {
        const pairs = where.OR;
        return relationships.find((r) => pairs.some((p) => r.profileId === p.profileId && r.relatedProfileId === p.relatedProfileId)) ?? null;
      }),
    },
    duplicateCandidate: {
      create: vi.fn(async ({ data }: { data: Omit<FakeCandidate, never> }) => {
        candidates.push(data as FakeCandidate);
        return data;
      }),
    },
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  profiles = [];
  flags = [];
  candidates = [];
  relationships = [];
  idCounter = 0;
  auditCalls.length = 0;
});

function profile(id: string, overrides: Partial<FakeProfile> = {}): FakeProfile {
  return { id, fullName: "Test Person", dateOfBirth: new Date("1990-01-01"), contact: { mobileNumber: "+923001111111", email: `${id}@example.com` }, ...overrides };
}

describe("POST /api/admin/verification/duplicate-scan", () => {
  it("creates a SecurityFlag and a linked DuplicateCandidate for a matching pair", async () => {
    profiles = [
      profile("p1", { fullName: "Ayesha Khan", dateOfBirth: new Date("1990-01-01") }),
      profile("p2", { fullName: "Different Name", dateOfBirth: new Date("1985-06-01") }), // shares only the mobile number
    ];
    const res = await POST();
    const json = await res.json();
    expect(json.flagsCreated).toBe(1);
    expect(flags).toHaveLength(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].securityFlagId).toBe(flags[0].id);
    expect(candidates[0].confidenceBand).toBe("MEDIUM"); // single MOBILE signal
  });

  it("does not create a second candidate for a pair with an already-OPEN flag", async () => {
    profiles = [profile("p1"), profile("p2")];
    flags = [{ id: "existing-flag", profileId: "p1", relatedProfileId: "p2", flagType: "DUPLICATE_PROFILE_SUSPECTED", status: "OPEN" }];
    const res = await POST();
    const json = await res.json();
    expect(json.flagsCreated).toBe(0);
    expect(candidates).toHaveLength(0);
  });

  it("skips a pair already resolved as CONFIRMED_DUPLICATE or UNKNOWN_RELATIONSHIP", async () => {
    profiles = [profile("p1"), profile("p2")];
    relationships = [{ profileId: "p1", relatedProfileId: "p2", relationshipType: "UNKNOWN_RELATIONSHIP", status: "ACTIVE" }];
    const res = await POST();
    const json = await res.json();
    expect(json.flagsCreated).toBe(0);
    expect(flags).toHaveLength(0);
  });

  it("creates no flags when no profiles share any signal", async () => {
    profiles = [
      profile("p1", { contact: { mobileNumber: "+923001111111", email: "p1@example.com" } }),
      profile("p2", { fullName: "Different Person", dateOfBirth: new Date("1980-05-05"), contact: { mobileNumber: "+923002222222", email: "p2@example.com" } }),
    ];
    const res = await POST();
    const json = await res.json();
    expect(json.flagsCreated).toBe(0);
  });
});
