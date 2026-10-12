import { describe, it, expect, vi, beforeEach } from "vitest";

// Found by the sandbox test: rejecting a manual payment failed the PAYMENT but left its ORDER at PAYMENT_PROCESSING (LPP-ORD-000002), so the order looked
// as if a payment were still being checked. The order must follow the payment to FAILED, and only from the two open states.

const state = { detail: "PENDING_VERIFICATION", payment: "PROCESSING", order: "PAYMENT_PROCESSING" };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      findUnique: async () => ({ id: "pay1", profileId: "p1", orderId: "o1", status: state.payment, manualDetail: { status: state.detail } }),
      update: async () => { state.payment = "FAILED"; return {}; },
    },
    manualPaymentDetail: { update: async () => { state.detail = "REJECTED"; return {}; } },
    order: {
      updateMany: async ({ where }: { where: { status: { in: string[] } } }) => {
        if (where.status.in.includes(state.order)) { state.order = "FAILED"; return { count: 1 }; }
        return { count: 0 };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/finance/invoice", () => ({ generateInvoice: async () => ({}) }));
vi.mock("@/lib/finance/subscription", () => ({ activateSubscription: async () => {}, confirmRenewal: async () => {} }));
vi.mock("@/lib/notifications/events", () => ({ notifyPaymentSuccess: async () => {}, notifyPaymentFailed: async () => {} }));

import { rejectManualPayment } from "@/lib/finance/manual-payment";

beforeEach(() => { state.detail = "PENDING_VERIFICATION"; state.payment = "PROCESSING"; state.order = "PAYMENT_PROCESSING"; });

describe("rejectManualPayment", () => {
  it.each(["PAYMENT_PROCESSING", "PENDING_PAYMENT"])("fails the order too when it is %s", async (orderStatus) => {
    state.order = orderStatus;
    await rejectManualPayment("pay1", "admin-A", "Reference not found in the bank statement");
    expect(state.payment).toBe("FAILED");
    expect(state.detail).toBe("REJECTED");
    expect(state.order).toBe("FAILED");
  });

  it.each(["PAID", "CANCELLED", "REFUNDED"])("leaves an order that is %s alone", async (orderStatus) => {
    state.order = orderStatus;
    await rejectManualPayment("pay1", "admin-A", "Reference not found in the bank statement");
    expect(state.order).toBe(orderStatus);
  });

  it("still requires a reason and changes nothing without one", async () => {
    await expect(rejectManualPayment("pay1", "admin-A", "  ")).rejects.toThrow(/reason is required/);
    expect(state.payment).toBe("PROCESSING");
    expect(state.order).toBe("PAYMENT_PROCESSING");
  });

  it("refuses a payment that was already decided", async () => {
    state.detail = "VERIFIED";
    await expect(rejectManualPayment("pay1", "admin-A", "late")).rejects.toThrow(/already been verified or rejected/);
    expect(state.order).toBe("PAYMENT_PROCESSING");
  });
});
