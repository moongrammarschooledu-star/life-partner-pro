import { describe, it, expect, vi, beforeEach } from "vitest";

// STEP 33 §37 — a refund must reach the payment provider at most once, however many times "execute" is pressed.

const providerCalls: Array<{ amountMinor: number }> = [];
let refundRow: { id: string; status: string; paymentId: string; amountMinor: number; provider: string; requestedById: string };

vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/route-guard", () => ({ ApiError: class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } } }));
vi.mock("@/lib/notifications/events", () => ({ notifyRefundRequested: async () => {}, notifyRefundCompleted: async () => {} }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: async () => "LPP-REF-000001" }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: async () => {} }));
vi.mock("@/lib/finance/coupon", () => ({ reverseCoupon: async () => {} }));
vi.mock("@/lib/finance/providers/registry", () => ({
  getProvider: () => ({
    refundPayment: async (p: { amountMinor: number }) => {
      providerCalls.push(p);
      await new Promise((r) => setTimeout(r, 5)); // a real provider call takes time; the other request runs meanwhile
      return { status: "COMPLETED", providerRefundId: "re_1" };
    },
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    refund: {
      findUnique: async () => ({ ...refundRow }),
      update: async (a: { data: Record<string, unknown> }) => { refundRow = { ...refundRow, ...a.data } as typeof refundRow; return refundRow; },
      updateMany: async (a: { where: { status: string }; data: Record<string, unknown> }) => {
        if (refundRow.status !== a.where.status) return { count: 0 };
        refundRow = { ...refundRow, ...a.data } as typeof refundRow;
        return { count: 1 };
      },
    },
    payment: { findUnique: async () => ({ id: "pay1", amountMinor: 5000, status: "PAID", profileId: "p1", orderId: "o1", providerTransactionId: "tx1" }), update: async () => ({}) },
    couponRedemption: { findFirst: async () => null },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  },
}));

import { executeRefund, approveRefund } from "@/lib/finance/refund";

beforeEach(() => {
  providerCalls.length = 0;
  refundRow = { id: "r1", status: "APPROVED", paymentId: "pay1", amountMinor: 5000, provider: "MANUAL", requestedById: "staff-1" };
});

describe("executeRefund under concurrency", () => {
  it("two simultaneous executions ask the provider for the money exactly once", async () => {
    const results = await Promise.allSettled([executeRefund("r1", "super-A"), executeRefund("r1", "super-B")]);
    expect(providerCalls).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
  });

  it("a refund already COMPLETED cannot be executed again", async () => {
    refundRow.status = "COMPLETED";
    await expect(executeRefund("r1", "super-A")).rejects.toThrow(/Invalid refund status transition/);
    expect(providerCalls).toHaveLength(0);
  });
});

describe("approveRefund under concurrency", () => {
  it("two simultaneous approvals approve once; the other gets a 409", async () => {
    refundRow.status = "PENDING_APPROVAL";
    const results = await Promise.allSettled([approveRefund("r1", "mgr-A"), approveRefund("r1", "mgr-B")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
  });
});
