import { describe, it, expect, vi, beforeEach } from "vitest";

let taxRule: { ratePercentBasisPoints: number } | null;
let orders: Record<string, unknown>[];
let payments: Record<string, unknown>[];
let complianceReviews: Record<string, unknown>[];
let auditCalls: Record<string, unknown>[];
let seq = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (prefix: string) => `LPP-${prefix}-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/finance/coupon", () => ({ resolveCouponForOrder: vi.fn() }));
vi.mock("@/lib/finance/tax", () => ({
  resolveTaxRule: vi.fn(async () => taxRule),
  computeTax: vi.fn((amount: number, bps: number) => Math.round((amount * bps) / 10000),
  ),
}));
vi.mock("@/lib/finance/providers/registry", () => ({
  getActiveProvider: vi.fn(async () => ({ name: "MANUAL", createCheckout: vi.fn(async () => ({ url: "https://pay.example/x" })) })),
}));
vi.mock("@/lib/finance/rollout", () => ({
  assertPaymentsAvailable: vi.fn(async () => undefined),
  PaymentsUnavailableError: class PaymentsUnavailableError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    package: {
      findUnique: vi.fn(async () => ({
        id: "pkg1",
        active: true,
        name: "Gold Package",
        prices: [{ id: "price1", amountMinor: 100000, currencyCode: "PKR" }],
      })),
    },
    order: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `order${orders.length + 1}`, ...data };
        orders.push(row);
        return row;
      }),
    },
    couponRedemption: { create: vi.fn(async () => ({})) },
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `payment${payments.length + 1}`, ...data };
        payments.push(row);
        return row;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data })),
    },
    complianceReview: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `crev${complianceReviews.length + 1}`, ...data };
        complianceReviews.push(row);
        return row;
      }),
    },
  },
}));

const { startCheckout } = await import("./checkout");

beforeEach(() => {
  taxRule = { ratePercentBasisPoints: 500 };
  orders = [];
  payments = [];
  complianceReviews = [];
  auditCalls = [];
  seq = 0;
});

describe("startCheckout", () => {
  it("creates an order and payment as usual when a TaxRule resolves for the country", async () => {
    const result = await startCheckout({ profileId: "p1", packageId: "pkg1", country: "PK" });
    expect(orders).toHaveLength(1);
    expect(result.order.taxMinor).toBe(5000);
    expect(complianceReviews).toHaveLength(0);
  });

  it("STEP 23 Add-on — flags the order for tax review (non-blocking) when no TaxRule resolves for the country", async () => {
    taxRule = null;
    const result = await startCheckout({ profileId: "p1", packageId: "pkg1", country: "Antarctica" });

    expect(result.order).toBeDefined();
    expect(result.payment).toBeDefined();
    expect(complianceReviews).toHaveLength(1);
    expect(complianceReviews[0]).toMatchObject({ subjectType: "ORDER", subjectId: result.order.id, status: "REVIEW_REQUIRED", reviewType: "TAX_CONFIGURATION" });
  });

  it("checkout still succeeds even if the tax-review flag write itself fails", async () => {
    taxRule = null;
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.complianceReview.create).mockRejectedValueOnce(new Error("db down"));

    const result = await startCheckout({ profileId: "p1", packageId: "pkg1", country: "Antarctica" });
    expect(result.order).toBeDefined();
    expect(result.payment).toBeDefined();
  });
});
