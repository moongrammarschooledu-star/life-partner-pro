import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake Prisma — mirrors the pattern established in checkout.test.ts
// and the communications/documents e2e-flow tests.
let overrides: Array<Record<string, unknown>>;
let subscriptions: Array<Record<string, unknown>>;
let usage: Array<Record<string, unknown>>;
let ledger: Array<Record<string, unknown>>;
let auditCalls: Array<Record<string, unknown>>;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifyEntitlementExpired: vi.fn(async () => undefined) }));

function findLatestOverride(profileId: string, featureKey: string, now: Date) {
  return overrides
    .filter((o) => o.profileId === profileId && o.featureKey === featureKey && (o.expiresAt as Date) > now && !o.revokedAt)
    .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0];
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entitlementOverride: {
      findFirst: vi.fn(async ({ where }: { where: { profileId: string; featureKey: string } }) => findLatestOverride(where.profileId, where.featureKey, new Date()) ?? null),
      findMany: vi.fn(async ({ where }: { where: { profileId?: string; expiresAt?: { gt?: Date; lte?: Date }; revokedAt?: null } }) =>
        overrides.filter((o) => (!where.profileId || o.profileId === where.profileId) && (where.revokedAt === undefined || o.revokedAt === where.revokedAt))
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `ov${overrides.length + 1}`, revokedAt: null, createdAt: new Date(), ...data };
        overrides.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = overrides.find((o) => o.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    subscription: {
      findFirst: vi.fn(async ({ where }: { where: { profileId: string; status?: { in: string[] } } }) => {
        const matches = subscriptions.filter((s) => s.profileId === where.profileId && (!where.status || where.status.in.includes(s.status as string)));
        return matches.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null;
      }),
    },
    featureUsage: {
      findUnique: vi.fn(async ({ where }: { where: { profileId_featureKey_periodStart: { profileId: string; featureKey: string; periodStart: Date } } }) => {
        const k = where.profileId_featureKey_periodStart;
        return usage.find((u) => u.profileId === k.profileId && u.featureKey === k.featureKey && (u.periodStart as Date).getTime() === k.periodStart.getTime()) ?? null;
      }),
      upsert: vi.fn(async ({ where, create }: { where: { profileId_featureKey_periodStart: { profileId: string; featureKey: string; periodStart: Date } }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const k = where.profileId_featureKey_periodStart;
        const existing = usage.find((u) => u.profileId === k.profileId && u.featureKey === k.featureKey && (u.periodStart as Date).getTime() === k.periodStart.getTime());
        if (existing) {
          existing.usageCount = (existing.usageCount as number) + 1;
          return existing;
        }
        const row = { id: `u${usage.length + 1}`, ...create };
        usage.push(row);
        return row;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `u${usage.length + 1}`, ...data };
        usage.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; usageCount: { lt: number } }; data: { usageCount: { increment: number } } }) => {
        const row = usage.find((u) => u.id === where.id);
        if (!row || (row.usageCount as number) >= where.usageCount.lt) return { count: 0 };
        row.usageCount = (row.usageCount as number) + data.usageCount.increment;
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { usageCount: number } }) => {
        const row = usage.find((u) => u.id === where.id)!;
        row.usageCount = data.usageCount;
        return row;
      }),
    },
    featureUsageLedger: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (ledger.some((l) => l.featureKey === data.featureKey && l.requestId === data.requestId)) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        const row = { id: `l${ledger.length + 1}`, createdAt: new Date(), ...data };
        ledger.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { featureKey_requestId: { featureKey: string; requestId: string } } }) => {
        const k = where.featureKey_requestId;
        return ledger.find((l) => l.featureKey === k.featureKey && l.requestId === k.requestId) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { reversedLedgerId: string } }) => ledger.find((l) => l.reversedLedgerId === where.reversedLedgerId) ?? null),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      // Reuse the same mocked client object as the "transaction client" — good
      // enough for these tests, which don't depend on real rollback semantics.
      const { prisma } = await import("@/lib/prisma");
      return fn(prisma);
    }),
  },
}));

const { checkFeatureAccess, consumeUsageIdempotent, refundUsage, grantOverride, revokeOverrideGrant } = await import("./entitlements");

