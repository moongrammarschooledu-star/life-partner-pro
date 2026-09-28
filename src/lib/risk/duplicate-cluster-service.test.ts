import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let candidates: Row[];
let relationships: Row[];
let clusters: Row[];
let upserts: Row[];
let candidateUpdates: Row[];
let audits: Row[];
let adminNotes: Row[];
let gateResult: Row;
let holds: Row[];
let clusterUpdates: Row[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => "LPP-DUPC-000001") }));
vi.mock("@/lib/approvals/gate", () => ({ enforceApprovalGate: vi.fn(async () => gateResult), markApprovalExecuted: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/notification-service", () => ({ notifyAdmins: vi.fn(async (n: Row) => { adminNotes.push(n); }) }));
vi.mock("@/lib/risk/signal-service", () => ({
  createRiskSignal: vi.fn(async () => ({ created: true, flag: { id: "f1" } })),
  suppressedRelatedProfiles: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    duplicateCandidate: {
      findMany: vi.fn(async () => candidates),
      updateMany: vi.fn(async (a: Row) => { candidateUpdates.push(a); return { count: 1 }; }),
    },
    accountRelationship: {
      findMany: vi.fn(async ({ where }: { where: { relationshipType: { in: string[] } } }) => relationships.filter((r) => where.relationshipType.in.includes(r.relationshipType as string))),
      upsert: vi.fn(async (a: Row) => { upserts.push(a); return a; }),
    },
    duplicateCluster: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => (where.fingerprint ? clusters.find((c) => c.fingerprint === where.fingerprint) ?? null : clusters.find((c) => c.id === where.id) ?? null)),
      findMany: vi.fn(async () => clusters.filter((c) => c.status === "UNRESOLVED")),
      create: vi.fn(async ({ data }: { data: Row }) => { clusters.push({ id: `cl${clusters.length + 1}`, ...data }); return data; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { clusterUpdates.push({ id: where.id, ...data }); const c = clusters.find((x) => x.id === where.id) as Row; Object.assign(c, data); return c; }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Row }) => { for (const c of clusters) if (where.id.in.includes(c.id as string)) Object.assign(c, data); return { count: 1 }; }),
    },
    profile: { findUnique: vi.fn(async () => ({ verified: false, createdAt: new Date("2026-01-01") })) },
    proposal: { count: vi.fn(async () => 1) },
    case: { count: vi.fn(async () => 0) },
    payment: { count: vi.fn(async () => 0) },
    verificationDocument: { count: vi.fn(async () => 0) },
    dataHold: { findFirst: vi.fn(async ({ where }: { where: { profileId: string } }) => holds.find((h) => h.profileId === where.profileId) ?? null) },
  },
}));

const svc = await import("./duplicate-cluster-service");
const actor = { id: "a1", name: "A", email: "a@x", role: "VERIFICATION_MANAGER", permissions: [], sid: "s" } as never;

beforeEach(() => {
  candidates = []; relationships = []; clusters = []; upserts = []; candidateUpdates = []; audits = []; adminNotes = []; holds = []; clusterUpdates = [];
  gateResult = { requiresApproval: false };
});

describe("evidence allow-list (no sensitive traits)", () => {
  it.each(["religion", "ethnicity", "caste", "familyBackground", "monthlyIncome", "attractiveness", "photoSimilarity", "healthStatus", "politicalView"])("refuses %s as duplicate evidence", (field) => {
    expect(() => svc.assertAllowedDuplicateSignals([field])).toThrow();
  });
  it("refuses any signal that is not on the allow-list", () => {
    expect(() => svc.assertAllowedDuplicateSignals(["FAVOURITE_COLOUR"])).toThrow(/Unsupported duplicate evidence/);
  });
  it("accepts only the documented contact/identity/provider signals", () => {
    expect(() => svc.assertAllowedDuplicateSignals([...svc.DUPLICATE_ALLOWED_SIGNALS])).not.toThrow();
  });
  it("confidence computation rejects a forbidden signal even if a caller tries to smuggle one in", () => {
    expect(() => svc.computeExtendedConfidence(["MOBILE", "RELIGION" as never])).toThrow();
  });
});

