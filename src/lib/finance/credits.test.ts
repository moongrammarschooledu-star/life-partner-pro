import { describe, it, expect, vi, beforeEach } from "vitest";

let credits: Array<Record<string, unknown>>;
let transactions: Array<Record<string, unknown>>;
let auditCalls: Array<Record<string, unknown>>;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (prefix: string) => `LPP-${prefix}-000001`) }));
vi.mock("@/lib/finance/rollout", () => ({ getPaymentFeatureFlags: vi.fn(async () => ({ creditsEnabled: true })) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membershipCredit: {
      findUnique: vi.fn(async ({ where }: { where: { profileId_currencyCode: { profileId: string; currencyCode: string } } }) => {
        const k = where.profileId_currencyCode;
        return credits.find((c) => c.profileId === k.profileId && c.currencyCode === k.currencyCode) ?? null;
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { profileId_currencyCode: { profileId: string; currencyCode: string } }; update: { balanceMinor: { increment: number } }; create: Record<string, unknown> }) => {
        const k = where.profileId_currencyCode;
        const existing = credits.find((c) => c.profileId === k.profileId && c.currencyCode === k.currencyCode);
        if (existing) {
          existing.balanceMinor = (existing.balanceMinor as number) + update.balanceMinor.increment;
          return existing;
        }
        const row = { id: `c${credits.length + 1}`, ...create };
        credits.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; balanceMinor: { gte: number } }; data: { balanceMinor: { decrement: number } } }) => {
        const row = credits.find((c) => c.id === where.id);
        if (!row || (row.balanceMinor as number) < where.balanceMinor.gte) return { count: 0 };
        row.balanceMinor = (row.balanceMinor as number) - data.balanceMinor.decrement;
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { balanceMinor: number } }) => {
        const row = credits.find((c) => c.id === where.id)!;
        row.balanceMinor = data.balanceMinor;
        return row;
      }),
    },
    creditTransaction: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { transactions.push(data); return data; }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const { prisma } = await import("@/lib/prisma");
      return fn(prisma);
    }),
  },
}));

const { grantCredit, useCredit, revokeCredit, getBalance } = await import("./credits");

beforeEach(() => {
  credits = [];
  transactions = [];
  auditCalls = [];
});

describe("grantCredit / getBalance", () => {
  it("grants a new credit and creates a GRANTED transaction", async () => {
    await grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: 5000, reason: "Test" });
    expect(await getBalance("p1", "PKR")).toBe(5000);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe("GRANTED");
  });

  it("accumulates multiple grants", async () => {
    await grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: 5000, reason: "First" });
    await grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: 3000, reason: "Second" });
    expect(await getBalance("p1", "PKR")).toBe(8000);
  });

  it("rejects a non-positive grant amount", async () => {
    await expect(grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: 0, reason: "bad" })).rejects.toThrow();
    await expect(grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: -100, reason: "bad" })).rejects.toThrow();
  });
});

describe("useCredit", () => {
  it("caps usage at the available balance, never going negative", async () => {
    await grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: 1000, reason: "Test" });
    const used = await useCredit("p1", "PKR", 5000, "ORDER", "order1");
    expect(used).toBe(1000);
    expect(await getBalance("p1", "PKR")).toBe(0);
  });

  it("uses exactly the requested amount when within balance", async () => {
    await grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: 10000, reason: "Test" });
    const used = await useCredit("p1", "PKR", 4000, "ORDER", "order1");
    expect(used).toBe(4000);
    expect(await getBalance("p1", "PKR")).toBe(6000);
  });

  it("returns 0 for a profile with no credit at all", async () => {
    expect(await useCredit("nobody", "PKR", 1000, "ORDER", "order1")).toBe(0);
  });
});

describe("revokeCredit", () => {
  it("reduces the balance and floors at 0", async () => {
    await grantCredit({ profileId: "p1", currencyCode: "PKR", amountMinor: 1000, reason: "Test" });
    await revokeCredit("admin1", "p1", "PKR", 5000, "Mistake");
    expect(await getBalance("p1", "PKR")).toBe(0);
  });
});
