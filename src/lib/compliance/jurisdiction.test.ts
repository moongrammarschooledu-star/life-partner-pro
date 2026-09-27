import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeJurisdiction { id: string; jurisdictionCode: string; countryCode: string; regionCode: string | null; name: string; status: string; effectiveFrom: Date; effectiveTo: Date | null; configuration?: string; }

let jurisdictions: FakeJurisdiction[];
let auditCalls: Record<string, unknown>[];
let taskCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/workflow/engine", () => ({ createTask: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    jurisdiction: {
      findMany: vi.fn(async ({ where }: { where?: { status?: string } } = {}) =>
        where?.status ? jurisdictions.filter((j) => j.status === where.status) : [...jurisdictions]
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => jurisdictions.find((j) => j.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `j${jurisdictions.length + 1}`, ...data } as FakeJurisdiction;
        jurisdictions.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = jurisdictions.findIndex((j) => j.id === where.id);
        if (idx === -1) throw new Error("not found");
        jurisdictions[idx] = { ...jurisdictions[idx], ...data } as FakeJurisdiction;
        return jurisdictions[idx];
      }),
    },
  },
}));

const { resolveApplicableJurisdictions, createJurisdiction, updateJurisdiction, listJurisdictions, getJurisdiction } = await import("./jurisdiction");

beforeEach(() => {
  jurisdictions = [
    { id: "j1", jurisdictionCode: "PK", countryCode: "PK", regionCode: null, name: "Pakistan", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null },
    { id: "j2", jurisdictionCode: "US", countryCode: "US", regionCode: null, name: "United States", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null },
  ];
  auditCalls = [];
  taskCalls = [];
});

describe("Jurisdiction CRUD", () => {
  it("always creates a new jurisdiction as DRAFT, never pre-activated", async () => {
    const jurisdiction = await createJurisdiction({ jurisdictionCode: "EU", countryCode: "EU", name: "European Union" }, "admin1");
    expect(jurisdiction.status).toBe("DRAFT");
    expect(auditCalls[0]).toMatchObject({ action: "JURISDICTION_CREATED" });
  });

  it("flags a newly-created jurisdiction for review via a JURISDICTION_REVIEW task", async () => {
    const jurisdiction = await createJurisdiction({ jurisdictionCode: "EU", countryCode: "EU", name: "European Union" }, "admin1");
    expect(taskCalls[0]).toMatchObject({ taskType: "JURISDICTION_REVIEW", resourceType: "CASE", resourceId: jurisdiction.id });
  });

  it("updateJurisdiction can move status to ACTIVE and is audited", async () => {
    const jurisdiction = await createJurisdiction({ jurisdictionCode: "EU", countryCode: "EU", name: "European Union" }, "admin1");
    const updated = await updateJurisdiction(jurisdiction.id, { status: "ACTIVE" }, "admin1");
    expect(updated.status).toBe("ACTIVE");
    expect(auditCalls.some((c) => c.action === "JURISDICTION_UPDATED")).toBe(true);
  });

  it("listJurisdictions returns every jurisdiction regardless of status", async () => {
    await createJurisdiction({ jurisdictionCode: "EU", countryCode: "EU", name: "European Union" }, "admin1");
    const list = await listJurisdictions();
    expect(list.length).toBe(3); // 2 seeded + 1 created
  });

  it("getJurisdiction returns null for an unknown id", async () => {
    expect(await getJurisdiction("nope")).toBeNull();
  });
});

describe("resolveApplicableJurisdictions", () => {
  it("returns NO_MATCH and reviewRequired when nothing matches", async () => {
    const result = await resolveApplicableJurisdictions({ applicantCountry: "FR" });
    expect(result).toEqual({ matches: [], reviewRequired: true, reason: "NO_MATCH" });
  });

  it("resolves confidently on a HIGH-confidence basis (processingCountry)", async () => {
    const result = await resolveApplicableJurisdictions({ processingCountry: "PK", applicantCountry: "US" });
    expect(result.reviewRequired).toBe(false);
    expect(result.reason).toBe("RESOLVED");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ jurisdictionCode: "PK", basis: "processingCountry", confidence: "HIGH" });
  });

  it("never resolves confidently on applicantCountry alone — spec's own warning", async () => {
    const result = await resolveApplicableJurisdictions({ applicantCountry: "PK" });
    expect(result.reviewRequired).toBe(true);
    expect(result.reason).toBe("LOW_CONFIDENCE_ONLY");
  });

  it("flags CONFLICTING_MATCHES when two different jurisdictions both match at HIGH/MEDIUM confidence", async () => {
    const result = await resolveApplicableJurisdictions({ processingCountry: "PK", storageCountry: "US" });
    expect(result.reviewRequired).toBe(true);
    expect(result.reason).toBe("CONFLICTING_MATCHES");
    expect(result.matches).toHaveLength(2);
  });

  it("ignores an INACTIVE jurisdiction even if its country code matches", async () => {
    jurisdictions.push({ id: "j3", jurisdictionCode: "GB", countryCode: "GB", regionCode: null, name: "UK", status: "INACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null });
    const result = await resolveApplicableJurisdictions({ processingCountry: "GB" });
    expect(result.reason).toBe("NO_MATCH");
  });

  it("matches on applicantRegion when countryCode alone doesn't disambiguate", async () => {
    jurisdictions.push({ id: "j4", jurisdictionCode: "US-CA", countryCode: "US", regionCode: "CA", name: "California", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null });
    const result = await resolveApplicableJurisdictions({ applicantRegion: "CA" });
    // applicantRegion is LOW confidence on its own — still surfaced, still reviewRequired.
    expect(result.reviewRequired).toBe(true);
    expect(result.matches.some((m) => m.jurisdictionCode === "US-CA")).toBe(true);
  });

  it("a single jurisdiction matching on multiple bases only counts once", async () => {
    const result = await resolveApplicableJurisdictions({ processingCountry: "PK", storageCountry: "PK", applicantCountry: "PK" });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].basis).toBe("processingCountry"); // strongest basis wins
  });
});
