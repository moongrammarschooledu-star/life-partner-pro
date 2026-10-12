import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Found by the first sandbox payment test: the applicant's "I've made the transfer" moved the PAYMENT to PROCESSING but left the ORDER at PENDING_PAYMENT,
// and the status rules do not allow PENDING_PAYMENT -> PAID, so the admin's Verify always failed ("Cannot mark order as PAID from status PENDING_PAYMENT").
// The older race test mocks the status rules as "always valid", which is why this was never caught. This test uses the REAL rules.

const state = { detail: "PENDING_VERIFICATION", payment: "PROCESSING", order: "PENDING_PAYMENT" };
const calls = { invoice: 0 };

vi.mock("@/lib/prisma", () => {
  const tx = {
    manualPaymentDetail: { updateMany: async ({ where }: { where: { status: string } }) => { if (state.detail === where.status) { state.detail = "VERIFIED"; return { count: 1 }; } return { count: 0 }; } },
    payment: { update: async () => { state.payment = "PAID"; return {}; } },
    order: { update: async () => { state.order = "PAID"; return {}; } },
  };
  return {
    prisma: {
      payment: { findUnique: async () => ({ id: "pay1", profileId: "p1", orderId: "o1", status: state.payment, manualDetail: { status: state.detail }, order: { status: state.order, subscriptionId: null, items: [{ packageId: "pk1" }] } }) },
      package: { findUnique: async () => ({ id: "pk1", billingType: "ONE_TIME", durationDays: null, trialDays: 0 }) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/finance/invoice", () => ({ generateInvoice: async () => { calls.invoice++; return { id: "inv" }; } }));
vi.mock("@/lib/finance/subscription", () => ({ activateSubscription: async () => {}, confirmRenewal: async () => {} }));
vi.mock("@/lib/notifications/events", () => ({ notifyPaymentSuccess: async () => {}, notifyPaymentFailed: async () => {} }));

import { verifyManualPayment } from "@/lib/finance/manual-payment";

beforeEach(() => { state.detail = "PENDING_VERIFICATION"; state.payment = "PROCESSING"; state.order = "PENDING_PAYMENT"; calls.invoice = 0; });

describe("verifyManualPayment with the real status rules", () => {
  it("verifies a payment whose order is still PENDING_PAYMENT (the state the old confirm route left behind)", async () => {
    const result = await verifyManualPayment("pay1", "admin-A");
    expect(result.invoice).toMatchObject({ id: "inv" });
    expect(state.payment).toBe("PAID");
    expect(state.order).toBe("PAID");
    expect(calls.invoice).toBe(1);
  });

  it("verifies a payment whose order is PAYMENT_PROCESSING (where the confirm route now puts it)", async () => {
    state.order = "PAYMENT_PROCESSING";
    await verifyManualPayment("pay1", "admin-A");
    expect(state.order).toBe("PAID");
  });

  it.each(["CANCELLED", "FAILED", "PAID"])("still refuses an order that is %s", async (status) => {
    state.order = status;
    await expect(verifyManualPayment("pay1", "admin-A")).rejects.toThrow(/Cannot mark order as PAID/);
    expect(state.payment).toBe("PROCESSING");
    expect(calls.invoice).toBe(0);
  });
});

describe("the applicant's confirm route", () => {
  it("moves the order with the payment, only from PENDING_PAYMENT, in one transaction", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/my-billing/payments/[id]/confirm/route.ts"), "utf8");
    expect(src).toContain("prisma.$transaction([");
    expect(src).toContain('data: { status: "PROCESSING" }');
    expect(src).toContain('status: "PENDING_PAYMENT" }, data: { status: "PAYMENT_PROCESSING" }');
  });
});
