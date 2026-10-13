import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// An applicant withdrawing an unpaid order. Uses the REAL status rules (a mocked "always valid" rule is what hid the manual-payment bug before).

interface Pay { id: string; status: string; manualDetail: { status: string } | null }
const st = {
  order: { id: "o1", orderCode: "LPP-ORD-000001", profileId: "p1", status: "PENDING_PAYMENT" } as { id: string; orderCode: string; profileId: string; status: string },
  payments: [] as Pay[],
  redemption: "REDEEMED" as string,
};

vi.mock("@/lib/prisma", () => {
  const tx = {
    order: { updateMany: async ({ where }: { where: { id: string; status: string } }) => { if (st.order.id === where.id && st.order.status === where.status) { st.order.status = "CANCELLED"; return { count: 1 }; } return { count: 0 }; } },
    payment: { updateMany: async ({ where }: { where: { status: { in: string[] } } }) => { let n = 0; for (const p of st.payments) if (where.status.in.includes(p.status)) { p.status = "CANCELLED"; n++; } return { count: n }; } },
    couponRedemption: { updateMany: async ({ where }: { where: { status: string } }) => { if (st.redemption === where.status) { st.redemption = "RELEASED"; return { count: 1 }; } return { count: 0 }; } },
  };
  return {
    prisma: {
      order: { findFirst: async ({ where }: { where: { orderCode: string; profileId: string } }) => (where.orderCode === st.order.orderCode && where.profileId === st.order.profileId ? { ...st.order, payments: st.payments.map((p) => ({ ...p })) } : null) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

const audit = { rows: [] as Array<Record<string, unknown>>, fail: false };
vi.mock("@/lib/audit", () => ({
  writeAudit: async (row: Record<string, unknown>) => { if (audit.fail) throw new Error("audit store down"); audit.rows.push(row); },
}));
vi.mock("@/lib/observability/logger", () => ({ logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, critical: () => {} } }));

import { cancelPendingOrder } from "@/lib/finance/order-cancel";

beforeEach(() => {
  audit.rows = [];
  audit.fail = false;
  st.order = { id: "o1", orderCode: "LPP-ORD-000001", profileId: "p1", status: "PENDING_PAYMENT" };
  st.payments = [{ id: "pay1", status: "PENDING", manualDetail: null }];
  st.redemption = "REDEEMED";
});

describe("cancelPendingOrder", () => {
  it("cancels an unpaid order, its unpaid payment, and gives a used coupon back", async () => {
    await expect(cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" })).resolves.toEqual({ orderCode: "LPP-ORD-000001" });
    expect(st.order.status).toBe("CANCELLED");
    expect(st.payments[0].status).toBe("CANCELLED");
    expect(st.redemption).toBe("RELEASED");
  });

  it("another person's order answers 404, exactly like an unknown order", async () => {
    await expect(cancelPendingOrder({ profileId: "someone-else", orderCode: "LPP-ORD-000001" })).rejects.toMatchObject({ status: 404 });
    await expect(cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-999999" })).rejects.toMatchObject({ status: 404 });
    expect(st.order.status).toBe("PENDING_PAYMENT");
  });

  it("refuses once a bank-transfer reference was submitted (the admin decides from then on)", async () => {
    st.payments = [{ id: "pay1", status: "PROCESSING", manualDetail: { status: "PENDING_VERIFICATION" } }];
    st.order.status = "PAYMENT_PROCESSING";
    await expect(cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" })).rejects.toMatchObject({ status: 409 });
    expect(st.order.status).toBe("PAYMENT_PROCESSING");
    expect(st.payments[0].status).toBe("PROCESSING");
  });

  it.each(["PAID", "FAILED", "CANCELLED"])("refuses an order that is already %s", async (status) => {
    st.order.status = status;
    await expect(cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" })).rejects.toMatchObject({ status: 409 });
    expect(st.order.status).toBe(status);
  });

  it("two simultaneous cancels settle the order once; the second is refused", async () => {
    const results = await Promise.allSettled([cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" }), cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(st.order.status).toBe("CANCELLED");
  });
});

describe("cancel audit trail", () => {
  it("records exactly one ORDER_CANCELLED row for the applicant, with only the order code and the status it was cancelled from", async () => {
    await cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" });
    expect(audit.rows).toEqual([{ action: "ORDER_CANCELLED", targetProfileId: "p1", meta: { orderCode: "LPP-ORD-000001", from: "PENDING_PAYMENT", by: "applicant" } }]);
  });

  it("writes nothing when the cancel is refused (404, 409 or lost race)", async () => {
    await expect(cancelPendingOrder({ profileId: "someone-else", orderCode: "LPP-ORD-000001" })).rejects.toMatchObject({ status: 404 });
    st.order.status = "PAID";
    await expect(cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" })).rejects.toMatchObject({ status: 409 });
    expect(audit.rows).toEqual([]);
  });

  it("two simultaneous cancels leave one audit row", async () => {
    await Promise.allSettled([cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" }), cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" })]);
    expect(audit.rows).toHaveLength(1);
  });

  it("a failing audit write does not undo or fail an order that is already cancelled", async () => {
    audit.fail = true;
    await expect(cancelPendingOrder({ profileId: "p1", orderCode: "LPP-ORD-000001" })).resolves.toEqual({ orderCode: "LPP-ORD-000001" });
    expect(st.order.status).toBe("CANCELLED");
  });
});

describe("the audit action exists in the schema and has a migration", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  it("ORDER_CANCELLED is an AuditAction value added by an enum-only migration", () => {
    expect(read("prisma/schema.prisma")).toMatch(/enum AuditAction \{(?:(?!\n\})[\s\S])*?\n\s+ORDER_CANCELLED\r?\n/);
    const sql = read("prisma/migrations/20261013090000_order_cancel_audit_enum/migration.sql");
    expect(sql).toContain(`ALTER TYPE "AuditAction" ADD VALUE 'ORDER_CANCELLED';`);
    expect(sql).not.toMatch(/CREATE TABLE|INSERT|UPDATE|DROP/i);
  });
});

describe("cancel route and page", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("the route needs a signed-in applicant, is rate limited, and passes the signed-in profile (never one from the request)", () => {
    const src = read("src/app/api/my-billing/orders/[orderCode]/cancel/route.ts");
    expect(src).toContain("requireApplicantProfileId()");
    expect(src).toContain("enforcePersistentLimit(");
    expect(src).toContain("cancelPendingOrder({ profileId, orderCode })");
    expect(src).not.toMatch(/req\.json\(\)/);
  });

  it("the checkout screen offers the button and calls that route", () => {
    const page = read("src/app/(public)/my-billing/page.tsx");
    expect(page).toContain("Cancel this order");
    expect(page).toContain("/api/my-billing/orders/${checkoutResult.orderCode}/cancel");
  });
});