describe("confidence bands", () => {
  it.each([
    [["NAME_AND_DOB"], "MEDIUM"],
    [["MOBILE"], "MEDIUM"],
    [["MOBILE", "EMAIL"], "HIGH"],
    [["MOBILE", "EMAIL", "VERIFIED_PHONE"], "VERY_HIGH"],
    [["MOBILE", "EMAIL", "NAME_AND_DOB"], "EXACT"],
    [["PROVIDER_REFERENCE", "MOBILE"], "EXACT"],
  ] as const)("%j → %s", (signals, band) => {
    expect(svc.computeExtendedConfidence([...signals]).band).toBe(band);
  });
  it("maxBand orders bands and keeps the legacy STRONG band comparable", () => {
    expect(svc.maxBand("LOW", "EXACT")).toBe("EXACT");
    expect(svc.maxBand("STRONG", "MEDIUM")).toBe("STRONG");
  });
});

describe("buildClusters (union-find)", () => {
  it("merges transitive pairs into one cluster and keeps separate components apart", () => {
    const out = svc.buildClusters([
      { a: "p1", b: "p2", band: "HIGH" },
      { a: "p2", b: "p3", band: "MEDIUM" },
      { a: "p9", b: "p8", band: "LOW" },
    ]);
    expect(out).toHaveLength(2);
    const big = out.find((c) => c.members.length === 3);
    expect(big?.members).toEqual(["p1", "p2", "p3"]);
    expect(big?.band).toBe("HIGH");
  });
  it("is deterministic: edge order and direction never change the fingerprint", () => {
    const one = svc.buildClusters([{ a: "p1", b: "p2", band: "HIGH" }, { a: "p3", b: "p2", band: "LOW" }]);
    const two = svc.buildClusters([{ a: "p2", b: "p3", band: "LOW" }, { a: "p2", b: "p1", band: "HIGH" }]);
    expect(one[0].fingerprint).toBe(two[0].fingerprint);
  });
  it("ignores self-edges and never produces a single-member cluster", () => {
    expect(svc.buildClusters([{ a: "p1", b: "p1", band: "HIGH" }])).toEqual([]);
  });
  it("marks a cluster confirmed only from a confirmed edge", () => {
    expect(svc.buildClusters([{ a: "p1", b: "p2", band: "HIGH" }])[0].confirmed).toBe(false);
    expect(svc.buildClusters([{ a: "p1", b: "p2", band: "HIGH", confirmed: true }])[0].confirmed).toBe(true);
  });
});

describe("rebuildDuplicateClusters", () => {
  it("creates a cluster from open candidates and is idempotent on re-run", async () => {
    candidates = [{ profileId: "p1", candidateProfileId: "p2", confidenceBand: "HIGH" }];
    const first = await svc.rebuildDuplicateClusters();
    const second = await svc.rebuildDuplicateClusters();
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ status: "UNRESOLVED", memberCount: 2 });
    expect(adminNotes).toHaveLength(1); // notified once, on creation only
  });

  it("FALSE POSITIVE — authorized family accounts are never clustered", async () => {
    candidates = [{ profileId: "p1", candidateProfileId: "p2", confidenceBand: "HIGH" }];
    relationships = [{ profileId: "p1", relatedProfileId: "p2", relationshipType: "AUTHORIZED_FAMILY_ACCOUNT" }];
    const r = await svc.rebuildDuplicateClusters();
    expect(r.clusters).toBe(0);
    expect(clusters).toHaveLength(0);
  });

  it("FALSE POSITIVE — a pair already reviewed as NOT a duplicate never re-clusters", async () => {
    candidates = [{ profileId: "p2", candidateProfileId: "p1", confidenceBand: "MEDIUM" }];
    relationships = [{ profileId: "p1", relatedProfileId: "p2", relationshipType: "UNKNOWN_RELATIONSHIP" }];
    expect((await svc.rebuildDuplicateClusters()).clusters).toBe(0);
  });

  it("supersedes an UNRESOLVED cluster whose membership no longer holds (no in-place edit)", async () => {
    clusters = [{ id: "old", fingerprint: "stale", status: "UNRESOLVED" }];
    await svc.rebuildDuplicateClusters();
    expect(clusters[0].status).toBe("SUPERSEDED");
  });
});

