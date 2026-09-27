import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeCandidate { id: string; profileId: string; candidateProfileId: string; securityFlagId: string | null; confidenceBand: string; status: string; reviewerId: string | null; reviewedAt: Date | null; resolution: string | null; }
interface FakeFlag { id: string; status: string; resolution: string | null; resolvedById: string | null; resolvedAt: Date | null; }
interface FakeRelationship { profileId: string; relatedProfileId: string; relationshipType: string; status: string; confidenceBand: string | null; source: string; evidenceRef: string | null; createdById: string | null; reviewedById: string | null; reviewedAt: Date | null; }

let candidates: Map<string, FakeCandidate>;
let flags: Map<string, FakeFlag>;
let relationships: Map<string, FakeRelationship>;
let auditCalls: Record<string, unknown>[];

function relKey(profileId: string, relatedProfileId: string, relationshipType: string) {
  return `${profileId}:${relatedProfileId}:${relationshipType}`;
}

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    accountRelationship: {
      upsert: vi.fn(async ({ where, update, create }: { where: { profileId_relatedProfileId_relationshipType: { profileId: string; relatedProfileId: string; relationshipType: string } }; update: Partial<FakeRelationship>; create: FakeRelationship }) => {
        const key = relKey(where.profileId_relatedProfileId_relationshipType.profileId, where.profileId_relatedProfileId_relationshipType.relatedProfileId, where.profileId_relatedProfileId_relationshipType.relationshipType);
        const existing = relationships.get(key);
        const row = existing ? Object.assign(existing, update) : { ...create };
        relationships.set(key, row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { OR: { profileId?: string; relatedProfileId?: string }[] } }) => {
        const id = where.OR[0].profileId ?? where.OR[1]?.relatedProfileId;
        return [...relationships.values()].filter((r) => r.profileId === id || r.relatedProfileId === id);
      }),
    },
  },
}));

const tx = {
  duplicateCandidate: {
    findUnique: async ({ where }: { where: { id: string } }) => candidates.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeCandidate> }) => {
      const c = candidates.get(where.id)!;
      Object.assign(c, data);
      return c;
    },
  },
  securityFlag: {
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeFlag> }) => {
      const f = flags.get(where.id)!;
      Object.assign(f, data);
      return f;
    },
  },
  accountRelationship: {
    upsert: async ({ where, update, create }: { where: { profileId_relatedProfileId_relationshipType: { profileId: string; relatedProfileId: string; relationshipType: string } }; update: Partial<FakeRelationship>; create: FakeRelationship }) => {
      const key = relKey(where.profileId_relatedProfileId_relationshipType.profileId, where.profileId_relatedProfileId_relationshipType.relatedProfileId, where.profileId_relatedProfileId_relationshipType.relationshipType);
      const existing = relationships.get(key);
      const row = existing ? Object.assign(existing, update) : { ...create };
      relationships.set(key, row);
      return row;
    },
  },
};

const { createRelationship, getRelationshipsForProfile, resolveDuplicateCandidate, AccountRelationshipError } = await import("./account-relationships");

beforeEach(() => {
  candidates = new Map([["c1", { id: "c1", profileId: "p1", candidateProfileId: "p2", securityFlagId: "f1", confidenceBand: "STRONG", status: "DUPLICATE_REVIEW_REQUIRED", reviewerId: null, reviewedAt: null, resolution: null }]]);
  flags = new Map([["f1", { id: "f1", status: "OPEN", resolution: null, resolvedById: null, resolvedAt: null }]]);
  relationships = new Map();
  auditCalls = [];
});

describe("createRelationship", () => {
  it("creates a relationship and audits it", async () => {
    const rel = await createRelationship({ profileId: "p1", relatedProfileId: "p3", relationshipType: "FAMILY_RELATED", source: "admin_manual", createdById: "admin1" });
    expect(rel).toMatchObject({ profileId: "p1", relatedProfileId: "p3", relationshipType: "FAMILY_RELATED" });
    expect(auditCalls[0]).toMatchObject({ action: "ACCOUNT_RELATIONSHIP_CREATED", adminId: "admin1", targetProfileId: "p1" });
  });
});

describe("getRelationshipsForProfile", () => {
  it("finds relationships where the profile is either side", async () => {
    await createRelationship({ profileId: "p1", relatedProfileId: "p3", relationshipType: "FAMILY_RELATED", source: "admin_manual", createdById: "admin1" });
    const found = await getRelationshipsForProfile("p1");
    expect(found).toHaveLength(1);
  });
});

describe("resolveDuplicateCandidate", () => {
  it("confirms a duplicate: candidate, flag, and relationship all update atomically", async () => {
    const result = await resolveDuplicateCandidate("c1", { adminId: "admin1", decision: "CONFIRMED_DUPLICATE", resolution: "Same phone and email" });
    expect(result.status).toBe("CONFIRMED_DUPLICATE");
    expect(flags.get("f1")!.status).toBe("RESOLVED");
    expect(relationships.get(relKey("p1", "p2", "CONFIRMED_DUPLICATE"))).toBeDefined();
    expect(auditCalls[0]).toMatchObject({ action: "DUPLICATE_CONFIRMED", adminId: "admin1", targetProfileId: "p1" });
  });

  it("dismissing as not-a-duplicate records an UNKNOWN_RELATIONSHIP so it won't be re-flagged", async () => {
    await resolveDuplicateCandidate("c1", { adminId: "admin1", decision: "NOT_DUPLICATE", resolution: "Different people, coincidental match" });
    expect(candidates.get("c1")!.status).toBe("NOT_DUPLICATE");
    expect(relationships.get(relKey("p1", "p2", "UNKNOWN_RELATIONSHIP"))).toBeDefined();
    expect(auditCalls[0]).toMatchObject({ action: "DUPLICATE_DISMISSED" });
  });

  it("404s for a nonexistent candidate", async () => {
    await expect(resolveDuplicateCandidate("nope", { adminId: "admin1", decision: "NOT_DUPLICATE", resolution: "x" })).rejects.toThrow(AccountRelationshipError);
  });

  it("rejects reviewing an already-resolved candidate a second time", async () => {
    await resolveDuplicateCandidate("c1", { adminId: "admin1", decision: "CONFIRMED_DUPLICATE", resolution: "first review" });
    await expect(resolveDuplicateCandidate("c1", { adminId: "admin2", decision: "NOT_DUPLICATE", resolution: "second review" })).rejects.toThrow(/already been reviewed/i);
  });
});
