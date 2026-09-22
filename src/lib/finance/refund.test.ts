import { describe, it, expect, vi, beforeEach } from "vitest";

const audits: Array<{ action: string; adminId?: string | null; meta?: Record<string, unknown> }> = [];
vi.mock("@/lib/audit", () => ({ writeAudit: async (p: { action: string; adminId?: string | null; meta?: Record<string, unknown> }) => { audits.push(p); } }));
vi.mock("@/lib/route-guard", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/notifications/events", () => ({
  notifyRefundRequested: vi.fn(),
  notifyRefundCompleted: vi.fn(),
}));

let refundRow: { id: string; status: string; requestedById: string; approvedById: string | null };
vi.mock("@/lib/prisma", () => ({
  prisma: {
    refund: {
      findUnique: vi.fn(() => Promise.resolve(refundRow)),
      update: vi.fn((args: { data: Record<string, unknown> }) => {
        refundRow = { ...refundRow, ...args.data } as typeof refundRow;
        return Promise.resolve(refundRow);
      }),
    },
  },
}));

import { approveRefund, rejectRefund } from "@/lib/finance/refund";

beforeEach(() => {
  audits.length = 0;
  refundRow = { id: "r1", status: "PENDING_APPROVAL", requestedById: "staff-1", approvedById: null };
});

// STEP 17 §26 — the admin who requested a refund can never also be the one
// who approves it, even a FINANCE_MANAGER who independently holds
// finance:refunds:approve.
describe("approveRefund (self-approval guard)", () => {
  it("blocks the requester from approving their own refund", async () => {
    await expect(approveRefund("r1", "staff-1")).rejects.toMatchObject({ status: 403 });
    expect(audits).toEqual([]);
  });

  it("allows a different admin to approve", async () => {
    const result = await approveRefund("r1", "manager-2");
    expect(result).toBeDefined();
    expect(audits).toEqual([{ action: "REFUND_APPROVED", adminId: "manager-2", meta: { refundId: "r1" } }]);
  });
});

describe("rejectRefund", () => {
  it("is not restricted to a different admin than the requester (rejection isn't self-serving)", async () => {
    await rejectRefund("r1", "staff-1");
    expect(audits).toEqual([{ action: "REFUND_REJECTED", adminId: "staff-1", meta: { refundId: "r1" } }]);
  });
});
