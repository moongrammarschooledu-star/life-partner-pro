import { describe, it, expect, vi, beforeEach } from "vitest";

// STEP 33 §37 — race conditions. Two administrators verifying the same manual payment at the same moment must settle it ONCE: one
// subscription activation, one invoice, one success notice. The row claim (PENDING_VERIFICATION -> VERIFIED, conditional) is the guard.

const state = { detailStatus: "PENDING_VERIFICATION" as "PENDING_VERIFICATION" | "VERIFIED", paymentStatus: "PROCESSING", orderStatus: "PENDING" };
const calls = { activate: 0, invoice: 0, notify: 0, audit: 0 };

vi.mock("@/lib/prisma", () => {
  const tx = {
    manualPaymentDetail: {
      // atomic compare-and-set, like a conditional UPDATE: only the first caller sees count 1
      updateMany: async ({ where }: { where: { status: string } }) => {
        if (state.detailStatus === where.status) { state.detailStatus = "VERIFIED"; return { count: 1 }; }
        return { count: 0 };
      },
    },
    payment: { update: async () => { state.paymentStatus = "PAID"; return {}; } },
    order: { update: async () => { state.orderStatus = "PAID"; return {}; } },
  };
  return {
    prisma: {
      payment: {
        findUnique: async () => ({
          id: "pay1", profileId: "p1", orderId: "o1", status: "PROCESSING",
          manualDetail: { status: "PENDING_VERIFICATION" }, // both callers read the row BEFORE either claims it
          order: { status: "PENDING", subscriptionId: null, items: [{ packageId: "pk1" }] },
        }),
      },
      package: { findUnique: async () => ({ id: "pk1", billingType: "ONE_TIME", durationDays: 30, trialDays: 0 }) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/audit", () => ({ writeAudit: async () => { calls.audit++; } }));
vi.mock("@/lib/finance/status-transitions", () => ({ isValidPaymentStatusTransition: () => true, isValidOrderStatusTransition: () => true }));
vi.mock("@/lib/finance/invoice", () => ({ generateInvoice: async () => { calls.invoice++; return { id: "inv" }; } }));
vi.mock("@/lib/finance/subscription", () => ({ activateSubscription: async () => { calls.activate++; }, confirmRenewal: async () => {} }));
vi.mock("@/lib/notifications/events", () => ({ notifyPaymentSuccess: async () => { calls.notify++; }, notifyPaymentFailed: async () => {} }));

import { verifyManualPayment } from "@/lib/finance/manual-payment";

describe("verifyManualPayment under concurrency", () => {
  beforeEach(() => {
    state.detailStatus = "PENDING_VERIFICATION"; state.paymentStatus = "PROCESSING"; state.orderStatus = "PENDING";
    calls.activate = calls.invoice = calls.notify = calls.audit = 0;
  });

  it("two simultaneous verifications settle the payment exactly once", async () => {
    const results = await Promise.allSettled([verifyManualPayment("pay1", "admin-A"), verifyManualPayment("pay1", "admin-B")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason?.message)).toMatch(/already been verified/);
    expect(calls.activate).toBe(1);
    expect(calls.invoice).toBe(1);
    expect(calls.notify).toBe(1);
    expect(state.paymentStatus).toBe("PAID");
  });

  it("a single verification still works end to end", async () => {
    await verifyManualPayment("pay1", "admin-A");
    expect(calls.activate).toBe(1);
    expect(state.detailStatus).toBe("VERIFIED");
  });
});
