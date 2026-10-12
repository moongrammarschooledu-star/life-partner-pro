import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Found by the sandbox refund test: a refund is created REQUESTED and shown to approvers in that state, but the status rules only allow APPROVED from
// PENDING_APPROVAL, and approveRefund looked at the single edge REQUESTED -> APPROVED, so every approval threw (HTTP 500). This uses the REAL rules.

interface Refund { id: string; status: string; requestedById: string; paymentId: string; amountMinor: number; provider: string }
const st = { refund: { id: "r1", status: "REQUESTED", requestedById: "maker", paymentId: "pay1", amountMinor: 100000, provider: "MANUAL" } as Refund, audits: [] as string[] };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    refund: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === st.refund.id ? { ...st.refund } : null),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<Refund> }) => {
        if (st.refund.id === where.id && st.refund.status === where.status) { Object.assign(st.refund, data); return { count: 1 }; }
        return { count: 0 };
      },
    },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: { action: string }) => { st.audits.push(a.action); } }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: async () => "LPP-REF-000001" }));
vi.mock("@/lib/finance/providers/registry", () => ({ getProvider: () => ({}) }));
vi.mock("@/lib/notifications/events", () => ({ notifyRefundRequested: async () => {}, notifyRefundCompleted: async () => {} }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: async () => {} }));
vi.mock("@/lib/finance/coupon", () => ({ reverseCoupon: async () => {} }));
vi.mock("@/lib/route-guard", () => ({ ApiError: class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } } }));

import { approveRefund } from "@/lib/finance/refund";

beforeEach(() => { st.refund = { id: "r1", status: "REQUESTED", requestedById: "maker", paymentId: "pay1", amountMinor: 100000, provider: "MANUAL" }; st.audits = []; });

describe("approveRefund with the real status rules", () => {
  it("approves a refund that is still REQUESTED (the state it is created in) and records who approved it", async () => {
    await approveRefund("r1", "checker");
    expect(st.refund.status).toBe("APPROVED");
    expect((st.refund as Refund & { approvedById?: string }).approvedById).toBe("checker");
    expect(st.audits).toContain("REFUND_APPROVED");
  });

  it("also approves a refund waiting at PENDING_APPROVAL", async () => {
    st.refund.status = "PENDING_APPROVAL";
    await approveRefund("r1", "checker");
    expect(st.refund.status).toBe("APPROVED");
  });

  it("the requester can never approve their own refund", async () => {
    await expect(approveRefund("r1", "maker")).rejects.toMatchObject({ status: 403 });
    expect(st.refund.status).toBe("REQUESTED");
  });

  it.each(["APPROVED", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED", "FAILED"])("refuses a refund that is already %s, with a clear 409 (not a 500)", async (status) => {
    st.refund.status = status;
    await expect(approveRefund("r1", "checker")).rejects.toMatchObject({ status: 409 });
    expect(st.refund.status).toBe(status);
  });

  it("an unknown refund is reported as not found", async () => {
    await expect(approveRefund("nope", "checker")).rejects.toThrow(/not found/i);
  });

  it("two simultaneous approvals approve it once", async () => {
    const results = await Promise.allSettled([approveRefund("r1", "checker"), approveRefund("r1", "checker2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(st.refund.status).toBe("APPROVED");
  });
});

describe("Refunds tab", () => {
  it("shows the server's message when approve, reject or execute fails instead of doing nothing", () => {
    const page = readFileSync(join(process.cwd(), "src/app/admin/(shell)/finance-center/page.tsx"), "utf8");
    const section = page.slice(page.indexOf("function RefundsSection"), page.indexOf("function ManualPaymentsSection"));
    expect(section).toContain('await failure(res, "Could not approve the refund.")');
    expect(section).toContain('await failure(res, "Could not reject the refund.")');
    expect(section).toContain('await failure(res, "Could not execute the refund.")');
    expect(section).toContain("Password confirmation failed.");
  });
});