function periodBounds() {
  const now = new Date();
  return { periodStart: new Date(now.getFullYear(), now.getMonth(), 1), periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

beforeEach(() => {
  overrides = [];
  subscriptions = [];
  usage = [];
  ledger = [];
  auditCalls = [];
});

describe("checkFeatureAccess — override precedence", () => {
  it("denies access with no subscription and no override", async () => {
    const result = await checkFeatureAccess("p1", "MATCHING");
    expect(result).toEqual({ allowed: false, state: "EXPIRED", remaining: 0, source: "PACKAGE" });
  });

  it("a REVOKE override always wins, even over an active paid subscription", async () => {
    subscriptions.push({ id: "s1", profileId: "p1", status: "ACTIVE", createdAt: new Date(), packageId: "pkg1", packageVersionId: null, package: { entitlements: [{ featureKey: "MATCHING", limitValue: null, resetPeriod: null }] } });
    await grantOverride("admin1", { profileId: "p1", featureKey: "MATCHING", overrideType: "REVOKE", reason: "Under review", expiresAt: new Date(Date.now() + 86_400_000) });
    const result = await checkFeatureAccess("p1", "MATCHING");
    expect(result.allowed).toBe(false);
    expect(result.state).toBe("REVOKED");
    expect(result.source).toBe("OVERRIDE");
  });

  it("a GRANT override works even with no active subscription at all", async () => {
    await grantOverride("admin1", { profileId: "p1", featureKey: "AI_ASSISTANCE", overrideType: "GRANT", reason: "Compensation", expiresAt: new Date(Date.now() + 86_400_000) });
    const result = await checkFeatureAccess("p1", "AI_ASSISTANCE");
    expect(result).toEqual({ allowed: true, state: "ACTIVE", remaining: null, source: "OVERRIDE" });
  });

  it("an expired override is ignored — falls back to package-derived (none here)", async () => {
    overrides.push({ id: "ov1", profileId: "p1", featureKey: "MATCHING", overrideType: "REVOKE", reason: "old", expiresAt: new Date(Date.now() - 1000), revokedAt: null, createdAt: new Date() });
    const result = await checkFeatureAccess("p1", "MATCHING");
    expect(result.source).toBe("PACKAGE");
    expect(result.state).toBe("EXPIRED");
  });

  it("a revoked override is ignored even though it hasn't expired yet", async () => {
    const created = await grantOverride("admin1", { profileId: "p1", featureKey: "MATCHING", overrideType: "REVOKE", reason: "temp", expiresAt: new Date(Date.now() + 86_400_000) });
    await revokeOverrideGrant("admin1", created.id as string);
    subscriptions.push({ id: "s1", profileId: "p1", status: "ACTIVE", createdAt: new Date(), packageId: "pkg1", packageVersionId: null, package: { entitlements: [{ featureKey: "MATCHING", limitValue: null, resetPeriod: null }] } });
    const result = await checkFeatureAccess("p1", "MATCHING");
    expect(result.allowed).toBe(true);
    expect(result.source).toBe("PACKAGE");
  });

  it("LIMIT_ADJUST substitutes the override's limit onto the package entitlement", async () => {
    subscriptions.push({ id: "s1", profileId: "p1", status: "ACTIVE", createdAt: new Date(), packageId: "pkg1", packageVersionId: null, package: { entitlements: [{ featureKey: "ADVANCED_SEARCH", limitValue: 5, resetPeriod: "MONTHLY" }] } });
    await grantOverride("admin1", { profileId: "p1", featureKey: "ADVANCED_SEARCH", overrideType: "LIMIT_ADJUST", limitValue: 50, reason: "VIP", expiresAt: new Date(Date.now() + 86_400_000) });
    const result = await checkFeatureAccess("p1", "ADVANCED_SEARCH");
    expect(result.remaining).toBe(50);
  });
});

describe("consumeUsageIdempotent / refundUsage", () => {
  beforeEach(() => {
    subscriptions.push({ id: "s1", profileId: "p1", status: "ACTIVE", createdAt: new Date(), packageId: "pkg1", packageVersionId: null, package: { entitlements: [{ featureKey: "ADVANCED_SEARCH", limitValue: 2, resetPeriod: "MONTHLY" }] } });
  });

  it("the same requestId never consumes usage twice", async () => {
    const first = await consumeUsageIdempotent("p1", "ADVANCED_SEARCH", "req-1");
    const second = await consumeUsageIdempotent("p1", "ADVANCED_SEARCH", "req-1");
    expect(first).toBe(true);
    expect(second).toBe(true);
    const { periodStart } = periodBounds();
    const row = usage.find((u) => u.profileId === "p1" && u.featureKey === "ADVANCED_SEARCH" && (u.periodStart as Date).getTime() === periodStart.getTime());
    expect(row?.usageCount).toBe(1);
  });

  it("enforces the limit across distinct requestIds", async () => {
    expect(await consumeUsageIdempotent("p1", "ADVANCED_SEARCH", "req-1")).toBe(true);
    expect(await consumeUsageIdempotent("p1", "ADVANCED_SEARCH", "req-2")).toBe(true);
    expect(await consumeUsageIdempotent("p1", "ADVANCED_SEARCH", "req-3")).toBe(false); // limit is 2
  });

  it("refundUsage decrements the counter and is itself idempotent", async () => {
    await consumeUsageIdempotent("p1", "ADVANCED_SEARCH", "req-1");
    const { periodStart } = periodBounds();
    const row = () => usage.find((u) => u.profileId === "p1" && u.featureKey === "ADVANCED_SEARCH" && (u.periodStart as Date).getTime() === periodStart.getTime());
    expect(row()?.usageCount).toBe(1);

    expect(await refundUsage("p1", "ADVANCED_SEARCH", "req-1")).toBe(true);
    expect(row()?.usageCount).toBe(0);

    // Refunding the same requestId again is a no-op, not a double-decrement.
    expect(await refundUsage("p1", "ADVANCED_SEARCH", "req-1")).toBe(true);
    expect(row()?.usageCount).toBe(0);
  });

  it("refunding a requestId that was never consumed does nothing", async () => {
    expect(await refundUsage("p1", "ADVANCED_SEARCH", "never-happened")).toBe(false);
  });
});