describe("resolveDuplicateCluster", () => {
  const seed = (status = "UNRESOLVED") => clusters.push({ id: "cl1", fingerprint: "f", status, members: [{ profileId: "p1" }, { profileId: "p2" }] });

  it("FALSE_POSITIVE needs a note and a structured reason, then records why so the pair is never re-flagged", async () => {
    seed();
    await expect(svc.resolveDuplicateCluster("cl1", actor, { decision: "FALSE_POSITIVE", note: "shared phone" })).rejects.toMatchObject({ status: 422 });
    await expect(svc.resolveDuplicateCluster("cl1", actor, { decision: "FALSE_POSITIVE", note: "x", falsePositiveReason: "SHARED_FAMILY_PHONE" })).rejects.toMatchObject({ status: 422 });
    const r = await svc.resolveDuplicateCluster("cl1", actor, { decision: "FALSE_POSITIVE", note: "spouses share a phone", falsePositiveReason: "SHARED_FAMILY_PHONE" });
    expect(r.approvalRequired).toBe(false);
    expect((upserts[0].create as Row).relationshipType).toBe("AUTHORIZED_FAMILY_ACCOUNT");
    expect(candidateUpdates[0]).toMatchObject({ data: { status: "NOT_DUPLICATE", falsePositiveReason: "SHARED_FAMILY_PHONE" } });
    expect(clusters[0].status).toBe("FALSE_POSITIVE");
  });

  it("a non-family false-positive reason records an explicit 'not a duplicate' relationship", async () => {
    seed();
    await svc.resolveDuplicateCluster("cl1", actor, { decision: "FALSE_POSITIVE", note: "typing mistake in phone", falsePositiveReason: "DATA_ENTRY_ERROR" });
    expect((upserts[0].create as Row).relationshipType).toBe("UNKNOWN_RELATIONSHIP");
  });

  it("CONFIRMED goes through the DUPLICATE_CONFIRMATION gate and does nothing while approval is pending", async () => {
    seed();
    gateResult = { requiresApproval: true, status: "CREATED", approvalRequestId: "ap1", approvalCode: "LPP-APR-1" };
    const r = await svc.resolveDuplicateCluster("cl1", actor, { decision: "CONFIRMED", note: "same person, same documents" });
    expect(r).toMatchObject({ approvalRequired: true });
    expect(clusters[0].status).toBe("UNRESOLVED");
    expect(upserts).toHaveLength(0);
  });

  it("a closed cluster cannot be re-decided", async () => {
    seed("RESOLVED");
    await expect(svc.resolveDuplicateCluster("cl1", actor, { decision: "CONFIRMED", note: "again please" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("planDuplicateMerge (planning only — never executes)", () => {
  const seedConfirmed = () => clusters.push({ id: "cl1", status: "CONFIRMED", members: [{ profileId: "p1" }, { profileId: "p2" }] });

  it("only a human-CONFIRMED cluster can be planned", async () => {
    clusters.push({ id: "cl1", status: "UNRESOLVED", members: [] });
    await expect(svc.planDuplicateMerge("cl1", actor, "merge these accounts")).rejects.toMatchObject({ status: 409 });
  });

  it("returns a survivor suggestion, a preservation checklist and an approval request — and touches no account data", async () => {
    seedConfirmed();
    gateResult = { requiresApproval: true, status: "CREATED", approvalRequestId: "ap1", approvalCode: "LPP-APR-7" };
    const plan = await svc.planDuplicateMerge("cl1", actor, "merge these accounts");
    expect(plan.approval).toEqual({ approvalCode: "LPP-APR-7", status: "CREATED" });
    expect(plan.preservationChecklist.join(" ")).toMatch(/audit trail/i);
    expect(plan.preservationChecklist.join(" ")).toMatch(/does not execute/i);
    expect(plan.members).toHaveLength(2);
  });

  it("is BLOCKED by an active legal hold and requests no approval", async () => {
    seedConfirmed();
    holds = [{ profileId: "p2" }];
    const plan = await svc.planDuplicateMerge("cl1", actor, "merge these accounts");
    expect(plan.blockedReason).toMatch(/legal hold/);
    expect(plan.approval).toBeNull();
  });
});
